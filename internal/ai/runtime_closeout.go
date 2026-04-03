package ai

import (
	"context"
	"strings"
)

const (
	finalizationReasonProtocolCloseout    = "protocol_closeout"
	finalizationReasonExitPlanModeWaiting = "exit_plan_mode_waiting"
)

func runtimeCloseoutHasVerifiedToolWork(state runtimeState) bool {
	for _, fact := range state.CompletedActionFacts {
		toolName := strings.ToLower(strings.TrimSpace(strings.SplitN(strings.TrimSpace(fact), ":", 2)[0]))
		switch toolName {
		case "", "write_todos":
			continue
		default:
			return true
		}
	}
	return false
}

func buildRuntimeCloseout(resultText string, state runtimeState, complexity string, mode string) (RuntimeCloseout, bool, string) {
	resultText = strings.TrimSpace(resultText)
	if resultText == "" {
		return RuntimeCloseout{}, false, "empty_result"
	}
	if !runtimeCloseoutHasVerifiedToolWork(state) {
		return RuntimeCloseout{}, false, "missing_verified_tool_work"
	}
	if completionResultRequestsUserInput(resultText, state.InteractionContract) {
		return RuntimeCloseout{}, false, "waiting_user_required"
	}
	gatePassed, gateReason := evaluateTaskCompletionGate(resultText, state, complexity, mode)
	if !gatePassed {
		return RuntimeCloseout{}, false, gateReason
	}
	return RuntimeCloseout{
		Result: resultText,
		Source: finalizationReasonProtocolCloseout,
	}, true, "ok"
}

func (r *run) finalizeRuntimeCloseout(step int, closeout RuntimeCloseout) {
	if r == nil {
		return
	}
	resultText := strings.TrimSpace(closeout.Result)
	if resultText == "" {
		return
	}
	if !r.hasNonEmptyAssistantText() {
		_ = r.appendTextDelta(resultText)
	}
	r.setCanonicalMarkdownCandidate(resultText)
	r.reconcileCanonicalMarkdownMessage(resultText)
	r.emitSourcesToolBlock(finalizationReasonProtocolCloseout)
	r.setFinalizationReason(finalizationReasonProtocolCloseout)
	r.setEndReason("complete")
	r.emitLifecyclePhase("ended", map[string]any{"reason": finalizationReasonProtocolCloseout, "step_index": step})
	r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
}

func (r *run) attemptRuntimeCloseout(step int, state runtimeState, complexity string, mode string, profile RunProtocolProfile, requireUserConfirm bool, source string, fallback string) bool {
	if r == nil || requireUserConfirm {
		return false
	}
	profile = normalizeRunProtocolProfile(profile)
	if profile.CompletionMode != RunCompletionModeRuntimeCloseout {
		return false
	}
	resultText := r.canonicalAssistantMarkdownOrFallback(fallback)
	closeout, closeoutOK, closeoutReason := buildRuntimeCloseout(resultText, state, complexity, mode)
	r.persistRunEvent("protocol.closeout.attempt", RealtimeStreamKindLifecycle, map[string]any{
		"step_index":          step,
		"surface":             profile.Surface,
		"completion_mode":     profile.CompletionMode,
		"gate_passed":         closeoutOK,
		"gate_reason":         closeoutReason,
		"verified_tool_work":  runtimeCloseoutHasVerifiedToolWork(state),
		"mode":                strings.TrimSpace(mode),
		"source":              strings.TrimSpace(source),
		"interaction_waiting": completionResultRequestsUserInput(resultText, state.InteractionContract),
	})
	if !closeoutOK {
		return false
	}
	r.finalizeRuntimeCloseout(step, closeout)
	return true
}

func (r *run) finalizeIfContextCanceledWithRuntimeCloseout(ctx context.Context, step int, state runtimeState, complexity string, mode string, profile RunProtocolProfile, requireUserConfirm bool) bool {
	if ctx == nil || ctx.Err() == nil {
		return false
	}
	if r.attemptRuntimeCloseout(step, state, complexity, mode, profile, requireUserConfirm, "context_canceled", "") {
		return true
	}
	return r.finalizeIfContextCanceled(ctx)
}
