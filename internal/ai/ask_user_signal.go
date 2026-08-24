package ai

import "strings"

const (
	AskUserReasonUserDecisionRequired = "user_decision_required"
	AskUserReasonPermissionBlocked    = "permission_blocked"
	AskUserReasonMissingExternalInput = "missing_external_input"
	AskUserReasonConflictingWork      = "conflicting_constraints"
	AskUserReasonSafetyConfirmation   = "safety_confirmation"
)

func normalizeAskUserReasonCode(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case AskUserReasonUserDecisionRequired:
		return AskUserReasonUserDecisionRequired
	case AskUserReasonPermissionBlocked:
		return AskUserReasonPermissionBlocked
	case AskUserReasonMissingExternalInput:
		return AskUserReasonMissingExternalInput
	case AskUserReasonConflictingWork:
		return AskUserReasonConflictingWork
	case AskUserReasonSafetyConfirmation:
		return AskUserReasonSafetyConfirmation
	default:
		return ""
	}
}
