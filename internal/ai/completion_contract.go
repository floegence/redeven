package ai

import "strings"

const (
	completionContractNone         = "none"
	completionContractFirstTurn    = "first_turn_maybe_complete"
	completionContractExplicitOnly = "explicit_only"

	finalizationClassSuccess     = "success"
	finalizationClassWaitingUser = "waiting_user"
	finalizationClassFailure     = "failure"

	finalizationReasonBlockedNoUserInteraction = "blocked_no_user_interaction"
)

func completionContractForExecutionContract(executionContract string) string {
	switch normalizeExecutionContractValue(executionContract) {
	case RunExecutionContractAgenticLoop:
		return completionContractExplicitOnly
	case RunExecutionContractHybridFirstTurn:
		return completionContractFirstTurn
	default:
		return completionContractNone
	}
}

func classifyFinalizationReason(finalizationReason string) string {
	switch strings.TrimSpace(finalizationReason) {
	case "task_complete", "task_complete_forced", "social_reply", "creative_reply", "hybrid_first_turn_reply", finalizationReasonProtocolCloseout:
		return finalizationClassSuccess
	case "ask_user_waiting", "ask_user_waiting_model", "ask_user_waiting_guard", finalizationReasonExitPlanModeWaiting:
		return finalizationClassWaitingUser
	case finalizationReasonBlockedNoUserInteraction:
		return finalizationClassFailure
	default:
		return finalizationClassFailure
	}
}
