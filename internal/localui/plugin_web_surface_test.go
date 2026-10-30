package localui

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/floegence/redeven/internal/codeapp/appserver"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
)

func TestDesktopPluginOriginNeverEntersPrivateManagement(t *testing.T) {
	s := newTestServer(t, nil)
	s.localUIBridgeToken = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	child := strings.Repeat("a", 48) + ".localhost:24000"
	for _, token := range []string{"", s.localUIBridgeToken} {
		for _, path := range []string{"/_redevplugin_web/bootstrap", "/api/local/runtime", "/_redevplugin/api/plugins/catalog", "/flowersec/v3/direct"} {
			req := httptest.NewRequest(http.MethodGet, "http://"+child+path, nil)
			req.Header.Set(localDesktopBridgeTokenHeader, token)
			response := httptest.NewRecorder()
			s.HandlerForDesktopBridge().ServeHTTP(response, req)
			if response.Code != http.StatusNotFound {
				t.Fatalf("child path %s, token present=%t: status=%d, want unavailable resource handler 404", path, token != "", response.Code)
			}
		}
	}
	parent := httptest.NewRecorder()
	s.HandlerForDesktopBridge().ServeHTTP(parent, httptest.NewRequest(http.MethodGet, "http://127.0.0.1:24000/api/local/runtime", nil))
	if parent.Code != http.StatusUnauthorized {
		t.Fatalf("parent management admitted without private token: %d", parent.Code)
	}
}

func TestGatewayPluginOriginNeverEntersManagement(t *testing.T) {
	s := newTestServer(t, nil)
	if err := s.configureAcceptor(); err != nil {
		t.Fatal(err)
	}
	parent := "https://r-" + strings.Repeat("b", 40) + ".redeven.invalid"
	app := s.gatewayMemberApplication(parent)
	for _, path := range []string{"/_redevplugin_web/bootstrap", "/api/local/runtime", "/_redevplugin/api/plugins/catalog"} {
		req := httptest.NewRequest(http.MethodGet, "https://"+strings.Repeat("a", 48)+"."+strings.TrimPrefix(parent, "https://")+path, nil)
		req.TLS = &tls.ConnectionState{}
		w := httptest.NewRecorder()
		app.Handler.ServeHTTP(w, req)
		if w.Code != 404 {
			t.Fatalf("resource route %s: %d", path, w.Code)
		}
	}
}

