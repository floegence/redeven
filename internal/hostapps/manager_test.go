package hostapps

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/base64"
	"image/png"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	nativeapps "github.com/floegence/floe-native-apps"
	"github.com/floegence/redeven/internal/portforward"
	"github.com/floegence/redeven/internal/portforward/registry"
	"github.com/gorilla/websocket"
)

func TestWindowReadinessAllowsOlderXpraInfoLatency(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires Unix sockets and a shell")
	}
	dir, err := os.MkdirTemp("", "xpra-probe-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	listener, err := net.Listen("unix", filepath.Join(dir, "xpra"))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	probe := filepath.Join(dir, "probe")
	// Xpra 6.2 collects server information for about five seconds even when
	// the application's X11 window is already mapped.
	if err := os.WriteFile(probe, []byte("#!/bin/sh\nsleep 3\nprintf 'state.windows=1\\n'\n"), 0700); err != nil {
		t.Fatal(err)
	}
	if !sessionHasWindows(context.Background(), probe, dir) {
		t.Fatal("a mapped window was rejected because server information was slow")
	}
}

//go:embed desktop_test.py
var desktopTests []byte

func TestInstalledGIOCatalogAndArguments(t *testing.T) {
	if os.Getenv("REDEVEN_TEST_HOST_APPLICATIONS") != "1" {
		t.Skip("requires installed Python GIO/GTK 3 on Linux")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	python := desktopPython(ctx, os.Environ())
	if python == "" {
		t.Fatal("Python GIO/GTK 3 is unavailable")
	}
	runInstalledGIOTests(t, ctx, python, os.Environ())
}

func TestInstalledDesktopCatalogIcons(t *testing.T) {
	components := os.Getenv("REDEVEN_TEST_DESKTOP_COMPONENT_STATE")
	if runtime.GOOS != "linux" || components == "" {
		t.Skip("requires a task-owned native desktop component installation")
	}
	pkg, err := nativeapps.DesktopForPlatform(runtime.GOOS, runtime.GOARCH)
	if err != nil {
		t.Fatal(err)
	}
	manager, err := nativeapps.New(components, pkg, nil)
	if err != nil {
		t.Fatal(err)
	}
	m := New(t.TempDir(), t.TempDir(), nil)
	m.setup = manager
	defer m.Close()
	root, err := manager.DirectoryFor(pkg.Digest())
	if err != nil {
		t.Fatal(err)
	}
	tools, err := nativeapps.ResolveDesktopTools(root, runtime.GOARCH)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()
	// Use the same published interpreter and scoped environment as inventory.
	runInstalledGIOTests(t, ctx, tools.Python, tools.Environment(os.Environ()), "-k", "icon")
	if err := m.prepare(); err != nil {
		t.Fatal(err)
	}
	icon := filepath.Join(m.custom, "fixture.svg")
	if err := os.WriteFile(icon, []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#13579b"/></svg>`), 0600); err != nil {
		t.Fatal(err)
	}
	entry := "[Desktop Entry]\nType=Application\nName=Icon acceptance fixture\nExec=/bin/true\nIcon=" + icon + "\n"
	if err := os.WriteFile(filepath.Join(m.custom, "icon-fixture.desktop"), []byte(entry), 0600); err != nil {
		t.Fatal(err)
	}
	catalog, selected, err := m.catalog(ctx, "fixture", "en-US")
	if err != nil || !catalog.Availability.Ready || selected.componentDigest != pkg.Digest() {
		t.Fatalf("published component catalog unavailable: %+v %v", catalog.Availability, err)
	}
	for _, app := range catalog.Applications {
		if app.ID != "custom:icon-fixture.desktop" {
			continue
		}
		encoded, ok := strings.CutPrefix(app.Icon, "data:image/png;base64,")
		if !ok {
			t.Fatal("catalog lost the SVG fixture icon")
		}
		data, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			t.Fatal(err)
		}
		decoded, err := png.Decode(bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		r, g, b, _ := decoded.At(32, 32).RGBA()
		if decoded.Bounds().Dx() != 64 || decoded.Bounds().Dy() != 64 || r>>8 != 19 || g>>8 != 87 || b>>8 != 155 {
			t.Fatal("catalog returned incorrect icon pixels")
		}
		return
	}
	t.Fatal("catalog omitted its private desktop entry")
}

func runInstalledGIOTests(t *testing.T, ctx context.Context, python string, environment []string, arguments ...string) {
	t.Helper()
	dir := t.TempDir()
	for name, data := range map[string][]byte{"desktop.py": desktopHelper, "desktop_test.py": desktopTests} {
		if err := os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	command := exec.CommandContext(ctx, python, append([]string{"-B", filepath.Join(dir, "desktop_test.py")}, arguments...)...)
	command.Env = environment
	if out, err := command.CombinedOutput(); err != nil {
		t.Fatalf("GIO catalog checks: %v\n%s", err, out)
	}
}

func TestVersionAndApplicationEnvironment(t *testing.T) {
	for info, want := range map[string]bool{"state.windows=1\n": true, "state.windows=0\n": false, "state.windows=unknown": false, "": false} {
		if infoHasWindows(info) != want {
			t.Fatalf("incorrect window readiness: %q", info)
		}
	}
	for version, want := range map[string]bool{"xpra v6.5.3": true, "xpra v6.0": true, "xpra v5.1": false, "6": false} {
		if supportedVersion(version) != want {
			t.Fatalf("unsupported version decision for %q", version)
		}
	}
	got := applicationEnvironment([]string{"DISPLAY=:0", "XAUTHORITY=/desktop/auth", "XDG_RUNTIME_DIR=/run/user/1000", "DESKTOP_STARTUP_ID=old", "WAYLAND_DISPLAY=wayland-0", "DBUS_SESSION_BUS_ADDRESS=unix:old", "PULSE_SERVER=old", "QT_QPA_PLATFORM=wayland", "HOME=/host/user", "PATH=/usr/bin"})
	want := []string{"HOME=/host/user", "PATH=/usr/bin", "GDK_BACKEND=x11", "QT_QPA_PLATFORM=xcb"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("application inherited desktop session: %v", got)
	}
}

func TestStopRejectsAnotherOwnerAndCleansPrivateRoute(t *testing.T) {
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
	f, err := forwards.OpenOwnedForwardSession(context.Background(), "http://127.0.0.1:45312/_redeven_host_app/")
	if err != nil {
		t.Fatal(err)
	}
	s := &ownedSession{view: Session{ID: "test", State: "starting", Forward: f}, owner: "alice", password: "secret", done: make(chan struct{})}
	m.sessions[s.view.ID] = s
	if err := m.Stop(context.Background(), "bob", s.view.ID); err != ErrNotFound {
		t.Fatalf("foreign stop: %v", err)
	}
	if len(m.Sessions("bob")) != 0 {
		t.Fatal("foreign catalog contains private sessions")
	}
	m.finish(s, "launch_failed", nil)
	if s.view.State != "failed" || m.Password(s.view.ID) != "" {
		t.Fatal("failure retained credentials or running state")
	}
	if route, err := forwards.GetForward(context.Background(), f.Forward.ForwardID); err != nil || route != nil {
		t.Fatal("application route survived its process")
	}
}

func TestClientSessionsStayPrivateAndDetachIsIdempotent(t *testing.T) {
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
	forward := func(target string) *portforward.ForwardSession {
		f, err := forwards.OpenOwnedForwardSession(context.Background(), target)
		if err != nil {
			t.Fatal(err)
		}
		return f
	}
	firstForward := forward("http://127.0.0.1:45313/_redeven_host_app/")
	secondForward := forward("http://127.0.0.1:45314/_redeven_host_app/")
	first := &ownedSession{view: Session{ID: "client-a", State: "running", Forward: firstForward}, owner: "alice", clientID: "browser-a", application: &linuxApplication{}}
	second := &ownedSession{view: Session{ID: "client-b", State: "running", Forward: secondForward}, owner: "alice", clientID: "browser-b", application: &linuxApplication{}}
	first.done, second.done = make(chan struct{}), make(chan struct{})
	m.sessions[first.view.ID], m.sessions[second.view.ID] = first, second
	if got := m.SessionsForClient("alice", "browser-a"); len(got) != 1 || got[0].ID != first.view.ID {
		t.Fatalf("client A received the wrong sessions: %+v", got)
	}
	if got := m.SessionsForClient("alice", "browser-b"); len(got) != 1 || got[0].ID != second.view.ID {
		t.Fatalf("client B received the wrong sessions: %+v", got)
	}
	if err := m.Detach(context.Background(), "alice", first.view.ID); err != nil {
		t.Fatal(err)
	}
	if second.view.State != "running" {
		t.Fatalf("detaching A changed B: %+v", second.view)
	}
	if err := m.Detach(context.Background(), "alice", first.view.ID); err != nil {
		t.Fatalf("idempotent detach: %v", err)
	}
	if m.Password(first.view.ID) != "" {
		t.Fatal("detached lease retained its password")
	}
	if route, err := forwards.GetForward(context.Background(), firstForward.Forward.ForwardID); err != nil || route != nil {
		t.Fatalf("detached lease retained its route: %v %v", route, err)
	}
}

func TestDetachWithGracePreservesLeaseAcrossReload(t *testing.T) {
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
	f, err := forwards.OpenOwnedForwardSession(context.Background(), "http://127.0.0.1:45315/_redeven_host_app/")
	if err != nil {
		t.Fatal(err)
	}
	s := &ownedSession{view: Session{ID: "reload", State: "running", Forward: f}, owner: "alice", password: "secret", done: make(chan struct{}), application: &linuxApplication{}}
	m.sessions[s.view.ID] = s
	if err := m.DetachWithGrace(context.Background(), "alice", s.view.ID, 40*time.Millisecond); err != nil {
		t.Fatal(err)
	}
	// The replacement document reads state and reacquires the same password;
	// Password cancels the pending unload release.
	if got := m.Password(s.view.ID); got != "secret" {
		t.Fatalf("reload lost the active lease: %q", got)
	}
	time.Sleep(80 * time.Millisecond)
	if s.view.State != "running" || s.stopping {
		t.Fatalf("reload grace released a retained lease: %+v", s.view)
	}
	if err := m.DetachWithGrace(context.Background(), "alice", s.view.ID, 5*time.Millisecond); err != nil {
		t.Fatal(err)
	}
	select {
	case <-s.done:
	case <-time.After(time.Second):
		t.Fatal("grace release did not finish")
	}
	if s.view.State != "ended" || m.Password(s.view.ID) != "" {
		t.Fatalf("final lease release retained session state: %+v", s.view)
	}
}

func TestLateReleaseCannotDetachReplacementLease(t *testing.T) {
	m := New(t.TempDir(), t.TempDir(), nil)
	application := &linuxApplication{}
	first := &ownedSession{view: Session{ID: "old", State: "running"}, owner: "alice", clientID: "browser", application: application, done: make(chan struct{}), password: "old-password"}
	second := &ownedSession{view: Session{ID: "new", State: "running"}, owner: "alice", clientID: "browser", application: application, done: make(chan struct{}), password: "new-password"}
	m.sessions[first.view.ID], m.sessions[second.view.ID] = first, second
	if err := m.Detach(context.Background(), "alice", first.view.ID); err != nil {
		t.Fatal(err)
	}
	if err := m.Detach(context.Background(), "alice", first.view.ID); err != nil {
		t.Fatal(err)
	}
	if second.view.State != "running" || second.stopping || m.Password(second.view.ID) != "new-password" {
		t.Fatalf("late release changed replacement lease: %+v", second.view)
	}
}

func TestLaunchRejectsInvalidClientIdentity(t *testing.T) {
	m := New(t.TempDir(), t.TempDir(), nil)
	_, err := m.Launch(context.Background(), "alice", LaunchRequest{ApplicationID: "fixture", ClientID: "browser id"})
	if err != ErrInvalid {
		t.Fatalf("invalid client identity returned %v", err)
	}
}

func TestFinishedSessionPreservesFailuresBeforeAndAfterRunning(t *testing.T) {
	for _, initial := range []string{"starting", "running"} {
		t.Run(initial, func(t *testing.T) {
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
			f, err := forwards.OpenOwnedForwardSession(context.Background(), "http://127.0.0.1:45312/_redeven_host_app/")
			if err != nil {
				t.Fatal(err)
			}
			s := &ownedSession{view: Session{ID: "finished", State: initial, Forward: f}, password: "secret", done: make(chan struct{})}
			m.sessions[s.view.ID] = s
			m.finish(s, "launch_failed", nil)
			if s.view.State != "failed" || s.view.ErrorCode != "launch_failed" || m.Password(s.view.ID) != "" {
				t.Fatalf("incorrect final state or lost exit diagnostic: %+v", s.view)
			}
		})
	}
}

func TestRunningCaptureFailureRemainsVisibleForRecovery(t *testing.T) {
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
	f, err := forwards.OpenOwnedForwardSession(context.Background(), "http://127.0.0.1:45312/_redeven_host_app/")
	if err != nil {
		t.Fatal(err)
	}
	s := &ownedSession{view: Session{ID: "capture-failed", State: "running", Forward: f}, owner: "alice", password: "secret", done: make(chan struct{})}
	m.sessions[s.view.ID] = s
	m.finish(s, "capture_failed", nil)
	view, owner, found := m.ForForward(f.Forward.ForwardID)
	if !found || owner != "alice" || view.State != "failed" || view.ErrorCode != "capture_failed" || view.EndReason != "" {
		t.Fatalf("capture failure was presented as a normal application exit: %+v", view)
	}
	if m.Password(s.view.ID) != "" {
		t.Fatal("failed backend retained credentials")
	}
	if route, err := forwards.GetForward(context.Background(), f.Forward.ForwardID); err != nil || route != nil {
		t.Fatal("failed backend retained a live route")
	}
}

func TestQuotedLaunchArgumentsNeverEvaluateShellExpressions(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "executed")
	input := []string{"a'b", "two words", "$(touch " + marker + ")", ""}
	command := "printf '%s\\n' " + quoteArgv(input)
	out, err := exec.Command("sh", "-c", command).Output()
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != strings.Join(input, "\n")+"\n" {
		t.Fatalf("arguments changed: %q", out)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("argument executed as code")
	}
}

// This opt-in integration test exercises the installed Xpra/GIO stack on a
// headless Linux host. It uses its own state and stops only its own processes.
func TestInstalledXpraLaunchResumeAndStop(t *testing.T) {
	if os.Getenv("REDEVEN_TEST_HOST_APPLICATIONS") != "1" {
		t.Skip("requires installed Xpra 6, HTML5, GIO and XTerm on Linux")
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
	m := New(state, state, forwards)
	defer m.Close()
	// Qualification may use a separately prepared, task-owned component state.
	// The released SDK still verifies its catalog identity and complete tools.
	if prepared := os.Getenv("REDEVEN_TEST_DESKTOP_COMPONENT_STATE"); prepared != "" {
		pkg, err := nativeapps.DesktopForPlatform(runtime.GOOS, runtime.GOARCH)
		if err != nil {
			t.Fatal(err)
		}
		m.setup, err = nativeapps.New(prepared, pkg, nil)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = m.setup.Directory(); err != nil {
			t.Fatal("prepared component fixture is unavailable:", err)
		}
	}
	appID := os.Getenv("REDEVEN_TEST_HOST_APPLICATION_ID")
	if appID == "" {
		executable, err := exec.LookPath("xterm")
		if err != nil {
			t.Fatal(err)
		}
		if err := m.Add(context.Background(), AddRequest{Name: "Compatibility terminal", Executable: executable}); err != nil {
			t.Fatal(err)
		}
		catalog, err := m.Catalog(context.Background(), "alice", "en-US")
		if err != nil || !catalog.Availability.Ready {
			t.Fatalf("host dependencies: %+v %v", catalog.Availability, err)
		}
		for _, app := range catalog.Applications {
			if app.Custom && app.Name == "Compatibility terminal" {
				appID = app.ID
				break
			}
		}
		if appID == "" {
			t.Fatal("custom terminal absent from GIO catalog")
		}
	}
	useXpraFixture(t, m, appID)
	req := LaunchRequest{ApplicationID: appID, Locale: "en-US", Presentation: Presentation{Locale: "en-US", Starting: "Starting", Failed: "Failed", Ended: "Ended", Retry: "Retry", Connecting: "Connecting", Reconnecting: "Reconnecting", Disconnected: "Disconnected", ConnectionHint: "Reconnect to continue", Reconnect: "Reconnect"}}
	// Distribution and user Xpra configurations must not add another application
	// or a network listener to a Redeven-owned session.
	conf := filepath.Join(state, "unrelated-xpra-config")
	if err := os.MkdirAll(conf, 0700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(state, "unrelated-command")
	config := []byte("start=touch " + quoteArgv([]string{marker}) + "\nbind-tcp=0.0.0.0:23001\n")
	if err := os.WriteFile(filepath.Join(conf, "xpra.conf"), config, 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XPRA_USER_CONF_DIRS", conf)
	t.Setenv("XPRA_SYSTEM_CONF_DIRS", conf)
	first, err := m.Launch(context.Background(), "alice", req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		a := m.sessions[first.ID].application
		if a != nil && a.record.Process.Alive() {
			_ = m.Terminate(context.Background(), "alice", QuitRequest{ApplicationID: a.record.Application.ID, Instances: []string{a.record.ID}})
			waitUntil(t, func() bool { return !a.record.Process.Alive() }, 8*time.Second)
		}
	}()
	deadline := time.Now().Add(45 * time.Second)
	for time.Now().Before(deadline) {
		current := m.Sessions("alice")[0]
		if current.State == "running" {
			break
		}
		if current.State == "failed" || current.State == "ended" {
			data, _ := os.ReadFile(filepath.Join(m.state, "sessions", first.ID, "session.log"))
			t.Fatalf("launch: %s\n%s", current.ErrorCode, data)
		}
		time.Sleep(100 * time.Millisecond)
	}
	if m.Sessions("alice")[0].State != "running" {
		t.Fatal("application did not start")
	}
	assertResponsiveWindowInventory(t, m.sessions[first.ID])
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("inherited Xpra configuration started an unrelated command")
	}
	if data, err := os.ReadFile(filepath.Join(conf, "xpra.conf")); err != nil || string(data) != string(config) {
		t.Fatal("host Xpra configuration was modified")
	}
	// A browser can close during any stage of attachment, including before the
	// authenticated Xpra hello. Neither a close frame nor transport loss may
	// destroy an already running, separately owned application session.
	endpoint := "ws" + strings.TrimSuffix(strings.TrimPrefix(first.Forward.Forward.TargetURL, "http"), "/_redeven_host_app/") + "/"
	dialer := websocket.Dialer{Subprotocols: []string{"binary"}, HandshakeTimeout: 3 * time.Second}
	for _, graceful := range []bool{true, false, true} {
		connection, _, err := dialer.Dial(endpoint, nil)
		if err != nil {
			t.Fatal(err)
		}
		if graceful {
			err = connection.WriteControl(websocket.CloseMessage, nil, time.Now().Add(3*time.Second))
			if err != nil {
				connection.Close()
				t.Fatal(err)
			}
			_ = connection.SetReadDeadline(time.Now().Add(3 * time.Second))
			_, _, err = connection.ReadMessage()
			if timed, ok := err.(net.Error); ok && timed.Timeout() {
				connection.Close()
				t.Fatal("backend did not complete the viewer close handshake")
			}
		}
		connection.Close()
		assertResponsiveWindowInventory(t, m.sessions[first.ID])
		if current := m.Sessions("alice")[0]; current.State != "running" || current.ID != first.ID {
			t.Fatalf("viewer detach terminated its application session: %+v", current)
		}
	}
	second, err := m.Launch(context.Background(), "alice", req)
	if err != nil || second.ID != first.ID {
		t.Fatalf("resume created another session: %v", err)
	}
	if err := m.Stop(context.Background(), "alice", first.ID); err != nil {
		t.Fatal(err)
	}
	if m.Sessions("alice")[0].State != "ended" {
		t.Fatal("explicit stop did not finish")
	}
}

func assertResponsiveWindowInventory(t *testing.T, session *ownedSession) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	started := time.Now()
	if session.application.record.Backend == "wayland" {
		connection, state, err := nativeapps.DialDesktop(ctx, *session.application.record.Endpoint)
		if err != nil {
			t.Fatal(err)
		}
		defer connection.Close()
		// Sharing readiness does not imply that the application has mapped its
		// first window. Observe the same attachment until it reports one.
		for len(state.Windows) == 0 {
			event, err := connection.Read(ctx)
			if err != nil {
				t.Fatal("native application did not expose a window", err)
			}
			if event.State != nil {
				state = *event.State
			}
		}
	} else if !sessionHasWindows(ctx, session.tools.xpra, session.socketDir) {
		t.Fatal("running application window inventory did not respond within three seconds")
	}
	t.Logf("running application window inventory: %d ms", time.Since(started).Milliseconds())
}

// A fixture declares the published X11-only contract before the application is
// executed. This is not a product fallback or an application-name heuristic.
func useXpraFixture(t *testing.T, m *Manager, id string) {
	t.Helper()
	if !strings.HasPrefix(id, "custom:") {
		t.Fatal("requires a task-owned desktop entry")
	}
	path := filepath.Join(m.custom, strings.TrimPrefix(id, "custom:"))
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(data, []byte("\nX-Floe-Backend=xpra\n")...), 0600); err != nil {
		t.Fatal(err)
	}
}
