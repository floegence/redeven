package ai

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

func TestFloretThreadProjectionPersistsFullAssistantContentAfterActivity(t *testing.T) {
	const fullAnswer = "Here is the complete Redeven summary.\n\n- **Gateway** - `redeven-gateway` exposes the full gateway contract through OpenAPI.\n\nWhich part of Redeven would you like to explore next?"
	events := make([]any, 0, 4)
	r := newRun(runOptions{})
	r.id = "run_full_projection"
	r.threadID = "thread_full_projection"
	r.messageID = "msg_full_projection"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }

	if !r.applyFloretThreadProjection(flruntime.ThreadTurnProjection{
		ThreadID: "thread_full_projection",
		TurnID:   "msg_full_projection",
		RunID:    "run_full_projection",
		TraceID:  "run_full_projection",
		Segments: []flruntime.ThreadTurnProjectionSegment{
			{
				Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
				ActivityTimeline: floretProjectionTimeline("run_full_projection", "thread_full_projection", "msg_full_projection", "call-okf", "okf.open"),
			},
			{
				Kind: flruntime.ThreadTurnProjectionSegmentAssistantText,
				Text: fullAnswer,
			},
		},
	}) {
		t.Fatalf("projection returned false")
	}
	if len(r.assistantBlocks) != 2 {
		t.Fatalf("assistantBlocks len=%d, want activity plus final markdown: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	if _, ok := r.assistantBlocks[0].(ActivityTimelineBlock); !ok {
		t.Fatalf("assistantBlocks[0]=%T, want activity timeline", r.assistantBlocks[0])
	}
	block, ok := r.assistantBlocks[1].(*persistedMarkdownBlock)
	if !ok || block.Content != fullAnswer {
		t.Fatalf("assistantBlocks[1]=%T %+v, want full markdown", r.assistantBlocks[1], r.assistantBlocks[1])
	}

	rawJSON, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != fullAnswer {
		t.Fatalf("assistantText=%q, want full answer", assistantText)
	}
	var msg struct {
		Blocks []json.RawMessage `json:"blocks"`
	}
	if err := json.Unmarshal([]byte(rawJSON), &msg); err != nil {
		t.Fatalf("json.Unmarshal snapshot: %v", err)
	}
	var markdown persistedMarkdownBlock
	if err := json.Unmarshal(msg.Blocks[1], &markdown); err != nil {
		t.Fatalf("json.Unmarshal markdown block: %v", err)
	}
	if markdown.Content != fullAnswer {
		t.Fatalf("snapshot markdown=%q, want full answer", markdown.Content)
	}
}

func TestSettlePendingToolWithFloretUsesActiveHost(t *testing.T) {
	host := &recordingFloretHost{
		settleResult: flruntime.PendingToolSettlementResult{
			RunID: "run_terminal",
			Projection: flruntime.ThreadTurnProjection{
				RunID: "run_terminal",
			},
		},
	}
	activeRun := &run{id: "run_terminal", endpointID: "env_terminal", threadID: "thread_terminal"}
	activeRun.setActiveFloretHost(host)
	svc := &Service{
		activeRunByTh: map[string]string{runThreadKey("env_terminal", "thread_terminal"): "run_terminal"},
		runs:          map[string]*run{"run_terminal": activeRun},
	}
	req := flruntime.PendingToolSettlementRequest{
		RunID:      "run_terminal",
		TurnID:     "turn_terminal",
		ToolCallID: "call_terminal",
		ToolName:   "terminal.exec",
		Handle:     "tp_terminal",
		Status:     flruntime.PendingToolSettlementCompleted,
		Summary:    "Terminal process completed",
	}

	result, err := svc.settlePendingToolWithFloret(context.Background(), "env_terminal", "thread_terminal", req)
	if err != nil {
		t.Fatalf("settlePendingToolWithFloret: %v", err)
	}
	if result.RunID != "run_terminal" {
		t.Fatalf("result=%#v, want active host result", result)
	}
	if len(host.settleRequests) != 1 {
		t.Fatalf("settle requests=%#v, want one", host.settleRequests)
	}
	got := host.settleRequests[0]
	if got.ToolCallID != "call_terminal" || got.Handle != "tp_terminal" {
		t.Fatalf("settle request=%#v", got)
	}
}

