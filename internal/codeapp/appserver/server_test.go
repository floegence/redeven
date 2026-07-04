package appserver

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base32"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
	"github.com/floegence/redeven/internal/threadreadstate"
)

type stubBackend struct {
	listSpaces                       func(ctx context.Context) ([]SpaceStatus, error)
	createSpace                      func(ctx context.Context, req CreateSpaceRequest) (*SpaceStatus, error)
	updateSpace                      func(ctx context.Context, codeSpaceID string, req UpdateSpaceRequest) (*SpaceStatus, error)
	deleteSpace                      func(ctx context.Context, codeSpaceID string) error
	startSpace                       func(ctx context.Context, codeSpaceID string) (*SpaceStatus, error)
	stopSpace                        func(ctx context.Context, codeSpaceID string) error
	resolveCodeServerPort            func(ctx context.Context, codeSpaceID string) (int, error)
	codeRuntimeStatus                func(ctx context.Context) (CodeRuntimeStatus, error)
	createCodeRuntimeImportSession   func(ctx context.Context, manifest CodeRuntimeArtifactManifest) (CodeRuntimeImportSession, error)
	appendCodeRuntimeImportChunk     func(ctx context.Context, uploadID string, chunkIndex int64, body io.Reader) (CodeRuntimeImportChunkResult, error)
	completeCodeRuntimeImportSession func(ctx context.Context, uploadID string) (CodeRuntimeStatus, error)
	selectCodeRuntime                func(ctx context.Context, version string) (CodeRuntimeStatus, error)
	removeCodeRuntimeVersion         func(ctx context.Context, version string) (CodeRuntimeStatus, error)
	cancelCodeRuntime                func(ctx context.Context) (CodeRuntimeStatus, error)
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
func (s *stubBackend) CreateCodeRuntimeImportSession(ctx context.Context, manifest CodeRuntimeArtifactManifest) (CodeRuntimeImportSession, error) {
	if s.createCodeRuntimeImportSession != nil {
		return s.createCodeRuntimeImportSession(ctx, manifest)
	}
	return CodeRuntimeImportSession{}, errors.New("not implemented")
}
func (s *stubBackend) AppendCodeRuntimeImportChunk(ctx context.Context, uploadID string, chunkIndex int64, body io.Reader) (CodeRuntimeImportChunkResult, error) {
	if s.appendCodeRuntimeImportChunk != nil {
		return s.appendCodeRuntimeImportChunk(ctx, uploadID, chunkIndex, body)
	}
	return CodeRuntimeImportChunkResult{}, errors.New("not implemented")
}
func (s *stubBackend) CompleteCodeRuntimeImportSession(ctx context.Context, uploadID string) (CodeRuntimeStatus, error) {
	if s.completeCodeRuntimeImportSession != nil {
		return s.completeCodeRuntimeImportSession(ctx, uploadID)
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

func newDistRouteTestServer(t *testing.T, dist fs.FS, backend Backend) *Server {
	t.Helper()
	if backend == nil {
		backend = &stubBackend{}
	}
	srv, err := New(Options{
		Backend:            backend,
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return srv
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

func performServerRequest(srv *Server, method string, path string, origin string, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	rr := httptest.NewRecorder()
	srv.serveHTTP(rr, req)
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

func TestServer_ManagementAPI_EnvOriginOnly(t *testing.T) {
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
	srv, err := New(Options{
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
		srv.serveHTTP(rr, req)

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
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("cs origin status = %d, want %d", rr.Code, http.StatusNotFound)
		}
	}
}

func TestServer_CodeRuntimeRoutes(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
	}
	channelID := "ch_runtime"
	envOrigin := envOriginWithChannel(channelID)
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
				Operation: codeserver.RuntimeOperationStatus{
					State: "idle",
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
			}, nil
		},
		removeCodeRuntimeVersion: func(ctx context.Context, version string) (CodeRuntimeStatus, error) {
			removeVersionCalls++
			return CodeRuntimeStatus{
				ManagedPrefix:        "/tmp/runtime",
				SharedRuntimeRoot:    "/tmp/shared-runtime",
				ManagedRuntimeSource: "none",
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
				Operation: codeserver.RuntimeOperationStatus{
					Action: "prepare_workspace_engine",
					State:  "cancelled",
				},
			}, nil
		},
	}
	srv, err := New(Options{
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
		srv.serveHTTP(rr, req)
		return rr
	}

	statusResp := request(http.MethodGet, "/_redeven_proxy/api/code-runtime/status", "")
	if statusResp.Code != http.StatusOK {
		t.Fatalf("status code=%d, want %d", statusResp.Code, http.StatusOK)
	}
	if !bytes.Contains(statusResp.Body.Bytes(), []byte(`"platform"`)) {
		t.Fatalf("status body missing platform: %s", statusResp.Body.String())
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

func TestServer_DistRoutes_AreIsolated(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
		"other.txt":      {Data: []byte("should-not-be-served")},
	}
	srv, err := New(Options{
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
		srv.serveHTTP(rr, req)
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
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("cs origin env UI status = %d, want %d", rr.Code, http.StatusNotFound)
		}
	}

	// inject.js is only served to codespace origins.
	for _, tc := range []struct {
		name   string
		origin string
		want   int
	}{
		{name: "codespace", origin: "https://cs-abc.example.com", want: http.StatusOK},
		{name: "env", origin: "https://env-123.example.com", want: http.StatusNotFound},
		{name: "plugin", origin: "https://plg-containers.example.com", want: http.StatusNotFound},
		{name: "missing_origin", origin: "", want: http.StatusNotFound},
	} {
		t.Run("inject/"+tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/inject.js", nil)
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			rr := httptest.NewRecorder()
			srv.serveHTTP(rr, req)
			if rr.Code != tc.want {
				t.Fatalf("inject.js origin=%q status = %d, want %d", tc.origin, rr.Code, tc.want)
			}
		})
	}

	// Unknown dist files are never served (even if embedded).
	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/other.txt", nil)
		req.Header.Set("Origin", "https://env-123.example.com")
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("other.txt status = %d, want %d", rr.Code, http.StatusNotFound)
		}
	}
}

func TestServer_ProxyOriginRouteMatrix(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	channelID := "ch_route_matrix"
	envOrigin := envOriginWithChannel(channelID)
	srv, err := New(Options{
		Backend: &stubBackend{
			listSpaces: func(ctx context.Context) ([]SpaceStatus, error) {
				return []SpaceStatus{{CodeSpaceID: "abc"}}, nil
			},
		},
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfig(t),
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true}),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	type routeCase struct {
		name string
		path string
	}
	routes := []routeCase{
		{name: "api", path: "/_redeven_proxy/api/spaces"},
		{name: "env", path: "/_redeven_proxy/env/"},
		{name: "inject", path: "/_redeven_proxy/inject.js"},
		{name: "plugin_namespace", path: "/_redeven_plugin/surfaces/containers/index.html"},
	}
	origins := []struct {
		name       string
		origin     string
		wantStatus map[string]int
	}{
		{
			name:   "env",
			origin: envOrigin,
			wantStatus: map[string]int{
				"api":              http.StatusOK,
				"env":              http.StatusOK,
				"inject":           http.StatusNotFound,
				"plugin_namespace": http.StatusNotFound,
			},
		},
		{
			name:   "codespace",
			origin: "https://cs-abc.example.com",
			wantStatus: map[string]int{
				"api":              http.StatusNotFound,
				"env":              http.StatusNotFound,
				"inject":           http.StatusOK,
				"plugin_namespace": http.StatusNotFound,
			},
		},
		{
			name:   "port_forward",
			origin: "https://pf-abc.example.com",
			wantStatus: map[string]int{
				"api":              http.StatusNotFound,
				"env":              http.StatusNotFound,
				"inject":           http.StatusNotFound,
				"plugin_namespace": http.StatusNotFound,
			},
		},
		{
			name:   "plugin",
			origin: "https://plg-containers.example.com",
			wantStatus: map[string]int{
				"api":              http.StatusNotFound,
				"env":              http.StatusNotFound,
				"inject":           http.StatusNotFound,
				"plugin_namespace": http.StatusNotFound,
			},
		},
		{
			name:   "unknown",
			origin: "https://unknown.example.com",
			wantStatus: map[string]int{
				"api":              http.StatusNotFound,
				"env":              http.StatusNotFound,
				"inject":           http.StatusNotFound,
				"plugin_namespace": http.StatusNotFound,
			},
		},
		{
			name:   "missing_origin",
			origin: "",
			wantStatus: map[string]int{
				"api":              http.StatusNotFound,
				"env":              http.StatusNotFound,
				"inject":           http.StatusNotFound,
				"plugin_namespace": http.StatusNotFound,
			},
		},
	}

	for _, origin := range origins {
		for _, route := range routes {
			t.Run(origin.name+"/"+route.name, func(t *testing.T) {
				req := httptest.NewRequest(http.MethodGet, route.path, nil)
				if origin.origin != "" {
					req.Header.Set("Origin", origin.origin)
				}
				rr := httptest.NewRecorder()
				srv.serveHTTP(rr, req)
				want := origin.wantStatus[route.name]
				if rr.Code != want {
					t.Fatalf("%s from %s status = %d, want %d; body=%q", route.path, origin.name, rr.Code, want, rr.Body.String())
				}
				if want != http.StatusOK {
					return
				}
				switch route.name {
				case "api":
					if !bytes.Contains(rr.Body.Bytes(), []byte(`"ok":true`)) {
						t.Fatalf("api response missing ok=true: %s", rr.Body.String())
					}
				case "env":
					if !strings.Contains(rr.Body.String(), "env") {
						t.Fatalf("env response body mismatch: %q", rr.Body.String())
					}
				case "inject":
					if !strings.Contains(rr.Body.String(), "inject") {
						t.Fatalf("inject response body mismatch: %q", rr.Body.String())
					}
				}
			})
		}
	}
}

func TestServer_PluginNamespaceRouteMatrix(t *testing.T) {
	t.Parallel()

	srv := newDistRouteTestServer(t, fstest.MapFS{
		"env/index.html":           {Data: []byte("<html>env</html>")},
		"env/assets/index.js":      {Data: []byte("console.log('env');")},
		"inject.js":                {Data: []byte("console.log('inject');")},
		"surfaces/plugin/app.html": {Data: []byte("<html>plugin</html>")},
	}, nil)

	routes := []struct {
		name   string
		method string
		path   string
	}{
		{name: "root", method: http.MethodGet, path: "/_redeven_plugin"},
		{name: "root_slash", method: http.MethodGet, path: "/_redeven_plugin/"},
		{name: "bootstrap", method: http.MethodGet, path: "/_redeven_plugin/bootstrap"},
		{name: "asset", method: http.MethodGet, path: "/_redeven_plugin/assets/index.js"},
		{name: "stream", method: http.MethodGet, path: "/_redeven_plugin/stream/logs?ticket=fixture"},
		{name: "csp_report", method: http.MethodPost, path: "/_redeven_plugin/csp-report"},
	}
	origins := []struct {
		name   string
		origin string
	}{
		{name: "missing_origin"},
		{name: "env", origin: "https://env-local.example.com"},
		{name: "codespace", origin: "https://cs-abc.example.com"},
		{name: "port_forward", origin: "https://pf-3000.example.com"},
		{name: "plugin", origin: "https://plg-containers.example.com"},
		{name: "unknown", origin: "https://unknown.example.com"},
	}

	for _, origin := range origins {
		for _, route := range routes {
			t.Run(origin.name+"/"+route.name, func(t *testing.T) {
				req := httptest.NewRequest(route.method, route.path, nil)
				if origin.origin != "" {
					req.Header.Set("Origin", origin.origin)
				}
				rr := httptest.NewRecorder()
				srv.serveHTTP(rr, req)
				if rr.Code != http.StatusNotFound {
					t.Fatalf("%s from %s status = %d, want %d; body=%q", route.path, origin.name, rr.Code, http.StatusNotFound, rr.Body.String())
				}
				if strings.Contains(rr.Body.String(), "<html>env</html>") {
					t.Fatalf("plugin namespace fell through to Env App shell: %q", rr.Body.String())
				}
				if strings.Contains(rr.Body.String(), "console.log('env');") {
					t.Fatalf("plugin namespace fell through to Env App asset: %q", rr.Body.String())
				}
				if strings.Contains(rr.Body.String(), "console.log('inject');") {
					t.Fatalf("plugin namespace fell through to codespace inject script: %q", rr.Body.String())
				}
			})
		}
	}
}

func TestWithLocalUIPluginRoute_SetsPluginRouteKind(t *testing.T) {
	t.Parallel()

	req := WithLocalUIPluginRoute(httptest.NewRequest(http.MethodGet, "/_redeven_plugin/bootstrap", nil))
	route, ok := localUIRouteFromRequest(req)
	if !ok {
		t.Fatal("local UI plugin route context missing")
	}
	if route.kind != localUIRoutePlugin {
		t.Fatalf("route kind = %v, want %v", route.kind, localUIRoutePlugin)
	}
}

func TestServer_DistRoutes_DoNotExposeEnvAppDirectoryListings(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html":       {Data: []byte("<html>env</html>")},
		"env/favicon.svg":      {Data: []byte("<svg>icon</svg>")},
		"env/assets/index.js":  {Data: []byte("console.log('env');")},
		"env/assets/index.css": {Data: []byte("body{}")},
	}
	srv, err := New(Options{
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
		srv.serveHTTP(rr, req)
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

func TestServer_EnvAppDistCacheHeadersScope(t *testing.T) {
	t.Parallel()

	const immutableCache = "private, max-age=31536000, immutable"
	dist := fstest.MapFS{
		"env/index.html":                  {Data: []byte("<html>env</html>")},
		"env/favicon.svg":                 {Data: []byte("<svg>icon</svg>")},
		"env/logo.png":                    {Data: []byte("png")},
		"env/assets/index-DXRlscZd.js":    {Data: []byte("console.log('env');")},
		"env/assets/index-DXRlscZd.js.gz": {Data: []byte("compressed")},
		"env/assets/index.js":             {Data: []byte("console.log('unhashed');")},
		"env/assets/index-BU2ORefM.css":   {Data: []byte("body{}")},
		"env/assets/icon-DXRlscZd.woff2":  {Data: []byte("font")},
		"inject.js":                       {Data: []byte("console.log('inject');")},
	}
	srv := newDistRouteTestServer(t, dist, &stubBackend{
		listSpaces: func(ctx context.Context) ([]SpaceStatus, error) {
			return nil, nil
		},
	})
	request := func(method string, target string, origin string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, target, nil)
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		req.Header.Set("Accept", "text/html")
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		return rr
	}
	assertCacheForOrigin := func(target string, origin string, wantStatus int, wantCache string) {
		t.Helper()
		rr := request(http.MethodGet, target, origin)
		if rr.Code != wantStatus {
			t.Fatalf("%s status = %d, want %d; body=%q", target, rr.Code, wantStatus, rr.Body.String())
		}
		if got := rr.Header().Get("Cache-Control"); got != wantCache {
			t.Fatalf("%s Cache-Control = %q, want %q", target, got, wantCache)
		}
	}
	assertCache := func(target string, wantStatus int, wantCache string) {
		t.Helper()
		assertCacheForOrigin(target, "https://env-123.example.com", wantStatus, wantCache)
	}

	assertCache("/_redeven_proxy/env/", http.StatusOK, "no-store")
	assertCache("/_redeven_proxy/env/index.html", http.StatusOK, "no-store")
	assertCache("/_redeven_proxy/env/workbench", http.StatusOK, "no-store")
	assertCacheForOrigin("/_redeven_proxy/inject.js", "https://cs-abc.example.com", http.StatusOK, "no-store")
	assertCacheForOrigin("/_redeven_proxy/inject.js", "https://env-123.example.com", http.StatusNotFound, "no-store")
	assertCache("/_redeven_proxy/env/favicon.svg", http.StatusOK, "no-store")
	assertCache("/_redeven_proxy/env/logo.png", http.StatusOK, "no-store")
	assertCache("/_redeven_proxy/api/spaces", http.StatusBadRequest, "no-store")
	assertCache("/_redeven_proxy/env/assets/index.js", http.StatusOK, "no-store")
	assertCache("/_redeven_proxy/env/assets/index-DXRlscZd.js?v=1", http.StatusOK, "no-store")
	assertCache("/_redeven_proxy/env/assets/index-DXRlscZd.js.gz", http.StatusNotFound, "no-store")
	assertCache("/_redeven_proxy/env/assets/index-DXRlscZd.js.br", http.StatusNotFound, "no-store")
	assertCache("/_redeven_proxy/env/assets/index-DXRlscZd.js", http.StatusOK, immutableCache)
	assertCache("/_redeven_proxy/env/assets/index-BU2ORefM.css", http.StatusOK, immutableCache)
	assertCache("/_redeven_proxy/env/assets/icon-DXRlscZd.woff2", http.StatusOK, immutableCache)

	rr := request(http.MethodGet, "/_redeven_proxy/env/assets/index-DXRlscZd.js", "https://cs-abc.example.com")
	if rr.Code != http.StatusNotFound {
		t.Fatalf("cs origin asset status = %d, want %d", rr.Code, http.StatusNotFound)
	}
	if got := rr.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("cs origin asset Cache-Control = %q, want no-store", got)
	}
}

func TestServer_EnvAppDistCompressedAssetNegotiation(t *testing.T) {
	t.Parallel()

	const immutableCache = "private, max-age=31536000, immutable"
	original := []byte("console.log('env');")
	gzipBody := []byte("gzip bytes")
	brotliBody := []byte("brotli bytes")
	dist := fstest.MapFS{
		"env/index.html":                  {Data: []byte("<html>env</html>")},
		"env/assets/index-DXRlscZd.js":    {Data: original},
		"env/assets/index-DXRlscZd.js.gz": {Data: gzipBody},
		"env/assets/index-DXRlscZd.js.br": {Data: brotliBody},
	}
	srv := newDistRouteTestServer(t, dist, nil)
	request := func(acceptEncoding string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/env/assets/index-DXRlscZd.js", nil)
		req.Header.Set("Origin", "https://env-123.example.com")
		if acceptEncoding != "" {
			req.Header.Set("Accept-Encoding", acceptEncoding)
		}
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		return rr
	}

	for _, tc := range []struct {
		name           string
		acceptEncoding string
		wantEncoding   string
		wantBody       []byte
	}{
		{name: "brotli preferred", acceptEncoding: "gzip, br", wantEncoding: "br", wantBody: brotliBody},
		{name: "gzip fallback", acceptEncoding: "gzip", wantEncoding: "gzip", wantBody: gzipBody},
		{name: "brotli disabled", acceptEncoding: "br;q=0, gzip;q=1", wantEncoding: "gzip", wantBody: gzipBody},
		{name: "wildcard", acceptEncoding: "*;q=1", wantEncoding: "br", wantBody: brotliBody},
		{name: "disabled", acceptEncoding: "br;q=0, gzip;q=0, *;q=0", wantEncoding: "", wantBody: original},
		{name: "identity", acceptEncoding: "", wantEncoding: "", wantBody: original},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rr := request(tc.acceptEncoding)
			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d; body=%q", rr.Code, http.StatusOK, rr.Body.String())
			}
			if got := rr.Header().Get("Cache-Control"); got != immutableCache {
				t.Fatalf("Cache-Control = %q, want %q", got, immutableCache)
			}
			if got := rr.Header().Get("Vary"); got != "Accept-Encoding" {
				t.Fatalf("Vary = %q, want Accept-Encoding", got)
			}
			if got := rr.Header().Get("Content-Encoding"); got != tc.wantEncoding {
				t.Fatalf("Content-Encoding = %q, want %q", got, tc.wantEncoding)
			}
			if got := rr.Header().Get("Content-Type"); got != "text/javascript; charset=utf-8" {
				t.Fatalf("Content-Type = %q, want text/javascript; charset=utf-8", got)
			}
			if got := rr.Body.Bytes(); !bytes.Equal(got, tc.wantBody) {
				t.Fatalf("body = %q, want %q", got, tc.wantBody)
			}
		})
	}
}

