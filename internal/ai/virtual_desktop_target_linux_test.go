//go:build linux

package ai

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
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
