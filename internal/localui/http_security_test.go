package localui

import (
	"bytes"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/accessgate"
)

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

	forwardedReq := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:24000/", nil)
	forwardedReq.Host = "127.0.0.1:24000"
	forwardedRes := httptest.NewRecorder()
	s.networkHandler().ServeHTTP(forwardedRes, forwardedReq)
	if forwardedRes.Code != http.StatusFound {
		t.Fatalf("forwarded loopback Host status = %d, want %d", forwardedRes.Code, http.StatusFound)
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
