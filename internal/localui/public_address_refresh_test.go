package localui

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/runtimemanagement"
)

func TestNetworkAddressesFollowInterfaceChangesWithoutRestart(t *testing.T) {
	listener, err := net.Listen("tcp4", "0.0.0.0:0")
	if err != nil {
		t.Fatal(err)
	}
	s := newTestServer(t, accessgate.New(accessgate.Options{Password: "shared-secret"}))
	s.bind, _ = ParseBind(listener.Addr().String())
	s.protocol = "http"
	s.a = newRuntimeHealthTestAgent(t, s.configPath, s.accessGate)
	var addresses atomic.Value
	addresses.Store([]netip.Addr{netip.MustParseAddr("192.168.100.118")})
	s.resolveAccessHosts = func(BindSpec) ([]netip.Addr, error) { return addresses.Load().([]netip.Addr), nil }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := s.StartOnListeners(ctx, []net.Listener{listener}, nil); err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	port := s.Port()
	oldURL, newURL := formatHTTPURL("192.168.100.118", port), formatHTTPURL("192.168.50.22", port)
	if !slices.Contains(s.DisplayURLs(), oldURL) {
		t.Fatal("initial network address missing")
	}
	addresses.Store([]netip.Addr{netip.MustParseAddr("192.168.50.22")})
	deadline := time.Now().Add(3 * time.Second)
	for !slices.Contains(s.DisplayURLs(), newURL) && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if urls := s.DisplayURLs(); !slices.Contains(urls, newURL) || slices.Contains(urls, oldURL) {
		t.Fatalf("network switch retained startup addresses: %v", urls)
	}
	for _, item := range []struct {
		url     string
		allowed bool
	}{{oldURL, false}, {newURL, true}} {
		req := httptest.NewRequest(http.MethodGet, item.url, nil)
		req.Header.Set("Origin", item.url[:len(item.url)-1])
		if s.isAllowedPublicAuthority(req.Host) != item.allowed || s.authorizePublicWebSocketRequest(req) != item.allowed {
			t.Fatalf("HTTP and WebSocket admission do not follow current address %s", item.url)
		}
	}
}

func TestPublicAddressRefreshRemovesUnavailableAddressesAndRecovers(t *testing.T) {
	for _, tc := range []struct{ bind, first, next string }{
		{"0.0.0.0:23998", "192.168.100.118", "192.168.50.22"},
		{"[::]:23998", "2001:db8::10", "2001:db8::20"},
		{"192.168.100.118:23998", "192.168.100.118", "192.168.50.22"},
	} {
		t.Run(tc.bind, func(t *testing.T) {
			s := newTestServer(t, nil)
			s.protocol = "http"
			s.bind, _ = ParseBind(tc.bind)
			addresses := []netip.Addr{netip.MustParseAddr(tc.first)}
			var scanErr error
			s.resolveAccessHosts = func(BindSpec) ([]netip.Addr, error) { return addresses, scanErr }
			listener := authorityTestListener{addr: &net.TCPAddr{IP: net.ParseIP(s.bind.Host()), Port: s.bind.Port()}}
			if err := s.prepareNetwork([]net.Listener{listener}); err != nil {
				t.Fatal(err)
			}
			addresses = []netip.Addr{netip.MustParseAddr(tc.next)}
			s.refreshPublicAccess()
			if s.isAllowedPublicAuthority(net.JoinHostPort(tc.first, "23998")) {
				t.Fatal("removed IP remains admitted")
			}
			if s.bind.IsWildcard() {
				if !s.isAllowedPublicAuthority(net.JoinHostPort(tc.next, "23998")) {
					t.Fatal("new IP is not admitted")
				}
			} else {
				if len(s.DisplayURLs()) != 0 || s.publicAccessSnapshot().issues[0].Code != runtimemanagement.LocalUIBoundAddressUnavailable {
					t.Fatal("fixed bind silently changed")
				}
			}
			addresses = nil
			s.refreshPublicAccess()
			if s.isAllowedPublicAuthority(net.JoinHostPort(tc.next, "23998")) {
				t.Fatal("disconnected IP remains admitted")
			}
			scanErr = errors.New("interface enumeration unavailable")
			s.refreshPublicAccess()
			if s.publicAccessSnapshot().issues[0].Code != runtimemanagement.LocalUIInterfaceScanFailed {
				t.Fatal("scan failure not reported")
			}
			if s.bind.IsWildcard() && !s.isAllowedPublicAuthority("localhost:23998") {
				t.Fatal("scan failure lost local access")
			}
			addresses, scanErr = []netip.Addr{netip.MustParseAddr(tc.first)}, nil
			s.refreshPublicAccess()
			if !s.isAllowedPublicAuthority(net.JoinHostPort(tc.first, "23998")) || len(s.publicAccessSnapshot().issues) != 0 {
				t.Fatal("address recovery failed")
			}
			s.stopPublicAddressRefresh()
			addresses = nil
			s.refreshPublicAccess()
			if !s.isAllowedPublicAuthority(net.JoinHostPort(tc.first, "23998")) {
				t.Fatal("refresh published after cancellation")
			}
		})
	}
}

