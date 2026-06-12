package ai

import "strings"

const (
	finalizationClassSuccess     = "success"
	finalizationClassWaitingUser = "waiting_user"
	finalizationClassFailure     = "failure"

	finalizationReasonBlockedNoUserInteraction = "blocked_no_user_interaction"
	finalizationReasonExitPlanModeWaiting      = "exit_plan_mode_waiting"
)

func classifyFinalizationReason(finalizationReason string) string {
	switch strings.TrimSpace(finalizationReason) {
	case "task_complete", "natural_stop":
		return finalizationClassSuccess
	case "ask_user_waiting_model", finalizationReasonExitPlanModeWaiting:
		return finalizationClassWaitingUser
	case finalizationReasonBlockedNoUserInteraction:
		return finalizationClassFailure
	default:
		return finalizationClassFailure
	}
}