func TestSettlePendingToolWithFloretFallsBackToLifecycleHost(t *testing.T) {
	svc := newTestService(t, nil)
	req := flruntime.PendingToolSettlementRequest{
		ThreadID:   "missing_thread",
		RunID:      "run_terminal",
		TurnID:     "turn_terminal",
		ToolCallID: "call_terminal",
		ToolName:   "terminal.exec",
		Handle:     "tp_terminal",
		Status:     flruntime.PendingToolSettlementCompleted,
		Summary:    "Terminal process completed",
	}

	_, err := svc.settlePendingToolWithFloret(context.Background(), "env_terminal", "missing_thread", req)
	if !errors.Is(err, flruntime.ErrThreadNotFound) {
		t.Fatalf("settlePendingToolWithFloret err=%v, want Floret lifecycle host ErrThreadNotFound", err)
	}
}

func TestFlowerBlocksFromFloretThreadProjectionInterleavesTextAndActivity(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	blocks := r.flowerBlocksFromFloretThreadProjection(flruntime.ThreadTurnProjection{
		RunID:    "run",
		ThreadID: "thread",
		TurnID:   "turn",
		TraceID:  "run",
		Segments: []flruntime.ThreadTurnProjectionSegment{
			{Kind: flruntime.ThreadTurnProjectionSegmentAssistantText, Text: "Before first tool."},
			{Kind: flruntime.ThreadTurnProjectionSegmentActivityTimeline, ActivityTimeline: floretProjectionTimeline("run", "thread", "turn", "call-1", "inspect_once")},
			{Kind: flruntime.ThreadTurnProjectionSegmentAssistantText, Text: "After first tool, before second tool."},
			{Kind: flruntime.ThreadTurnProjectionSegmentActivityTimeline, ActivityTimeline: floretProjectionTimeline("run", "thread", "turn", "call-2", "inspect_twice")},
			{Kind: flruntime.ThreadTurnProjectionSegmentAssistantText, Text: "Final answer."},
		},
	})

	if len(blocks) != 5 {
		t.Fatalf("blocks len=%d, want markdown/activity/markdown/activity/markdown: %#v", len(blocks), blocks)
	}
	wantMarkdown := map[int]string{
		0: "Before first tool.",
		2: "After first tool, before second tool.",
		4: "Final answer.",
	}
	for idx, want := range wantMarkdown {
		block, ok := blocks[idx].(*persistedMarkdownBlock)
		if !ok || block.Content != want {
			t.Fatalf("blocks[%d]=%T %+v, want markdown %q", idx, blocks[idx], blocks[idx], want)
		}
	}
	firstActivity, ok := blocks[1].(ActivityTimelineBlock)
	if !ok || len(firstActivity.Items) != 1 || firstActivity.Items[0].ToolID != "call-1" {
		t.Fatalf("blocks[1]=%T %#v, want first activity segment", blocks[1], blocks[1])
	}
	secondActivity, ok := blocks[3].(ActivityTimelineBlock)
	if !ok || len(secondActivity.Items) != 1 || secondActivity.Items[0].ToolID != "call-2" {
		t.Fatalf("blocks[3]=%T %#v, want second activity segment", blocks[3], blocks[3])
	}
}

