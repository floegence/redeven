package localui

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/codeapp/appserver"
)

func mintDesktopBrowserHandoff(t *testing.T, s *Server, host, forwardID, appPath string) desktopBrowserHandoffMintResponse {
	t.Helper()
	body, err := json.Marshal(desktopBrowserHandoffMintRequest{ForwardID: forwardID, AppPath: appPath})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://"+host+desktopBrowserHandoffMintPath, bytes.NewReader(body))
	req.Host = host
	req.Header.Set(localDesktopBridgeTokenHeader, s.localUIBridgeToken)
	res := httptest.NewRecorder()
	s.HandlerForDesktopBridge().ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("mint status = %d, want %d; body=%q", res.Code, http.StatusOK, res.Body.String())
	}
	var response desktopBrowserHandoffMintResponse
	if err := json.Unmarshal(res.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode mint response: %v", err)
	}
	return response
}

func redeemDesktopBrowserHandoff(t *testing.T, s *Server, entryURL string) *httptest.ResponseRecorder {
	t.Helper()
	u, err := url.Parse(entryURL)
	if err != nil {
		t.Fatal(err)
	}
	u.Fragment = ""
	req := httptest.NewRequest(http.MethodGet, u.String(), nil)
	req.Host = u.Host
	res := httptest.NewRecorder()
	s.HandlerForDesktopBridge().ServeHTTP(res, req)
	return res
}

func TestDesktopBrowserHandoffMintsSingleUseBoundSession(t *testing.T) {
	t.Parallel()

	s := newTestServer(t, nil)
	s.localUIBridgeToken = "test-private-bridge-token"
	response := mintDesktopBrowserHandoff(t, s, "127.0.0.1:24000", "demo", "/docs?q=one%20two#section")
	entry, err := url.Parse(response.EntryURL)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Host != "pf-demo.localhost:24000" || entry.Path != "/docs" || entry.Fragment != "section" {
		t.Fatalf("unexpected entry URL %q", response.EntryURL)
	}
	if entry.Query().Get(desktopBrowserHandoffQueryName) == "" || entry.Query().Get("q") != "one two" {
		t.Fatalf("entry URL did not preserve application query: %q", response.EntryURL)
	}
	token := entry.Query().Get(desktopBrowserHandoffQueryName)
	pending := s.desktopBrowserHandoffs.pending[token]
	requestPath := entry.EscapedPath() + "?" + entry.RawQuery
	if pending.entryPath != requestPath {
		t.Fatalf("stored entry path = %q, request path = %q", pending.entryPath, requestPath)
	}
	if pending.authority != entry.Host || pending.forwardID != "demo" || !time.Now().Before(pending.expiresAt) {
		t.Fatalf("unexpected pending binding: %#v entryHost=%q", pending, entry.Host)
	}
	probeURL := *entry
	probeURL.Fragment = ""
	probeReq := httptest.NewRequest(http.MethodGet, probeURL.String(), nil)
	probeReq.Host = entry.Host
	probeToken, probePath, probePresent := desktopBrowserHandoffEntryPath(probeReq)
	probeAuthority, probeAuthorityOK := canonicalDesktopBridgePortForwardAuthority(probeReq.Host, "demo")
	if !probePresent || !probeAuthorityOK || probeToken != token || probePath != pending.entryPath || probeAuthority != pending.authority {
		t.Fatalf("redeem probe mismatch: token=%q path=%q authority=%q present=%v authorityOK=%v", probeToken, probePath, probeAuthority, probePresent, probeAuthorityOK)
	}

	redeem := redeemDesktopBrowserHandoff(t, s, response.EntryURL)
	if redeem.Code != http.StatusSeeOther {
		t.Fatalf("redeem status = %d, want %d; body=%q", redeem.Code, http.StatusSeeOther, redeem.Body.String())
	}
	if got := redeem.Header().Get("Location"); got != "/docs?q=one%20two#section" {
		t.Fatalf("redeem Location = %q, want clean application URL", got)
	}
	cookies := redeem.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("redeem cookies = %d, want 1", len(cookies))
	}
	cookie := cookies[0]
	if cookie.Name != appserver.LocalUIPortForwardBrowserSessionCookieName || cookie.Domain != "" || cookie.Path != "/" || !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("unexpected browser session cookie: %#v", cookie)
	}

	reuse := redeemDesktopBrowserHandoff(t, s, response.EntryURL)
	if reuse.Code != http.StatusUnauthorized {
		t.Fatalf("reused handoff status = %d, want %d", reuse.Code, http.StatusUnauthorized)
	}

	cleanReq := httptest.NewRequest(http.MethodGet, "http://pf-demo.localhost:24000/docs?q=one%20two", nil)
	cleanReq.Host = "pf-demo.localhost:24000"
	cleanReq.AddCookie(cookie)
	cleanRes := httptest.NewRecorder()
	s.HandlerForDesktopBridge().ServeHTTP(cleanRes, cleanReq)
	if cleanRes.Code == http.StatusUnauthorized {
		t.Fatalf("valid browser session was rejected: %q", cleanRes.Body.String())
	}

	for _, host := range []string{"pf-other.localhost:24000", "pf-demo.localhost:24001", "127.0.0.1:24000"} {
		req := httptest.NewRequest(http.MethodGet, "http://"+host+"/docs", nil)
		req.Host = host
		req.AddCookie(cookie)
		res := httptest.NewRecorder()
		s.HandlerForDesktopBridge().ServeHTTP(res, req)
		if res.Code != http.StatusUnauthorized {
			t.Fatalf("browser cookie at %q status = %d, want %d", host, res.Code, http.StatusUnauthorized)
		}
	}
}

