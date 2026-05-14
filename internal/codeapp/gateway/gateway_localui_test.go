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
	"github.com/floegence/redeven/internal/portforward"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
	"github.com/floegence/redeven/internal/session"
)

type stubPortForwardBackend struct {
	forwards map[string]pfregistry.Forward
}

func (s *stubPortForwardBackend) ListForwards(context.Context) ([]pfregistry.Forward, error) {
	out := make([]pfregistry.Forward, 0, len(s.forwards))
	for _, f := range s.forwards {
		out = append(out, f)
	}
	return out, nil
}

func (s *stubPortForwardBackend) GetForward(_ context.Context, forwardID string) (*pfregistry.Forward, error) {
	f, ok := s.forwards[forwardID]
	if !ok {
		return nil, nil
	}
	return &f, nil
}

func (s *stubPortForwardBackend) CreateForward(context.Context, portforward.CreateForwardRequest) (*pfregistry.Forward, error) {
	return nil, nil
}

func (s *stubPortForwardBackend) UpdateForward(context.Context, string, portforward.UpdateForwardRequest) (*pfregistry.Forward, error) {
	return nil, nil
}

func (s *stubPortForwardBackend) DeleteForward(context.Context, string) error {
	return nil
}

func (s *stubPortForwardBackend) TouchLastOpened(ctx context.Context, forwardID string) (*pfregistry.Forward, error) {
	return s.GetForward(ctx, forwardID)
}

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

func writeLocalUITestConfigWithPolicy(t *testing.T, policy *config.PermissionPolicy) string {
	t.Helper()
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

func TestGateway_LocalUIAllowsPortForwardManagementAPI(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("ok"))
	}))
	defer upstream.Close()

	gw, err := New(Options{
		Backend: &stubBackend{},
		PortForward: &stubPortForwardBackend{forwards: map[string]pfregistry.Forward{
			"demo": {
				ForwardID: "demo",
				TargetURL: upstream.URL,
				Name:      "Demo Service",
			},
		}},
		DistFS:             fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}},
		ConfigPath:         writeLocalUITestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/_redeven_proxy/api/forwards", nil)
	req = WithLocalUIEnvRoute(req)
	rr := httptest.NewRecorder()
	gw.serveHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rr.Code, http.StatusOK, rr.Body.String())
	}
	var payload struct {
		OK   bool `json:"ok"`
		Data struct {
			Forwards []portForwardView `json:"forwards"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if !payload.OK || len(payload.Data.Forwards) != 1 || payload.Data.Forwards[0].ForwardID != "demo" {
		t.Fatalf("unexpected forwards response: %#v", payload)
	}
}

func TestGateway_LocalUIPortForwardManagementUsesPortForwardAppCap(t *testing.T) {
	t.Parallel()

	localMax := config.PermissionSet{Read: true, Write: true, Execute: true}
	portForwardCap := config.PermissionSet{Read: true, Write: true, Execute: false}
	policy := &config.PermissionPolicy{
		SchemaVersion: 1,
		LocalMax:      &localMax,
		ByApp: map[string]*config.PermissionSet{
			localFloeAppPortForward: &portForwardCap,
		},
	}
	gw, err := New(Options{
		Backend:            &stubBackend{},
		PortForward:        &stubPortForwardBackend{forwards: map[string]pfregistry.Forward{}},
		DistFS:             fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}},
		ConfigPath:         writeLocalUITestConfigWithPolicy(t, policy),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/_redeven_proxy/api/forwards", nil)
	req = WithLocalUIEnvRoute(req)
	rr := httptest.NewRecorder()
	gw.serveHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d, body=%s", rr.Code, http.StatusForbidden, rr.Body.String())
	}
}

func TestGateway_LocalUICodespaceProxyUsesCodeAppCap(t *testing.T) {
	t.Parallel()

	localMax := config.PermissionSet{Read: true, Write: true, Execute: true}
	codeCap := config.PermissionSet{Read: true, Write: true, Execute: false}
	policy := &config.PermissionPolicy{
		SchemaVersion: 1,
		LocalMax:      &localMax,
		ByApp: map[string]*config.PermissionSet{
			localFloeAppCode: &codeCap,
		},
	}
	gw, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}},
		ConfigPath:         writeLocalUITestConfigWithPolicy(t, policy),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/cs/demo/", nil)
	req = WithLocalUICodeSpaceRoute(req, "demo")
	rr := httptest.NewRecorder()
	gw.serveHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d, body=%s", rr.Code, http.StatusForbidden, rr.Body.String())
	}
}

func TestGateway_LocalUIPortForwardProxyStripsPathPrefix(t *testing.T) {
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

	gw, err := New(Options{
		Backend: &stubBackend{},
		PortForward: &stubPortForwardBackend{forwards: map[string]pfregistry.Forward{
			"demo": {
				ForwardID: "demo",
				TargetURL: upstream.URL,
			},
		}},
		DistFS:             fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}},
		ConfigPath:         writeLocalUITestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/pf/demo/static/file.js?x=1", nil)
	req = WithLocalUIPortForwardRoute(req, "demo")
	rr := httptest.NewRecorder()
	gw.serveHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rr.Code, http.StatusOK, rr.Body.String())
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
	if payload["origin"] != upstream.URL {
		t.Fatalf("origin = %q, want %q", payload["origin"], upstream.URL)
	}
	if payload["host"] != u.Host {
		t.Fatalf("host = %q, want %q", payload["host"], u.Host)
	}
}

func TestGateway_LocalUIPortForwardProxyKeepsLocalPrefixInTargetRedirects(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/dashboard", http.StatusFound)
	}))
	defer upstream.Close()

	gw, err := New(Options{
		Backend: &stubBackend{},
		PortForward: &stubPortForwardBackend{forwards: map[string]pfregistry.Forward{
			"demo": {
				ForwardID: "demo",
				TargetURL: upstream.URL,
			},
		}},
		DistFS:             fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}},
		ConfigPath:         writeLocalUITestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/pf/demo/", nil)
	req = WithLocalUIPortForwardRoute(req, "demo")
	rr := httptest.NewRecorder()
	gw.serveHTTP(rr, req)

	if rr.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d, body=%s", rr.Code, http.StatusFound, rr.Body.String())
	}
	if loc := rr.Header().Get("Location"); loc != "/pf/demo/dashboard" {
		t.Fatalf("location = %q, want %q", loc, "/pf/demo/dashboard")
	}
}

func TestProbePortForwardHealth_UsesConfiguredHealthPath(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		http.Error(w, "root should not be treated as health", http.StatusInternalServerError)
	}))
	defer upstream.Close()

	health := probePortForwardHealth(context.Background(), upstream.URL, "healthz", false)
	if health.Status != "healthy" {
		t.Fatalf("health.Status=%q want healthy, error=%q", health.Status, health.LastError)
	}

	unhealthy := probePortForwardHealth(context.Background(), upstream.URL, "/missing", false)
	if unhealthy.Status != "unreachable" {
		t.Fatalf("unhealthy.Status=%q want unreachable", unhealthy.Status)
	}
}
