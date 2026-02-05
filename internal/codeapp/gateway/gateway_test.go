package gateway

import (
	"context"
	"encoding/base32"
	"encoding/json"
	"errors"
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

	"github.com/floegence/redeven-agent/internal/session"
)

type stubBackend struct {
	listSpaces            func(ctx context.Context) ([]SpaceStatus, error)
	createSpace           func(ctx context.Context, req CreateSpaceRequest) (*SpaceStatus, error)
	updateSpace           func(ctx context.Context, codeSpaceID string, req UpdateSpaceRequest) (*SpaceStatus, error)
	deleteSpace           func(ctx context.Context, codeSpaceID string) error
	startSpace            func(ctx context.Context, codeSpaceID string) (*SpaceStatus, error)
	stopSpace             func(ctx context.Context, codeSpaceID string) error
	resolveCodeServerPort func(ctx context.Context, codeSpaceID string) (int, error)
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
