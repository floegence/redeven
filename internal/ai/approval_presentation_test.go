package ai

import (
	"testing"
	"time"

	flruntime "github.com/floegence/floret/runtime"
)

func TestFlowerApprovalActionFromFloretQueueUsesCommandPresentationLabel(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{RunID: "run_pending_label", ThreadID: "thread_pending_label", MessageID: "msg_pending_label"})
	requestedAt := time.Now()
	record := flruntime.ApprovalRecord{
		ApprovalID:         "approval_pending_label",
		RootThreadID:       "thread_pending_label",
		EffectAttemptID:    "effect_pending_label",
		ToolCallID:         "tool_pending_label",
		ToolName:           "terminal.exec",
		ToolKind:           "local",
		RunID:              flruntime.RunID("run_pending_label"),
		ThreadID:           flruntime.ThreadID("thread_pending_label"),
		TurnID:             flruntime.TurnID("msg_pending_label"),
		Step:               1,
		BatchIndex:         0,
		BatchSize:          1,
		State:              "requested",
		Revision:           2,
		QueueSequence:      1,
		RequestedAt:        requestedAt,
		UpdatedAt:          requestedAt,
		ArgsHash:           "args_pending_label",
		RequestFingerprint: "fingerprint_pending_label",
		Resources: []flruntime.ApprovalResource{
			{Kind: "command", Value: "curl -s https://example.test/weather"},
			{Kind: "working_directory", Value: "/repo"},
		},
		Effects: []string{"shell"},
	}
	queue := flruntime.ApprovalQueue{
		RootThreadID: "thread_pending_label", Generation: 1, Revision: 2,
		CurrentApprovalID: record.ApprovalID, Items: []flruntime.ApprovalRecord{record}, GeneratedAt: requestedAt,
	}
	action, err := r.flowerApprovalActionFromFloretRecord(record, queue)
	if err != nil {
		t.Fatalf("pending approval mapping: %v", err)
	}
	if action.Summary.Label != "curl -s https://example.test/weather" {
		t.Fatalf("summary label=%q, want command", action.Summary.Label)
	}
	if action.Summary.Command != "curl -s https://example.test/weather" || action.Summary.Cwd != "/repo" {
		t.Fatalf("summary=%#v, want command and cwd preserved", action.Summary)
	}
	if action.SurfaceRole != FlowerApprovalSurfacePrimaryAction {
		t.Fatalf("surface role=%q, want primary action", action.SurfaceRole)
	}
}

func TestFlowerApprovalActionFromFloretQueueRejectsMalformedContract(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{RunID: "run_invalid_pending", ThreadID: "thread_invalid_pending", MessageID: "turn_invalid_pending"})
	_, err := r.flowerApprovalActionFromFloretRecord(flruntime.ApprovalRecord{
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
		RequestedAt: time.Now(),
		ArgsHash:    "args_invalid_pending",
	}, flruntime.ApprovalQueue{})
	if err == nil {
		t.Fatal("malformed pending approval was accepted")
	}
}

func TestFlowerApprovalActionsRejectMalformedEmptySnapshot(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{RunID: "run_invalid_snapshot", ThreadID: "thread_invalid_snapshot", MessageID: "turn_invalid_snapshot"})
	if _, err := r.flowerApprovalActionsFromFloretQueue(flruntime.ApprovalQueue{}); err == nil {
		t.Fatal("malformed empty pending approval snapshot was accepted")
	}
}

