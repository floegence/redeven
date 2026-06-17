package ai

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	aitools "github.com/floegence/redeven/internal/ai/tools"
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

func TestToolStartActivityPresentationShowsRunningTerminalCommand(t *testing.T) {
	t.Parallel()

	presentation := toolStartActivityPresentation("terminal.exec", map[string]any{
		"command": "pwd; sleep 5; ls -1",
	}, terminalExecTimeoutDecision{
		RequestedMS: 2000,
		EffectiveMS: 5000,
		Source:      "max",
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
	if presentation.Payload["timeout_ms"] != int64(5000) {
		t.Fatalf("timeout_ms payload=%v", presentation.Payload["timeout_ms"])
	}
	if presentation.Payload["requested_timeout_ms"] != int64(2000) {
		t.Fatalf("requested_timeout_ms payload=%v", presentation.Payload["requested_timeout_ms"])
	}
	if presentation.Payload["timeout_source"] != "max" {
		t.Fatalf("timeout_source payload=%v", presentation.Payload["timeout_source"])
	}
}

func TestToolStartActivityPresentationUsesNeutralLabelWithoutCommand(t *testing.T) {
	t.Parallel()

	presentation := toolStartActivityPresentation("terminal.exec", map[string]any{}, terminalExecTimeoutDecision{})
	if presentation == nil {
		t.Fatal("presentation is nil")
	}
	if presentation.Label != "Activity" || presentation.Description != "" || presentation.Renderer != observation.ActivityRendererTerminal {
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
			label:    okfKnowledgeActivityLabel,
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
			label:    "Activity",
			renderer: observation.ActivityRendererStructured,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			presentation := toolStartActivityPresentation(tc.toolName, tc.args, terminalExecTimeoutDecision{})
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
			if presentation.Label == tc.toolName {
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
	}, terminalExecTimeoutDecision{})
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

func TestRecordObservationActivityEventPublishesRunningToolFirstFrame(t *testing.T) {
	t.Parallel()

	var frames []ActivityTimelineBlock
	r := &run{
		id:                        "run_running",
		threadID:                  "thread_running",
		messageID:                 "msg_running",
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

	activity := toolStartActivityPresentation("terminal.exec", map[string]any{
		"command": "pwd; sleep 5; ls -1",
	}, terminalExecTimeoutDecision{
		EffectiveMS: 5000,
		Source:      "configured",
	})
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolCall,
		ToolID:     "tool_running_terminal",
		ToolName:   "terminal.exec",
		ToolKind:   "local",
		Activity:   activity,
		ObservedAt: time.UnixMilli(1000),
	})

	if len(frames) != 1 {
		t.Fatalf("timeline frames=%d, want 1", len(frames))
	}
	latest := frames[0]
	if latest.Summary.TotalItems != 1 || latest.Summary.Status != observation.ActivityStatusRunning {
		t.Fatalf("summary=%+v, want running one-item timeline", latest.Summary)
	}
	item := latest.Items[0]
	if item.ToolID != "tool_running_terminal" || item.ToolName != "terminal.exec" || item.Status != observation.ActivityStatusRunning {
		t.Fatalf("item=%+v, want running terminal item", item)
	}
	if item.Label != "pwd; sleep 5; ls -1" || item.Renderer != observation.ActivityRendererTerminal {
		t.Fatalf("item presentation label=%q renderer=%q", item.Label, item.Renderer)
	}
	if item.Payload["command"] != "pwd; sleep 5; ls -1" || item.Payload["status"] != toolCallStatusRunning {
		t.Fatalf("item payload=%+v", item.Payload)
	}
	if item.StartedAtUnixMS != 1000 || item.EndedAtUnixMS != 0 {
		t.Fatalf("item timing=%+v, want open running item", item)
	}
}

func TestRecordToolResultActivityClosesRunningTerminalItem(t *testing.T) {
	t.Parallel()

	var frames []ActivityTimelineBlock
	r := &run{
		id:                        "run_terminal_result",
		threadID:                  "thread_terminal_result",
		messageID:                 "msg_terminal_result",
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

	activity := toolStartActivityPresentation("terminal.exec", map[string]any{
		"command": "printf start; sleep 5; printf end",
	}, terminalExecTimeoutDecision{EffectiveMS: 6000})
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolCall,
		ToolID:     "tool_terminal_result",
		ToolName:   "terminal.exec",
		ToolKind:   "local",
		Activity:   activity,
		ObservedAt: time.UnixMilli(1000),
	})
	r.recordToolResultActivity("tool_terminal_result", "terminal.exec", toolResultStatusSuccess, map[string]any{
		"command":     "printf start; sleep 5; printf end",
		"stdout":      "startend",
		"exit_code":   0,
		"duration_ms": int64(5000),
	}, nil, time.UnixMilli(6000))

	if len(frames) != 2 {
		t.Fatalf("timeline frames=%d, want 2", len(frames))
	}
	latest := frames[len(frames)-1]
	if latest.Summary.TotalItems != 1 || latest.Summary.Status != observation.ActivityStatusSuccess {
		t.Fatalf("summary=%+v, want successful one-item timeline", latest.Summary)
	}
	item := latest.Items[0]
	if item.ToolID != "tool_terminal_result" || item.ToolName != "terminal.exec" || item.Status != observation.ActivityStatusSuccess {
		t.Fatalf("item=%+v, want successful terminal item", item)
	}
	if item.Renderer != observation.ActivityRendererTerminal || item.Payload["stdout"] != "startend" || item.Payload["exit_code"] != 0 {
		t.Fatalf("item renderer=%q payload=%+v", item.Renderer, item.Payload)
	}
	if item.StartedAtUnixMS != 1000 || item.EndedAtUnixMS != 6000 {
		t.Fatalf("item timing=%+v, want closed terminal item", item)
	}
}

func TestRecordToolResultActivityClosesRunningTerminalItemOnTimeout(t *testing.T) {
	t.Parallel()

	var frames []ActivityTimelineBlock
	r := &run{
		id:                        "run_terminal_timeout",
		threadID:                  "thread_terminal_timeout",
		messageID:                 "msg_terminal_timeout",
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

	activity := toolStartActivityPresentation("terminal.exec", map[string]any{
		"command": "curl -sL https://example.test/slow",
	}, terminalExecTimeoutDecision{EffectiveMS: 30000})
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolCall,
		ToolID:     "tool_terminal_timeout",
		ToolName:   "terminal.exec",
		ToolKind:   "local",
		Activity:   activity,
		ObservedAt: time.UnixMilli(1000),
	})
	r.recordToolResultActivity("tool_terminal_timeout", "terminal.exec", toolResultStatusTimeout, map[string]any{
		"command":     "curl -sL https://example.test/slow",
		"exit_code":   124,
		"duration_ms": int64(30000),
		"timed_out":   true,
	}, &aitools.ToolError{
		Code:      aitools.ErrorCodeTimeout,
		Message:   "Tool execution timed out after 30000 ms",
		Retryable: true,
	}, time.UnixMilli(31000))

	if len(frames) != 2 {
		t.Fatalf("timeline frames=%d, want 2", len(frames))
	}
	latest := frames[len(frames)-1]
	if err := observation.ValidateActivityTimeline(latest.ActivityTimeline); err != nil {
		t.Fatalf("ValidateActivityTimeline: %v", err)
	}
	if latest.Summary.TotalItems != 1 || latest.Summary.Status != observation.ActivityStatusError {
		t.Fatalf("summary=%+v, want error one-item timeline", latest.Summary)
	}
	item := latest.Items[0]
	if item.ToolID != "tool_terminal_timeout" || item.ToolName != "terminal.exec" || item.Status != observation.ActivityStatusError {
		t.Fatalf("item=%+v, want error terminal item", item)
	}
	if item.EndedAtUnixMS != 31000 {
		t.Fatalf("item timing=%+v, want timeout result to close item", item)
	}
	errorPayload, ok := item.Payload["error"].(map[string]any)
	if !ok {
		t.Fatalf("error payload=%#v, want map", item.Payload["error"])
	}
	if errorPayload["code"] != "TIMEOUT" || errorPayload["retryable"] != true {
		t.Fatalf("error payload=%#v", errorPayload)
	}
}

