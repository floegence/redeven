package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
)

type threadDetailRecordingHost struct {
	recordingFloretHost
	pages    []flruntime.ThreadDetailEvents
	requests []flruntime.ListThreadDetailEventsRequest
}

func (h *threadDetailRecordingHost) ListThreadDetailEvents(_ context.Context, req flruntime.ListThreadDetailEventsRequest) (flruntime.ThreadDetailEvents, error) {
	h.requests = append(h.requests, req)
	if len(h.pages) == 0 {
		return flruntime.ThreadDetailEvents{}, nil
	}
	page := h.pages[0]
	h.pages = h.pages[1:]
	return page, nil
}

func TestListFloretThreadDetailEventsForTurnRequestsRawContent(t *testing.T) {
	host := &threadDetailRecordingHost{
		pages: []flruntime.ThreadDetailEvents{
			{
				Events: []flruntime.ThreadDetailEvent{
					{
						ID:      "other-turn",
						Ordinal: 1,
						TurnID:  flruntime.TurnID("other"),
						Kind:    flruntime.ThreadDetailEventAssistantMessage,
						Message: &flruntime.ThreadDetailMessage{Preview: "other preview", Content: "other raw"},
					},
					{
						ID:      "target-preview-and-raw",
						Ordinal: 2,
						TurnID:  flruntime.TurnID("turn"),
						Kind:    flruntime.ThreadDetailEventAssistantMessage,
						Message: &flruntime.ThreadDetailMessage{Preview: "Gateway (`*`#5...", Content: "Gateway complete raw content."},
					},
				},
				HasMore:     true,
				NextOrdinal: 2,
			},
			{
				Events: []flruntime.ThreadDetailEvent{{
					ID:      "target-close",
					Ordinal: 3,
					TurnID:  flruntime.TurnID("turn"),
					Kind:    flruntime.ThreadDetailEventAssistantMessage,
					Message: &flruntime.ThreadDetailMessage{Preview: "Close...", Content: "Close complete raw content."},
				}},
			},
		},
	}

	events, err := listFloretThreadDetailEventsForTurn(context.Background(), host, flruntime.ThreadID("thread"), flruntime.TurnID("turn"))
	if err != nil {
		t.Fatalf("listFloretThreadDetailEventsForTurn: %v", err)
	}
	if len(host.requests) != 2 {
		t.Fatalf("requests=%d, want paged raw requests: %#v", len(host.requests), host.requests)
	}
	if !host.requests[0].IncludeRaw || !host.requests[1].IncludeRaw {
		t.Fatalf("thread detail requests must include raw assistant content: %#v", host.requests)
	}
	if host.requests[0].AfterOrdinal != 0 || host.requests[1].AfterOrdinal != 2 {
		t.Fatalf("request pagination=%#v, want after 0 then 2", host.requests)
	}
	if len(events) != 2 {
		t.Fatalf("events=%d, want only target turn events: %#v", len(events), events)
	}
	if got := events[0].Message.Content; got != "Gateway complete raw content." {
		t.Fatalf("first event content=%q, want raw content", got)
	}
}

func TestFloretThreadDetailProjectionPersistsFullAssistantContentAfterActivity(t *testing.T) {
	const fullAnswer = "Here is the complete Redeven summary.\n\n- **Gateway** - `redeven-gateway` exposes the full gateway contract through OpenAPI.\n\nWhich part of Redeven would you like to explore next?"
	const previewOnly = "Here is the complete Redeven summary.\n\n- **Gateway** - `redeven-gateway` through OpenAPI (`*`#5..."

	events := make([]any, 0, 4)
	r := newRun(runOptions{})
	r.id = "run_full_projection"
	r.threadID = "thread_full_projection"
	r.messageID = "msg_full_projection"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	threadEvents := []flruntime.ThreadDetailEvent{
		{
			Ordinal:  1,
			TurnID:   flruntime.TurnID("msg_full_projection"),
			Kind:     flruntime.ThreadDetailEventToolCall,
			ToolCall: &flruntime.ThreadDetailToolCall{ID: "call-okf", Name: "okf.open"},
		},
		{
			Ordinal:    2,
			TurnID:     flruntime.TurnID("msg_full_projection"),
			Kind:       flruntime.ThreadDetailEventToolResult,
			ToolResult: &flruntime.ThreadDetailToolResult{CallID: "call-okf", ToolName: "okf.open", Preview: "OKF result"},
		},
		{
			Ordinal: 3,
			TurnID:  flruntime.TurnID("msg_full_projection"),
			Kind:    flruntime.ThreadDetailEventAssistantMessage,
			Message: &flruntime.ThreadDetailMessage{Preview: previewOnly, Content: fullAnswer},
		},
	}
	timeline := observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		RunID:         "run_full_projection",
		ThreadID:      "thread_full_projection",
		TurnID:        "msg_full_projection",
		TraceID:       "run_full_projection",
		Summary:       observation.ActivitySummary{Status: observation.ActivityStatusSuccess, Severity: observation.ActivitySeverityNormal},
		Items: []observation.ActivityItem{{
			ItemID:   "tool:call-okf",
			ToolID:   "call-okf",
			ToolName: "okf.open",
			Kind:     observation.ActivityKindTool,
			Status:   observation.ActivityStatusSuccess,
		}},
	}

	if !r.applyFloretThreadDetailProjection(threadEvents, timeline) {
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
		t.Fatalf("assistantBlocks[1]=%T %+v, want full raw markdown", r.assistantBlocks[1], r.assistantBlocks[1])
	}

	rawJSON, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != fullAnswer {
		t.Fatalf("assistantText=%q, want full raw answer", assistantText)
	}
	if strings.Contains(rawJSON, "#5...") {
		t.Fatalf("assistant snapshot persisted preview truncation: %s", rawJSON)
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
		t.Fatalf("snapshot markdown=%q, want full raw answer", markdown.Content)
	}
}