func TestFlowerBlocksFromFloretThreadProjectionKeepsRequestedApprovalWaiting(t *testing.T) {
	t.Parallel()

	now := time.Unix(250, 0)
	projection := flruntime.ProjectThreadTurn(flruntime.ProjectThreadTurnRequest{
		RunID:    "run_waiting_approval",
		ThreadID: "thread_waiting_approval",
		TurnID:   "msg_waiting_approval",
		TraceID:  "run_waiting_approval",
		Events: []flruntime.ThreadDetailEvent{
			{
				ID:        "approval-requested",
				Ordinal:   1,
				ThreadID:  "thread_waiting_approval",
				TurnID:    "msg_waiting_approval",
				Kind:      flruntime.ThreadDetailEventApproval,
				Type:      observation.EventTypeToolApprovalRequested,
				CreatedAt: now,
				Approval:  &flruntime.ThreadDetailApproval{State: "requested", ToolID: "exec-1", ToolName: "terminal.exec"},
				ActivityTimeline: floretProjectionApprovalTimeline(
					"run_waiting_approval",
					"thread_waiting_approval",
					"msg_waiting_approval",
					"exec-1",
					"curl -s https://example.test",
				),
			},
			{
				ID:        "turn-success",
				Ordinal:   2,
				ThreadID:  "thread_waiting_approval",
				TurnID:    "msg_waiting_approval",
				Kind:      flruntime.ThreadDetailEventTurnMarker,
				CreatedAt: now.Add(time.Second),
				TurnMarker: &flruntime.ThreadDetailTurnMarker{
					Status: string(observation.ActivityStatusSuccess),
				},
			},
		},
	})

	r := newRun(runOptions{})
	blocks := r.flowerBlocksFromFloretThreadProjection(projection)
	if len(blocks) != 1 {
		t.Fatalf("blocks len=%d, want one activity block: %#v", len(blocks), blocks)
	}
	block, ok := blocks[0].(ActivityTimelineBlock)
	if !ok || len(block.Items) != 1 {
		t.Fatalf("blocks[0]=%T %#v, want activity timeline", blocks[0], blocks[0])
	}
	item := block.Items[0]
	if block.Summary.Status != observation.ActivityStatusWaiting ||
		block.Summary.Counts.Success != 0 ||
		item.Status != observation.ActivityStatusWaiting ||
		item.ApprovalState != "requested" ||
		item.EndedAtUnixMS != 0 ||
		item.Label != "curl -s https://example.test" {
		t.Fatalf("approval activity should remain waiting: summary=%#v item=%#v", block.Summary, item)
	}
}

func TestFlowerBlocksFromFloretThreadProjectionKeepsPendingApprovalAsSingleToolRow(t *testing.T) {
	t.Parallel()

	timeline := observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		RunID:         "run_weather",
		ThreadID:      "thread_weather",
		TurnID:        "msg_weather",
		TraceID:       "run_weather",
		Summary: observation.ActivitySummary{
			Status:         observation.ActivityStatusWaiting,
			Severity:       observation.ActivitySeverityBlocking,
			NeedsAttention: true,
			TotalItems:     2,
			Counts:         observation.ActivityCounts{Success: 1, Waiting: 1, Approval: 1},
		},
		Items: []observation.ActivityItem{
			{
				ItemID:          "tool:fetch-weather-once",
				ToolID:          "fetch-weather-once",
				ToolName:        "terminal.exec",
				Kind:            observation.ActivityKindTool,
				Status:          observation.ActivityStatusSuccess,
				Severity:        observation.ActivitySeverityNormal,
				Label:           `curl -s "wttr.in/Changsha?format=j1" 2>/dev/null | head -200`,
				Renderer:        observation.ActivityRendererTerminal,
				Payload:         map[string]any{"command": `curl -s "wttr.in/Changsha?format=j1" 2>/dev/null | head -200`},
				StartedAtUnixMS: 10,
				EndedAtUnixMS:   20,
			},
			{
				ItemID:           "tool:format-weather",
				ToolID:           "format-weather",
				ToolName:         "terminal.exec",
				Kind:             observation.ActivityKindTool,
				Status:           observation.ActivityStatusWaiting,
				Severity:         observation.ActivitySeverityBlocking,
				NeedsAttention:   true,
				AttentionReasons: []observation.ActivityAttentionReason{observation.ActivityAttentionWaiting, observation.ActivityAttentionApproval},
				RequiresApproval: true,
				ApprovalState:    "requested",
				Label:            `curl -s "wttr.in/Changsha?format=j1" 2>/dev/null | python3 -c "import json, sys"`,
				Renderer:         observation.ActivityRendererTerminal,
				Payload:          map[string]any{"command": `curl -s "wttr.in/Changsha?format=j1" 2>/dev/null | python3 -c "import json, sys"`},
				StartedAtUnixMS:  30,
			},
		},
	}
	if err := observation.ValidateActivityTimeline(timeline); err != nil {
		t.Fatalf("timeline should validate: %v", err)
	}

	r := newRun(runOptions{})
	blocks := r.flowerBlocksFromFloretThreadProjection(flruntime.ThreadTurnProjection{
		RunID:    "run_weather",
		ThreadID: "thread_weather",
		TurnID:   "msg_weather",
		TraceID:  "run_weather",
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: &timeline,
		}},
	})
	if len(blocks) != 1 {
		t.Fatalf("blocks len=%d, want one activity block: %#v", len(blocks), blocks)
	}
	block, ok := blocks[0].(ActivityTimelineBlock)
	if !ok {
		t.Fatalf("blocks[0]=%T %#v, want activity timeline", blocks[0], blocks[0])
	}
	if len(block.Items) != 2 ||
		block.Items[0].Status != observation.ActivityStatusSuccess ||
		block.Items[1].Status != observation.ActivityStatusWaiting ||
		block.Items[1].ApprovalState != "requested" ||
		block.Items[1].ItemID != "tool:format-weather" {
		t.Fatalf("activity rows should be historical done plus one waiting tool: %#v", block.Items)
	}
}

