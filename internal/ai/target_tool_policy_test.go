package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/config"
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

type provenanceOmittingTargetToolExecutor struct {
	call TargetToolCall
}

func (e *provenanceOmittingTargetToolExecutor) ExecuteTargetTool(_ context.Context, call TargetToolCall) (TargetToolResult, error) {
	e.call = call
	return TargetToolResult{
		TargetID:          call.TargetID,
		ExecutionLocation: "ssh_target",
		Result: map[string]any{
			"stdout":    "ok",
			"exit_code": 0,
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
		"target_id": "provider:https%3A%2F%2Fredeven.test:env:env_a",
		"command":   "pwd",
	})
	if err != nil {
		t.Fatalf("handleToolCall returned error: %v", err)
	}
	if outcome == nil || !outcome.Success {
		t.Fatalf("outcome=%#v, want success", outcome)
	}
	if executor.call.TargetID != "provider:https%3A%2F%2Fredeven.test:env:env_a" {
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

func TestHandleToolCall_ExplicitTargetPolicyPreservesTargetProvenance(t *testing.T) {
	t.Parallel()

	executor := &provenanceOmittingTargetToolExecutor{}
	r := newRun(runOptions{
		Log:                slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir:       t.TempDir(),
		SessionMeta:        &session.Meta{CanRead: true, CanWrite: true, CanExecute: true},
		ToolTargetPolicy:   ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget},
		TargetToolExecutor: executor,
	})

	outcome, err := r.handleToolCall(context.Background(), "tool_term_1", "terminal.exec", map[string]any{
		"target_id": "ssh:ssh%3Adevbox%3Adefault%3Akey_agent%3Aremote_default",
		"command":   "pwd",
	})
	if err != nil {
		t.Fatalf("handleToolCall returned error: %v", err)
	}
	if outcome == nil || !outcome.Success {
		t.Fatalf("outcome=%#v, want success", outcome)
	}
	result, ok := outcome.Result.(map[string]any)
	if !ok {
		t.Fatalf("result=%#v, want map", outcome.Result)
	}
	if result["target_id"] != "ssh:ssh%3Adevbox%3Adefault%3Akey_agent%3Aremote_default" ||
		result["execution_location"] != "ssh_target" {
		t.Fatalf("target provenance was not preserved: %#v", result)
	}
}

func TestHandleToolCall_ExplicitTargetPolicyRejectsUnallowedTarget(t *testing.T) {
	t.Parallel()

	executor := &recordingTargetToolExecutor{}
	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir: t.TempDir(),
		SessionMeta:  &session.Meta{CanRead: true, CanWrite: true, CanExecute: true},
		ToolTargetPolicy: ToolTargetPolicy{
			Mode:             ToolTargetModeExplicitTarget,
			DefaultTargetID:  "provider:https%3A%2F%2Fredeven.test:env:env_a",
			AllowedTargetIDs: []string{"provider:https%3A%2F%2Fredeven.test:env:env_a"},
		},
		TargetToolExecutor: executor,
	})

	outcome, err := r.handleToolCall(context.Background(), "tool_term_1", "terminal.exec", map[string]any{
		"target_id": "provider:https%3A%2F%2Fredeven.test:env:env_b",
		"command":   "pwd",
	})
	if err != nil {
		t.Fatalf("handleToolCall returned error: %v", err)
	}
	if outcome == nil || outcome.Success {
		t.Fatalf("outcome=%#v, want policy failure", outcome)
	}
	if outcome.ToolError == nil || outcome.ToolError.Code != aitools.ErrorCodePermissionDenied {
		t.Fatalf("tool error=%#v, want PERMISSION_DENIED", outcome.ToolError)
	}
	if executor.call.TargetID != "" {
		t.Fatalf("target executor should not run for unallowed target: %#v", executor.call)
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

func TestPrepareRunUsesThreadScopedTargetPolicy(t *testing.T) {
	t.Parallel()

	executor := &recordingTargetToolExecutor{}
	svc, err := NewService(Options{
		Logger:           slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:         t.TempDir(),
		AgentHomeDir:     t.TempDir(),
		Shell:            "/bin/bash",
		Config:           testTargetToolPolicyConfig(),
		PersistOpTimeout: 2 * time.Second,
		ToolTargetPolicy: ToolTargetPolicy{
			Mode: ToolTargetModeExplicitTarget,
		},
		TargetToolExecutor: executor,
		ToolTargetPolicyForRun: func(_ *session.Meta, thread threadstore.Thread, _ *threadstore.FlowerThreadMetadata) ToolTargetPolicy {
			return ToolTargetPolicy{
				Mode:            ToolTargetModeExplicitTarget,
				DefaultTargetID: "provider:https%3A%2F%2Fredeven.test:env:" + thread.ThreadID,
			}
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })

	meta := &session.Meta{
		ChannelID:  "ch_target_policy_test",
		EndpointID: "env_target_policy_test",
		CanRead:    true,
		CanWrite:   true,
		CanExecute: true,
	}
	thread, err := svc.CreateThread(context.Background(), meta, "target policy", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	prepared, err := svc.prepareRun(meta, "run_target_policy", RunStartRequest{
		ThreadID: thread.ThreadID,
		Input:    RunInput{Text: "check policy"},
		Options:  RunOptions{},
	}, nil, nil)
	if err != nil {
		t.Fatalf("prepareRun: %v", err)
	}
	if got := prepared.r.toolTargetPolicy.DefaultTargetID; got != "provider:https%3A%2F%2Fredeven.test:env:"+thread.ThreadID {
		t.Fatalf("run default target id=%q", got)
	}
}

func testTargetToolPolicyConfig() *config.AIConfig {
	return &config.AIConfig{
		CurrentModelID: "openai/gpt-5-mini",
		Providers: []config.AIProvider{{
			ID:      "openai",
			Name:    "OpenAI",
			Type:    "openai",
			BaseURL: "https://api.openai.com/v1",
			Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
		}},
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
