package appserver

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
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

func (s *stubPortForwardBackend) OpenForwardSession(_ context.Context, req portforward.OpenForwardSessionRequest) (*portforward.ForwardSession, error) {
	return &portforward.ForwardSession{
		Forward:   pfregistry.Forward{ForwardID: "ephemeral", TargetURL: req.Target},
		AppPath:   "/",
		Ephemeral: true,
	}, nil
}

func (s *stubPortForwardBackend) SaveForwardSession(ctx context.Context, forwardID string, _ portforward.SaveForwardSessionRequest) (*pfregistry.Forward, error) {
	return s.GetForward(ctx, forwardID)
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

func TestServer_LocalUICodespaceRootRedirectsToWorkspace(t *testing.T) {
	t.Parallel()

	srv, err := New(Options{
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
	srv.serveHTTP(rr, req)

	if rr.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusFound)
	}
	if loc := rr.Header().Get("Location"); loc != "/cs/demo/?folder=%2Fworkspace%2Frepo" {
		t.Fatalf("location = %q, want %q", loc, "/cs/demo/?folder=%2Fworkspace%2Frepo")
	}
}

func TestServer_LocalUICodespaceProxyStripsPathPrefix(t *testing.T) {
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

	srv, err := New(Options{
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
	srv.serveHTTP(rr, req)

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

func TestServer_LocalUIAllowsPortForwardManagementAPI(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("ok"))
	}))
	defer upstream.Close()

	srv, err := New(Options{
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
	srv.serveHTTP(rr, req)

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

func TestServer_LocalUIOpensAndExplicitlySavesTemporaryForwardSession(t *testing.T) {
	t.Parallel()
	reg, err := pfregistry.Open(filepath.Join(t.TempDir(), "forwards.sqlite"))
	if err != nil {
		t.Fatalf("registry.Open() error = %v", err)
	}
	t.Cleanup(func() { _ = reg.Close() })
	service, err := portforward.New(reg)
	if err != nil {
		t.Fatalf("portforward.New() error = %v", err)
	}
	srv, err := New(Options{
		Backend:            &stubBackend{},
		PortForward:        service,
		DistFS:             fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}},
		ConfigPath:         writeLocalUITestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	openReq := httptest.NewRequest(http.MethodPost, "http://localhost:23998/_redeven_proxy/api/forward-sessions", strings.NewReader(`{"target":"3000/docs?q=1"}`))
	openReq = WithLocalUIEnvRoute(openReq)
	openRR := httptest.NewRecorder()
	srv.serveHTTP(openRR, openReq)
	if openRR.Code != http.StatusOK {
		t.Fatalf("open status = %d, body=%s", openRR.Code, openRR.Body.String())
	}
	var opened struct {
		Data portforward.ForwardSession `json:"data"`
	}
	if err := json.Unmarshal(openRR.Body.Bytes(), &opened); err != nil {
		t.Fatalf("json.Unmarshal(open) error = %v", err)
	}
	if !opened.Data.Ephemeral || opened.Data.AppPath != "/docs?q=1" || opened.Data.Forward.TargetURL != "http://localhost:3000" {
		t.Fatalf("opened session = %#v", opened.Data)
	}
	if persisted, err := service.ListForwards(context.Background()); err != nil || len(persisted) != 0 {
		t.Fatalf("temporary session persisted early: %#v, %v", persisted, err)
	}

	saveURL := "http://localhost:23998/_redeven_proxy/api/forward-sessions/" + opened.Data.Forward.ForwardID + "/save"
	saveReq := httptest.NewRequest(http.MethodPost, saveURL, strings.NewReader(`{"name":"Preview","description":"Docs","access_mode":"desktop_loopback"}`))
	saveReq = WithLocalUIEnvRoute(saveReq)
	saveRR := httptest.NewRecorder()
	srv.serveHTTP(saveRR, saveReq)
	if saveRR.Code != http.StatusOK {
		t.Fatalf("save status = %d, body=%s", saveRR.Code, saveRR.Body.String())
	}
	persisted, err := service.ListForwards(context.Background())
	if err != nil || len(persisted) != 1 || persisted[0].ForwardID != opened.Data.Forward.ForwardID || persisted[0].Name != "Preview" || persisted[0].AccessMode != pfregistry.AccessModeDesktopLoopback {
		t.Fatalf("persisted forwards = %#v, %v", persisted, err)
	}
}

func TestServer_LocalUIPortForwardManagementUsesPortForwardAppCap(t *testing.T) {
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
	srv, err := New(Options{
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
	srv.serveHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d, body=%s", rr.Code, http.StatusForbidden, rr.Body.String())
	}
}

func TestServer_LocalUICodespaceProxyUsesCodeAppCap(t *testing.T) {
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
	srv, err := New(Options{
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
	srv.serveHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d, body=%s", rr.Code, http.StatusForbidden, rr.Body.String())
	}
}

func TestServer_LocalUIPortForwardProxyStripsPathPrefix(t *testing.T) {
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

	srv, err := New(Options{
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
	srv.serveHTTP(rr, req)

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

func TestServer_LocalUIPortForwardProxyKeepsBrowserAuthorizationOutOfUpstream(t *testing.T) {
	t.Parallel()

	var receivedCookies []*http.Cookie
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedCookies = r.Cookies()
		http.SetCookie(w, &http.Cookie{Name: LocalUIPortForwardBrowserSessionCookieName, Value: "upstream-collision", Path: "/"})
		http.SetCookie(w, &http.Cookie{Name: "application", Value: "kept", Path: "/", Domain: "example.invalid"})
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()

	srv, err := New(Options{
		Backend: &stubBackend{},
		PortForward: &stubPortForwardBackend{forwards: map[string]pfregistry.Forward{
			"demo": {ForwardID: "demo", TargetURL: upstream.URL},
		}},
		DistFS:             fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}},
		ConfigPath:         writeLocalUITestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "http://pf-demo.localhost:23998/", nil)
	req.Header.Add("Cookie", "application=request; "+LocalUIPortForwardBrowserSessionCookieName+"=secret")
	StripLocalUIPortForwardBrowserSessionCookie(req)
	req = WithLocalUIPortForwardOrigin(req, "demo")
	rr := httptest.NewRecorder()
	srv.serveHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusNoContent)
	}
	if len(receivedCookies) != 1 || receivedCookies[0].Name != "application" || receivedCookies[0].Value != "request" {
		t.Fatalf("upstream cookies = %#v, want only application cookie", receivedCookies)
	}
	setCookies := rr.Result().Cookies()
	if len(setCookies) != 1 || setCookies[0].Name != "application" || setCookies[0].Domain != "" {
		t.Fatalf("response cookies = %#v, want only host-bound application cookie", setCookies)
	}
}

func TestServer_LocalUIPortForwardProxyKeepsLocalPrefixInTargetRedirects(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/dashboard", http.StatusFound)
	}))
	defer upstream.Close()

	srv, err := New(Options{
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
	srv.serveHTTP(rr, req)

	if rr.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d, body=%s", rr.Code, http.StatusFound, rr.Body.String())
	}
	if loc := rr.Header().Get("Location"); loc != "/pf/demo/dashboard" {
		t.Fatalf("location = %q, want %q", loc, "/pf/demo/dashboard")
	}
}

func TestRewriteLocationToProxyKeepsSameProtocolAndLoopbackPort(t *testing.T) {
	t.Parallel()

	target, err := url.Parse("http://127.0.0.1:3080")
	if err != nil {
		t.Fatal(err)
	}
	for location, want := range map[string]string{
		"/login?next=%2F":                  "/pf/demo/login?next=%2F",
		"http://127.0.0.1:3080/dashboard":  "/pf/demo/dashboard",
		"http://localhost:3080/dashboard":  "/pf/demo/dashboard",
		"http://127.42.0.9:3080/dashboard": "/pf/demo/dashboard",
	} {
		if got := rewriteLocationToProxy(location, target, "/pf/demo"); got != want {
			t.Fatalf("rewriteLocationToProxy(%q) = %q, want %q", location, got, want)
		}
	}
	for _, location := range []string{
		"http://localhost:3081/dashboard",
		"https://localhost:3080/dashboard",
		"https://example.com/dashboard",
	} {
		if got := rewriteLocationToProxy(location, target, "/pf/demo"); got != location {
			t.Fatalf("rewriteLocationToProxy(%q) = %q, want unchanged", location, got)
		}
	}
}

func TestRewriteHTMLOriginsDoesNotCrossProtocol(t *testing.T) {
	t.Parallel()

	target, err := url.Parse("http://127.0.0.1:3080")
	if err != nil {
		t.Fatal(err)
	}
	input := `http://127.0.0.1:3080/a https://127.0.0.1:3080/b ws://127.0.0.1:3080/c wss://127.0.0.1:3080/d`
	want := `http://pf-demo.localhost:43123/a https://127.0.0.1:3080/b ws://pf-demo.localhost:43123/c wss://127.0.0.1:3080/d`
	if got := rewriteHTMLOrigins(input, target, "http://pf-demo.localhost:43123", "ws://pf-demo.localhost:43123"); got != want {
		t.Fatalf("rewriteHTMLOrigins() = %q, want %q", got, want)
	}
}

func TestServer_LocalUIPortForwardOriginKeepsApplicationPathsAtRoot(t *testing.T) {
	t.Parallel()

	var receivedPath string
	var redirectPort string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.RequestURI()
		http.Redirect(w, r, "http://localhost:"+redirectPort+r.URL.Path+"/next", http.StatusTemporaryRedirect)
	}))
	defer upstream.Close()
	target, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	redirectPort = target.Port()

	srv, err := New(Options{
		Backend: &stubBackend{},
		PortForward: &stubPortForwardBackend{forwards: map[string]pfregistry.Forward{
			"demo": {ForwardID: "demo", TargetURL: upstream.URL},
		}},
		DistFS:             fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}},
		ConfigPath:         writeLocalUITestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "http://pf-demo.localhost:23998/pf/demo/assets/app.js?rev=1", nil)
	req = WithLocalUIPortForwardOrigin(req, "demo")
	rr := httptest.NewRecorder()
	srv.serveHTTP(rr, req)

	if receivedPath != "/pf/demo/assets/app.js?rev=1" {
		t.Fatalf("upstream request = %q, want application path unchanged", receivedPath)
	}
	wantLocation := "/pf/demo/assets/app.js/next"
	if rr.Code != http.StatusTemporaryRedirect || rr.Header().Get("Location") != wantLocation {
		t.Fatalf("response = %d Location %q, want %d %q", rr.Code, rr.Header().Get("Location"), http.StatusTemporaryRedirect, wantLocation)
	}
}

func TestServer_LocalUIPortForwardProxyMarksUnavailableUpstream(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen() error = %v", err)
	}
	targetURL := "http://" + listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatalf("listener.Close() error = %v", err)
	}

	srv, err := New(Options{
		Backend: &stubBackend{},
		PortForward: &stubPortForwardBackend{forwards: map[string]pfregistry.Forward{
			"offline": {
				ForwardID: "offline",
				TargetURL: targetURL,
			},
		}},
		DistFS:             fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}},
		ConfigPath:         writeLocalUITestConfig(t),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/pf/offline/", nil)
	req = WithLocalUIPortForwardRoute(req, "offline")
	rr := httptest.NewRecorder()
	srv.serveHTTP(rr, req)

	if rr.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d, body=%s", rr.Code, http.StatusBadGateway, rr.Body.String())
	}
	if got := rr.Header().Get(portForwardProxyErrorHeader); got != portForwardProxyUpstreamUnavailable {
		t.Fatalf("%s = %q, want %q", portForwardProxyErrorHeader, got, portForwardProxyUpstreamUnavailable)
	}
	if got := rr.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want %q", got, "no-store")
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
