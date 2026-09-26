package ai

import (
	"encoding/json"
	"errors"
	"strings"

	aitools "github.com/floegence/redeven/internal/ai/tools"
)

// Navigation acknowledgement is distinct from destination load completion.
// This is an execution error, never an invalid-arguments or permission error.
type computerNavigationError struct {
	code          aitools.ErrorCode
	stage, reason string
}

func (e *computerNavigationError) Error() string {
	if e.code == aitools.ErrorCodeNavigationTimeout {
		return "Browser acknowledged navigation, but the page did not finish loading. Observe the page before choosing the next action."
	}
	return "Browser navigation failed (" + e.reason + "). Observe the page before choosing the next action."
}

func (e *computerNavigationError) facts() map[string]any {
	facts := map[string]any{"action_executed": true, "navigation_stage": e.stage}
	if e.reason != "" {
		facts["network_error"] = e.reason
	}
	return facts
}

func computerNavigationReason(reason string) bool {
	switch reason {
	case "NETWORK_ERROR", "ERR_TUNNEL_CONNECTION_FAILED", "ERR_PROXY_CONNECTION_FAILED", "ERR_CONNECTION_FAILED",
		"ERR_CONNECTION_REFUSED", "ERR_CONNECTION_RESET", "ERR_CONNECTION_CLOSED", "ERR_NAME_NOT_RESOLVED",
		"ERR_INTERNET_DISCONNECTED", "ERR_NETWORK_CHANGED", "ERR_TIMED_OUT", "ERR_CONNECTION_TIMED_OUT",
		"ERR_EMPTY_RESPONSE", "ERR_TOO_MANY_REDIRECTS", "ERR_CERT_AUTHORITY_INVALID", "ERR_CERT_DATE_INVALID",
		"ERR_CERT_COMMON_NAME_INVALID", "ERR_SSL_PROTOCOL_ERROR", "ERR_ABORTED":
		return true
	}
	return false
}

// Lost or malformed exchanges cannot establish the result of a mutating call.
// Call this only after dispatch; validated browser failures use the mapper below.
func computerBrowserExchangeFailure(call TargetToolCall, private bool, err error) error {
	if !private && computerCallMutates(call) {
		return errComputerEffectUnknown
	}
	return err
}

// One closed result classifier for managed/CDP and extension browser channels.
// The bool says whether the response was valid, not whether navigation succeeded.
func computerBrowserFailure(call TargetToolCall, private bool, code string, payload map[string]any, location string) (TargetToolResult, error, bool) {
	invalid := func() (TargetToolResult, error, bool) {
		return TargetToolResult{}, computerBrowserExchangeFailure(call, private, errors.New("invalid browser failure result")), false
	}
	if code == "NAVIGATION_FAILED" || code == "NAVIGATION_TIMEOUT" {
		if call.ToolName != "browser.navigate" && call.ToolName != "browser.back" && call.ToolName != "browser.reload" {
			return invalid()
		}
		executed, _ := payload["action_executed"].(bool)
		stage, _ := payload["navigation_stage"].(string)
		reason, _ := payload["network_error"].(string)
		_, hasReason := payload["network_error"]
		if !executed || (code == "NAVIGATION_FAILED" && (stage != "response" || !computerNavigationReason(reason))) ||
			(code == "NAVIGATION_TIMEOUT" && (stage != "load" || hasReason)) {
			return invalid()
		}
		failure := &computerNavigationError{code: aitools.ErrorCode(code), stage: stage, reason: reason}
		return TargetToolResult{TargetID: call.TargetID, ExecutionLocation: location, Result: failure.facts()}, failure, true
	}
	if code == "TARGET_OBSERVATION_UNAVAILABLE" {
		result, err := computerObservationFailure(call, payload, location)
		if !computerKnownRejection(err) {
			return invalid()
		}
		return result, err, true
	}
	err := computerTargetFailure(call, code)
	if !computerKnownRejection(err) {
		err = computerBrowserExchangeFailure(call, private, err)
	}
	return TargetToolResult{}, err, true
}

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
	case "TARGET_IN_USE":
		failure.code = "target_in_use"
	case "TARGET_NOT_ALLOWED":
		failure.code = "target_not_allowed"
	case "TARGET_NOT_READY":
		failure.code, failure.targetState = "target_not_ready", "stopped"
	case "TAKEOVER_REQUIRED":
		failure.code = "interaction_takeover_required"
	case "TARGET_OBSERVATION_UNAVAILABLE":
		failure.code, failure.repairAction = "target_observation_unavailable", "observe_target"
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

