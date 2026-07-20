package ai

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/session"
)

func assertFlowerApprovalReceiptCursor(t *testing.T, svc *Service, endpointID string, threadID string, actionID string, resp *SubmitFlowerApprovalResponse) {
	t.Helper()
	if resp == nil || !resp.OK || resp.CurrentCursor <= 0 {
		t.Fatalf("approval receipt=%#v, want positive resolved cursor", resp)
	}
	svc.mu.Lock()
	defer svc.mu.Unlock()
	stream := svc.flowerLiveByThread[runThreadKey(endpointID, threadID)]
	if stream == nil {
		t.Fatalf("missing Flower live stream for approval receipt")
	}
	for _, event := range stream.Events {
		if event.Seq != resp.CurrentCursor {
			continue
		}
		if event.Kind != FlowerLiveApprovalResolved {
			t.Fatalf("receipt cursor event kind=%q, want %q", event.Kind, FlowerLiveApprovalResolved)
		}
		var payload FlowerLiveApprovalPayload
		if !decodeFlowerPayload(event.Payload, &payload) || payload.Action.ActionID != actionID {
			t.Fatalf("receipt cursor payload=%s, want action %q", string(event.Payload), actionID)
		}
		return
	}
	t.Fatalf("receipt cursor %d missing from Flower live stream", resp.CurrentCursor)
}

func TestFlowerTimelineMessageFromRawExtractsJSONBlockContent(t *testing.T) {
	t.Parallel()

	msg, ok, err := flowerTimelineMessageFromRaw("thread_assistant", "turn_assistant", "run_assistant", "msg_assistant", json.RawMessage(`{
		"id":"msg_assistant",
		"turn_id":"turn_assistant",
		"role":"assistant",
		"status":"complete",
		"timestamp":123,
		"blocks":[{"type":"markdown","content":"visible answer"}]
	}`))
	if err != nil {
		t.Fatalf("flowerTimelineMessageFromRaw: %v", err)
	}
	if !ok {
		t.Fatalf("flowerTimelineMessageFromRaw ok=false, want true")
	}
	if got := strings.TrimSpace(msg.Content); got != "visible answer" {
		t.Fatalf("Content=%q, want visible answer", got)
	}
}

func TestFlowerTimelineMessageFromRawRejectsMissingOrMismatchedTurnIdentity(t *testing.T) {
	t.Parallel()

	for _, testCase := range []struct {
		name            string
		canonicalTurnID string
		raw             json.RawMessage
	}{
		{
			name:            "missing",
			canonicalTurnID: "turn_assistant",
			raw:             json.RawMessage(`{"id":"msg_assistant","role":"assistant","status":"complete","blocks":[{"type":"markdown","content":"done"}]}`),
		},
		{
			name:            "mismatched",
			canonicalTurnID: "turn_assistant",
			raw:             json.RawMessage(`{"id":"msg_assistant","turn_id":"turn_other","role":"assistant","status":"complete","blocks":[{"type":"markdown","content":"done"}]}`),
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			_, ok, err := flowerTimelineMessageFromRaw("thread_assistant", testCase.canonicalTurnID, "run_assistant", "msg_assistant", testCase.raw)
			if err == nil || !strings.Contains(err.Error(), "invalid turn identity") {
				t.Fatalf("flowerTimelineMessageFromRaw error=%v, want invalid turn identity", err)
			}
			if ok {
				t.Fatal("invalid canonical projection reported renderable message")
			}
		})
	}
}

