package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/session"
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

func TestHandleToolCallDoesNotEmitActivityTimeline(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	if err := os.WriteFile(filepath.Join(workspace, "note.txt"), []byte("hello\n"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	var frames []ActivityTimelineBlock
	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir: workspace,
		WorkingDir:   workspace,
		SessionMeta:  &session.Meta{CanRead: true, CanWrite: true, CanExecute: true},
		RunID:        "run_handler_activity_source",
		EndpointID:   "env_handler_activity_source",
		ThreadID:     "thread_handler_activity_source",
		MessageID:    "msg_handler_activity_source",
		OnStreamEvent: func(ev any) {
			bs, ok := ev.(streamEventBlockSet)
			if !ok {
				return
			}
			if block, ok := bs.Block.(ActivityTimelineBlock); ok {
				frames = append(frames, block)
			}
		},
	})
	r.permissionType = FlowerPermissionReadonly

	outcome, err := r.handleToolCall(context.Background(), "tool_read_file_1", "read_file", map[string]any{"path": "note.txt"})
	if err != nil {
		t.Fatalf("handleToolCall: %v", err)
	}
	if outcome == nil || !outcome.Success {
		t.Fatalf("outcome=%#v, want successful read_file", outcome)
	}
	if len(frames) != 0 {
		t.Fatalf("activity frames=%d, want handleToolCall to leave activity emission to Floret observations", len(frames))
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
	if presentation.Label != "pwd; sleep 5; ls -1" || presentation.Description != "" || presentation.Renderer != observation.ActivityRendererTerminal {
		t.Fatalf("presentation=%+v", presentation)
	}
	if presentation.Payload["command"] != "pwd; sleep 5; ls -1" {
		t.Fatalf("command payload=%v", presentation.Payload["command"])
	}
	if presentation.Payload["status"] != toolCallStatusRunning {
		t.Fatalf("status payload=%v", presentation.Payload["status"])
	}
	if presentation.Payload["yield_ms"] != int64(2000) {
		t.Fatalf("yield_ms payload=%v", presentation.Payload["yield_ms"])
	}
}

func TestToolStartActivityPresentationUsesToolNameWithoutCommand(t *testing.T) {
	t.Parallel()

	presentation := toolStartActivityPresentation("terminal.exec", map[string]any{})
	if presentation == nil {
		t.Fatal("presentation is nil")
	}
	if presentation.Label != "terminal.exec" || presentation.Description != "" || presentation.Renderer != observation.ActivityRendererTerminal {
		t.Fatalf("presentation=%+v", presentation)
	}
	if _, ok := presentation.Payload["command"]; ok {
		t.Fatalf("command payload=%v, want omitted for missing command", presentation.Payload["command"])
	}
	if presentation.Payload["status"] != toolCallStatusRunning {
		t.Fatalf("status payload=%v", presentation.Payload["status"])
	}
}

func TestToolStartActivityPresentationUsesFriendlyNonTerminalLabels(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		toolName  string
		args      map[string]any
		label     string
		renderer  observation.ActivityRenderer
		operation string
		rawLabel  bool
	}{
		{
			name:      "file read",
			toolName:  "file.read",
			args:      map[string]any{"file_path": "/workspace/app.ts"},
			label:     "app.ts",
			renderer:  observation.ActivityRendererFile,
			operation: "read",
		},
		{
			name:     "web search",
			toolName: "web.search",
			args:     map[string]any{"query": "latest release"},
			label:    "latest release",
			renderer: observation.ActivityRendererWebSearch,
		},
		{
			name:     "okf search query",
			toolName: "okf.search",
			args:     map[string]any{"query": "Workbench wheel ownership"},
			label:    "Workbench wheel ownership",
			renderer: observation.ActivityRendererStructured,
		},
		{
			name:     "okf search fallback",
			toolName: "okf.search",
			args:     map[string]any{},
			label:    aitools.MustPresentationSpec("okf.search").CallLabelFallback,
			renderer: observation.ActivityRendererStructured,
		},
		{
			name:     "todos",
			toolName: "write_todos",
			args:     map[string]any{},
			label:    "Update todos",
			renderer: observation.ActivityRendererTodos,
		},
		{
			name:     "skill",
			toolName: "use_skill",
			args:     map[string]any{"name": "frontend-design"},
			label:    "frontend-design",
			renderer: observation.ActivityRendererStructured,
		},
		{
			name:     "unknown",
			toolName: "custom.tool",
			args:     map[string]any{},
			label:    "custom.tool",
			renderer: observation.ActivityRendererStructured,
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
			if presentation.Payload["status"] != toolCallStatusRunning {
				t.Fatalf("status payload=%v", presentation.Payload["status"])
			}
			if tc.operation != "" && presentation.Payload["operation"] != tc.operation {
				t.Fatalf("operation payload=%v, want %q", presentation.Payload["operation"], tc.operation)
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
		"stdout":    "/workspace\n",
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

	r.recordToolResultActivity("tool_invalid", "terminal.exec", "", map[string]any{"stdout": "ok"}, nil, time.UnixMilli(1000))

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
			Label:           "sleep 10s",
			Renderer:        observation.ActivityRendererTerminal,
			Payload:         map[string]any{"command": "sleep 10s"},
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
		Label:           "sleep 10s",
		Renderer:        observation.ActivityRendererTerminal,
		Payload:         map[string]any{"command": "sleep 10s", "exit_code": 0, "duration_ms": int64(10_000)},
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

func TestRefreshActivityTimelineSidecarsUpdatesOnlyExistingActivityBlock(t *testing.T) {
	t.Parallel()

	var blockSets []streamEventBlockSet
	blockTimeline := observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		RunID:         "run_subagent_sidecar",
		ThreadID:      "thread_subagent_sidecar",
		TurnID:        "msg_subagent_sidecar",
		TraceID:       "run_subagent_sidecar",
		Summary: observation.ActivitySummary{
			Status:     observation.ActivityStatusRunning,
			Severity:   observation.ActivitySeverityNormal,
			TotalItems: 2,
			Counts:     observation.ActivityCounts{Running: 2},
		},
		Items: []observation.ActivityItem{
			{
				ItemID:   "tool:call_wait",
				ToolID:   "call_wait",
				ToolName: "subagents",
				Kind:     observation.ActivityKindTool,
				Status:   observation.ActivityStatusRunning,
				Severity: observation.ActivitySeverityNormal,
			},
			{
				ItemID:   "subagent:child-1",
				ToolID:   "child-1",
				ToolName: "subagents",
				Kind:     observation.ActivityKindTool,
				Status:   observation.ActivityStatusRunning,
				Severity: observation.ActivitySeverityNormal,
			},
		},
	}
	parentTimeline := blockTimeline
	parentTimeline.Items = []observation.ActivityItem{blockTimeline.Items[1]}
	r := &run{
		id:              "run_subagent_sidecar",
		threadID:        "thread_subagent_sidecar",
		messageID:       "msg_subagent_sidecar",
		assistantBlocks: []any{newActivityTimelineBlock(blockTimeline, nil)},
		onStreamEvent: func(ev any) {
			if bs, ok := ev.(streamEventBlockSet); ok {
				blockSets = append(blockSets, bs)
			}
		},
	}

	if !r.upsertActivityTimelineSubagentActions(map[string]FlowerActivitySubagentAction{
		"tool:call_wait": {Action: subagentActionWait, Items: []FlowerActivitySubagentActionItem{{
			ThreadID: "child-1",
		}}},
	}) {
		t.Fatalf("upsertActivityTimelineSubagentActions returned false for existing tool row")
	}
	updated := r.refreshActivityTimelineSidecars(parentTimeline, map[string]FlowerActivitySubagentAction{
		"subagent:child-1": {Action: subagentActionInspect, ThreadID: "child-1"},
		"subagent:child-2": {Action: subagentActionInspect, ThreadID: "child-2"},
	})

	if !updated {
		t.Fatalf("refreshActivityTimelineSidecars returned false")
	}
	if len(blockSets) != 2 {
		t.Fatalf("block-set events=%d, want tool upsert and parent refresh: %#v", len(blockSets), blockSets)
	}
	block, ok := r.assistantBlocks[0].(ActivityTimelineBlock)
	if !ok {
		t.Fatalf("assistantBlocks[0]=%T, want ActivityTimelineBlock", r.assistantBlocks[0])
	}
	if len(block.Items) != 2 || block.Items[0].ItemID != "tool:call_wait" || block.Items[1].ItemID != "subagent:child-1" {
		t.Fatalf("timeline items changed: %#v", block.Items)
	}
	if len(block.SubagentActions) != 2 ||
		block.SubagentActions["tool:call_wait"].Items[0].ThreadID != "child-1" ||
		block.SubagentActions["subagent:child-1"].ThreadID != "child-1" {
		t.Fatalf("subagent sidecars=%#v, want preserved tool sidecar plus parent sidecar", block.SubagentActions)
	}
	projected := r.flowerBlocksFromFloretThreadProjection(flruntime.ThreadTurnProjection{
		ThreadID: flruntime.ThreadID(blockTimeline.ThreadID),
		TurnID:   flruntime.TurnID(blockTimeline.TurnID),
		RunID:    flruntime.RunID(blockTimeline.RunID),
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: &blockTimeline,
		}},
	})
	projectedBlock, ok := projected[0].(ActivityTimelineBlock)
	if !ok {
		t.Fatalf("projected[0]=%T, want ActivityTimelineBlock", projected[0])
	}
	if len(projectedBlock.SubagentActions) != 2 ||
		projectedBlock.SubagentActions["tool:call_wait"].Items[0].ThreadID != "child-1" ||
		projectedBlock.SubagentActions["subagent:child-1"].ThreadID != "child-1" {
		t.Fatalf("projected subagent sidecars=%#v, want replayed tool and parent sidecar decoration", projectedBlock.SubagentActions)
	}

	emptyRun := &run{
		id:        "run_subagent_sidecar",
		threadID:  "thread_subagent_sidecar",
		messageID: "msg_subagent_sidecar",
		onStreamEvent: func(ev any) {
			if bs, ok := ev.(streamEventBlockSet); ok {
				blockSets = append(blockSets, bs)
			}
		},
	}
	if emptyRun.refreshActivityTimelineSidecars(parentTimeline, map[string]FlowerActivitySubagentAction{
		"subagent:child-1": {Action: subagentActionInspect, ThreadID: "child-1"},
	}) {
		t.Fatalf("sidecar refresh created a block without a matching Floret projection block")
	}
	if len(emptyRun.assistantBlocks) != 0 {
		t.Fatalf("emptyRun assistantBlocks=%#v, want no isolated sidecar block", emptyRun.assistantBlocks)
	}
}

func TestFlowerToolSubagentActivityActionsUseToolItemID(t *testing.T) {
	t.Parallel()

	actions := flowerToolSubagentActivityActions("call_spawn_1", subagentActionSpawn, map[string]any{
		"action":             subagentActionSpawn,
		"status":             "ok",
		"thread_id":          "child-1",
		"task_name":          "Frontend polish review",
		"task_description":   "Review Flower tool detail UI and propose concise fixes.",
		"agent_type":         "worker",
		"started_at_ms":      int64(1700000000100),
		"created_at_ms":      int64(1700000000100),
		"updated_at_ms":      int64(1700000000200),
		"delegation_runtime": "floret",
	})

	action, ok := actions["tool:call_spawn_1"]
	if !ok {
		t.Fatalf("tool sidecar actions=%#v, want key tool:call_spawn_1", actions)
	}
	if action.ThreadID != "child-1" {
		t.Fatalf("unexpected tool sidecar route target: %#v", action)
	}
	raw, err := json.Marshal(action)
	if err != nil {
		t.Fatalf("json.Marshal action: %v", err)
	}
	for _, forbidden := range []string{"task_name", "task_description", "agent_type", "status", "started_at_ms", "created_at_ms", "updated_at_ms"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("subagent routing sidecar leaked %q: %s", forbidden, raw)
		}
	}
	if _, ok := actions["call_spawn_1"]; ok {
		t.Fatalf("tool sidecar must be keyed by real activity item id, got raw call id key: %#v", actions)
	}
}