// ComputerControlErrorDetails carries only the latest host-observed blocking
// reason. It cannot authorize input or replace the canonical pending question.
func ComputerControlErrorDetails(err error) map[string]any {
	var failure *targetToolPolicyError
	if !errors.As(err, &failure) || failure.code != "interaction_takeover_required" || failure.safety == nil {
		return nil
	}
	safety := failure.safety
	detail := map[string]any{"kind": computerAssistanceKind(*safety)}
	if safety.RequiredOrigin != "" && (ComputerAccess{Origins: []string{safety.RequiredOrigin}}).Validate() == nil {
		detail["origin"] = safety.RequiredOrigin
	}
	if safety.RequiredApp != "" && (ComputerAccess{Apps: []string{safety.RequiredApp}}).Validate() == nil {
		detail["app"] = safety.RequiredApp
	}
	for _, reason := range safety.ReasonCodes {
		if reason == "foreground_permission" {
			detail["foreground"] = true
		}
	}
	return map[string]any{"computer_assistance": detail}
}

func computerKnownRejection(err error) bool {
	var failure *targetToolPolicyError
	if !errors.As(err, &failure) {
		return false
	}
	switch failure.code {
	case "target_in_use", "target_observation_unavailable", "stale_reference", "ambiguous_element", "element_not_found", "condition_timeout", "target_capability_unavailable", "invalid_computer_arguments", "target_not_allowed", "interaction_takeover_required", "target_permission_required":
		return true
	default:
		return false
	}
}

// ComputerSelectionErrorCode retains actionable selection failures without
// reflecting page contents, endpoints or arbitrary adapter exceptions.
func ComputerSelectionErrorCode(err error) string {
	var failure *targetToolPolicyError
	if errors.As(err, &failure) {
		switch failure.code {
		case "target_in_use", "target_selection_stale", "target_not_allowed", "target_permission_required", "target_setup_required", "target_connection_required", "interaction_takeover_required":
			return failure.code
		}
	}
	var startup *TargetStartupError
	if errors.As(err, &startup) {
		switch startup.Code {
		case "TARGET_PERMISSION_REQUIRED", "TARGET_SETUP_REQUIRED", "TARGET_CONNECTION_REQUIRED":
			return strings.ToLower(startup.Code)
		}
	}
	if errors.Is(err, errTargetNotRegistered) {
		return "target_selection_stale"
	}
	return "computer_target_selection_failed"
}

// A failed read is not an unknown effect. Only the helper's closed, confirmed
// progress facts may survive; never retain its raw data, exception or pixels.
func computerObservationFailure(call TargetToolCall, payload map[string]any, location string) (TargetToolResult, error) {
	executed, confirmed := payload["action_executed"].(bool)
	stage, _ := payload["observation_stage"].(string)
	if !confirmed || computerObservationStage(stage) == "unknown" {
		return TargetToolResult{}, errors.New("invalid browser observation failure")
	}
	return TargetToolResult{TargetID: call.TargetID, ExecutionLocation: location,
		Result: map[string]any{"action_executed": executed, "observation_stage": stage}}, computerTargetFailure(call, "TARGET_OBSERVATION_UNAVAILABLE")
}

func computerObservationStage(stage string) string {
	switch stage {
	case "frame_inventory", "safety_scan", "semantic_read", "capture", "metadata":
		return stage
	default:
		return "unknown"
	}
}