func TestFlowerTimelineMessageFromRawRejectsInvalidMessageIdentityAndBlocks(t *testing.T) {
	t.Parallel()

	for _, testCase := range []struct {
		name      string
		messageID string
		raw       json.RawMessage
		wantError string
	}{
		{
			name:      "missing raw message id",
			messageID: "msg_assistant",
			raw:       json.RawMessage(`{"turn_id":"turn_assistant","role":"assistant","status":"complete","timestamp":123,"blocks":[]}`),
			wantError: "missing message identity",
		},
		{
			name:      "raw message id differs from row",
			messageID: "msg_assistant",
			raw:       json.RawMessage(`{"id":"msg_other","turn_id":"turn_assistant","role":"assistant","status":"complete","timestamp":123,"blocks":[]}`),
			wantError: "differs from its row",
		},
		{
			name:      "malformed block",
			messageID: "msg_assistant",
			raw:       json.RawMessage(`{"id":"msg_assistant","turn_id":"turn_assistant","role":"assistant","status":"complete","timestamp":123,"blocks":[42]}`),
			wantError: "block 0 is not an object",
		},
		{
			name:      "null block",
			messageID: "msg_assistant",
			raw:       json.RawMessage(`{"id":"msg_assistant","turn_id":"turn_assistant","role":"assistant","status":"complete","timestamp":123,"blocks":[null]}`),
			wantError: "block 0 is null",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			_, ok, err := flowerTimelineMessageFromRaw(
				"thread_assistant",
				"turn_assistant",
				"run_assistant",
				testCase.messageID,
				testCase.raw,
			)
			if err == nil || !strings.Contains(err.Error(), testCase.wantError) {
				t.Fatalf("flowerTimelineMessageFromRaw error=%v, want %q", err, testCase.wantError)
			}
			if ok {
				t.Fatal("invalid canonical projection reported renderable message")
			}
		})
	}
}

func TestFlowerTimelineMessageFromRawRejectsMissingRoleStatusAndTimestamp(t *testing.T) {
	t.Parallel()

	for _, testCase := range []struct {
		name      string
		raw       json.RawMessage
		wantError string
	}{
		{
			name:      "missing role",
			raw:       json.RawMessage(`{"id":"msg_assistant","turn_id":"turn_assistant","status":"complete","timestamp":123,"blocks":[]}`),
			wantError: "invalid role",
		},
		{
			name:      "unknown status",
			raw:       json.RawMessage(`{"id":"msg_assistant","turn_id":"turn_assistant","role":"assistant","status":"unknown","timestamp":123,"blocks":[]}`),
			wantError: "invalid status",
		},
		{
			name:      "missing timestamp",
			raw:       json.RawMessage(`{"id":"msg_assistant","turn_id":"turn_assistant","role":"assistant","status":"complete","blocks":[]}`),
			wantError: "invalid timestamp",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			_, ok, err := flowerTimelineMessageFromRaw(
				"thread_assistant", "turn_assistant", "run_assistant", "msg_assistant", testCase.raw,
			)
			if err == nil || !strings.Contains(err.Error(), testCase.wantError) {
				t.Fatalf("flowerTimelineMessageFromRaw error=%v, want %q", err, testCase.wantError)
			}
			if ok {
				t.Fatal("invalid canonical projection reported renderable message")
			}
		})
	}
}

