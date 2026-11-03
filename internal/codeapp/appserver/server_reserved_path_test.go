package appserver

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
	"github.com/floegence/redeven/internal/session"
)

func TestServer_PortForwardReservedPathsAreMarkedWithoutReachingUpstream(t *testing.T) {
	upstreamCalls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamCalls++
		// An application cannot impersonate a Runtime-owned failure.
		w.Header().Set("X-Redeven-Proxy-Error", "port-forward-reserved-path")
		http.Error(w, "application page missing", http.StatusNotFound)
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
		t.Fatal(err)
	}
	for _, path := range []string{"/_redeven_proxy/env/", "/_redeven_proxy/env/assets/main.js", "/_redeven_proxy/api/settings", "/_redeven_proxy/unknown", "/_redevplugin/api/plugins/catalog"} {
		t.Run(path, func(t *testing.T) {
			req := WithLocalUIPortForwardOrigin(httptest.NewRequest(http.MethodGet, "http://pf-demo.localhost:23998"+path, nil), "demo")
			response := httptest.NewRecorder()
			srv.ServeHTTP(response, req)
			if response.Code != http.StatusNotFound || response.Header().Get("X-Redeven-Proxy-Error") != "port-forward-reserved-path" {
				t.Fatalf("status=%d marker=%q body=%q", response.Code, response.Header().Get("X-Redeven-Proxy-Error"), response.Body.String())
			}
			if upstreamCalls != 0 {
				t.Fatal("reserved path reached upstream")
			}
		})
	}
	req := WithLocalUIPortForwardOrigin(httptest.NewRequest(http.MethodGet, "http://pf-demo.localhost:23998/missing", nil), "demo")
	response := httptest.NewRecorder()
	srv.ServeHTTP(response, req)
	if response.Code != http.StatusNotFound || response.Body.String() != "application page missing\n" || response.Header().Get("X-Redeven-Proxy-Error") != "" || upstreamCalls != 1 {
		t.Fatalf("application response changed: status=%d marker=%q body=%q calls=%d", response.Code, response.Header().Get("X-Redeven-Proxy-Error"), response.Body.String(), upstreamCalls)
	}
}
