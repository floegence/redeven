package ai

import (
	"strings"
	"testing"
	"time"
)

func TestAppendHistoryForRetry_FiltersInterimAssistantText(t *testing.T) {
	t.Parallel()

	base := []RunHistoryMsg{{Role: "user", Text: "existing"}}
	interim := "我先快速扫一遍项目结构和关键配置，然后给你结论。"
	out := appendHistoryForRetry(base, "继续", interim)
	if len(out) != 2 {
		t.Fatalf("history length=%d, want=2", len(out))
	}
	if got := strings.TrimSpace(out[len(out)-1].Role); got != "user" {
		t.Fatalf("last role=%q, want user", got)
	}

	finalText := "结论：这是一个 Go + TS 的多模块工程，核心入口在 backend 和 envapp。"
	out = appendHistoryForRetry(base, "继续", finalText)
	if len(out) != 3 {
		t.Fatalf("history length=%d, want=3", len(out))
	}
	if got := strings.TrimSpace(out[len(out)-1].Role); got != "assistant" {
		t.Fatalf("last role=%q, want assistant", got)
	}
}

func TestEmitLifecyclePhase_DedupesBurst(t *testing.T) {
	t.Parallel()

	events := make([]streamEventLifecyclePhase, 0, 4)
	r := &run{
		messageID:           "msg_test",
		lifecycleMinEmitGap: 200 * time.Millisecond,
		onStreamEvent: func(ev any) {
			phase, ok := ev.(streamEventLifecyclePhase)
			if !ok {
				t.Fatalf("unexpected event type: %T", ev)
			}
			events = append(events, phase)
		},
	}

	r.emitLifecyclePhase("tool_call", map[string]any{"tool_name": "fs.list_dir"})
	r.emitLifecyclePhase("executing_tools", map[string]any{"tool_name": "fs.read_file"})

	if len(events) != 1 {
		t.Fatalf("event count=%d, want=1", len(events))
	}
	if events[0].Phase != "executing_tools" {
		t.Fatalf("phase=%q, want=executing_tools", events[0].Phase)
	}

	time.Sleep(220 * time.Millisecond)
	r.emitLifecyclePhase("executing_tools", nil)
	if len(events) != 2 {
		t.Fatalf("event count=%d, want=2", len(events))
	}
}

func TestShouldCommitAttemptAssistantText(t *testing.T) {
	t.Parallel()

	summary := turnAttemptSummary{
		ToolCalls:      1,
		ToolSuccesses:  1,
		AssistantText:  "我先快速扫一遍项目结构和关键配置，然后给你结论。",
		OutcomeHasText: true,
	}
	if shouldCommitAttemptAssistantText(summary) {
		t.Fatalf("expected interim tool result text to be filtered")
	}

	summary.AssistantText = strings.Repeat("结论：项目采用 Go + TS；证据：已读取 README 与 backend 关键入口。", 4)
	if !shouldCommitAttemptAssistantText(summary) {
		t.Fatalf("expected substantive text to be committed")
	}
}
