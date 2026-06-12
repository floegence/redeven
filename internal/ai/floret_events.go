package ai

import (
	"strings"

	flruntime "github.com/floegence/floret/runtime"
)

const (
	floretEventStepStart             = "step_start"
	floretEventProviderRequest       = "provider_request"
	floretEventProviderFinish        = "provider_finish"
	floretEventProviderRetry         = "provider_retry"
	floretEventContextCompact        = "context_compact"
	floretEventContextContinue       = "context_continue"
	floretEventBudgetExceeded        = "budget_exceeded"
	floretEventStepEnd               = "step_end"
	floretEventRunEnd                = "run_end"
	floretEventToolApprovalRequested = "tool_approval_requested"
	floretEventToolApprovalApproved  = "tool_approval_approved"
	floretEventToolApprovalRejected  = "tool_approval_rejected"
	floretEventToolApprovalTimedOut  = "tool_approval_timed_out"
	floretEventToolApprovalCanceled  = "tool_approval_canceled"
)

type floretEventSink struct {
	run *run
}

func floretEventMetadataString(metadata map[string]any, key string) string {
	if metadata == nil {
		return ""
	}
	return strings.TrimSpace(anyToString(metadata[key]))
}

func (s floretEventSink) EmitEvent(ev flruntime.Event) {
	r := s.run
	if r == nil {
		return
	}
	switch ev.Type {
	case floretEventProviderRequest:
		r.persistRunEvent("floret.provider.request", RealtimeStreamKindLifecycle, map[string]any{
			"step_index": ev.Step,
			"provider":   strings.TrimSpace(ev.Provider),
			"model":      strings.TrimSpace(ev.Model),
			"metadata":   ev.Metadata,
		})
	case floretEventProviderFinish:
		r.persistRunEvent("floret.provider.finish", RealtimeStreamKindLifecycle, map[string]any{
			"step_index":    ev.Step,
			"finish_reason": strings.TrimSpace(ev.FinishReason),
			"metadata":      ev.Metadata,
		})
	case floretEventProviderRetry:
		r.persistRunEvent("floret.provider.retry", RealtimeStreamKindLifecycle, map[string]any{
			"step_index": ev.Step,
			"message":    strings.TrimSpace(ev.Message),
		})
	case floretEventContextCompact:
		payload := map[string]any{
			"step_index": ev.Step,
			"message":    strings.TrimSpace(ev.Message),
			"metadata":   ev.Metadata,
		}
		if strings.TrimSpace(ev.Error) != "" {
			payload["error"] = strings.TrimSpace(ev.Error)
		}
		if strings.TrimSpace(ev.Result) != "" {
			payload["result"] = strings.TrimSpace(ev.Result)
		}
		r.emitContextCompactionEvent("context.compaction.floret", payload)
	case floretEventContextContinue:
		r.persistRunEvent("floret.context.continue", RealtimeStreamKindLifecycle, map[string]any{
			"step_index":          ev.Step,
			"message":             strings.TrimSpace(ev.Message),
			"detail":              strings.TrimSpace(ev.Result),
			"continuation_reason": floretEventMetadataString(ev.Metadata, "continuation_reason"),
			"metadata":            ev.Metadata,
		})
	case floretEventBudgetExceeded:
		r.persistRunEvent("floret.budget.exceeded", RealtimeStreamKindLifecycle, map[string]any{
			"step_index": ev.Step,
			"metadata":   ev.Metadata,
		})
	case floretEventStepStart:
		r.touchActivity()
	case floretEventStepEnd:
		r.persistRunEvent("floret.step.end", RealtimeStreamKindLifecycle, map[string]any{
			"step_index":          ev.Step,
			"finish_reason":       strings.TrimSpace(ev.FinishReason),
			"completion_reason":   floretEventMetadataString(ev.Metadata, "completion_reason"),
			"continuation_reason": floretEventMetadataString(ev.Metadata, "continuation_reason"),
			"metadata":            ev.Metadata,
		})
	case floretEventRunEnd:
		r.persistRunEvent("floret.run.end", RealtimeStreamKindLifecycle, map[string]any{
			"finish_reason": strings.TrimSpace(ev.FinishReason),
			"error":         strings.TrimSpace(ev.Error),
			"metadata":      ev.Metadata,
		})
	case floretEventToolApprovalRequested, floretEventToolApprovalApproved, floretEventToolApprovalRejected, floretEventToolApprovalTimedOut, floretEventToolApprovalCanceled:
		r.persistRunEvent("floret."+ev.Type, RealtimeStreamKindLifecycle, map[string]any{
			"tool_id":   strings.TrimSpace(ev.ToolID),
			"tool_name": strings.TrimSpace(ev.ToolName),
			"metadata":  ev.Metadata,
		})
	default:
		// Tool call/result UI and persistence are owned by Flower's tool execution path.
	}
}