func TestServer_EnvAppDistCompressedAssetHeadAndRange(t *testing.T) {
	t.Parallel()

	original := []byte("0123456789")
	gzipBody := []byte("gzip bytes")
	dist := fstest.MapFS{
		"env/index.html":                  {Data: []byte("<html>env</html>")},
		"env/assets/index-DXRlscZd.js":    {Data: original},
		"env/assets/index-DXRlscZd.js.gz": {Data: gzipBody},
	}
	srv := newDistRouteTestServer(t, dist, nil)

	headReq := httptest.NewRequest(http.MethodHead, "/_redeven_proxy/env/assets/index-DXRlscZd.js", nil)
	headReq.Header.Set("Origin", "https://env-123.example.com")
	headReq.Header.Set("Accept-Encoding", "gzip")
	headResp := httptest.NewRecorder()
	srv.serveHTTP(headResp, headReq)
	if headResp.Code != http.StatusOK {
		t.Fatalf("HEAD status = %d, want %d", headResp.Code, http.StatusOK)
	}
	if got := headResp.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("HEAD Content-Encoding = %q, want gzip", got)
	}
	if got := headResp.Header().Get("Content-Length"); got != fmt.Sprint(len(gzipBody)) {
		t.Fatalf("HEAD Content-Length = %q, want %d", got, len(gzipBody))
	}
	if got := headResp.Body.String(); got != "" {
		t.Fatalf("HEAD body = %q, want empty", got)
	}

	rangeReq := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/env/assets/index-DXRlscZd.js", nil)
	rangeReq.Header.Set("Origin", "https://env-123.example.com")
	rangeReq.Header.Set("Accept-Encoding", "br, gzip")
	rangeReq.Header.Set("Range", "bytes=2-5")
	rangeResp := httptest.NewRecorder()
	srv.serveHTTP(rangeResp, rangeReq)
	if rangeResp.Code != http.StatusPartialContent {
		t.Fatalf("Range status = %d, want %d; body=%q", rangeResp.Code, http.StatusPartialContent, rangeResp.Body.String())
	}
	if got := rangeResp.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("Range Content-Encoding = %q, want empty", got)
	}
	if got := rangeResp.Header().Get("Content-Range"); got != "bytes 2-5/10" {
		t.Fatalf("Range Content-Range = %q, want bytes 2-5/10", got)
	}
	if got := rangeResp.Body.String(); got != "2345" {
		t.Fatalf("Range body = %q, want 2345", got)
	}
}

