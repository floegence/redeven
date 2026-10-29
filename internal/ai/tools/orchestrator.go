package tools

import (
	"context"
	"errors"
	"os"
	"strings"

	"github.com/floegence/redeven/internal/logsafe"
)

type invalidArgumentsError interface {
	InvalidArgumentsCode() string
	InvalidArgumentsMeta() map[string]any
}

type threadQueryIndexNotReadyError interface {
	ThreadQueryIndexNotReady() bool
}

func ClassifyError(err error) *ToolError {
	if err == nil {
		return nil
	}

	// Prefer typed error checks first to avoid brittle string matching.
	if errors.Is(err, context.Canceled) {
		out := &ToolError{Code: ErrorCodeCanceled, Message: "Canceled", Retryable: false}
		out.Normalize()
		return out
	}
	if errors.Is(err, context.DeadlineExceeded) {
		out := &ToolError{
			Code:           ErrorCodeTimeout,
			Message:        "Timed out",
			SuggestedFixes: []string{"Inspect the current state or existing process before continuing. A timeout does not establish that an effect did not execute; never replay an unknown effect."},
		}
		out.Normalize()
		return out
	}
	var indexNotReady threadQueryIndexNotReadyError
	if errors.As(err, &indexNotReady) && indexNotReady.ThreadQueryIndexNotReady() {
		out := &ToolError{
			Code:           ErrorCodeThreadQueryIndexNotReady,
			Message:        "Conversation search is preparing its index. No partial results were returned; retry the same query shortly.",
			Retryable:      true,
			SuggestedFixes: []string{"Retry the same query later. Do not present partial or unverified search results."},
		}
		out.Normalize()
		return out
	}
	var invalidErr invalidArgumentsError
	if errors.As(err, &invalidErr) {
		code := strings.TrimSpace(invalidErr.InvalidArgumentsCode())
		if code == "" {
			code = "invalid_arguments"
		}
		errorCode := ErrorCodeInvalidArguments
		switch code {
		case "missing_target_id":
			errorCode = ErrorCodeTargetRequired
		case "target_executor_unavailable":
			errorCode = ErrorCodeTargetExecutorUnavailable
		case "target_in_use":
			errorCode = ErrorCodeTargetInUse
		case "target_selection_stale":
			errorCode = ErrorCodeTargetSelectionStale
		case "target_not_allowed":
			errorCode = ErrorCodeTargetNotAllowed
		case "target_unavailable":
			errorCode = ErrorCodeTargetUnavailable
		case "target_setup_required":
			errorCode = ErrorCodeTargetSetupRequired
		case "target_permission_required":
			errorCode = ErrorCodeTargetPermissionRequired
		case "target_connection_required":
			errorCode = ErrorCodeTargetConnectionRequired
		case "target_not_ready":
			errorCode = ErrorCodeTargetNotReady
		case "interaction_takeover_required":
			errorCode = ErrorCodeTakeoverRequired
		case "target_observation_unavailable":
			errorCode = ErrorCodeTargetObservationUnavailable
		case "frame_unavailable":
			errorCode = ErrorCodeFrameUnavailable
		case "stale_reference":
			errorCode = ErrorCodeStaleReference
		case "ambiguous_element":
			errorCode = ErrorCodeAmbiguousElement
		case "element_not_found":
			errorCode = ErrorCodeElementNotFound
		case "condition_timeout":
			errorCode = ErrorCodeConditionTimeout
		case "target_capability_unavailable":
			errorCode = ErrorCodeTargetCapabilityUnavailable
		case "target_action_failed":
			errorCode = ErrorCodeTargetActionFailed
		}
		out := &ToolError{
			Code:      errorCode,
			Message:   strings.TrimSpace(err.Error()),
			Retryable: false,
			Meta: map[string]any{
				"validation_error_code": code,
			},
		}
		if meta := invalidErr.InvalidArgumentsMeta(); len(meta) > 0 {
			out.Meta["validation_details"] = meta
		}
		out.Normalize()
		return out
	}

	var source *ToolError
	if errors.As(err, &source) {
		out := *source
		out.Normalize()
		return &out
	}
	out := &ToolError{Code: ErrorCodeUnknown, Message: logsafe.Text(err.Error(), 4096)}
	switch {
	case errors.Is(err, os.ErrNotExist):
		out.Code = ErrorCodeNotFound
	case errors.Is(err, os.ErrPermission):
		out.Code = ErrorCodePermissionDenied
	}
	out.Normalize()
	return out
}
