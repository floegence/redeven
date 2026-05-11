package localui

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/agent"
	gatewaypkg "github.com/floegence/redeven/internal/codeapp/gateway"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/diagnostics"
	"github.com/floegence/redeven/internal/session"
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

func (localUITestBackend) CodeRuntimeStatus(context.Context) (gatewaypkg.CodeRuntimeStatus, error) {
	return gatewaypkg.CodeRuntimeStatus{}, nil
}

func (localUITestBackend) InstallCodeRuntime(context.Context) (gatewaypkg.CodeRuntimeStatus, error) {
	return gatewaypkg.CodeRuntimeStatus{}, nil
}

func (localUITestBackend) SelectCodeRuntimeVersion(context.Context, string) (gatewaypkg.CodeRuntimeStatus, error) {
	return gatewaypkg.CodeRuntimeStatus{}, nil
}

func (localUITestBackend) SetCodeRuntimeDefaultVersion(context.Context, string) (gatewaypkg.CodeRuntimeStatus, error) {
	return gatewaypkg.CodeRuntimeStatus{}, nil
}

func (localUITestBackend) RemoveCodeRuntimeSelection(context.Context) (gatewaypkg.CodeRuntimeStatus, error) {
	return gatewaypkg.CodeRuntimeStatus{}, nil
}

func (localUITestBackend) RemoveCodeRuntimeVersion(context.Context, string) (gatewaypkg.CodeRuntimeStatus, error) {
	return gatewaypkg.CodeRuntimeStatus{}, nil
}

func (localUITestBackend) CancelCodeRuntimeOperation(context.Context) (gatewaypkg.CodeRuntimeStatus, error) {
	return gatewaypkg.CodeRuntimeStatus{}, nil
}

type localUITestCodeSpaceBackend struct {
	localUITestBackend
	port int
}

func (b localUITestCodeSpaceBackend) ResolveCodeServerPort(context.Context, string) (int, error) {
	return b.port, nil
}

func newTestGateway(t *testing.T, cfgPath string) *gatewaypkg.Gateway {
	t.Helper()
	return newTestGatewayWithBackendAndDist(t, cfgPath, localUITestBackend{}, fstest.MapFS{
		"env/index.html":      {Data: []byte("<html>env</html>")},
		"env/favicon.svg":     {Data: []byte("<svg>icon</svg>")},
		"env/logo.png":        {Data: []byte("png")},
		"env/assets/index.js": {Data: []byte("console.log('env');")},
	})
}

func newTestGatewayWithBackend(t *testing.T, cfgPath string, backend gatewaypkg.Backend) *gatewaypkg.Gateway {
	t.Helper()
	return newTestGatewayWithBackendAndDist(t, cfgPath, backend, fstest.MapFS{
		"env/index.html":      {Data: []byte("<html>env</html>")},
		"env/favicon.svg":     {Data: []byte("<svg>icon</svg>")},
		"env/logo.png":        {Data: []byte("png")},
		"env/assets/index.js": {Data: []byte("console.log('env');")},
	})
}

