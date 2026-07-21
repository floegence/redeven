package ai

import (
	"encoding/json"
	"strings"
	"testing"
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
		if event.Kind != FlowerLiveApprovalQueueReplaced {
			t.Fatalf("receipt cursor event kind=%q, want %q", event.Kind, FlowerLiveApprovalQueueReplaced)
		}
		var payload FlowerLiveApprovalQueuePayload
		if !decodeFlowerPayload(event.Payload, &payload) {
			t.Fatalf("receipt cursor payload=%s, want canonical queue replacement", string(event.Payload))
		}
		for _, action := range payload.Actions {
			if action.ActionID == actionID {
				t.Fatalf("resolved action %q remains in canonical queue replacement", actionID)
			}
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

func TestFlowerTimelineMessageFromRawPreservesSafeCanonicalReferences(t *testing.T) {
	t.Parallel()

	msg, ok, err := flowerTimelineMessageFromRaw("thread_reference", "turn_reference", "run_reference", "entry_reference", json.RawMessage(`{
		"id":"entry_reference",
		"turn_id":"turn_reference",
		"role":"user",
		"status":"complete",
		"timestamp":123,
		"blocks":[],
		"references":[
			{"reference_id":"context:0","kind":"file","label":"main.ts"},
			{"reference_id":"context:1","kind":"text","label":"Quote","text":"visible excerpt","truncated":true}
		]
	}`))
	if err != nil {
		t.Fatalf("flowerTimelineMessageFromRaw: %v", err)
	}
	if !ok || len(msg.References) != 2 || msg.References[0].Text != "" || msg.References[1].Text != "visible excerpt" || !msg.References[1].Truncated {
		t.Fatalf("message=%#v, want reference-only canonical user message", msg)
	}
}

func TestFlowerTimelineMessageFromRawRejectsHostReferenceFields(t *testing.T) {
	t.Parallel()

	for _, field := range []string{"text", "path", "resource_ref", "target"} {
		t.Run(field, func(t *testing.T) {
			t.Parallel()
			value := `"sentinel"`
			if field == "target" {
				value = `{"target_id":"local"}`
			}
			raw := json.RawMessage(`{"id":"entry_reference","turn_id":"turn_reference","role":"user","status":"complete","timestamp":123,"blocks":[],"references":[{"reference_id":"context:0","kind":"file","label":"main.ts","` + field + `":` + value + `}]}`)
			if _, ok, err := flowerTimelineMessageFromRaw("thread_reference", "turn_reference", "run_reference", "entry_reference", raw); err == nil || ok {
				t.Fatalf("forbidden %s field was accepted: err=%v ok=%v", field, err, ok)
			}
		})
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

func TestFlowerLiveProjectionReplacesCanonicalApprovalQueueAtomically(t *testing.T) {
	t.Parallel()

	svc := &Service{flowerLiveByThread: map[string]*flowerLiveThreadStream{}}
	endpointID := "env_canonical_queue"
	threadID := "thread_canonical_queue"
	control := FlowerApprovalAction{
		ActionID: "control_action", Origin: FlowerApprovalOriginControlConfirm,
		RunID: "run_root", ToolID: "control_tool", ToolName: "task_complete",
		State: FlowerApprovalStateRequested, Status: FlowerApprovalStatusPending,
		Revision: 1, Version: 1, CanApprove: true, Summary: FlowerApprovalSummary{Label: "Complete task"},
	}
	stale := FlowerApprovalAction{
		ActionID: "stale_action", Origin: FlowerApprovalOriginMainTool,
		RunID: "run_stale", ToolID: "tool_stale", ToolName: "terminal.exec",
		State: FlowerApprovalStateRequested, Status: FlowerApprovalStatusPending,
		Revision: 1, Version: 1, CanApprove: true, Summary: FlowerApprovalSummary{Label: "stale"},
	}
	svc.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: endpointID, ThreadID: threadID, RunID: control.RunID,
		Kind:    FlowerLiveApprovalRequested,
		Payload: mustFlowerPayload(FlowerLiveApprovalPayload{Action: control}),
	})
	svc.mu.Lock()
	stream := svc.flowerLiveByThread[runThreadKey(endpointID, threadID)]
	stream.State.ApprovalActions[stale.ActionID] = stale
	svc.mu.Unlock()

	delegated := FlowerApprovalAction{
		ActionID: "child_action", Origin: FlowerApprovalOriginDelegatedSubagent,
		RunID: "run_child", TurnID: "turn_child", ToolID: "tool_child", ToolName: "terminal.exec",
		State: FlowerApprovalStateRequested, Status: FlowerApprovalStatusPending,
		Revision: 3, Version: 3, SurfaceEpoch: 4, SurfaceRole: FlowerApprovalSurfacePrimaryAction,
		Scope: "thread:thread_child", QueueGeneration: 4, QueueOrder: 8, CanApprove: true,
		Summary: FlowerApprovalSummary{Label: "child command"},
	}
	queued := FlowerApprovalAction{
		ActionID: "root_action", Origin: FlowerApprovalOriginMainTool,
		RunID: "run_root", TurnID: "turn_root", ToolID: "tool_root", ToolName: "file.edit",
		State: FlowerApprovalStateRequested, Status: FlowerApprovalStatusPending,
		Revision: 1, Version: 1, SurfaceEpoch: 4, SurfaceRole: FlowerApprovalSurfaceLocator,
		Scope: "thread:" + threadID, QueueGeneration: 4, QueueOrder: 9, CanApprove: false,
		ReadOnlyReason: "Queued for approval", Summary: FlowerApprovalSummary{Label: "edit file"},
	}
	queue := FlowerApprovalQueue{
		Generation: 4, Revision: 9, CurrentActionID: delegated.ActionID,
		CurrentPosition: 1, Total: 2, UnresolvedCount: 2,
	}
	replaced := svc.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: endpointID, ThreadID: threadID, RunID: "run_root",
		Kind: FlowerLiveApprovalQueueReplaced,
		Payload: mustFlowerPayload(FlowerLiveApprovalQueuePayload{
			Actions: []FlowerApprovalAction{delegated, queued}, ApprovalQueue: queue,
		}),
	})

	svc.mu.Lock()
	state := cloneFlowerLiveMaterializedState(stream.State)
	svc.mu.Unlock()
	if state.ApprovalQueue == nil || *state.ApprovalQueue != queue {
		t.Fatalf("approval queue=%#v, want %#v", state.ApprovalQueue, queue)
	}
	if _, ok := state.ApprovalActions[stale.ActionID]; ok {
		t.Fatalf("stale canonical action survived replacement")
	}
	if _, ok := state.ApprovalActions[control.ActionID]; !ok {
		t.Fatalf("Redeven control confirmation was removed by Floret queue replacement")
	}
	for _, actionID := range []string{delegated.ActionID, queued.ActionID} {
		action, ok := state.ApprovalActions[actionID]
		if !ok || action.ExpectedSeq != replaced.Seq {
			t.Fatalf("canonical action %q=%#v, want replacement seq %d", actionID, action, replaced.Seq)
		}
	}

	emptyQueue := FlowerApprovalQueue{Generation: 4, Revision: 10}
	cleared := svc.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: endpointID, ThreadID: threadID, RunID: "run_root",
		Kind: FlowerLiveApprovalQueueReplaced,
		Payload: mustFlowerPayload(FlowerLiveApprovalQueuePayload{
			Actions: []FlowerApprovalAction{}, ApprovalQueue: emptyQueue,
		}),
	})
	if cleared.Seq <= replaced.Seq {
		t.Fatalf("empty replacement seq=%d, want after %d", cleared.Seq, replaced.Seq)
	}
	svc.mu.Lock()
	state = cloneFlowerLiveMaterializedState(stream.State)
	svc.mu.Unlock()
	if state.ApprovalQueue == nil || state.ApprovalQueue.UnresolvedCount != 0 || state.ApprovalQueue.Revision != emptyQueue.Revision {
		t.Fatalf("empty canonical queue was not projected: %#v", state.ApprovalQueue)
	}
	if len(state.ApprovalActions) != 1 || state.ApprovalActions[control.ActionID].ActionID == "" {
		t.Fatalf("empty canonical queue actions=%#v, want only control confirmation", state.ApprovalActions)
	}
}

