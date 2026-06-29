package ai

import (
	"testing"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
)

func TestFlowerApprovalActionFromFloretPendingUsesCommandPresentationLabel(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{RunID: "run_pending_label", MessageID: "msg_pending_label"})
	requestedAt := time.Now()
	action, ok := r.flowerApprovalActionFromFloretPending(flruntime.PendingApproval{
		ApprovalID:  "approval_pending_label",
		ToolCallID:  "tool_pending_label",
		ToolName:    "terminal.exec",
		ThreadID:    flruntime.ThreadID("thread_pending_label"),
		TurnID:      flruntime.TurnID("msg_pending_label"),
		State:       "requested",
		Revision:    2,
		RequestedAt: requestedAt,
		Resources: []flruntime.PendingApprovalResource{
			{Kind: "command", Value: "curl -s https://example.test/weather"},
			{Kind: "working_directory", Value: "/repo"},
		},
		Effects: []string{"shell"},
	})
	if !ok {
		t.Fatal("pending approval did not map to Flower action")
	}
	if action.Summary.Label != "curl -s https://example.test/weather" {
		t.Fatalf("summary label=%q, want command", action.Summary.Label)
	}
	if action.Summary.Command != "curl -s https://example.test/weather" || action.Summary.Cwd != "/repo" {
		t.Fatalf("summary=%#v, want command and cwd preserved", action.Summary)
	}
}

func TestToolApprovalDisplayLabelFallsBackWithoutCommand(t *testing.T) {
	t.Parallel()

	label := toolApprovalDisplayLabel("terminal.exec", toolApprovalPresentationArgs("terminal.exec", "", "", nil))
	if label != "terminal.exec" {
		t.Fatalf("label=%q, want terminal.exec fallback", label)
	}
}

func TestFlowerApprovalActionFromFloretPendingUsesReadableTerminalReadLabel(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{RunID: "run_pending_read_label", MessageID: "msg_pending_read_label"})
	action, ok := r.flowerApprovalActionFromFloretPending(flruntime.PendingApproval{
		ApprovalID: "approval_pending_read_label",
		ToolCallID: "tool_pending_read_label",
		ToolName:   "terminal.read",
		ThreadID:   flruntime.ThreadID("thread_pending_read_label"),
		TurnID:     flruntime.TurnID("msg_pending_read_label"),
		State:      "requested",
		Revision:   1,
		Resources: []flruntime.PendingApprovalResource{
			{Kind: "terminal_process", Value: "tp_cb3f475ce437593bb7359824"},
		},
		Effects: []string{"shell"},
	})
	if !ok {
		t.Fatal("pending terminal.read approval did not map to Flower action")
	}
	if action.Summary.Label != "Read terminal output" {
		t.Fatalf("summary label=%q, want readable terminal.read label", action.Summary.Label)
	}
	if action.Summary.Label == "tp_cb3f475ce437593bb7359824" || action.Summary.Label == "terminal.read" {
		t.Fatalf("summary label exposed internal process/tool label: %q", action.Summary.Label)
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
	action := delegatedApprovalAction(parent, child, fltools.ApprovalRequest{
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
	if action.Summary.Label != "curl -s https://example.test/delegated" {
		t.Fatalf("summary label=%q, want command", action.Summary.Label)
	}
	if action.Summary.Command != "curl -s https://example.test/delegated" || action.Summary.Cwd != "/repo" {
		t.Fatalf("summary=%#v, want command and cwd preserved", action.Summary)
	}
}
