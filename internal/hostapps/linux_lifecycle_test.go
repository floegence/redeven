package hostapps

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	nativeapps "github.com/floegence/floe-native-apps"

	"github.com/floegence/redeven/internal/portforward"
	"github.com/floegence/redeven/internal/portforward/registry"
	"github.com/gorilla/websocket"
)

func TestStopSharingClosesUpgradedConnectionsWithoutStoppingApplication(t *testing.T) {
	upgrader := websocket.Upgrader{}
	closed := make(chan struct{})
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		defer close(closed)
		for {
			if _, _, err = c.ReadMessage(); err != nil {
				return
			}
		}
	}))
	defer backend.Close()
	proxy, address, err := newApplicationProxy(backend.URL, viewerFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	c, _, err := websocket.DefaultDialer.Dial("ws://"+address, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	state := t.TempDir()
	reg, err := registry.Open(filepath.Join(state, "forwards.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	forwards, err := portforward.New(reg)
	if err != nil {
		t.Fatal(err)
	}
	defer forwards.Close()
	m := New(state, state, forwards)
	f, err := forwards.OpenOwnedForwardSession(context.Background(), "http://"+address+"/_redeven_host_app/")
	if err != nil {
		t.Fatal(err)
	}
	app := &linuxApplication{record: linuxApplicationRecord{ID: "application", Owner: "alice"}}
	s := &ownedSession{owner: "alice", view: Session{ID: "sharing", State: "running", Forward: f}, application: app, proxy: proxy, done: make(chan struct{})}
	m.sessions[s.view.ID] = s
	if err := m.Detach(context.Background(), "bob", s.view.ID); err != ErrNotFound {
		t.Fatal("foreign detach accepted", err)
	}
	if err := m.Detach(context.Background(), "alice", s.view.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("stopped sharing retained an upgraded connection")
	}
	if s.view.State != "ended" || s.view.EndReason != "sharing_stopped" || app.ended {
		t.Fatal("sharing stop ended the application", s.view)
	}
	if c, err := net.DialTimeout("tcp", address, time.Second); err == nil {
		c.Close()
		t.Fatal("retired sharing listener remains accessible")
	}
}

func TestInstalledLinuxApplicationLifetime(t *testing.T) {
	if runtime.GOOS != "linux" || os.Getenv("REDEVEN_TEST_HOST_APPLICATIONS") != "1" {
		t.Skip("requires the installed Linux graphical stack")
	}
	state := t.TempDir()
	reg, err := registry.Open(filepath.Join(state, "forwards.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	forwards, err := portforward.New(reg)
	if err != nil {
		t.Fatal(err)
	}
	defer forwards.Close()
	newManager := func() *Manager {
		m := New(state, state, forwards)
		pkg, err := nativeapps.NativePackage()
		if err != nil {
			t.Fatal(err)
		}
		m.setup, err = nativeapps.New(os.Getenv("REDEVEN_TEST_NATIVE_COMPONENT_STATE"), pkg, nil)
		if err != nil {
			t.Fatal(err)
		}
		return m
	}
	m := newManager()
	defer func() { _ = m.Close() }()
	fixture := filepath.Join(state, "fixture.py")
	if err = os.WriteFile(fixture, []byte(`import gi, os, pathlib, sys
gi.require_version("Gtk","3.0")
from gi.repository import Gtk, GLib
root=pathlib.Path(sys.argv[1])
(root/"app-pid").write_text(str(os.getpid()))
window=None
dialog=None
delete_count=0
def deleted(widget,event):
    global dialog,delete_count
    if dialog is not None: return True
    delete_count+=1
    (root/"delete-count").write_text(str(delete_count))
    if delete_count==1:
        dialog=Gtk.Dialog(title="Save changes", transient_for=widget, modal=True)
        dialog.add_button("Cancel",Gtk.ResponseType.CANCEL)
        dialog.show_all()
        return True
    return False
def destroyed(widget):
    global window
    window=None
def check():
    global window,dialog
    for action in ("show", "close", "cancel", "exit"):
        path=root/action
        if not path.exists(): continue
        path.unlink()
        if action=="exit": Gtk.main_quit(); return False
        if action=="cancel" and dialog is not None: dialog.destroy(); dialog=None
        if action=="close" and window is not None: window.destroy(); window=None
        if action=="show" and window is None:
            window=Gtk.Window(title="Application lifetime fixture")
            window.connect("delete-event",deleted)
            window.connect("destroy",destroyed)
            window.set_default_size(640,480)
            window.add(Gtk.Label(label="Application stays alive independently of sharing"))
            window.show_all()
    return True
GLib.timeout_add(50,check)
Gtk.main()
`), 0600); err != nil {
		t.Fatal(err)
	}
	if err = m.Add(context.Background(), AddRequest{Name: "Lifecycle fixture", Executable: "/usr/bin/python3", Arguments: quoteArgv([]string{fixture, state})}); err != nil {
		t.Fatal(err)
	}
	catalog, err := m.Catalog(context.Background(), "alice", "en-US")
	if err != nil {
		t.Fatal(err)
	}
	var id string
	for _, app := range catalog.Applications {
		if app.Name == "Lifecycle fixture" {
			id = app.ID
		}
	}
	req := LaunchRequest{ApplicationID: id, Presentation: Presentation{Starting: "Starting", Failed: "Failed", Ended: "Ended", Retry: "Retry", Connecting: "Connecting", Reconnecting: "Reconnecting", Disconnected: "Disconnected", ConnectionHint: "Reconnect", Reconnect: "Reconnect", Locale: "en-US"}}
	first, err := m.Launch(context.Background(), "alice", req)
	if err != nil {
		t.Fatal(err)
	}
	a := m.sessions[first.ID].application
	defer func() {
		_ = os.WriteFile(filepath.Join(state, "exit"), nil, 0600)
		waitUntil(t, func() bool { return !a.record.Process.Alive() }, 5*time.Second)
	}()
	waitUntil(t, func() bool {
		view, _, _ := m.ForForward(first.Forward.Forward.ForwardID)
		return view.State == "running"
	}, 12*time.Second)
	pid, err := os.ReadFile(filepath.Join(state, "app-pid"))
	if err != nil {
		t.Fatal(err)
	}
	// A live background application must not be killed by the former first-window deadline.
	time.Sleep(41 * time.Second)
	if !a.record.Process.Alive() {
		t.Fatal("windowless application exceeded an implicit lifetime deadline")
	}
	if err = os.WriteFile(filepath.Join(state, "show"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, func() bool {
		return sessionHasWindows(context.Background(), a.tools.xpra, applicationSocketDir(a.record.ID))
	}, 5*time.Second)
	oldPassword := m.Password(first.ID)
	if err = m.Detach(context.Background(), "alice", first.ID); err != nil {
		t.Fatal(err)
	}
	if !a.record.Process.Alive() {
		t.Fatal("sharing stop killed application")
	}
	second, err := m.Launch(context.Background(), "alice", req)
	if err != nil {
		t.Fatal(err)
	}
	if second.ID == first.ID || m.sessions[second.ID].application != a {
		t.Fatal("reopen did not create a new share of the same application")
	}

	// The reused backend must reject a previous share's credentials.
	for _, test := range []struct {
		password string
		accepted bool
	}{{oldPassword, false}, {m.Password(second.ID), true}} {
		passwordFile := filepath.Join(state, "probe-password")
		if err := os.WriteFile(passwordFile, []byte(test.password), 0600); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		probe := exec.CommandContext(ctx, a.tools.xpra, "info", "ws://"+a.record.Address+"/", "--password-file="+passwordFile)
		probe.Env = xpraEnvironment(a.tools.environment(os.Environ()))
		configureProcess(probe)
		probe.Cancel = func() error { return killProcess(probe) }
		probe.WaitDelay = time.Second
		_, err := probe.Output()
		cancel()
		if (err == nil) != test.accepted {
			t.Fatalf("rotated credential accepted=%v: %v", test.accepted, err)
		}
	}
	if err = m.Close(); err != nil {
		t.Fatal(err)
	}
	if !a.record.Process.Alive() {
		t.Fatal("runtime shutdown killed application")
	}
	m = newManager()
	running, err := m.Running(context.Background(), "alice")
	if err != nil {
		t.Fatal(err)
	}
	if len(running) != 1 || running[0].Instances[0] != a.record.ID {
		t.Fatalf("runtime did not recover its application: %+v", running)
	}
	foreign, err := m.Running(context.Background(), "bob")
	if err != nil || len(foreign) != 0 {
		t.Fatal("foreign application leaked", err)
	}
	third, err := m.Launch(context.Background(), "alice", req)
	if err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(filepath.Join(state, "app-pid")); string(data) != string(pid) {
		t.Fatal("runtime restart relaunched the application")
	}

	target := QuitRequest{ApplicationID: id, Instances: []string{a.record.ID}}
	if err = m.Quit(context.Background(), "alice", target); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, func() bool { data, _ := os.ReadFile(filepath.Join(state, "delete-count")); return string(data) == "1" }, 5*time.Second)
	info, err := m.applicationCommand(context.Background(), a, "info")
	if err != nil || !strings.Contains(string(info), "modal=True") {
		t.Fatal("normal close did not preserve the save dialog", err, string(info))
	}
	if err = os.WriteFile(filepath.Join(state, "cancel"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, func() bool {
		out, e := m.applicationCommand(context.Background(), a, "info")
		return e == nil && !strings.Contains(string(out), "modal=True")
	}, 5*time.Second)
	if !a.record.Process.Alive() {
		t.Fatal("cancelled close killed application")
	}
	if err = m.Quit(context.Background(), "alice", target); err != nil {
		t.Fatal(err)
	}

	waitUntil(t, func() bool {
		out, e := m.applicationCommand(context.Background(), a, "info")
		return e == nil && strings.Contains(string(out), "state.windows=0")
	}, 5*time.Second)
	if !a.record.Process.Alive() {
		t.Fatal("last window close killed background application")
	}
	if err = os.WriteFile(filepath.Join(state, "show"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, func() bool {
		return sessionHasWindows(context.Background(), a.tools.xpra, applicationSocketDir(a.record.ID))
	}, 5*time.Second)
	if err = os.WriteFile(filepath.Join(state, "exit"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, func() bool {
		view, _, _ := m.ForForward(third.Forward.Forward.ForwardID)
		return view.State == "ended" && view.EndReason == "application_exited"
	}, 5*time.Second)
	t.Logf("same application PID %s survived windowless startup, detach, runtime restart and last-window closure", strings.TrimSpace(string(pid)))
}

func waitUntil(t *testing.T, check func() bool, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if check() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("lifecycle condition was not observed")
}

func TestApplicationRecordValidation(t *testing.T) {
	valid := linuxApplicationRecord{Version: 1, ID: strings.Repeat("a", 64), Owner: "alice", Application: Application{ID: "fixture.desktop"}, Address: "127.0.0.1:4567", Process: nativeapps.ProcessIdentity{PID: 123, Boot: "boot", Started: "1234"}, StartedAt: 1}
	data, _ := json.Marshal(valid)
	if _, err := decodeApplicationRecord(data, valid.ID); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*linuxApplicationRecord){
		func(r *linuxApplicationRecord) { r.Version = 2 }, func(r *linuxApplicationRecord) { r.ID = "../other" },
		func(r *linuxApplicationRecord) { r.Owner = "" }, func(r *linuxApplicationRecord) { r.Process.Started = "" },
		func(r *linuxApplicationRecord) { r.Address = "0.0.0.0:4567" }, func(r *linuxApplicationRecord) { r.Address = "127.0.0.1:65536" },
	} {
		r := valid
		change(&r)
		bytes, _ := json.Marshal(r)
		if _, err := decodeApplicationRecord(bytes, valid.ID); err == nil {
			t.Fatalf("accepted invalid record: %+v", r)
		}
	}
	for _, bytes := range [][]byte{append(append([]byte{}, data...), []byte(` {}`)...), []byte(strings.Replace(string(data), `"version":1`, `"version":1,"unexpected":true`, 1))} {
		if _, err := decodeApplicationRecord(bytes, valid.ID); err == nil {
			t.Fatal("accepted ambiguous or unknown record fields")
		}
	}
}

func TestWindowCloseRequestsPreserveSaveDialogs(t *testing.T) {
	info := "windows.1.title=Document\nwindows.1.modal=False\nwindows.2.title=Save\nwindows.2.modal=True\nwindows.3.transient-for=1\nwindows.4.override-redirect=True\nwindows.5.tray=True\nwindows.6.window-type=('DIALOG',)\nwindows.7.title=Other document\nwindows.7.transient-for=0\nwindows.8.modal=1\n"
	if got := applicationWindowCloseTargets(info); !reflect.DeepEqual(got, []string{"1", "7"}) {
		t.Fatal("normal close targeted a transient surface", got)
	}
}

func TestShutdownWaitsForAdmittedApplicationShare(t *testing.T) {
	m := macFixture(t)
	a := &linuxApplication{record: linuxApplicationRecord{ID: strings.Repeat("a", 64), Owner: "alice", Address: "127.0.0.1:9"}, ready: true}
	if err := os.MkdirAll(m.applicationDir(a.record.ID), 0700); err != nil {
		t.Fatal(err)
	}
	m.appsMu.Lock()
	done := make(chan struct{})
	go func() { _ = m.Close(); close(done) }()
	select {
	case <-done:
		m.appsMu.Unlock()
		t.Fatal("shutdown skipped in-progress admission")
	case <-time.After(30 * time.Millisecond):
	}
	view, err := m.shareApplication(context.Background(), "alice", a, Presentation{}, viewerFixture(t))
	m.appsMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("shutdown did not complete")
	}
	s := m.sessions[view.ID]
	if s.view.State != "ended" || s.password != "" || !s.proxy.closed || a.ended {
		t.Fatal("admitted sharing survived shutdown or ended its application")
	}
}

func installedLifecycleManager(t *testing.T, state string) *Manager {
	t.Helper()
	reg, err := registry.Open(filepath.Join(state, "forwards.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	forwards, err := portforward.New(reg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = forwards.Close() })
	m := New(state, state, forwards)
	pkg, err := nativeapps.NativePackage()
	if err != nil {
		t.Fatal(err)
	}
	m.setup, err = nativeapps.New(os.Getenv("REDEVEN_TEST_NATIVE_COMPONENT_STATE"), pkg, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.Close() })
	return m
}

func TestInstalledLinuxRecoveryAfterRuntimeProcessExit(t *testing.T) {
	if runtime.GOOS != "linux" || os.Getenv("REDEVEN_TEST_HOST_APPLICATIONS") != "1" {
		t.Skip("requires the installed Linux graphical stack")
	}
	if state := os.Getenv("REDEVEN_TEST_LIFECYCLE_CHILD_STATE"); state != "" {
		m := installedLifecycleManager(t, state)
		script := filepath.Join(state, "child.py")
		if err := os.WriteFile(script, []byte("import os,time,pathlib,sys\nif os.fork(): sys.exit(0)\nif os.fork(): sys.exit(0)\npathlib.Path(sys.argv[1]).write_text(str(os.getpid()))\ntime.sleep(120)\n"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := m.Add(context.Background(), AddRequest{Name: "Recovery fixture", Executable: "/usr/bin/python3", Arguments: quoteArgv([]string{script, filepath.Join(state, "pid")})}); err != nil {
			t.Fatal(err)
		}
		catalog, err := m.Catalog(context.Background(), "alice", "en-US")
		if err != nil {
			t.Fatal(err)
		}
		var appID string
		for _, app := range catalog.Applications {
			if app.Name == "Recovery fixture" {
				appID = app.ID
			}
		}
		req := LaunchRequest{ApplicationID: appID, Presentation: Presentation{Starting: "Starting", Failed: "Failed", Ended: "Ended", Retry: "Retry", Connecting: "Connecting", Reconnecting: "Reconnecting", Disconnected: "Disconnected", ConnectionHint: "Reconnect", Reconnect: "Reconnect", Locale: "en-US"}}
		share, err := m.Launch(context.Background(), "alice", req)
		if err != nil {
			t.Fatal(err)
		}
		waitUntil(t, func() bool {
			view, _, _ := m.ForForward(share.Forward.Forward.ForwardID)
			return view.State == "running"
		}, 12*time.Second)
		if os.Getenv("REDEVEN_TEST_LIFECYCLE_ORDERLY") == "1" {
			_ = m.Close()
		}
		// A real process exit releases locks and proxy connections. The surviving
		// backend must be recovered without any goroutine from this Runtime.
		os.Exit(0)
	}
	for _, orderly := range []bool{true, false} {
		t.Run(strconv.FormatBool(orderly), func(t *testing.T) {
			state := t.TempDir()
			executable, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			if legacy := os.Getenv("REDEVEN_TEST_LEGACY_RUNTIME"); legacy != "" {
				executable = legacy
			}
			child := exec.Command(executable, "-test.run=^TestInstalledLinuxRecoveryAfterRuntimeProcessExit$")
			child.Env = append(os.Environ(), "REDEVEN_TEST_LIFECYCLE_CHILD_STATE="+state)
			if orderly {
				child.Env = append(child.Env, "REDEVEN_TEST_LIFECYCLE_ORDERLY=1")
			}
			if out, err := child.CombinedOutput(); err != nil {
				t.Fatalf("runtime fixture failed: %v %s", err, out)
			}
			pidData, err := os.ReadFile(filepath.Join(state, "pid"))
			if err != nil {
				t.Fatal(err)
			}
			pid, err := strconv.Atoi(string(pidData))
			if err != nil {
				t.Fatal(err)
			}
			identity, err := nativeapps.ObserveProcess(pid)
			if err != nil {
				t.Fatal("application died with Runtime", err)
			}
			m := installedLifecycleManager(t, state)
			running, err := m.Running(context.Background(), "alice")
			if err != nil || len(running) != 1 {
				t.Fatal("failed to recover application", running, err)
			}
			target := QuitRequest{ApplicationID: running[0].ApplicationID, Instances: running[0].Instances}
			if err = m.Quit(context.Background(), "alice", target); err != nil {
				t.Fatal("closing an already windowless application should be a no-op", err)
			}
			if !identity.Alive() {
				t.Fatal("ordinary windowless close killed the background application")
			}
			defer func() {
				if identity.Alive() {
					_ = m.Terminate(context.Background(), "alice", target)
				}
			}()
			share, err := m.Launch(context.Background(), "alice", LaunchRequest{ApplicationID: target.ApplicationID, Presentation: Presentation{Starting: "Starting", Failed: "Failed", Ended: "Ended", Retry: "Retry", Connecting: "Connecting", Reconnecting: "Reconnecting", Disconnected: "Disconnected", ConnectionHint: "Reconnect", Reconnect: "Reconnect", Locale: "en-US"}})
			if err != nil {
				t.Fatal("current viewer could not attach to the retained backend", err)
			}
			if m.sessions[share.ID].viewer == nil || !identity.Alive() {
				t.Fatal("viewer attachment lost its snapshot or original application")
			}
			if err = m.Terminate(context.Background(), "bob", target); err != ErrNotFound {
				t.Fatal("foreign termination accepted", err)
			}
			if !identity.Alive() {
				t.Fatal("foreign request killed application")
			}
			if err = m.Terminate(context.Background(), "alice", QuitRequest{ApplicationID: target.ApplicationID, Instances: []string{strings.Repeat("f", 64)}}); err != ErrNotFound {
				t.Fatal("stale instance accepted", err)
			}
			if err = m.Terminate(context.Background(), "alice", target); err != nil {
				t.Fatal(err)
			}
			waitUntil(t, func() bool { return !identity.Alive() }, 8*time.Second)
			waitUntil(t, func() bool { items, e := m.Running(context.Background(), "alice"); return e == nil && len(items) == 0 }, 8*time.Second)
			t.Logf("application PID %d survived Runtime exit (orderly=%v), then explicit force quit reaped its adopted process", pid, orderly)
		})
	}
}

func TestLinuxApplicationStoreRejectsCorruptionAndConcurrentOwners(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux instance store")
	}
	state := t.TempDir()
	m := New(state, state, nil)
	if err := m.ensureApplications(context.Background()); err != nil {
		t.Fatal(err)
	}
	another := New(state, state, nil)
	if err := another.ensureApplications(context.Background()); err == nil {
		t.Fatal("concurrent manager acquired an owned application store")
	}
	_ = m.Close()
	if err := another.ensureApplications(context.Background()); err != nil {
		t.Fatal("closed manager retained its store lock", err)
	}
	_ = another.Close()
	id := strings.Repeat("b", 64)
	dir := m.applicationDir(id)
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	record := []byte(`{"version":2,"future":true}`)
	path := filepath.Join(dir, "instance.json")
	if err := os.WriteFile(path, record, 0600); err != nil {
		t.Fatal(err)
	}
	recovered := New(state, state, nil)
	defer recovered.Close()
	if err := recovered.ensureApplications(context.Background()); err == nil {
		t.Fatal("unknown record schema accepted")
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != string(record) {
		t.Fatal("recovery changed an unsupported record")
	}
}

func TestInstalledLinuxUnconfirmedStartupReleasesSharingWithoutKillingProcess(t *testing.T) {
	if runtime.GOOS != "linux" || os.Getenv("REDEVEN_TEST_HOST_APPLICATIONS") != "1" {
		t.Skip("requires explicit Linux lifetime qualification")
	}
	m := macFixture(t)
	process, err := nativeapps.ObserveProcess(os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	a := &linuxApplication{record: linuxApplicationRecord{ID: strings.Repeat("c", 64), Owner: "alice", Address: "127.0.0.1:9", Process: process, StartedAt: time.Now().Add(-41 * time.Second).UnixMilli()}}
	if err := os.MkdirAll(m.applicationDir(a.record.ID), 0700); err != nil {
		t.Fatal(err)
	}
	share, err := m.shareApplication(context.Background(), "alice", a, Presentation{}, viewerFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	m.watchApplication(a, nil)
	waitUntil(t, func() bool {
		view, _, _ := m.ForForward(share.Forward.Forward.ForwardID)
		return view.State == "failed" && view.ErrorCode == "launch_failed"
	}, 43*time.Second)
	if !process.Alive() {
		t.Fatal("unconfirmed startup killed the observed process")
	}
	if m.Password(share.ID) != "" {
		t.Fatal("failed startup retained its credential")
	}
}

func TestLinuxDetachedApplicationsCountTowardInstanceLimit(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux application admission")
	}
	m := macFixture(t)
	if err := m.ensureApplications(context.Background()); err != nil {
		t.Fatal(err)
	}
	process, err := nativeapps.ObserveProcess(os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 12; i++ {
		id := strconv.Itoa(i)
		m.applications[id] = &linuxApplication{record: linuxApplicationRecord{ID: id, Owner: "alice", Application: Application{ID: id}, Process: process}}
	}
	if _, err = m.launchLinux(context.Background(), "alice", LaunchRequest{ApplicationID: "new"}); err != ErrLimit {
		t.Fatal("detached instances did not enforce the resource limit", err)
	}
}