func TestServer_EnvAppShellReadiness(t *testing.T) {
	t.Parallel()

	newServer := func(t *testing.T, dist fs.FS) *Server {
		t.Helper()
		srv, err := New(Options{
			Backend:            &stubBackend{},
			DistFS:             dist,
			ListenAddr:         "127.0.0.1:0",
			ConfigPath:         writeTestConfig(t),
			ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
		})
		if err != nil {
			t.Fatalf("New: %v", err)
		}
		return srv
	}

	validShell := []byte(`<!doctype html><html><body><div id="root"></div><script type="module" src="/_redeven_proxy/env/assets/index.js"></script></body></html>`)
	if srv := newServer(t, fstest.MapFS{
		"env/index.html":      {Data: validShell},
		"env/assets/index.js": {Data: []byte("console.log('env');")},
	}); !srv.EnvAppShellReady() {
		t.Fatalf("EnvAppShellReady() = false, want true: %v", srv.EnvAppShellReadinessError())
	}

	if srv := newServer(t, fstest.MapFS{
		"env/favicon.svg": {Data: []byte("<svg></svg>")},
		"env/logo.png":    {Data: []byte("png")},
	}); srv.EnvAppShellReady() {
		t.Fatalf("EnvAppShellReady() = true, want false for missing shell")
	}

	if srv := newServer(t, fstest.MapFS{
		"env/index.html": {Data: validShell},
	}); srv.EnvAppShellReady() {
		t.Fatalf("EnvAppShellReady() = true, want false for missing asset")
	}
}

