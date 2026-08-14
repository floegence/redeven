package ai

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v4/observation"
	flruntime "github.com/floegence/floret/v4/runtime"
	fltools "github.com/floegence/floret/v4/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func TestDetachedRunIgnoresPresentationUpdates(t *testing.T) {
	t.Parallel()

	var events []any
	r := &run{
		id:                        "run_detached_presentation",
		threadID:                  "thread_detached_presentation",
		messageID:                 "msg_detached_presentation",
		currentThinkingBlockIndex: -1,
		onStreamEvent: func(ev any) {
			events = append(events, ev)
		},
	}

	r.markDetached()
	if err := r.appendTextDelta("late answer"); err != nil {
		t.Fatalf("appendTextDelta: %v", err)
	}
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolResult,
		ToolID:     "tool_late_terminal",
		ToolName:   "terminal.exec",
		ObservedAt: time.UnixMilli(1200),
	})
	r.applyFloretStreamObservation(&flruntime.StreamObservation{Type: flruntime.StreamObservationAssistantDelta, Text: "late floret"})

	if len(events) != 0 {
		t.Fatalf("stream events=%d, want none after detach", len(events))
	}
	raw, text, _, err := r.snapshotAssistantMessageJSONWithStatus("canceled")
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSONWithStatus: %v", err)
	}
	if text != "" {
		t.Fatalf("assistant text=%q, want empty canceled boundary", text)
	}
	var msg persistedMessage
	if err := json.Unmarshal([]byte(raw), &msg); err != nil {
		t.Fatalf("unmarshal snapshot: %v", err)
	}
	if msg.Status != "canceled" || len(msg.Blocks) != 0 {
		t.Fatalf("snapshot status=%q blocks=%d, want canceled empty boundary", msg.Status, len(msg.Blocks))
	}
}

func TestSnapshotAssistantMessagePreservesBlockIndexesForAnchors(t *testing.T) {
	t.Parallel()

	r := &run{
		id:                       "run_snapshot_anchor_indexes",
		threadID:                 "thread_snapshot_anchor_indexes",
		messageID:                "msg_snapshot_anchor_indexes",
		assistantCreatedAtUnixMs: 1700000000100,
		assistantBlocks: []any{
			&persistedMarkdownBlock{Type: "markdown", Content: "intro"},
			nil,
			&persistedMarkdownBlock{Type: "markdown", Content: ""},
			ActivityTimelineBlock{
				Type: activityTimelineBlockType,
				ActivityTimeline: observation.ActivityTimeline{
					SchemaVersion: observation.ActivityTimelineSchemaVersion,
					RunID:         "run_snapshot_anchor_indexes",
					ThreadID:      "thread_snapshot_anchor_indexes",
					TurnID:        "msg_snapshot_anchor_indexes",
					TraceID:       "run_snapshot_anchor_indexes",
					Summary: observation.ActivitySummary{
						Status:     observation.ActivityStatusSuccess,
						Severity:   observation.ActivitySeverityNormal,
						TotalItems: 1,
						Counts:     observation.ActivityCounts{Success: 1},
					},
					Items: []observation.ActivityItem{{
						ItemID:           "tool:anchor",
						ToolID:           "anchor",
						ToolName:         "terminal.exec",
						Kind:             observation.ActivityKindTool,
						Status:           observation.ActivityStatusSuccess,
						Severity:         observation.ActivitySeverityNormal,
						StartedAtUnixMS:  1700000000101,
						EndedAtUnixMS:    1700000000102,
						RequiresApproval: false,
					}},
				},
			},
		},
	}

	raw, text, _, err := r.snapshotAssistantMessageJSONWithStatus("canceled")
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSONWithStatus: %v", err)
	}
	if text != "intro" {
		t.Fatalf("assistant text=%q, want intro", text)
	}

	var msg persistedMessage
	if err := json.Unmarshal([]byte(raw), &msg); err != nil {
		t.Fatalf("unmarshal snapshot: %v", err)
	}
	if len(msg.Blocks) != 4 {
		t.Fatalf("snapshot blocks=%d, want original coordinate length 4: %#v", len(msg.Blocks), msg.Blocks)
	}
	for _, idx := range []int{1, 2} {
		block, ok := msg.Blocks[idx].(map[string]any)
		if !ok {
			t.Fatalf("block[%d]=%T %#v, want empty markdown placeholder", idx, msg.Blocks[idx], msg.Blocks[idx])
		}
		if block["type"] != "markdown" {
			t.Fatalf("block[%d].type=%v, want markdown", idx, block["type"])
		}
		if content, ok := block["content"].(string); !ok || content != "" {
			t.Fatalf("block[%d].content=%#v, want empty string", idx, block["content"])
		}
	}
	block, ok := msg.Blocks[3].(map[string]any)
	if !ok || block["type"] != activityTimelineBlockType {
		t.Fatalf("block[3]=%T %#v, want activity timeline", msg.Blocks[3], msg.Blocks[3])
	}
}

