package localui

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"net/netip"
	"reflect"
	"slices"
	"strconv"
	"time"

	"github.com/floegence/redeven/internal/runtimemanagement"
)

const publicAddressRefreshInterval = 2 * time.Second

// A published snapshot is immutable. Admission, reports and TLS handshakes all
// read this same owner; no consumer independently resolves public addresses.
type publicAccessSnapshot struct {
	hosts       []string
	authorities map[string]struct{}
	urls        []string
	certificate *tls.Certificate
	issues      []runtimemanagement.LocalUIAddressIssue
}

func (a publicAccessSnapshot) publicURLs() []string { return append([]string{}, a.urls...) }

func (s *Server) publicAccessSnapshot() publicAccessSnapshot {
	s.authorityMu.RLock()
	defer s.authorityMu.RUnlock()
	if s.publicAccess == nil {
		return publicAccessSnapshot{}
	}
	return *s.publicAccess
}

func (s *Server) accessSnapshotForHosts(hosts []string, certificate *tls.Certificate, issues []runtimemanagement.LocalUIAddressIssue) publicAccessSnapshot {
	result := publicAccessSnapshot{hosts: slices.Clone(hosts), authorities: make(map[string]struct{}, len(hosts)), certificate: certificate, issues: issues}
	for _, host := range hosts {
		authority := net.JoinHostPort(host, strconv.Itoa(s.publicPort))
		result.authorities[authority] = struct{}{}
		result.urls = append(result.urls, s.protocol+"://"+publicURLAuthority(authority, s.protocol)+"/")
	}
	return result
}

func (s *Server) publishPublicAccess(next publicAccessSnapshot) {
	s.authorityMu.Lock()
	s.publicAccess = &next
	s.authorityMu.Unlock()
}

func (s *Server) currentAccessCertificate(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	current := s.publicAccessSnapshot()
	if current.certificate == nil || len(current.hosts) == 0 {
		return nil, fmt.Errorf("no currently available Local UI TLS address")
	}
	return current.certificate, nil
}

func (s *Server) startPublicAddressRefresh(ctx context.Context) {
	if !s.bind.IsNetworkExposure() {
		return
	}
	ctx, cancel := context.WithCancel(ctx)
	s.addressRefreshCancel = cancel
	s.addressRefreshDone = make(chan struct{})
	done := s.addressRefreshDone
	go func() {
		defer close(done)
		ticker := time.NewTicker(publicAddressRefreshInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if ctx.Err() != nil {
					return
				}
				s.refreshPublicAccess()
			}
		}
	}()
}

func (s *Server) stopPublicAddressRefresh() {
	if s.addressRefreshCancel != nil {
		s.addressRefreshCancel()
		<-s.addressRefreshDone
		s.addressRefreshCancel, s.addressRefreshDone = nil, nil
	}
	s.addressRefreshMu.Lock()
	s.addressRefreshClosed = true
	s.addressRefreshMu.Unlock()
}

func (s *Server) refreshPublicAccess() {
	s.addressRefreshMu.Lock()
	defer s.addressRefreshMu.Unlock()
	if s.addressRefreshClosed || !s.bind.IsNetworkExposure() {
		return
	}
	previous := s.publicAccessSnapshot()
	resolver := s.resolveAccessHosts
	if resolver == nil {
		resolver = resolveNetworkAccessHosts
	}
	addresses, scanErr := resolver(s.bind)
	var issues []runtimemanagement.LocalUIAddressIssue
	if scanErr != nil {
		addresses = nil
		issues = append(issues, runtimemanagement.LocalUIAddressIssue{Code: runtimemanagement.LocalUIInterfaceScanFailed})
	}
	var hosts []string
	if s.bind.IsWildcard() {
		var err error
		hosts, err = publicAccessHosts(s.bind, s.publicBound, func(BindSpec) ([]netip.Addr, error) { return addresses, nil })
		if err != nil {
			// An invalid resolver result is never admitted. Keep only listeners
			// whose loopback scope is independent of interface enumeration.
			hosts, _ = publicAccessHosts(s.bind, s.publicBound, func(BindSpec) ([]netip.Addr, error) { return nil, nil })
			issues = []runtimemanagement.LocalUIAddressIssue{{Code: runtimemanagement.LocalUIInterfaceScanFailed}}
		}
	} else if slices.Contains(addresses, netip.MustParseAddr(s.bind.Host())) {
		hosts = []string{s.bind.Host()}
	} else if scanErr == nil {
		issues = append(issues, runtimemanagement.LocalUIAddressIssue{Code: runtimemanagement.LocalUIBoundAddressUnavailable, Hosts: []string{s.bind.Host()}})
	}
	certificate := previous.certificate
	if s.protocol == "https" && len(hosts) > 0 {
		if s.deviceCA.serverCertificate != nil {
			var missing []string
			hosts, missing = coveredCertificateHosts(certificate, hosts)
			if len(missing) > 0 {
				issues = append(issues, runtimemanagement.LocalUIAddressIssue{Code: runtimemanagement.LocalUICertificateHostsNotCovered, Hosts: missing})
			}
		} else if !slices.Equal(hosts, previous.hosts) || slices.ContainsFunc(previous.issues, func(issue runtimemanagement.LocalUIAddressIssue) bool {
			return issue.Code == runtimemanagement.LocalUICertificateRefreshFailed
		}) {
			sign := s.signAccessCertificate
			if sign == nil {
				sign = newLocalUIServerCertificate
			}
			next, _, err := sign(s.deviceCA, hosts)
			if err == nil {
				certificate = &next
			} else {
				// Removal still takes effect when adding coverage fails. Never
				// advertise a new host under an old, incompatible certificate.
				hosts, _ = coveredCertificateHosts(certificate, hosts)
				issues = append(issues, runtimemanagement.LocalUIAddressIssue{Code: runtimemanagement.LocalUICertificateRefreshFailed})
			}
		}
	}
	if slices.Equal(previous.hosts, hosts) && reflect.DeepEqual(previous.issues, issues) {
		return
	}
	next := s.accessSnapshotForHosts(hosts, certificate, issues)
	s.publishPublicAccess(next)
	if s.log != nil {
		s.log.Info("Local UI public addresses changed", "urls", next.urls, "issues", issues)
	}
}

func coveredCertificateHosts(certificate *tls.Certificate, hosts []string) (covered, missing []string) {
	var leaf *x509.Certificate
	if certificate != nil && len(certificate.Certificate) > 0 {
		leaf = certificate.Leaf
		if leaf == nil {
			leaf, _ = x509.ParseCertificate(certificate.Certificate[0])
		}
	}
	now := time.Now()
	for _, host := range hosts {
		if leaf != nil && !now.Before(leaf.NotBefore) && now.Before(leaf.NotAfter) && leaf.VerifyHostname(host) == nil {
			covered = append(covered, host)
		} else {
			missing = append(missing, host)
		}
	}
	return covered, missing
}