func TestFlowerBlocksFromFloretThreadProjectionRejectsInvalidActivityTimeline(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	r.id = "run_invalid_projection"
	r.threadID = "thread_invalid_projection"
	r.messageID = "msg_invalid_projection"
	blocks := r.flowerBlocksFromFloretThreadProjection(flruntime.ThreadTurnProjection{
		RunID:    "run_invalid_projection",
		ThreadID: "thread_invalid_projection",
		TurnID:   "msg_invalid_projection",
		TraceID:  "run_invalid_projection",
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind: flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: floretProjectionInvalidRequestedApprovalTimeline(
				"run_invalid_projection",
				"thread_invalid_projection",
				"msg_invalid_projection",
			),
		}},
	})
	if len(blocks) != 0 {
		t.Fatalf("blocks=%#v, want invalid activity timeline rejected", blocks)
	}
}

func TestApplyFloretThreadProjectionReplacesStreamedBlocks(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 8)
	r := newRun(runOptions{})
	r.id = "run_projection"
	r.threadID = "thread_projection"
	r.messageID = "msg_projection"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	r.assistantBlocks = []any{
		&persistedMarkdownBlock{Type: "markdown", Content: "streamed partial"},
		activityTimelinePlaceholder("run_projection"),
		&persistedMarkdownBlock{Type: "markdown", Content: "late streamed"},
	}
	r.nextBlockIndex = len(r.assistantBlocks)

	if !r.applyFloretThreadProjection(flruntime.ThreadTurnProjection{
		RunID:    "run_projection",
		ThreadID: "thread_projection",
		TurnID:   "msg_projection",
		TraceID:  "run_projection",
		Segments: []flruntime.ThreadTurnProjectionSegment{
			{Kind: flruntime.ThreadTurnProjectionSegmentAssistantText, Text: "Canonical intro."},
			{Kind: flruntime.ThreadTurnProjectionSegmentActivityTimeline, ActivityTimeline: floretProjectionTimeline("run_projection", "thread_projection", "msg_projection", "call-1", "terminal.exec")},
			{Kind: flruntime.ThreadTurnProjectionSegmentAssistantText, Text: "Canonical close."},
		},
	}) {
		t.Fatalf("projection returned false")
	}
	if !r.hasFloretThreadDetailProjectionApplied() {
		t.Fatalf("projection flag not set")
	}
	if len(r.assistantBlocks) != 3 {
		t.Fatalf("assistantBlocks len=%d, want 3: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	first, ok := r.assistantBlocks[0].(*persistedMarkdownBlock)
	if !ok || first.Content != "Canonical intro." {
		t.Fatalf("assistantBlocks[0]=%T %+v", r.assistantBlocks[0], r.assistantBlocks[0])
	}
	if _, ok := r.assistantBlocks[1].(ActivityTimelineBlock); !ok {
		t.Fatalf("assistantBlocks[1]=%T, want activity timeline", r.assistantBlocks[1])
	}
	last, ok := r.assistantBlocks[2].(*persistedMarkdownBlock)
	if !ok || last.Content != "Canonical close." {
		t.Fatalf("assistantBlocks[2]=%T %+v", r.assistantBlocks[2], r.assistantBlocks[2])
	}
	if len(events) != 3 {
		t.Fatalf("stream events=%d, want block-set for each canonical block: %#v", len(events), events)
	}
}

func TestApplyFloretThreadProjectionClearsStreamedBlocksWhenEmpty(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newRun(runOptions{})
	r.messageID = "msg_empty_projection"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	r.assistantBlocks = []any{
		&persistedMarkdownBlock{Type: "markdown", Content: "streamed text"},
		activityTimelinePlaceholder("run_empty_projection"),
	}
	r.nextBlockIndex = len(r.assistantBlocks)

	if !r.applyFloretThreadProjection(flruntime.ThreadTurnProjection{}) {
		t.Fatalf("projection returned false")
	}
	if !r.hasFloretThreadDetailProjectionApplied() {
		t.Fatalf("projection flag not set")
	}
	if len(r.assistantBlocks) != 1 {
		t.Fatalf("assistantBlocks len=%d, want one empty cache block: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	block, ok := r.assistantBlocks[0].(*persistedMarkdownBlock)
	if !ok || block.Content != "" {
		t.Fatalf("assistantBlocks[0]=%T %+v, want empty markdown cache block", r.assistantBlocks[0], r.assistantBlocks[0])
	}
	if len(events) != 2 {
		t.Fatalf("stream events=%d, want empty canonical block and stale block clear: %#v", len(events), events)
	}
	first, ok := events[0].(streamEventBlockSet)
	if !ok || first.BlockIndex != 0 {
		t.Fatalf("events[0]=%T %#v, want block-set index 0", events[0], events[0])
	}
	cleared, ok := events[1].(streamEventBlockSet)
	if !ok || cleared.BlockIndex != 1 {
		t.Fatalf("events[1]=%T %#v, want stale block clear at index 1", events[1], events[1])
	}
}

func TestFloretTerminalThreadProjectionUpdatesDetachedSnapshotWithoutStream(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 1)
	r := newRun(runOptions{})
	r.id = "run_terminal_projection"
	r.threadID = "thread_terminal_projection"
	r.messageID = "msg_terminal_projection"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	r.markDetached()

	timeline := floretProjectionTimeline("run_terminal_projection", "thread_terminal_projection", "msg_terminal_projection", "exec-1", "terminal.exec")
	timeline.Summary.Status = observation.ActivityStatusCanceled
	timeline.Summary.Counts = observation.ActivityCounts{Canceled: 1}
	timeline.Items[0].Status = observation.ActivityStatusCanceled
	timeline.Items[0].Severity = observation.ActivitySeverityWarning

	if !r.applyFloretTerminalThreadProjection(flruntime.ThreadTurnProjection{
		ThreadID: "thread_terminal_projection",
		TurnID:   "msg_terminal_projection",
		RunID:    "run_terminal_projection",
		TraceID:  "run_terminal_projection",
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: timeline,
		}},
	}) {
		t.Fatalf("terminal projection returned false")
	}
	if len(events) != 0 {
		t.Fatalf("stream events=%d, want none for detached terminal projection: %#v", len(events), events)
	}
	if len(r.assistantBlocks) != 1 {
		t.Fatalf("assistantBlocks=%#v, want one activity block", r.assistantBlocks)
	}
	block, ok := r.assistantBlocks[0].(ActivityTimelineBlock)
	if !ok || block.Summary.Status != observation.ActivityStatusCanceled || block.Items[0].Status != observation.ActivityStatusCanceled {
		t.Fatalf("assistant block=%T %#v, want canceled activity timeline", r.assistantBlocks[0], r.assistantBlocks[0])
	}
}