func TestServer_DistRoutes_AllowExternalOriginWithoutBrowserOriginHeader(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	srv, err := New(Options{
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
	srv.serveHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("env UI status = %d, want %d (body=%q)", rr.Code, http.StatusOK, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "env") {
		t.Fatalf("env UI body mismatch: %q", rr.Body.String())
	}
}

func TestServer_ManagementAPI_AllowsInternalSessionHeaderOnPublicEnvOrigin(t *testing.T) {
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
	srv, err := New(Options{
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
	srv.serveHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("env origin with internal channel header status = %d, want %d (body=%q)", rr.Code, http.StatusOK, rr.Body.String())
	}
}

func TestServer_ManagementAPI_CRUDRoutes(t *testing.T) {
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
	srv, err := New(Options{
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
		srv.serveHTTP(rr, req)
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
		srv.serveHTTP(rr, req)
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
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("patch missing fields status = %d, want %d", rr.Code, http.StatusBadRequest)
		}
	}

	// POST start
	{
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/spaces/abc/start", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
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
		srv.serveHTTP(rr, req)
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
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("delete status = %d, want %d", rr.Code, http.StatusOK)
		}
		if !deleteCalled || gotDeleteID != "abc" {
			t.Fatalf("delete handler not called: %q", gotDeleteID)
		}
	}
}

func TestServer_ManagementAPI_PermissionGates(t *testing.T) {
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
		srv, err := New(Options{
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
			srv.serveHTTP(rr, req)
			if rr.Code != http.StatusForbidden {
				t.Fatalf("create status = %d, want %d", rr.Code, http.StatusForbidden)
			}
		}

		// PATCH rename/description
		{
			req := httptest.NewRequest(http.MethodPatch, "/_redeven_proxy/api/spaces/abc", strings.NewReader(`{"name":"n2"}`))
			req.Header.Set("Origin", envOrigin)
			rr := httptest.NewRecorder()
			srv.serveHTTP(rr, req)
			if rr.Code != http.StatusForbidden {
				t.Fatalf("patch status = %d, want %d", rr.Code, http.StatusForbidden)
			}
		}

		// DELETE
		{
			req := httptest.NewRequest(http.MethodDelete, "/_redeven_proxy/api/spaces/abc", nil)
			req.Header.Set("Origin", envOrigin)
			rr := httptest.NewRecorder()
			srv.serveHTTP(rr, req)
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
		srv, err := New(Options{
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
			srv.serveHTTP(rr, req)
			if rr.Code != http.StatusForbidden {
				t.Fatalf("start status = %d, want %d", rr.Code, http.StatusForbidden)
			}
		}

		// POST stop
		{
			req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/spaces/abc/stop", nil)
			req.Header.Set("Origin", envOrigin)
			rr := httptest.NewRecorder()
			srv.serveHTTP(rr, req)
			if rr.Code != http.StatusForbidden {
				t.Fatalf("stop status = %d, want %d", rr.Code, http.StatusForbidden)
			}
		}
	}
}

func TestServer_Settings_RedactsSecrets(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}

	cfgPath := writeTestConfig(t)
	channelID := "ch_test_3"
	envOrigin := envOriginWithChannel(channelID)
	srv, err := New(Options{
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
		srv.serveHTTP(rr, req)

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
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("cs origin status = %d, want %d", rr.Code, http.StatusNotFound)
		}
	}
}

func TestServer_SettingsUpdate_ReturnsAIUpdateMeta(t *testing.T) {
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

	srv, err := New(Options{
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
	srv.serveHTTP(rr, req)

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

func TestServer_LocalUISettingsPermissionCapDoesNotHotReload(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}

	cfgPath := writeTestConfig(t)
	srv, err := New(Options{
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
	srv.serveHTTP(saveRes, saveReq)
	if saveRes.Code != http.StatusOK {
		t.Fatalf("save status = %d, want %d body=%s", saveRes.Code, http.StatusOK, saveRes.Body.String())
	}

	getReq := WithLocalUIEnvRoute(httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/settings", nil))
	getRes := httptest.NewRecorder()
	srv.serveHTTP(getRes, getReq)
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

func TestServer_SettingsFilesystemScopeRefreshesSharedRegistry(t *testing.T) {
	t.Parallel()

	home := t.TempDir()
	custom := t.TempDir()
	cfgPath := writeTestConfig(t)
	scope, err := filesystemscope.NewRegistry(&config.Config{AgentHomeDir: home})
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	if _, err := scope.ResolveTarget(filepath.Join(custom, "next.txt"), filesystemscope.ResolveOptions{ForWrite: true}); err == nil {
		t.Fatalf("custom path unexpectedly writable before scope update")
	}

	srv, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}},
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         cfgPath,
		AgentHomeDir:       home,
		FilesystemScope:    scope,
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	body := fmt.Sprintf(`{
  "agent_home_dir": %q,
  "filesystem_scope": {
    "schema_version": 1,
    "default_root_id": "home",
    "roots": [
      {
        "id": "home",
        "label": "Home",
        "path": %q,
        "kind": "home",
        "permissions": { "read": true, "write": true },
        "system": true
      },
      {
        "id": "computer",
        "label": "Computer",
        "path": "/",
        "kind": "computer",
        "permissions": { "read": true, "write": false },
        "system": true
      },
      {
        "id": "custom",
        "label": "Custom",
        "path": %q,
        "kind": "custom",
        "permissions": { "read": true, "write": true }
      }
    ]
  }
}`, home, home, custom)

	rr := WithLocalUIEnvRoute(httptest.NewRequest(http.MethodPut, "/_redeven_proxy/api/settings", bytes.NewBufferString(body)))
	res := httptest.NewRecorder()
	srv.serveHTTP(res, rr)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", res.Code, http.StatusOK, res.Body.String())
	}

	resolved, err := scope.ResolveTarget(filepath.Join(custom, "next.txt"), filesystemscope.ResolveOptions{ForWrite: true})
	if err != nil {
		t.Fatalf("shared registry did not refresh writable custom root: %v", err)
	}
	if resolved.RootID != "custom" {
		t.Fatalf("RootID = %q, want custom", resolved.RootID)
	}
}

func TestServer_LocalUIDoesNotExposeLegacyDesktopModelBinding(t *testing.T) {
	t.Parallel()

	aiSvc, err := ai.NewService(ai.Options{
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		Shell:        "/bin/sh",
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() {
		_ = aiSvc.Close()
	})

	srv, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             fstest.MapFS{"env/index.html": {Data: []byte("<html><div id=\"root\"></div></html>")}},
		ListenAddr:         "127.0.0.1:0",
		AI:                 aiSvc,
		ConfigPath:         writeTestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	req := WithLocalUIEnvRoute(httptest.NewRequest(
		http.MethodPost,
		"/_redeven_proxy/api/runtime/bindings/"+"desktop-"+"ai-"+"broker",
		bytes.NewBufferString(`{"token":"legacy-token"}`),
	))
	rr := httptest.NewRecorder()
	srv.serveHTTP(rr, req)

	if rr.Code == http.StatusOK {
		t.Fatalf("legacy desktop model endpoint unexpectedly succeeded: %s", rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), "legacy-token") {
		t.Fatalf("legacy binding response leaked token: %s", rr.Body.String())
	}
	if aiSvc.Enabled() {
		t.Fatalf("AI service became enabled through legacy broker endpoint")
	}
}

func TestServer_AIProviderKeys_StatusAndUpdate(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}

	cfgPath := writeTestConfig(t)
	channelID := "ch_test_keys_1"
	envOrigin := envOriginWithChannel(channelID)
	srv, err := New(Options{
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
		srv.serveHTTP(rr, req)

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
		srv.serveHTTP(rr, req)

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
		srv.serveHTTP(rr, req)

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
		srv.serveHTTP(rr, req)

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

	// web search status uses its own explicit response field.
	{
		req := httptest.NewRequest(http.MethodPut, "/_redeven_proxy/api/ai/web_search_provider_keys", bytes.NewBufferString(`{"patches":[{"provider_id":"openai","api_key":"brave-test"}]}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("set web search key code = %d, want %d body=%s", rr.Code, http.StatusOK, rr.Body.String())
		}
		var resp map[string]any
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal web search update: %v", err)
		}
		data, _ := resp["data"].(map[string]any)
		set, _ := data["web_search_provider_api_key_set"].(map[string]any)
		if set["openai"] != true {
			t.Fatalf("openai web search set=%v, want=true", set["openai"])
		}
		if _, ok := data["provider_api_key_set"]; ok {
			t.Fatalf("web search endpoint must not reuse provider_api_key_set: %#v", data)
		}
	}

	{
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/web_search_provider_keys/status", bytes.NewBufferString(`{"provider_ids":["openai","anthropic"]}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("web search status code = %d, want %d body=%s", rr.Code, http.StatusOK, rr.Body.String())
		}
		var resp map[string]any
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal web search status: %v", err)
		}
		data, _ := resp["data"].(map[string]any)
		set, _ := data["web_search_provider_api_key_set"].(map[string]any)
		if set["openai"] != true {
			t.Fatalf("openai web search set=%v, want=true", set["openai"])
		}
		if set["anthropic"] != false {
			t.Fatalf("anthropic web search set=%v, want=false", set["anthropic"])
		}
	}
}

func TestServer_AIProviderBundle_SavesConfigAndSecretTogether(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}

	cfgPath := writeTestConfigWithAI(t)
	channelID := "ch_test_provider_bundle"
	envOrigin := envOriginWithChannel(channelID)
	aiSvc, err := ai.NewService(ai.Options{
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		Shell:        "/bin/sh",
		Config: &config.AIConfig{
			CurrentModelID: "openai/gpt-5-mini",
			Providers: []config.AIProvider{{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: "https://api.openai.com/v1",
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
			}},
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() {
		_ = aiSvc.Close()
	})

	srv, err := New(Options{
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
	          { "model_name": "gpt-5-mini", "input_modalities": ["text", "image"] }
	        ]
	      }
	    ]
	  },
	  "provider_api_key_patches": [
	    { "provider_id": "openai", "api_key": "sk-test" }
	  ]
	}`

	req := httptest.NewRequest(http.MethodPut, "/_redeven_proxy/api/ai/provider_bundle", bytes.NewBufferString(body))
	req.Header.Set("Origin", envOrigin)
	rr := httptest.NewRecorder()
	srv.serveHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("provider bundle code = %d, want %d body=%s", rr.Code, http.StatusOK, rr.Body.String())
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.AI == nil || len(cfg.AI.Providers) != 1 || len(cfg.AI.Providers[0].Models) != 1 {
		t.Fatalf("unexpected AI config: %#v", cfg.AI)
	}
	if !cfg.AI.Providers[0].Models[0].SupportsImageInput() {
		t.Fatalf("saved model should support image input")
	}

	req = httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/provider_keys/status", bytes.NewBufferString(`{"provider_ids":["openai"]}`))
	req.Header.Set("Origin", envOrigin)
	rr = httptest.NewRecorder()
	srv.serveHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("key status code = %d, want %d body=%s", rr.Code, http.StatusOK, rr.Body.String())
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
	if strings.Contains(rr.Body.String(), "sk-test") {
		t.Fatalf("secret leaked in response: %s", rr.Body.String())
	}

	badBody := `{
	  "ai": {
	    "current_model_id": "broken/missing",
	    "providers": [
	      {
	        "id": "broken",
	        "name": "Broken",
	        "type": "openai",
	        "base_url": "https://api.openai.com/v1",
	        "models": [
	          { "model_name": "available-model" }
	        ]
	      }
	    ]
	  },
	  "provider_api_key_patches": [
	    { "provider_id": "broken", "api_key": "sk-should-not-save" }
	  ]
	}`
	req = httptest.NewRequest(http.MethodPut, "/_redeven_proxy/api/ai/provider_bundle", bytes.NewBufferString(badBody))
	req.Header.Set("Origin", envOrigin)
	rr = httptest.NewRecorder()
	srv.serveHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("invalid bundle code = %d, want %d body=%s", rr.Code, http.StatusBadRequest, rr.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/provider_keys/status", bytes.NewBufferString(`{"provider_ids":["broken"]}`))
	req.Header.Set("Origin", envOrigin)
	rr = httptest.NewRecorder()
	srv.serveHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("broken key status code = %d, want %d body=%s", rr.Code, http.StatusOK, rr.Body.String())
	}
	resp = map[string]any{}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal broken status: %v", err)
	}
	data, _ = resp["data"].(map[string]any)
	set, _ = data["provider_api_key_set"].(map[string]any)
	if set["broken"] != false {
		t.Fatalf("broken set=%v, want=false after validation failure", set["broken"])
	}
}

func TestServer_AIProviderBundle_CleansSecretsOutsideCurrentProfile(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}

	cfgPath := writeTestConfigWithAI(t)
	channelID := "ch_test_provider_bundle_cleanup"
	envOrigin := envOriginWithChannel(channelID)
	aiSvc, err := ai.NewService(ai.Options{
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		Shell:        "/bin/sh",
		Config: &config.AIConfig{
			CurrentModelID: "openai/gpt-5-mini",
			Providers: []config.AIProvider{{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: "https://api.openai.com/v1",
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
			}},
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() {
		_ = aiSvc.Close()
	})

	srv, err := New(Options{
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

	for _, req := range []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodPut, "/_redeven_proxy/api/ai/provider_keys", `{"patches":[{"provider_id":"openai","api_key":"sk-openai"},{"provider_id":"unused","api_key":"sk-unused"}]}`},
		{http.MethodPut, "/_redeven_proxy/api/ai/web_search_provider_keys", `{"patches":[{"provider_id":"openai","api_key":"brave-openai"},{"provider_id":"unused","api_key":"brave-unused"}]}`},
	} {
		rr := performServerRequest(srv, req.method, req.path, envOrigin, req.body)
		if rr.Code != http.StatusOK {
			t.Fatalf("%s %s code = %d, want %d body=%s", req.method, req.path, rr.Code, http.StatusOK, rr.Body.String())
		}
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
	        "web_search": { "mode": "disabled" },
	        "models": [
	          { "model_name": "gpt-5-mini" }
	        ]
	      }
	    ]
	  }
	}`
	rr := performServerRequest(srv, http.MethodPut, "/_redeven_proxy/api/ai/provider_bundle", envOrigin, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("provider bundle code = %d, want %d body=%s", rr.Code, http.StatusOK, rr.Body.String())
	}

	rr = performServerRequest(srv, http.MethodPost, "/_redeven_proxy/api/ai/provider_keys/status", envOrigin, `{"provider_ids":["openai","unused"]}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("provider key status code = %d, want %d body=%s", rr.Code, http.StatusOK, rr.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal provider key status: %v", err)
	}
	data, _ := resp["data"].(map[string]any)
	set, _ := data["provider_api_key_set"].(map[string]any)
	if set["openai"] != true {
		t.Fatalf("openai provider key set=%v, want=true", set["openai"])
	}
	if set["unused"] != false {
		t.Fatalf("unused provider key set=%v, want=false", set["unused"])
	}

	rr = performServerRequest(srv, http.MethodPost, "/_redeven_proxy/api/ai/web_search_provider_keys/status", envOrigin, `{"provider_ids":["openai","unused"]}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("web search key status code = %d, want %d body=%s", rr.Code, http.StatusOK, rr.Body.String())
	}
	resp = map[string]any{}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal web search key status: %v", err)
	}
	data, _ = resp["data"].(map[string]any)
	webSet, _ := data["web_search_provider_api_key_set"].(map[string]any)
	if webSet["openai"] != false {
		t.Fatalf("openai web search key set=%v, want=false", webSet["openai"])
	}
	if webSet["unused"] != false {
		t.Fatalf("unused web search key set=%v, want=false", webSet["unused"])
	}
}

func TestServer_Settings_IncludesAIKeyStatus(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}

	cfgPath := writeTestConfigWithAI(t)
	channelID := "ch_test_keys_2"
	envOrigin := envOriginWithChannel(channelID)
	srv, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         cfgPath,
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanAdmin: true}),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// Set keys first.
	{
		req := httptest.NewRequest(http.MethodPut, "/_redeven_proxy/api/ai/provider_keys", bytes.NewBufferString(`{"patches":[{"provider_id":"openai","api_key":"sk-test"}]}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("set key code = %d, want %d body=%s", rr.Code, http.StatusOK, rr.Body.String())
		}
	}
	{
		req := httptest.NewRequest(http.MethodPut, "/_redeven_proxy/api/ai/web_search_provider_keys", bytes.NewBufferString(`{"patches":[{"provider_id":"openai","api_key":"brave-test"}]}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("set web search key code = %d, want %d body=%s", rr.Code, http.StatusOK, rr.Body.String())
		}
	}

	// Settings should include separate AI secret status maps without leaking secrets.
	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/settings", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)

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
		webSearchKeySet, _ := aiSecrets["web_search_provider_api_key_set"].(map[string]any)
		if webSearchKeySet["openai"] != true {
			t.Fatalf("openai web search set=%v, want=true", webSearchKeySet["openai"])
		}

		conn, _ := data["connection"].(map[string]any)
		direct, _ := conn["direct"].(map[string]any)
		if _, ok := direct["e2ee_psk_b64u"]; ok {
			t.Fatalf("secret leaked: e2ee_psk_b64u must not be returned")
		}
	}
}

func TestServer_AIThreadReadState_ListDetailAndReadArePerUser(t *testing.T) {
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

	srv, err := New(Options{
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
		ActivityRevision    int64  `json:"activity_revision"`
		LastMessageAtUnixMs int64  `json:"last_message_at_unix_ms"`
		ActivitySignature   string `json:"activity_signature"`
		WaitingPromptID     string `json:"waiting_prompt_id"`
	}
	type aiThreadReadStatusState struct {
		LastSeenActivityRevision  int64  `json:"last_seen_activity_revision"`
		LastReadMessageAtUnixMs   int64  `json:"last_read_message_at_unix_ms"`
		LastSeenActivitySignature string `json:"last_seen_activity_signature"`
		LastSeenWaitingPromptID   string `json:"last_seen_waiting_prompt_id"`
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

	patchWorkingDir := performServerRequest(
		srv,
		http.MethodPatch,
		"/_redeven_proxy/api/ai/threads/"+url.PathEscape(thread.ThreadID),
		originUser1,
		`{"working_dir":"/tmp"}`,
	)
	if patchWorkingDir.Code != http.StatusBadRequest {
		t.Fatalf("PATCH working_dir status=%d body=%s, want %d", patchWorkingDir.Code, patchWorkingDir.Body.String(), http.StatusBadRequest)
	}

	readList := func(origin string) aiListResponse {
		t.Helper()
		rr := performServerRequest(srv, http.MethodGet, "/_redeven_proxy/api/ai/threads?limit=20", origin, "")
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
		rr := performServerRequest(srv, http.MethodGet, "/_redeven_proxy/api/ai/threads/"+url.PathEscape(thread.ThreadID), origin, "")
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
				"activity_revision":       snapshot.ActivityRevision,
				"last_message_at_unix_ms": snapshot.LastMessageAtUnixMs,
				"activity_signature":      snapshot.ActivitySignature,
				"waiting_prompt_id":       snapshot.WaitingPromptID,
			},
		})
		if err != nil {
			t.Fatalf("marshal mark-read body: %v", err)
		}
		rr := performServerRequest(
			srv,
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
	staleSnapshot := detail.Data.Thread.ReadStatus.Snapshot

	invalidRead := performAIMarkRead(originUser1, aiThreadReadStatusSnapshot{
		ActivityRevision:    detail.Data.Thread.ReadStatus.Snapshot.ActivityRevision + 1,
		LastMessageAtUnixMs: detail.Data.Thread.ReadStatus.Snapshot.LastMessageAtUnixMs,
		ActivitySignature:   detail.Data.Thread.ReadStatus.Snapshot.ActivitySignature,
		WaitingPromptID:     detail.Data.Thread.ReadStatus.Snapshot.WaitingPromptID,
	})
	if invalidRead.Code != http.StatusBadRequest {
		t.Fatalf("future ai mark-read status=%d, want=%d body=%s", invalidRead.Code, http.StatusBadRequest, invalidRead.Body.String())
	}
	if !readDetail(originUser1).Data.Thread.ReadStatus.IsUnread {
		t.Fatalf("user1 detail is_unread=false after rejected future mark-read, want=true")
	}
	mismatchedRead := performAIMarkRead(originUser1, aiThreadReadStatusSnapshot{
		ActivityRevision:    detail.Data.Thread.ReadStatus.Snapshot.ActivityRevision,
		LastMessageAtUnixMs: detail.Data.Thread.ReadStatus.Snapshot.LastMessageAtUnixMs,
		ActivitySignature:   detail.Data.Thread.ReadStatus.Snapshot.ActivitySignature + "\u001fstale",
		WaitingPromptID:     detail.Data.Thread.ReadStatus.Snapshot.WaitingPromptID,
	})
	if mismatchedRead.Code != http.StatusBadRequest {
		t.Fatalf("mismatched ai mark-read status=%d, want=%d body=%s", mismatchedRead.Code, http.StatusBadRequest, mismatchedRead.Body.String())
	}
	mismatchedPromptRead := performAIMarkRead(originUser1, aiThreadReadStatusSnapshot{
		ActivityRevision:    detail.Data.Thread.ReadStatus.Snapshot.ActivityRevision,
		LastMessageAtUnixMs: detail.Data.Thread.ReadStatus.Snapshot.LastMessageAtUnixMs,
		ActivitySignature:   detail.Data.Thread.ReadStatus.Snapshot.ActivitySignature,
		WaitingPromptID:     detail.Data.Thread.ReadStatus.Snapshot.WaitingPromptID + "-tampered",
	})
	if mismatchedPromptRead.Code != http.StatusBadRequest {
		t.Fatalf("mismatched prompt ai mark-read status=%d, want=%d body=%s", mismatchedPromptRead.Code, http.StatusBadRequest, mismatchedPromptRead.Body.String())
	}
	mismatchedLastMessageRead := performAIMarkRead(originUser1, aiThreadReadStatusSnapshot{
		ActivityRevision:    detail.Data.Thread.ReadStatus.Snapshot.ActivityRevision,
		LastMessageAtUnixMs: detail.Data.Thread.ReadStatus.Snapshot.LastMessageAtUnixMs - 1,
		ActivitySignature:   detail.Data.Thread.ReadStatus.Snapshot.ActivitySignature,
		WaitingPromptID:     detail.Data.Thread.ReadStatus.Snapshot.WaitingPromptID,
	})
	if mismatchedLastMessageRead.Code != http.StatusBadRequest {
		t.Fatalf("mismatched last-message ai mark-read status=%d, want=%d body=%s", mismatchedLastMessageRead.Code, http.StatusBadRequest, mismatchedLastMessageRead.Body.String())
	}

	if err := aiSvc.AppendThreadMessage(context.Background(), &creatorMeta, thread.ThreadID, "user", "Concurrent prompt", "markdown"); err != nil {
		t.Fatalf("AppendThreadMessage(concurrent): %v", err)
	}
	staleTampered := markRead(originUser1, aiThreadReadStatusSnapshot{
		ActivityRevision:    staleSnapshot.ActivityRevision,
		LastMessageAtUnixMs: staleSnapshot.LastMessageAtUnixMs,
		ActivitySignature:   staleSnapshot.ActivitySignature + "\u001ftampered-history",
		WaitingPromptID:     staleSnapshot.WaitingPromptID + "-old",
	})
	if !staleTampered.Data.ReadStatus.IsUnread {
		t.Fatalf("tampered stale mark-read response is_unread=false after concurrent activity, want true")
	}
	if staleTampered.Data.ReadStatus.Snapshot.ActivityRevision <= staleSnapshot.ActivityRevision {
		t.Fatalf("tampered stale mark-read response activity_revision=%d, want newer than %d", staleTampered.Data.ReadStatus.Snapshot.ActivityRevision, staleSnapshot.ActivityRevision)
	}
	staleMarked := markRead(originUser1, staleSnapshot)
	if !staleMarked.Data.ReadStatus.IsUnread {
		t.Fatalf("stale mark-read response is_unread=false after concurrent activity, want true")
	}
	if staleMarked.Data.ReadStatus.Snapshot.ActivityRevision <= staleSnapshot.ActivityRevision {
		t.Fatalf("stale mark-read response activity_revision=%d, want newer than %d", staleMarked.Data.ReadStatus.Snapshot.ActivityRevision, staleSnapshot.ActivityRevision)
	}
	detail = readDetail(originUser1)
	if !detail.Data.Thread.ReadStatus.IsUnread {
		t.Fatalf("user1 detail is_unread=false after concurrent activity, want=true")
	}

	marked := markRead(originUser1, detail.Data.Thread.ReadStatus.Snapshot)
	if marked.Data.ReadStatus.IsUnread {
		t.Fatalf("mark-read response is_unread=true, want=false")
	}
	if marked.Data.ReadStatus.ReadState.LastReadMessageAtUnixMs != detail.Data.Thread.ReadStatus.Snapshot.LastMessageAtUnixMs {
		t.Fatalf("mark-read last_read_message_at_unix_ms=%d, want=%d", marked.Data.ReadStatus.ReadState.LastReadMessageAtUnixMs, detail.Data.Thread.ReadStatus.Snapshot.LastMessageAtUnixMs)
	}
	if marked.Data.ReadStatus.ReadState.LastSeenActivityRevision != detail.Data.Thread.ReadStatus.Snapshot.ActivityRevision {
		t.Fatalf("mark-read last_seen_activity_revision=%d, want=%d", marked.Data.ReadStatus.ReadState.LastSeenActivityRevision, detail.Data.Thread.ReadStatus.Snapshot.ActivityRevision)
	}

	userOneAfterRead := readList(originUser1)
	if userOneAfterRead.Data.Threads[0].ReadStatus.IsUnread {
		t.Fatalf("user1 list is_unread=true after mark-read, want=false")
	}

	userTwoAfterRead := readList(originUser2)
	if !userTwoAfterRead.Data.Threads[0].ReadStatus.IsUnread {
		t.Fatalf("user2 list is_unread=false after user1 mark-read, want per-user read-state")
	}
}

func TestServer_AIThreadLiveEventsIncludeReadStatus(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	channelID := "ch_test_ai_live_events_read"
	meta := session.Meta{
		EndpointID:   "env_live_events_read",
		UserPublicID: "user_live_events_read",
		UserEmail:    "live-events-read@example.com",
		CanRead:      true,
		CanWrite:     true,
		CanExecute:   true,
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
	thread, err := aiSvc.CreateThread(context.Background(), &meta, "Live events read state", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := aiSvc.AppendThreadMessage(context.Background(), &meta, thread.ThreadID, "user", "Initial", "markdown"); err != nil {
		t.Fatalf("AppendThreadMessage(initial): %v", err)
	}

	srv, err := New(Options{
		Backend:              &stubBackend{},
		DistFS:               dist,
		ListenAddr:           "127.0.0.1:0",
		AI:                   aiSvc,
		ConfigPath:           cfgPath,
		ThreadReadStateStore: store,
		ResolveSessionMeta:   resolveMetaForTest(channelID, meta),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	origin := envOriginWithChannel(channelID)
	initialDetail := performServerRequest(srv, http.MethodGet, "/_redeven_proxy/api/ai/threads/"+url.PathEscape(thread.ThreadID), origin, "")
	if initialDetail.Code != http.StatusOK {
		t.Fatalf("initial detail status=%d body=%s", initialDetail.Code, initialDetail.Body.String())
	}
	if err := aiSvc.AppendThreadMessage(context.Background(), &meta, thread.ThreadID, "user", "Final", "markdown"); err != nil {
		t.Fatalf("AppendThreadMessage(final): %v", err)
	}
	if err := aiSvc.RenameThread(context.Background(), &meta, thread.ThreadID, "Live events read state updated"); err != nil {
		t.Fatalf("RenameThread: %v", err)
	}

	rr := performServerRequest(
		srv,
		http.MethodGet,
		"/_redeven_proxy/api/ai/threads/"+url.PathEscape(thread.ThreadID)+"/live/events?after_seq=0&limit=10",
		origin,
		"",
	)
	if rr.Code != http.StatusOK {
		t.Fatalf("live events status=%d body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Data struct {
			Events []struct {
				Kind    string          `json:"kind"`
				Payload json.RawMessage `json:"payload"`
			} `json:"events"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal live events response: %v", err)
	}
	for _, event := range resp.Data.Events {
		if event.Kind != "thread.patched" {
			continue
		}
		var payload struct {
			Patch struct {
				ReadStatus struct {
					IsUnread bool `json:"is_unread"`
					Snapshot struct {
						ActivityRevision  int64  `json:"activity_revision"`
						ActivitySignature string `json:"activity_signature"`
					} `json:"snapshot"`
				} `json:"read_status"`
			} `json:"patch"`
		}
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			t.Fatalf("unmarshal thread patch payload: %v", err)
		}
		if !payload.Patch.ReadStatus.IsUnread {
			t.Fatalf("thread.patched read_status.is_unread=false, want true")
		}
		if payload.Patch.ReadStatus.Snapshot.ActivityRevision <= 0 || strings.TrimSpace(payload.Patch.ReadStatus.Snapshot.ActivitySignature) == "" {
			t.Fatalf("thread.patched read_status snapshot not populated: %#v", payload.Patch.ReadStatus.Snapshot)
		}
		return
	}
	t.Fatalf("events=%#v, want thread.patched with read_status", resp.Data.Events)
}

func TestServer_AIThreadForkDecodesBodyStrictly(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	channelID := "ch_test_ai_thread_fork"
	meta := session.Meta{
		EndpointID:   "env_fork",
		UserPublicID: "user_1",
		UserEmail:    "user1@example.com",
		CanRead:      true,
		CanWrite:     true,
		CanExecute:   true,
	}
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
	thread, err := aiSvc.CreateThread(context.Background(), &meta, "Fork source", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := aiSvc.AppendThreadMessage(context.Background(), &meta, thread.ThreadID, "user", "Fork me", "markdown"); err != nil {
		t.Fatalf("AppendThreadMessage: %v", err)
	}
	srv, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		AI:                 aiSvc,
		ConfigPath:         writeTestConfig(t),
		ResolveSessionMeta: resolveMetaForTest(channelID, meta),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	origin := envOriginWithChannel(channelID)
	forkPath := "/_redeven_proxy/api/ai/threads/" + url.PathEscape(thread.ThreadID) + "/fork"

	unknown := performServerRequest(srv, http.MethodPost, forkPath, origin, `{"unknown":true}`)
	if unknown.Code != http.StatusBadRequest {
		t.Fatalf("unknown fork body status=%d, want=%d body=%s", unknown.Code, http.StatusBadRequest, unknown.Body.String())
	}
	trailing := performServerRequest(srv, http.MethodPost, forkPath, origin, `{} {}`)
	if trailing.Code != http.StatusBadRequest {
		t.Fatalf("trailing fork body status=%d, want=%d body=%s", trailing.Code, http.StatusBadRequest, trailing.Body.String())
	}
	extraPath := performServerRequest(srv, http.MethodPost, forkPath+"/extra", origin, `{}`)
	if extraPath.Code != http.StatusNotFound {
		t.Fatalf("extra fork path status=%d, want=%d body=%s", extraPath.Code, http.StatusNotFound, extraPath.Body.String())
	}

	rr := performServerRequest(srv, http.MethodPost, forkPath, origin, `{"title":"Server fork"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("fork status=%d, want=%d body=%s", rr.Code, http.StatusOK, rr.Body.String())
	}
	var resp struct {
		OK   bool `json:"ok"`
		Data struct {
			Thread struct {
				ThreadID string `json:"thread_id"`
				Title    string `json:"title"`
			} `json:"thread"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal fork response: %v", err)
	}
	if !resp.OK || strings.TrimSpace(resp.Data.Thread.ThreadID) == "" || resp.Data.Thread.ThreadID == thread.ThreadID || resp.Data.Thread.Title != "Server fork" {
		t.Fatalf("fork response=%+v, want titled fork", resp)
	}
}

func TestServer_AIThreadDeleteRemovesReadStateForAllUsers(t *testing.T) {
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
	if _, err := store.EnsureFlower(context.Background(), creatorMeta.EndpointID, creatorMeta.UserPublicID, map[string]threadreadstate.FlowerSnapshot{
		thread.ThreadID: {
			ActivityRevision:    100,
			LastMessageAtUnixMs: 100,
			ActivitySignature:   "status:waiting_user\u001factivity:100\u001fprompt:prompt_1",
			WaitingPromptID:     "prompt_1",
		},
	}); err != nil {
		t.Fatalf("EnsureFlower(user first): %v", err)
	}
	if _, err := store.EnsureFlower(context.Background(), creatorMeta.EndpointID, metaByChannel["ch_test_ai_delete_cleanup_user_2"].UserPublicID, map[string]threadreadstate.FlowerSnapshot{
		thread.ThreadID: {
			ActivityRevision:    110,
			LastMessageAtUnixMs: 110,
			ActivitySignature:   "status:waiting_user\u001factivity:110\u001fprompt:prompt_2",
			WaitingPromptID:     "prompt_2",
		},
	}); err != nil {
		t.Fatalf("EnsureFlower(other user): %v", err)
	}

	srv, err := New(Options{
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
	rr := performServerRequest(srv, http.MethodDelete, "/_redeven_proxy/api/ai/threads/"+url.PathEscape(thread.ThreadID), originUser1, "")
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

	detailRR := performServerRequest(srv, http.MethodGet, "/_redeven_proxy/api/ai/threads/"+url.PathEscape(thread.ThreadID), originUser1, "")
	if detailRR.Code != http.StatusNotFound {
		t.Fatalf("GET deleted thread status=%d, want=%d body=%s", detailRR.Code, http.StatusNotFound, detailRR.Body.String())
	}
}

func TestServer_DeleteFlowerThreadWithReadStateCleanupRestoresSnapshotOnPrimaryDeleteFailure(t *testing.T) {
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
			ActivityRevision:    200,
			LastMessageAtUnixMs: 200,
			ActivitySignature:   "status:waiting_user\u001factivity:200\u001fprompt:prompt_1",
			WaitingPromptID:     "prompt_1",
		},
	}); err != nil {
		t.Fatalf("EnsureFlower(user_1): %v", err)
	}
	if _, err := store.EnsureFlower(context.Background(), "env_delete_restore", "user_2", map[string]threadreadstate.FlowerSnapshot{
		threadID: {
			ActivityRevision:    210,
			LastMessageAtUnixMs: 210,
			ActivitySignature:   "status:waiting_user\u001factivity:210\u001fprompt:prompt_2",
			WaitingPromptID:     "prompt_2",
		},
	}); err != nil {
		t.Fatalf("EnsureFlower(user_2): %v", err)
	}

	srv, err := New(Options{
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
	err = srv.deleteFlowerThreadWithReadStateCleanup(context.Background(), &meta, threadID, func() error {
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
	if restored[0].ScopeID != "user_1" || restored[1].ScopeID != "user_2" {
		t.Fatalf("restored scopes=%+v, want user_1 and user_2", restored)
	}
}

func TestServer_CodexThreadReadState_ListDetailAndReadArePerUser(t *testing.T) {
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

	srv, err := New(Options{
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
		rr := performServerRequest(srv, http.MethodGet, "/_redeven_proxy/api/codex/threads?limit=20", origin, "")
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
		rr := performServerRequest(srv, http.MethodGet, "/_redeven_proxy/api/codex/threads/"+url.PathEscape(thread.ID), origin, "")
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
		rr := performServerRequest(
			srv,
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

func TestServer_CodeServerProxy_RewritesHostAndStripsForwardedHeaders(t *testing.T) {
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

	upstreamSrv := &http.Server{
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
	go func() { _ = upstreamSrv.Serve(ln) }()
	t.Cleanup(func() { _ = upstreamSrv.Shutdown(context.Background()) })

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
	appSrv, err := New(Options{
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
	appSrv.serveHTTP(rr, req)
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

func TestServer_CodeServerProxy_ServesVSDAWebShim(t *testing.T) {
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
	srv, err := New(Options{
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
		srv.serveHTTP(rr, req)
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
		srv.serveHTTP(rr, req)
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

func TestServer_CodeServerProxy_CodespaceRootRedirectsToWorkspaceFolder(t *testing.T) {
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
	srv, err := New(Options{
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
	srv.serveHTTP(rr, req)
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

func TestServer_CodeServerProxy_CodespaceRootRedirectsToWorkspaceFolder_WithoutOrigin(t *testing.T) {
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
	srv, err := New(Options{
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
	// Top-level navigation commonly omits Origin; the app server should fall back to Host.
	rr := httptest.NewRecorder()
	srv.serveHTTP(rr, req)
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

func TestServer_CodeServerProxy_RequiresCodespaceOrigin(t *testing.T) {
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
	srv, err := New(Options{
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
	srv.serveHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusNotFound)
	}
}

func TestServer_DistFS_UsesEmbedLayout(t *testing.T) {
	t.Parallel()

	// Guardrail: the app server expects DistFS to be rooted at "dist/" and serve:
	// - /_redeven_proxy/env/* -> env/*
	// - /_redeven_proxy/inject.js -> inject.js for codespace origins only
	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	srv, err := New(Options{
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
	req.Header.Set("Origin", "https://cs-abc.example.com")
	rr := httptest.NewRecorder()
	srv.serveHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("inject.js status = %d, want %d", rr.Code, http.StatusOK)
	}
}

func TestServer_PluginOriginCannotAccessManagementSurfaces(t *testing.T) {
	t.Parallel()

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	srv, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	for _, path := range []string{
		"/_redeven_proxy/api/settings",
		"/_redeven_proxy/env/",
		"/_redeven_proxy/inject.js",
	} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			req.Header.Set("Origin", "https://plg-containers.example.com")
			rr := httptest.NewRecorder()
			srv.serveHTTP(rr, req)
			if rr.Code != http.StatusNotFound {
				t.Fatalf("%s status = %d, want %d", path, rr.Code, http.StatusNotFound)
			}
		})
	}
}