func TestFlowerLiveMessageEventsRequireExactStartedDraftIdentity(t *testing.T) {
	t.Parallel()

	const (
		threadID  = "thread_distinct_identity"
		turnID    = "turn_distinct_identity"
		runID     = "run_distinct_identity"
		messageID = "msg_distinct_identity"
	)
	state := FlowerLiveMaterializedState{}
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		ThreadID: threadID,
		TurnID:   turnID,
		RunID:    runID,
		Kind:     FlowerLiveMessageBlockDelta,
		Payload: mustFlowerPayload(FlowerLiveMessageBlockDeltaPayload{
			MessageID: messageID, BlockIndex: 0, Delta: "must not synthesize",
		}),
	})
	if len(state.Messages) != 0 {
		t.Fatalf("block event synthesized a draft before message.started: %#v", state.Messages)
	}

	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		ThreadID: threadID,
		TurnID:   turnID,
		RunID:    runID,
		Kind:     FlowerLiveMessageStarted,
		Payload: mustFlowerPayload(FlowerLiveMessageStartedPayload{
			MessageID: messageID, Role: "assistant", Status: "streaming", CreatedAtMs: 100,
		}),
	})
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		ThreadID: threadID,
		TurnID:   turnID,
		RunID:    runID,
		Kind:     FlowerLiveMessageBlockStart,
		Payload: mustFlowerPayload(FlowerLiveMessageBlockStartedPayload{
			MessageID: messageID, BlockIndex: 0, BlockType: "markdown",
		}),
	})
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		ThreadID: threadID,
		TurnID:   turnID,
		RunID:    runID,
		Kind:     FlowerLiveMessageBlockDelta,
		Payload: mustFlowerPayload(FlowerLiveMessageBlockDeltaPayload{
			MessageID: messageID, BlockIndex: 0, Delta: "before reconnect",
		}),
	})

	reconnected := cloneFlowerLiveMaterializedState(state)
	applyFlowerLiveEventToMaterializedState(&reconnected, nil, FlowerLiveEvent{
		ThreadID: threadID,
		TurnID:   turnID,
		RunID:    runID,
		Kind:     FlowerLiveMessageBlockDelta,
		Payload: mustFlowerPayload(FlowerLiveMessageBlockDeltaPayload{
			MessageID: messageID, BlockIndex: 0, Delta: " after reconnect",
		}),
	})
	draft, ok := reconnected.Messages[messageID]
	if !ok || draft.MessageID != messageID || draft.TurnID != turnID || draft.RunID != runID || draft.ThreadID != threadID {
		t.Fatalf("reconnected draft identity=%#v ok=%v", draft, ok)
	}
	if len(draft.Blocks) != 1 || draft.Blocks[0].Content != "before reconnect after reconnect" {
		t.Fatalf("reconnected draft blocks=%#v", draft.Blocks)
	}

	applyFlowerLiveEventToMaterializedState(&reconnected, nil, FlowerLiveEvent{
		ThreadID: threadID,
		TurnID:   "turn_other",
		RunID:    runID,
		Kind:     FlowerLiveMessageBlockDelta,
		Payload: mustFlowerPayload(FlowerLiveMessageBlockDeltaPayload{
			MessageID: messageID, BlockIndex: 0, Delta: " corrupt",
		}),
	})
	if got := reconnected.Messages[messageID].Blocks[0].Content; got != "before reconnect after reconnect" {
		t.Fatalf("mismatched event changed exact draft content=%q", got)
	}

	applyFlowerLiveEventToMaterializedState(&reconnected, nil, FlowerLiveEvent{
		ThreadID: threadID,
		TurnID:   turnID,
		RunID:    runID,
		Kind:     FlowerLiveMessageFailed,
		Payload:  mustFlowerPayload(FlowerLiveMessageFailedPayload{MessageID: messageID}),
	})
	if got := reconnected.Messages[messageID].Status; got != "error" {
		t.Fatalf("failed message status=%q, want error", got)
	}
}

func TestFlowerLiveMaterializedStateApprovalActionsWireSampling(t *testing.T) {
	t.Parallel()

	unsampled := FlowerLiveMaterializedState{
		ThreadPatch:   FlowerLiveThreadPatch{},
		Runs:          map[string]FlowerLiveRunState{},
		InputRequests: map[string]RequestUserInputPrompt{},
	}
	raw, err := json.Marshal(unsampled)
	if err != nil {
		t.Fatalf("marshal unsampled live state: %v", err)
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		t.Fatalf("decode unsampled live state object: %v", err)
	}
	if _, ok := object["approval_actions"]; ok {
		t.Fatalf("unsampled live state serialized approval_actions: %s", string(raw))
	}
	var decodedUnsampled FlowerLiveMaterializedState
	if err := json.Unmarshal(raw, &decodedUnsampled); err != nil {
		t.Fatalf("unmarshal unsampled live state: %v", err)
	}
	if decodedUnsampled.ApprovalActionsSeen {
		t.Fatalf("unsampled live state decoded as sampled")
	}

	sampledEmpty := FlowerLiveMaterializedState{
		ThreadPatch:         FlowerLiveThreadPatch{},
		Runs:                map[string]FlowerLiveRunState{},
		ApprovalActions:     map[string]FlowerApprovalAction{},
		ApprovalActionsSeen: true,
		InputRequests:       map[string]RequestUserInputPrompt{},
	}
	raw, err = json.Marshal(sampledEmpty)
	if err != nil {
		t.Fatalf("marshal sampled empty live state: %v", err)
	}
	object = map[string]json.RawMessage{}
	if err := json.Unmarshal(raw, &object); err != nil {
		t.Fatalf("decode sampled empty live state object: %v", err)
	}
	if got := string(object["approval_actions"]); got != "{}" {
		t.Fatalf("sampled empty approval_actions=%s, want {}", got)
	}
	var decodedSampled FlowerLiveMaterializedState
	if err := json.Unmarshal(raw, &decodedSampled); err != nil {
		t.Fatalf("unmarshal sampled empty live state: %v", err)
	}
	if !decodedSampled.ApprovalActionsSeen || decodedSampled.ApprovalActions == nil || len(decodedSampled.ApprovalActions) != 0 {
		t.Fatalf("sampled empty state decoded incorrectly: %#v", decodedSampled)
	}
}

