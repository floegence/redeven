package localui

import (
	"bytes"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/runtimemanagement"
)

type authorityTestListener struct {
	addr net.Addr
}

func (l authorityTestListener) Accept() (net.Conn, error) { return nil, errors.New("not implemented") }
func (l authorityTestListener) Close() error              { return nil }
func (l authorityTestListener) Addr() net.Addr            { return l.addr }

func TestCanonicalLoopbackAuthority(t *testing.T) {
	t.Parallel()

	accepted := map[string]string{
		"localhost:23998":  "localhost:23998",
		"LOCALHOST:23998":  "localhost:23998",
		"127.42.0.9:23998": "127.42.0.9:23998",
		"[::1]:23998":      "[::1]:23998",
	}
	for raw, want := range accepted {
		got, err := canonicalLoopbackAuthority(raw)
		if err != nil || got != want {
			t.Fatalf("canonicalLoopbackAuthority(%q) = %q, %v; want %q", raw, got, err, want)
		}
	}

	for _, raw := range []string{
		"evil.example:23998",
		"localhost.example:23998",
		"127.1:23998",
		"127.0.00.1:23998",
		"2130706433:23998",
		"127.0.0.1:023998",
		"user@127.0.0.1:23998",
		"[::1%lo0]:23998",
		"[::ffff:127.0.0.1]:23998",
		"192.168.1.10:23998",
	} {
		if got, err := canonicalLoopbackAuthority(raw); err == nil {
			t.Fatalf("canonicalLoopbackAuthority(%q) = %q, want rejection", raw, got)
		}
	}
}

func TestCanonicalLocalUIAuthorityAcceptsNetworkLiterals(t *testing.T) {
	t.Parallel()

	for raw, want := range map[string]string{
		"192.168.1.10:23998":  "192.168.1.10:23998",
		"[2001:db8::1]:23998": "[2001:db8::1]:23998",
	} {
		got, err := canonicalLocalUIAuthority(raw)
		if err != nil || got != want {
			t.Fatalf("canonicalLocalUIAuthority(%q) = %q, %v; want %q", raw, got, err, want)
		}
	}
	for _, raw := range []string{"evil.example:23998", "0.0.0.0:23998", "[::]:23998", "[fe80::1]:23998"} {
		if _, err := canonicalLocalUIAuthority(raw); err == nil {
			t.Fatalf("canonicalLocalUIAuthority(%q) unexpectedly succeeded", raw)
		}
	}
}

func TestNetworkHandlerRejectsDNSRebindingBeforeRouting(t *testing.T) {
	t.Parallel()

	s := newTestServer(t, nil)
	s.networkAuthorities = map[string]struct{}{
		"localhost:23998": {},
		"127.0.0.1:23998": {},
		"[::1]:23998":     {},
	}

	for _, host := range []string{"evil.example:23998", "localhost.example:23998", "127.1:23998"} {
		req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:23998/", nil)
		req.Host = host
		res := httptest.NewRecorder()
		s.networkHandler().ServeHTTP(res, req)
		if res.Code != http.StatusMisdirectedRequest {
			t.Fatalf("Host %q status = %d, want %d", host, res.Code, http.StatusMisdirectedRequest)
		}
	}

	wrongPortReq := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:24000/", nil)
	wrongPortReq.Host = "127.0.0.1:24000"
	wrongPortRes := httptest.NewRecorder()
	s.networkHandler().ServeHTTP(wrongPortRes, wrongPortReq)
	if wrongPortRes.Code != http.StatusMisdirectedRequest {
		t.Fatalf("wrong-port Host status = %d, want %d", wrongPortRes.Code, http.StatusMisdirectedRequest)
	}

	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:23998/", nil)
	req.Host = "localhost:23998"
	res := httptest.NewRecorder()
	s.networkHandler().ServeHTTP(res, req)
	if res.Code != http.StatusFound {
		t.Fatalf("allowed Host status = %d, want %d", res.Code, http.StatusFound)
	}
	for _, name := range []string{"Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy", "X-Frame-Options"} {
		if value := res.Header().Get(name); value == "" {
			t.Fatalf("missing security header %s", name)
		}
	}
}

func TestDesktopBridgeAcceptsOnlyLoopbackAuthority(t *testing.T) {
	t.Parallel()

	s := newTestServer(t, nil)
	for _, host := range []string{"localhost:24000", "127.0.0.1:24000", "[::1]:24000"} {
		req := httptest.NewRequest(http.MethodGet, "http://localhost:24000/", nil)
		req.Host = host
		res := httptest.NewRecorder()
		s.HandlerForDesktopBridge().ServeHTTP(res, req)
		if res.Code != http.StatusFound {
			t.Fatalf("bridge Host %q status = %d, want %d", host, res.Code, http.StatusFound)
		}
	}
	for _, host := range []string{"192.168.1.10:23998", "evil.example:23998"} {
		req := httptest.NewRequest(http.MethodGet, "http://localhost:24000/", nil)
		req.Host = host
		res := httptest.NewRecorder()
		s.HandlerForDesktopBridge().ServeHTTP(res, req)
		if res.Code != http.StatusMisdirectedRequest {
			t.Fatalf("bridge Host %q status = %d, want %d", host, res.Code, http.StatusMisdirectedRequest)
		}
	}
}

