package ai

import (
	"context"
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/floegence/redeven/internal/ai/threadstore"
)

func appendFlowerTimelineTestMessage(t *testing.T, store *threadstore.Store, endpointID string, threadID string, messageID string, role string, text string, createdAtMs int64) {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"id":        messageID,
		"role":      role,
		"status":    "complete",
		"timestamp": createdAtMs,
		"blocks": []map[string]string{{
			"type":    "markdown",
			"content": text,
		}},
	})
	if err != nil {
		t.Fatalf("marshal message %s: %v", messageID, err)
	}
	if _, err := store.AppendMessage(context.Background(), endpointID, threadID, threadstore.Message{
		MessageID:       messageID,
		Role:            role,
		Status:          "complete",
		CreatedAtUnixMs: createdAtMs,
		UpdatedAtUnixMs: createdAtMs,
		TextContent:     text,
		MessageJSON:     string(raw),
	}, "user_test", "user@example.com"); err != nil {
		t.Fatalf("AppendMessage(%s): %v", messageID, err)
	}
}

func TestBuildFlowerTimelineMessagesUsesCanonicalTurnOrder(t *testing.T) {
	ctx := context.Background()
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = store.Close() }()

	endpointID := "env_flower_timeline_order"
	threadID := "thread_flower_timeline_order"
	if err := store.CreateThread(ctx, threadstore.Thread{
		ThreadID:   threadID,
		EndpointID: endpointID,
		Title:      "timeline order",
	}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	appendFlowerTimelineTestMessage(t, store, endpointID, threadID, "msg-user-1", "user", "first request", 3_000)
	appendFlowerTimelineTestMessage(t, store, endpointID, threadID, "msg-assistant-1", "assistant", "first answer", 1_000)
	appendFlowerTimelineTestMessage(t, store, endpointID, threadID, "msg-user-2", "user", "second request", 2_000)
	for _, turn := range []threadstore.ConversationTurn{
		{
			TurnID:             "msg-assistant-1",
			EndpointID:         endpointID,
			ThreadID:           threadID,
			RunID:              "run-1",
			UserMessageID:      "msg-user-1",
			AssistantMessageID: "msg-assistant-1",
			CreatedAtUnixMs:    3_000,
		},
		{
			TurnID:             "msg-assistant-2",
			EndpointID:         endpointID,
			ThreadID:           threadID,
			RunID:              "run-2",
			UserMessageID:      "msg-user-2",
			AssistantMessageID: "msg-assistant-2",
			CreatedAtUnixMs:    2_000,
		},
	} {
		if _, err := store.AppendConversationTurn(ctx, turn); err != nil {
			t.Fatalf("AppendConversationTurn(%s): %v", turn.TurnID, err)
		}
	}

	svc := &Service{threadsDB: store}
	timeline, err := svc.buildFlowerTimelineMessages(ctx, endpointID, threadID, FlowerLiveMaterializedState{
		Messages: map[string]FlowerLiveMessageDraft{
			"msg-assistant-2": {
				MessageID:   "msg-assistant-2",
				Role:        "assistant",
				Status:      "streaming",
				CreatedAtMs: 4_000,
				Blocks: []FlowerLiveBlock{{
					Type:    "markdown",
					Content: "second answer streaming",
				}},
			},
		},
		Runs: map[string]FlowerLiveRunState{
			"run-2": {RunID: "run-2", Status: string(RunStateRunning), MessageID: "msg-assistant-2"},
		},
		ApprovalActions: map[string]FlowerApprovalAction{},
		InputRequests:   map[string]RequestUserInputPrompt{},
	})
	if err != nil {
		t.Fatalf("buildFlowerTimelineMessages: %v", err)
	}

	gotIDs := make([]string, 0, len(timeline))
	for _, message := range timeline {
		gotIDs = append(gotIDs, message.MessageID)
	}
	wantIDs := []string{"msg-user-1", "msg-assistant-1", "msg-user-2", "msg-assistant-2"}
	if !reflect.DeepEqual(gotIDs, wantIDs) {
		t.Fatalf("timeline ids=%v, want %v", gotIDs, wantIDs)
	}
	if got := timeline[3]; got.Status != "streaming" || !got.ActiveCursor || got.Content != "second answer streaming" {
		t.Fatalf("live assistant projection=%+v", got)
	}
}

