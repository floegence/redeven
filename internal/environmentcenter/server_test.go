package environmentcenter

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func requestCenter(t *testing.T, s *Server, method, path, origin, body string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, "https://center.example.test"+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Redeven-Center", "1")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	out := httptest.NewRecorder()
	s.ServeHTTP(out, req)
	return out
}
func TestPublicCenterAdmissionAndOriginChecks(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	server := NewServer(c, nil)
	defer server.Close()
	for _, path := range []string{"directory", "devices", "security", "catalog", "binding", "audit"} {
		response := requestCenter(t, server, "GET", "/api/center/v1/"+path, "", " ")
		if response.Code != 403 {
			t.Fatalf("%s: %d", path, response.Code)
		}
	}
	result := loginRecovery(t, c, "browser", codes[0])
	cookie := &http.Cookie{Name: sessionCookie, Value: result.Token}
	if response := requestCenter(t, server, "GET", "/api/center/v1/directory", "", "", cookie); response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	for _, origin := range []string{"", "https://evil.example.test", "null"} {
		response := requestCenter(t, server, "POST", "/api/center/v1/devices/revoke", origin, "{}", cookie)
		if response.Code != 403 {
			t.Fatalf("origin %q: %d", origin, response.Code)
		}
	}
	response := requestCenter(t, server, "GET", "/api/center/v1/status", "", "")
	for _, cookie := range response.Result().Cookies() {
		if !cookie.HttpOnly || !cookie.Secure || cookie.Domain != "" || cookie.Path != "/" {
			t.Fatal("unsafe cookie")
		}
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("authentication cached")
	}
}
func TestPasswordOnlyAndCrossBrowserChallengesHaveNoAuthority(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	s := NewServer(c, nil)
	defer s.Close()
	browser := &http.Cookie{Name: browserCookie, Value: randomID()}
	raw, _ := json.Marshal(Authentication{Password: testPassword})
	r := requestCenter(t, s, "POST", "/api/center/v1/authenticate", c.key.Origin, string(raw), browser)
	var reply struct {
		Data AuthenticationResult `json:"data"`
	}
	if json.Unmarshal(r.Body.Bytes(), &reply) != nil || reply.Data.Challenge == "" {
		t.Fatal(r.Body.String())
	}
	for _, cookie := range r.Result().Cookies() {
		if cookie.Name == sessionCookie {
			t.Fatal("password-only session issued")
		}
	}
	raw, _ = json.Marshal(Authentication{Challenge: reply.Data.Challenge, Recovery: codes[0]})
	r = requestCenter(t, s, "POST", "/api/center/v1/authenticate", c.key.Origin, string(raw), &http.Cookie{Name: browserCookie, Value: randomID()})
	if r.Code != 403 {
		t.Fatal("cross-browser challenge accepted")
	}
	r = requestCenter(t, s, "POST", "/api/center/v1/authenticate", c.key.Origin, string(raw), browser)
	if r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	found := false
	for _, cookie := range r.Result().Cookies() {
		found = found || cookie.Name == sessionCookie
	}
	if !found {
		t.Fatal("complete login missing cookie")
	}
}