func TestToolStartActivityPresentationShowsRunningTerminalCommand(t *testing.T) {
	t.Parallel()

	presentation := toolStartActivityPresentation("terminal.exec", map[string]any{
		"command":  "pwd; sleep 5; ls -1",
		"yield_ms": int64(2000),
	})
	if presentation == nil {
		t.Fatal("presentation is nil")
	}
	if presentation.Label != "pwd; sleep 5; ls -1" || presentation.Description != "" || presentation.Renderer != fltools.ActivityRendererTerminal {
		t.Fatalf("presentation=%+v", presentation)
	}
	payload := activityPayloadMap(presentation.Payload)
	if payload["command"] != "pwd; sleep 5; ls -1" {
		t.Fatalf("command payload=%v", payload["command"])
	}
	if status, ok := payload["status"]; ok && status != toolCallStatusRunning {
		t.Fatalf("status payload=%v", payload["status"])
	}
	if _, ok := payload["yield_ms"]; ok {
		t.Fatalf("yield_ms payload=%v, want omitted from v3 terminal activity contract", payload["yield_ms"])
	}
}

func TestToolStartActivityPresentationUsesToolNameWithoutCommand(t *testing.T) {
	t.Parallel()

	presentation := toolStartActivityPresentation("terminal.exec", map[string]any{})
	if presentation == nil {
		t.Fatal("presentation is nil")
	}
	if presentation.Label != "terminal.exec" || presentation.Description != "" || presentation.Renderer != fltools.ActivityRendererTerminal {
		t.Fatalf("presentation=%+v", presentation)
	}
	payload := activityPayloadMap(presentation.Payload)
	if _, ok := payload["command"]; ok {
		t.Fatalf("command payload=%v, want omitted for missing command", payload["command"])
	}
	if payload["status"] != toolCallStatusRunning {
		t.Fatalf("status payload=%v", payload["status"])
	}
}

