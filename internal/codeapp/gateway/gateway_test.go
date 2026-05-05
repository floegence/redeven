package gateway

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base32"
	"encoding/json"
	"errors"
	"io/fs"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/codeapp/codeserver"
	"github.com/floegence/redeven/internal/codexbridge"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
	"github.com/floegence/redeven/internal/threadreadstate"
)

type stubBackend struct {
	listSpaces               func(ctx context.Context) ([]SpaceStatus, error)
	createSpace              func(ctx context.Context, req CreateSpaceRequest) (*SpaceStatus, error)
	updateSpace              func(ctx context.Context, codeSpaceID string, req UpdateSpaceRequest) (*SpaceStatus, error)
	deleteSpace              func(ctx context.Context, codeSpaceID string) error
	startSpace               func(ctx context.Context, codeSpaceID string) (*SpaceStatus, error)
	stopSpace                func(ctx context.Context, codeSpaceID string) error
	resolveCodeServerPort    func(ctx context.Context, codeSpaceID string) (int, error)
	codeRuntimeStatus        func(ctx context.Context) (CodeRuntimeStatus, error)
	installCodeRuntime       func(ctx context.Context) (CodeRuntimeStatus, error)
	selectCodeRuntime        func(ctx context.Context, version string) (CodeRuntimeStatus, error)
	removeCodeRuntimeVersion func(ctx context.Context, version string) (CodeRuntimeStatus, error)
	cancelCodeRuntime        func(ctx context.Context) (CodeRuntimeStatus, error)
}

func (s *stubBackend) ListSpaces(ctx context.Context) ([]SpaceStatus, error) {
	if s.listSpaces != nil {
		return s.listSpaces(ctx)
	}
	return nil, errors.New("not implemented")
}
func (s *stubBackend) CreateSpace(ctx context.Context, req CreateSpaceRequest) (*SpaceStatus, error) {
	if s.createSpace != nil {
		return s.createSpace(ctx, req)
	}
	return nil, errors.New("not implemented")
}
func (s *stubBackend) UpdateSpace(ctx context.Context, codeSpaceID string, req UpdateSpaceRequest) (*SpaceStatus, error) {
	if s.updateSpace != nil {
		return s.updateSpace(ctx, codeSpaceID, req)
	}
	return nil, errors.New("not implemented")
}
func (s *stubBackend) DeleteSpace(ctx context.Context, codeSpaceID string) error {
	if s.deleteSpace != nil {
		return s.deleteSpace(ctx, codeSpaceID)
	}
	return errors.New("not implemented")
}
func (s *stubBackend) StartSpace(ctx context.Context, codeSpaceID string) (*SpaceStatus, error) {
	if s.startSpace != nil {
		return s.startSpace(ctx, codeSpaceID)
	}
	return nil, errors.New("not implemented")
}
func (s *stubBackend) StopSpace(ctx context.Context, codeSpaceID string) error {
	if s.stopSpace != nil {
		return s.stopSpace(ctx, codeSpaceID)
	}
	return errors.New("not implemented")
}
func (s *stubBackend) ResolveCodeServerPort(ctx context.Context, codeSpaceID string) (int, error) {
	if s.resolveCodeServerPort != nil {
		return s.resolveCodeServerPort(ctx, codeSpaceID)
	}
	return 0, errors.New("not implemented")
}
func (s *stubBackend) CodeRuntimeStatus(ctx context.Context) (CodeRuntimeStatus, error) {
	if s.codeRuntimeStatus != nil {
		return s.codeRuntimeStatus(ctx)
	}
	return CodeRuntimeStatus{}, errors.New("not implemented")
}
func (s *stubBackend) InstallCodeRuntime(ctx context.Context) (CodeRuntimeStatus, error) {
	if s.installCodeRuntime != nil {
		return s.installCodeRuntime(ctx)
	}
	return CodeRuntimeStatus{}, errors.New("not implemented")
}
func (s *stubBackend) SelectCodeRuntimeVersion(ctx context.Context, version string) (CodeRuntimeStatus, error) {
	if s.selectCodeRuntime != nil {
		return s.selectCodeRuntime(ctx, version)
	}
	return CodeRuntimeStatus{}, errors.New("not implemented")
}
func (s *stubBackend) RemoveCodeRuntimeVersion(ctx context.Context, version string) (CodeRuntimeStatus, error) {
	if s.removeCodeRuntimeVersion != nil {
		return s.removeCodeRuntimeVersion(ctx, version)
	}
	return CodeRuntimeStatus{}, errors.New("not implemented")
}
func (s *stubBackend) CancelCodeRuntimeOperation(ctx context.Context) (CodeRuntimeStatus, error) {
	if s.cancelCodeRuntime != nil {
		return s.cancelCodeRuntime(ctx)
	}
	return CodeRuntimeStatus{}, errors.New("not implemented")
}

