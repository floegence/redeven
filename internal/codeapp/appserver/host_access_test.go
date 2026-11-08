package appserver

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/hostapps"
	"github.com/floegence/redeven/internal/remotedesktop"
	"github.com/floegence/redeven/internal/session"
)

func TestHostAccessDisabledBlocksStreamsButNotLocalLaunch(t *testing.T) {
	path := writeTestConfig(t)
	_, err := config.Update(path, func(cfg *config.Config) error {
		cfg.HostAccess = &config.HostAccessConfig{Applications: "paused", Desktop: "unconfigured"}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	backend := &hostAppsStub{}
	desktop := remotedesktop.New(t.TempDir(), nil, nil)
	defer desktop.Close()
	server := &Server{configPath: path, hostApps: backend, remoteDesktop: desktop, resolveSessionMeta: resolveMetaForTest("ch_access", session.Meta{UserPublicID: "alice", CanRead: true, CanWrite: true, CanExecute: true})}
	for _, mode := range []string{"stream", "native"} {
		r := httptest.NewRequest(http.MethodPost, hostApplicationsAPI+"/sessions", strings.NewReader(`{"application_id":"editor","mode":"`+mode+`"}`))
		r.Header.Set("Origin", envOriginWithChannel("ch_access"))
		w := httptest.NewRecorder()
		server.handleHostApplicationsAPI(w, r)
		want := http.StatusConflict
		if mode == "native" {
			want = http.StatusAccepted
		}
		if w.Code != want {
			t.Fatal(mode, w.Code, w.Body.String())
		}
	}
	if backend.calls != 1 {
		t.Fatal("disabled stream reached backend")
	}
	r := httptest.NewRequest(http.MethodPost, remoteDesktopAPI+"/sessions", strings.NewReader(`{"mode":"view"}`))
	r.Header.Set("Origin", envOriginWithChannel("ch_access"))
	w := httptest.NewRecorder()
	server.handleRemoteDesktopAPI(w, r)
	if w.Code != http.StatusConflict || strings.Count(w.Body.String(), `"ok"`) != 1 {
		t.Fatal("desktop admission or response violated", w.Code, w.Body.String())
	}
	for _, target := range []string{"applications", "desktop"} {
		r := httptest.NewRequest(http.MethodGet, "/pf/one/control", nil)
		r.Header.Set("Origin", envOriginWithChannel("ch_access"))
		w := httptest.NewRecorder()
		if target == "applications" {
			server.guardHostApplicationSession(w, r, hostapps.Session{ID: "one"}, "alice", "/pf/one")
		} else {
			server.guardRemoteDesktopSession(w, r, remotedesktop.Session{ID: "one"}, "alice", "/pf/one")
		}
		if w.Code != http.StatusConflict {
			t.Fatal("disabled forward admitted", target, w.Code)
		}
	}
}

type hostAccessBackend struct {
	hostAppsStub
	enabled []bool
	ready   bool
	probes  int
}

func (s *hostAccessBackend) Catalog(context.Context, string, string) (hostapps.Catalog, error) {
	s.probes++
	return hostapps.Catalog{Availability: hostapps.Availability{Ready: s.ready}}, nil
}

func (s *hostAccessBackend) SetAccessEnabled(_ context.Context, enabled bool) error {
	s.enabled = append(s.enabled, enabled)
	return nil
}

func TestHostAccessMutationInvokesScopedBackendRevocation(t *testing.T) {
	backend := &hostAccessBackend{}
	server := &Server{configPath: writeTestConfig(t), hostApps: backend, resolveSessionMeta: resolveMetaForTest("ch_access", session.Meta{UserPublicID: "alice", CanRead: true, CanWrite: true, CanExecute: true})}
	for _, state := range []string{"paused", "unconfigured", "enabled"} {
		r := httptest.NewRequest(http.MethodPut, hostApplicationsAPI+"/access", strings.NewReader(`{"state":"`+state+`"}`))
		r.Header.Set("Origin", envOriginWithChannel("ch_access"))
		w := httptest.NewRecorder()
		server.handleHostApplicationsAPI(w, r)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if len(backend.enabled) != 3 || backend.enabled[0] || backend.enabled[1] || !backend.enabled[2] {
		t.Fatal(backend.enabled)
	}
	if backend.calls != 0 {
		t.Fatal("feature pause invoked an application lifecycle operation")
	}
}

func TestHostAccessLifecycleKeepsFeaturesIndependent(t *testing.T) {
	path := writeTestConfig(t)
	cfg, _ := config.Load(path)
	cfg.RemoteDesktop = &config.RemoteDesktopConfig{LastDisplayID: "monitor", ApprovalPreferenceSet: true, Unattended: true}
	if err := config.Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	desktop := remotedesktop.New(t.TempDir(), nil, nil)
	defer desktop.Close()
	server := &Server{configPath: path, hostApps: &hostAppsStub{}, remoteDesktop: desktop, resolveSessionMeta: resolveMetaForTest("ch_access", session.Meta{UserPublicID: "alice", CanRead: true, CanWrite: true, CanExecute: true})}
	for _, step := range []struct{ feature, state string }{{"applications", "enabled"}, {"desktop", "enabled"}, {"applications", "paused"}, {"applications", "unconfigured"}, {"applications", "enabled"}} {
		path := hostApplicationsAPI + "/access"
		if step.feature == "desktop" {
			path = remoteDesktopAPI + "/access"
		}
		r := httptest.NewRequest(http.MethodPut, path, strings.NewReader(`{"state":"`+step.state+`"}`))
		r.Header.Set("Origin", envOriginWithChannel("ch_access"))
		w := httptest.NewRecorder()
		if step.feature == "desktop" {
			server.handleRemoteDesktopAPI(w, r)
		} else {
			server.handleHostApplicationsAPI(w, r)
		}
		if w.Code != 200 {
			t.Fatalf("%s %s: %d %s", step.feature, step.state, w.Code, w.Body.String())
		}
		saved, err := config.Load(server.configPath)
		if err != nil {
			t.Fatal(err)
		}
		data, _ := json.Marshal(saved)
		var value map[string]any
		_ = json.Unmarshal(data, &value)
		access, ok := value["host_access"].(map[string]any)
		if !ok || access[step.feature] != step.state {
			t.Fatal("access state was not persisted", string(data))
		}
		if step.feature == "applications" && step.state != "enabled" && access["desktop"] != "enabled" {
			t.Fatal("unrelated feature changed")
		}
		if !saved.RemoteDesktop.RememberApproval() || saved.RemoteDesktop.LastDisplayID != "monitor" {
			t.Fatal("application settings removed desktop preferences")
		}
	}
}

func TestHostAccessRequiresExplicitStateAndFullPermission(t *testing.T) {
	for _, full := range []bool{false, true} {
		server := &Server{configPath: writeTestConfig(t), hostApps: &hostAppsStub{}, resolveSessionMeta: resolveMetaForTest("ch_access", session.Meta{UserPublicID: "alice", CanRead: true, CanWrite: full, CanExecute: full})}
		for _, body := range []string{`{}`, `{"state":"unexpected"}`, `{"state":"enabled","extra":true}`} {
			r := httptest.NewRequest(http.MethodPut, hostApplicationsAPI+"/access", strings.NewReader(body))
			r.Header.Set("Origin", envOriginWithChannel("ch_access"))
			w := httptest.NewRecorder()
			server.handleHostApplicationsAPI(w, r)
			want := http.StatusForbidden
			if full {
				want = http.StatusBadRequest
			}
			if w.Code != want {
				t.Fatalf("%t %s: %d %s", full, body, w.Code, w.Body.String())
			}
		}
	}
}

func TestHostAccessInitializationKeepsReadinessSeparateFromIntent(t *testing.T) {
	for _, ready := range []bool{false, true} {
		path := writeTestConfig(t)
		backend := &hostAccessBackend{ready: ready}
		desktop := remotedesktop.New(t.TempDir(), nil, nil)
		server := &Server{configPath: path, hostApps: backend, remoteDesktop: desktop}
		if err := server.initializeHostAccess(context.Background(), "alice"); err != nil {
			t.Fatal(err)
		}
		want := "unconfigured"
		if ready {
			want = "enabled"
		}
		saved, err := config.Load(path)
		if err != nil || saved.HostAccess.Applications != want || saved.HostAccess.Desktop != "unconfigured" {
			t.Fatalf("initial states: %+v %v", saved.HostAccess, err)
		}
		if len(backend.enabled) != 1 || backend.enabled[0] != ready {
			t.Fatal("manager did not receive initialized intent", backend.enabled)
		}
		backend.ready = !ready
		if err := server.initializeHostAccess(context.Background(), "alice"); err != nil {
			t.Fatal(err)
		}
		state, err := server.hostAccessState(false)
		if err != nil || state != want || backend.probes != 1 {
			t.Fatal("later capability change rewrote intent", state, backend.probes, err)
		}
		if _, err := desktop.Create(context.Background(), "alice", remotedesktop.CreateRequest{Mode: "view"}, false); err != remotedesktop.ErrForbidden {
			t.Fatal("desktop manager did not receive initialized policy", err)
		}
		desktop.Close()
	}
}

func TestHostAccessPauseSurvivesServerRestart(t *testing.T) {
	path := writeTestConfig(t)
	if _, err := config.Update(path, func(cfg *config.Config) error {
		cfg.HostAccess = &config.HostAccessConfig{Applications: "paused", Desktop: "paused"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	backend := &hostAccessBackend{ready: true}
	desktop := remotedesktop.New(t.TempDir(), nil, nil)
	defer desktop.Close()
	server, err := New(Options{Backend: &stubBackend{}, DistFS: fstest.MapFS{}, ConfigPath: path, HostApplications: backend, RemoteDesktop: desktop, ResolveSessionMeta: resolveMetaForTest("ch_access", session.Meta{UserPublicID: "alice", CanRead: true, CanWrite: true, CanExecute: true})})
	if err != nil {
		t.Fatal(err)
	}
	if err := server.initializeHostAccess(context.Background(), "alice"); err != nil {
		t.Fatal(err)
	}
	if len(backend.enabled) != 1 || backend.enabled[0] || backend.probes != 0 {
		t.Fatal(backend.enabled, backend.probes)
	}
	if _, err := desktop.Create(context.Background(), "alice", remotedesktop.CreateRequest{Mode: "view"}, false); err != remotedesktop.ErrForbidden {
		t.Fatal(err)
	}
}

func TestHostAccessDesktopRemovalKeepsApplicationsAndSharedPermissions(t *testing.T) {
	path := writeTestConfig(t)
	if _, err := config.Update(path, func(cfg *config.Config) error {
		cfg.HostAccess = &config.HostAccessConfig{Applications: "enabled", Desktop: "enabled"}
		cfg.RemoteDesktop = &config.RemoteDesktopConfig{LastDisplayID: "monitor", Unattended: true}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	backend := &hostAccessBackend{ready: true}
	desktop := remotedesktop.New(t.TempDir(), nil, nil)
	defer desktop.Close()
	server := &Server{configPath: path, hostApps: backend, remoteDesktop: desktop, resolveSessionMeta: resolveMetaForTest("ch_access", session.Meta{UserPublicID: "alice", CanRead: true, CanWrite: true, CanExecute: true})}
	r := httptest.NewRequest(http.MethodPut, remoteDesktopAPI+"/access", strings.NewReader(`{"state":"unconfigured"}`))
	r.Header.Set("Origin", envOriginWithChannel("ch_access"))
	w := httptest.NewRecorder()
	server.handleRemoteDesktopAPI(w, r)
	if w.Code != http.StatusOK {
		t.Fatal(w.Code, w.Body.String())
	}
	saved, err := config.Load(path)
	if err != nil || saved.RemoteDesktop != nil || saved.HostAccess.Applications != "enabled" || saved.HostAccess.Desktop != "unconfigured" {
		t.Fatal(saved, err)
	}
	if len(backend.enabled) != 0 || backend.calls != 0 || !backend.ready {
		t.Fatal("desktop removal changed application capability")
	}
	if err := server.initializeHostAccess(context.Background(), "alice"); err != nil {
		t.Fatal(err)
	}
	if backend.probes != 0 {
		t.Fatal("removal caused capability-based reenable")
	}
}