func TestFlowerLiveThreadPatchSerializesExplicitEmptySubagents(t *testing.T) {
	t.Parallel()

	raw, err := json.Marshal(FlowerLiveThreadPatch{
		ThreadID:     "thread-parent",
		SubagentsSet: true,
	})
	if err != nil {
		t.Fatalf("marshal thread patch: %v", err)
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		t.Fatalf("decode thread patch object: %v", err)
	}
	if got := string(object["subagents"]); got != "[]" {
		t.Fatalf("subagents=%s, want [] in %s", got, string(raw))
	}
	var decoded FlowerLiveThreadPatch
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal thread patch: %v", err)
	}
	if !decoded.SubagentsSet || len(decoded.Subagents) != 0 {
		t.Fatalf("decoded subagents set=%v len=%d, want explicit empty", decoded.SubagentsSet, len(decoded.Subagents))
	}
}

func TestFlowerLiveProjectionKeepsResolvedDelegatedAuditActions(t *testing.T) {
	delegated := FlowerApprovalAction{
		ActionID:     "dappr_delivered",
		Origin:       FlowerApprovalOriginDelegatedSubagent,
		ToolName:     "terminal.exec",
		State:        FlowerApprovalStateApproved,
		Status:       FlowerApprovalStatusResolved,
		Version:      2,
		SurfaceEpoch: 1,
		CanApprove:   false,
		DelegatedRef: &DelegatedApprovalRef{
			ParentThreadID:  "thread_parent",
			ParentRunID:     "run_parent",
			ChildThreadID:   "thread_child",
			ChildRunID:      "run_child",
			ChildToolCallID: "tool_child",
			ApprovalID:      "approval_child",
		},
		DeliveryState: FlowerApprovalDeliveryDelivered,
		Summary:       FlowerApprovalSummary{Label: "Shell"},
	}
	main := FlowerApprovalAction{
		ActionID:     "appr_main",
		Origin:       FlowerApprovalOriginMainTool,
		RunID:        "run_main",
		ToolID:       "tool_main",
		ToolName:     "terminal.exec",
		State:        FlowerApprovalStateApproved,
		Status:       FlowerApprovalStatusResolved,
		Version:      2,
		SurfaceEpoch: 1,
		CanApprove:   false,
		Summary:      FlowerApprovalSummary{Label: "Shell"},
	}
	state := FlowerLiveMaterializedState{
		Runs:            map[string]FlowerLiveRunState{},
		Messages:        map[string]FlowerLiveMessageDraft{},
		ApprovalActions: map[string]FlowerApprovalAction{delegated.ActionID: delegated, main.ActionID: main},
		InputRequests:   map[string]RequestUserInputPrompt{},
	}
	approvals := map[string]FlowerApprovalState{}
	applyFlowerLiveEventToMaterializedState(&state, approvals, FlowerLiveEvent{
		Kind:    FlowerLiveApprovalResolved,
		Payload: mustFlowerPayload(FlowerLiveApprovalPayload{Action: delegated}),
	})
	applyFlowerLiveEventToMaterializedState(&state, approvals, FlowerLiveEvent{
		Kind:    FlowerLiveApprovalResolved,
		Payload: mustFlowerPayload(FlowerLiveApprovalPayload{Action: main}),
	})

	if got, ok := state.ApprovalActions[delegated.ActionID]; !ok || got.Status != FlowerApprovalStatusResolved || got.DeliveryState != FlowerApprovalDeliveryDelivered || got.CanApprove {
		t.Fatalf("delegated resolved audit action=%#v, want retained resolved non-actionable", got)
	}
	if _, ok := state.ApprovalActions[main.ActionID]; ok {
		t.Fatalf("main resolved approval should be removed from live pending/audit actions: %#v", state.ApprovalActions[main.ActionID])
	}
}

