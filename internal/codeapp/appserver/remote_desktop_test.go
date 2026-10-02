package appserver

import (
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/remotedesktop"
	"github.com/floegence/redeven/internal/session"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRemoteDesktopSettingsPreserveRememberedDisplayAcrossRestart(t *testing.T) {
	path := writeTestConfig(t)
	cfg, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	cfg.RemoteDesktop = &config.RemoteDesktopConfig{LastDisplayID: "fixture-monitor"}
	if err = config.Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	manager := remotedesktop.New(t.TempDir(), nil, nil)
	defer manager.Close()
	server := &Server{configPath: path, remoteDesktop: manager, resolveSessionMeta: resolveMetaForTest("ch_desktop", session.Meta{UserPublicID: "alice", CanRead: true, CanWrite: true, CanExecute: true})}
	r := httptest.NewRequest("PUT", remoteDesktopAPI+"/settings", strings.NewReader(`{"unattended":true}`))
	r.Header.Set("Origin", envOriginWithChannel("ch_desktop"))
	w := httptest.NewRecorder()
	server.handleRemoteDesktopAPI(w, r)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	reloaded, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.RemoteDesktop == nil || !reloaded.RemoteDesktop.Unattended || reloaded.RemoteDesktop.LastDisplayID != "fixture-monitor" {
		t.Fatal("settings lost saved desktop preference")
	}
}

func TestRemoteDesktopRequiresFullPermissionForEverySessionRoute(t *testing.T) {
	server := &Server{resolveSessionMeta: resolveMetaForTest("ch_desktop", session.Meta{UserPublicID: "alice", CanRead: true})}
	for _, route := range []struct{ method, path string }{
		{"POST", "/sessions"}, {"GET", "/sessions/one"}, {"POST", "/sessions/one/takeover"}, {"POST", "/sessions/one/display"}, {"POST", "/sessions/one/mode"}, {"POST", "/sessions/one/lock"}, {"DELETE", "/sessions/one"}, {"PUT", "/settings"}, {"POST", "/setup"},
	} {
		r := httptest.NewRequest(route.method, remoteDesktopAPI+route.path, strings.NewReader(`{}`))
		r.Header.Set("Origin", envOriginWithChannel("ch_desktop"))
		w := httptest.NewRecorder()
		server.handleRemoteDesktopAPI(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("read-only session route allowed: %s %s %d", route.method, route.path, w.Code)
		}
	}
	r := httptest.NewRequest("GET", remoteDesktopAPI, nil)
	r.Header.Set("Origin", envOriginWithChannel("ch_desktop"))
	w := httptest.NewRecorder()
	server.handleRemoteDesktopAPI(w, r)
	if w.Code == http.StatusForbidden {
		t.Fatal("capability read requires control permission")
	}
}
func TestRemoteDesktopForwardOwnerProtectsViewOnlyAndMedia(t *testing.T) {
	for _, test := range []struct {
		owner   string
		full    bool
		allowed bool
	}{{"alice", true, true}, {"alice", false, false}, {"bob", true, false}} {
		server := &Server{resolveSessionMeta: resolveMetaForTest("ch_desktop", session.Meta{UserPublicID: test.owner, CanRead: true, CanWrite: test.full, CanExecute: test.full})}
		s := remotedesktop.Session{ID: "one", Mode: "view", Locale: "en-US", HostName: "fixture"}
		for _, path := range []string{"", "control", "media", "assets/host_desktop_player.mjs", "assets/icons.generated.js"} {
			r := httptest.NewRequest("GET", "/pf/owned"+remotedesktop.ViewerPath+path, nil)
			r.Header.Set("Origin", envOriginWithChannel("ch_desktop"))
			w := httptest.NewRecorder()
			handled := server.guardRemoteDesktopSession(w, r, s, "alice", "/pf/owned")
			if !test.allowed && (!handled || w.Code != http.StatusForbidden) {
				t.Fatalf("owner/full bypass: %+v %s %d", test, path, w.Code)
			}
			if test.allowed && (path == "control" || path == "media") && handled {
				t.Fatal("authorized channel did not reach independent native authentication")
			}
		}
	}
}
func TestRemoteDesktopDocumentKeepsCredentialsOutOfURLAndEscapesIdentity(t *testing.T) {
	w := httptest.NewRecorder()
	server := &Server{}
	server.serveRemoteDesktop(w, httptest.NewRequest(http.MethodGet, "/pf/one/_redeven_desktop/", nil), remotedesktop.Session{ID: "fixture", Locale: "en-US", HostName: `</script><script>alert(1)</script>`}, "/pf/one")
	html := w.Body.String()
	if !strings.Contains(html, `"base":"/pf/one/_redeven_desktop/"`) || strings.Contains(html, `<script>alert(1)</script>`) {
		t.Fatal("viewer identity or base is unsafe")
	}
	if strings.Contains(html, `"token"`) || !strings.Contains(w.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Fatal("bootstrap leaked credentials or allowed framing")
	}
}
