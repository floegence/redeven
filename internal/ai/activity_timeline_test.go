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
		id:             "run_activity",
		threadID:       "thread_activity",
		messageID:      "msg_activity",
		activityEvents: make([]observation.Event, 0, 4),
		nextBlockIndex: 0,
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
	if timeline.RunID != "run_1" || timeline.Items[0].ToolName != "file.read" {
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
	for _, key := range []string{"schemaVersion", "runId", "messageId", "groups"} {
		if _, ok := decoded[key]; ok {
			t.Fatalf("unexpected old key %q in %s", key, raw)
		}
	}
}