func TestDesktopBrowserHandoffRejectsExpiredAndMismatchedEntries(t *testing.T) {
	t.Parallel()

	s := newTestServer(t, nil)
	s.localUIBridgeToken = "test-private-bridge-token"
	now := time.Unix(1_700_000_000, 0)
	s.desktopBrowserHandoffs.now = func() time.Time { return now }

	expired := mintDesktopBrowserHandoff(t, s, "127.0.0.1:24000", "demo", "/")
	now = now.Add(desktopBrowserHandoffTTL)
	if res := redeemDesktopBrowserHandoff(t, s, expired.EntryURL); res.Code != http.StatusUnauthorized {
		t.Fatalf("expired handoff status = %d, want %d", res.Code, http.StatusUnauthorized)
	}

	now = now.Add(time.Second)
	wrongPath := mintDesktopBrowserHandoff(t, s, "127.0.0.1:24000", "demo", "/expected")
	u, err := url.Parse(wrongPath.EntryURL)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/other"
	if res := redeemDesktopBrowserHandoff(t, s, u.String()); res.Code != http.StatusUnauthorized {
		t.Fatalf("path-mismatched handoff status = %d, want %d", res.Code, http.StatusUnauthorized)
	}

	wrongForward := mintDesktopBrowserHandoff(t, s, "127.0.0.1:24000", "demo", "/")
	u, err = url.Parse(wrongForward.EntryURL)
	if err != nil {
		t.Fatal(err)
	}
	u.Host = "pf-other.localhost:24000"
	if res := redeemDesktopBrowserHandoff(t, s, u.String()); res.Code != http.StatusUnauthorized {
		t.Fatalf("forward-mismatched handoff status = %d, want %d", res.Code, http.StatusUnauthorized)
	}
}

func TestDesktopBrowserHandoffReplacesCurrentForwardSession(t *testing.T) {
	t.Parallel()

	s := newTestServer(t, nil)
	s.localUIBridgeToken = "test-private-bridge-token"
	first := redeemDesktopBrowserHandoff(t, s, mintDesktopBrowserHandoff(t, s, "127.0.0.1:24000", "demo", "/").EntryURL)
	second := redeemDesktopBrowserHandoff(t, s, mintDesktopBrowserHandoff(t, s, "127.0.0.1:24000", "demo", "/").EntryURL)
	firstCookie := first.Result().Cookies()[0]
	secondCookie := second.Result().Cookies()[0]

	for _, test := range []struct {
		name       string
		cookie     *http.Cookie
		wantDenied bool
	}{
		{name: "replaced", cookie: firstCookie, wantDenied: true},
		{name: "current", cookie: secondCookie, wantDenied: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "http://pf-demo.localhost:24000/", nil)
			req.Host = "pf-demo.localhost:24000"
			req.AddCookie(test.cookie)
			res := httptest.NewRecorder()
			s.HandlerForDesktopBridge().ServeHTTP(res, req)
			if gotDenied := res.Code == http.StatusUnauthorized; gotDenied != test.wantDenied {
				t.Fatalf("status = %d, wantDenied=%v", res.Code, test.wantDenied)
			}
		})
	}
}

