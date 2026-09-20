package hostapps

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/portforward"
	"github.com/floegence/redeven/internal/portforward/registry"
)

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
	got := applicationEnvironment([]string{"DISPLAY=:0", "WAYLAND_DISPLAY=wayland-0", "DBUS_SESSION_BUS_ADDRESS=unix:old", "PULSE_SERVER=old", "QT_QPA_PLATFORM=wayland", "HOME=/host/user", "PATH=/usr/bin"})
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
	m.finish(s, "launch_failed")
	if s.view.State != "failed" || m.Password(s.view.ID) != "" {
		t.Fatal("failure retained credentials or running state")
	}
	if route, err := forwards.GetForward(context.Background(), f.Forward.ForwardID); err != nil || route != nil {
		t.Fatal("application route survived its process")
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
	appID := os.Getenv("REDEVEN_TEST_HOST_APPLICATION_ID")
	if appID == "" {
		appID = "debian-xterm.desktop"
	}
	req := LaunchRequest{ApplicationID: appID, Locale: "en-US", Presentation: Presentation{Locale: "en-US", Starting: "Starting", Failed: "Failed", Ended: "Ended", Retry: "Retry", Connecting: "Connecting", Reconnecting: "Reconnecting", Disconnected: "Disconnected", ConnectionHint: "Reconnect to continue", Reconnect: "Reconnect"}}
	first, err := m.Launch(context.Background(), "alice", req)
	if err != nil {
		t.Fatal(err)
	}
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
	if !sessionHasWindows(m.sessions[first.ID].socketDir) {
		t.Fatal("running session has no application windows")
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
