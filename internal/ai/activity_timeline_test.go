package ai

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/floegence/floret/observation"
)

func TestRecordObservationActivityEventPublishesFloretTimelineBlock(t *testing.T) {
	t.Parallel()

	var frames []ActivityTimelineBlock
	r := &run{
		id:                        "run_activity",
		threadID:                  "thread_activity",
		messageID:                 "msg_activity",
		activitySegmentBlockIndex: -1,
		activitySegmentEvents:     make([]observation.Event, 0, 4),
		nextBlockIndex:            0,
		onStreamEvent: func(ev any) {
			bs, ok := ev.(streamEventBlockSet)
			if !ok {
				return
			}
			block, ok := bs.Block.(ActivityTimelineBlock)
			if ok {
				frames = append(frames, block)
			}
		},
	}

	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolCall,
		ToolID:     "tool_terminal",
		ToolName:   "terminal.exec",
		ObservedAt: time.UnixMilli(1000),
	})
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolResult,
		ToolID:     "tool_terminal",
		ToolName:   "terminal.exec",
		ObservedAt: time.UnixMilli(1200),
	})

	if len(frames) != 2 {
		t.Fatalf("timeline frames=%d, want 2", len(frames))
	}
	latest := frames[len(frames)-1]
	if latest.Type != activityTimelineBlockType {
		t.Fatalf("block type=%q, want %q", latest.Type, activityTimelineBlockType)
	}
	if latest.RunID != "run_activity" || latest.ThreadID != "thread_activity" || latest.TurnID != "msg_activity" || latest.TraceID != "run_activity" {
		t.Fatalf("timeline identity=%+v", latest.ActivityTimeline)
	}
	if latest.Summary.TotalItems != 1 || latest.Summary.Status != observation.ActivityStatusSuccess {
		t.Fatalf("summary=%+v, want one successful item", latest.Summary)
	}
	item := latest.Items[0]
	if item.ToolID != "tool_terminal" || item.ToolName != "terminal.exec" || item.Kind != observation.ActivityKindTool {
		t.Fatalf("item=%+v", item)
	}
	if item.StartedAtUnixMS != 1000 || item.EndedAtUnixMS != 1200 {
		t.Fatalf("item timing=%+v", item)
	}
}

func TestRecordObservationActivityEventSkipsEmptyTimeline(t *testing.T) {
	t.Parallel()

	streamFrames := 0
	r := &run{
		id:                        "run_empty",
		threadID:                  "thread_empty",
		messageID:                 "msg_empty",
		activitySegmentBlockIndex: -1,
		activitySegmentEvents:     make([]observation.Event, 0, 2),
		nextBlockIndex:            0,
		onStreamEvent: func(ev any) {
			if _, ok := ev.(streamEventBlockSet); ok {
				streamFrames++
			}
		},
	}

	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeRunEnd,
		Message:    string(observation.ActivityStatusSuccess),
		ObservedAt: time.UnixMilli(1000),
	})

	if len(r.assistantBlocks) != 0 {
		t.Fatalf("assistantBlocks=%#v, want no activity block", r.assistantBlocks)
	}
	if streamFrames != 0 {
		t.Fatalf("streamFrames=%d, want 0", streamFrames)
	}
	if r.activitySegmentBlockIndex != -1 || r.activitySegmentActive || r.nextBlockIndex != 0 {
		t.Fatalf("activity segment state index=%d active=%v next=%d, want untouched", r.activitySegmentBlockIndex, r.activitySegmentActive, r.nextBlockIndex)
	}
}

func TestRecordObservationActivityEventClosesRunningItemOnRunEnd(t *testing.T) {
	t.Parallel()

	var frames []ActivityTimelineBlock
	r := &run{
		id:                        "run_close",
		threadID:                  "thread_close",
		messageID:                 "msg_close",
		activitySegmentBlockIndex: -1,
		activitySegmentEvents:     make([]observation.Event, 0, 2),
		nextBlockIndex:            0,
		onStreamEvent: func(ev any) {
			bs, ok := ev.(streamEventBlockSet)
			if !ok {
				return
			}
			if block, ok := bs.Block.(ActivityTimelineBlock); ok {
				frames = append(frames, block)
			}
		},
	}

	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolCall,
		ToolID:     "tool_running",
		ToolName:   "terminal.exec",
		ObservedAt: time.UnixMilli(1000),
	})
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeRunEnd,
		Message:    string(observation.ActivityStatusSuccess),
		ObservedAt: time.UnixMilli(1300),
	})

	if len(frames) != 2 {
		t.Fatalf("timeline frames=%d, want 2", len(frames))
	}
	latest := frames[len(frames)-1]
	if latest.Summary.TotalItems != 1 || latest.Summary.Status != observation.ActivityStatusSuccess {
		t.Fatalf("summary=%+v, want successful one-item timeline", latest.Summary)
	}
	item := latest.Items[0]
	if item.ToolID != "tool_running" || item.Status != observation.ActivityStatusSuccess {
		t.Fatalf("item=%+v, want running tool closed as success", item)
	}
	if item.StartedAtUnixMS != 1000 || item.EndedAtUnixMS != 1300 {
		t.Fatalf("item timing=%+v, want run_end to close timing", item)
	}
	if len(r.assistantBlocks) != 1 {
		t.Fatalf("assistantBlocks len=%d, want one activity block", len(r.assistantBlocks))
	}
}

