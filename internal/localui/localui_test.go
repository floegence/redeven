package localui

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven-agent/internal/accessgate"
	"github.com/floegence/redeven-agent/internal/config"
)

func writeTestConfig(t *testing.T) string {
	t.Helper()
	policy, err := config.ParsePermissionPolicyPreset("")
	if err != nil {
		t.Fatalf("ParsePermissionPolicyPreset() error = %v", err)
	}
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	if err := config.Save(cfgPath, &config.Config{
		PermissionPolicy: policy,
		LogFormat:        "json",
		LogLevel:         "info",
	}); err != nil {
		t.Fatalf("config.Save() error = %v", err)
	}
	return cfgPath
}

func newTestServer(t *testing.T, gate *accessgate.Gate) *Server {
	t.Helper()
	return &Server{
		configPath: writeTestConfig(t),
		version:    "dev",
		accessGate: gate,
		pending:    make(map[string]pendingDirect),
	}
}

func TestServer_handleRoot_redirectWhenUnlocked(t *testing.T) {
	s := &Server{}

	r := httptest.NewRequest(http.MethodGet, "http://localhost:23998/", nil)
	w := httptest.NewRecorder()
	s.handleRoot(w, r)

	res := w.Result()
	if res.StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want %d", res.StatusCode, http.StatusFound)
	}
	if loc := res.Header.Get("Location"); loc != "/_redeven_proxy/env/" {
		t.Fatalf("location = %q, want %q", loc, "/_redeven_proxy/env/")
	}
}

func TestServer_handleRoot_rendersAccessPageWhenLocked(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	s := newTestServer(t, gate)

	r := httptest.NewRequest(http.MethodGet, "http://localhost:23998/", nil)
	w := httptest.NewRecorder()
	s.handleRoot(w, r)

	res := w.Result()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.StatusCode, http.StatusOK)
	}
	body := w.Body.String()
	if !strings.Contains(body, "Enter access password") {
		t.Fatalf("body missing unlock title: %s", body)
	}
}

func TestServer_LocalAccessUnlockFlow(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	s := newTestServer(t, gate)

	lockedReq := httptest.NewRequest(http.MethodGet, "http://localhost:23998/api/local/runtime", nil)
	lockedRes := httptest.NewRecorder()
	s.handleRuntime(lockedRes, lockedReq)
	if lockedRes.Result().StatusCode != http.StatusLocked {
		t.Fatalf("locked runtime status = %d, want %d", lockedRes.Result().StatusCode, http.StatusLocked)
	}

	unlockReq := httptest.NewRequest(http.MethodPost, "http://localhost:23998/api/local/access/unlock", bytes.NewBufferString(`{"password":"secret"}`))
	unlockReq.Header.Set("Content-Type", "application/json")
	unlockRes := httptest.NewRecorder()
	s.handleAccessUnlock(unlockRes, unlockReq)
	if unlockRes.Result().StatusCode != http.StatusOK {
		t.Fatalf("unlock status = %d, want %d", unlockRes.Result().StatusCode, http.StatusOK)
	}

	var unlockBody struct {
		OK   bool `json:"ok"`
		Data struct {
			ResumeToken string `json:"resume_token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(unlockRes.Body.Bytes(), &unlockBody); err != nil {
		t.Fatalf("decode unlock body error = %v", err)
	}
	if !unlockBody.OK || unlockBody.Data.ResumeToken == "" {
		t.Fatalf("unexpected unlock body: %#v", unlockBody)
	}

	cookies := unlockRes.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatalf("expected access cookie")
	}

	runtimeReq := httptest.NewRequest(http.MethodGet, "http://localhost:23998/api/local/runtime", nil)
	runtimeReq.AddCookie(cookies[0])
	runtimeRes := httptest.NewRecorder()
	s.handleRuntime(runtimeRes, runtimeReq)
	if runtimeRes.Result().StatusCode != http.StatusOK {
		t.Fatalf("runtime status = %d, want %d", runtimeRes.Result().StatusCode, http.StatusOK)
	}

	connectReq := httptest.NewRequest(http.MethodPost, "http://localhost:23998/api/local/direct/connect_info", bytes.NewBufferString(`{}`))
	connectReq.AddCookie(cookies[0])
	connectRes := httptest.NewRecorder()
	s.handleConnectInfo(connectRes, connectReq)
	if connectRes.Result().StatusCode != http.StatusOK {
		t.Fatalf("connect_info status = %d, want %d", connectRes.Result().StatusCode, http.StatusOK)
	}

	logoutReq := httptest.NewRequest(http.MethodPost, "http://localhost:23998/api/local/access/logout", nil)
	logoutReq.AddCookie(cookies[0])
	logoutRes := httptest.NewRecorder()
	s.handleAccessLogout(logoutRes, logoutReq)
	if logoutRes.Result().StatusCode != http.StatusOK {
		t.Fatalf("logout status = %d, want %d", logoutRes.Result().StatusCode, http.StatusOK)
	}

	revokedReq := httptest.NewRequest(http.MethodGet, "http://localhost:23998/api/local/runtime", nil)
	revokedReq.AddCookie(cookies[0])
	revokedRes := httptest.NewRecorder()
	s.handleRuntime(revokedRes, revokedReq)
	if revokedRes.Result().StatusCode != http.StatusLocked {
		t.Fatalf("revoked runtime status = %d, want %d", revokedRes.Result().StatusCode, http.StatusLocked)
	}
}

func TestServer_handleFavicon_redirect(t *testing.T) {
	s := &Server{}

	r := httptest.NewRequest(http.MethodGet, "http://localhost:23998/favicon.ico", nil)
	w := httptest.NewRecorder()
	s.handleFavicon(w, r)

	res := w.Result()
	if res.StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want %d", res.StatusCode, http.StatusFound)
	}
	if loc := res.Header.Get("Location"); loc != "/_redeven_proxy/env/favicon.svg" {
		t.Fatalf("location = %q, want %q", loc, "/_redeven_proxy/env/favicon.svg")
	}
}

func TestServer_handleLogo_redirect(t *testing.T) {
	s := &Server{}

	r := httptest.NewRequest(http.MethodGet, "http://localhost:23998/logo.png", nil)
	w := httptest.NewRecorder()
	s.handleLogo(w, r)

	res := w.Result()
	if res.StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want %d", res.StatusCode, http.StatusFound)
	}
	if loc := res.Header.Get("Location"); loc != "/_redeven_proxy/env/logo.png" {
		t.Fatalf("location = %q, want %q", loc, "/_redeven_proxy/env/logo.png")
	}
}
