package localui

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"testing/fstest"

	"github.com/floegence/redeven-agent/internal/accessgate"
	gatewaypkg "github.com/floegence/redeven-agent/internal/codeapp/gateway"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
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

type localUITestBackend struct{}

func (localUITestBackend) ListSpaces(context.Context) ([]gatewaypkg.SpaceStatus, error) {
	return nil, errors.New("not implemented")
}

func (localUITestBackend) CreateSpace(context.Context, gatewaypkg.CreateSpaceRequest) (*gatewaypkg.SpaceStatus, error) {
	return nil, errors.New("not implemented")
}

func (localUITestBackend) UpdateSpace(context.Context, string, gatewaypkg.UpdateSpaceRequest) (*gatewaypkg.SpaceStatus, error) {
	return nil, errors.New("not implemented")
}

func (localUITestBackend) DeleteSpace(context.Context, string) error {
	return errors.New("not implemented")
}

func (localUITestBackend) StartSpace(context.Context, string) (*gatewaypkg.SpaceStatus, error) {
	return nil, errors.New("not implemented")
}

func (localUITestBackend) StopSpace(context.Context, string) error {
	return errors.New("not implemented")
}

func (localUITestBackend) ResolveCodeServerPort(context.Context, string) (int, error) {
	return 0, errors.New("not implemented")
}

func newTestGateway(t *testing.T, cfgPath string) *gatewaypkg.Gateway {
	t.Helper()
	gw, err := gatewaypkg.New(gatewaypkg.Options{
		Backend: localUITestBackend{},
		DistFS: fstest.MapFS{
			"env/index.html":  {Data: []byte("<html>env</html>")},
			"env/favicon.svg": {Data: []byte("<svg>icon</svg>")},
			"env/logo.png":    {Data: []byte("png")},
		},
		ConfigPath:         cfgPath,
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
		LocalUIAllowedOrigins: []string{
			"http://localhost:23998",
			"http://127.0.0.1:23998",
			"http://[::1]:23998",
		},
	})
	if err != nil {
		t.Fatalf("gateway.New() error = %v", err)
	}
	return gw
}

func newTestServer(t *testing.T, gate *accessgate.Gate) *Server {
	t.Helper()
	cfgPath := writeTestConfig(t)
	return &Server{
		configPath: cfgPath,
		version:    "dev",
		accessGate: gate,
		gw:         newTestGateway(t, cfgPath),
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

func TestServer_handleRoot_redirectWhenLocked(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	s := newTestServer(t, gate)

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

func TestServer_handleGateway_allowsEnvAppShellWhenLocked(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	s := newTestServer(t, gate)

	envReq := httptest.NewRequest(http.MethodGet, "http://localhost:23998/_redeven_proxy/env/", nil)
	envRes := httptest.NewRecorder()
	s.handleGateway(envRes, envReq)
	if envRes.Result().StatusCode != http.StatusOK {
		t.Fatalf("env shell status = %d, want %d", envRes.Result().StatusCode, http.StatusOK)
	}
	if body := envRes.Body.String(); body != "<html>env</html>" {
		t.Fatalf("env shell body = %q, want %q", body, "<html>env</html>")
	}

	apiReq := httptest.NewRequest(http.MethodGet, "http://localhost:23998/_redeven_proxy/api/settings", nil)
	apiRes := httptest.NewRecorder()
	s.handleGateway(apiRes, apiReq)
	if apiRes.Result().StatusCode != http.StatusLocked {
		t.Fatalf("gateway api status = %d, want %d", apiRes.Result().StatusCode, http.StatusLocked)
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
			Unlocked    bool   `json:"unlocked"`
			ResumeToken string `json:"resume_token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(unlockRes.Body.Bytes(), &unlockBody); err != nil {
		t.Fatalf("decode unlock body error = %v", err)
	}
	if !unlockBody.OK || !unlockBody.Data.Unlocked || unlockBody.Data.ResumeToken == "" {
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