func TestFloretTerminalThreadProjectionRejectsMismatchedRun(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	r.id = "run_terminal_projection"
	r.threadID = "thread_terminal_projection"
	r.messageID = "msg_terminal_projection"
	r.assistantBlocks = []any{&persistedMarkdownBlock{Type: "markdown", Content: "canceled"}}
	r.markDetached()

	if r.applyFloretTerminalThreadProjection(flruntime.ThreadTurnProjection{
		ThreadID: "thread_terminal_projection",
		TurnID:   "msg_terminal_projection",
		RunID:    "other_run",
		TraceID:  "other_run",
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: floretProjectionTimeline("other_run", "thread_terminal_projection", "msg_terminal_projection", "exec-1", "terminal.exec"),
		}},
	}) {
		t.Fatalf("terminal projection with mismatched run returned true")
	}
	block, ok := r.assistantBlocks[0].(*persistedMarkdownBlock)
	if !ok || block.Content != "canceled" {
		t.Fatalf("assistantBlocks mutated by mismatched terminal projection: %#v", r.assistantBlocks)
	}
	if r.hasFloretThreadDetailProjectionApplied() {
		t.Fatalf("projection flag set by mismatched terminal projection")
	}
}

func TestApplyFloretPendingToolSettlementProjectionPreservesCanceledAssistantMessage(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(ctx, meta, "terminal settlement", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_terminal_settlement"
	messageID := "msg_terminal_settlement"
	createdAt := time.UnixMilli(1_700_100_000_000).UnixMilli()
	initialRaw, err := json.Marshal(persistedMessage{
		ID:        messageID,
		Role:      "assistant",
		Status:    "canceled",
		Timestamp: createdAt,
		Blocks:    []any{&persistedMarkdownBlock{Type: "markdown", Content: ""}},
	})
	if err != nil {
		t.Fatalf("marshal initial assistant: %v", err)
	}
	rowID, err := svc.threadsDB.AppendMessage(ctx, meta.EndpointID, thread.ThreadID, threadstore.Message{
		ThreadID:        thread.ThreadID,
		EndpointID:      meta.EndpointID,
		MessageID:       messageID,
		Role:            "assistant",
		Status:          "canceled",
		CreatedAtUnixMs: createdAt,
		UpdatedAtUnixMs: createdAt,
		MessageJSON:     string(initialRaw),
	}, meta.UserPublicID, meta.UserEmail)
	if err != nil {
		t.Fatalf("AppendMessage: %v", err)
	}

	timeline := floretProjectionTimeline(runID, thread.ThreadID, messageID, "exec-1", "terminal.exec")
	timeline.Summary = observation.ActivitySummary{
		Status:     observation.ActivityStatusCanceled,
		Severity:   observation.ActivitySeverityWarning,
		TotalItems: 1,
		Counts:     observation.ActivityCounts{Canceled: 1},
	}
	timeline.Items[0].Status = observation.ActivityStatusCanceled
	timeline.Items[0].Severity = observation.ActivitySeverityWarning
	err = svc.applyFloretPendingToolSettlementProjection(ctx, meta.EndpointID, thread.ThreadID, runID, messageID, flruntime.ThreadTurnProjection{
		ThreadID: flruntime.ThreadID(thread.ThreadID),
		TurnID:   flruntime.TurnID(messageID),
		RunID:    flruntime.RunID(runID),
		TraceID:  flruntime.TraceID(runID),
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: timeline,
		}},
	})
	if err != nil {
		t.Fatalf("apply settlement projection: %v", err)
	}

	gotRowID, raw, err := svc.threadsDB.GetTranscriptMessageRowIDAndJSONByMessageID(ctx, meta.EndpointID, thread.ThreadID, messageID)
	if err != nil {
		t.Fatalf("GetTranscriptMessageRowIDAndJSONByMessageID: %v", err)
	}
	if gotRowID != rowID {
		t.Fatalf("rowID=%d, want original row %d", gotRowID, rowID)
	}
	var msg struct {
		Status string            `json:"status"`
		Blocks []json.RawMessage `json:"blocks"`
	}
	if err := json.Unmarshal([]byte(raw), &msg); err != nil {
		t.Fatalf("unmarshal assistant: %v", err)
	}
	if msg.Status != "canceled" || len(msg.Blocks) != 1 {
		t.Fatalf("assistant msg=%#v, want one canceled activity block", msg)
	}
	var block struct {
		Type    string `json:"type"`
		Summary struct {
			Status string `json:"status"`
		} `json:"summary"`
		Items []struct {
			Status string `json:"status"`
		} `json:"items"`
	}
	if err := json.Unmarshal(msg.Blocks[0], &block); err != nil {
		t.Fatalf("unmarshal activity block: %v", err)
	}
	if block.Type != activityTimelineBlockType ||
		block.Summary.Status != string(observation.ActivityStatusCanceled) ||
		len(block.Items) != 1 ||
		block.Items[0].Status != string(observation.ActivityStatusCanceled) {
		t.Fatalf("activity block=%#v, want canceled item", block)
	}
}

