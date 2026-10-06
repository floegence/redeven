// Package gatewayegress forwards approved Runtime connections without
// terminating their inner Cloud TLS or Flowersec sessions.
package gatewayegress

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var ErrInvalidPolicy = errors.New("invalid Gateway egress policy")

type Member struct {
	ID                string
	Generation        uint64
	CertificateSHA256 string
	Destinations      []string
}

type Options struct {
	MaxConnectionsPerMember  int
	MaxConnections           int
	AllowPrivateDestinations bool
}

type memberPolicy struct {
	id           string
	generation   uint64
	destinations map[string]struct{}
}

type connection struct {
	memberID    string
	fingerprint string
	generation  uint64
	destination string
	cancel      context.CancelFunc
}

type Server struct {
	accepted      atomic.Uint64
	rejected      atomic.Uint64
	uploadBytes   atomic.Uint64
	downloadBytes atomic.Uint64
	mu            sync.Mutex
	members       map[string]memberPolicy
	active        map[*connection]struct{}
	options       Options
	closed        bool
}

func New(options Options) (*Server, error) {
	if options.MaxConnectionsPerMember < 0 || options.MaxConnections < 0 {
		return nil, ErrInvalidPolicy
	}
	if options.MaxConnectionsPerMember == 0 {
		options.MaxConnectionsPerMember = 32
	}
	if options.MaxConnections == 0 {
		options.MaxConnections = 1024
	}
	return &Server{members: make(map[string]memberPolicy), active: make(map[*connection]struct{}), options: options}, nil
}

// TLSConfig constructs an isolated TLS listener policy for Runtime identities.
// Every HTTP request is checked against both the certificate and current policy.
func TLSConfig(serverCertificate tls.Certificate, clientRoots *x509.CertPool) (*tls.Config, error) {
	if len(serverCertificate.Certificate) == 0 || clientRoots == nil || clientRoots.Equal(x509.NewCertPool()) {
		return nil, ErrInvalidPolicy
	}
	return &tls.Config{Certificates: []tls.Certificate{serverCertificate}, ClientCAs: clientRoots.Clone(), ClientAuth: tls.RequireAndVerifyClientCert, MinVersion: tls.VersionTLS13, NextProtos: []string{"http/1.1"}, SessionTicketsDisabled: true}, nil
}

// ReplaceMembers atomically installs a validated snapshot and closes connections
// whose exact member generation, certificate or destination was removed.
func (s *Server) ReplaceMembers(members []Member) error {
	next := make(map[string]memberPolicy, len(members))
	ids := make(map[string]struct{}, len(members))
	for _, member := range members {
		raw, err := hex.DecodeString(member.CertificateSHA256)
		if member.ID == "" || member.Generation == 0 || err != nil || len(raw) != sha256.Size || hex.EncodeToString(raw) != member.CertificateSHA256 || len(member.Destinations) == 0 {
			return ErrInvalidPolicy
		}
		if _, exists := next[member.CertificateSHA256]; exists {
			return ErrInvalidPolicy
		}
		if _, exists := ids[member.ID]; exists {
			return ErrInvalidPolicy
		}
		ids[member.ID] = struct{}{}
		policy := memberPolicy{id: member.ID, generation: member.Generation, destinations: make(map[string]struct{}, len(member.Destinations))}
		for _, address := range member.Destinations {
			if !validAuthority(address) {
				return ErrInvalidPolicy
			}
			policy.destinations[address] = struct{}{}
		}
		next[member.CertificateSHA256] = policy
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return net.ErrClosed
	}
	s.members = next
	for current := range s.active {
		policy, exists := next[current.fingerprint]
		_, allowed := policy.destinations[current.destination]
		if !exists || !allowed || policy.id != current.memberID || policy.generation != current.generation {
			current.cancel()
		}
	}
	return nil
}

func (s *Server) MemberCount() int { s.mu.Lock(); defer s.mu.Unlock(); return len(s.members) }

// ActiveMembers includes pending dials and streams whose cancellation has not
// completed, so callers cannot acknowledge closure before bytes stop flowing.
func (s *Server) ActiveMembers() map[string]int {
	s.mu.Lock()
	defer s.mu.Unlock()
	counts := make(map[string]int)
	for current := range s.active {
		counts[current.memberID]++
	}
	return counts
}

// ActiveThrough counts only streams from the revoked path version. New Cloud
// acknowledgement connections do not prevent the old session closure receipt.
func (s *Server) ActiveThrough(memberID string, generation uint64) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	count := 0
	for current := range s.active {
		if current.memberID == memberID && current.generation <= generation {
			count++
		}
	}
	return count
}

