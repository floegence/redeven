package ai

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestExecuteLocalToolFreezesPermissionSnapshot(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	if err := os.WriteFile(filepath.Join(workspace, "note.txt"), []byte("hello\n"), 0o644); err != nil {
		t.Fatalf("write note: %v", err)
	}
	meta := &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}
	localCall := func(permissionType string, toolName string, args map[string]any) (LocalToolExecutionResult, error) {
		t.Helper()
		raw, err := json.Marshal(args)
		if err != nil {
			t.Fatalf("marshal args: %v", err)
		}
		return ExecuteLocalTool(context.Background(), LocalToolExecutionOptions{
			AgentHomeDir: workspace,
			WorkingDir:   workspace,
			Shell:        "bash",
			AIConfig:     &config.AIConfig{PermissionType: permissionType},
			SessionMeta:  meta,
			ToolCallID:   "tool_" + strings.ReplaceAll(toolName, ".", "_"),
			ToolName:     toolName,
			Arguments:    raw,
		})
	}

	if _, err := localCall(config.AIPermissionApprovalRequired, "file.read", map[string]any{"file_path": "note.txt"}); err == nil || !strings.Contains(err.Error(), "permission snapshot") {
		t.Fatalf("approval_required file.read error=%v, want snapshot denial", err)
	}
	if _, err := localCall(config.AIPermissionFullAccess, "file.read", map[string]any{"file_path": "note.txt"}); err == nil || !strings.Contains(err.Error(), "permission snapshot") {
		t.Fatalf("full_access file.read error=%v, want snapshot denial", err)
	}
	readonlyRead, err := localCall(config.AIPermissionReadonly, "read_file", map[string]any{"path": "note.txt"})
	if err != nil {
		t.Fatalf("readonly read_file: %v", err)
	}
	if readonlyRead.Result == nil {
		t.Fatalf("readonly read_file returned empty result")
	}

	if _, err := localCall(config.AIPermissionApprovalRequired, "file.write", map[string]any{"file_path": "blocked.txt", "content": "blocked"}); err == nil || !strings.Contains(err.Error(), "approval required") {
		t.Fatalf("approval_required file.write error=%v, want approval denial", err)
	}
	if _, err := os.Stat(filepath.Join(workspace, "blocked.txt")); !os.IsNotExist(err) {
		t.Fatalf("approval_required local write should not create file, statErr=%v", err)
	}
	if _, err := localCall(config.AIPermissionFullAccess, "file.write", map[string]any{"file_path": "allowed.txt", "content": "allowed"}); err != nil {
		t.Fatalf("full_access file.write: %v", err)
	}
	if got, err := os.ReadFile(filepath.Join(workspace, "allowed.txt")); err != nil || string(got) != "allowed" {
		t.Fatalf("full_access write content=%q err=%v", string(got), err)
	}
}