func TestToolStartActivityPresentationUsesFriendlyNonTerminalLabels(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		toolName  string
		args      map[string]any
		label     string
		renderer  fltools.ActivityRenderer
		operation string
		rawLabel  bool
	}{
		{
			name:      "file read",
			toolName:  "file.read",
			args:      map[string]any{"file_path": "/workspace/app.ts"},
			label:     "app.ts",
			renderer:  fltools.ActivityRendererFile,
			operation: "read",
		},
		{
			name:     "web search",
			toolName: "web.search",
			args:     map[string]any{"query": "latest release"},
			label:    "latest release",
			renderer: fltools.ActivityRendererWebSearch,
		},
		{
			name:     "okf search query",
			toolName: "okf.search",
			args:     map[string]any{"query": "Workbench wheel ownership"},
			label:    "Workbench wheel ownership",
			renderer: fltools.ActivityRendererStructured,
		},
		{
			name:     "okf search fallback",
			toolName: "okf.search",
			args:     map[string]any{},
			label:    aitools.MustPresentationSpec("okf.search").CallLabelFallback,
			renderer: fltools.ActivityRendererStructured,
		},
		{
			name:     "todos",
			toolName: "write_todos",
			args:     map[string]any{},
			label:    "Update todos",
			renderer: fltools.ActivityRendererTodos,
		},
		{
			name:     "skill",
			toolName: "use_skill",
			args:     map[string]any{"name": "frontend-design"},
			label:    "frontend-design",
			renderer: fltools.ActivityRendererStructured,
		},
		{
			name:     "unknown",
			toolName: "custom.tool",
			args:     map[string]any{},
			label:    "custom.tool",
			renderer: fltools.ActivityRendererStructured,
			rawLabel: true,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			presentation := toolStartActivityPresentation(tc.toolName, tc.args)
			if presentation == nil {
				t.Fatal("presentation is nil")
			}
			if presentation.Label != tc.label || presentation.Description != "" || presentation.Renderer != tc.renderer {
				t.Fatalf("presentation=%+v", presentation)
			}
			if status, ok := fltools.ActivityStatus(presentation); ok && status != toolCallStatusRunning {
				t.Fatalf("status=%q, want %q", status, toolCallStatusRunning)
			}
			if tc.operation != "" {
				operation := ""
				switch payload := presentation.Payload.(type) {
				case fltools.StructuredActivityPayload:
					operation = payload.Operation
				case fltools.FileActivityPayload:
					operation = payload.Operation
				case fltools.TodosActivityPayload:
					operation = payload.Operation
				}
				if operation != tc.operation {
					t.Fatalf("operation=%q, want %q", operation, tc.operation)
				}
			}
			if !tc.rawLabel && presentation.Label == tc.toolName {
				t.Fatalf("label=%q, want friendly label", presentation.Label)
			}
		})
	}
}

func TestToolStartActivityPresentationTrimsLabelToContract(t *testing.T) {
	t.Parallel()

	command := "printf " + strings.Repeat("x", 260)
	presentation := toolStartActivityPresentation("terminal.exec", map[string]any{
		"command": command,
	})
	if presentation == nil {
		t.Fatal("presentation is nil")
	}
	if len([]rune(presentation.Label)) > activityPresentationLabelLimit {
		t.Fatalf("label length=%d, want <= %d", len([]rune(presentation.Label)), activityPresentationLabelLimit)
	}
	if !strings.HasSuffix(presentation.Label, "...") {
		t.Fatalf("label=%q, want truncated suffix", presentation.Label)
	}
	timeline := observation.BuildActivityTimeline(observation.ActivityRunMeta{RunID: "run_start_label"}, []observation.Event{{
		Type:     observation.EventTypeToolCall,
		ToolID:   "tool_start_label",
		ToolName: "terminal.exec",
		Activity: presentation,
	}}, 1000)
	if err := observation.ValidateActivityTimeline(timeline); err != nil {
		t.Fatalf("ValidateActivityTimeline: %v", err)
	}
}

func TestObservationActivityEventsDoNotPublishFlowerTimelineBlocks(t *testing.T) {
	t.Parallel()

	var blockSets []streamEventBlockSet
	r := &run{
		id:             "run_observation_boundary",
		threadID:       "thread_observation_boundary",
		messageID:      "msg_observation_boundary",
		nextBlockIndex: 0,
		onStreamEvent: func(ev any) {
			if bs, ok := ev.(streamEventBlockSet); ok {
				blockSets = append(blockSets, bs)
			}
		},
	}

	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolCall,
		ToolID:     "tool_running_terminal",
		ToolName:   "terminal.exec",
		ToolKind:   "local",
		Activity:   toolStartActivityPresentation("terminal.exec", map[string]any{"command": "pwd"}),
		ObservedAt: time.UnixMilli(1000),
	})
	r.recordToolResultActivity("tool_running_terminal", "terminal.exec", toolResultStatusSuccess, map[string]any{
		"command":   "pwd",
		"exit_code": 0,
		"output":    "/workspace\n",
	}, nil, time.UnixMilli(1010))

	if len(blockSets) != 0 {
		t.Fatalf("block-set events=%d, want no Flower timeline blocks from raw observation events: %#v", len(blockSets), blockSets)
	}
	if len(r.assistantBlocks) != 0 {
		t.Fatalf("assistantBlocks=%#v, want Floret projection to be the only Flower activity source", r.assistantBlocks)
	}
}

