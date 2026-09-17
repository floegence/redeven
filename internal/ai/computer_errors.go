package ai

import (
	"encoding/json"
	"errors"
	"strings"
)

// Both helper protocols use a closed error vocabulary. Raw browser exceptions
// can include endpoint credentials, typed text, or page content.
func computerTargetFailure(call TargetToolCall, wireCode string) error {
	failure := &targetToolPolicyError{tool: call.ToolName, target: call.TargetID}
	switch strings.TrimSpace(wireCode) {
	case "EFFECT_OUTCOME_UNKNOWN":
		return errComputerEffectUnknown
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
	case "STALE_REFERENCE", "AMBIGUOUS_ELEMENT", "ELEMENT_NOT_FOUND", "CONDITION_TIMEOUT", "TARGET_CAPABILITY_UNAVAILABLE":
		failure.code = strings.ToLower(strings.TrimSpace(wireCode))
	case "INVALID_REQUEST", "INVALID_ARGUMENT":
		failure.code = "invalid_computer_arguments"
	default:
		failure.code = "target_action_failed"
	}
	return failure
}

func computerCallMutates(call TargetToolCall) bool {
	switch call.ToolName {
	case "computer.screenshot", "computer.observe", "computer.wait", "computer.targets", "browser.wait_for_download":
		return false
	case "computer.action":
		var operation map[string]any
		if json.Unmarshal(call.Arguments, &operation) != nil {
			return false
		}
		return computerOperationMutates(operation)
	default:
		return true
	}
}

// ComputerControlErrorCode exposes only a closed, non-secret UI classification.
func ComputerControlErrorCode(err error) string {
	var failure *targetToolPolicyError
	if errors.As(err, &failure) && failure.code == "interaction_takeover_required" {
		return "computer_control_not_ready"
	}
	return "computer_control_unavailable"
}

func computerKnownRejection(err error) bool {
	var failure *targetToolPolicyError
	if !errors.As(err, &failure) {
		return false
	}
	switch failure.code {
	case "stale_reference", "ambiguous_element", "element_not_found", "condition_timeout", "target_capability_unavailable", "invalid_computer_arguments", "target_not_allowed", "interaction_takeover_required", "target_permission_required":
		return true
	default:
		return false
	}
}
