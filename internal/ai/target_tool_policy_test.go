package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"testing"

	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/session"
)

type recordingTargetToolExecutor struct {
	call TargetToolCall
}

func (e *recordingTargetToolExecutor) ExecuteTargetTool(_ context.Context, call TargetToolCall) (TargetToolResult, error) {
	e.call = call
	return TargetToolResult{
		TargetID: call.TargetID,
		Result: map[string]any{
			"target_id": call.TargetID,
			"ok":        true,
		},
	}, nil
}

func TestHandleToolCall_ExplicitTargetPolicyBlocksLocalFileToolWithoutTarget(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{
		Log:              slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir:     t.TempDir(),
		SessionMeta:      &session.Meta{CanRead: true, CanWrite: true, CanExecute: true},
		ToolTargetPolicy: ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget},
	})

	outcome, err := r.handleToolCall(context.Background(), "tool_read_1", "file.read", map[string]any{
		"path": "/tmp/example.txt",
	})
	if err != nil {
		t.Fatalf("handleToolCall returned error: %v", err)
	}
	if outcome == nil || outcome.Success {
		t.Fatalf("outcome=%#v, want target-required failure", outcome)
	}
	if outcome.ToolError == nil || outcome.ToolError.Code != aitools.ErrorCodeTargetRequired {
		t.Fatalf("tool error=%#v, want TARGET_REQUIRED", outcome.ToolError)
	}
}

func TestHandleToolCall_ExplicitTargetPolicyUsesTargetExecutor(t *testing.T) {
	t.Parallel()

	executor := &recordingTargetToolExecutor{}
	r := newRun(runOptions{
		Log:                slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir:       t.TempDir(),
		SessionMeta:        &session.Meta{CanRead: true, CanWrite: true, CanExecute: true},
		ToolTargetPolicy:   ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget},
		TargetToolExecutor: executor,
	})

	outcome, err := r.handleToolCall(context.Background(), "tool_term_1", "terminal.exec", map[string]any{
		"target_id": "cp:local:env:env_a",
		"command":   "pwd",
	})
	if err != nil {
		t.Fatalf("handleToolCall returned error: %v", err)
	}
	if outcome == nil || !outcome.Success {
		t.Fatalf("outcome=%#v, want success", outcome)
	}
	if executor.call.TargetID != "cp:local:env:env_a" {
		t.Fatalf("target_id=%q", executor.call.TargetID)
	}
	if executor.call.ToolName != "terminal.exec" {
		t.Fatalf("tool_name=%q", executor.call.ToolName)
	}
	if len(executor.call.RequiredCapabilities) != 1 || executor.call.RequiredCapabilities[0] != "execute" {
		t.Fatalf("required_capabilities=%v, want [execute]", executor.call.RequiredCapabilities)
	}
	var args map[string]any
	if err := json.Unmarshal(executor.call.Arguments, &args); err != nil {
		t.Fatalf("unmarshal args: %v", err)
	}
	if args["command"] != "pwd" {
		t.Fatalf("args.command=%v", args["command"])
	}
	if _, ok := args["target_id"]; ok {
		t.Fatalf("forwarded target tool args must not include target_id: %#v", args)
	}
}

func TestHandleToolCall_LocalRuntimePolicyKeepsExistingToolBehavior(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir: root,
		WorkingDir:   root,
		SessionMeta:  &session.Meta{CanRead: true, CanWrite: true, CanExecute: true},
	})

	outcome, err := r.handleToolCall(context.Background(), "tool_write_1", "file.write", map[string]any{
		"file_path": "note.txt",
		"content":   "ok\n",
	})
	if err != nil {
		t.Fatalf("handleToolCall returned error: %v", err)
	}
	if outcome == nil || !outcome.Success {
		t.Fatalf("outcome=%#v, want local runtime success", outcome)
	}
}

func TestExplicitTargetPolicyDoesNotClaimUnimplementedTools(t *testing.T) {
	t.Parallel()

	for _, toolName := range []string{"git.list_workspace", "monitor.snapshot"} {
		if toolRequiresTarget(toolName) {
			t.Fatalf("%s should not be target-routed until it has a local executor", toolName)
		}
		if caps := requiredTargetCapabilities(toolName); len(caps) != 0 {
			t.Fatalf("%s capabilities=%v, want none", toolName, caps)
		}
	}
}