func TestRecordToolResultActivityRejectsMissingStatus(t *testing.T) {
	t.Parallel()

	var frames []ActivityTimelineBlock
	r := &run{
		id:             "run_invalid_status",
		threadID:       "thread_invalid_status",
		messageID:      "msg_invalid_status",
		nextBlockIndex: 0,
		onStreamEvent: func(ev any) {
			if bs, ok := ev.(streamEventBlockSet); ok {
				if block, ok := bs.Block.(ActivityTimelineBlock); ok {
					frames = append(frames, block)
				}
			}
		},
	}

	r.recordToolResultActivity("tool_invalid", "terminal.exec", "", map[string]any{"output": "ok"}, nil, time.UnixMilli(1000))

	if len(frames) != 0 {
		t.Fatalf("timeline frames=%d, want none for invalid status", len(frames))
	}
}

func TestRecordObservationActivityEventSkipsEmptyTimeline(t *testing.T) {
	t.Parallel()

	streamFrames := 0
	r := &run{
		id:             "run_empty",
		threadID:       "thread_empty",
		messageID:      "msg_empty",
		nextBlockIndex: 0,
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
	if r.nextBlockIndex != 0 {
		t.Fatalf("nextBlockIndex=%d, want untouched", r.nextBlockIndex)
	}
}

func TestRecordFloretActivityEventWithoutTimelineDoesNotPublishFlowerTimelineBlocks(t *testing.T) {
	t.Parallel()

	var blockSets []streamEventBlockSet
	r := &run{
		id:             "run_floret_activity_boundary",
		threadID:       "thread_floret_activity_boundary",
		messageID:      "msg_floret_activity_boundary",
		nextBlockIndex: 0,
		onStreamEvent: func(ev any) {
			if bs, ok := ev.(streamEventBlockSet); ok {
				blockSets = append(blockSets, bs)
			}
		},
	}

	r.recordFloretActivityEvent(flruntime.Event{
		Type:      observation.EventTypeRunEnd,
		Message:   string(observation.ActivityStatusSuccess),
		Timestamp: time.UnixMilli(1300),
	})

	if len(blockSets) != 0 {
		t.Fatalf("block-set events=%d, want Floret projection to be the only Flower activity source: %#v", len(blockSets), blockSets)
	}
	if len(r.assistantBlocks) != 0 {
		t.Fatalf("assistantBlocks=%#v, want no local timeline projection", r.assistantBlocks)
	}
}

func TestRecordFloretActivityEventDoesNotPublishAggregateTimelineBlocks(t *testing.T) {
	t.Parallel()

	var blockSets []streamEventBlockSet
	r := &run{
		id:             "run_floret_activity_projection",
		threadID:       "thread_floret_activity_projection",
		messageID:      "msg_floret_activity_projection",
		nextBlockIndex: 0,
		onStreamEvent: func(ev any) {
			if bs, ok := ev.(streamEventBlockSet); ok {
				blockSets = append(blockSets, bs)
			}
		},
	}
	running := observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		RunID:         "run_floret_activity_projection",
		ThreadID:      "thread_floret_activity_projection",
		TurnID:        "msg_floret_activity_projection",
		Summary: observation.ActivitySummary{
			Status:     observation.ActivityStatusRunning,
			Severity:   observation.ActivitySeverityNormal,
			TotalItems: 1,
			Counts:     observation.ActivityCounts{Running: 1},
		},
		Items: []observation.ActivityItem{{
			ItemID:          "tool:exec-1",
			ToolID:          "exec-1",
			ToolName:        "terminal.exec",
			Kind:            observation.ActivityKindTool,
			Status:          observation.ActivityStatusRunning,
			Severity:        observation.ActivitySeverityNormal,
			StartedAtUnixMS: 1_700_000_000_000,
			Presentation: &fltools.ActivityPresentation{
				Label:    "sleep 10s",
				Renderer: fltools.ActivityRendererTerminal,
				Payload:  fltools.TerminalActivityPayload{Command: "sleep 10s"},
			},
		}},
	}
	r.recordFloretActivityEvent(flruntime.Event{
		Type:             observation.EventTypeToolCall,
		ActivityTimeline: &running,
		Timestamp:        time.UnixMilli(1_700_000_000_000),
	})

	success := running
	success.Summary.Status = observation.ActivityStatusSuccess
	success.Summary.Counts = observation.ActivityCounts{Success: 1}
	success.Items = []observation.ActivityItem{{
		ItemID:          "tool:exec-1",
		ToolID:          "exec-1",
		ToolName:        "terminal.exec",
		Kind:            observation.ActivityKindTool,
		Status:          observation.ActivityStatusSuccess,
		Severity:        observation.ActivitySeverityNormal,
		StartedAtUnixMS: 1_700_000_000_000,
		EndedAtUnixMS:   1_700_000_010_000,
		Presentation: &fltools.ActivityPresentation{
			Label:    "sleep 10s",
			Renderer: fltools.ActivityRendererTerminal,
			Payload:  activityPayloadForRenderer(fltools.ActivityRendererTerminal, map[string]any{"command": "sleep 10s", "exit_code": 0, "duration_ms": int64(10_000)}),
		},
	}}
	r.recordFloretActivityEvent(flruntime.Event{
		Type:             observation.EventTypeToolResult,
		ActivityTimeline: &success,
		Timestamp:        time.UnixMilli(1_700_000_010_000),
	})
	if len(blockSets) != 0 {
		t.Fatalf("block-set events=%d, want live ThreadTurnProjection to be the only main activity block source: %#v", len(blockSets), blockSets)
	}
	if len(r.assistantBlocks) != 0 {
		t.Fatalf("assistantBlocks=%#v, want no aggregate timeline projection", r.assistantBlocks)
	}
}

