package tools

import (
	"context"
	"errors"
	"fmt"
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

	// 优先使用错误类型判断，避免依赖字符串匹配。
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
	case strings.Contains(lower, "permission denied"):
		out.Code = ErrorCodePermissionDenied
		out.Retryable = false
		out.SuggestedFixes = []string{"Request the required permission or switch to an authorized tool."}
	case strings.Contains(lower, "must be absolute") || strings.Contains(lower, "invalid path") || strings.Contains(lower, "invalid cwd"):
		out.Code = ErrorCodeInvalidPath
		out.Retryable = true
		out.SuggestedFixes = []string{"Use a host absolute path.", "System root is '/'; use working_dir_abs as the default base context."}
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
		next, ok := normalizePathValue(raw)
		if !ok || next == raw {
			return
		}
		clone[key] = next
		changed = true
	}

	switch strings.TrimSpace(inv.ToolName) {
	case "fs.list_dir", "fs.stat", "fs.read_file", "fs.write_file":
		tryNormalizePath("path")
	case "terminal.exec":
		tryNormalizePath("cwd")
	default:
		return nil
	}

	if !changed {
		return nil
	}
	return clone
}

func normalizePathValue(raw string) (string, bool) {
	candidate := strings.TrimSpace(raw)
	if candidate == "" {
		return "", false
	}
	if !filepath.IsAbs(candidate) {
		return "", false
	}
	clean := filepath.Clean(candidate)
	if clean == "" {
		return "", false
	}
	if clean == candidate {
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
