package ai

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	aitools "github.com/floegence/redeven-agent/internal/ai/tools"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

func newPolicyTestRun(t *testing.T, workspace string, mode string, policy *config.AIExecutionPolicy, messageID string) *run {
	t.Helper()
	r := newRun(runOptions{
		Log:    slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		FSRoot: workspace,
		Shell:  "bash",
		AIConfig: &config.AIConfig{
			ExecutionPolicy: policy,
		},
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
		MessageID: messageID,
	})
	r.runMode = mode
	return r
}

func waitApprovalRequested(t *testing.T, r *run, toolID string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		r.mu.Lock()
		_, pending := r.toolApprovals[toolID]
		waiting := r.waitingApproval
		r.mu.Unlock()
		if pending && waiting {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("tool approval request was not raised for %s", toolID)
}

func assertNoApprovalWait(t *testing.T, r *run, toolID string) {
	t.Helper()
	r.mu.Lock()
	_, pending := r.toolApprovals[toolID]
	waiting := r.waitingApproval
	r.mu.Unlock()
	if pending || waiting {
		t.Fatalf("unexpected approval wait state: tool_id=%s pending=%v waiting=%v", toolID, pending, waiting)
	}
}

func runToolCall(t *testing.T, r *run, toolID string, args map[string]any, approve bool, expectApproval bool) *toolCallOutcome {
	t.Helper()
	type result struct {
		outcome *toolCallOutcome
		err     error
	}

	done := make(chan result, 1)
	go func() {
		outcome, err := r.handleToolCall(context.Background(), toolID, "terminal.exec", args)
		done <- result{outcome: outcome, err: err}
	}()

	if expectApproval {
		waitApprovalRequested(t, r, toolID)
		if err := r.approveTool(toolID, approve); err != nil {
			t.Fatalf("approveTool: %v", err)
		}
	}

	select {
	case res := <-done:
		if res.err != nil {
			t.Fatalf("handleToolCall returned error: %v", res.err)
		}
		if res.outcome == nil {
			t.Fatalf("missing tool call outcome")
		}
		assertNoApprovalWait(t, r, toolID)
		return res.outcome
	case <-time.After(3 * time.Second):
		if !expectApproval {
			r.mu.Lock()
			_, pending := r.toolApprovals[toolID]
			waiting := r.waitingApproval
			r.mu.Unlock()
			if pending && waiting {
				_ = r.approveTool(toolID, true)
				t.Fatalf("unexpected approval request for %s", toolID)
			}
		}
		t.Fatalf("timed out waiting for tool result")
		return nil
	}
}

func assertPlanMutatingBlocked(t *testing.T, outcome *toolCallOutcome, target string) {
	t.Helper()
	if outcome.Success {
		t.Fatalf("mutating tool must be blocked in plan mode")
	}
	if outcome.ToolError == nil {
		t.Fatalf("missing tool error for blocked mutating tool")
	}
	if outcome.ToolError.Code != aitools.ErrorCodePermissionDenied {
		t.Fatalf("tool error code=%q, want %q", outcome.ToolError.Code, aitools.ErrorCodePermissionDenied)
	}
	if !strings.Contains(strings.ToLower(strings.TrimSpace(outcome.ToolError.Message)), "plan-mode readonly policy") {
		t.Fatalf("tool error message=%q, want contains %q", outcome.ToolError.Message, "plan-mode readonly policy")
	}
	if _, statErr := os.Stat(target); !os.IsNotExist(statErr) {
		t.Fatalf("target file should not be created, statErr=%v", statErr)
	}
}

func TestHandleToolCall_DefaultPolicy_BlocksMutatingInPlanMode(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "note.txt")

	r := newPolicyTestRun(t, workspace, config.AIModePlan, nil, "msg_plan_default")
	outcome := runToolCall(t, r, "tool_plan_default", map[string]any{
		"command": "printf 'plan default' > note.txt",
	}, true, false)
	assertPlanMutatingBlocked(t, outcome, target)
}

func TestHandleToolCall_RequireApproval_ActModeMutating(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "note.txt")

	r := newPolicyTestRun(t, workspace, config.AIModeAct, &config.AIExecutionPolicy{
		RequireUserApproval: true,
	}, "msg_act_approval")
	outcome := runToolCall(t, r, "tool_act_approval", map[string]any{
		"command": "printf 'act approval' > note.txt",
	}, true, true)

	if !outcome.Success {
		t.Fatalf("tool should succeed, err=%+v", outcome.ToolError)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read created file: %v", err)
	}
	if string(got) != "act approval" {
		t.Fatalf("file content=%q, want %q", string(got), "act approval")
	}
}

func TestHandleToolCall_PlanModeBlocksMutatingEvenWhenApprovalEnabled(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "note.txt")

	r := newPolicyTestRun(t, workspace, config.AIModePlan, &config.AIExecutionPolicy{
		RequireUserApproval: true,
	}, "msg_plan_approval")
	outcome := runToolCall(t, r, "tool_plan_approval", map[string]any{
		"command": "printf 'plan approval' > note.txt",
	}, true, false)
	assertPlanMutatingBlocked(t, outcome, target)
}

func TestHandleToolCall_DefaultPolicy_AllowsDangerousCommandPattern(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	r := newPolicyTestRun(t, workspace, config.AIModeAct, nil, "msg_dangerous_default")

	outcome := runToolCall(t, r, "tool_dangerous_default", map[string]any{
		"command": "true || rm -rf /",
	}, true, false)
	if !outcome.Success {
		t.Fatalf("dangerous command pattern should run when block policy is disabled, err=%+v", outcome.ToolError)
	}
}

func TestHandleToolCall_BlockDangerousCommands_BlocksDangerousCommandPattern(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	r := newPolicyTestRun(t, workspace, config.AIModeAct, &config.AIExecutionPolicy{
		BlockDangerousCommands: true,
	}, "msg_dangerous_blocked")

	outcome := runToolCall(t, r, "tool_dangerous_blocked", map[string]any{
		"command": "true || rm -rf /",
	}, true, false)
	if outcome.Success {
		t.Fatalf("dangerous command pattern must be blocked when policy is enabled")
	}
	if outcome.ToolError == nil {
		t.Fatalf("missing tool error for blocked dangerous command")
	}
	if outcome.ToolError.Code != aitools.ErrorCodePermissionDenied {
		t.Fatalf("tool error code=%q, want %q", outcome.ToolError.Code, aitools.ErrorCodePermissionDenied)
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