func TestRecordFloretActivityEventDoesNotAppendAggregateTimelineAfterText(t *testing.T) {
	t.Parallel()

	var blockSets []streamEventBlockSet
	r := &run{
		id:             "run_no_duplicate_tail",
		threadID:       "thread_no_duplicate_tail",
		messageID:      "msg_no_duplicate_tail",
		nextBlockIndex: 2,
		assistantBlocks: []any{
			newActivityTimelineBlock(observation.ActivityTimeline{
				SchemaVersion: observation.ActivityTimelineSchemaVersion,
				RunID:         "run_no_duplicate_tail",
				ThreadID:      "thread_no_duplicate_tail",
				TurnID:        "msg_no_duplicate_tail",
				TraceID:       "run_no_duplicate_tail",
				Summary: observation.ActivitySummary{
					Status:     observation.ActivityStatusRunning,
					Severity:   observation.ActivitySeverityNormal,
					TotalItems: 1,
					Counts:     observation.ActivityCounts{Running: 1},
				},
				Items: []observation.ActivityItem{{
					ItemID:   "tool:exec-1",
					ToolID:   "exec-1",
					ToolName: "terminal.exec",
					Kind:     observation.ActivityKindTool,
					Status:   observation.ActivityStatusRunning,
					Severity: observation.ActivitySeverityNormal,
				}},
			}, nil),
			&persistedMarkdownBlock{Type: "markdown", Content: "answer after tool"},
		},
		onStreamEvent: func(ev any) {
			if bs, ok := ev.(streamEventBlockSet); ok {
				blockSets = append(blockSets, bs)
			}
		},
	}
	success := r.assistantBlocks[0].(ActivityTimelineBlock).ActivityTimeline
	success.Summary.Status = observation.ActivityStatusSuccess
	success.Summary.Counts = observation.ActivityCounts{Success: 1}
	success.Items[0].Status = observation.ActivityStatusSuccess

	r.recordFloretActivityEvent(flruntime.Event{
		Type:             observation.EventTypeToolResult,
		ActivityTimeline: &success,
		Timestamp:        time.UnixMilli(2_000),
	})

	if len(blockSets) != 0 {
		t.Fatalf("block-set events=%d, want aggregate timeline not to append duplicate tail: %#v", len(blockSets), blockSets)
	}
	if len(r.assistantBlocks) != 2 {
		t.Fatalf("assistantBlocks len=%d, want unchanged canonical blocks: %#v", len(r.assistantBlocks), r.assistantBlocks)
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
				"presentation": map[string]any{
					"label":    "package.json",
					"renderer": "file",
					"chips": []any{
						map[string]any{"kind": "lines", "label": "lines", "value": "42", "tone": "neutral"},
					},
					"target_refs": []any{
						map[string]any{"kind": "file", "label": "package.json"},
					},
					"payload": map[string]any{"path": "package.json", "operation": "read"},
				},
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
	if timeline.RunID != "run_1" || timeline.Items[0].ToolName != "file.read" || timeline.Items[0].Presentation == nil || timeline.Items[0].Presentation.Renderer != fltools.ActivityRendererFile {
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
			Presentation: &fltools.ActivityPresentation{
				Label:    "npm test",
				Renderer: fltools.ActivityRendererTerminal,
				Chips:    []fltools.ActivityChip{{Kind: "exit_code", Label: "exit", Value: "0", Tone: "neutral"}},
				Payload:  activityPayloadForRenderer(fltools.ActivityRendererTerminal, map[string]any{"command": "npm test", "exit_code": 0}),
			},
		}},
	}, map[string]FlowerActivityFileAction{
		"file_action_json": {
			ActionID:      "file_action_json",
			DisplayName:   "package.json",
			PreviewPath:   "/workspace/package.json",
			DirectoryPath: "/workspace",
		},
	})

	raw, err := json.Marshal(block)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	for _, key := range []string{"schema_version", "summary", "items", "file_actions"} {
		if _, ok := decoded[key]; !ok {
			t.Fatalf("missing key %q in %s", key, raw)
		}
	}
	for _, key := range []string{"run_id", "thread_id", "turn_id", "trace_id"} {
		if _, ok := decoded[key]; ok {
			t.Fatalf("unexpected private identity key %q in %s", key, raw)
		}
	}
	for _, value := range []string{"run_json", "thread_json", "msg_json", "trace_json"} {
		if strings.Contains(string(raw), value) {
			t.Fatalf("public activity block leaked private identity %q in %s", value, raw)
		}
	}
	fileActions := decoded["file_actions"].(map[string]any)
	action := fileActions["file_action_json"].(map[string]any)
	for _, key := range []string{"action_id", "display_name", "preview_path", "directory_path"} {
		if _, ok := action[key]; !ok {
			t.Fatalf("missing file action key %q in %s", key, raw)
		}
	}
	item := decoded["items"].([]any)[0].(map[string]any)
	presentation := item["presentation"].(map[string]any)
	for _, key := range []string{"label", "renderer", "chips", "payload"} {
		if _, ok := presentation[key]; !ok {
			t.Fatalf("missing item key %q in %s", key, raw)
		}
	}
	for _, key := range []string{"schemaVersion", "runId", "messageId", "groups"} {
		if _, ok := decoded[key]; ok {
			t.Fatalf("unexpected old key %q in %s", key, raw)
		}
	}
}
