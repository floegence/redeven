package gateway

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"
	"testing/fstest"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func writeLocalUITestConfig(t *testing.T) string {
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

func TestGateway_LocalUICodespaceRootRedirectsToWorkspace(t *testing.T) {
	t.Parallel()

	gw, err := New(Options{
		Backend: &stubBackend{
			listSpaces: func(context.Context) ([]SpaceStatus, error) {
				return []SpaceStatus{{CodeSpaceID: "demo", WorkspacePath: "/workspace/repo"}}, nil
			},
		},
		DistFS:             fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}},
		ConfigPath:         writeLocalUITestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "http://192.168.1.11:12345/cs/demo/", nil)
	req = WithLocalUICodeSpaceRoute(req, "demo")
	rr := httptest.NewRecorder()
	gw.serveHTTP(rr, req)

	if rr.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusFound)
	}
	if loc := rr.Header().Get("Location"); loc != "/cs/demo/?folder=%2Fworkspace%2Frepo" {
		t.Fatalf("location = %q, want %q", loc, "/cs/demo/?folder=%2Fworkspace%2Frepo")
	}
}

func TestGateway_LocalUICodespaceProxyStripsPathPrefix(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{
			"path":   r.URL.Path,
			"query":  r.URL.RawQuery,
			"origin": r.Header.Get("Origin"),
			"host":   r.Host,
		})
	}))
	defer upstream.Close()

	u, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatalf("url.Parse() error = %v", err)
	}
	port, err := net.LookupPort("tcp", u.Port())
	if err != nil {
		t.Fatalf("LookupPort() error = %v", err)
	}

	gw, err := New(Options{
		Backend: &stubBackend{
			resolveCodeServerPort: func(context.Context, string) (int, error) {
				return port, nil
			},
		},
		DistFS:             fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}},
		ConfigPath:         writeLocalUITestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "http://192.168.1.11:12345/cs/demo/static/file.js?x=1", nil)
	req = WithLocalUICodeSpaceRoute(req, "demo")
	rr := httptest.NewRecorder()
	gw.serveHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}

	var payload map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if payload["path"] != "/static/file.js" {
		t.Fatalf("path = %q, want %q", payload["path"], "/static/file.js")
	}
	if payload["query"] != "x=1" {
		t.Fatalf("query = %q, want %q", payload["query"], "x=1")
	}
	if payload["origin"] != "http://192.168.1.11:12345" {
		t.Fatalf("origin = %q, want %q", payload["origin"], "http://192.168.1.11:12345")
	}
	if payload["host"] != "192.168.1.11:12345" {
		t.Fatalf("host = %q, want %q", payload["host"], "192.168.1.11:12345")
	}
}