func TestDesktopPluginResourceRouteStripsHostAuthority(t *testing.T) {
	configPath := writeTestConfig(t)
	child := strings.Repeat("b", 48) + ".localhost:24000"
	called := false
	app, err := appserver.New(appserver.Options{
		Backend:    localUITestBackend{},
		DistFS:     fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}},
		ConfigPath: configPath,
		ResolveSessionMeta: func(string) (*session.Meta, bool) {
			t.Fatal("resource route resolved a management session")
			return nil, false
		},
		PluginPlatform: http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("resource entered management") }),
		PluginWebSurface: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			called = true
			if r.Host != child || r.URL.Path != "/assets/app.js" {
				t.Fatalf("resource changed: %s %s", r.Host, r.URL.Path)
			}
			for _, name := range []string{localDesktopBridgeTokenHeader, localAccessResumeHeader, "Authorization", "Proxy-Authorization", "X-Redeven-Tessiven-Source", "X-Redeven-Host-Access", sessionhop.HeaderChannelID} {
				if r.Header.Get(name) != "" {
					t.Errorf("host credential survived: %s", name)
				}
			}
			if r.Header.Get("Cookie") != "__Host-rdp-surface=resource; app=value" {
				t.Errorf("unexpected resource cookies: %s", r.Header.Get("Cookie"))
			}
			w.Header().Set("Content-Security-Policy", "frame-ancestors http://127.0.0.1:24000")
			w.WriteHeader(http.StatusNoContent)
		}),
	})
	if err != nil {
		t.Fatal(err)
	}
	s := newTestServerWithAppServer(t, nil, app, configPath)
	req := httptest.NewRequest(http.MethodGet, "http://"+child+"/assets/app.js", nil)
	for _, name := range []string{localDesktopBridgeTokenHeader, localAccessResumeHeader, "Authorization", "Proxy-Authorization", "X-Redeven-Tessiven-Source", "X-Redeven-Host-Access", sessionhop.HeaderChannelID} {
		req.Header.Set(name, "parent-secret")
	}
	req.Header.Set("Cookie", "redeven_local_access_http_24000=parent; __Host-redeven-access=parent; __redeven_web_service_browser_session_v1=parent; __Host-rdp-surface=resource; app=value")
	response := httptest.NewRecorder()
	s.HandlerForDesktopBridge().ServeHTTP(response, req)
	if !called || response.Code != http.StatusNoContent {
		t.Fatalf("resource handler: called=%t status=%d", called, response.Code)
	}
	if response.Header().Get("X-Frame-Options") != "" || response.Header().Get("Content-Security-Policy") != "frame-ancestors http://127.0.0.1:24000" {
		t.Fatal("parent embedding policy replaced platform policy")
	}
	s.protocol = "http"
	s.publicAccess.authorities = map[string]struct{}{"127.0.0.1:24000": {}}
	called = false
	response = httptest.NewRecorder()
	s.networkHandler().ServeHTTP(response, req)
	if !called || response.Code != http.StatusNoContent {
		t.Fatalf("public loopback resource handler: called=%t status=%d", called, response.Code)
	}
	if response.Header().Get("X-Frame-Options") != "" || response.Header().Get("Content-Security-Policy") != "frame-ancestors http://127.0.0.1:24000" {
		t.Fatal("public parent embedding policy replaced platform policy")
	}
}

func TestPublicPluginOriginRequiresCurrentLoopbackListener(t *testing.T) {
	child := strings.Repeat("b", 48) + ".localhost:24000"
	for _, tc := range []struct {
		name, protocol, parent, authority string
		want                              int
	}{
		{"ipv4", "http", "127.0.0.1:24000", child, http.StatusNotFound},
		{"localhost", "http", "localhost:24000", child, http.StatusNotFound},
		{"ipv6", "http", "[::1]:24000", child, http.StatusNotFound},
		{"wrong port", "http", "127.0.0.1:24001", child, http.StatusMisdirectedRequest},
		{"network only", "http", "192.0.2.1:24000", child, http.StatusMisdirectedRequest},
		{"tls has no localhost certificate", "https", "127.0.0.1:24000", child, http.StatusMisdirectedRequest},
		{"unrelated hostname", "http", "127.0.0.1:24000", strings.Repeat("b", 48) + ".localhost.evil:24000", http.StatusMisdirectedRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := newTestServer(t, nil)
			s.protocol = tc.protocol
			s.publicAccess.authorities = map[string]struct{}{tc.parent: {}}
			for _, path := range []string{"/_redevplugin_web/bootstrap", "/api/local/runtime", "/_redevplugin/api/plugins/catalog/query", "/flowersec/v3/direct"} {
				req := httptest.NewRequest(http.MethodGet, "http://"+tc.authority+path, nil)
				response := httptest.NewRecorder()
				s.networkHandler().ServeHTTP(response, req)
				if response.Code != tc.want {
					t.Fatalf("%s status=%d, want %d", path, response.Code, tc.want)
				}
			}
		})
	}
}

func TestDesktopPluginOriginRequiresExactAuthority(t *testing.T) {
	key := strings.Repeat("a", 48)
	for _, authority := range []string{key + ".localhost:0", key + ".localhost:024000", key + ".localhost:65536", key + ".localhost.", key + ".localhost", key + ".localhost.evil:24000", key + ".extra.localhost:24000", strings.ToUpper(key) + ".localhost:24000", " " + key + ".localhost:24000", strings.Repeat("a", 47) + ".localhost:24000"} {
		if origin, ok := desktopPluginWebOrigin(authority); ok {
			t.Errorf("accepted malformed authority %q as %q", authority, origin)
		}
	}
}