func newTestGatewayWithBackendAndDist(t *testing.T, cfgPath string, backend gatewaypkg.Backend, dist fs.FS) *gatewaypkg.Gateway {
	t.Helper()
	gw, err := gatewaypkg.New(gatewaypkg.Options{
		Backend:            backend,
		DistFS:             dist,
		ConfigPath:         cfgPath,
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("gateway.New() error = %v", err)
	}
	return gw
}

func newTestServer(t *testing.T, gate *accessgate.Gate) *Server {
	t.Helper()
	cfgPath := writeTestConfig(t)
	return newTestServerWithGateway(t, gate, newTestGateway(t, cfgPath), cfgPath)
}

func newTestServerWithGateway(t *testing.T, gate *accessgate.Gate, gw *gatewaypkg.Gateway, cfgPath string) *Server {
	t.Helper()
	localPermissionCap := config.ResolvePermissionCapFromConfigPath(
		cfgPath,
		localUserPublicID,
		agent.FloeAppRedevenAgent,
		config.PermissionSet{Read: true, Write: false, Execute: true},
	)
	return &Server{
		log:                slog.New(slog.NewTextHandler(io.Discard, nil)),
		configPath:         cfgPath,
		version:            "dev",
		localPermissionCap: &localPermissionCap,
		accessGate:         gate,
		gw:                 gw,
		pending:            make(map[string]pendingDirect),
	}
}

func newDiagnosticsStoreForConfig(t *testing.T, cfgPath string) *diagnostics.Store {
	t.Helper()
	store, err := diagnostics.New(diagnostics.Options{
		Logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		StateDir: filepath.Dir(cfgPath),
		Source:   diagnostics.SourceAgent,
	})
	if err != nil {
		t.Fatalf("diagnostics.New() error = %v", err)
	}
	return store
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

func TestServer_handleGateway_rejectsEnvAppDirectoryListingWhenLocked(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	s := newTestServer(t, gate)

	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/_redeven_proxy/env/assets/", nil)
	res := httptest.NewRecorder()
	s.handleGateway(res, req)
	if res.Result().StatusCode != http.StatusNotFound {
		t.Fatalf("env assets directory status = %d, want %d; body=%q", res.Result().StatusCode, http.StatusNotFound, res.Body.String())
	}
	if strings.Contains(res.Body.String(), "index.js") {
		t.Fatalf("env assets directory exposed listing: %q", res.Body.String())
	}
}

func TestServer_handleRuntimeHealth_reportsOnlineWithoutUnlock(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	s := newTestServer(t, gate)

	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/api/local/runtime/health", nil)
	res := httptest.NewRecorder()
	s.handleRuntimeHealth(res, req)

	if res.Result().StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.Result().StatusCode, http.StatusOK)
	}

	var payload struct {
		OK   bool `json:"ok"`
		Data struct {
			Status           string `json:"status"`
			PasswordRequired bool   `json:"password_required"`
			RuntimeService   struct {
				OpenReadiness struct {
					State string `json:"state"`
				} `json:"open_readiness"`
			} `json:"runtime_service"`
		} `json:"data"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if !payload.OK {
		t.Fatalf("ok = false, want true")
	}
	if payload.Data.Status != "online" {
		t.Fatalf("status = %q, want %q", payload.Data.Status, "online")
	}
	if !payload.Data.PasswordRequired {
		t.Fatalf("password_required = false, want true")
	}
	if payload.Data.RuntimeService.OpenReadiness.State != "starting" {
		t.Fatalf("open_readiness.state = %q, want starting", payload.Data.RuntimeService.OpenReadiness.State)
	}
}

func TestServer_handleRuntimeHealth_blocksOpenWhenEnvAppShellUnavailable(t *testing.T) {
	cfgPath := writeTestConfig(t)
	gw := newTestGatewayWithBackendAndDist(t, cfgPath, localUITestBackend{}, fstest.MapFS{
		"env/favicon.svg": {Data: []byte("<svg>icon</svg>")},
		"env/logo.png":    {Data: []byte("png")},
	})
	s := newTestServerWithGateway(t, nil, gw, cfgPath)
	s.a = &agent.Agent{}

	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/api/local/runtime/health", nil)
	res := httptest.NewRecorder()
	s.handleRuntimeHealth(res, req)

	if res.Result().StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.Result().StatusCode, http.StatusOK)
	}

	var payload struct {
		OK   bool `json:"ok"`
		Data struct {
			RuntimeService struct {
				OpenReadiness struct {
					State      string `json:"state"`
					ReasonCode string `json:"reason_code"`
					Message    string `json:"message"`
				} `json:"open_readiness"`
			} `json:"runtime_service"`
		} `json:"data"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if !payload.OK {
		t.Fatalf("ok = false, want true")
	}
	readiness := payload.Data.RuntimeService.OpenReadiness
	if readiness.State != "blocked" {
		t.Fatalf("open_readiness.state = %q, want blocked", readiness.State)
	}
	if readiness.ReasonCode != "env_app_shell_unavailable" {
		t.Fatalf("open_readiness.reason_code = %q, want env_app_shell_unavailable", readiness.ReasonCode)
	}
	if !strings.Contains(readiness.Message, "Environment App shell") {
		t.Fatalf("open_readiness.message = %q, want Env App shell detail", readiness.Message)
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

	resumeRuntimeReq := httptest.NewRequest(http.MethodGet, "http://localhost:23998/api/local/runtime", nil)
	resumeRuntimeReq.Header.Set(localAccessResumeHeader, unlockBody.Data.ResumeToken)
	resumeRuntimeRes := httptest.NewRecorder()
	s.handleRuntime(resumeRuntimeRes, resumeRuntimeReq)
	if resumeRuntimeRes.Result().StatusCode != http.StatusOK {
		t.Fatalf("resume-token runtime status = %d, want %d", resumeRuntimeRes.Result().StatusCode, http.StatusOK)
	}

	resumeConnectReq := httptest.NewRequest(http.MethodPost, "http://localhost:23998/api/local/direct/connect_artifact", bytes.NewBufferString(`{}`))
	resumeConnectReq.Header.Set(localAccessResumeHeader, unlockBody.Data.ResumeToken)
	resumeConnectRes := httptest.NewRecorder()
	s.handleConnectArtifact(resumeConnectRes, resumeConnectReq)
	if resumeConnectRes.Result().StatusCode != http.StatusOK {
		t.Fatalf("resume-token connect_artifact status = %d, want %d", resumeConnectRes.Result().StatusCode, http.StatusOK)
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

	connectReq := httptest.NewRequest(http.MethodPost, "http://localhost:23998/api/local/direct/connect_artifact", bytes.NewBufferString(`{}`))
	connectReq.AddCookie(cookies[0])
	connectRes := httptest.NewRecorder()
	s.handleConnectArtifact(connectRes, connectReq)
	if connectRes.Result().StatusCode != http.StatusOK {
		t.Fatalf("connect_artifact status = %d, want %d", connectRes.Result().StatusCode, http.StatusOK)
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

func TestServer_LocalAccessUnlockRateLimitsRepeatedFailures(t *testing.T) {
	gate := accessgate.New(accessgate.Options{
		Password: "secret",
		AttemptPolicy: accessgate.AttemptPolicy{
			Steps: []accessgate.AttemptPolicyStep{
				{Failures: 2, Cooldown: 30 * time.Second},
			},
			Retention: time.Minute,
		},
	})
	s := newTestServer(t, gate)

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "http://localhost:23998/api/local/access/unlock", bytes.NewBufferString(`{"password":"wrong"}`))
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		s.handleAccessUnlock(res, req)

		expectedStatus := http.StatusUnauthorized
		if i == 1 {
			expectedStatus = http.StatusTooManyRequests
			if got := res.Result().Header.Get("Retry-After"); got == "" {
				t.Fatalf("Retry-After header missing on rate limit response")
			}
		}
		if res.Result().StatusCode != expectedStatus {
			t.Fatalf("attempt %d status = %d, want %d", i+1, res.Result().StatusCode, expectedStatus)
		}
	}
}

func TestServer_LocalAccessRejectsInvalidResumeToken(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	s := newTestServer(t, gate)

	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/api/local/runtime", nil)
	req.Header.Set(localAccessResumeHeader, "invalid-token")
	res := httptest.NewRecorder()
	s.handleRuntime(res, req)
	if res.Result().StatusCode != http.StatusLocked {
		t.Fatalf("status = %d, want %d", res.Result().StatusCode, http.StatusLocked)
	}
}

func TestServer_LocalPermissionCapDoesNotHotReload(t *testing.T) {
	cfgPath := writeTestConfig(t)
	localPermissionCap := config.ResolvePermissionCapFromConfigPath(
		cfgPath,
		localUserPublicID,
		agent.FloeAppRedevenAgent,
		config.PermissionSet{Read: true, Write: false, Execute: true},
	)
	s := &Server{
		log:                slog.New(slog.NewTextHandler(io.Discard, nil)),
		configPath:         cfgPath,
		version:            "dev",
		localPermissionCap: &localPermissionCap,
		gw:                 newTestGateway(t, cfgPath),
		pending:            make(map[string]pendingDirect),
	}

	locked := config.PermissionSet{Read: false, Write: false, Execute: false}
	if err := config.Save(cfgPath, &config.Config{
		PermissionPolicy: &config.PermissionPolicy{
			SchemaVersion: 1,
			LocalMax:      &locked,
		},
		LogFormat: "json",
		LogLevel:  "info",
	}); err != nil {
		t.Fatalf("config.Save() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/api/local/environment", nil)
	res := httptest.NewRecorder()
	s.handleEnvironment(res, req)
	if res.Result().StatusCode != http.StatusOK {
		t.Fatalf("environment status = %d, want %d body=%s", res.Result().StatusCode, http.StatusOK, res.Body.String())
	}

	var body environmentResp
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if body.Permissions == nil {
		t.Fatalf("missing permissions in response")
	}
	if !body.Permissions.CanRead || !body.Permissions.CanWrite || !body.Permissions.CanExecute {
		t.Fatalf("permissions = %+v, want startup permissions to remain active", body.Permissions)
	}
}

func TestServer_hasLocalAccess_acceptsResumeTokenQuery(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	s := newTestServer(t, gate)

	unlockReq := httptest.NewRequest(http.MethodPost, "http://localhost:23998/api/local/access/unlock", bytes.NewBufferString(`{"password":"secret"}`))
	unlockReq.Header.Set("Content-Type", "application/json")
	unlockRes := httptest.NewRecorder()
	s.handleAccessUnlock(unlockRes, unlockReq)

	var unlockBody struct {
		OK   bool `json:"ok"`
		Data struct {
			ResumeToken string `json:"resume_token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(unlockRes.Body.Bytes(), &unlockBody); err != nil {
		t.Fatalf("decode unlock body error = %v", err)
	}
	if unlockBody.Data.ResumeToken == "" {
		t.Fatalf("expected resume token")
	}

	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/_redeven_direct/ws?"+localAccessResumeQuery+"="+unlockBody.Data.ResumeToken, nil)
	if !s.hasLocalAccess(req) {
		t.Fatalf("expected query resume token to grant local access")
	}
}

func TestServer_handleCodeSpace_bootstrapsLocalAccessCookieFromResumeToken(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	cfgPath := writeTestConfig(t)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			_, _ = w.Write([]byte("<html>codespace</html>"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	upstreamPort := upstream.Listener.Addr().(*net.TCPAddr).Port
	gw := newTestGatewayWithBackend(t, cfgPath, localUITestCodeSpaceBackend{port: upstreamPort})
	s := newTestServerWithGateway(t, gate, gw, cfgPath)

	unlockReq := httptest.NewRequest(http.MethodPost, "http://localhost:23998/api/local/access/unlock", bytes.NewBufferString(`{"password":"secret"}`))
	unlockReq.Header.Set("Content-Type", "application/json")
	unlockRes := httptest.NewRecorder()
	s.handleAccessUnlock(unlockRes, unlockReq)

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

	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/cs/demo/?redeven_access_resume="+unlockBody.Data.ResumeToken, nil)
	res := httptest.NewRecorder()
	s.handleCodeSpace(res, req)

	if res.Result().StatusCode != http.StatusOK {
		t.Fatalf("codespace status = %d, want %d body=%s", res.Result().StatusCode, http.StatusOK, res.Body.String())
	}
	if body := res.Body.String(); body != "<html>codespace</html>" {
		t.Fatalf("codespace body = %q, want %q", body, "<html>codespace</html>")
	}

	cookies := res.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatalf("expected bootstrap cookie")
	}
	if cookies[0].Name != accessgate.LocalSessionCookieName {
		t.Fatalf("cookie name = %q, want %q", cookies[0].Name, accessgate.LocalSessionCookieName)
	}
}

func TestServer_handlePortForward_redirectsBasePathToSlash(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/pf/demo?x=1", nil)
	res := httptest.NewRecorder()
	s.handlePortForward(res, req)

	if res.Result().StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want %d", res.Result().StatusCode, http.StatusFound)
	}
	if loc := res.Header().Get("Location"); loc != "/pf/demo/?x=1" {
		t.Fatalf("Location = %q, want %q", loc, "/pf/demo/?x=1")
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

func TestServer_handleRuntime_reportsDesktopManagedMetadata(t *testing.T) {
	s := newTestServer(t, nil)
	s.desktopManaged = true
	s.effectiveRunMode = "hybrid"
	s.remoteEnabled = true

	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/api/local/runtime", nil)
	res := httptest.NewRecorder()
	s.handleRuntime(res, req)

	if res.Result().StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.Result().StatusCode, http.StatusOK)
	}

	var body runtimeResp
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if !body.DesktopManaged || body.EffectiveRunMode != "hybrid" || !body.RemoteEnabled {
		t.Fatalf("unexpected runtime body: %#v", body)
	}
	if body.RuntimeService.ProtocolVersion != "redeven-runtime-v1" ||
		body.RuntimeService.ServiceOwner != "desktop" ||
		!body.RuntimeService.DesktopManaged ||
		body.RuntimeService.EffectiveRunMode != "hybrid" ||
		!body.RuntimeService.RemoteEnabled {
		t.Fatalf("unexpected runtime service body: %#v", body.RuntimeService)
	}
	if body.RuntimeService.OpenReadiness.State != "starting" {
		t.Fatalf("OpenReadiness.State = %q", body.RuntimeService.OpenReadiness.State)
	}
}

func TestServer_DiagnosticsAddsTraceHeaderForRuntime(t *testing.T) {
	cfgPath := writeTestConfig(t)
	diagStore := newDiagnosticsStoreForConfig(t, cfgPath)
	s := &Server{
		log:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		configPath: cfgPath,
		version:    "dev",
		gw:         newTestGateway(t, cfgPath),
		diag:       diagStore,
		pending:    make(map[string]pendingDirect),
	}

	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/api/local/runtime", nil)
	res := httptest.NewRecorder()
	s.handler().ServeHTTP(res, req)

	if res.Result().StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.Result().StatusCode, http.StatusOK)
	}
	traceID := res.Header().Get(diagnostics.TraceHeader)
	if traceID == "" {
		t.Fatalf("missing %s header", diagnostics.TraceHeader)
	}

	events, err := diagStore.List(10)
	if err != nil {
		t.Fatalf("diagStore.List() error = %v", err)
	}
	var matched *diagnostics.Event
	for i := range events {
		event := events[i]
		if event.Scope == diagnostics.ScopeLocalUIHTTP && event.Path == "/api/local/runtime" {
			matched = &event
			break
		}
	}
	if matched == nil {
		t.Fatalf("expected runtime diagnostics event, got %#v", events)
	}
	if matched.TraceID != traceID {
		t.Fatalf("matched.TraceID = %q, want %q", matched.TraceID, traceID)
	}
}

func TestServer_DiagnosticsConnectInfoReusesTraceID(t *testing.T) {
	cfgPath := writeTestConfig(t)
	diagStore := newDiagnosticsStoreForConfig(t, cfgPath)
	s := &Server{
		log:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		configPath: cfgPath,
		version:    "dev",
		gw:         newTestGateway(t, cfgPath),
		diag:       diagStore,
		pending:    make(map[string]pendingDirect),
	}

	req := httptest.NewRequest(http.MethodPost, "http://localhost:23998/api/local/direct/connect_artifact", bytes.NewBufferString(`{}`))
	res := httptest.NewRecorder()
	s.handler().ServeHTTP(res, req)

	if res.Result().StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.Result().StatusCode, http.StatusOK)
	}
	traceID := res.Header().Get(diagnostics.TraceHeader)
	if traceID == "" {
		t.Fatalf("missing %s header", diagnostics.TraceHeader)
	}

	events, err := diagStore.List(20)
	if err != nil {
		t.Fatalf("diagStore.List() error = %v", err)
	}
	var connectArtifactEvent *diagnostics.Event
	var httpEvent *diagnostics.Event
	for i := range events {
		event := events[i]
		if event.Scope == diagnostics.ScopeDirectSession && event.Kind == "connect_artifact_issued" {
			connectArtifactEvent = &event
		}
		if event.Scope == diagnostics.ScopeLocalUIHTTP && event.Path == "/api/local/direct/connect_artifact" {
			httpEvent = &event
		}
	}
	if connectArtifactEvent == nil {
		t.Fatalf("expected connect_artifact_issued diagnostics event, got %#v", events)
	}
	if httpEvent == nil {
		t.Fatalf("expected localui_http diagnostics event, got %#v", events)
	}
	if connectArtifactEvent.TraceID != traceID || httpEvent.TraceID != traceID {
		t.Fatalf("unexpected trace IDs connect=%q http=%q want=%q", connectArtifactEvent.TraceID, httpEvent.TraceID, traceID)
	}
}

func TestServer_DiagnosticsSkipsDiagnosticsAPIRequests(t *testing.T) {
	cfgPath := writeTestConfig(t)
	diagStore := newDiagnosticsStoreForConfig(t, cfgPath)
	s := &Server{
		log:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		configPath: cfgPath,
		version:    "dev",
		gw:         newTestGateway(t, cfgPath),
		diag:       diagStore,
		pending:    make(map[string]pendingDirect),
	}

	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/_redeven_proxy/api/debug/diagnostics", nil)
	res := httptest.NewRecorder()
	s.handler().ServeHTTP(res, req)

	if res.Result().StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.Result().StatusCode, http.StatusOK)
	}
	events, err := diagStore.List(10)
	if err != nil {
		t.Fatalf("diagStore.List() error = %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("expected diagnostics API request to be skipped, got %#v", events)
	}
}

func TestServer_handleLatestVersion_desktopManagedMessage(t *testing.T) {
	s := newTestServer(t, nil)
	s.version = "v1.2.3"
	s.desktopManaged = true
	s.effectiveRunMode = "hybrid"
	s.remoteEnabled = true
	s.latestVersionResolver = latestVersionResolverFunc(func(context.Context) (latestVersionLoadResult, error) {
		return latestVersionLoadResult{
			snapshot: latestVersionSnapshot{
				latest:           "v1.2.4",
				recommended:      "v1.2.4",
				sourceReleaseTag: "v1.2.4",
				releasePageURL:   "https://example.test/releases/v1.2.4",
				etag:             "\"etag-1\"",
				fetchedAt:        time.Unix(1_700_000_000, 0),
				ttl:              5 * time.Minute,
			},
			source: "upstream",
		}, nil
	})

	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/api/local/agent/version/latest", nil)
	res := httptest.NewRecorder()
	s.handleLatestVersion(res, req)

	if res.Result().StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.Result().StatusCode, http.StatusOK)
	}

	var body latestVersionResp
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if body.CurrentVersion != "v1.2.3" {
		t.Fatalf("CurrentVersion = %q", body.CurrentVersion)
	}
	if body.LatestVersion != "v1.2.4" || body.RecommendedVersion != "v1.2.4" {
		t.Fatalf("unexpected latest metadata: %#v", body)
	}
	if body.UpgradePolicy != "desktop_release" {
		t.Fatalf("UpgradePolicy = %q", body.UpgradePolicy)
	}
	if body.ReleasePageURL != "https://example.test/releases/v1.2.4" || body.ManifestETag != "\"etag-1\"" || body.Source != "upstream" {
		t.Fatalf("unexpected manifest metadata: %#v", body)
	}
	if !body.DesktopManaged || !strings.Contains(body.Message, "Managed by Redeven Desktop") {
		t.Fatalf("unexpected latest version body: %#v", body)
	}
}

func TestServer_handleLatestVersion_manualPolicyForLocalMode(t *testing.T) {
	s := newTestServer(t, nil)
	s.version = "v1.2.3"
	s.desktopManaged = false
	s.effectiveRunMode = "local"
	s.remoteEnabled = false
	s.latestVersionResolver = latestVersionResolverFunc(func(context.Context) (latestVersionLoadResult, error) {
		return latestVersionLoadResult{}, errors.New("manifest unavailable")
	})

	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/api/local/agent/version/latest", nil)
	res := httptest.NewRecorder()
	s.handleLatestVersion(res, req)

	if res.Result().StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.Result().StatusCode, http.StatusOK)
	}

	var body latestVersionResp
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if body.CurrentVersion != "v1.2.3" || body.UpgradePolicy != "manual" {
		t.Fatalf("unexpected latest version body: %#v", body)
	}
	if body.LatestVersion != "" || body.RecommendedVersion != "" {
		t.Fatalf("unexpected manifest metadata: %#v", body)
	}
	if !strings.Contains(body.Message, localLatestVersionUnavailableMessage) {
		t.Fatalf("unexpected message: %#v", body)
	}
}

func TestServer_handleLatestVersion_returnsNormalizedManifestMetadata(t *testing.T) {
	manifestSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("ETag", "\"manifest-1\"")
		_, _ = w.Write([]byte(`{"latest":"v1.4.0","recommended":"main","source_release_tag":"v1.4.0","release_page_url":"https://example.test/releases/v1.4.0"}`))
	}))
	defer manifestSrv.Close()

	now := time.Unix(1_700_000_100, 0)
	resolver := newManifestLatestVersionResolver(manifestSrv.URL, manifestSrv.Client(), 5*time.Minute)
	resolver.now = func() time.Time { return now }

	s := newTestServer(t, nil)
	s.version = "v1.3.0"
	s.effectiveRunMode = "local"
	s.latestVersionResolver = resolver

	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/api/local/agent/version/latest", nil)
	res := httptest.NewRecorder()
	s.handleLatestVersion(res, req)

	if res.Result().StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.Result().StatusCode, http.StatusOK)
	}

	var body latestVersionResp
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if body.CurrentVersion != "v1.3.0" || body.UpgradePolicy != "self_upgrade" {
		t.Fatalf("unexpected latest version body: %#v", body)
	}
	if body.LatestVersion != "v1.4.0" || body.RecommendedVersion != "v1.4.0" {
		t.Fatalf("expected recommended fallback to latest, got %#v", body)
	}
	if body.ReleasePageURL != "https://example.test/releases/v1.4.0" || body.SourceReleaseTag != "v1.4.0" {
		t.Fatalf("unexpected release metadata: %#v", body)
	}
	if body.ManifestETag != "\"manifest-1\"" || body.Source != "upstream" || body.Stale {
		t.Fatalf("unexpected cache metadata: %#v", body)
	}
	if body.FetchedAtMs != now.UnixMilli() || body.CacheTTLMS != int64((5*time.Minute)/time.Millisecond) {
		t.Fatalf("unexpected timing metadata: %#v", body)
	}
}

func TestServer_handleLatestVersion_usesStaleCacheWhenManifestUnavailable(t *testing.T) {
	requestCount := 0
	manifestSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if requestCount == 1 {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("ETag", "\"manifest-2\"")
			_, _ = w.Write([]byte(`{"latest":"v1.5.0","recommended":"v1.5.0","source_release_tag":"v1.5.0","release_page_url":"https://example.test/releases/v1.5.0"}`))
			return
		}
		http.Error(w, "boom", http.StatusServiceUnavailable)
	}))
	defer manifestSrv.Close()

	now := time.Unix(1_700_000_200, 0)
	resolver := newManifestLatestVersionResolver(manifestSrv.URL, manifestSrv.Client(), 5*time.Minute)
	resolver.now = func() time.Time { return now }

	s := newTestServer(t, nil)
	s.version = "v1.4.0"
	s.effectiveRunMode = "local"
	s.latestVersionResolver = resolver

	firstReq := httptest.NewRequest(http.MethodGet, "http://localhost:23998/api/local/agent/version/latest", nil)
	firstRes := httptest.NewRecorder()
	s.handleLatestVersion(firstRes, firstReq)

	now = now.Add(10 * time.Minute)

	secondReq := httptest.NewRequest(http.MethodGet, "http://localhost:23998/api/local/agent/version/latest", nil)
	secondRes := httptest.NewRecorder()
	s.handleLatestVersion(secondRes, secondReq)

	if secondRes.Result().StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", secondRes.Result().StatusCode, http.StatusOK)
	}

	var body latestVersionResp
	if err := json.Unmarshal(secondRes.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if requestCount != 2 {
		t.Fatalf("requestCount = %d, want 2", requestCount)
	}
	if body.UpgradePolicy != "self_upgrade" || body.LatestVersion != "v1.5.0" || body.RecommendedVersion != "v1.5.0" {
		t.Fatalf("unexpected stale latest version body: %#v", body)
	}
	if !body.Stale || body.Source != "cache_stale" {
		t.Fatalf("expected stale cache response, got %#v", body)
	}
	if body.Message != localLatestVersionTemporaryUnavailableMessage {
		t.Fatalf("unexpected message: %#v", body)
	}
}

func TestServer_Start_UsesActualDynamicPortForDisplayURLs(t *testing.T) {
	cfgPath := writeTestConfig(t)
	bind, err := ParseBind("127.0.0.1:0")
	if err != nil {
		t.Fatalf("ParseBind() error = %v", err)
	}

	s := &Server{
		log:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		bind:       bind,
		configPath: cfgPath,
		gw:         newTestGateway(t, cfgPath),
		pending:    make(map[string]pendingDirect),
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := s.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	defer func() { _ = s.Close() }()

	if s.Port() == 0 {
		t.Fatalf("Port() = 0, want non-zero bound port")
	}
	if s.ListenLabel() == "127.0.0.1:0" {
		t.Fatalf("ListenLabel() = %q, want actual port", s.ListenLabel())
	}
	urls := s.DisplayURLs()
	if len(urls) != 1 || strings.Contains(urls[0], ":0/") {
		t.Fatalf("DisplayURLs() = %#v, want actual bound port", urls)
	}
}

func TestNew_PreservesExplicitDynamicLoopbackBind(t *testing.T) {
	cfgPath := writeTestConfig(t)
	bind, err := ParseBind("127.0.0.1:0")
	if err != nil {
		t.Fatalf("ParseBind() error = %v", err)
	}

	s, err := New(Options{
		Logger:     slog.New(slog.NewTextHandler(io.Discard, nil)),
		Bind:       bind,
		Gateway:    newTestGateway(t, cfgPath),
		Agent:      &agent.Agent{},
		ConfigPath: cfgPath,
		Version:    "dev",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if s.bind.Host() != "127.0.0.1" || s.bind.Port() != 0 {
		t.Fatalf("server bind = %#v, want explicit dynamic loopback bind", s.bind)
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

func TestLocalCodeSpaceRoute(t *testing.T) {
	codeSpaceID, basePath, ok := localCodeSpaceRoute("/cs/demo/")
	if !ok {
		t.Fatalf("expected route match")
	}
	if codeSpaceID != "demo" {
		t.Fatalf("codeSpaceID = %q, want %q", codeSpaceID, "demo")
	}
	if basePath != "/cs/demo" {
		t.Fatalf("basePath = %q, want %q", basePath, "/cs/demo")
	}
}

func TestLocalPortForwardRoute(t *testing.T) {
	forwardID, basePath, ok := localPortForwardRoute("/pf/demo-1/service/")
	if !ok {
		t.Fatalf("expected local port forward route")
	}
	if forwardID != "demo-1" {
		t.Fatalf("forwardID = %q, want %q", forwardID, "demo-1")
	}
	if basePath != "/pf/demo-1" {
		t.Fatalf("basePath = %q, want %q", basePath, "/pf/demo-1")
	}

	if _, _, ok := localPortForwardRoute("/pf/Demo/"); ok {
		t.Fatalf("expected mixed-case forward id to be rejected")
	}
}

func TestSameOriginWSRequest(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "http://192.168.1.11:12345/_redeven_direct/ws", nil)
	req.Header.Set("Origin", "http://192.168.1.11:12345")
	if !sameOriginWSRequest(req) {
		t.Fatalf("expected same-origin websocket request to pass")
	}

	req.Header.Set("Origin", "http://evil.example.com")
	if sameOriginWSRequest(req) {
		t.Fatalf("expected mismatched origin to fail")
	}
}
