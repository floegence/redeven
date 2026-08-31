package ai

import "strings"

const (
	finalizationClassSuccess     = "success"
	finalizationClassWaitingUser = "waiting_user"
	finalizationClassFailure     = "failure"

	finalizationReasonBlockedNoUserInteraction = "blocked_no_user_interaction"
)

func classifyFinalizationReason(finalizationReason string) string {
	// natural_stop remains readable for legacy run records; new Flower turns use task_complete.
	switch strings.TrimSpace(finalizationReason) {
	case "task_complete", "natural_stop":
		return finalizationClassSuccess
	case "ask_user_waiting_model":
		return finalizationClassWaitingUser
	case finalizationReasonBlockedNoUserInteraction:
		return finalizationClassFailure
	default:
		return finalizationClassFailure
	}
}
