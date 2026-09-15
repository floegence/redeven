//go:build linux

package ai

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// This test is intentionally opt-in: the ordinary suite must not require a
// Linux desktop image. The qualification script runs it inside a clean
// container with the six absolute X11 dependencies installed.
func TestXvfbTargetExecutorRealDisplay(t *testing.T) {
	if os.Getenv("REDEVEN_XVFB_INTEGRATION") != "1" {
		t.Skip("set REDEVEN_XVFB_INTEGRATION=1")
	}
	state := t.TempDir()
	e := NewXvfbTargetExecutor(state)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := e.EnsureTargetReady(ctx, "xvfb-main"); err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	// Exercise an actual window and verify the effect of typed input, rather
	// than treating a successful input command as proof of GUI interaction.
	resultPath := filepath.Join(state, "entered.txt")
	fixture := exec.CommandContext(ctx, "/usr/bin/xterm", "-T", "Redeven X11 Fixture", "-geometry", "60x16+40+40", "-e", "/bin/sh", "-c", `IFS= read -r value; printf '%s' "$value" > "$1"; read -r ignored`, "fixture", resultPath)
	fixture.Env = e.environment
	if err := fixture.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = fixture.Process.Kill(); _ = fixture.Wait() }()
	window, err := e.command(ctx, e.paths.input, nil, 4096, "search", "--sync", "--name", "^Redeven X11 Fixture$")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.command(ctx, e.paths.input, nil, 4096, "windowactivate", "--sync", strings.TrimSpace(string(window))); err != nil {
		t.Fatal(err)
	}
	result, err := e.ExecuteTargetTool(ctx, TargetToolCall{TargetID: "xvfb-main", ToolName: "computer.screenshot", Arguments: json.RawMessage(`{}`)})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Attachments) != 1 || len(result.frameBytes) == 0 || result.Attachments[0].MIMEType != "image/png" {
		t.Fatalf("invalid screenshot result: %+v", result)
	}
	for _, action := range []struct{ tool, args string }{
		{"computer.click", `{"x":150,"y":150}`},
		{"computer.type", `{"text":"Flower X11 complete"}`},
		{"computer.key", `{"key":"Enter"}`},
		{"computer.wait", `{"milliseconds":100}`},
	} {
		if _, err := e.ExecuteTargetTool(ctx, TargetToolCall{TargetID: "xvfb-main", ToolName: action.tool, Arguments: json.RawMessage(action.args)}); err != nil {
			t.Fatalf("%s: %v", action.tool, err)
		}
	}
	entered, err := os.ReadFile(resultPath)
	if err != nil || string(entered) != "Flower X11 complete" {
		t.Fatalf("GUI input did not reach the fixture: %q, %v", entered, err)
	}
	if err := e.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(state + "/computer/x11"); err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
}
