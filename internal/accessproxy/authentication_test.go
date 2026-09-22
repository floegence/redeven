package accessproxy

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/session"
	"github.com/pquerna/otp/totp"
)

func TestProxyRequiresCompletedFactorBeforeBusinessAccess(t *testing.T) {
	dir := t.TempDir()
	hash, err := accessgate.HashPassword("environment password")
	if err != nil {
		t.Fatal(err)
	}
	if err = accessgate.WritePasswordHash(dir, hash); err != nil {
		t.Fatal(err)
	}
	gate, err := accessgate.OpenPersistent(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer gate.Close()
	setup, err := gate.Manage("owner", "test", accessgate.SecurityRequest{Action: "setup"})
	if err != nil {
		t.Fatal(err)
	}
	code, _ := totp.GenerateCode(setup.Secret, time.Now().Add(-30*time.Second))
	if _, err = gate.Manage("owner", "test", accessgate.SecurityRequest{Action: "verify", OperationID: setup.OperationID, Code: code}); err != nil {
		t.Fatal(err)
	}
	if _, err = gate.Manage("owner", "test", accessgate.SecurityRequest{Action: "commit", OperationID: setup.OperationID, Saved: true}); err != nil {
		t.Fatal(err)
	}
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { calls++; w.WriteHeader(http.StatusNoContent) }))
	defer upstream.Close()
	meta := session.Meta{ChannelID: "cloud-channel", UserPublicID: "user", EndpointID: "env", FloeApp: "com.floegence.redeven.agent", CodeSpaceID: "env-ui", CanRead: true, CanWrite: true, CanExecute: true}
	gate.RegisterChannel(meta)
	defer gate.UnregisterChannel(meta.ChannelID)
	proxy, err := New(Options{Gate: gate, Meta: meta, Upstream: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	request := func(path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		w := httptest.NewRecorder()
		proxy.serveHTTP(w, r)
		return w
	}
	assertLocked := func() {
		t.Helper()
		for _, path := range []string{"/_redeven_proxy/api/files", "/_redeven_proxy/api/terminals", "/_redeven_proxy/api/spaces", "/_redeven_proxy/api/access/delegate"} {
			if w := request(path, `{"code_space_id":"editor"}`); w.Code < 400 {
				t.Fatalf("business access before factor: %s %d", path, w.Code)
			}
		}
		if calls != 0 {
			t.Fatal("unauthenticated traffic reached business server")
		}
	}
	assertLocked()
	password := request("/_redeven_proxy/api/access/unlock", `{"password":"environment password"}`)
	var result struct {
		Data accessgate.UnlockResult `json:"data"`
	}
	if err = json.Unmarshal(password.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if password.Code != 200 || !result.Data.SecondFactorRequired || result.Data.ResumeToken != "" || result.Data.Unlocked {
		t.Fatalf("password step: %s", password.Body.String())
	}
	assertLocked()
	code, _ = totp.GenerateCode(setup.Secret, time.Now())
	body, _ := json.Marshal(accessgate.AuthenticationRequest{ChallengeID: result.Data.ChallengeID, Code: code})
	if w := request("/_redeven_proxy/api/access/unlock", string(body)); w.Code != 200 {
		t.Fatalf("factor: %s", w.Body.String())
	}
	if w := request("/_redeven_proxy/api/files", ""); w.Code != 204 || calls != 1 {
		t.Fatalf("authorized business access: %d calls=%d", w.Code, calls)
	}
	if _, err = gate.Manage("owner", "test", accessgate.SecurityRequest{Action: "recover"}); err != nil {
		t.Fatal(err)
	}
	if w := request("/_redeven_proxy/api/files", ""); w.Code != 423 || calls != 1 {
		t.Fatalf("host recovery failed to revoke channel: %d", w.Code)
	}
}

func TestIsolatedResourceServesLoginWithoutExposingBusinessRequests(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	meta := session.Meta{ChannelID: "resource", UserPublicID: "user", EndpointID: "env", FloeApp: "com.floegence.redeven.code", CodeSpaceID: "editor"}
	gate.RegisterChannel(meta)
	defer gate.UnregisterChannel(meta.ChannelID)
	proxy, err := New(Options{Gate: gate, Meta: meta, Upstream: "http://127.0.0.1:1"})
	if err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		r := httptest.NewRequest(method, "/?folder=project", nil)
		r.Header.Set("Accept", "text/html")
		w := httptest.NewRecorder()
		proxy.serveHTTP(w, r)
		if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Referrer-Policy") != "no-referrer" {
			t.Fatalf("login page: %d %s", w.Code, w.Body.String())
		}
		if method == http.MethodGet && (!strings.Contains(w.Body.String(), "/_redeven_proxy/env/assets/") || strings.Contains(w.Body.String(), "data-redeven-local-access")) {
			t.Fatalf("wrong login surface: %s", w.Body.String())
		}
		if method == http.MethodHead && w.Body.Len() != 0 {
			t.Fatal("HEAD included a body")
		}
	}
	for _, path := range []string{"/api/files", "/_redeven_proxy/env/index.html"} {
		w := httptest.NewRecorder()
		proxy.serveHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusLocked {
			t.Fatalf("business path %s returned %d", path, w.Code)
		}
	}
}