func floretProjectionTimeline(runID string, threadID string, turnID string, toolID string, toolName string) *observation.ActivityTimeline {
	timeline := observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		RunID:         runID,
		ThreadID:      threadID,
		TurnID:        turnID,
		TraceID:       runID,
		Summary:       observation.ActivitySummary{Status: observation.ActivityStatusSuccess, Severity: observation.ActivitySeverityNormal, TotalItems: 1},
		Items: []observation.ActivityItem{{
			ItemID:   "tool:" + toolID,
			ToolID:   toolID,
			ToolName: toolName,
			Kind:     observation.ActivityKindTool,
			Status:   observation.ActivityStatusSuccess,
			Severity: observation.ActivitySeverityNormal,
		}},
	}
	return &timeline
}

func floretProjectionApprovalTimeline(runID string, threadID string, turnID string, toolID string, label string) *observation.ActivityTimeline {
	timeline := observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		RunID:         runID,
		ThreadID:      threadID,
		TurnID:        turnID,
		TraceID:       runID,
		Summary: observation.ActivitySummary{
			Status:         observation.ActivityStatusWaiting,
			Severity:       observation.ActivitySeverityBlocking,
			NeedsAttention: true,
			TotalItems:     1,
			Counts:         observation.ActivityCounts{Waiting: 1, Approval: 1},
		},
		Items: []observation.ActivityItem{{
			ItemID:           "tool:" + toolID,
			ToolID:           toolID,
			ToolName:         "terminal.exec",
			Kind:             observation.ActivityKindTool,
			Status:           observation.ActivityStatusWaiting,
			Severity:         observation.ActivitySeverityBlocking,
			NeedsAttention:   true,
			RequiresApproval: true,
			ApprovalState:    "requested",
			Label:            label,
			Renderer:         observation.ActivityRendererTerminal,
			Payload:          map[string]any{"command": label},
		}},
	}
	return &timeline
}

func floretProjectionInvalidRequestedApprovalTimeline(runID string, threadID string, turnID string) *observation.ActivityTimeline {
	timeline := floretProjectionApprovalTimeline(runID, threadID, turnID, "exec-1", "curl -s https://example.test")
	timeline.Summary.Status = observation.ActivityStatusSuccess
	timeline.Summary.Severity = observation.ActivitySeverityNormal
	timeline.Summary.NeedsAttention = false
	timeline.Summary.Counts = observation.ActivityCounts{Success: 1, Approval: 1}
	timeline.Items[0].Status = observation.ActivityStatusSuccess
	timeline.Items[0].Severity = observation.ActivitySeverityNormal
	timeline.Items[0].NeedsAttention = false
	timeline.Items[0].EndedAtUnixMS = 20
	return timeline
}