func TestBuildFlowerTimelineMessagesKeepsLateCanceledAssistantWithItsTurn(t *testing.T) {
	ctx := context.Background()
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = store.Close() }()

	endpointID := "env_flower_stop_send_late_cancel"
	threadID := "thread_flower_stop_send_late_cancel"
	if err := store.CreateThread(ctx, threadstore.Thread{
		ThreadID:   threadID,
		EndpointID: endpointID,
		Title:      "late cancel",
	}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	appendFlowerTimelineTestMessage(t, store, endpointID, threadID, "msg-user-1", "user", "first request", 1_000)
	appendFlowerTimelineTestMessage(t, store, endpointID, threadID, "msg-user-2", "user", "second request", 3_000)
	appendFlowerTimelineTestMessage(t, store, endpointID, threadID, "msg-assistant-1", "assistant", "partial first answer", 2_000)
	if _, err := store.AppendConversationTurn(ctx, threadstore.ConversationTurn{
		TurnID:          "msg-assistant-1",
		EndpointID:      endpointID,
		ThreadID:        threadID,
		RunID:           "run-1",
		UserMessageID:   "msg-user-1",
		CreatedAtUnixMs: 1_000,
	}); err != nil {
		t.Fatalf("AppendConversationTurn(run-1): %v", err)
	}
	if _, err := store.AppendConversationTurn(ctx, threadstore.ConversationTurn{
		TurnID:          "msg-assistant-2",
		EndpointID:      endpointID,
		ThreadID:        threadID,
		RunID:           "run-2",
		UserMessageID:   "msg-user-2",
		CreatedAtUnixMs: 3_000,
	}); err != nil {
		t.Fatalf("AppendConversationTurn(run-2): %v", err)
	}

	svc := &Service{threadsDB: store}
	timeline, err := svc.buildFlowerTimelineMessages(ctx, endpointID, threadID, FlowerLiveMaterializedState{
		Messages: map[string]FlowerLiveMessageDraft{
			"msg-assistant-2": {
				MessageID:   "msg-assistant-2",
				Role:        "assistant",
				Status:      "streaming",
				CreatedAtMs: 4_000,
				Blocks:      []FlowerLiveBlock{{Type: "markdown", Content: "second answer streaming"}},
			},
		},
		Runs:            map[string]FlowerLiveRunState{"run-2": {RunID: "run-2", Status: string(RunStateRunning), MessageID: "msg-assistant-2"}},
		ApprovalActions: map[string]FlowerApprovalAction{},
		InputRequests:   map[string]RequestUserInputPrompt{},
	})
	if err != nil {
		t.Fatalf("buildFlowerTimelineMessages: %v", err)
	}

	gotIDs := make([]string, 0, len(timeline))
	for _, message := range timeline {
		gotIDs = append(gotIDs, message.MessageID)
	}
	wantIDs := []string{"msg-user-1", "msg-assistant-1", "msg-user-2", "msg-assistant-2"}
	if !reflect.DeepEqual(gotIDs, wantIDs) {
		t.Fatalf("timeline ids=%v, want %v", gotIDs, wantIDs)
	}
}

func TestBuildFlowerTimelineMessagesPreservesPersistedContextAction(t *testing.T) {
	ctx := context.Background()
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = store.Close() }()

	endpointID := "env_flower_context_action"
	threadID := "thread_flower_context_action"
	if err := store.CreateThread(ctx, threadstore.Thread{
		ThreadID:   threadID,
		EndpointID: endpointID,
		Title:      "context action",
	}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	raw, err := json.Marshal(map[string]any{
		"id":        "msg-context",
		"role":      "user",
		"status":    "complete",
		"timestamp": int64(1_000),
		"blocks":    []map[string]string{{"type": "markdown", "content": "inspect this"}},
		"contextAction": map[string]any{
			"action_id": "assistant.ask.flower",
			"provider":  "flower",
		},
	})
	if err != nil {
		t.Fatalf("marshal context action message: %v", err)
	}
	if _, err := store.AppendMessage(ctx, endpointID, threadID, threadstore.Message{
		MessageID:       "msg-context",
		Role:            "user",
		Status:          "complete",
		CreatedAtUnixMs: 1_000,
		UpdatedAtUnixMs: 1_000,
		TextContent:     "inspect this",
		MessageJSON:     string(raw),
	}, "user_test", "user@example.com"); err != nil {
		t.Fatalf("AppendMessage: %v", err)
	}

	svc := &Service{threadsDB: store}
	timeline, err := svc.buildFlowerTimelineMessages(ctx, endpointID, threadID, FlowerLiveMaterializedState{})
	if err != nil {
		t.Fatalf("buildFlowerTimelineMessages: %v", err)
	}
	if len(timeline) != 1 {
		t.Fatalf("timeline len=%d, want 1", len(timeline))
	}
	action, ok := timeline[0].ContextAction.(map[string]any)
	if !ok || action["action_id"] != "assistant.ask.flower" || action["provider"] != "flower" {
		t.Fatalf("context action=%#v", timeline[0].ContextAction)
	}
}