func TestFlowerWaitToolSidecarItemsFromTimelineFilterRequestedChildren(t *testing.T) {
	t.Parallel()

	timeline := observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		Items: []observation.ActivityItem{
			{
				ItemID:   "subagent:child-1",
				ToolName: "subagents",
				Payload: map[string]any{
					"thread_id":        "child-1",
					"task_name":        "Frontend polish review",
					"task_description": "Review Flower tool detail UI and propose concise fixes.",
					"host_profile_ref": "worker",
					"status":           "running",
					"started_at_ms":    int64(1700000000100),
				},
			},
			{
				ItemID:   "subagent:child-2",
				ToolName: "subagents",
				Payload: map[string]any{
					"thread_id":        "child-2",
					"task_name":        "Activity payload review",
					"task_description": "Check whether subagent payloads expose only user-facing fields.",
					"host_profile_ref": "reviewer",
					"status":           "running",
					"started_at_ms":    int64(1700000000200),
				},
			},
		},
	}

	items := flowerSubagentActionItemsFromTimeline(timeline, []flruntime.ThreadID{"child-2"})
	if len(items) != 1 {
		t.Fatalf("items=%#v, want only requested child-2", items)
	}
	if items[0].ThreadID != "child-2" ||
		items[0].SubagentID != "child-2" {
		t.Fatalf("unexpected wait sidecar item: %#v", items[0])
	}
	action := flowerSubagentActivityActionFromItems(subagentActionWait, "parent-thread", items)
	if action.Action != subagentActionWait || action.ParentThreadID != "parent-thread" || action.ThreadID != "child-2" {
		t.Fatalf("unexpected wait sidecar action: %#v", action)
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
					map[string]any{"kind": "file", "label": "package.json"},
				},
				"payload": map[string]any{"operation": "read", "display_name": "package.json"},
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
