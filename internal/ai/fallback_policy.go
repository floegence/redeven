package ai

import (
	"fmt"
	"strings"
)

const (
	subagentFailureReasonBlockedNoUserInteraction = "blocked_no_user_interaction"
	subagentFailureReasonMissingRequiredContext   = "missing_required_context"
	subagentFailureReasonRepeatedToolFailures     = "repeated_tool_failures"
	subagentFailureReasonHardMaxSteps             = "hard_max_steps_without_completion"
)

func noUserInteractionFallbackReasonCode(source string) string {
	source = strings.TrimSpace(source)
	switch source {
	case "missing_explicit_completion", "provider_empty_output", "provider_empty_output_repeated":
		return subagentFailureReasonMissingRequiredContext
	case "tool_mistake_loop", "guard_doom_loop":
		return subagentFailureReasonRepeatedToolFailures
	case "hard_max_summary_failed", "hard_max_steps":
		return subagentFailureReasonHardMaxSteps
	default:
		return subagentFailureReasonBlockedNoUserInteraction
	}
}

func buildNoUserInteractionFallbackDetail(source string, signal askUserSignal) string {
	source = strings.TrimSpace(source)
	question := strings.TrimSpace(signal.Question)
	if question != "" {
		return truncateRunes(question, 240)
	}
	if source == "" {
		return "Autonomous run cannot request additional user input."
	}
	return truncateRunes(fmt.Sprintf("Autonomous run cannot request additional user input (%s).", source), 240)
}

func (r *run) applyNoUserInteractionFallback(step int, source string, signal askUserSignal) {
	if r == nil {
		return
	}
	source = strings.TrimSpace(source)
	reasonCode := noUserInteractionFallbackReasonCode(source)
	detail := buildNoUserInteractionFallbackDetail(source, signal)
	if strings.TrimSpace(detail) != "" {
		_ = r.appendTextDelta(detail)
	}
	r.persistRunEvent("policy.fallback.applied", RealtimeStreamKindLifecycle, map[string]any{
		"reason_code": reasonCode,
		"source":      source,
		"detail":      detail,
		"step_index":  step,
	})
	r.setFinalizationReason(finalizationReasonBlockedNoUserInteraction)
	r.setEndReason("complete")
	r.emitLifecyclePhase("ended", map[string]any{
		"reason":      finalizationReasonBlockedNoUserInteraction,
		"reason_code": reasonCode,
		"source":      source,
		"step_index":  step,
	})
	r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
}
