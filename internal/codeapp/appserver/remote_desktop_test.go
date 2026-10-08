package appserver

import (
	"encoding/json"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/remotedesktop"
	"github.com/floegence/redeven/internal/session"
	"net/http"
	"net/http/httptest"
	"os"
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
	if reloaded.RemoteDesktop == nil || !reloaded.RemoteDesktop.RememberApproval() || !reloaded.RemoteDesktop.ApprovalPreferenceSet || reloaded.RemoteDesktop.LastDisplayID != "fixture-monitor" {
		t.Fatal("settings lost saved desktop preference")
	}
}

func TestRemoteDesktopRequiresFullPermissionForEverySessionRoute(t *testing.T) {
	server := &Server{resolveSessionMeta: resolveMetaForTest("ch_desktop", session.Meta{UserPublicID: "alice", CanRead: true})}
	for _, route := range []struct{ method, path string }{
		{"POST", "/sessions"}, {"GET", "/sessions/one"}, {"POST", "/sessions/one/takeover"}, {"POST", "/sessions/one/display"}, {"POST", "/sessions/one/mode"}, {"POST", "/sessions/one/lock"}, {"DELETE", "/sessions/one"}, {"PUT", "/settings"}, {"DELETE", "/authorization"}, {"POST", "/setup"}, {"POST", "/service/deployment"}, {"POST", "/service/install"}, {"DELETE", "/service"},
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

func TestRemoteDesktopApprovalSettingsRequireExplicitChoiceAndSurviveReload(t *testing.T) {
	path := writeTestConfig(t)
	for _, choice := range []struct {
		body, policy string
		status       int
		remember     bool
	}{
		{`{}`, "", 400, true},
		{`{"unattended":null}`, "", 400, true},
		{`{"unattended":false}`, "session", 200, false},
		{`{}`, "", 400, false},
		{`{"unattended":true}`, "persistent", 200, true},
	} {
		// Each request uses a fresh manager/server and reads the persisted file.
		manager := remotedesktop.New(t.TempDir(), nil, nil)
		server := &Server{configPath: path, remoteDesktop: manager, resolveSessionMeta: resolveMetaForTest("ch_desktop", session.Meta{UserPublicID: "alice", CanRead: true, CanWrite: true, CanExecute: true})}
		r := httptest.NewRequest("PUT", remoteDesktopAPI+"/settings", strings.NewReader(choice.body))
		r.Header.Set("Origin", envOriginWithChannel("ch_desktop"))
		w := httptest.NewRecorder()
		server.handleRemoteDesktopAPI(w, r)
		manager.Close()
		if w.Code != choice.status {
			t.Fatalf("%s: %d %s", choice.body, w.Code, w.Body.String())
		}
		if choice.status == 200 && !strings.Contains(w.Body.String(), `"approval_policy":"`+choice.policy+`"`) {
			t.Fatal(w.Body.String())
		}
		cfg, err := config.Load(path)
		if err != nil {
			t.Fatal(err)
		}
		if cfg.RemoteDesktop.RememberApproval() != choice.remember {
			t.Fatal("effective policy did not survive reload")
		}
		if choice.status == 200 && !cfg.RemoteDesktop.ApprovalPreferenceSet {
			t.Fatal("explicit choice was not recorded")
		}
	}
}

func TestRemoteDesktopStatusReportsEffectivePolicyFromLegacyConfiguration(t *testing.T) {
	for _, setting := range []*config.RemoteDesktopConfig{nil, {}, {Unattended: false}, {Unattended: true}, {Unattended: false, ApprovalPreferenceSet: true}} {
		path := writeTestConfig(t)
		cfg, err := config.Load(path)
		if err != nil {
			t.Fatal(err)
		}
		cfg.RemoteDesktop = setting
		if err = config.Save(path, cfg); err != nil {
			t.Fatal(err)
		}
		manager := remotedesktop.New(t.TempDir(), nil, nil)
		server := &Server{configPath: path, remoteDesktop: manager, resolveSessionMeta: resolveMetaForTest("ch_desktop", session.Meta{UserPublicID: "alice", CanRead: true})}
		r := httptest.NewRequest("GET", remoteDesktopAPI, nil)
		r.Header.Set("Origin", envOriginWithChannel("ch_desktop"))
		w := httptest.NewRecorder()
		server.handleRemoteDesktopAPI(w, r)
		manager.Close()
		policy := "session"
		if setting.RememberApproval() {
			policy = "persistent"
		}
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"approval_policy":"`+policy+`"`) {
			t.Fatal(w.Code, w.Body.String())
		}
	}
}

func TestRemoteDesktopDeploymentAuditRejectsCredentialsAndUnconfirmedOutcomes(t *testing.T) {
	manager := remotedesktop.New(t.TempDir(), nil, nil)
	defer manager.Close()
	server := &Server{remoteDesktop: manager, resolveSessionMeta: resolveMetaForTest("ch_desktop", session.Meta{UserPublicID: "alice", CanRead: true, CanWrite: true, CanExecute: true})}
	for _, test := range []struct {
		body   string
		status int
	}{
		{`{"operation":"install","phase":"authorize"}`, 200},
		{`{"operation":"stop","phase":"result","outcome":"canceled","rollback":"complete"}`, 200},
		{`{"operation":"install","phase":"authorize","administratorPassword":"fixture-only"}`, 400},
		{`{"operation":"install","phase":"authorize","runtime_pid":42}`, 400},
		{`{"operation":"install","phase":"result"}`, 400},
		{`{"operation":"shell","phase":"authorize"}`, 400},
		{`{"operation":"install","phase":"authorize","outcome":"success"}`, 400},
	} {
		r := httptest.NewRequest("POST", remoteDesktopAPI+"/service/deployment", strings.NewReader(test.body))
		r.Header.Set("Origin", envOriginWithChannel("ch_desktop"))
		w := httptest.NewRecorder()
		server.handleRemoteDesktopAPI(w, r)
		if w.Code != test.status {
			t.Fatalf("deployment contract: %d", w.Code)
		}
		if strings.Contains(w.Body.String(), "fixture-only") {
			t.Fatal("credential reflected")
		}
		if test.status == 200 {
			var response struct {
				Data struct {
					RuntimePID int `json:"runtime_pid"`
				} `json:"data"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if strings.Contains(test.body, `"phase":"authorize"`) && response.Data.RuntimePID != os.Getpid() {
				t.Fatal("authorization did not identify its executing Runtime")
			}
			if strings.Contains(test.body, `"phase":"result"`) && response.Data.RuntimePID != 0 {
				t.Fatal("result response exposed unneeded process information")
			}
		}
	}
}