func TestHTTPSAddressRefreshKeepsCAAndRecoversCertificateFailure(t *testing.T) {
	s := newTestServer(t, nil)
	s.bind, _ = ParseBind("0.0.0.0:23998")
	addresses := []netip.Addr{netip.MustParseAddr("192.168.100.118")}
	s.resolveAccessHosts = func(BindSpec) ([]netip.Addr, error) { return addresses, nil }
	if err := s.prepareNetwork([]net.Listener{authorityTestListener{addr: &net.TCPAddr{IP: net.IPv4zero, Port: 23998}}}); err != nil {
		t.Fatal(err)
	}
	ca := s.deviceCA
	initial := s.publicAccessSnapshot().certificate
	addresses = []netip.Addr{netip.MustParseAddr("192.168.50.22")}
	s.signAccessCertificate = func(*deviceCA, []string) (tls.Certificate, string, error) {
		return tls.Certificate{}, "", errors.New("signing failed")
	}
	s.refreshPublicAccess()
	if s.isAllowedPublicAuthority("192.168.100.118:23998") || s.isAllowedPublicAuthority("192.168.50.22:23998") {
		t.Fatal("failed signing retained or added network authority")
	}
	if !s.isAllowedPublicAuthority("localhost:23998") || s.publicAccessSnapshot().issues[0].Code != runtimemanagement.LocalUICertificateRefreshFailed {
		t.Fatal("certificate failure lost loopback or diagnosis")
	}
	s.signAccessCertificate = nil
	s.refreshPublicAccess()
	current, err := s.tlsConfig.GetCertificate(&tls.ClientHelloInfo{})
	if err != nil {
		t.Fatal(err)
	}
	if current == initial || s.deviceCA != ca || len(s.publicAccessSnapshot().issues) != 0 {
		t.Fatal("certificate recovery changed identity or retained a stale leaf")
	}
	leaf, err := x509.ParseCertificate(current.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(ca.certificate)
	if _, err := leaf.Verify(x509.VerifyOptions{Roots: roots, DNSName: "192.168.50.22"}); err != nil {
		t.Fatalf("new address certificate does not verify under original CA: %v", err)
	}
	if leaf.VerifyHostname("192.168.100.118") == nil {
		t.Fatal("new leaf retains removed IP")
	}
	s.refreshPublicAccess()
	if s.publicAccessSnapshot().certificate != current {
		t.Fatal("unchanged addresses regenerated certificate")
	}
}

func TestImportedCertificateRefreshExcludesUncoveredAddresses(t *testing.T) {
	s := newTestServer(t, nil)
	s.bind, _ = ParseBind("0.0.0.0:23998")
	input := importedIdentityFixture(t, func(c *x509.Certificate) { c.IPAddresses = append(c.IPAddresses, net.ParseIP("192.168.100.118")) })
	var err error
	s.deviceCA, err = parseImportedServerCertificate([]byte(input.CertificatePEM), []byte(input.PrivateKeyPEM))
	if err != nil {
		t.Fatal(err)
	}
	addresses := []netip.Addr{netip.MustParseAddr("192.168.100.118")}
	s.resolveAccessHosts = func(BindSpec) ([]netip.Addr, error) { return addresses, nil }
	if err := s.prepareNetwork([]net.Listener{authorityTestListener{addr: &net.TCPAddr{IP: net.IPv4zero, Port: 23998}}}); err != nil {
		t.Fatal(err)
	}
	certificate := s.publicAccessSnapshot().certificate
	addresses = append(addresses, netip.MustParseAddr("192.168.50.22"))
	s.refreshPublicAccess()
	access := s.publicAccessSnapshot()
	if access.certificate != certificate || !s.isAllowedPublicAuthority("192.168.100.118:23998") || s.isAllowedPublicAuthority("192.168.50.22:23998") {
		t.Fatal("imported certificate was replaced or uncovered address was admitted")
	}
	if len(access.issues) != 1 || access.issues[0].Code != runtimemanagement.LocalUICertificateHostsNotCovered || !slices.Equal(access.issues[0].Hosts, []string{"192.168.50.22"}) {
		t.Fatalf("missing certificate coverage diagnosis: %+v", access.issues)
	}
	addresses = addresses[:1]
	s.refreshPublicAccess()
	if len(s.publicAccessSnapshot().issues) != 0 {
		t.Fatal("recovered coverage retained issue")
	}
}

// The OS owns routing; inject only the interface inventory to exercise the real
// listener, TLS handshake and authenticated WSS session without changing the host network.
func TestHTTPSNetworkChangeEstablishesNewSessionAndKeepsExistingSession(t *testing.T) {
	bind, _ := ParseBind("0.0.0.0:23998")
	available, err := resolveNetworkAccessHosts(bind)
	if err != nil || len(available) == 0 {
		t.Skip("requires an assigned IPv4 network address")
	}
	listener, err := net.Listen("tcp4", "0.0.0.0:0")
	if err != nil {
		t.Fatal(err)
	}
	s := newTestServer(t, nil)
	s.bind, _ = ParseBind(listener.Addr().String())
	s.a = newRuntimeHealthTestAgent(t, s.configPath, s.accessGate)
	var inventory atomic.Value
	inventory.Store([]netip.Addr{})
	s.resolveAccessHosts = func(BindSpec) ([]netip.Addr, error) { return inventory.Load().([]netip.Addr), nil }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := s.StartOnListeners(ctx, []net.Listener{listener}, nil); err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	roots := x509.NewCertPool()
	roots.AddCert(s.deviceCA.certificate)
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: roots}}, Timeout: 5 * time.Second}
	defer client.CloseIdleConnections()
	connect := func(host string) flowersec.Session {
		t.Helper()
		origin := "https://" + net.JoinHostPort(host, fmt.Sprint(s.Port()))
		response, err := client.Post(origin+"/api/local/direct/connect_artifact", "application/json", bytes.NewBufferString(`{}`))
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(response.Body)
			t.Fatalf("mint: %d %s", response.StatusCode, body)
		}
		var envelope connectArtifactEnvelope
		if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
			t.Fatal(err)
		}
		artifact, err := flowersec.ParseArtifact(envelope.ConnectArtifact)
		if err != nil {
			t.Fatal(err)
		}
		lease, err := flowersec.NewArtifactLease(artifact, func(context.Context) error { return nil })
		if err != nil {
			t.Fatal(err)
		}
		session, err := flowersec.Connect(ctx, lease, flowersec.ConnectorOptions{TrustRoots: roots, Origin: origin, ConnectTimeout: 3 * time.Second})
		if err != nil {
			t.Fatalf("new address WSS session: %v", err)
		}
		return session
	}
	existing := connect("localhost")
	defer existing.Close()
	inventory.Store(available)
	s.refreshPublicAccess()
	current := connect(available[0].String())
	defer current.Close()
	for _, session := range []flowersec.Session{existing, current} {
		probeCtx, probeCancel := context.WithTimeout(ctx, 3*time.Second)
		_, err := session.ProbeLiveness(probeCtx)
		probeCancel()
		if err != nil {
			t.Fatalf("session interrupted by address refresh: %v", err)
		}
	}
	inventory.Store([]netip.Addr{})
	s.refreshPublicAccess()
	// A fresh TLS connection rejects the retired IP at certificate validation.
	client.CloseIdleConnections()
	if response, err := client.Get("https://" + net.JoinHostPort(available[0].String(), fmt.Sprint(s.Port())) + "/"); err == nil {
		response.Body.Close()
		t.Fatal("removed IP remains reachable over new TLS connection")
	}
	for _, url := range s.DisplayURLs() {
		if strings.Contains(url, available[0].String()) {
			t.Fatal("removed IP remains advertised")
		}
	}
	probeCtx, probeCancel := context.WithTimeout(ctx, 3*time.Second)
	defer probeCancel()
	if _, err := current.ProbeLiveness(probeCtx); err != nil {
		t.Fatalf("existing WSS connection closed on removal: %v", err)
	}
}

