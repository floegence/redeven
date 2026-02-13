package ai

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	aitools "github.com/floegence/redeven-agent/internal/ai/tools"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

func TestHandleToolCall_PlanModeBlocksMutatingTools(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "note.txt")

	r := newRun(runOptions{
		Log:    slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		FSRoot: workspace,
		Shell:  "bash",
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
		MessageID: "msg_plan_guard",
	})
	r.runMode = config.AIModePlan

	outcome, err := r.handleToolCall(context.Background(), "tool_plan_1", "terminal.exec", map[string]any{
		"command": "printf 'plan mode' > note.txt",
	})
	if err != nil {
		t.Fatalf("handleToolCall returned error: %v", err)
	}
	if outcome == nil {
		t.Fatalf("missing tool call outcome")
	}
	if outcome.Success {
		t.Fatalf("mutating tool must be blocked in plan mode")
	}
	if outcome.ToolError == nil {
		t.Fatalf("missing tool error for blocked mutating tool")
	}
	if outcome.ToolError.Code != aitools.ErrorCodePermissionDenied {
		t.Fatalf("tool error code=%q, want %q", outcome.ToolError.Code, aitools.ErrorCodePermissionDenied)
	}

	if _, statErr := os.Stat(target); !os.IsNotExist(statErr) {
		t.Fatalf("target file should not be created in plan mode, statErr=%v", statErr)
	}

	r.mu.Lock()
	_, pending := r.toolApprovals["tool_plan_1"]
	waiting := r.waitingApproval
	r.mu.Unlock()
	if pending || waiting {
		t.Fatalf("plan mode block must not enter approval flow")
	}
}

func TestHandleToolCall_ActModeAllowsMutatingToolsAfterApproval(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "note.txt")

	r := newRun(runOptions{
		Log:    slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		FSRoot: workspace,
		Shell:  "bash",
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
		MessageID: "msg_act_guard",
	})
	r.runMode = config.AIModeAct

	type result struct {
		outcome *toolCallOutcome
		err     error
	}
	done := make(chan result, 1)
	go func() {
		outcome, err := r.handleToolCall(context.Background(), "tool_act_1", "terminal.exec", map[string]any{
			"command": "printf 'act mode' > note.txt",
		})
		done <- result{outcome: outcome, err: err}
	}()

	deadline := time.Now().Add(3 * time.Second)
	ready := false
	for time.Now().Before(deadline) {
		r.mu.Lock()
		_, pending := r.toolApprovals["tool_act_1"]
		waiting := r.waitingApproval
		r.mu.Unlock()
		if pending && waiting {
			ready = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !ready {
		t.Fatalf("tool approval request was not raised in act mode")
	}

	if err := r.approveTool("tool_act_1", true); err != nil {
		t.Fatalf("approveTool: %v", err)
	}

	select {
	case res := <-done:
		if res.err != nil {
			t.Fatalf("handleToolCall returned error: %v", res.err)
		}
		if res.outcome == nil {
			t.Fatalf("missing tool call outcome")
		}
		if !res.outcome.Success {
			if res.outcome.ToolError != nil {
				t.Fatalf("tool execution failed: code=%q message=%q", res.outcome.ToolError.Code, res.outcome.ToolError.Message)
			}
			t.Fatalf("tool execution failed without tool error details")
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for tool execution result")
	}

	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read created file: %v", err)
	}
	if string(got) != "act mode" {
		t.Fatalf("file content=%q, want %q", string(got), "act mode")
	}
}

func TestHandleToolCall_PlanModeAllowsReadonlyFindPipeEgrepWithoutApproval(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "note.txt")
	if err := os.WriteFile(target, []byte("hello"), 0o644); err != nil {
		t.Fatalf("write seed file: %v", err)
	}

	r := newRun(runOptions{
		Log:    slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		FSRoot: workspace,
		Shell:  "bash",
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
		MessageID: "msg_plan_readonly_guard",
	})
	r.runMode = config.AIModePlan

	outcome, err := r.handleToolCall(context.Background(), "tool_plan_readonly_1", "terminal.exec", map[string]any{
		"command": `find . -type f | egrep "note.txt" | head -n 20`,
	})
	if err != nil {
		t.Fatalf("handleToolCall returned error: %v", err)
	}
	if outcome == nil {
		t.Fatalf("missing tool call outcome")
	}
	if !outcome.Success {
		if outcome.ToolError != nil {
			t.Fatalf("readonly command failed: code=%q message=%q", outcome.ToolError.Code, outcome.ToolError.Message)
		}
		t.Fatalf("readonly command failed without tool error details")
	}

	r.mu.Lock()
	_, pending := r.toolApprovals["tool_plan_readonly_1"]
	waiting := r.waitingApproval
	r.mu.Unlock()
	if pending || waiting {
		t.Fatalf("readonly command should not enter approval flow")
	}
}
