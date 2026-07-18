package ai

import (
	"testing"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
)

func TestFlowerApprovalActionFromFloretPendingUsesCommandPresentationLabel(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{RunID: "run_pending_label", ThreadID: "thread_pending_label", MessageID: "msg_pending_label"})
	requestedAt := time.Now()
	action, err := r.flowerApprovalActionFromFloretPending(flruntime.PendingApproval{
		ApprovalID:  "approval_pending_label",
		ToolCallID:  "tool_pending_label",
		ToolName:    "terminal.exec",
		ToolKind:    "local",
		RunID:       flruntime.RunID("run_pending_label"),
		ThreadID:    flruntime.ThreadID("thread_pending_label"),
		TurnID:      flruntime.TurnID("msg_pending_label"),
		Step:        1,
		BatchIndex:  0,
		BatchSize:   1,
		State:       "requested",
		Revision:    2,
		Epoch:       1,
		RequestedAt: requestedAt,
		ArgsHash:    "args_pending_label",
		Resources: []flruntime.PendingApprovalResource{
			{Kind: "command", Value: "curl -s https://example.test/weather"},
			{Kind: "working_directory", Value: "/repo"},
		},
		Effects: []string{"shell"},
	})
	if err != nil {
		t.Fatalf("pending approval mapping: %v", err)
	}
	if action.Summary.Label != "curl -s https://example.test/weather" {
		t.Fatalf("summary label=%q, want command", action.Summary.Label)
	}
	if action.Summary.Command != "curl -s https://example.test/weather" || action.Summary.Cwd != "/repo" {
		t.Fatalf("summary=%#v, want command and cwd preserved", action.Summary)
	}
}

func TestFlowerApprovalActionFromFloretPendingRejectsMalformedContract(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{RunID: "run_invalid_pending", ThreadID: "thread_invalid_pending", MessageID: "turn_invalid_pending"})
	_, err := r.flowerApprovalActionFromFloretPending(flruntime.PendingApproval{
		ApprovalID:  "approval_invalid_pending",
		ToolCallID:  "tool_invalid_pending",
		ToolName:    "terminal.exec",
		RunID:       "run_invalid_pending",
		ThreadID:    "thread_invalid_pending",
		TurnID:      "turn_invalid_pending",
		Step:        1,
		BatchSize:   1,
		State:       "requested",
		Revision:    1,
		Epoch:       1,
		RequestedAt: time.Now(),
		ArgsHash:    "args_invalid_pending",
	})
	if err == nil {
		t.Fatal("malformed pending approval was accepted")
	}
	if _, err := flowerApprovalResolvedStateForFloretReason("unknown"); err == nil {
		t.Fatal("unknown approval resolution reason was accepted")
	}
}

func TestToolApprovalDisplayLabelFallsBackWithoutCommand(t *testing.T) {
	t.Parallel()

	label := toolApprovalDisplayLabel("terminal.exec", toolApprovalPresentationArgs("terminal.exec", "", "", nil))
	if label != "terminal.exec" {
		t.Fatalf("label=%q, want terminal.exec fallback", label)
	}
}

func TestControlConfirmationApprovalActionUsesCommandPresentationLabel(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{RunID: "run_control_label", MessageID: "msg_control_label"})
	action := r.controlConfirmationApprovalActionLocked("tool_control_label", &toolApprovalRequest{
		toolName:      "terminal.exec",
		command:       "curl -s https://example.test/control",
		cwd:           "/repo",
		effects:       []string{"shell"},
		requestedAtMs: 1000,
	})
	if action.Summary.Label != "curl -s https://example.test/control" {
		t.Fatalf("summary label=%q, want command", action.Summary.Label)
	}
	if action.Summary.Command != "curl -s https://example.test/control" || action.Summary.Cwd != "/repo" {
		t.Fatalf("summary=%#v, want command and cwd preserved", action.Summary)
	}
}

func TestDelegatedApprovalActionUsesCommandPresentationLabel(t *testing.T) {
	t.Parallel()

	parent := newRun(runOptions{RunID: "run_parent_label", MessageID: "msg_parent_label"})
	child := newRun(runOptions{RunID: "run_child_label", MessageID: "msg_child_label"})
	action, err := delegatedApprovalAction(parent, child, fltools.ApprovalRequest{
		ID:   "tool_child_label",
		Name: "terminal.exec",
		ValidatedArgs: map[string]any{
			"command": "curl -s https://example.test/delegated",
			"cwd":     "/repo",
		},
		Effects: []fltools.Effect{fltools.EffectShell},
	}, DelegatedApprovalRef{
		ParentThreadID:  "thread_parent_label",
		ParentRunID:     "run_parent_label",
		SubagentID:      "thread_child_label",
		ChildThreadID:   "thread_child_label",
		ChildRunID:      "run_child_label",
		ChildToolCallID: "tool_child_label",
		ApprovalID:      "approval_child_label",
	}, "dappr_child_label", 1000, 0)
	if err != nil {
		t.Fatal(err)
	}
	if action.Summary.Label != "curl -s https://example.test/delegated" {
		t.Fatalf("summary label=%q, want command", action.Summary.Label)
	}
	if action.Summary.Command != "curl -s https://example.test/delegated" || action.Summary.Cwd != "/repo" {
		t.Fatalf("summary=%#v, want command and cwd preserved", action.Summary)
	}
}