func TestAddressReportsShareAuthoritativeEmptySnapshot(t *testing.T) {
	s := newTestServer(t, nil)
	s.protocol = "http"
	s.bind, _ = ParseBind("192.0.2.10:23998")
	s.a = newRuntimeHealthTestAgent(t, s.configPath, s.accessGate)
	s.resolveAccessHosts = func(BindSpec) ([]netip.Addr, error) { return nil, nil }
	if err := s.prepareNetwork([]net.Listener{authorityTestListener{addr: &net.TCPAddr{IP: net.ParseIP("192.0.2.10"), Port: 23998}}}); err != nil {
		t.Fatal(err)
	}
	s.refreshPublicAccess()
	response := httptest.NewRecorder()
	s.handleRuntimeHealth(response, httptest.NewRequest(http.MethodGet, "http://localhost/api/local/runtime/health", nil))
	var health struct {
		Data runtimeHealthResp `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &health); err != nil {
		t.Fatal(err)
	}
	attach := s.RuntimeAttachStatus().Endpoint
	if !bytes.Contains(response.Body.Bytes(), []byte(`"local_ui_urls":[]`)) || health.Data.LocalUIURL != "" || len(attach.LocalUIURLs) != 0 || attach.LocalUIURL != "" {
		t.Fatalf("stale or absent public list: %s %+v", response.Body, attach)
	}
	if len(health.Data.LocalUIAddressIssues) != 1 || !slices.EqualFunc(health.Data.LocalUIAddressIssues, attach.LocalUIAddressIssues, func(a, b runtimemanagement.LocalUIAddressIssue) bool {
		return a.Code == b.Code && slices.Equal(a.Hosts, b.Hosts)
	}) {
		t.Fatal("health and attach disagree about address diagnosis")
	}
}

func TestPublicAddressRefreshCloseWaitsAndNeverRepublishes(t *testing.T) {
	s := newTestServer(t, nil)
	s.protocol = "http"
	s.bind, _ = ParseBind("0.0.0.0:23998")
	s.resolveAccessHosts = func(BindSpec) ([]netip.Addr, error) { return []netip.Addr{netip.MustParseAddr("192.0.2.10")}, nil }
	if err := s.prepareNetwork([]net.Listener{authorityTestListener{addr: &net.TCPAddr{IP: net.IPv4zero, Port: 23998}}}); err != nil {
		t.Fatal(err)
	}
	entered, release, refreshed, closed := make(chan struct{}), make(chan struct{}), make(chan struct{}), make(chan struct{})
	s.resolveAccessHosts = func(BindSpec) ([]netip.Addr, error) {
		close(entered)
		<-release
		return []netip.Addr{netip.MustParseAddr("192.0.2.20")}, nil
	}
	go func() { s.refreshPublicAccess(); close(refreshed) }()
	<-entered
	go func() { _ = s.Close(); close(closed) }()
	select {
	case <-closed:
		t.Fatal("Close returned while refresh was active")
	default:
	}
	close(release)
	<-refreshed
	<-closed
	s.refreshPublicAccess()
	if len(s.DisplayURLs()) != 0 || s.isAllowedPublicAuthority("192.0.2.20:23998") {
		t.Fatal("refresh republished addresses after Close")
	}
}
