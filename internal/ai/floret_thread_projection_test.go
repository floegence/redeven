package ai

import (
	"encoding/json"
	"testing"

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

func TestApplyFloretThreadProjectionReplacesStreamedBlocks(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 8)
	r := newRun(runOptions{})
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