func TestDesktopBrowserSessionExpiresInMemory(t *testing.T) {
	t.Parallel()

	s := newTestServer(t, nil)
	s.localUIBridgeToken = "test-private-bridge-token"
	now := time.Unix(1_700_000_000, 0)
	s.desktopBrowserHandoffs.now = func() time.Time { return now }
	redeem := redeemDesktopBrowserHandoff(t, s, mintDesktopBrowserHandoff(t, s, "127.0.0.1:24000", "demo", "/").EntryURL)
	cookie := redeem.Result().Cookies()[0]
	now = now.Add(desktopBrowserSessionTTL)

	req := httptest.NewRequest(http.MethodGet, "http://pf-demo.localhost:24000/", nil)
	req.Host = "pf-demo.localhost:24000"
	req.AddCookie(cookie)
	res := httptest.NewRecorder()
	s.HandlerForDesktopBridge().ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("expired browser session status = %d, want %d", res.Code, http.StatusUnauthorized)
	}
}

func TestDesktopBrowserHandoffMintRequiresPrivateBridgeHeader(t *testing.T) {
	t.Parallel()

	s := newTestServer(t, nil)
	s.localUIBridgeToken = "test-private-bridge-token"
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000"+desktopBrowserHandoffMintPath, bytes.NewBufferString(`{"forward_id":"demo","app_path":"/"}`))
	req.Host = "127.0.0.1:24000"
	res := httptest.NewRecorder()
	s.HandlerForDesktopBridge().ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized mint status = %d, want %d", res.Code, http.StatusUnauthorized)
	}
}

func TestDesktopBrowserHandoffStoreBoundsInMemoryState(t *testing.T) {
	t.Parallel()

	now := time.Unix(1_700_000_000, 0)
	store := desktopBrowserHandoffStore{now: func() time.Time { return now }}
	firstPendingToken := ""
	for index := 0; index <= desktopBrowserPendingLimit; index++ {
		response, err := store.mint("127.0.0.1:24000", "demo", "/")
		if err != nil {
			t.Fatal(err)
		}
		entry, err := url.Parse(response.EntryURL)
		if err != nil {
			t.Fatal(err)
		}
		if index == 0 {
			firstPendingToken = entry.Query().Get(desktopBrowserHandoffQueryName)
		}
		now = now.Add(time.Millisecond)
	}
	if len(store.pending) != desktopBrowserPendingLimit {
		t.Fatalf("pending handoffs = %d, want %d", len(store.pending), desktopBrowserPendingLimit)
	}
	if _, exists := store.pending[firstPendingToken]; exists {
		t.Fatal("oldest pending handoff was not evicted")
	}

	store.reset()
	for index := 0; index <= desktopBrowserSessionLimit; index++ {
		forwardID := "demo-" + strconv.Itoa(index)
		response, err := store.mint("127.0.0.1:24000", forwardID, "/")
		if err != nil {
			t.Fatal(err)
		}
		entry, err := url.Parse(response.EntryURL)
		if err != nil {
			t.Fatal(err)
		}
		token := entry.Query().Get(desktopBrowserHandoffQueryName)
		if _, _, ok := store.redeem(entry.Host, forwardID, token, entry.RequestURI()); !ok {
			t.Fatalf("redeem %q failed", forwardID)
		}
		now = now.Add(time.Millisecond)
	}
	if len(store.sessions) != desktopBrowserSessionLimit {
		t.Fatalf("browser sessions = %d, want %d", len(store.sessions), desktopBrowserSessionLimit)
	}
	if _, exists := store.sessions[desktopBrowserSessionKey("pf-demo-0.localhost:24000", "demo-0")]; exists {
		t.Fatal("oldest browser session was not evicted")
	}
}
