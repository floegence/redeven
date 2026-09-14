package ai

import "strings"

// Both helper protocols use a closed error vocabulary. Raw browser exceptions
// can include endpoint credentials, typed text, or page content.
func computerTargetFailure(call TargetToolCall, wireCode string) error {
	failure := &targetToolPolicyError{tool: call.ToolName, target: call.TargetID}
	switch strings.TrimSpace(wireCode) {
	case "TARGET_PERMISSION_REQUIRED":
		failure.code, failure.targetState, failure.repairAction = "target_permission_required", "permission_required", "grant_target_permission"
	case "TARGET_CONNECTION_REQUIRED":
		failure.code, failure.targetState, failure.repairAction = "target_connection_required", "connection_required", "connect_current_browser"
	case "TARGET_SETUP_REQUIRED":
		failure.code, failure.targetState = "target_setup_required", "setup_required"
	case "TARGET_NOT_ALLOWED":
		failure.code = "target_not_allowed"
	case "TARGET_NOT_READY":
		failure.code, failure.targetState = "target_not_ready", "stopped"
	case "TAKEOVER_REQUIRED":
		failure.code = "interaction_takeover_required"
	case "FRAME_UNAVAILABLE":
		failure.code, failure.repairAction = "frame_unavailable", "observe_target"
	case "INVALID_REQUEST":
		failure.code = "invalid_computer_arguments"
	default:
		failure.code = "target_action_failed"
	}
	return failure
}
