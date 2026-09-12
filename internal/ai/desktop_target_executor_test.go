package ai

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
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