func writeTestConfig(t *testing.T) string {
	t.Helper()

	dir := t.TempDir()
	p := filepath.Join(dir, "config.json")

	// Minimal valid config for config.Load. Includes E2EE PSK to validate redaction in /api/settings.
	raw := `{
  "controlplane_base_url": "https://example.com",
  "environment_id": "env_123",
  "agent_instance_id": "agent_123",
  "direct": {
    "ws_url": "wss://example.com/ws",
    "channel_id": "ch_123",
    "e2ee_psk_b64u": "secret",
    "channel_init_expire_at_unix_s": 0,
    "default_suite": 1
  }
}
`

	if err := os.WriteFile(p, []byte(raw), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return p
}

func writeTestConfigWithAI(t *testing.T) string {
	t.Helper()

	dir := t.TempDir()
	p := filepath.Join(dir, "config.json")

	raw := `{
  "controlplane_base_url": "https://example.com",
  "environment_id": "env_123",
  "agent_instance_id": "agent_123",
  "direct": {
    "ws_url": "wss://example.com/ws",
    "channel_id": "ch_123",
    "e2ee_psk_b64u": "secret",
    "channel_init_expire_at_unix_s": 0,
    "default_suite": 1
  },
  "ai": {
    "current_model_id": "openai/gpt-5-mini",
    "providers": [
      {
        "id": "openai",
        "name": "OpenAI",
        "type": "openai",
        "base_url": "https://api.openai.com/v1",
        "models": [
          { "model_name": "gpt-5-mini" }
        ]
      }
    ]
  }
}
`

	if err := os.WriteFile(p, []byte(raw), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return p
}

func openTestThreadReadStateStore(t *testing.T) *threadreadstate.Store {
	t.Helper()

	store, err := threadreadstate.Open(filepath.Join(t.TempDir(), "thread_read_state.sqlite"))
	if err != nil {
		t.Fatalf("threadreadstate.Open: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})
	return store
}

func performGatewayRequest(gw *Gateway, method string, path string, origin string, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	rr := httptest.NewRecorder()
	gw.serveHTTP(rr, req)
	return rr
}

func envOriginWithChannel(channelID string) string {
	enc := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString([]byte(channelID))
	enc = strings.ToLower(strings.TrimSpace(enc))
	return "https://env-123.ch-" + enc + ".example.com"
}

func resolveMetaForTest(channelID string, meta session.Meta) func(channelID string) (*session.Meta, bool) {
	return func(ch string) (*session.Meta, bool) {
		if strings.TrimSpace(ch) != strings.TrimSpace(channelID) {
			return nil, false
		}
		m := meta
		m.ChannelID = strings.TrimSpace(channelID)
		return &m, true
	}
}

func TestGateway_ManagementAPI_EnvOriginOnly(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	b := &stubBackend{
		listSpaces: func(ctx context.Context) ([]SpaceStatus, error) {
			return []SpaceStatus{{CodeSpaceID: "abc"}}, nil
		},
	}
	channelID := "ch_test_1"
	envOrigin := envOriginWithChannel(channelID)
	gw, err := New(Options{
		Backend:            b,
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfig(t),
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true}),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// Env origin should pass.
	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/spaces", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("env origin status = %d, want %d", rr.Code, http.StatusOK)
		}
		var resp struct {
			OK   bool `json:"ok"`
			Data struct {
				Spaces []SpaceStatus `json:"spaces"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if !resp.OK || len(resp.Data.Spaces) != 1 || resp.Data.Spaces[0].CodeSpaceID != "abc" {
			t.Fatalf("unexpected response: %+v", resp)
		}
	}

	// Codespace origin should be rejected (404).
	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/spaces", nil)
		req.Header.Set("Origin", "https://cs-abc.example.com")
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("cs origin status = %d, want %d", rr.Code, http.StatusNotFound)
		}
	}
}

func TestGateway_CodeRuntimeRoutes(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
	}
	channelID := "ch_runtime"
	envOrigin := envOriginWithChannel(channelID)
	var installCalls int
	var selectCalls int
	var removeVersionCalls int
	var cancelCalls int
	b := &stubBackend{
		codeRuntimeStatus: func(ctx context.Context) (CodeRuntimeStatus, error) {
			return CodeRuntimeStatus{
				ActiveRuntime: codeserver.RuntimeTargetStatus{
					DetectionState: "missing",
					Source:         "none",
				},
				ManagedRuntime: codeserver.RuntimeTargetStatus{
					DetectionState: "missing",
					Source:         "managed",
				},
				ManagedPrefix:        "/tmp/runtime",
				SharedRuntimeRoot:    "/tmp/shared-runtime",
				ManagedRuntimeSource: "none",
				InstallerScriptURL:   "https://code-server.dev/install.sh",
				Operation: codeserver.RuntimeOperationStatus{
					State: "idle",
				},
			}, nil
		},
		installCodeRuntime: func(ctx context.Context) (CodeRuntimeStatus, error) {
			installCalls++
			return CodeRuntimeStatus{
				ActiveRuntime: codeserver.RuntimeTargetStatus{
					DetectionState: "missing",
					Source:         "none",
				},
				ManagedRuntime: codeserver.RuntimeTargetStatus{
					DetectionState: "missing",
					Source:         "managed",
				},
				ManagedPrefix:        "/tmp/runtime",
				SharedRuntimeRoot:    "/tmp/shared-runtime",
				ManagedRuntimeSource: "managed",
				InstallerScriptURL:   "https://code-server.dev/install.sh",
				Operation: codeserver.RuntimeOperationStatus{
					Action: "install",
					State:  "running",
					Stage:  "installing",
				},
			}, nil
		},
		selectCodeRuntime: func(ctx context.Context, version string) (CodeRuntimeStatus, error) {
			selectCalls++
			return CodeRuntimeStatus{
				ActiveRuntime: codeserver.RuntimeTargetStatus{
					DetectionState: "ready",
					Source:         "managed",
					Version:        version,
				},
				ManagedRuntime: codeserver.RuntimeTargetStatus{
					DetectionState: "ready",
					Source:         "managed",
					Version:        version,
				},
				ManagedPrefix:         "/tmp/runtime",
				SharedRuntimeRoot:     "/tmp/shared-runtime",
				ManagedRuntimeSource:  "managed",
				ManagedRuntimeVersion: version,
				InstallerScriptURL:    "https://code-server.dev/install.sh",
			}, nil
		},
		removeCodeRuntimeVersion: func(ctx context.Context, version string) (CodeRuntimeStatus, error) {
			removeVersionCalls++
			return CodeRuntimeStatus{
				ManagedPrefix:        "/tmp/runtime",
				SharedRuntimeRoot:    "/tmp/shared-runtime",
				ManagedRuntimeSource: "none",
				InstallerScriptURL:   "https://code-server.dev/install.sh",
				Operation: codeserver.RuntimeOperationStatus{
					Action:        "remove_local_environment_version",
					State:         "running",
					Stage:         "removing",
					TargetVersion: version,
				},
			}, nil
		},
		cancelCodeRuntime: func(ctx context.Context) (CodeRuntimeStatus, error) {
			cancelCalls++
			return CodeRuntimeStatus{
				ActiveRuntime: codeserver.RuntimeTargetStatus{
					DetectionState: "missing",
					Source:         "none",
				},
				ManagedRuntime: codeserver.RuntimeTargetStatus{
					DetectionState: "missing",
					Source:         "managed",
				},
				ManagedPrefix:        "/tmp/runtime",
				SharedRuntimeRoot:    "/tmp/shared-runtime",
				ManagedRuntimeSource: "none",
				InstallerScriptURL:   "https://code-server.dev/install.sh",
				Operation: codeserver.RuntimeOperationStatus{
					Action: "install",
					State:  "cancelled",
				},
			}, nil
		},
	}
	gw, err := New(Options{
		Backend:            b,
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfig(t),
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanWrite: true, CanExecute: true}),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	request := func(method string, path string, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Origin", envOrigin)
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		return rr
	}

	statusResp := request(http.MethodGet, "/_redeven_proxy/api/code-runtime/status", "")
	if statusResp.Code != http.StatusOK {
		t.Fatalf("status code=%d, want %d", statusResp.Code, http.StatusOK)
	}
	if !bytes.Contains(statusResp.Body.Bytes(), []byte(`"installer_script_url":"https://code-server.dev/install.sh"`)) {
		t.Fatalf("status body missing installer_script_url: %s", statusResp.Body.String())
	}

	installResp := request(http.MethodPost, "/_redeven_proxy/api/code-runtime/install", "")
	if installResp.Code != http.StatusOK {
		t.Fatalf("install code=%d, want %d", installResp.Code, http.StatusOK)
	}
	if installCalls != 1 {
		t.Fatalf("install_calls=%d, want 1", installCalls)
	}
	if !bytes.Contains(installResp.Body.Bytes(), []byte(`"state":"running"`)) {
		t.Fatalf("install body missing running state: %s", installResp.Body.String())
	}

	selectResp := request(http.MethodPost, "/_redeven_proxy/api/code-runtime/select", `{"version":"4.109.1"}`)
	if selectResp.Code != http.StatusOK {
		t.Fatalf("select code=%d, want %d", selectResp.Code, http.StatusOK)
	}
	if selectCalls != 1 {
		t.Fatalf("select_calls=%d, want 1", selectCalls)
	}
	if !bytes.Contains(selectResp.Body.Bytes(), []byte(`"managed_runtime_version":"4.109.1"`)) {
		t.Fatalf("select body missing selection version: %s", selectResp.Body.String())
	}

	removeVersionResp := request(http.MethodPost, "/_redeven_proxy/api/code-runtime/remove-version", `{"version":"4.109.1"}`)
	if removeVersionResp.Code != http.StatusOK {
		t.Fatalf("remove-version code=%d, want %d", removeVersionResp.Code, http.StatusOK)
	}
	if removeVersionCalls != 1 {
		t.Fatalf("remove_version_calls=%d, want 1", removeVersionCalls)
	}
	if !bytes.Contains(removeVersionResp.Body.Bytes(), []byte(`"target_version":"4.109.1"`)) {
		t.Fatalf("remove-version body missing target version: %s", removeVersionResp.Body.String())
	}

	cancelResp := request(http.MethodPost, "/_redeven_proxy/api/code-runtime/cancel", "")
	if cancelResp.Code != http.StatusOK {
		t.Fatalf("cancel code=%d, want %d", cancelResp.Code, http.StatusOK)
	}
	if cancelCalls != 1 {
		t.Fatalf("cancel_calls=%d, want 1", cancelCalls)
	}
	if !bytes.Contains(cancelResp.Body.Bytes(), []byte(`"state":"cancelled"`)) {
		t.Fatalf("cancel body missing cancelled state: %s", cancelResp.Body.String())
	}
}

func TestGateway_DistRoutes_AreIsolated(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
		"other.txt":      {Data: []byte("should-not-be-served")},
	}
	gw, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// Env UI is only served to env origins.
	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/env/", nil)
		req.Header.Set("Origin", "https://env-123.example.com")
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("env UI status = %d, want %d (Location=%q)", rr.Code, http.StatusOK, rr.Header().Get("Location"))
		}
		if !strings.Contains(rr.Body.String(), "env") {
			t.Fatalf("env UI body mismatch: %q", rr.Body.String())
		}
	}
	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/env/", nil)
		req.Header.Set("Origin", "https://cs-abc.example.com")
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("cs origin env UI status = %d, want %d", rr.Code, http.StatusNotFound)
		}
	}

	// inject.js is accessible from any sandbox origin (and missing Origin).
	for _, origin := range []string{"https://cs-abc.example.com", "https://env-123.example.com", ""} {
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/inject.js", nil)
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("inject.js origin=%q status = %d, want %d", origin, rr.Code, http.StatusOK)
		}
	}

	// Unknown dist files are never served (even if embedded).
	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/other.txt", nil)
		req.Header.Set("Origin", "https://env-123.example.com")
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("other.txt status = %d, want %d", rr.Code, http.StatusNotFound)
		}
	}
}

func TestGateway_DistRoutes_DoNotExposeEnvAppDirectoryListings(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html":       {Data: []byte("<html>env</html>")},
		"env/favicon.svg":      {Data: []byte("<svg>icon</svg>")},
		"env/assets/index.js":  {Data: []byte("console.log('env');")},
		"env/assets/index.css": {Data: []byte("body{}")},
	}
	gw, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	request := func(target string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		req.Header.Set("Origin", "https://env-123.example.com")
		req.Header.Set("Accept", "text/html")
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		return rr
	}

	if rr := request("/_redeven_proxy/env/assets/"); rr.Code != http.StatusNotFound {
		t.Fatalf("assets directory status = %d, want %d; body=%q", rr.Code, http.StatusNotFound, rr.Body.String())
	}
	if rr := request("/_redeven_proxy/env/assets"); rr.Code != http.StatusNotFound {
		t.Fatalf("assets directory without slash status = %d, want %d; body=%q", rr.Code, http.StatusNotFound, rr.Body.String())
	}
	if rr := request("/_redeven_proxy/env/missing.js"); rr.Code != http.StatusNotFound {
		t.Fatalf("missing asset status = %d, want %d; body=%q", rr.Code, http.StatusNotFound, rr.Body.String())
	}
	if rr := request("/_redeven_proxy/env/workbench"); rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "env") {
		t.Fatalf("SPA fallback status/body = %d/%q, want index.html", rr.Code, rr.Body.String())
	}
}

func TestGateway_EnvAppShellReadiness(t *testing.T) {
	t.Parallel()

	newGateway := func(t *testing.T, dist fs.FS) *Gateway {
		t.Helper()
		gw, err := New(Options{
			Backend:            &stubBackend{},
			DistFS:             dist,
			ListenAddr:         "127.0.0.1:0",
			ConfigPath:         writeTestConfig(t),
			ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
		})
		if err != nil {
			t.Fatalf("New: %v", err)
		}
		return gw
	}

	validShell := []byte(`<!doctype html><html><body><div id="root"></div><script type="module" src="/_redeven_proxy/env/assets/index.js"></script></body></html>`)
	if gw := newGateway(t, fstest.MapFS{
		"env/index.html":      {Data: validShell},
		"env/assets/index.js": {Data: []byte("console.log('env');")},
	}); !gw.EnvAppShellReady() {
		t.Fatalf("EnvAppShellReady() = false, want true: %v", gw.EnvAppShellReadinessError())
	}

	if gw := newGateway(t, fstest.MapFS{
		"env/favicon.svg": {Data: []byte("<svg></svg>")},
		"env/logo.png":    {Data: []byte("png")},
	}); gw.EnvAppShellReady() {
		t.Fatalf("EnvAppShellReady() = true, want false for missing shell")
	}

	if gw := newGateway(t, fstest.MapFS{
		"env/index.html": {Data: validShell},
	}); gw.EnvAppShellReady() {
		t.Fatalf("EnvAppShellReady() = true, want false for missing asset")
	}
}

func TestGateway_DistRoutes_AllowExternalOriginWithoutBrowserOriginHeader(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	gw, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/env/", nil)
	req.Host = "env-123.example.com"
	req.Header.Set("X-Forwarded-Proto", "https")
	rr := httptest.NewRecorder()
	gw.serveHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("env UI status = %d, want %d (body=%q)", rr.Code, http.StatusOK, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "env") {
		t.Fatalf("env UI body mismatch: %q", rr.Body.String())
	}
}

func TestGateway_ManagementAPI_AllowsInternalSessionHeaderOnPublicEnvOrigin(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	b := &stubBackend{
		listSpaces: func(ctx context.Context) ([]SpaceStatus, error) {
			return []SpaceStatus{{CodeSpaceID: "abc"}}, nil
		},
	}
	channelID := "ch_test_1"
	gw, err := New(Options{
		Backend:            b,
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfig(t),
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true}),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/spaces", nil)
	req.Host = "env-123.example.com"
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set(sessionhop.HeaderChannelID, channelID)
	rr := httptest.NewRecorder()
	gw.serveHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("env origin with internal channel header status = %d, want %d (body=%q)", rr.Code, http.StatusOK, rr.Body.String())
	}
}

func TestGateway_ManagementAPI_CRUDRoutes(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}

	var (
		gotCreate    *CreateSpaceRequest
		gotUpdateID  string
		gotUpdate    *UpdateSpaceRequest
		gotDeleteID  string
		gotStartID   string
		gotStopID    string
		createCalled bool
		updateCalled bool
		deleteCalled bool
		startCalled  bool
		stopCalled   bool
	)

	b := &stubBackend{
		createSpace: func(ctx context.Context, req CreateSpaceRequest) (*SpaceStatus, error) {
			createCalled = true
			r := req
			gotCreate = &r
			return &SpaceStatus{CodeSpaceID: "abc", WorkspacePath: req.Path, Name: req.Name, Description: req.Description}, nil
		},
		updateSpace: func(ctx context.Context, codeSpaceID string, req UpdateSpaceRequest) (*SpaceStatus, error) {
			updateCalled = true
			gotUpdateID = codeSpaceID
			r := req
			gotUpdate = &r
			name := ""
			desc := ""
			if req.Name != nil {
				name = *req.Name
			}
			if req.Description != nil {
				desc = *req.Description
			}
			return &SpaceStatus{CodeSpaceID: codeSpaceID, Name: name, Description: desc}, nil
		},
		deleteSpace: func(ctx context.Context, codeSpaceID string) error {
			deleteCalled = true
			gotDeleteID = codeSpaceID
			return nil
		},
		startSpace: func(ctx context.Context, codeSpaceID string) (*SpaceStatus, error) {
			startCalled = true
			gotStartID = codeSpaceID
			return &SpaceStatus{CodeSpaceID: codeSpaceID, Running: true, PID: 1234, CodePort: 20001}, nil
		},
		stopSpace: func(ctx context.Context, codeSpaceID string) error {
			stopCalled = true
			gotStopID = codeSpaceID
			return nil
		},
	}

	channelID := "ch_test_2"
	envOrigin := envOriginWithChannel(channelID)
	gw, err := New(Options{
		Backend:            b,
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfig(t),
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// POST create
	{
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/spaces", strings.NewReader(`{
  "path": "/tmp",
  "name": "n",
  "description": "d"
}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("create status = %d, want %d", rr.Code, http.StatusOK)
		}
		var resp struct {
			OK   bool        `json:"ok"`
			Data SpaceStatus `json:"data"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("create unmarshal: %v", err)
		}
		if !resp.OK || resp.Data.CodeSpaceID != "abc" {
			t.Fatalf("unexpected create response: %+v", resp)
		}
		if !createCalled || gotCreate == nil {
			t.Fatalf("create handler not called")
		}
		if gotCreate.Path != "/tmp" || gotCreate.Name != "n" || gotCreate.Description != "d" {
			t.Fatalf("unexpected create args: %+v", gotCreate)
		}
	}

	// PATCH update
	{
		req := httptest.NewRequest(http.MethodPatch, "/_redeven_proxy/api/spaces/abc", strings.NewReader(`{"name":"n2"}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("patch status = %d, want %d", rr.Code, http.StatusOK)
		}
		var resp struct {
			OK   bool        `json:"ok"`
			Data SpaceStatus `json:"data"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("patch unmarshal: %v", err)
		}
		if !resp.OK || resp.Data.CodeSpaceID != "abc" || resp.Data.Name != "n2" {
			t.Fatalf("unexpected patch response: %+v", resp)
		}
		if !updateCalled || gotUpdate == nil || gotUpdateID != "abc" {
			t.Fatalf("update handler not called: id=%q req=%+v", gotUpdateID, gotUpdate)
		}
		if gotUpdate.Name == nil || *gotUpdate.Name != "n2" || gotUpdate.Description != nil {
			t.Fatalf("unexpected update args: %+v", gotUpdate)
		}
	}

	// PATCH with missing fields should be rejected.
	{
		req := httptest.NewRequest(http.MethodPatch, "/_redeven_proxy/api/spaces/abc", strings.NewReader(`{}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("patch missing fields status = %d, want %d", rr.Code, http.StatusBadRequest)
		}
	}

	// POST start
	{
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/spaces/abc/start", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("start status = %d, want %d", rr.Code, http.StatusOK)
		}
		var resp struct {
			OK   bool        `json:"ok"`
			Data SpaceStatus `json:"data"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("start unmarshal: %v", err)
		}
		if !resp.OK || resp.Data.CodeSpaceID != "abc" || resp.Data.CodePort == 0 {
			t.Fatalf("unexpected start response: %+v", resp)
		}
		if !startCalled || gotStartID != "abc" {
			t.Fatalf("start handler not called: %q", gotStartID)
		}
	}

	// POST stop
	{
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/spaces/abc/stop", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("stop status = %d, want %d", rr.Code, http.StatusOK)
		}
		if !stopCalled || gotStopID != "abc" {
			t.Fatalf("stop handler not called: %q", gotStopID)
		}
	}

	// DELETE
	{
		req := httptest.NewRequest(http.MethodDelete, "/_redeven_proxy/api/spaces/abc", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("delete status = %d, want %d", rr.Code, http.StatusOK)
		}
		if !deleteCalled || gotDeleteID != "abc" {
			t.Fatalf("delete handler not called: %q", gotDeleteID)
		}
	}
}

func TestGateway_ManagementAPI_PermissionGates(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}

	channelID := "ch_perm_1"
	envOrigin := envOriginWithChannel(channelID)

	// Admin actions should be forbidden when can_admin=false.
	{
		b := &stubBackend{
			createSpace: func(ctx context.Context, req CreateSpaceRequest) (*SpaceStatus, error) {
				t.Fatalf("CreateSpace must not be called without admin")
				return nil, nil
			},
			updateSpace: func(ctx context.Context, codeSpaceID string, req UpdateSpaceRequest) (*SpaceStatus, error) {
				t.Fatalf("UpdateSpace must not be called without admin")
				return nil, nil
			},
			deleteSpace: func(ctx context.Context, codeSpaceID string) error {
				t.Fatalf("DeleteSpace must not be called without admin")
				return nil
			},
		}
		gw, err := New(Options{
			Backend:            b,
			DistFS:             dist,
			ListenAddr:         "127.0.0.1:0",
			ConfigPath:         writeTestConfig(t),
			ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanExecute: true, CanAdmin: false}),
		})
		if err != nil {
			t.Fatalf("New: %v", err)
		}

		// POST create
		{
			req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/spaces", strings.NewReader(`{"path":"/tmp","name":"n","description":"d"}`))
			req.Header.Set("Origin", envOrigin)
			rr := httptest.NewRecorder()
			gw.serveHTTP(rr, req)
			if rr.Code != http.StatusForbidden {
				t.Fatalf("create status = %d, want %d", rr.Code, http.StatusForbidden)
			}
		}

		// PATCH rename/description
		{
			req := httptest.NewRequest(http.MethodPatch, "/_redeven_proxy/api/spaces/abc", strings.NewReader(`{"name":"n2"}`))
			req.Header.Set("Origin", envOrigin)
			rr := httptest.NewRecorder()
			gw.serveHTTP(rr, req)
			if rr.Code != http.StatusForbidden {
				t.Fatalf("patch status = %d, want %d", rr.Code, http.StatusForbidden)
			}
		}

		// DELETE
		{
			req := httptest.NewRequest(http.MethodDelete, "/_redeven_proxy/api/spaces/abc", nil)
			req.Header.Set("Origin", envOrigin)
			rr := httptest.NewRecorder()
			gw.serveHTTP(rr, req)
			if rr.Code != http.StatusForbidden {
				t.Fatalf("delete status = %d, want %d", rr.Code, http.StatusForbidden)
			}
		}
	}

	// Execute actions should be forbidden when can_execute=false.
	{
		b := &stubBackend{
			startSpace: func(ctx context.Context, codeSpaceID string) (*SpaceStatus, error) {
				t.Fatalf("StartSpace must not be called without execute")
				return nil, nil
			},
			stopSpace: func(ctx context.Context, codeSpaceID string) error {
				t.Fatalf("StopSpace must not be called without execute")
				return nil
			},
		}
		gw, err := New(Options{
			Backend:            b,
			DistFS:             dist,
			ListenAddr:         "127.0.0.1:0",
			ConfigPath:         writeTestConfig(t),
			ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanExecute: false, CanAdmin: true}),
		})
		if err != nil {
			t.Fatalf("New: %v", err)
		}

		// POST start
		{
			req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/spaces/abc/start", nil)
			req.Header.Set("Origin", envOrigin)
			rr := httptest.NewRecorder()
			gw.serveHTTP(rr, req)
			if rr.Code != http.StatusForbidden {
				t.Fatalf("start status = %d, want %d", rr.Code, http.StatusForbidden)
			}
		}

		// POST stop
		{
			req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/spaces/abc/stop", nil)
			req.Header.Set("Origin", envOrigin)
			rr := httptest.NewRecorder()
			gw.serveHTTP(rr, req)
			if rr.Code != http.StatusForbidden {
				t.Fatalf("stop status = %d, want %d", rr.Code, http.StatusForbidden)
			}
		}
	}
}

func TestGateway_Settings_RedactsSecrets(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}

	cfgPath := writeTestConfig(t)
	channelID := "ch_test_3"
	envOrigin := envOriginWithChannel(channelID)
	gw, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         cfgPath,
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true}),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// Env origin should be able to read settings.
	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/settings", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("env origin status = %d, want %d", rr.Code, http.StatusOK)
		}

		var resp map[string]any
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}

		ok, _ := resp["ok"].(bool)
		if !ok {
			t.Fatalf("unexpected ok=%v resp=%v", resp["ok"], resp)
		}

		data, _ := resp["data"].(map[string]any)
		if strings.TrimSpace(data["config_path"].(string)) != cfgPath {
			t.Fatalf("config_path mismatch: got=%q want=%q", data["config_path"], cfgPath)
		}

		conn, _ := data["connection"].(map[string]any)
		direct, _ := conn["direct"].(map[string]any)
		if _, ok := direct["e2ee_psk_b64u"]; ok {
			t.Fatalf("secret leaked: e2ee_psk_b64u must not be returned")
		}
		if direct["e2ee_psk_set"] != true {
			t.Fatalf("e2ee_psk_set mismatch: got=%v want=true", direct["e2ee_psk_set"])
		}
	}

	// Codespace origin should be rejected (404).
	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/settings", nil)
		req.Header.Set("Origin", "https://cs-abc.example.com")
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("cs origin status = %d, want %d", rr.Code, http.StatusNotFound)
		}
	}
}

func TestGateway_SettingsUpdate_ReturnsAIUpdateMeta(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}

	cfgPath := writeTestConfigWithAI(t)
	channelID := "ch_test_settings_ai_update"
	envOrigin := envOriginWithChannel(channelID)
	aiCfg := &config.AIConfig{
		CurrentModelID: "openai/gpt-5-mini",
		Providers: []config.AIProvider{{
			ID:      "openai",
			Name:    "OpenAI",
			Type:    "openai",
			BaseURL: "https://api.openai.com/v1",
			Models: []config.AIProviderModel{
				{ModelName: "gpt-5-mini"},
				{ModelName: "gpt-5"},
			},
		}},
	}
	aiSvc, err := ai.NewService(ai.Options{
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		Shell:        "/bin/sh",
		Config:       aiCfg,
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() {
		_ = aiSvc.Close()
	})

	gw, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		AI:                 aiSvc,
		ConfigPath:         cfgPath,
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanAdmin: true}),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	body := `{
  "ai": {
    "current_model_id": "openai/gpt-5-mini",
    "providers": [
      {
        "id": "openai",
        "name": "OpenAI",
        "type": "openai",
        "base_url": "https://api.openai.com/v1",
        "models": [
          { "model_name": "gpt-5-mini" },
          { "model_name": "gpt-5" }
        ]
      }
    ]
  }
}`

	req := httptest.NewRequest(http.MethodPut, "/_redeven_proxy/api/settings", bytes.NewBufferString(body))
	req.Header.Set("Origin", envOrigin)
	rr := httptest.NewRecorder()
	gw.serveHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", rr.Code, http.StatusOK, rr.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if ok, _ := resp["ok"].(bool); !ok {
		t.Fatalf("unexpected ok=%v resp=%v", resp["ok"], resp)
	}

	data, _ := resp["data"].(map[string]any)
	if data == nil {
		t.Fatalf("missing data object")
	}
	settingsObj, _ := data["settings"].(map[string]any)
	if settingsObj == nil {
		t.Fatalf("missing settings object in update response")
	}
	if gotPath := strings.TrimSpace(settingsObj["config_path"].(string)); gotPath != cfgPath {
		t.Fatalf("config_path mismatch: got=%q want=%q", gotPath, cfgPath)
	}

	aiUpdate, _ := data["ai_update"].(map[string]any)
	if aiUpdate == nil {
		t.Fatalf("missing ai_update object")
	}
	if got := strings.TrimSpace(aiUpdate["apply_scope"].(string)); got != "future_runs" {
		t.Fatalf("apply_scope=%q, want=%q", got, "future_runs")
	}
	if got, ok := aiUpdate["active_run_count"].(float64); !ok || int(got) != 0 {
		t.Fatalf("active_run_count=%v, want=0", aiUpdate["active_run_count"])
	}
}

func TestGateway_LocalUISettingsPermissionCapDoesNotHotReload(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}

	cfgPath := writeTestConfig(t)
	gw, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         cfgPath,
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	saveReq := WithLocalUIEnvRoute(httptest.NewRequest(
		http.MethodPut,
		"/_redeven_proxy/api/settings",
		bytes.NewBufferString(`{"permission_policy":{"schema_version":1,"local_max":{"read":false,"write":false,"execute":false}}}`),
	))
	saveRes := httptest.NewRecorder()
	gw.serveHTTP(saveRes, saveReq)
	if saveRes.Code != http.StatusOK {
		t.Fatalf("save status = %d, want %d body=%s", saveRes.Code, http.StatusOK, saveRes.Body.String())
	}

	getReq := WithLocalUIEnvRoute(httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/settings", nil))
	getRes := httptest.NewRecorder()
	gw.serveHTTP(getRes, getReq)
	if getRes.Code != http.StatusOK {
		t.Fatalf("get status = %d, want %d body=%s", getRes.Code, http.StatusOK, getRes.Body.String())
	}

	var resp struct {
		OK   bool `json:"ok"`
		Data struct {
			PermissionPolicy struct {
				LocalMax struct {
					Read    bool `json:"read"`
					Write   bool `json:"write"`
					Execute bool `json:"execute"`
				} `json:"local_max"`
			} `json:"permission_policy"`
		} `json:"data"`
	}
	if err := json.Unmarshal(getRes.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !resp.OK {
		t.Fatalf("unexpected response: %s", getRes.Body.String())
	}
	if resp.Data.PermissionPolicy.LocalMax.Read || resp.Data.PermissionPolicy.LocalMax.Write || resp.Data.PermissionPolicy.LocalMax.Execute {
		t.Fatalf("permission_policy local_max = %+v, want all false", resp.Data.PermissionPolicy.LocalMax)
	}
}

func TestGateway_AIProviderKeys_StatusAndUpdate(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}

	cfgPath := writeTestConfig(t)
	channelID := "ch_test_keys_1"
	envOrigin := envOriginWithChannel(channelID)
	gw, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         cfgPath,
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanAdmin: true}),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// status: initially missing
	{
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/provider_keys/status", bytes.NewBufferString(`{"provider_ids":["openai","anthropic"]}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status code = %d, want %d body=%s", rr.Code, http.StatusOK, rr.Body.String())
		}
		var resp map[string]any
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		data, _ := resp["data"].(map[string]any)
		set, _ := data["provider_api_key_set"].(map[string]any)
		if set["openai"] != false {
			t.Fatalf("openai set=%v, want=false", set["openai"])
		}
		if set["anthropic"] != false {
			t.Fatalf("anthropic set=%v, want=false", set["anthropic"])
		}
	}

	// set key
	{
		req := httptest.NewRequest(http.MethodPut, "/_redeven_proxy/api/ai/provider_keys", bytes.NewBufferString(`{"patches":[{"provider_id":"openai","api_key":"sk-test"}]}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("set key code = %d, want %d body=%s", rr.Code, http.StatusOK, rr.Body.String())
		}
		var resp map[string]any
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		data, _ := resp["data"].(map[string]any)
		set, _ := data["provider_api_key_set"].(map[string]any)
		if set["openai"] != true {
			t.Fatalf("openai set=%v, want=true", set["openai"])
		}
	}

	// status: openai should be set now
	{
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/provider_keys/status", bytes.NewBufferString(`{"provider_ids":["openai"]}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status code = %d, want %d body=%s", rr.Code, http.StatusOK, rr.Body.String())
		}
		var resp map[string]any
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		data, _ := resp["data"].(map[string]any)
		set, _ := data["provider_api_key_set"].(map[string]any)
		if set["openai"] != true {
			t.Fatalf("openai set=%v, want=true", set["openai"])
		}
	}

	// clear key
	{
		req := httptest.NewRequest(http.MethodPut, "/_redeven_proxy/api/ai/provider_keys", bytes.NewBufferString(`{"patches":[{"provider_id":"openai","api_key":null}]}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("clear key code = %d, want %d body=%s", rr.Code, http.StatusOK, rr.Body.String())
		}
		var resp map[string]any
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		data, _ := resp["data"].(map[string]any)
		set, _ := data["provider_api_key_set"].(map[string]any)
		if set["openai"] != false {
			t.Fatalf("openai set=%v, want=false", set["openai"])
		}
	}
}

func TestGateway_Settings_IncludesAIKeyStatus(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}

	cfgPath := writeTestConfigWithAI(t)
	channelID := "ch_test_keys_2"
	envOrigin := envOriginWithChannel(channelID)
	gw, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         cfgPath,
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanAdmin: true}),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// Set key first.
	{
		req := httptest.NewRequest(http.MethodPut, "/_redeven_proxy/api/ai/provider_keys", bytes.NewBufferString(`{"patches":[{"provider_id":"openai","api_key":"sk-test"}]}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("set key code = %d, want %d body=%s", rr.Code, http.StatusOK, rr.Body.String())
		}
	}

	// Settings should include ai_secrets.provider_api_key_set without leaking secrets.
	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/settings", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("settings status = %d, want %d body=%s", rr.Code, http.StatusOK, rr.Body.String())
		}
		var resp map[string]any
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		data, _ := resp["data"].(map[string]any)
		aiSecrets, _ := data["ai_secrets"].(map[string]any)
		keySet, _ := aiSecrets["provider_api_key_set"].(map[string]any)
		if keySet["openai"] != true {
			t.Fatalf("openai set=%v, want=true", keySet["openai"])
		}

		conn, _ := data["connection"].(map[string]any)
		direct, _ := conn["direct"].(map[string]any)
		if _, ok := direct["e2ee_psk_b64u"]; ok {
			t.Fatalf("secret leaked: e2ee_psk_b64u must not be returned")
		}
	}
}

func TestGateway_AIThreadReadState_ListDetailAndReadArePerUser(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}

	cfgPath := writeTestConfig(t)
	store := openTestThreadReadStateStore(t)
	aiSvc, err := ai.NewService(ai.Options{
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		Shell:        "/bin/sh",
	})
	if err != nil {
		t.Fatalf("ai.NewService: %v", err)
	}
	t.Cleanup(func() {
		_ = aiSvc.Close()
	})

	metaByChannel := map[string]session.Meta{
		"ch_test_ai_read_state_user_1": {
			EndpointID:   "env_read_state",
			UserPublicID: "user_1",
			UserEmail:    "user1@example.com",
			CanRead:      true,
			CanWrite:     true,
			CanExecute:   true,
		},
		"ch_test_ai_read_state_user_2": {
			EndpointID:   "env_read_state",
			UserPublicID: "user_2",
			UserEmail:    "user2@example.com",
			CanRead:      true,
			CanWrite:     true,
			CanExecute:   true,
		},
	}

	resolveMeta := func(channelID string) (*session.Meta, bool) {
		meta, ok := metaByChannel[strings.TrimSpace(channelID)]
		if !ok {
			return nil, false
		}
		meta.ChannelID = strings.TrimSpace(channelID)
		return &meta, true
	}

	creatorMeta := metaByChannel["ch_test_ai_read_state_user_1"]
	thread, err := aiSvc.CreateThread(context.Background(), &creatorMeta, "Thread read state", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := aiSvc.AppendThreadMessage(context.Background(), &creatorMeta, thread.ThreadID, "user", "First prompt", "markdown"); err != nil {
		t.Fatalf("AppendThreadMessage(first): %v", err)
	}

	gw, err := New(Options{
		Backend:              &stubBackend{},
		DistFS:               dist,
		ListenAddr:           "127.0.0.1:0",
		AI:                   aiSvc,
		ConfigPath:           cfgPath,
		ThreadReadStateStore: store,
		ResolveSessionMeta:   resolveMeta,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	type aiThreadReadStatusSnapshot struct {
		LastMessageAtUnixMs int64  `json:"last_message_at_unix_ms"`
		WaitingPromptID     string `json:"waiting_prompt_id"`
	}
	type aiThreadReadStatusState struct {
		LastReadMessageAtUnixMs int64  `json:"last_read_message_at_unix_ms"`
		LastSeenWaitingPromptID string `json:"last_seen_waiting_prompt_id"`
	}
	type aiThreadReadStatus struct {
		IsUnread  bool                       `json:"is_unread"`
		Snapshot  aiThreadReadStatusSnapshot `json:"snapshot"`
		ReadState aiThreadReadStatusState    `json:"read_state"`
	}
	type aiThreadView struct {
		ThreadID   string             `json:"thread_id"`
		ReadStatus aiThreadReadStatus `json:"read_status"`
	}
	type aiListResponse struct {
		OK   bool `json:"ok"`
		Data struct {
			Threads []aiThreadView `json:"threads"`
		} `json:"data"`
	}
	type aiDetailResponse struct {
		OK   bool `json:"ok"`
		Data struct {
			Thread aiThreadView `json:"thread"`
		} `json:"data"`
	}
	type aiMarkReadResponse struct {
		OK   bool `json:"ok"`
		Data struct {
			ReadStatus aiThreadReadStatus `json:"read_status"`
		} `json:"data"`
	}

	channelUser1 := "ch_test_ai_read_state_user_1"
	channelUser2 := "ch_test_ai_read_state_user_2"
	originUser1 := envOriginWithChannel(channelUser1)
	originUser2 := envOriginWithChannel(channelUser2)

	readList := func(origin string) aiListResponse {
		t.Helper()
		rr := performGatewayRequest(gw, http.MethodGet, "/_redeven_proxy/api/ai/threads?limit=20", origin, "")
		if rr.Code != http.StatusOK {
			t.Fatalf("GET /api/ai/threads status=%d body=%s", rr.Code, rr.Body.String())
		}
		var resp aiListResponse
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal list response: %v", err)
		}
		return resp
	}

	readDetail := func(origin string) aiDetailResponse {
		t.Helper()
		rr := performGatewayRequest(gw, http.MethodGet, "/_redeven_proxy/api/ai/threads/"+url.PathEscape(thread.ThreadID), origin, "")
		if rr.Code != http.StatusOK {
			t.Fatalf("GET /api/ai/threads/:id status=%d body=%s", rr.Code, rr.Body.String())
		}
		var resp aiDetailResponse
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal detail response: %v", err)
		}
		return resp
	}

	performAIMarkRead := func(origin string, snapshot aiThreadReadStatusSnapshot) *httptest.ResponseRecorder {
		t.Helper()
		bodyBytes, err := json.Marshal(map[string]any{
			"snapshot": map[string]any{
				"last_message_at_unix_ms": snapshot.LastMessageAtUnixMs,
				"waiting_prompt_id":       snapshot.WaitingPromptID,
			},
		})
		if err != nil {
			t.Fatalf("marshal mark-read body: %v", err)
		}
		rr := performGatewayRequest(
			gw,
			http.MethodPost,
			"/_redeven_proxy/api/ai/threads/"+url.PathEscape(thread.ThreadID)+"/read",
			origin,
			string(bodyBytes),
		)
		return rr
	}

	markRead := func(origin string, snapshot aiThreadReadStatusSnapshot) aiMarkReadResponse {
		t.Helper()
		rr := performAIMarkRead(origin, snapshot)
		if rr.Code != http.StatusOK {
			t.Fatalf("POST /api/ai/threads/:id/read status=%d body=%s", rr.Code, rr.Body.String())
		}
		var resp aiMarkReadResponse
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal mark-read response: %v", err)
		}
		return resp
	}

	firstUserOneList := readList(originUser1)
	if len(firstUserOneList.Data.Threads) != 1 {
		t.Fatalf("user1 thread count=%d, want=1", len(firstUserOneList.Data.Threads))
	}
	if firstUserOneList.Data.Threads[0].ReadStatus.IsUnread {
		t.Fatalf("user1 first list is_unread=true, want=false")
	}

	firstUserTwoList := readList(originUser2)
	if len(firstUserTwoList.Data.Threads) != 1 {
		t.Fatalf("user2 thread count=%d, want=1", len(firstUserTwoList.Data.Threads))
	}
	if firstUserTwoList.Data.Threads[0].ReadStatus.IsUnread {
		t.Fatalf("user2 first list is_unread=true, want=false")
	}

	if err := aiSvc.AppendThreadMessage(context.Background(), &creatorMeta, thread.ThreadID, "user", "Second prompt", "markdown"); err != nil {
		t.Fatalf("AppendThreadMessage(second): %v", err)
	}

	detail := readDetail(originUser1)
	if !detail.Data.Thread.ReadStatus.IsUnread {
		t.Fatalf("user1 detail is_unread=false after new message, want=true")
	}

	invalidRead := performAIMarkRead(originUser1, aiThreadReadStatusSnapshot{
		LastMessageAtUnixMs: detail.Data.Thread.ReadStatus.Snapshot.LastMessageAtUnixMs + 1,
		WaitingPromptID:     detail.Data.Thread.ReadStatus.Snapshot.WaitingPromptID,
	})
	if invalidRead.Code != http.StatusBadRequest {
		t.Fatalf("future ai mark-read status=%d, want=%d body=%s", invalidRead.Code, http.StatusBadRequest, invalidRead.Body.String())
	}
	if !readDetail(originUser1).Data.Thread.ReadStatus.IsUnread {
		t.Fatalf("user1 detail is_unread=false after rejected future mark-read, want=true")
	}

	marked := markRead(originUser1, detail.Data.Thread.ReadStatus.Snapshot)
	if marked.Data.ReadStatus.IsUnread {
		t.Fatalf("mark-read response is_unread=true, want=false")
	}
	if marked.Data.ReadStatus.ReadState.LastReadMessageAtUnixMs != detail.Data.Thread.ReadStatus.Snapshot.LastMessageAtUnixMs {
		t.Fatalf("mark-read last_read_message_at_unix_ms=%d, want=%d", marked.Data.ReadStatus.ReadState.LastReadMessageAtUnixMs, detail.Data.Thread.ReadStatus.Snapshot.LastMessageAtUnixMs)
	}

	userOneAfterRead := readList(originUser1)
	if userOneAfterRead.Data.Threads[0].ReadStatus.IsUnread {
		t.Fatalf("user1 list is_unread=true after mark-read, want=false")
	}

	userTwoAfterRead := readList(originUser2)
	if !userTwoAfterRead.Data.Threads[0].ReadStatus.IsUnread {
		t.Fatalf("user2 list is_unread=false after user1 mark-read, want=true")
	}
}

func TestGateway_AIThreadDeleteRemovesReadStateForAllUsers(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}

	cfgPath := writeTestConfig(t)
	store := openTestThreadReadStateStore(t)
	aiSvc, err := ai.NewService(ai.Options{
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		Shell:        "/bin/sh",
	})
	if err != nil {
		t.Fatalf("ai.NewService: %v", err)
	}
	t.Cleanup(func() {
		_ = aiSvc.Close()
	})

	metaByChannel := map[string]session.Meta{
		"ch_test_ai_delete_cleanup_user_1": {
			EndpointID:   "env_delete_cleanup",
			UserPublicID: "user_1",
			UserEmail:    "user1@example.com",
			CanRead:      true,
			CanWrite:     true,
			CanExecute:   true,
		},
		"ch_test_ai_delete_cleanup_user_2": {
			EndpointID:   "env_delete_cleanup",
			UserPublicID: "user_2",
			UserEmail:    "user2@example.com",
			CanRead:      true,
			CanWrite:     true,
			CanExecute:   true,
		},
	}
	resolveMeta := func(channelID string) (*session.Meta, bool) {
		meta, ok := metaByChannel[strings.TrimSpace(channelID)]
		if !ok {
			return nil, false
		}
		meta.ChannelID = strings.TrimSpace(channelID)
		return &meta, true
	}

	creatorMeta := metaByChannel["ch_test_ai_delete_cleanup_user_1"]
	thread, err := aiSvc.CreateThread(context.Background(), &creatorMeta, "Delete cleanup", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if _, err := store.EnsureFlower(context.Background(), creatorMeta.EndpointID, "user_1", map[string]threadreadstate.FlowerSnapshot{
		thread.ThreadID: {
			LastMessageAtUnixMs: 100,
			WaitingPromptID:     "prompt_1",
		},
	}); err != nil {
		t.Fatalf("EnsureFlower(user_1): %v", err)
	}
	if _, err := store.EnsureFlower(context.Background(), creatorMeta.EndpointID, "user_2", map[string]threadreadstate.FlowerSnapshot{
		thread.ThreadID: {
			LastMessageAtUnixMs: 110,
			WaitingPromptID:     "prompt_2",
		},
	}); err != nil {
		t.Fatalf("EnsureFlower(user_2): %v", err)
	}

	gw, err := New(Options{
		Backend:              &stubBackend{},
		DistFS:               dist,
		ListenAddr:           "127.0.0.1:0",
		AI:                   aiSvc,
		ConfigPath:           cfgPath,
		ThreadReadStateStore: store,
		ResolveSessionMeta:   resolveMeta,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	originUser1 := envOriginWithChannel("ch_test_ai_delete_cleanup_user_1")
	rr := performGatewayRequest(gw, http.MethodDelete, "/_redeven_proxy/api/ai/threads/"+url.PathEscape(thread.ThreadID), originUser1, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("DELETE /api/ai/threads/:id status=%d body=%s", rr.Code, rr.Body.String())
	}

	remaining, err := store.DeleteThread(context.Background(), creatorMeta.EndpointID, threadreadstate.SurfaceFlower, thread.ThreadID)
	if err != nil {
		t.Fatalf("DeleteThread(read_state verify): %v", err)
	}
	if len(remaining) != 0 {
		t.Fatalf("remaining read-state rows=%+v, want none", remaining)
	}

	detailRR := performGatewayRequest(gw, http.MethodGet, "/_redeven_proxy/api/ai/threads/"+url.PathEscape(thread.ThreadID), originUser1, "")
	if detailRR.Code != http.StatusNotFound {
		t.Fatalf("GET deleted thread status=%d, want=%d body=%s", detailRR.Code, http.StatusNotFound, detailRR.Body.String())
	}
}

func TestGateway_DeleteFlowerThreadWithReadStateCleanupRestoresSnapshotOnPrimaryDeleteFailure(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}

	cfgPath := writeTestConfig(t)
	store := openTestThreadReadStateStore(t)

	metaByChannel := map[string]session.Meta{
		"ch_test_ai_delete_restore_user_1": {
			EndpointID:   "env_delete_restore",
			UserPublicID: "user_1",
			UserEmail:    "user1@example.com",
			CanRead:      true,
			CanWrite:     true,
			CanExecute:   true,
		},
		"ch_test_ai_delete_restore_user_2": {
			EndpointID:   "env_delete_restore",
			UserPublicID: "user_2",
			UserEmail:    "user2@example.com",
			CanRead:      true,
			CanWrite:     true,
			CanExecute:   true,
		},
	}
	resolveMeta := func(channelID string) (*session.Meta, bool) {
		meta, ok := metaByChannel[strings.TrimSpace(channelID)]
		if !ok {
			return nil, false
		}
		meta.ChannelID = strings.TrimSpace(channelID)
		return &meta, true
	}

	threadID := "th_missing_restore"
	if _, err := store.EnsureFlower(context.Background(), "env_delete_restore", "user_1", map[string]threadreadstate.FlowerSnapshot{
		threadID: {
			LastMessageAtUnixMs: 200,
			WaitingPromptID:     "prompt_1",
		},
	}); err != nil {
		t.Fatalf("EnsureFlower(user_1): %v", err)
	}
	if _, err := store.EnsureFlower(context.Background(), "env_delete_restore", "user_2", map[string]threadreadstate.FlowerSnapshot{
		threadID: {
			LastMessageAtUnixMs: 210,
			WaitingPromptID:     "prompt_2",
		},
	}); err != nil {
		t.Fatalf("EnsureFlower(user_2): %v", err)
	}

	gw, err := New(Options{
		Backend:              &stubBackend{},
		DistFS:               dist,
		ListenAddr:           "127.0.0.1:0",
		ConfigPath:           cfgPath,
		ThreadReadStateStore: store,
		ResolveSessionMeta:   resolveMeta,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	meta := metaByChannel["ch_test_ai_delete_restore_user_1"]
	called := false
	err = gw.deleteFlowerThreadWithReadStateCleanup(context.Background(), &meta, threadID, func() error {
		called = true
		midDelete, err := store.DeleteThread(context.Background(), meta.EndpointID, threadreadstate.SurfaceFlower, threadID)
		if err != nil {
			t.Fatalf("midDelete verify: %v", err)
		}
		if len(midDelete) != 0 {
			t.Fatalf("midDelete=%+v, want empty because snapshot should already be removed", midDelete)
		}
		return sql.ErrNoRows
	})
	if !called {
		t.Fatalf("primary delete closure was not called")
	}
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("deleteFlowerThreadWithReadStateCleanup err=%v, want %v", err, sql.ErrNoRows)
	}

	restored, err := store.DeleteThread(context.Background(), meta.EndpointID, threadreadstate.SurfaceFlower, threadID)
	if err != nil {
		t.Fatalf("DeleteThread(restored verify): %v", err)
	}
	if len(restored) != 2 {
		t.Fatalf("len(restored)=%d, want 2", len(restored))
	}
	if restored[0].UserPublicID != "user_1" || restored[1].UserPublicID != "user_2" {
		t.Fatalf("restored users=%v, want [user_1 user_2]", []string{restored[0].UserPublicID, restored[1].UserPublicID})
	}
}

func TestGateway_CodexThreadReadState_ListDetailAndReadArePerUser(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}

	cfgPath := writeTestConfig(t)
	store := openTestThreadReadStateStore(t)

	metaByChannel := map[string]session.Meta{
		"ch_test_codex_read_state_user_1": {
			EndpointID:   "env_read_state",
			UserPublicID: "user_1",
			UserEmail:    "user1@example.com",
			CanRead:      true,
			CanWrite:     true,
			CanExecute:   true,
		},
		"ch_test_codex_read_state_user_2": {
			EndpointID:   "env_read_state",
			UserPublicID: "user_2",
			UserEmail:    "user2@example.com",
			CanRead:      true,
			CanWrite:     true,
			CanExecute:   true,
		},
	}
	resolveMeta := func(channelID string) (*session.Meta, bool) {
		meta, ok := metaByChannel[strings.TrimSpace(channelID)]
		if !ok {
			return nil, false
		}
		meta.ChannelID = strings.TrimSpace(channelID)
		return &meta, true
	}

	thread := codexbridge.Thread{
		ID:             "thread_1",
		Preview:        "Investigate repo state",
		ModelProvider:  "openai",
		CreatedAtUnixS: 90,
		UpdatedAtUnixS: 100,
		Status:         "idle",
		CWD:            "/workspace",
	}
	pendingRequests := []codexbridge.PendingRequest{}

	codexBackend := &stubCodexBackend{
		status: func(ctx context.Context) codexbridge.Status {
			return codexbridge.Status{Available: true, Ready: true}
		},
		listThreads: func(ctx context.Context, req codexbridge.ListThreadsRequest) ([]codexbridge.Thread, error) {
			return []codexbridge.Thread{thread}, nil
		},
		readThread: func(ctx context.Context, threadID string) (*codexbridge.ThreadDetail, error) {
			return &codexbridge.ThreadDetail{
				Thread:          thread,
				PendingRequests: append([]codexbridge.PendingRequest(nil), pendingRequests...),
				LastAppliedSeq:  7,
				Stream: codexbridge.ThreadStreamState{
					LastAppliedSeq:    7,
					OldestRetainedSeq: 3,
					StreamEpoch:       2,
					LastEventAtUnixMs: 99,
				},
				ActiveStatus: thread.Status,
			}, nil
		},
	}

	gw, err := New(Options{
		Backend:              &stubBackend{},
		DistFS:               dist,
		ListenAddr:           "127.0.0.1:0",
		Codex:                codexBackend,
		ConfigPath:           cfgPath,
		ThreadReadStateStore: store,
		ResolveSessionMeta:   resolveMeta,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	type codexReadStatusSnapshot struct {
		UpdatedAtUnixS    int64  `json:"updated_at_unix_s"`
		ActivitySignature string `json:"activity_signature"`
	}
	type codexReadStatusState struct {
		LastReadUpdatedAtUnixS    int64  `json:"last_read_updated_at_unix_s"`
		LastSeenActivitySignature string `json:"last_seen_activity_signature"`
	}
	type codexReadStatus struct {
		IsUnread  bool                    `json:"is_unread"`
		Snapshot  codexReadStatusSnapshot `json:"snapshot"`
		ReadState codexReadStatusState    `json:"read_state"`
	}
	type codexThreadView struct {
		ID         string          `json:"id"`
		ReadStatus codexReadStatus `json:"read_status"`
	}
	type codexListResponse struct {
		OK   bool `json:"ok"`
		Data struct {
			Threads []codexThreadView `json:"threads"`
		} `json:"data"`
	}
	type codexDetailResponse struct {
		OK   bool `json:"ok"`
		Data struct {
			Thread codexThreadView `json:"thread"`
		} `json:"data"`
	}
	type codexMarkReadResponse struct {
		OK   bool `json:"ok"`
		Data struct {
			ReadStatus codexReadStatus `json:"read_status"`
		} `json:"data"`
	}

	channelUser1 := "ch_test_codex_read_state_user_1"
	channelUser2 := "ch_test_codex_read_state_user_2"
	originUser1 := envOriginWithChannel(channelUser1)
	originUser2 := envOriginWithChannel(channelUser2)

	readList := func(origin string) codexListResponse {
		t.Helper()
		rr := performGatewayRequest(gw, http.MethodGet, "/_redeven_proxy/api/codex/threads?limit=20", origin, "")
		if rr.Code != http.StatusOK {
			t.Fatalf("GET /api/codex/threads status=%d body=%s", rr.Code, rr.Body.String())
		}
		var resp codexListResponse
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal codex list response: %v", err)
		}
		return resp
	}

	readDetail := func(origin string) codexDetailResponse {
		t.Helper()
		rr := performGatewayRequest(gw, http.MethodGet, "/_redeven_proxy/api/codex/threads/"+url.PathEscape(thread.ID), origin, "")
		if rr.Code != http.StatusOK {
			t.Fatalf("GET /api/codex/threads/:id status=%d body=%s", rr.Code, rr.Body.String())
		}
		var resp codexDetailResponse
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal codex detail response: %v", err)
		}
		return resp
	}

	performCodexMarkRead := func(origin string, snapshot codexReadStatusSnapshot) *httptest.ResponseRecorder {
		t.Helper()
		bodyBytes, err := json.Marshal(map[string]any{
			"snapshot": map[string]any{
				"updated_at_unix_s":  snapshot.UpdatedAtUnixS,
				"activity_signature": snapshot.ActivitySignature,
			},
		})
		if err != nil {
			t.Fatalf("marshal codex mark-read body: %v", err)
		}
		rr := performGatewayRequest(
			gw,
			http.MethodPost,
			"/_redeven_proxy/api/codex/threads/"+url.PathEscape(thread.ID)+"/read",
			origin,
			string(bodyBytes),
		)
		return rr
	}

	markRead := func(origin string, snapshot codexReadStatusSnapshot) codexMarkReadResponse {
		t.Helper()
		rr := performCodexMarkRead(origin, snapshot)
		if rr.Code != http.StatusOK {
			t.Fatalf("POST /api/codex/threads/:id/read status=%d body=%s", rr.Code, rr.Body.String())
		}
		var resp codexMarkReadResponse
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal codex mark-read response: %v", err)
		}
		return resp
	}

	firstUserOneList := readList(originUser1)
	if len(firstUserOneList.Data.Threads) != 1 {
		t.Fatalf("user1 codex thread count=%d, want=1", len(firstUserOneList.Data.Threads))
	}
	if firstUserOneList.Data.Threads[0].ReadStatus.IsUnread {
		t.Fatalf("user1 first codex list is_unread=true, want=false")
	}

	firstUserTwoList := readList(originUser2)
	if len(firstUserTwoList.Data.Threads) != 1 {
		t.Fatalf("user2 codex thread count=%d, want=1", len(firstUserTwoList.Data.Threads))
	}
	if firstUserTwoList.Data.Threads[0].ReadStatus.IsUnread {
		t.Fatalf("user2 first codex list is_unread=true, want=false")
	}

	thread.UpdatedAtUnixS = 101
	thread.Status = "waitingUser"
	pendingRequests = []codexbridge.PendingRequest{{
		ID:       "req_1",
		Type:     "user_input",
		ThreadID: thread.ID,
	}}

	detail := readDetail(originUser1)
	if !detail.Data.Thread.ReadStatus.IsUnread {
		t.Fatalf("user1 codex detail is_unread=false after activity, want=true")
	}
	if detail.Data.Thread.ReadStatus.Snapshot.ActivitySignature != "status:waiting_user\u001frequest:req_1" {
		t.Fatalf("codex detail activity_signature=%q, want detailed signature", detail.Data.Thread.ReadStatus.Snapshot.ActivitySignature)
	}

	invalidCodexRead := performCodexMarkRead(originUser1, codexReadStatusSnapshot{
		UpdatedAtUnixS:    detail.Data.Thread.ReadStatus.Snapshot.UpdatedAtUnixS + 1,
		ActivitySignature: detail.Data.Thread.ReadStatus.Snapshot.ActivitySignature,
	})
	if invalidCodexRead.Code != http.StatusBadRequest {
		t.Fatalf("future codex mark-read status=%d, want=%d body=%s", invalidCodexRead.Code, http.StatusBadRequest, invalidCodexRead.Body.String())
	}
	if !readDetail(originUser1).Data.Thread.ReadStatus.IsUnread {
		t.Fatalf("user1 codex detail is_unread=false after rejected future mark-read, want=true")
	}

	marked := markRead(originUser1, detail.Data.Thread.ReadStatus.Snapshot)
	if marked.Data.ReadStatus.IsUnread {
		t.Fatalf("codex mark-read response is_unread=true, want=false")
	}
	if marked.Data.ReadStatus.ReadState.LastReadUpdatedAtUnixS != 101 {
		t.Fatalf("codex mark-read last_read_updated_at_unix_s=%d, want=101", marked.Data.ReadStatus.ReadState.LastReadUpdatedAtUnixS)
	}

	userOneAfterRead := readList(originUser1)
	if userOneAfterRead.Data.Threads[0].ReadStatus.IsUnread {
		t.Fatalf("user1 codex list is_unread=true after mark-read, want=false")
	}

	userTwoAfterRead := readList(originUser2)
	if !userTwoAfterRead.Data.Threads[0].ReadStatus.IsUnread {
		t.Fatalf("user2 codex list is_unread=false after user1 mark-read, want=true")
	}
}

func TestGateway_CodeServerProxy_RewritesHostAndStripsForwardedHeaders(t *testing.T) {
	t.Parallel()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port

	type seen struct {
		Host            string `json:"host"`
		Origin          string `json:"origin"`
		Forwarded       string `json:"forwarded"`
		XForwardedHost  string `json:"x_forwarded_host"`
		XForwardedFor   string `json:"x_forwarded_for"`
		XForwardedProto string `json:"x_forwarded_proto"`
	}

	srv := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewEncoder(w).Encode(seen{
				Host:            r.Host,
				Origin:          r.Header.Get("Origin"),
				Forwarded:       r.Header.Get("Forwarded"),
				XForwardedHost:  r.Header.Get("X-Forwarded-Host"),
				XForwardedFor:   r.Header.Get("X-Forwarded-For"),
				XForwardedProto: r.Header.Get("X-Forwarded-Proto"),
			})
		}),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	b := &stubBackend{
		resolveCodeServerPort: func(ctx context.Context, codeSpaceID string) (int, error) {
			if codeSpaceID != "abc" {
				return 0, errors.New("unexpected codeSpaceID")
			}
			return port, nil
		},
	}
	gw, err := New(Options{
		Backend:            b,
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	origin := "https://cs-abc.example.com"
	req := httptest.NewRequest(http.MethodGet, "http://ignored.local/foo", nil)
	req.Header.Set("Origin", origin)
	req.Header.Set("Forwarded", "for=1.2.3.4;proto=https;host=evil.example.com")
	req.Header.Set("X-Forwarded-Host", "evil.example.com")
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	req.Header.Set("X-Forwarded-Proto", "https")

	rr := httptest.NewRecorder()
	gw.serveHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%q", rr.Code, http.StatusOK, rr.Body.String())
	}

	var got seen
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Host != "cs-abc.example.com" {
		t.Fatalf("upstream Host = %q, want %q", got.Host, "cs-abc.example.com")
	}
	if got.Origin != origin {
		t.Fatalf("upstream Origin = %q, want %q", got.Origin, origin)
	}
	if got.Forwarded != "" || got.XForwardedHost != "" || got.XForwardedFor != "" || got.XForwardedProto != "" {
		t.Fatalf("forwarded headers were not stripped: %+v", got)
	}
}