func TestGatewayPairingRejectsUnapprovedDestinationBeforeNetwork(t *testing.T) {
	var requests atomic.Int32
	target := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { requests.Add(1) }))
	defer target.Close()
	c, _, _, codes := configuredCenter(t)
	s := NewServer(c, nil)
	defer s.Close()
	login := loginRecovery(t, c, "gateway-browser", codes[0])
	grant := randomID()
	action := actionDigest("gateway:add", struct {
		URL      string `json:"url"`
		Name     string `json:"name"`
		CodeHash string `json:"code_hash"`
	}{"https://approved.example.test", "Gateway", digest("pairing-code")})
	c.mu.Lock()
	c.grants[digest(grant)] = &actionGrant{Session: login.Token, Action: action, Revision: c.state.Revision, Expires: c.now().Add(GrantLifetime)}
	c.mu.Unlock()
	body, _ := json.Marshal(BeginPairRequest{URL: target.URL, Name: "Gateway", AccessCode: "pairing-code", Grant: grant})
	for _, cookies := range [][]*http.Cookie{nil, {{Name: sessionCookie, Value: login.Token}}} {
		response := requestCenter(t, s, "POST", "/api/center/v1/gateways/begin", c.key.Origin, string(body), cookies...)
		if response.Code != http.StatusForbidden {
			t.Fatalf("unapproved gateway accepted: %d", response.Code)
		}
	}
	if requests.Load() != 0 {
		t.Fatal("unauthorized pairing contacted a network destination")
	}
}
func TestOwnerSocketRequiresActualUnixPeer(t *testing.T) {
	dir, err := os.MkdirTemp("/tmp", "redeven-center-owner-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	c, err := Open(dir, "https://center.example.test")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- c.ServeOwner(ctx, dir) }()
	path := filepath.Join(dir, "owner.sock")
	deadline := time.Now().Add(3 * time.Second)
	for {
		if _, err := os.Lstat(path); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("socket not ready")
		}
		time.Sleep(10 * time.Millisecond)
	}
	client := &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", path)
	}}}
	defer client.CloseIdleConnections()
	response, err := client.Post("http://owner/owner/setup", "application/json", bytes.NewBufferString(`{"action":"setup"}`))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 200 || !bytes.Contains(raw, []byte("setup_token")) {
		t.Fatal(string(raw))
	}
	request, _ := http.NewRequest("POST", "http://owner/owner/setup", strings.NewReader(`{"action":"recover"}`))
	request.Header.Set("Origin", "https://center.example.test")
	response, err = client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal("browser header accepted by owner")
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
func TestSameSiteRequiresSeparateExplicitOrigins(t *testing.T) {
	for _, candidate := range []string{"https://center.example.test", "https://environment.evil.test", "http://env.example.test", "https://env.example.test:8443"} {
		if sameSite("https://center.example.test", candidate) {
			t.Fatal(candidate)
		}
	}
	if !sameSite("https://center.example.test", "https://env.example.test") {
		t.Fatal("same-site env rejected")
	}
}

func TestSensitiveMutationRetryReturnsOneResult(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	login := loginRecovery(t, c, "browser", codes[0])
	input := BookmarkInput{Name: "Direct", URL: "https://runtime.example.test/", ExpectedRevision: c.state.DirectoryRevision}
	action := actionDigest("bookmark:add", input)
	first, err := c.Authenticate("browser", login.Token, "source", "Browser", Authentication{Password: testPassword, Action: action})
	if err != nil {
		t.Fatal(err)
	}
	second, err := c.Authenticate("browser", login.Token, "source", "Browser", Authentication{Challenge: first.Challenge, Recovery: codes[1], Action: action})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(struct {
		Grant string        `json:"grant"`
		Input BookmarkInput `json:"input"`
	}{second.Grant, input})
	server := NewServer(c, nil)
	defer server.Close()
	cookie := &http.Cookie{Name: sessionCookie, Value: login.Token}
	a := requestCenter(t, server, "POST", "/api/center/v1/bookmarks/add", c.key.Origin, string(body), cookie)
	b := requestCenter(t, server, "POST", "/api/center/v1/bookmarks/add", c.key.Origin, string(body), cookie)
	if a.Code != 200 || b.Code != 200 || a.Body.String() != b.Body.String() {
		t.Fatal("lost result retry changed outcome", a.Body.String(), b.Body.String())
	}
	directory, err := c.Directory(login.Token)
	if err != nil || len(directory.Bookmarks) != 1 {
		t.Fatal("bookmark side effect repeated")
	}
	altered := bytes.Replace(body, []byte("runtime.example.test"), []byte("different.example.test"), 1)
	if requestCenter(t, server, "POST", "/api/center/v1/bookmarks/add", c.key.Origin, string(altered), cookie).Code != 403 {
		t.Fatal("grant changed target")
	}
}
