package ai

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
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

func TestFlowerTimelineMessageFromRawExtractsJSONBlockContent(t *testing.T) {
	t.Parallel()

	msg, ok, err := flowerTimelineMessageFromRaw("msg_assistant", "assistant", "complete", 123, json.RawMessage(`{
		"id":"msg_assistant",
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
	if err := store.UpsertRun(ctx, threadstore.RunRecord{
		RunID:      "run-2",
		EndpointID: endpointID,
		ThreadID:   threadID,
		MessageID:  "msg-assistant-2",
		State:      string(RunStateRunning),
	}); err != nil {
		t.Fatalf("UpsertRun(run-2): %v", err)
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
	if err := store.UpsertRun(ctx, threadstore.RunRecord{
		RunID:      "run-2",
		EndpointID: endpointID,
		ThreadID:   threadID,
		MessageID:  "msg-assistant-2",
		State:      string(RunStateRunning),
	}); err != nil {
		t.Fatalf("UpsertRun(run-2): %v", err)
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

func TestFlowerLiveCommittedMessageSanitizesActivityTimelinePayload(t *testing.T) {
	svc := &Service{}
	events := svc.flowerLiveEventsFromRealtime(RealtimeEvent{
		EventType:  RealtimeEventTypeTranscript,
		EndpointID: "env_terminal_public",
		ThreadID:   "thread_terminal_public",
		RunID:      "run_terminal_public",
		AtUnixMs:   1_700_000_000_000,
		MessageJSON: json.RawMessage(`{
			"id":"msg_terminal_public",
			"role":"assistant",
			"status":"complete",
			"timestamp":1700000000000,
			"blocks":[{
				"type":"activity-timeline",
				"schema_version":1,
				"run_id":"run_terminal_public",
				"thread_id":"thread_terminal_public",
				"turn_id":"msg_terminal_public",
				"summary":{"status":"success","severity":"quiet","needs_attention":false,"total_items":1,"counts":{"success":1}},
				"items":[{
					"item_id":"tool_terminal_public",
					"tool_id":"tool_terminal_public",
					"tool_name":"terminal.exec",
					"kind":"tool",
					"status":"success",
					"severity":"quiet",
					"needs_attention":false,
					"requires_approval":false,
					"label":"sleep 10",
					"renderer":"terminal",
					"payload":{
						"command":"sleep 10",
						"process_id":"tp_public",
						"cwd":"/Users/alice/private",
						"workdir":"/Users/alice/private",
						"stdin":"secret",
						"output":"",
						"status":"success"
					}
				}]
			}]
		}`),
	})
	if len(events) != 1 || events[0].Kind != FlowerLiveMessageCommitted {
		t.Fatalf("events=%#v, want one message.committed", events)
	}
	var payload FlowerLiveMessageCommittedPayload
	if !decodeFlowerPayload(events[0].Payload, &payload) {
		t.Fatalf("decode committed payload: %s", string(events[0].Payload))
	}
	body := string(payload.Message)
	for _, forbidden := range []string{`"cwd"`, `"workdir"`, `"stdin"`, "/Users/alice/private", "secret"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("committed public activity contains %q: %s", forbidden, body)
		}
	}
	for _, required := range []string{`"command":"sleep 10"`, `"process_id":"tp_public"`, `"output":""`, `"status":"success"`} {
		if !strings.Contains(body, required) {
			t.Fatalf("committed public activity missing %q: %s", required, body)
		}
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
	r := newRun(runOptions{Service: svc, RunID: "run_queue", EndpointID: meta.EndpointID, ThreadID: "thread_queue", UserPublicID: meta.UserPublicID, MessageID: "msg_queue"})
	svc.runs[r.id] = r
	firstDecision := make(chan bool, 1)
	secondDecision := make(chan bool, 1)
	r.toolApprovals["tool_first"] = &toolApprovalRequest{decision: firstDecision, promoted: make(chan struct{}), toolName: "task_complete", requestedAtMs: 1}
	r.toolApprovals["tool_second"] = &toolApprovalRequest{decision: secondDecision, promoted: make(chan struct{}), toolName: "task_complete", requestedAtMs: 2}
	for _, toolID := range []string{"tool_first", "tool_second"} {
		action := r.controlConfirmationApprovalActionLocked(toolID, r.toolApprovals[toolID])
		svc.appendFlowerLiveEvent(FlowerLiveEvent{EndpointID: meta.EndpointID, ThreadID: r.threadID, RunID: r.id, TurnID: r.messageID, Kind: FlowerLiveApprovalRequested, Payload: mustFlowerPayload(FlowerLiveApprovalPayload{Action: action})})
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
	if _, err := svc.SubmitFlowerApproval(meta, SubmitFlowerApprovalRequest{
		ThreadID: r.threadID, Origin: FlowerApprovalOriginControlConfirm, RunID: r.id, ActionID: firstID, ToolID: "tool_first",
		Approved: true, ExpectedSeq: first.ExpectedSeq, Revision: first.Revision, Version: first.Version, SurfaceEpoch: first.SurfaceEpoch,
		QueueGeneration: queue.Generation, QueueRevision: queue.Revision,
	}); err != nil {
		t.Fatalf("approve head: %v", err)
	}
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
	r := newRun(runOptions{Service: svc, RunID: "run_queue_timeout", EndpointID: meta.EndpointID, ThreadID: "thread_queue_timeout", UserPublicID: meta.UserPublicID, MessageID: "msg_queue_timeout"})
	svc.runs[r.id] = r
	firstDecision := make(chan bool, 1)
	secondDecision := make(chan bool, 1)
	r.toolApprovals["tool_first"] = &toolApprovalRequest{decision: firstDecision, promoted: make(chan struct{}), toolName: "task_complete", requestedAtMs: 1}
	r.toolApprovals["tool_second"] = &toolApprovalRequest{decision: secondDecision, promoted: make(chan struct{}), toolName: "task_complete", requestedAtMs: 2}
	for _, toolID := range []string{"tool_first", "tool_second"} {
		action := r.controlConfirmationApprovalActionLocked(toolID, r.toolApprovals[toolID])
		svc.appendFlowerLiveEvent(FlowerLiveEvent{EndpointID: meta.EndpointID, ThreadID: r.threadID, RunID: r.id, TurnID: r.messageID, Kind: FlowerLiveApprovalRequested, Payload: mustFlowerPayload(FlowerLiveApprovalPayload{Action: action})})
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
		TurnID:     r.messageID,
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
