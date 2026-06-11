package flowerhostrpc

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/session"
)

func TestExecuteTargetToolRejectsNonTargetTools(t *testing.T) {
	t.Parallel()

	svc := NewService(Options{})
	result, err := svc.ExecuteTargetTool(context.Background(), &session.Meta{
		EndpointID: "env_a",
		CanRead:    true,
		CanWrite:   true,
		CanExecute: true,
	}, &TargetToolCall{
		ToolCallID: "call_1",
		TargetID:   "provider:https%3A%2F%2Fredeven.test:env:env_a",
		ToolName:   "web.search",
		Arguments:  json.RawMessage(`{"query":"redeven"}`),
	})
	if err != nil {
		t.Fatalf("ExecuteTargetTool() error = %v", err)
	}
	if result == nil || result.Error == nil {
		t.Fatalf("result=%#v, want tool_not_allowed error", result)
	}
	if result.Error.Code != "tool_not_allowed" {
		t.Fatalf("code=%q, want tool_not_allowed", result.Error.Code)
	}
}

func TestExecuteTargetToolRejectsUnimplementedTargetTools(t *testing.T) {
	t.Parallel()

	svc := NewService(Options{})
	for _, toolName := range []string{"git.list_workspace", "monitor.snapshot"} {
		result, err := svc.ExecuteTargetTool(context.Background(), &session.Meta{
			EndpointID: "env_a",
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
		}, &TargetToolCall{
			ToolCallID: "call_1",
			TargetID:   "provider:https%3A%2F%2Fredeven.test:env:env_a",
			ToolName:   toolName,
			Arguments:  json.RawMessage(`{}`),
		})
		if err != nil {
			t.Fatalf("%s: ExecuteTargetTool() error = %v", toolName, err)
		}
		if result == nil || result.Error == nil || result.Error.Code != "tool_not_allowed" {
			t.Fatalf("%s: result=%#v, want tool_not_allowed", toolName, result)
		}
	}
}

func TestExecuteTargetToolDerivesPermissionsFromToolName(t *testing.T) {
	t.Parallel()

	svc := NewService(Options{})
	result, err := svc.ExecuteTargetTool(context.Background(), &session.Meta{
		EndpointID: "env_a",
		CanRead:    true,
		CanWrite:   true,
		CanExecute: false,
	}, &TargetToolCall{
		ToolCallID:           "call_1",
		TargetID:             "provider:https%3A%2F%2Fredeven.test:env:env_a",
		ToolName:             "terminal.exec",
		Arguments:            json.RawMessage(`{"command":"pwd"}`),
		RequiredCapabilities: []string{"read"},
	})
	if err != nil {
		t.Fatalf("ExecuteTargetTool() error = %v", err)
	}
	if result == nil || result.Error == nil {
		t.Fatalf("result=%#v, want permission_denied error", result)
	}
	if result.Error.Code != "permission_denied" {
		t.Fatalf("code=%q, want permission_denied", result.Error.Code)
	}
}

func TestExecuteTargetToolRejectsMismatchedTargetBinding(t *testing.T) {
	t.Parallel()

	svc := NewService(Options{})
	result, err := svc.ExecuteTargetTool(context.Background(), &session.Meta{
		EndpointID: "env_b",
		CanRead:    true,
		CanWrite:   true,
		CanExecute: true,
	}, &TargetToolCall{
		ToolCallID: "call_1",
		TargetID:   "provider:https%3A%2F%2Fredeven.test:env:env_a",
		ToolName:   "file.read",
		Arguments:  json.RawMessage(`{"file_path":"README.md"}`),
	})
	if err != nil {
		t.Fatalf("ExecuteTargetTool() error = %v", err)
	}
	if result == nil || result.Error == nil {
		t.Fatalf("result=%#v, want target_mismatch error", result)
	}
	if result.Error.Code != "target_mismatch" {
		t.Fatalf("code=%q, want target_mismatch", result.Error.Code)
	}
}

func TestExecuteTargetToolRunsLocalFileReadThroughInternalAI(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "note.txt"), []byte("hello from target\n"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	scope, err := filesystemscope.NewDefaultRegistry(root)
	if err != nil {
		t.Fatalf("NewDefaultRegistry: %v", err)
	}
	svc := NewService(Options{
		StateDir:        root,
		AgentHomeDir:    root,
		WorkingDir:      root,
		FilesystemScope: scope,
	})
	result, err := svc.ExecuteTargetTool(context.Background(), &session.Meta{
		EndpointID: "env_a",
		CanRead:    true,
	}, &TargetToolCall{
		ToolCallID: "call_1",
		TargetID:   "provider:https%3A%2F%2Fredeven.test:env:env_a",
		ToolName:   "file.read",
		Arguments:  json.RawMessage(`{"file_path":"note.txt"}`),
	})
	if err != nil {
		t.Fatalf("ExecuteTargetTool() error = %v", err)
	}
	if result == nil || result.Error != nil {
		t.Fatalf("result=%#v, want success", result)
	}
	raw, err := json.Marshal(result.Result)
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}
	if !json.Valid(raw) || !containsJSONText(raw, "hello from target") {
		t.Fatalf("result=%s, want file content", string(raw))
	}
}

func TestExecuteTargetToolKeepsLocalPermissionBoundary(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	scope, err := filesystemscope.NewDefaultRegistry(root)
	if err != nil {
		t.Fatalf("NewDefaultRegistry: %v", err)
	}
	svc := NewService(Options{
		StateDir:        root,
		AgentHomeDir:    root,
		WorkingDir:      root,
		FilesystemScope: scope,
	})
	result, err := svc.ExecuteTargetTool(context.Background(), &session.Meta{
		EndpointID: "env_a",
		CanRead:    true,
		CanWrite:   false,
	}, &TargetToolCall{
		ToolCallID: "call_1",
		TargetID:   "provider:https%3A%2F%2Fredeven.test:env:env_a",
		ToolName:   "file.write",
		Arguments:  json.RawMessage(`{"file_path":"note.txt","content":"nope"}`),
	})
	if err != nil {
		t.Fatalf("ExecuteTargetTool() error = %v", err)
	}
	if result == nil || result.Error == nil || result.Error.Code != "permission_denied" {
		t.Fatalf("result=%#v, want permission_denied", result)
	}
}

func containsJSONText(raw []byte, needle string) bool {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return false
	}
	return containsJSONTextValue(value, needle)
}

func containsJSONTextValue(value any, needle string) bool {
	switch v := value.(type) {
	case string:
		return strings.Contains(v, needle)
	case map[string]any:
		for _, child := range v {
			if containsJSONTextValue(child, needle) {
				return true
			}
		}
	case []any:
		for _, child := range v {
			if containsJSONTextValue(child, needle) {
				return true
			}
		}
	}
	return false
}
