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
	ToolName   string
	Args       map[string]any
	WorkingDir string
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
			Retryable:      true,
			SuggestedFixes: []string{"Retry with a smaller scope.", "Increase timeout when safe."},
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
			"If web.search is unavailable, switch tools: use terminal.exec with curl to query a public API or fetch an authoritative URL directly.",
		}
	case strings.Contains(lower, "permission denied"):
		out.Code = ErrorCodePermissionDenied
		out.Retryable = false
		out.SuggestedFixes = []string{"Request the required permission or switch to an authorized tool."}
	case strings.Contains(lower, "must be absolute") || strings.Contains(lower, "invalid path") || strings.Contains(lower, "invalid cwd"):
		out.Code = ErrorCodeInvalidPath
		out.Retryable = true
		out.SuggestedFixes = []string{"Use a valid filesystem path.", "Relative paths are resolved against working_dir_abs; '~/' resolves to the current user home directory."}
	case strings.Contains(lower, "not found"):
		out.Code = ErrorCodeNotFound
		out.Retryable = false
		out.SuggestedFixes = []string{"Verify the absolute path exists.", "List the parent directory before retrying."}
	case strings.Contains(lower, "timed out"):
		out.Code = ErrorCodeTimeout
		out.Retryable = true
		out.SuggestedFixes = []string{"Retry with a smaller scope.", "Increase timeout when safe."}
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
		next, ok := normalizePathValue(raw, inv.WorkingDir)
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

func normalizePathValue(raw string, workingDir string) (string, bool) {
	candidate := strings.TrimSpace(raw)
	if candidate == "" {
		return "", false
	}
	original := candidate
	if candidate == "~" || strings.HasPrefix(candidate, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", false
		}
		home = strings.TrimSpace(home)
		if home == "" {
			return "", false
		}
		if candidate == "~" {
			candidate = home
		} else {
			candidate = filepath.Join(home, strings.TrimPrefix(candidate, "~/"))
		}
	}
	if !filepath.IsAbs(candidate) {
		base := strings.TrimSpace(workingDir)
		if base == "" {
			return "", false
		}
		base = filepath.Clean(base)
		if !filepath.IsAbs(base) {
			return "", false
		}
		candidate = filepath.Join(base, candidate)
	}
	clean := filepath.Clean(candidate)
	if clean == "" {
		return "", false
	}
	if clean == original {
		return "", false
	}
	return clean, true
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
