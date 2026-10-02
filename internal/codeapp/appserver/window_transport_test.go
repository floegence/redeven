package appserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/hostapps"
	"github.com/floegence/redeven/internal/remotedesktop"
)

func TestWindowTransportProgramIsServedExactlyOnce(t *testing.T) {
	const script = "globalThis.RedevenWindowTransport = {};"
	server := &Server{distFS: fstest.MapFS{"window-transport.js": &fstest.MapFile{Data: []byte(script)}}}
	w := httptest.NewRecorder()
	r := WithLocalUIEnvRoute(httptest.NewRequest(http.MethodGet, "http://localhost"+windowTransportScript, nil))
	server.ServeHTTP(w, r)
	if w.Code != http.StatusOK || w.Body.String() != script {
		t.Fatalf("invalid transport program response: %d %q", w.Code, w.Body.String())
	}
}

func TestGraphicalWindowsRejectRawLocalDataConnections(t *testing.T) {
	server := &Server{localPermissionCap: &config.PermissionSet{Read: true, Write: true, Execute: true}}
	for _, route := range []struct{ method, path string }{
		{"POST", "/_redeven_desktop/ticket"}, {"GET", "/_redeven_desktop/control"}, {"GET", "/_redeven_desktop/media"}, {"POST", "/_redeven_desktop/disconnect"},
		{"GET", "/_redeven_host_app/state"}, {"GET", "/_redeven_host_app/stream"}, {"GET", "/"},
	} {
		t.Run(route.path, func(t *testing.T) {
			r := WithLocalUIPortForwardRoute(httptest.NewRequest(route.method, "http://localhost/pf/one"+route.path, nil), "one")
			if route.path == "/" {
				r.Header.Set("Upgrade", "websocket")
			}
			w := httptest.NewRecorder()
			handled := false
			if strings.HasPrefix(route.path, "/_redeven_desktop/") {
				handled = server.guardRemoteDesktopSession(w, r, remotedesktop.Session{ID: "one"}, localUserPublicID, "/pf/one")
			} else {
				handled = server.guardHostApplicationSession(w, r, hostapps.Session{ID: "one", State: "running"}, localUserPublicID, "/pf/one")
			}
			if !handled || w.Code != http.StatusForbidden {
				t.Fatalf("raw graphical data was accepted: handled=%v status=%d", handled, w.Code)
			}
		})
	}
}
