package tools

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Invocation carries the minimum context required for error classification and retry hints.
type Invocation struct {
	ToolName     string
	Args         map[string]any
	WorkingDir   string
	AgentHomeDir string
}

type invalidArgumentsError interface {
	InvalidArgumentsCode() string
	InvalidArgumentsMeta() map[string]any
}

func ClassifyError(inv Invocation, err error) *ToolError {
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

	msg := strings.TrimSpace(err.Error())
	if msg == "" {
		msg = "Tool failed"
	}
	lower := strings.ToLower(msg)

	out := &ToolError{
		Code:      ErrorCodeUnknown,
		Message:   msg,
		Retryable: false,
	}

	switch {
	case strings.Contains(lower, "missing web search api key"):
		out.Code = ErrorCodeUnknown
		out.Retryable = false
		out.SuggestedFixes = []string{
			"Configure a web search API key for the selected provider (for Brave: set REDEVEN_BRAVE_API_KEY or BRAVE_API_KEY, or update it in the AI settings UI).",
			"Use another currently supplied research capability only when it can verify the needed source within the existing authorization; never bypass a blocked target.",
		}
	case strings.Contains(lower, "permission denied"):
		out.Code = ErrorCodePermissionDenied
		out.Retryable = false
		out.SuggestedFixes = []string{"Do not repeat the denied operation through another tool. Continue independent authorized work or explain the authorization change required before this operation can proceed."}
	case strings.Contains(lower, "must be absolute") || strings.Contains(lower, "invalid path") || strings.Contains(lower, "invalid cwd"):
		out.Code = ErrorCodeInvalidPath
		out.Retryable = true
		out.SuggestedFixes = []string{"Use a valid filesystem path.", "Relative paths resolve against the working directory; home-relative paths resolve against the runtime home. The resolved path must satisfy the configured filesystem roots and their permissions, including when using a sibling worktree."}
	case strings.Contains(lower, "not found"):
		out.Code = ErrorCodeNotFound
		out.Retryable = false
		out.SuggestedFixes = []string{"Verify the absolute path exists.", "List the parent directory before retrying."}
	case strings.Contains(lower, "timed out"):
		out.Code = ErrorCodeTimeout
		out.SuggestedFixes = []string{"Inspect current state before continuing. Retry only an inspection or an operation confirmed not to have executed; never replay an unknown effect."}
	}

	normalized := normalizeArgs(inv)
	if len(normalized) > 0 && out.Code == ErrorCodeInvalidPath {
		out.NormalizedArgs = normalized
		out.Retryable = true
		out.SuggestedFixes = append(out.SuggestedFixes, "Retry once using normalized_args from the tool error payload.")
	}
	out.Normalize()
	return out
}

func normalizeArgs(inv Invocation) map[string]any {
	args := inv.Args
	if args == nil {
		return nil
	}

	clone := cloneMap(args)
	changed := false

	tryNormalizePath := func(key string) {
		raw := strings.TrimSpace(anyToString(clone[key]))
		if raw == "" {
			return
		}
		next, ok := normalizePathValue(raw, inv.WorkingDir, inv.AgentHomeDir)
		if !ok || next == raw {
			return
		}
		clone[key] = next
		changed = true
	}

	switch strings.TrimSpace(inv.ToolName) {
	case "terminal.exec":
		tryNormalizePath("cwd")
		tryNormalizePath("workdir")
		// Never persist stdin body in normalized args (it may contain secrets).
		delete(clone, "stdin")
	default:
		return nil
	}

	if !changed {
		return nil
	}
	return clone
}

func normalizePathValue(raw string, workingDir string, agentHomeDir string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}
	clean := raw
	if raw == "~" || strings.HasPrefix(raw, "~/") {
		home := strings.TrimSpace(agentHomeDir)
		if home == "" {
			return "", false
		}
		if raw == "~" {
			clean = home
		} else {
			clean = filepath.Join(home, strings.TrimPrefix(raw, "~/"))
		}
	} else if !filepath.IsAbs(raw) {
		base := strings.TrimSpace(workingDir)
		if base == "" {
			return "", false
		}
		clean = filepath.Join(base, raw)
	}
	if clean == "" {
		return "", false
	}
	if abs, err := filepath.Abs(clean); err == nil {
		clean = abs
	}
	if resolved, err := filepath.EvalSymlinks(clean); err == nil {
		clean = resolved
	} else if errors.Is(err, os.ErrNotExist) {
		if resolvedViaAncestor := resolveViaExistingAncestorBestEffort(clean); resolvedViaAncestor != "" {
			clean = resolvedViaAncestor
		}
	}
	clean = filepath.Clean(clean)
	if clean == raw {
		return "", false
	}
	return clean, true
}

func resolveViaExistingAncestorBestEffort(path string) string {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "" {
		return ""
	}
	current := path
	tail := make([]string, 0, 4)
	for {
		if resolved, err := filepath.EvalSymlinks(current); err == nil {
			for i := len(tail) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, tail[i])
			}
			return filepath.Clean(resolved)
		}
		parent := filepath.Dir(current)
		if parent == current {
			return ""
		}
		tail = append(tail, filepath.Base(current))
		current = parent
	}
}

func cloneMap(in map[string]any) map[string]any {
	if in == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func anyToString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case fmt.Stringer:
		return x.String()
	default:
		return ""
	}
}

// ShouldRetryWithNormalizedArgs returns true when the caller should perform one deterministic retry.
func ShouldRetryWithNormalizedArgs(toolErr *ToolError) bool {
	if toolErr == nil {
		return false
	}
	if !toolErr.Retryable {
		return false
	}
	if len(toolErr.NormalizedArgs) == 0 {
		return false
	}
	switch toolErr.Code {
	case ErrorCodeInvalidPath:
		return true
	default:
		return false
	}
}

func MergeNormalizedArgs(args map[string]any, normalized map[string]any) map[string]any {
	if len(normalized) == 0 {
		return cloneMap(args)
	}
	out := cloneMap(args)
	for k, v := range normalized {
		out[k] = v
	}
	return out
}

func ErrFromToolError(toolErr *ToolError) error {
	if toolErr == nil {
		return nil
	}
	toolErr.Normalize()
	return errors.New(toolErr.Message)
}