func TestGateway_CodeServerProxy_ServesVSDAWebShim(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	b := &stubBackend{
		resolveCodeServerPort: func(ctx context.Context, codeSpaceID string) (int, error) {
			return 0, errors.New("should not be called")
		},
	}
	gw, err := New(Options{
		Backend:            b,
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// JS shim
	{
		req := httptest.NewRequest(http.MethodGet, "http://ignored.local/stable-dev/static/node_modules/vsda/rust/web/vsda.js", nil)
		req.Header.Set("Origin", "https://cs-abc.example.com")
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("vsda.js status = %d, want %d, body=%q", rr.Code, http.StatusOK, rr.Body.String())
		}
		if ct := rr.Header().Get("Content-Type"); !strings.Contains(ct, "text/javascript") {
			t.Fatalf("vsda.js Content-Type = %q, want javascript", ct)
		}
		if !bytes.Contains(rr.Body.Bytes(), []byte("vsda_web")) {
			t.Fatalf("vsda.js body does not contain vsda_web")
		}
		if !bytes.Contains(rr.Body.Bytes(), []byte("define")) {
			t.Fatalf("vsda.js body does not contain define (AMD shim)")
		}
	}

	// WASM shim
	{
		req := httptest.NewRequest(http.MethodGet, "http://ignored.local/stable-dev/static/node_modules/vsda/rust/web/vsda_bg.wasm", nil)
		req.Header.Set("Origin", "https://cs-abc.example.com")
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("vsda_bg.wasm status = %d, want %d, body=%q", rr.Code, http.StatusOK, rr.Body.String())
		}
		if ct := rr.Header().Get("Content-Type"); !strings.Contains(ct, "application/wasm") {
			t.Fatalf("vsda_bg.wasm Content-Type = %q, want wasm", ct)
		}
		if rr.Body.Len() == 0 {
			t.Fatalf("vsda_bg.wasm body is empty")
		}
		// Keep it a multiple of 16 so VS Code's AES-CBC decrypt loop doesn't immediately error.
		if rr.Body.Len()%16 != 0 {
			t.Fatalf("vsda_bg.wasm body len = %d, want multiple of 16", rr.Body.Len())
		}
	}
}

