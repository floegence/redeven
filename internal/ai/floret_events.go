package ai

import (
	"strings"

	flevent "github.com/floegence/floret/event"
)

type floretEventSink struct {
	run *run
}

func (s floretEventSink) Emit(ev flevent.Event) {
	r := s.run
	if r == nil {
		return
	}
	switch ev.Type {
	case flevent.ProviderDelta:
		if ev.Message != "" {
			_ = r.appendTextDelta(ev.Message)
		}
	case flevent.ProviderReasoning:
		if ev.Message != "" {
			r.touchActivity()
			_ = r.appendThinkingDelta(ev.Message)
			r.persistRunEvent("thinking.delta", RealtimeStreamKindLifecycle, map[string]any{
				"delta": truncateRunes(ev.Message, 2000),
			})
		}
	case flevent.ProviderRequest:
		r.persistRunEvent("floret.provider.request", RealtimeStreamKindLifecycle, map[string]any{
			"step_index": ev.Step,
			"provider":   strings.TrimSpace(ev.Provider),
			"model":      strings.TrimSpace(ev.Model),
			"metadata":   ev.Metadata,
		})
	case flevent.ProviderFinish:
		r.persistRunEvent("floret.provider.finish", RealtimeStreamKindLifecycle, map[string]any{
			"step_index":      ev.Step,
			"finish_reason":   strings.TrimSpace(ev.FinishReason),
			"raw_finish":      strings.TrimSpace(ev.RawFinishReason),
			"finish_inferred": ev.FinishInferred,
		})
	case flevent.ProviderRetry:
		r.persistRunEvent("floret.provider.retry", RealtimeStreamKindLifecycle, map[string]any{
			"step_index": ev.Step,
			"message":    strings.TrimSpace(ev.Message),
		})
	case flevent.ContextCompact:
		payload := map[string]any{
			"step_index": ev.Step,
			"message":    strings.TrimSpace(ev.Message),
			"metadata":   ev.Metadata,
			"metrics":    ev.Metrics,
		}
		if strings.TrimSpace(ev.Err) != "" {
			payload["error"] = strings.TrimSpace(ev.Err)
		}
		if strings.TrimSpace(ev.Result) != "" {
			payload["result"] = strings.TrimSpace(ev.Result)
		}
		r.emitContextCompactionEvent("context.compaction.floret", payload)
	case flevent.ContextContinue:
		r.persistRunEvent("floret.context.continue", RealtimeStreamKindLifecycle, map[string]any{
			"step_index":          ev.Step,
			"continuation_reason": strings.TrimSpace(ev.ContinuationReason),
			"message":             strings.TrimSpace(ev.Message),
			"detail":              strings.TrimSpace(ev.Result),
		})
	case flevent.BudgetExceeded:
		r.persistRunEvent("floret.budget.exceeded", RealtimeStreamKindLifecycle, map[string]any{
			"step_index": ev.Step,
			"metrics":    ev.Metrics,
		})
	case flevent.StepStart:
		r.touchActivity()
	case flevent.StepEnd:
		r.persistRunEvent("floret.step.end", RealtimeStreamKindLifecycle, map[string]any{
			"step_index":          ev.Step,
			"metrics":             ev.Metrics,
			"completion_reason":   strings.TrimSpace(ev.CompletionReason),
			"continuation_reason": strings.TrimSpace(ev.ContinuationReason),
			"finish_reason":       strings.TrimSpace(ev.FinishReason),
		})
	case flevent.RunEnd:
		r.persistRunEvent("floret.run.end", RealtimeStreamKindLifecycle, map[string]any{
			"metrics":             ev.Metrics,
			"completion_reason":   strings.TrimSpace(ev.CompletionReason),
			"continuation_reason": strings.TrimSpace(ev.ContinuationReason),
			"finish_reason":       strings.TrimSpace(ev.FinishReason),
			"error":               strings.TrimSpace(ev.Err),
		})
	case flevent.ToolApprovalRequested, flevent.ToolApprovalApproved, flevent.ToolApprovalRejected, flevent.ToolApprovalTimedOut, flevent.ToolApprovalCanceled:
		r.persistRunEvent("floret."+string(ev.Type), RealtimeStreamKindLifecycle, map[string]any{
			"tool_id":   strings.TrimSpace(ev.ToolID),
			"tool_name": strings.TrimSpace(ev.ToolName),
			"metadata":  ev.Metadata,
		})
	default:
		// Tool call/result UI and persistence are owned by Flower's tool execution path.
	}
}
