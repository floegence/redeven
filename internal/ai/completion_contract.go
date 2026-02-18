package ai

import "strings"

const (
	completionContractNone         = "none"
	completionContractExplicitOnly = "explicit_only"

	finalizationClassSuccess     = "success"
	finalizationClassWaitingUser = "waiting_user"
	finalizationClassFailure     = "failure"

	finalizationReasonBlockedNoUserInteraction = "blocked_no_user_interaction"
)

func completionContractForIntent(intent string) string {
	if normalizeRunIntent(intent) == RunIntentTask {
		return completionContractExplicitOnly
	}
	return completionContractNone
}

func classifyFinalizationReason(finalizationReason string) string {
	switch strings.TrimSpace(finalizationReason) {
	case "task_complete", "social_reply", "creative_reply":
		return finalizationClassSuccess
	case "ask_user_waiting", "ask_user_waiting_model", "ask_user_waiting_guard":
		return finalizationClassWaitingUser
	case finalizationReasonBlockedNoUserInteraction:
		return finalizationClassFailure
	default:
		return finalizationClassFailure
	}
}