func TestConfigureNetworkAuthoritiesUsesResolvedWildcardHosts(t *testing.T) {
	t.Parallel()

	bind, err := ParseBind("0.0.0.0:23998")
	if err != nil {
		t.Fatal(err)
	}
	s := newTestServer(t, accessgate.New(accessgate.Options{Password: "secret"}))
	s.bind = bind
	s.exposure = runtimemanagement.NewLocalUIExposure(true, true)
	s.resolveAccessHosts = func(BindSpec) ([]netip.Addr, error) {
		return []netip.Addr{
			netip.MustParseAddr("10.0.0.8"),
			netip.MustParseAddr("192.168.1.20"),
		}, nil
	}
	listener := authorityTestListener{addr: &net.TCPAddr{IP: net.IPv4zero, Port: 23998}}
	if err := s.configureNetworkAuthorities([]net.Listener{listener}); err != nil {
		t.Fatalf("configureNetworkAuthorities() error = %v", err)
	}
	if got, want := s.DisplayURLs(), []string{"http://10.0.0.8:23998/", "http://192.168.1.20:23998/"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("DisplayURLs() = %#v, want %#v", got, want)
	}
	for _, host := range []string{"10.0.0.8:23998", "192.168.1.20:23998"} {
		if !s.isAllowedNetworkAuthority(host) {
			t.Fatalf("resolved Host %q was rejected", host)
		}
	}
	for _, host := range []string{"0.0.0.0:23998", "localhost:23998", "redeven.local:23998"} {
		if s.isAllowedNetworkAuthority(host) {
			t.Fatalf("Host %q was unexpectedly accepted", host)
		}
	}
}

func TestStrictSameOriginWSRequest(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:23998/_redeven_direct/ws", nil)
	req.Host = "127.0.0.1:23998"
	for _, origin := range []string{"http://evil.example", "http://localhost:23998", "https://127.0.0.1:23998", "http://127.0.0.1:23998/path"} {
		req.Header.Set("Origin", origin)
		if strictSameOriginWSRequest(req, true) {
			t.Fatalf("Origin %q unexpectedly accepted", origin)
		}
	}
	req.Header.Set("Origin", "http://127.0.0.1:23998")
	if !strictSameOriginWSRequest(req, true) {
		t.Fatal("exact loopback Origin was rejected")
	}
	req.Header.Del("Origin")
	if strictSameOriginWSRequest(req, true) {
		t.Fatal("browser websocket request without Origin was accepted")
	}
	if !strictSameOriginWSRequest(req, false) {
		t.Fatal("authenticated non-browser websocket request without Origin was rejected")
	}

	networkReq := httptest.NewRequest(http.MethodGet, "http://192.168.1.10:23998/_redeven_direct/ws", nil)
	networkReq.Host = "192.168.1.10:23998"
	networkReq.Header.Set("Origin", "http://192.168.1.10:23998")
	if !strictSameOriginWSRequest(networkReq, true) {
		t.Fatal("exact network Origin was rejected")
	}
}

func TestSecurityHeadersDoNotWeakenExistingPolicy(t *testing.T) {
	t.Parallel()

	handler := withLocalUISecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'none'")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.WriteHeader(http.StatusNoContent)
	}))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "http://localhost:23998/", nil))
	if got := res.Header().Get("Content-Security-Policy"); got != "default-src 'none'" {
		t.Fatalf("Content-Security-Policy = %q", got)
	}
	if got := res.Header().Get("Referrer-Policy"); got != "same-origin" {
		t.Fatalf("Referrer-Policy = %q", got)
	}
	if got := res.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q", got)
	}
}

func TestPendingCredentialCommitsExactlyOnce(t *testing.T) {
	t.Parallel()

	s := &Server{pending: make(map[string]pendingDirect)}
	p := pendingDirect{initExpireAtUnixS: time.Now().Add(time.Minute).Unix(), connectArtifactIssuedAtMs: time.Now().UnixMilli()}
	p.psk[0] = 1
	s.pending["channel"] = p
	resolved, ok := s.resolvePending("channel")
	if !ok {
		t.Fatal("resolvePending() rejected a valid credential")
	}

	var successes atomic.Int32
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if s.commitPending("channel", resolved) == nil {
				successes.Add(1)
			}
		}()
	}
	wg.Wait()
	if got := successes.Load(); got != 1 {
		t.Fatalf("successful commits = %d, want 1", got)
	}
	if _, ok := s.resolvePending("channel"); ok {
		t.Fatal("committed credential remained available")
	}
}

func TestOversizedUnlockBodyIsRejected(t *testing.T) {
	t.Parallel()

	s := newTestServer(t, accessgate.New(accessgate.Options{Password: "secret"}))
	body := append([]byte(`{"password":"`), bytes.Repeat([]byte("x"), int(localUIJSONBodyLimit))...)
	body = append(body, []byte(`"}`)...)
	req := httptest.NewRequest(http.MethodPost, "http://localhost:23998/api/local/access/unlock", bytes.NewReader(body))
	res := httptest.NewRecorder()
	s.handler().ServeHTTP(res, req)
	if res.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusRequestEntityTooLarge)
	}
}

func TestStartOnListenersRejectsNonLoopbackListener(t *testing.T) {
	listener, err := net.Listen("tcp4", "0.0.0.0:0")
	if err != nil {
		t.Fatalf("net.Listen() error = %v", err)
	}
	defer listener.Close()

	s := newTestServer(t, nil)
	if err := s.StartOnListeners(t.Context(), []net.Listener{listener}, nil); err == nil {
		t.Fatal("StartOnListeners() accepted a non-loopback listener")
	}
}