func TestFlowerLiveProjectionKeepsSinglePrimaryDelegatedApprovalSurface(t *testing.T) {
	first := FlowerApprovalAction{
		ActionID:      "dappr_first",
		Origin:        FlowerApprovalOriginDelegatedSubagent,
		ToolName:      "terminal.exec",
		State:         FlowerApprovalStateRequested,
		Status:        FlowerApprovalStatusPending,
		Version:       1,
		SurfaceEpoch:  1,
		RequestedAtMs: 100,
		CanApprove:    true,
		DelegatedRef: &DelegatedApprovalRef{
			ParentThreadID:  "thread_parent",
			ParentRunID:     "run_parent",
			ChildThreadID:   "thread_child_first",
			ChildRunID:      "run_child_first",
			ChildToolCallID: "tool_child_first",
			ApprovalID:      "approval_child_first",
		},
		DeliveryState:       FlowerApprovalDeliveryWaiting,
		ChildExecutionState: FlowerApprovalChildExecutionPending,
		Summary:             FlowerApprovalSummary{Label: "Shell"},
	}
	second := first
	second.ActionID = "dappr_second"
	second.RequestedAtMs = 200
	second.DelegatedRef = &DelegatedApprovalRef{
		ParentThreadID:  "thread_parent",
		ParentRunID:     "run_parent",
		ChildThreadID:   "thread_child_second",
		ChildRunID:      "run_child_second",
		ChildToolCallID: "tool_child_second",
		ApprovalID:      "approval_child_second",
	}
	state := FlowerLiveMaterializedState{
		Runs:            map[string]FlowerLiveRunState{},
		Messages:        map[string]FlowerLiveMessageDraft{},
		ApprovalActions: map[string]FlowerApprovalAction{},
		InputRequests:   map[string]RequestUserInputPrompt{},
	}
	approvals := map[string]FlowerApprovalState{}
	applyFlowerLiveEventToMaterializedState(&state, approvals, FlowerLiveEvent{
		Seq:     10,
		Kind:    FlowerLiveApprovalRequested,
		Payload: mustFlowerPayload(FlowerLiveApprovalPayload{Action: second}),
	})
	applyFlowerLiveEventToMaterializedState(&state, approvals, FlowerLiveEvent{
		Seq:     11,
		Kind:    FlowerLiveApprovalRequested,
		Payload: mustFlowerPayload(FlowerLiveApprovalPayload{Action: first}),
	})
	if got := state.ApprovalActions[second.ActionID]; got.SurfaceRole != FlowerApprovalSurfacePrimaryAction || got.PrimaryWaitAnchor != "thread:thread_parent" {
		t.Fatalf("first registered surface=%q anchor=%q, want primary thread anchor", got.SurfaceRole, got.PrimaryWaitAnchor)
	}
	if got := state.ApprovalActions[first.ActionID]; got.SurfaceRole != FlowerApprovalSurfaceLocator || got.PrimaryWaitAnchor != "thread:thread_parent" || got.CanApprove {
		t.Fatalf("later registered action=%#v, want read-only locator", got)
	}

	second.State = FlowerApprovalStateRejected
	second.Status = FlowerApprovalStatusResolved
	second.CanApprove = false
	second.DeliveryState = FlowerApprovalDeliveryDelivered
	applyFlowerLiveEventToMaterializedState(&state, approvals, FlowerLiveEvent{
		Seq:     12,
		Kind:    FlowerLiveApprovalResolved,
		Payload: mustFlowerPayload(FlowerLiveApprovalPayload{Action: second}),
	})
	if got := state.ApprovalActions[first.ActionID]; got.SurfaceRole != FlowerApprovalSurfacePrimaryAction || !got.CanApprove {
		t.Fatalf("next action after first registered resolved=%#v, want promoted primary", got)
	}
}