func TestGateway_CodeServerProxy_CodespaceRootRedirectsToWorkspaceFolder(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	b := &stubBackend{
		listSpaces: func(ctx context.Context) ([]SpaceStatus, error) {
			return []SpaceStatus{
				{CodeSpaceID: "abc", WorkspacePath: "/tmp/ws"},
			}, nil
		},
		resolveCodeServerPort: func(ctx context.Context, codeSpaceID string) (int, error) {
			return 0, errors.New("should not be called")
		},
	}
	gw, err := New(Options{
		Backend:            b,
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "http://ignored.local/", nil)
	req.Header.Set("Origin", "https://cs-abc.example.com")
	rr := httptest.NewRecorder()
	gw.serveHTTP(rr, req)
	if rr.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusFound)
	}

	loc := rr.Header().Get("Location")
	u, err := url.Parse(loc)
	if err != nil {
		t.Fatalf("parse Location %q: %v", loc, err)
	}
	if u.Path != "/" {
		t.Fatalf("Location path = %q, want %q", u.Path, "/")
	}
	if got := u.Query().Get("folder"); got != "/tmp/ws" {
		t.Fatalf("Location folder = %q, want %q (Location=%q)", got, "/tmp/ws", loc)
	}
	if got := u.Query().Get("workspace"); got != "" {
		t.Fatalf("Location workspace = %q, want empty (Location=%q)", got, loc)
	}
}

