//go:build linux

package ai

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/session"
)

func TestX11ActionRejectsUnsafeCoordinatesAndKeys(t *testing.T) {
	if _, err := x11Action("computer.click", map[string]any{"x": float64(-1), "y": float64(2)}); err == nil {
		t.Fatal("negative coordinate accepted")
	}
	if _, err := x11Action("computer.click", map[string]any{"x": float64(2), "y": float64(900)}); err == nil {
		t.Fatal("out-of-range coordinate accepted")
	}
	if _, err := x11Action("computer.key", map[string]any{"key": "A;id"}); err == nil {
		t.Fatal("shell metacharacter accepted")
	}
	for _, args := range []map[string]any{
		{"x": float64(100), "delta_y": float64(120)},
		{"x": float64(100), "y": float64(900), "delta_y": float64(120)},
	} {
		if _, err := x11Action("computer.scroll", args); err == nil {
			t.Fatal("incomplete or out-of-bounds scroll coordinates accepted")
		}
	}
}

func TestX11ActionAcceptsTypedActions(t *testing.T) {
	for _, tc := range []struct {
		tool string
		args map[string]any
	}{
		{"computer.click", map[string]any{"x": float64(1), "y": float64(2)}}, {"computer.double_click", map[string]any{"x": float64(1), "y": float64(2)}},
		{"computer.type", map[string]any{"text": "Flower"}}, {"computer.key", map[string]any{"key": "Control+L"}},
		{"computer.scroll", map[string]any{"delta_y": float64(120)}}, {"computer.wait", map[string]any{"milliseconds": float64(1)}},
		{"computer.scroll", map[string]any{"x": float64(100), "y": float64(200), "delta_y": float64(120)}},
		{"computer.drag", map[string]any{"from_x": float64(1), "from_y": float64(2), "to_x": float64(3), "to_y": float64(4)}},
	} {
		action, err := x11Action(tc.tool, tc.args)
		if err != nil || action == nil {
			t.Fatalf("%s: err=%v", tc.tool, err)
		}
	}
	if err := x11Wait(context.Background(), 0); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(x11KeyPattern.String(), "A") {
		t.Fatal("key contract missing")
	}
}

func TestX11SetupInspectionDoesNotStartDesktop(t *testing.T) {
	e := NewXvfbTargetExecutor(t.TempDir())
	for _, path := range []*string{&e.paths.xvfb, &e.paths.windowManager, &e.paths.input, &e.paths.capture, &e.paths.auth, &e.paths.properties, &e.paths.dbus, &e.paths.atspi} {
		*path = "/bin/sh"
	}
	if err := e.CheckComputerSetup(); err != nil {
		t.Fatal(err)
	}
	if e.ready || e.display != "" || e.sessionDirectory != "" || len(e.processes) != 0 || e.atspi != nil {
		t.Fatal("inspection started a private desktop")
	}
	if _, err := os.Stat(e.directory); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("inspection created state: %v", err)
	}
	e.paths.auth = filepath.Join(t.TempDir(), "missing")
	var startup *TargetStartupError
	if err := e.CheckComputerSetup(); !errors.As(err, &startup) || startup.Reason != "xauth_missing" {
		t.Fatalf("missing dependency: %v", err)
	}
}

func TestX11SetupReportsEveryMissingComponent(t *testing.T) {
	e := NewXvfbTargetExecutor(t.TempDir())
	for _, path := range []*string{&e.paths.xvfb, &e.paths.windowManager, &e.paths.input, &e.paths.capture, &e.paths.auth, &e.paths.properties, &e.paths.dbus, &e.paths.atspi} {
		*path = "/bin/sh"
	}
	missing := t.TempDir()
	e.paths.windowManager = filepath.Join(missing, "openbox")
	e.paths.input = filepath.Join(missing, "xdotool")
	e.paths.capture = filepath.Join(missing, "import")
	registry := NewTargetRegistry()
	r := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"xvfb-main": e}, t.TempDir())
	t.Cleanup(func() { _ = r.Close() })
	env, err := r.ComputerEnvironment(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"window_manager", "x11_input", "x11_capture"}
	if !slices.Equal(env.Desktop.Missing, want) {
		t.Fatalf("missing components = %v, want %v", env.Desktop.Missing, want)
	}
	if len(e.processes) != 0 || e.sessionDirectory != "" {
		t.Fatal("inspection started a private desktop")
	}
}

func TestX11RepairPlanUsesOnlyKnownUbuntuPackagesAndDefaultPaths(t *testing.T) {
	defaults := defaultX11Paths()
	components := []ComputerComponent{{ID: "window_manager", Path: defaults.windowManager}, {ID: "x11_input", Path: defaults.input}, {ID: "x11_capture", Path: defaults.capture}}
	ubuntu := map[string]string{"ID": "ubuntu", "VERSION_ID": "26.04"}
	repair, packages, command := x11RepairPlan(components, ubuntu)
	if repair != "ubuntu_apt" || !slices.Equal(packages, []string{"openbox", "xdotool", "imagemagick-7.q16"}) || command != "sudo apt-get install --reinstall --no-install-recommends --no-remove openbox xdotool imagemagick-7.q16" {
		t.Fatalf("unexpected repair: %q %v %q", repair, packages, command)
	}
	for _, release := range []map[string]string{nil, {"ID": "debian", "VERSION_ID": "26.04"}, {"ID": "ubuntu", "VERSION_ID": "24.04"}} {
		if repair, _, command := x11RepairPlan(components, release); repair != "unsupported_platform" || command != "" {
			t.Fatalf("unsupported system received command: %q %q", repair, command)
		}
	}
	components[1].Overridden = true
	components[1].Path = "/tmp/xdotool; arbitrary command"
	if repair, _, command := x11RepairPlan(components, ubuntu); repair != "custom_path" || command != "" {
		t.Fatalf("overridden path received command: %q %q", repair, command)
	}
	components[1] = ComputerComponent{ID: "unexpected", Path: "/usr/bin/unknown"}
	if _, _, command := x11RepairPlan(components, ubuntu); command != "" {
		t.Fatal("unknown component entered command")
	}
}

func TestVerifyComputerDesktopRejectsUnauthorizedAndBusy(t *testing.T) {
	e := NewXvfbTargetExecutor(t.TempDir())
	r := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"xvfb-main": e}, t.TempDir())
	t.Cleanup(func() { _ = r.Close() })
	s := &Service{targetToolExecutor: r}
	for _, meta := range []*session.Meta{nil, {CanRead: true}, {CanRead: true, CanWrite: true}} {
		if _, err := s.VerifyComputerDesktop(t.Context(), meta); err == nil {
			t.Fatal("verification accepted insufficient permission")
		}
	}
	control := r.controlForTarget("xvfb-main")
	control.threadID = "another-task"
	result, err := s.VerifyComputerDesktop(t.Context(), &session.Meta{CanRead: true, CanWrite: true, CanExecute: true})
	if err != nil || result.State != "in_use" || len(e.processes) != 0 {
		t.Fatalf("busy verification: %+v %v", result, err)
	}
}