func TestFlowerApprovalQueueSerializesDecisionsWithoutSerializingHandlers(t *testing.T) {
	t.Parallel()
	meta := &session.Meta{EndpointID: "env_queue", UserPublicID: "user_queue", CanRead: true, CanWrite: true, CanExecute: true}
	svc := &Service{
		flowerLiveByThread: map[string]*flowerLiveThreadStream{},
		runs:               map[string]*run{},
	}
	r := newRun(runOptions{HostCapabilities: bindTestRunHostCapabilities(t, svc, meta.EndpointID, "thread_queue"), RunID: "run_queue", EndpointID: meta.EndpointID, ThreadID: "thread_queue", UserPublicID: meta.UserPublicID, MessageID: "msg_queue"})
	svc.runs[r.id] = r
	firstDecision := make(chan bool, 1)
	secondDecision := make(chan bool, 1)
	r.toolApprovals["tool_first"] = &toolApprovalRequest{decision: firstDecision, promoted: make(chan struct{}), toolName: "task_complete", requestedAtMs: 1}
	r.toolApprovals["tool_second"] = &toolApprovalRequest{decision: secondDecision, promoted: make(chan struct{}), toolName: "task_complete", requestedAtMs: 2}
	for _, toolID := range []string{"tool_first", "tool_second"} {
		action := r.controlConfirmationApprovalActionLocked(toolID, r.toolApprovals[toolID])
		svc.appendFlowerLiveEvent(FlowerLiveEvent{EndpointID: meta.EndpointID, ThreadID: r.threadID, RunID: r.id, TurnID: r.turnID, Kind: FlowerLiveApprovalRequested, Payload: mustFlowerPayload(FlowerLiveApprovalPayload{Action: action})})
	}

	current := func(actionID string) (FlowerApprovalAction, FlowerApprovalQueue) {
		svc.mu.Lock()
		defer svc.mu.Unlock()
		stream := svc.flowerLiveByThread[runThreadKey(meta.EndpointID, r.threadID)]
		return stream.State.ApprovalActions[actionID], *stream.State.ApprovalQueue
	}
	firstID := flowerApprovalActionID(r.id, "tool_first")
	secondID := flowerApprovalActionID(r.id, "tool_second")
	first, queue := current(firstID)
	if queue.CurrentActionID != firstID || queue.UnresolvedCount != 2 || !first.CanApprove || first.ExpiresAtMs <= 0 {
		t.Fatalf("initial queue=%#v first=%#v", queue, first)
	}
	second, _ := current(secondID)
	if second.CanApprove || second.SurfaceRole != FlowerApprovalSurfaceLocator || second.ExpiresAtMs != 0 {
		t.Fatalf("queued second action=%#v", second)
	}
	for name, mutate := range map[string]func(*SubmitFlowerApprovalRequest){
		"stale_generation": func(req *SubmitFlowerApprovalRequest) { req.QueueGeneration++ },
		"stale_revision":   func(req *SubmitFlowerApprovalRequest) { req.QueueRevision++ },
		"stale_version":    func(req *SubmitFlowerApprovalRequest) { req.Version++ },
		"stale_epoch":      func(req *SubmitFlowerApprovalRequest) { req.SurfaceEpoch++ },
	} {
		req := SubmitFlowerApprovalRequest{
			ThreadID: r.threadID, Origin: FlowerApprovalOriginControlConfirm, RunID: r.id, ActionID: firstID, ToolID: "tool_first",
			Approved: true, ExpectedSeq: first.ExpectedSeq, Revision: first.Revision, Version: first.Version, SurfaceEpoch: first.SurfaceEpoch,
			QueueGeneration: queue.Generation, QueueRevision: queue.Revision,
		}
		mutate(&req)
		if _, err := svc.SubmitFlowerApproval(meta, req); !errors.Is(err, ErrApprovalConflict) {
			t.Fatalf("%s submit error=%v, want ErrApprovalConflict", name, err)
		}
		select {
		case decision := <-firstDecision:
			t.Fatalf("%s released handler with decision=%v", name, decision)
		default:
		}
	}
	if _, err := svc.SubmitFlowerApproval(meta, SubmitFlowerApprovalRequest{
		ThreadID: r.threadID, Origin: FlowerApprovalOriginControlConfirm, RunID: r.id, ActionID: secondID, ToolID: "tool_second",
		Approved: true, ExpectedSeq: second.ExpectedSeq, Revision: second.Revision, Version: second.Version, SurfaceEpoch: second.SurfaceEpoch,
		QueueGeneration: queue.Generation, QueueRevision: queue.Revision,
	}); !errors.Is(err, ErrApprovalConflict) {
		t.Fatalf("non-head submit error=%v, want ErrApprovalConflict", err)
	}
	firstReceipt, err := svc.SubmitFlowerApproval(meta, SubmitFlowerApprovalRequest{
		ThreadID: r.threadID, Origin: FlowerApprovalOriginControlConfirm, RunID: r.id, ActionID: firstID, ToolID: "tool_first",
		Approved: true, ExpectedSeq: first.ExpectedSeq, Revision: first.Revision, Version: first.Version, SurfaceEpoch: first.SurfaceEpoch,
		QueueGeneration: queue.Generation, QueueRevision: queue.Revision,
	})
	if err != nil {
		t.Fatalf("approve head: %v", err)
	}
	assertFlowerApprovalReceiptCursor(t, svc, meta.EndpointID, r.threadID, firstID, firstReceipt)
	select {
	case approved := <-firstDecision:
		if !approved {
			t.Fatal("first decision was rejected")
		}
	default:
		t.Fatal("first waiter was not released immediately")
	}
	select {
	case <-secondDecision:
		t.Fatal("second waiter released before its decision")
	default:
	}
	second, queue = current(secondID)
	if queue.CurrentActionID != secondID || queue.UnresolvedCount != 1 || !second.CanApprove || second.ExpiresAtMs <= 0 {
		t.Fatalf("promoted queue=%#v second=%#v", queue, second)
	}
	if _, err := svc.SubmitFlowerApproval(meta, SubmitFlowerApprovalRequest{
		ThreadID: r.threadID, Origin: FlowerApprovalOriginControlConfirm, RunID: r.id, ActionID: secondID, ToolID: "tool_second",
		Approved: false, ExpectedSeq: second.ExpectedSeq, Revision: second.Revision, Version: second.Version, SurfaceEpoch: second.SurfaceEpoch,
		QueueGeneration: queue.Generation, QueueRevision: queue.Revision,
	}); err != nil {
		t.Fatalf("reject promoted head: %v", err)
	}
	if approved := <-secondDecision; approved {
		t.Fatal("second decision was approved")
	}
	_, queue = current(secondID)
	if queue.UnresolvedCount != 0 || queue.CurrentActionID != "" {
		t.Fatalf("settled queue=%#v", queue)
	}
}