func TestFlowerBlocksFromFloretThreadEventsInterleavesTextAndActivity(t *testing.T) {
	t.Parallel()

	events := []flruntime.ThreadDetailEvent{
		{
			Ordinal: 2,
			Kind:    flruntime.ThreadDetailEventAssistantMessage,
			Message: &flruntime.ThreadDetailMessage{Content: "Before first tool."},
		},
		{
			Ordinal: 3,
			Kind:    flruntime.ThreadDetailEventToolCall,
			ToolCall: &flruntime.ThreadDetailToolCall{
				ID:   "call-1",
				Name: "inspect_once",
			},
		},
		{
			Ordinal: 4,
			Kind:    flruntime.ThreadDetailEventToolResult,
			ToolResult: &flruntime.ThreadDetailToolResult{
				CallID:   "call-1",
				ToolName: "inspect_once",
			},
		},
		{
			Ordinal: 5,
			Kind:    flruntime.ThreadDetailEventAssistantMessage,
			Message: &flruntime.ThreadDetailMessage{Content: "After first tool, before second tool."},
		},
		{
			Ordinal: 6,
			Kind:    flruntime.ThreadDetailEventToolCall,
			ToolCall: &flruntime.ThreadDetailToolCall{
				ID:   "call-2",
				Name: "inspect_twice",
			},
		},
		{
			Ordinal: 7,
			Kind:    flruntime.ThreadDetailEventToolResult,
			ToolResult: &flruntime.ThreadDetailToolResult{
				CallID:   "call-2",
				ToolName: "inspect_twice",
			},
		},
		{
			Ordinal: 8,
			Kind:    flruntime.ThreadDetailEventAssistantMessage,
			Message: &flruntime.ThreadDetailMessage{Content: "Final answer."},
		},
	}
	timeline := observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		RunID:         "run",
		ThreadID:      "thread",
		TurnID:        "turn",
		TraceID:       "run",
		Summary:       observation.ActivitySummary{Status: observation.ActivityStatusSuccess, Severity: observation.ActivitySeverityNormal},
		Items: []observation.ActivityItem{
			{
				ItemID:   "tool:call-1",
				ToolID:   "call-1",
				ToolName: "inspect_once",
				Kind:     observation.ActivityKindTool,
				Status:   observation.ActivityStatusSuccess,
			},
			{
				ItemID:   "tool:call-2",
				ToolID:   "call-2",
				ToolName: "inspect_twice",
				Kind:     observation.ActivityKindTool,
				Status:   observation.ActivityStatusSuccess,
			},
		},
	}

	blocks := flowerBlocksFromFloretThreadEvents(events, floretThreadProjectionOptions{ActivityTimeline: timeline})

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

func TestApplyFloretThreadDetailProjectionReplacesStreamedBlocks(t *testing.T) {
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
	threadEvents := []flruntime.ThreadDetailEvent{
		{
			Ordinal: 1,
			Kind:    flruntime.ThreadDetailEventAssistantMessage,
			Message: &flruntime.ThreadDetailMessage{Content: "Canonical intro."},
		},
		{
			Ordinal: 2,
			Kind:    flruntime.ThreadDetailEventToolCall,
			ToolCall: &flruntime.ThreadDetailToolCall{
				ID:   "call-1",
				Name: "terminal.exec",
			},
		},
		{
			Ordinal: 3,
			Kind:    flruntime.ThreadDetailEventAssistantMessage,
			Message: &flruntime.ThreadDetailMessage{Content: "Canonical close."},
		},
	}
	timeline := observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		RunID:         "run_projection",
		ThreadID:      "thread_projection",
		TurnID:        "msg_projection",
		TraceID:       "run_projection",
		Summary:       observation.ActivitySummary{Status: observation.ActivityStatusSuccess, Severity: observation.ActivitySeverityNormal},
		Items: []observation.ActivityItem{{
			ItemID:   "tool:call-1",
			ToolID:   "call-1",
			ToolName: "terminal.exec",
			Kind:     observation.ActivityKindTool,
			Status:   observation.ActivityStatusSuccess,
		}},
	}

	if !r.applyFloretThreadDetailProjection(threadEvents, timeline) {
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

func TestApplyFloretThreadDetailProjectionClearsStreamedBlocksWhenEmpty(t *testing.T) {
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

	if !r.applyFloretThreadDetailProjection(nil, observation.ActivityTimeline{}) {
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
