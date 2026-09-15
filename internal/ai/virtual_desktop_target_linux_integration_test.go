//go:build linux

package ai

import (
	"context"
	"encoding/json"
	"os"
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
	result, err := e.ExecuteTargetTool(ctx, TargetToolCall{TargetID: "xvfb-main", ToolName: "computer.screenshot", Arguments: json.RawMessage(`{}`)})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Attachments) != 1 || len(result.frameBytes) == 0 || result.Attachments[0].MIMEType != "image/png" {
		t.Fatalf("invalid screenshot result: %+v", result)
	}
	if _, err := e.ExecuteTargetTool(ctx, TargetToolCall{TargetID: "xvfb-main", ToolName: "computer.click", Arguments: json.RawMessage(`{"x":20,"y":20}`)}); err != nil {
		t.Fatal(err)
	}
	if err := e.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(state + "/computer/x11"); err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
}
