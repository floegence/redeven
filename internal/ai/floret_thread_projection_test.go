package ai

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
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
			ItemID:           "approval:" + toolID,
			ToolID:           toolID,
			ToolName:         "terminal.exec",
			Kind:             observation.ActivityKindApproval,
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