func TestFlowerApprovalQueueRejectsTimedOutCardWithoutTouchingPromotedAction(t *testing.T) {
	t.Parallel()
	meta := &session.Meta{EndpointID: "env_queue_timeout", UserPublicID: "user_queue_timeout", CanRead: true, CanWrite: true, CanExecute: true}
	svc := &Service{
		flowerLiveByThread: map[string]*flowerLiveThreadStream{},
		runs:               map[string]*run{},
	}
	r := newRun(runOptions{HostCapabilities: bindTestRunHostCapabilities(t, svc, meta.EndpointID, "thread_queue_timeout"), RunID: "run_queue_timeout", EndpointID: meta.EndpointID, ThreadID: "thread_queue_timeout", UserPublicID: meta.UserPublicID, MessageID: "msg_queue_timeout"})
	svc.runs[r.id] = r
	firstDecision := make(chan bool, 1)
	secondDecision := make(chan bool, 1)
	r.toolApprovals["tool_first"] = &toolApprovalRequest{decision: firstDecision, promoted: make(chan struct{}), toolName: "task_complete", requestedAtMs: 1}
	r.toolApprovals["tool_second"] = &toolApprovalRequest{decision: secondDecision, promoted: make(chan struct{}), toolName: "task_complete", requestedAtMs: 2}
	for _, toolID := range []string{"tool_first", "tool_second"} {
		action := r.controlConfirmationApprovalActionLocked(toolID, r.toolApprovals[toolID])
		svc.appendFlowerLiveEvent(FlowerLiveEvent{EndpointID: meta.EndpointID, ThreadID: r.threadID, RunID: r.id, TurnID: r.turnID, Kind: FlowerLiveApprovalRequested, Payload: mustFlowerPayload(FlowerLiveApprovalPayload{Action: action})})
	}

	current := func(actionID string) (FlowerApprovalAction, FlowerApprovalQueue) {
		svc.mu.Lock()
		defer svc.mu.Unlock()
		stream := svc.flowerLiveByThread[runThreadKey(meta.EndpointID, r.threadID)]
		return stream.State.ApprovalActions[actionID], *stream.State.ApprovalQueue
	}
	firstID := flowerApprovalActionID(r.id, "tool_first")
	secondID := flowerApprovalActionID(r.id, "tool_second")
	first, staleQueue := current(firstID)
	timedOut := first
	timedOut.State = FlowerApprovalStateTimedOut
	timedOut.Status = FlowerApprovalStatusResolved
	timedOut.CanApprove = false
	timedOut.ResolvedAtMs = 10
	svc.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: meta.EndpointID,
		ThreadID:   r.threadID,
		RunID:      r.id,
		TurnID:     r.turnID,
		Kind:       FlowerLiveApprovalResolved,
		Payload:    mustFlowerPayload(FlowerLiveApprovalPayload{Action: timedOut}),
	})

	secondBefore, promotedQueue := current(secondID)
	if promotedQueue.CurrentActionID != secondID || promotedQueue.UnresolvedCount != 1 || !secondBefore.CanApprove {
		t.Fatalf("promoted queue=%#v second=%#v", promotedQueue, secondBefore)
	}
	_, err := svc.SubmitFlowerApproval(meta, SubmitFlowerApprovalRequest{
		ThreadID: r.threadID, Origin: FlowerApprovalOriginControlConfirm, RunID: r.id, ActionID: firstID, ToolID: "tool_first",
		Approved: true, ExpectedSeq: first.ExpectedSeq, Revision: first.Revision, Version: first.Version, SurfaceEpoch: first.SurfaceEpoch,
		QueueGeneration: staleQueue.Generation, QueueRevision: staleQueue.Revision,
	})
	if !errors.Is(err, ErrApprovalConflict) {
		t.Fatalf("stale timed-out submit error=%v, want ErrApprovalConflict", err)
	}
	secondAfter, queueAfter := current(secondID)
	if !reflect.DeepEqual(secondAfter, secondBefore) || !reflect.DeepEqual(queueAfter, promotedQueue) {
		t.Fatalf("stale submit changed promoted action: before=%#v/%#v after=%#v/%#v", secondBefore, promotedQueue, secondAfter, queueAfter)
	}
	select {
	case decision := <-firstDecision:
		t.Fatalf("stale timed-out submit released first waiter with decision=%v", decision)
	default:
	}
	select {
	case decision := <-secondDecision:
		t.Fatalf("stale timed-out submit released promoted waiter with decision=%v", decision)
	default:
	}
}