func TestFlowerLiveCommittedCanceledMessageClearsLiveDraft(t *testing.T) {
	state := FlowerLiveMaterializedState{
		Messages: map[string]FlowerLiveMessageDraft{
			"msg-assistant": {
				MessageID: "msg-assistant",
				Role:      "assistant",
				Status:    "streaming",
				Blocks:    []FlowerLiveBlock{{Type: "markdown", Content: "partial"}},
			},
		},
		Runs:            map[string]FlowerLiveRunState{},
		ApprovalActions: map[string]FlowerApprovalAction{},
		InputRequests:   map[string]RequestUserInputPrompt{},
	}
	applyFlowerLiveEventToMaterializedState(&state, map[string]FlowerApprovalState{}, FlowerLiveEvent{
		Kind: FlowerLiveMessageCommitted,
		Payload: mustFlowerPayload(FlowerLiveMessageCommittedPayload{
			MessageID: "msg-assistant",
			Message:   json.RawMessage(`{"id":"msg-assistant","role":"assistant","status":"canceled","timestamp":1000,"blocks":[{"type":"markdown","content":"partial"}]}`),
		}),
	})
	if _, ok := state.Messages["msg-assistant"]; ok {
		t.Fatalf("committed canceled message must not remain as a live draft: %#v", state.Messages["msg-assistant"])
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
			SubagentID:      "child",
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
			SubagentID:      "child_first",
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
		SubagentID:      "child_second",
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
	if got := state.ApprovalActions[first.ActionID]; got.SurfaceRole != FlowerApprovalSurfacePrimaryAction || got.PrimaryWaitAnchor != "thread:thread_parent" {
		t.Fatalf("first surface=%q anchor=%q, want primary thread anchor", got.SurfaceRole, got.PrimaryWaitAnchor)
	}
	if got := state.ApprovalActions[second.ActionID]; got.SurfaceRole != FlowerApprovalSurfaceLocator || got.PrimaryWaitAnchor != "thread:thread_parent" || !got.CanApprove {
		t.Fatalf("second action=%#v, want locator retaining approval capability for later promotion", got)
	}

	first.State = FlowerApprovalStateRejected
	first.Status = FlowerApprovalStatusResolved
	first.CanApprove = false
	first.DeliveryState = FlowerApprovalDeliveryDelivered
	applyFlowerLiveEventToMaterializedState(&state, approvals, FlowerLiveEvent{
		Seq:     12,
		Kind:    FlowerLiveApprovalResolved,
		Payload: mustFlowerPayload(FlowerLiveApprovalPayload{Action: first}),
	})
	if got := state.ApprovalActions[second.ActionID]; got.SurfaceRole != FlowerApprovalSurfacePrimaryAction || !got.CanApprove {
		t.Fatalf("second action after first resolved=%#v, want promoted primary", got)
	}
}

func TestMergePersistedDelegatedApprovalStateRestoresResolvedAuditActions(t *testing.T) {
	ctx := context.Background()
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = store.Close() }()

	action := FlowerApprovalAction{
		ActionID:     "dappr_ack_unknown",
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
			SubagentID:      "child",
			ChildThreadID:   "thread_child",
			ChildRunID:      "run_child",
			ChildToolCallID: "tool_child",
			ApprovalID:      "approval_child",
		},
		DeliveryState: FlowerApprovalDeliveryAckUnknown,
		Summary:       FlowerApprovalSummary{Label: "Shell"},
	}
	if err := store.UpsertDelegatedApprovalRequest(ctx, delegatedApprovalRecordFromAction("env_parent", "user_parent", action)); err != nil {
		t.Fatalf("UpsertDelegatedApprovalRequest: %v", err)
	}

	svc := &Service{threadsDB: store}
	state := svc.mergePersistedDelegatedApprovalState(ctx, "env_parent", "thread_parent", FlowerLiveMaterializedState{})
	got, ok := state.ApprovalActions[action.ActionID]
	if !ok {
		t.Fatalf("persisted resolved delegated action was not restored: %#v", state.ApprovalActions)
	}
	if got.Status != FlowerApprovalStatusResolved || got.DeliveryState != FlowerApprovalDeliveryAckUnknown || got.CanApprove {
		t.Fatalf("restored delegated action=%#v, want resolved ack_unknown non-actionable", got)
	}
}

func TestAppendFlowerLiveTimelineReplacementSkipsStaleSnapshotAfterNewerReplacement(t *testing.T) {
	ctx := context.Background()
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = store.Close() }()

	endpointID := "env_flower_stale_replacement"
	threadID := "thread_flower_stale_replacement"
	if err := store.CreateThread(ctx, threadstore.Thread{
		ThreadID:   threadID,
		EndpointID: endpointID,
		Title:      "stale replacement",
	}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	stream := newFlowerLiveThreadStream()
	stream.NextSeq = 3
	stream.Events = []FlowerLiveEvent{
		{SchemaVersion: FlowerLiveSchemaVersion, Seq: 1, EndpointID: endpointID, ThreadID: threadID, Kind: FlowerLiveMessageBlockDelta, AtUnixMs: 1_000},
		{SchemaVersion: FlowerLiveSchemaVersion, Seq: 2, EndpointID: endpointID, ThreadID: threadID, Kind: FlowerLiveTimelineReplaced, AtUnixMs: 1_001},
	}
	svc := &Service{
		threadsDB: store,
		flowerLiveByThread: map[string]*flowerLiveThreadStream{
			runThreadKey(endpointID, threadID): stream,
		},
	}

	svc.appendFlowerLiveTimelineReplacement(endpointID, threadID, 1, FlowerLiveMaterializedState{}, 1_000)

	if len(stream.Events) != 2 {
		t.Fatalf("events len=%d, want stale replacement to be skipped", len(stream.Events))
	}
	if stream.NextSeq != 3 {
		t.Fatalf("next seq=%d, want 3", stream.NextSeq)
	}
}
