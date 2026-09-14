package ai

import (
	"context"
	"errors"
	aitools "github.com/floegence/redeven/internal/ai/tools"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestNativeDesktopTargetExecutorProtocolFixture(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("JSONL shell fixture uses POSIX executable semantics")
	}
	dir := t.TempDir()
	helper := filepath.Join(dir, "helper.sh")
	content := `#!/bin/sh
while IFS= read -r line; do
  request_id=$(printf '%s' "$line" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
  target_id=$(printf '%s' "$line" | sed -n 's/.*"target_id":"\([^"]*\)".*/\1/p')
  printf '{"type":"started","request_id":"%s","target_id":"%s"}\n' "$request_id" "$target_id"
  printf '{"type":"result","request_id":"%s","target_id":"%s","payload":{"execution_location":"macos_desktop","summary":"clicked","screenshot_mime":"image/png","screenshot_base64":"iVBORw0KGgo="}}\n' "$request_id" "$target_id"
done
`
	if err := os.WriteFile(helper, []byte(content), 0o700); err != nil {
		t.Fatal(err)
	}
	executor := NewNativeDesktopTargetExecutor(helper)
	result, err := executor.ExecuteTargetTool(context.Background(), TargetToolCall{ToolCallID: "call-1", TargetID: "desktop-main", ToolName: "computer.click", Arguments: []byte(`{"x":1,"y":2}`)})
	if err != nil {
		t.Fatal(err)
	}
	if result.ActionSummary != "clicked" || len(result.Attachments) != 1 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if _, err := executor.ResolveTargetToolAttachment(context.Background(), result.Attachments[0].ResourceRef); err != nil {
		t.Fatal(err)
	}
	if err := executor.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestNativeDesktopTargetExecutorRejectsMismatchedResponse(t *testing.T) {
	dir := t.TempDir()
	helper := filepath.Join(dir, "helper.sh")
	content := `#!/bin/sh
while IFS= read -r line; do
  printf '%s\n' '{"type":"result","request_id":"wrong","target_id":"other","payload":{}}'
done
`
	if err := os.WriteFile(helper, []byte(content), 0o700); err != nil {
		t.Fatal(err)
	}
	executor := NewNativeDesktopTargetExecutor(helper)
	defer executor.Close()
	_, err := executor.ExecuteTargetTool(t.Context(), TargetToolCall{ToolCallID: "call", TargetID: "desktop-main", ToolName: "computer.screenshot"})
	if err == nil || !strings.Contains(err.Error(), "provenance") {
		t.Fatalf("mismatched response accepted: %v", err)
	}
}

func TestNativeDesktopTargetExecutorSurvivesCompletedActionContext(t *testing.T) {
	helper := filepath.Join(t.TempDir(), "helper.sh")
	if err := os.WriteFile(helper, []byte(`#!/bin/sh
while IFS= read -r line; do
  request_id=$(printf '%s' "$line" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
  target_id=$(printf '%s' "$line" | sed -n 's/.*"target_id":"\([^"]*\)".*/\1/p')
  printf '{"type":"result","request_id":"%s","target_id":"%s","payload":{"helper_pid":%s}}\n' "$request_id" "$target_id" "$$"
done
`), 0o700); err != nil {
		t.Fatal(err)
	}
	executor := NewNativeDesktopTargetExecutor(helper)
	t.Cleanup(func() { _ = executor.Close() })
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	call := TargetToolCall{TargetID: "desktop-main", ToolName: "computer.screenshot"}
	first, err := executor.ExecuteTargetTool(ctx, call)
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	// Allow the canceled tool context to propagate to any incorrectly owned child.
	time.Sleep(50 * time.Millisecond)
	second, err := executor.ExecuteTargetTool(t.Context(), call)
	if err != nil {
		t.Fatalf("next turn lost the native session: %v", err)
	}
	if first.Result.(map[string]any)["helper_pid"] != second.Result.(map[string]any)["helper_pid"] {
		t.Fatal("completed tool context restarted the session")
	}
	if err := executor.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := executor.ExecuteTargetTool(t.Context(), call); err == nil {
		t.Fatal("closed executor accepted another action")
	}
}

func TestNativeDesktopTargetExecutorRetiresInterruptedProtocol(t *testing.T) {
	helper := filepath.Join(t.TempDir(), "helper.sh")
	if err := os.WriteFile(helper, []byte(`#!/bin/sh
while IFS= read -r line; do
  request_id=$(printf '%s' "$line" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
  target_id=$(printf '%s' "$line" | sed -n 's/.*"target_id":"\([^"]*\)".*/\1/p')
  case "$line" in *computer.wait*) sleep 0.2 ;; esac
  printf '{"type":"result","request_id":"%s","target_id":"%s","payload":{}}\n' "$request_id" "$target_id"
done
`), 0o700); err != nil {
		t.Fatal(err)
	}
	executor := NewNativeDesktopTargetExecutor(helper)
	t.Cleanup(func() { _ = executor.Close() })
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Millisecond)
	defer cancel()
	_, err := executor.ExecuteTargetTool(ctx, TargetToolCall{TargetID: "desktop-main", ToolName: "computer.wait"})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("interrupted call: %v", err)
	}
	executor.Timeout = time.Second
	_, err = executor.ExecuteTargetTool(t.Context(), TargetToolCall{TargetID: "desktop-main", ToolName: "computer.screenshot"})
	if err != nil {
		t.Fatalf("fresh observation inherited interrupted protocol: %v", err)
	}
}

func TestNativeDesktopTargetExecutorPreservesSafeFailureCode(t *testing.T) {
	helper := filepath.Join(t.TempDir(), "helper.sh")
	if err := os.WriteFile(helper, []byte(`#!/bin/sh
while IFS= read -r line; do
  request_id=$(printf '%s' "$line" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
  target_id=$(printf '%s' "$line" | sed -n 's/.*"target_id":"\([^"]*\)".*/\1/p')
  printf '{"type":"error","request_id":"%s","target_id":"%s","error_code":"FRAME_UNAVAILABLE","error":"Authorization: private-fixture-secret"}\n' "$request_id" "$target_id"
done
`), 0o700); err != nil {
		t.Fatal(err)
	}
	executor := NewNativeDesktopTargetExecutor(helper)
	t.Cleanup(func() { _ = executor.Close() })
	_, err := executor.ExecuteTargetTool(t.Context(), TargetToolCall{ToolCallID: "call", TargetID: "desktop-main", ToolName: "computer.screenshot"})
	classified := aitools.ClassifyError(aitools.Invocation{ToolName: "computer.screenshot"}, err)
	if classified == nil || classified.Code != "FRAME_UNAVAILABLE" || strings.Contains(classified.Message, "private-fixture-secret") || classified.Retryable {
		t.Fatalf("unsafe or untyped failure: %+v", classified)
	}
}