func TestFlowerLiveProjectionRejectsRegressedCanonicalApprovalQueue(t *testing.T) {
	t.Parallel()

	current := FlowerApprovalQueue{Generation: 3, Revision: 8, CurrentActionID: "current", CurrentPosition: 1, Total: 1, UnresolvedCount: 1}
	currentAction := FlowerApprovalAction{
		ActionID: "current", Origin: FlowerApprovalOriginMainTool, RunID: "run", ToolID: "tool",
		ToolName: "terminal.exec", State: FlowerApprovalStateRequested, Status: FlowerApprovalStatusPending,
		Revision: 2, Version: 2, QueueGeneration: 3, QueueOrder: 4, CanApprove: true,
		Summary: FlowerApprovalSummary{Label: "current"},
	}
	state := FlowerLiveMaterializedState{
		Runs: map[string]FlowerLiveRunState{}, Messages: map[string]FlowerLiveMessageDraft{},
		ApprovalActions:     map[string]FlowerApprovalAction{currentAction.ActionID: currentAction},
		ApprovalActionsSeen: true, ApprovalQueue: &current,
		InputRequests: map[string]RequestUserInputPrompt{},
	}
	regressed := FlowerApprovalQueue{Generation: 3, Revision: 7}
	applyFlowerLiveEventToMaterializedState(&state, map[string]FlowerApprovalState{}, FlowerLiveEvent{
		Kind: FlowerLiveApprovalQueueReplaced,
		Payload: mustFlowerPayload(FlowerLiveApprovalQueuePayload{
			Actions: []FlowerApprovalAction{}, ApprovalQueue: regressed,
		}),
	})
	if state.ApprovalQueue == nil || *state.ApprovalQueue != current {
		t.Fatalf("regressed queue replaced current authority: %#v", state.ApprovalQueue)
	}
	if state.ApprovalActions[currentAction.ActionID].ActionID == "" {
		t.Fatalf("regressed queue removed current canonical action")
	}
}
