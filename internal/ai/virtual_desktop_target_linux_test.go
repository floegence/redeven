//go:build linux

package ai

import (
	"context"
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
}

func TestX11ActionAcceptsTypedActions(t *testing.T) {
	for _, tc := range []struct {
		tool string
		args map[string]any
	}{
		{"computer.click", map[string]any{"x": float64(1), "y": float64(2)}}, {"computer.double_click", map[string]any{"x": float64(1), "y": float64(2)}},
		{"computer.type", map[string]any{"text": "Flower"}}, {"computer.key", map[string]any{"key": "Control+L"}},
		{"computer.scroll", map[string]any{"delta_y": float64(120)}}, {"computer.wait", map[string]any{"milliseconds": float64(1)}},
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