func TestRecordObservationActivityEventKeepsActivitySegmentsInBlockOrder(t *testing.T) {
	t.Parallel()

	r := &run{
		id:                        "run_order",
		threadID:                  "thread_order",
		messageID:                 "msg_order",
		currentTextBlockIndex:     -1,
		needNewTextBlock:          true,
		currentThinkingBlockIndex: -1,
		needNewThinkingBlock:      true,
		activitySegmentBlockIndex: -1,
		activitySegmentEvents:     make([]observation.Event, 0, 4),
	}

	if err := r.appendTextDelta("I will inspect the workspace."); err != nil {
		t.Fatalf("append first text: %v", err)
	}
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolCall,
		ToolID:     "tool_ls",
		ToolName:   "terminal.exec",
		Activity:   &observation.ActivityPresentation{Label: "ls -la", Renderer: observation.ActivityRendererTerminal},
		ObservedAt: time.UnixMilli(1000),
	})
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolResult,
		ToolID:     "tool_ls",
		ToolName:   "terminal.exec",
		ObservedAt: time.UnixMilli(1100),
	})
	if err := r.appendTextDelta("Now I will read the package file."); err != nil {
		t.Fatalf("append second text: %v", err)
	}
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolCall,
		ToolID:     "tool_read",
		ToolName:   "file.read",
		Activity:   &observation.ActivityPresentation{Label: "package.json", Renderer: observation.ActivityRendererFile},
		ObservedAt: time.UnixMilli(1200),
	})
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolResult,
		ToolID:     "tool_read",
		ToolName:   "file.read",
		ObservedAt: time.UnixMilli(1300),
	})

	if len(r.assistantBlocks) != 4 {
		t.Fatalf("assistantBlocks len=%d, want 4: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	firstText, ok := r.assistantBlocks[0].(*persistedMarkdownBlock)
	if !ok || firstText.Content != "I will inspect the workspace." {
		t.Fatalf("block[0]=%T %+v, want first markdown", r.assistantBlocks[0], r.assistantBlocks[0])
	}
	firstActivity, ok := r.assistantBlocks[1].(ActivityTimelineBlock)
	if !ok || len(firstActivity.Items) != 1 || firstActivity.Items[0].ToolID != "tool_ls" || firstActivity.Items[0].Label != "ls -la" {
		t.Fatalf("block[1]=%T %+v, want ls activity only", r.assistantBlocks[1], r.assistantBlocks[1])
	}
	secondText, ok := r.assistantBlocks[2].(*persistedMarkdownBlock)
	if !ok || secondText.Content != "Now I will read the package file." {
		t.Fatalf("block[2]=%T %+v, want second markdown", r.assistantBlocks[2], r.assistantBlocks[2])
	}
	secondActivity, ok := r.assistantBlocks[3].(ActivityTimelineBlock)
	if !ok || len(secondActivity.Items) != 1 || secondActivity.Items[0].ToolID != "tool_read" || secondActivity.Items[0].Label != "package.json" {
		t.Fatalf("block[3]=%T %+v, want file activity only", r.assistantBlocks[3], r.assistantBlocks[3])
	}
}

func TestPublishFinalActivityTimelineDoesNotAppendAfterProjectedSegment(t *testing.T) {
	t.Parallel()

	r := &run{
		id:                        "run_final_skip",
		threadID:                  "thread_final_skip",
		messageID:                 "msg_final_skip",
		activitySegmentBlockIndex: -1,
		activitySegmentEvents:     make([]observation.Event, 0, 2),
	}

	r.recordObservationActivityEvent(observation.Event{
		Type:     observation.EventTypeControlSignal,
		ToolID:   "call_task_complete",
		ToolName: "task_complete",
		ToolKind: "control",
		Activity: &observation.ActivityPresentation{
			Label:    "task_complete",
			Renderer: observation.ActivityRendererCompletion,
			Payload:  map[string]any{"result": "Done."},
		},
		ObservedAt: time.UnixMilli(1000),
	})
	if err := r.appendTextDelta("Done."); err != nil {
		t.Fatalf("appendTextDelta: %v", err)
	}
	r.publishFinalActivityTimeline(observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		RunID:         "run_final_skip",
		ThreadID:      "thread_final_skip",
		TurnID:        "msg_final_skip",
		TraceID:       "run_final_skip",
		Summary: observation.ActivitySummary{
			Status:     observation.ActivityStatusSuccess,
			Severity:   observation.ActivitySeverityQuiet,
			TotalItems: 1,
			Counts:     observation.ActivityCounts{Success: 1},
		},
		Items: []observation.ActivityItem{{
			ItemID:         "control:call_task_complete",
			ToolID:         "call_task_complete",
			ToolName:       "task_complete",
			Kind:           observation.ActivityKindControl,
			Status:         observation.ActivityStatusSuccess,
			Severity:       observation.ActivitySeverityQuiet,
			NeedsAttention: false,
			Renderer:       observation.ActivityRendererCompletion,
			Payload:        map[string]any{"result": "Done."},
		}},
	})

	if len(r.assistantBlocks) != 2 {
		t.Fatalf("assistantBlocks len=%d, want 2: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	if _, ok := r.assistantBlocks[0].(ActivityTimelineBlock); !ok {
		t.Fatalf("block[0]=%T, want activity timeline", r.assistantBlocks[0])
	}
	text, ok := r.assistantBlocks[1].(*persistedMarkdownBlock)
	if !ok || text.Content != "Done." {
		t.Fatalf("block[1]=%T %+v, want final markdown", r.assistantBlocks[1], r.assistantBlocks[1])
	}
}

func TestActivityTimelineFromAnyDecodesSnakeCaseBlock(t *testing.T) {
	t.Parallel()

	raw := map[string]any{
		"type":           "activity-timeline",
		"schema_version": float64(observation.ActivityTimelineSchemaVersion),
		"run_id":         "run_1",
		"thread_id":      "thread_1",
		"turn_id":        "msg_1",
		"trace_id":       "trace_1",
		"summary": map[string]any{
			"status":          "success",
			"severity":        "normal",
			"needs_attention": false,
			"total_items":     float64(1),
			"counts":          map[string]any{"success": float64(1)},
		},
		"items": []any{
			map[string]any{
				"item_id":         "tool:tool_1",
				"tool_id":         "tool_1",
				"tool_name":       "file.read",
				"kind":            "tool",
				"status":          "success",
				"severity":        "normal",
				"needs_attention": false,
				"label":           "package.json",
				"renderer":        "file",
				"chips": []any{
					map[string]any{"kind": "lines", "label": "lines", "value": "42", "tone": "neutral"},
				},
				"target_refs": []any{
					map[string]any{"kind": "file", "label": "package.json", "path": "package.json"},
				},
				"payload": map[string]any{"operation": "read", "path": "package.json"},
			},
		},
	}

	timeline, ok := activityTimelineFromAny(raw)
	if !ok {
		t.Fatalf("activityTimelineFromAny returned false")
	}
	if err := observation.ValidateActivityTimeline(timeline); err != nil {
		t.Fatalf("ValidateActivityTimeline: %v", err)
	}
	if timeline.RunID != "run_1" || timeline.Items[0].ToolName != "file.read" || timeline.Items[0].Renderer != observation.ActivityRendererFile {
		t.Fatalf("timeline=%+v", timeline)
	}
}

func TestActivityTimelineBlockJSONUsesSnakeCase(t *testing.T) {
	t.Parallel()

	block := newActivityTimelineBlock(observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		RunID:         "run_json",
		ThreadID:      "thread_json",
		TurnID:        "msg_json",
		TraceID:       "trace_json",
		Summary: observation.ActivitySummary{
			Status:     observation.ActivityStatusSuccess,
			Severity:   observation.ActivitySeverityNormal,
			TotalItems: 1,
			Counts:     observation.ActivityCounts{Success: 1},
		},
		Items: []observation.ActivityItem{{
			ItemID:         "tool:tool_json",
			ToolID:         "tool_json",
			ToolName:       "terminal.exec",
			Kind:           observation.ActivityKindTool,
			Status:         observation.ActivityStatusSuccess,
			Severity:       observation.ActivitySeverityNormal,
			NeedsAttention: false,
			Label:          "npm test",
			Renderer:       observation.ActivityRendererTerminal,
			Chips:          []observation.ActivityChip{{Kind: "exit_code", Label: "exit", Value: "0", Tone: "neutral"}},
			Payload:        map[string]any{"command": "npm test", "exit_code": 0},
		}},
	})

	raw, err := json.Marshal(block)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	for _, key := range []string{"schema_version", "run_id", "thread_id", "turn_id", "trace_id", "summary", "items"} {
		if _, ok := decoded[key]; !ok {
			t.Fatalf("missing key %q in %s", key, raw)
		}
	}
	item := decoded["items"].([]any)[0].(map[string]any)
	for _, key := range []string{"label", "renderer", "chips", "payload"} {
		if _, ok := item[key]; !ok {
			t.Fatalf("missing item key %q in %s", key, raw)
		}
	}
	for _, key := range []string{"schemaVersion", "runId", "messageId", "groups"} {
		if _, ok := decoded[key]; ok {
			t.Fatalf("unexpected old key %q in %s", key, raw)
		}
	}
}