func (s *Server) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	for current := range s.active {
		current.cancel()
	}
	return nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	established := false
	defer func() {
		if !established {
			s.rejected.Add(1)
		}
	}()
	w.Header().Set("Cache-Control", "no-store")
	if r.TLS == nil || len(r.TLS.VerifiedChains) == 0 || len(r.TLS.PeerCertificates) == 0 {
		http.Error(w, "Runtime identity required", http.StatusUnauthorized)
		return
	}
	if r.Method != http.MethodConnect || r.ProtoMajor != 1 || !validAuthority(r.Host) || r.URL.Host != r.Host || r.URL.Path != "" || r.URL.RawQuery != "" || r.ContentLength > 0 || len(r.TransferEncoding) > 0 {
		http.Error(w, "Invalid CONNECT request", http.StatusBadRequest)
		return
	}
	leaf := r.TLS.PeerCertificates[0]
	now := time.Now()
	if now.Before(leaf.NotBefore) || !now.Before(leaf.NotAfter) {
		http.Error(w, "Runtime identity expired", http.StatusUnauthorized)
		return
	}
	fingerprint := sha256.Sum256(leaf.Raw)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	current, status := s.reserve(hex.EncodeToString(fingerprint[:]), r.Host, cancel)
	if current == nil {
		http.Error(w, http.StatusText(status), status)
		return
	}
	defer func() { s.mu.Lock(); delete(s.active, current); s.mu.Unlock() }()
	dialCtx, dialCancel := context.WithTimeout(ctx, 10*time.Second)
	upstream, err := s.dialDestination(dialCtx, r.Host)
	dialCancel()
	if err != nil {
		http.Error(w, "Cloud destination unavailable", http.StatusBadGateway)
		return
	}
	defer upstream.Close()
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "CONNECT transport unavailable", http.StatusServiceUnavailable)
		return
	}
	client, buffered, err := hijacker.Hijack()
	if err != nil {
		return
	}
	defer client.Close()
	stop := context.AfterFunc(ctx, func() { _ = client.Close(); _ = upstream.Close() })
	defer stop()
	if ctx.Err() != nil {
		return
	}
	_ = client.SetWriteDeadline(time.Now().Add(10 * time.Second))
	if _, err = buffered.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
		return
	}
	if err = buffered.Flush(); err != nil {
		return
	}
	_ = client.SetDeadline(time.Time{})
	established = true
	s.accepted.Add(1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		written, _ := io.CopyBuffer(upstream, buffered, make([]byte, 32<<10))
		s.uploadBytes.Add(uint64(written))
		_ = upstream.Close()
		_ = client.Close()
	}()
	written, _ := io.CopyBuffer(client, upstream, make([]byte, 32<<10))
	s.downloadBytes.Add(uint64(written))
	_ = client.Close()
	_ = upstream.Close()
	<-done
}

func (s *Server) reserve(fingerprint, destination string, cancel context.CancelFunc) (*connection, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, http.StatusServiceUnavailable
	}
	member, ok := s.members[fingerprint]
	if !ok {
		return nil, http.StatusForbidden
	}
	if _, ok := member.destinations[destination]; !ok {
		return nil, http.StatusForbidden
	}
	if len(s.active) >= s.options.MaxConnections {
		return nil, http.StatusTooManyRequests
	}
	count := 0
	for current := range s.active {
		if current.memberID == member.id {
			count++
		}
	}
	if count >= s.options.MaxConnectionsPerMember {
		return nil, http.StatusTooManyRequests
	}
	current := &connection{memberID: member.id, fingerprint: fingerprint, generation: member.generation, destination: destination, cancel: cancel}
	s.active[current] = struct{}{}
	return current, http.StatusOK
}

func validAuthority(address string) bool {
	host, port, err := net.SplitHostPort(address)
	if err != nil || host == "" || strings.ContainsAny(host, " \t\r\n/\\@?#%") || strings.ToLower(host) != host || strings.HasSuffix(host, ".") {
		return false
	}
	n, err := strconv.Atoi(port)
	return err == nil && n > 0 && n <= 65535 && strconv.Itoa(n) == port
}

func (s *Server) dialDestination(ctx context.Context, address string) (net.Conn, error) {
	if !validAuthority(address) {
		return nil, ErrInvalidPolicy
	}
	host, port, _ := net.SplitHostPort(address)
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil || len(ips) == 0 {
		return nil, errors.New("destination unavailable")
	}
	// Validate all returned addresses, then dial the validated numeric address
	// exactly once so DNS cannot change the policy between checking and dialing.
	for _, ip := range ips {
		ip = ip.Unmap()
		if !allowedIP(ip, s.options.AllowPrivateDestinations) {
			return nil, ErrInvalidPolicy
		}
	}
	return (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext(ctx, "tcp", net.JoinHostPort(ips[0].Unmap().String(), port))
}

func allowedIP(ip netip.Addr, allowPrivate bool) bool {
	if !ip.IsValid() || ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return false
	}
	if ip.IsPrivate() || ip.IsLoopback() {
		return allowPrivate
	}
	if !ip.IsGlobalUnicast() {
		return false
	}
	for _, prefix := range specialNetworks {
		if prefix.Contains(ip) {
			return false
		}
	}
	return true
}

var specialNetworks = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"), netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("2001:db8::/32"),
}

// Statistics contains process-local counters and bounded resource gauges.
// Byte totals include completed streams; no destination or user labels are kept.
type Statistics struct {
	ActiveConnections      int
	BufferBudgetBytes      int
	Accepted               uint64
	Rejected               uint64
	CompletedUploadBytes   uint64
	CompletedDownloadBytes uint64
}

func (s *Server) Statistics() Statistics {
	s.mu.Lock()
	active := len(s.active)
	s.mu.Unlock()
	return Statistics{ActiveConnections: active, BufferBudgetBytes: active * (64 << 10), Accepted: s.accepted.Load(), Rejected: s.rejected.Load(), CompletedUploadBytes: s.uploadBytes.Load(), CompletedDownloadBytes: s.downloadBytes.Load()}
}