func TestCancelThreadApprovalQueueResolvesEveryPendingActionWithoutRevisionDrift(t *testing.T) {
	t.Parallel()
	endpointID := "env_cancel_queue"
	threadID := "thread_cancel_queue"
	svc := &Service{
		flowerLiveByThread: map[string]*flowerLiveThreadStream{},
		delegatedApprovals: map[string]*delegatedApprovalHandle{},
	}
	for index, actionID := range []string{"action_first", "action_second"} {
		svc.appendFlowerLiveEvent(FlowerLiveEvent{
			EndpointID: endpointID,
			ThreadID:   threadID,
			RunID:      "run_cancel_queue",
			Kind:       FlowerLiveApprovalRequested,
			Payload: mustFlowerPayload(FlowerLiveApprovalPayload{Action: FlowerApprovalAction{
				ActionID: actionID, Origin: FlowerApprovalOriginControlConfirm, RunID: "run_cancel_queue", ToolID: actionID, ToolName: "task_complete",
				State: FlowerApprovalStateRequested, Status: FlowerApprovalStatusPending, Revision: 1, Version: 1, SurfaceEpoch: 1,
				RequestedAtMs: int64(index + 1), CanApprove: true, BatchIndex: index, BatchSize: 2,
			}}),
		})
	}
	svc.mu.Lock()
	stream := svc.flowerLiveByThread[runThreadKey(endpointID, threadID)]
	beforeRevision := stream.State.ApprovalQueue.Revision
	svc.cancelThreadApprovalQueueLocked(endpointID, threadID, "run canceled")
	queue := *stream.State.ApprovalQueue
	events := append([]FlowerLiveEvent(nil), stream.Events...)
	svc.mu.Unlock()

	if queue.CurrentActionID != "" || queue.CurrentPosition != 0 || queue.UnresolvedCount != 0 {
		t.Fatalf("canceled queue=%#v, want empty", queue)
	}
	if queue.Revision != beforeRevision+2 {
		t.Fatalf("queue revision=%d, want %d", queue.Revision, beforeRevision+2)
	}
	resolved := 0
	for _, event := range events {
		if event.Kind != FlowerLiveApprovalResolved {
			continue
		}
		resolved++
		var payload FlowerLiveApprovalPayload
		if !decodeFlowerPayload(event.Payload, &payload) || payload.Action.State != FlowerApprovalStateCanceled {
			t.Fatalf("cancel event payload=%s", event.Payload)
		}
		if payload.ApprovalQueue == nil || payload.ApprovalQueue.Revision > queue.Revision {
			t.Fatalf("cancel event queue=%#v final=%#v", payload.ApprovalQueue, queue)
		}
	}
	if resolved != 2 {
		t.Fatalf("resolved cancel events=%d, want 2", resolved)
	}
}