func TestRecordToolResultActivityClosesRunningItemOnGenericError(t *testing.T) {
	t.Parallel()

	var frames []ActivityTimelineBlock
	r := &run{
		id:                        "run_terminal_error",
		threadID:                  "thread_terminal_error",
		messageID:                 "msg_terminal_error",
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
		ToolID:     "tool_terminal_error",
		ToolName:   "terminal.exec",
		ToolKind:   "local",
		Activity:   toolStartActivityPresentation("terminal.exec", map[string]any{"command": "cat /root/secret"}, terminalExecTimeoutDecision{}),
		ObservedAt: time.UnixMilli(1000),
	})
	r.recordToolResultActivity("tool_terminal_error", "terminal.exec", toolResultStatusError, map[string]any{
		"command":     "cat /root/secret",
		"exit_code":   1,
		"duration_ms": int64(12),
		"stderr":      "permission denied",
	}, &aitools.ToolError{
		Code:      aitools.ErrorCodePermissionDenied,
		Message:   "permission denied",
		Retryable: false,
	}, time.UnixMilli(1012))

	if len(frames) != 2 {
		t.Fatalf("timeline frames=%d, want 2", len(frames))
	}
	latest := frames[len(frames)-1]
	if err := observation.ValidateActivityTimeline(latest.ActivityTimeline); err != nil {
		t.Fatalf("ValidateActivityTimeline: %v", err)
	}
	if latest.Summary.TotalItems != 1 || latest.Summary.Status != observation.ActivityStatusError {
		t.Fatalf("summary=%+v, want error one-item timeline", latest.Summary)
	}
	item := latest.Items[0]
	if item.ToolID != "tool_terminal_error" || item.Status != observation.ActivityStatusError || item.EndedAtUnixMS != 1012 {
		t.Fatalf("item=%+v, want closed error item", item)
	}
	errorPayload, ok := item.Payload["error"].(map[string]any)
	if !ok {
		t.Fatalf("error payload=%#v, want map", item.Payload["error"])
	}
	if errorPayload["code"] != "PERMISSION_DENIED" || errorPayload["message"] != "permission denied" || errorPayload["retryable"] != false {
		t.Fatalf("error payload=%#v", errorPayload)
	}
}