func TestFlowerApprovalActionsFromFloretQueueUsesCanonicalSurfaceRoles(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{RunID: "run_roles", ThreadID: "thread_roles", MessageID: "turn_roles"})
	requestedAt := time.Now()
	current := flruntime.ApprovalRecord{
		ApprovalID: "approval_current", RootThreadID: "thread_roles", EffectAttemptID: "effect_current",
		ToolCallID: "tool_current", ToolName: "terminal.exec", ToolKind: "local",
		RunID: "run_roles", ThreadID: "thread_roles", TurnID: "turn_roles",
		Step: 1, BatchIndex: 0, BatchSize: 2, State: "requested", Revision: 1, QueueSequence: 1,
		RequestedAt: requestedAt, UpdatedAt: requestedAt, ArgsHash: "args_current", RequestFingerprint: "fingerprint_current",
	}
	queued := current
	queued.ApprovalID = "approval_queued"
	queued.EffectAttemptID = "effect_queued"
	queued.ToolCallID = "tool_queued"
	queued.Step = 2
	queued.BatchIndex = 1
	queued.QueueSequence = 2
	queued.ArgsHash = "args_queued"
	queued.RequestFingerprint = "fingerprint_queued"
	queue := flruntime.ApprovalQueue{
		RootThreadID: "thread_roles", Generation: 3, Revision: 2,
		CurrentApprovalID: current.ApprovalID,
		Items:             []flruntime.ApprovalRecord{current, queued},
		GeneratedAt:       requestedAt,
	}

	actions, err := r.flowerApprovalActionsFromFloretQueue(queue)
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 2 {
		t.Fatalf("actions=%d, want 2", len(actions))
	}
	if actions[0].SurfaceRole != FlowerApprovalSurfacePrimaryAction || !actions[0].CanApprove {
		t.Fatalf("current action=%#v, want actionable primary", actions[0])
	}
	if actions[1].SurfaceRole != FlowerApprovalSurfaceLocator || actions[1].CanApprove {
		t.Fatalf("queued action=%#v, want read-only locator", actions[1])
	}
}

func TestFlowerApprovalActionsFromFloretQueueReturnsExplicitEmptySlice(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{RunID: "run_empty", ThreadID: "thread_empty", MessageID: "turn_empty"})
	actions, err := r.flowerApprovalActionsFromFloretQueue(flruntime.ApprovalQueue{
		RootThreadID: "thread_empty",
		GeneratedAt:  time.Now(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if actions == nil || len(actions) != 0 {
		t.Fatalf("actions=%#v, want explicit empty slice", actions)
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

	r := newRun(runOptions{RunID: "run_parent_label", ThreadID: "thread_parent_label", MessageID: "msg_parent_label"})
	requestedAt := time.Now()
	record := flruntime.ApprovalRecord{
		ApprovalID: "approval_child_label", RootThreadID: "thread_parent_label", ParentThreadID: "thread_parent_label",
		EffectAttemptID: "effect_child_label", ToolCallID: "tool_child_label", ToolName: "terminal.exec", ToolKind: "local",
		RunID: "run_child_label", ThreadID: "thread_child_label", TurnID: "turn_child_label",
		Step: 1, BatchSize: 1, State: "requested", Revision: 1, QueueSequence: 1,
		RequestedAt: requestedAt, UpdatedAt: requestedAt, ArgsHash: "args_child_label", RequestFingerprint: "fingerprint_child_label",
		Resources: []flruntime.ApprovalResource{
			{Kind: "command", Value: "curl -s https://example.test/delegated"},
			{Kind: "working_directory", Value: "/repo"},
		},
		Effects: []string{"shell"},
	}
	queue := flruntime.ApprovalQueue{
		RootThreadID: "thread_parent_label", Generation: 1, Revision: 1,
		CurrentApprovalID: record.ApprovalID, Items: []flruntime.ApprovalRecord{record}, GeneratedAt: requestedAt,
	}
	action, err := r.flowerApprovalActionFromFloretRecord(record, queue)
	if err != nil {
		t.Fatal(err)
	}
	if action.Origin != FlowerApprovalOriginDelegatedSubagent || action.RunID != "run_child_label" || action.ToolID != "tool_child_label" || action.Scope != "thread:thread_child_label" {
		t.Fatalf("canonical delegated action identity=%#v", action)
	}
	if action.SurfaceRole != FlowerApprovalSurfacePrimaryAction {
		t.Fatalf("surface role=%q, want primary action", action.SurfaceRole)
	}
	if action.Summary.Label != "curl -s https://example.test/delegated" {
		t.Fatalf("summary label=%q, want command", action.Summary.Label)
	}
	if action.Summary.Command != "curl -s https://example.test/delegated" || action.Summary.Cwd != "/repo" {
		t.Fatalf("summary=%#v, want command and cwd preserved", action.Summary)
	}
}