func TestGateway_CodeServerProxy_CodespaceRootRedirectsToWorkspaceFolder_WithoutOrigin(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	b := &stubBackend{
		listSpaces: func(ctx context.Context) ([]SpaceStatus, error) {
			return []SpaceStatus{{CodeSpaceID: "abc", WorkspacePath: "/tmp/ws"}}, nil
		},
		resolveCodeServerPort: func(ctx context.Context, codeSpaceID string) (int, error) {
			return 0, errors.New("should not be called")
		},
	}
	gw, err := New(Options{
		Backend:            b,
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "http://ignored.local/", nil)
	req.Host = "cs-abc.example.com"
	req.Header.Set("X-Forwarded-Proto", "https")
	// Top-level navigation commonly omits Origin; the gateway should fall back to Host.
	rr := httptest.NewRecorder()
	gw.serveHTTP(rr, req)
	if rr.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusFound)
	}

	loc := rr.Header().Get("Location")
	u, err := url.Parse(loc)
	if err != nil {
		t.Fatalf("parse Location %q: %v", loc, err)
	}
	if got := u.Query().Get("folder"); got != "/tmp/ws" {
		t.Fatalf("Location folder = %q, want %q (Location=%q)", got, "/tmp/ws", loc)
	}
}

func TestGateway_CodeServerProxy_RequiresCodespaceOrigin(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	b := &stubBackend{
		resolveCodeServerPort: func(ctx context.Context, codeSpaceID string) (int, error) {
			return 0, errors.New("should not be called")
		},
	}
	gw, err := New(Options{
		Backend:            b,
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "http://ignored.local/", nil)
	req.Header.Set("Origin", "https://env-123.example.com")
	rr := httptest.NewRecorder()
	gw.serveHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusNotFound)
	}
}

func TestGateway_DistFS_UsesEmbedLayout(t *testing.T) {
	t.Parallel()

	// Guardrail: the gateway expects DistFS to be rooted at "dist/" and serve:
	// - /_redeven_proxy/env/* -> env/*
	// - /_redeven_proxy/inject.js -> inject.js
	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	gw, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/inject.js", nil)
	rr := httptest.NewRecorder()
	gw.serveHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("inject.js status = %d, want %d", rr.Code, http.StatusOK)
	}
}