func TestRecordToolResultActivityRejectsMissingStatus(t *testing.T) {
	t.Parallel()

	var frames []ActivityTimelineBlock
	r := &run{
		id:                        "run_invalid_status",
		threadID:                  "thread_invalid_status",
		messageID:                 "msg_invalid_status",
		activitySegmentBlockIndex: -1,
		activitySegmentEvents:     make([]observation.Event, 0, 2),
		nextBlockIndex:            0,
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

func TestRecordFloretActivityEventDoesNotCloseRunningToolOnRunEnd(t *testing.T) {
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
	r.recordFloretActivityEvent(flruntime.Event{
		Type:      observation.EventTypeRunEnd,
		Message:   string(observation.ActivityStatusSuccess),
		Timestamp: time.UnixMilli(1300),
	})

	if len(frames) != 1 {
		t.Fatalf("timeline frames=%d, want only explicit tool call frame", len(frames))
	}
	latest := frames[len(frames)-1]
	if latest.Summary.TotalItems != 1 || latest.Summary.Status != observation.ActivityStatusRunning {
		t.Fatalf("summary=%+v, want running one-item timeline", latest.Summary)
	}
	item := latest.Items[0]
	if item.ToolID != "tool_running" || item.Status != observation.ActivityStatusRunning {
		t.Fatalf("item=%+v, want item to remain open without tool result", item)
	}
	if item.StartedAtUnixMS != 1000 || item.EndedAtUnixMS != 0 {
		t.Fatalf("item timing=%+v, want no synthetic run_end close", item)
	}
	if len(r.assistantBlocks) != 1 {
		t.Fatalf("assistantBlocks len=%d, want one activity block", len(r.assistantBlocks))
	}
}

func TestPublishFinalActivityTimelineDropsSyntheticRunEndSuccessToolItem(t *testing.T) {
	t.Parallel()

	r := &run{
		id:                        "run_final_synthetic",
		threadID:                  "thread_final_synthetic",
		messageID:                 "msg_final_synthetic",
		activitySegmentBlockIndex: -1,
		nextBlockIndex:            0,
	}
	r.publishFinalActivityTimeline(observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		RunID:         "run_final_synthetic",
		ThreadID:      "thread_final_synthetic",
		TurnID:        "msg_final_synthetic",
		TraceID:       "run_final_synthetic",
		Summary: observation.ActivitySummary{
			Status:     observation.ActivityStatusSuccess,
			Severity:   observation.ActivitySeverityNormal,
			TotalItems: 1,
			Counts:     observation.ActivityCounts{Success: 1},
		},
		Items: []observation.ActivityItem{{
			ItemID:          "tool:tool_running",
			ToolID:          "tool_running",
			ToolName:        "terminal.exec",
			Kind:            observation.ActivityKindTool,
			Status:          observation.ActivityStatusSuccess,
			Severity:        observation.ActivitySeverityNormal,
			NeedsAttention:  false,
			StartedAtUnixMS: 1000,
			EndedAtUnixMS:   1300,
			Payload:         map[string]any{"command": "sleep 30", "status": toolCallStatusRunning},
		}},
	})

	if len(r.assistantBlocks) != 0 {
		t.Fatalf("assistantBlocks=%#v, want no final synthetic tool block", r.assistantBlocks)
	}
}

func TestPublishFinalActivityTimelineKeepsExplicitSuccessfulToolResult(t *testing.T) {
	t.Parallel()

	r := &run{
		id:                        "run_final_result",
		threadID:                  "thread_final_result",
		messageID:                 "msg_final_result",
		activitySegmentBlockIndex: -1,
		nextBlockIndex:            0,
	}
	r.publishFinalActivityTimeline(observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		RunID:         "run_final_result",
		ThreadID:      "thread_final_result",
		TurnID:        "msg_final_result",
		TraceID:       "run_final_result",
		Summary: observation.ActivitySummary{
			Status:     observation.ActivityStatusSuccess,
			Severity:   observation.ActivitySeverityNormal,
			TotalItems: 1,
			Counts:     observation.ActivityCounts{Success: 1},
		},
		Items: []observation.ActivityItem{{
			ItemID:          "tool:tool_success",
			ToolID:          "tool_success",
			ToolName:        "terminal.exec",
			Kind:            observation.ActivityKindTool,
			Status:          observation.ActivityStatusSuccess,
			Severity:        observation.ActivitySeverityNormal,
			NeedsAttention:  false,
			StartedAtUnixMS: 1000,
			EndedAtUnixMS:   1300,
			Payload:         map[string]any{"command": "pwd", "status": toolResultStatusSuccess, "exit_code": 0},
		}},
	})

	if len(r.assistantBlocks) != 1 {
		t.Fatalf("assistantBlocks=%#v, want explicit successful tool result block", r.assistantBlocks)
	}
	block, ok := r.assistantBlocks[0].(ActivityTimelineBlock)
	if !ok || len(block.Items) != 1 || block.Items[0].Payload["status"] != toolResultStatusSuccess {
		t.Fatalf("activity block=%T %#v", r.assistantBlocks[0], r.assistantBlocks[0])
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
	for _, key := range []string{"schema_version", "run_id", "thread_id", "turn_id", "trace_id", "summary", "items", "file_actions"} {
		if _, ok := decoded[key]; !ok {
			t.Fatalf("missing key %q in %s", key, raw)
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
