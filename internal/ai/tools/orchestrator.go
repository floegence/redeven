package tools

import (
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// Invocation carries the minimum context required for error classification / recovery hints.
type Invocation struct {
	ToolName string
	Args     map[string]any
	FSRoot   string
}

func ClassifyError(inv Invocation, err error) *ToolError {
	if err == nil {
		return nil
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
	case strings.Contains(lower, "must be absolute"):
		out.Code = ErrorCodeInvalidPath
		out.Retryable = true
		out.SuggestedFixes = []string{"Use an absolute path inside workspace root."}
	case strings.Contains(lower, "outside workspace root"):
		out.Code = ErrorCodeOutsideWorkspace
		out.Retryable = true
		out.SuggestedFixes = []string{"Use a path under workspace root.", "Call terminal.exec with pwd to inspect current workspace root."}
	case strings.Contains(lower, "not found"):
		out.Code = ErrorCodeNotFound
		out.Retryable = false
		out.SuggestedFixes = []string{"Verify the path exists.", "Call fs.list_dir on the parent directory first."}
	case strings.Contains(lower, "timed out"):
		out.Code = ErrorCodeTimeout
		out.Retryable = true
		out.SuggestedFixes = []string{"Retry with a smaller scope.", "Increase timeout when safe."}
	}

	normalized := normalizeArgs(inv)
	if len(normalized) > 0 {
		out.NormalizedArgs = normalized
		if out.Code == ErrorCodeInvalidPath || out.Code == ErrorCodeOutsideWorkspace || out.Code == ErrorCodeNotFound {
			out.Retryable = true
			out.SuggestedFixes = append(out.SuggestedFixes, "Retry using normalized_args from the tool error payload.")
		}
	}
	out.Normalize()
	return out
}

func normalizeArgs(inv Invocation) map[string]any {
	args := inv.Args
	if args == nil {
		return nil
	}

	root := strings.TrimSpace(inv.FSRoot)
	if root == "" {
		return nil
	}
	root = filepath.Clean(root)
	if !filepath.IsAbs(root) {
		abs, err := filepath.Abs(root)
		if err != nil {
			return nil
		}
		root = filepath.Clean(abs)
	}

	clone := cloneMap(args)
	changed := false

	tryNormalizePath := func(key string) {
		raw := strings.TrimSpace(anyToString(clone[key]))
		if raw == "" {
			return
		}
		next, ok := normalizePathValue(raw, root)
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

func virtualPathFromReal(root string, real string) string {
	root = filepath.Clean(root)
	real = filepath.Clean(real)
	rel, err := filepath.Rel(root, real)
	if err != nil {
		return "/"
	}
	rel = filepath.Clean(rel)
	if rel == "." {
		return "/"
	}
	v := "/" + strings.TrimPrefix(filepath.ToSlash(rel), "/")
	v = path.Clean(v)
	if v == "." || v == "" {
		return "/"
	}
	if !strings.HasPrefix(v, "/") {
		v = "/" + v
	}
	return v
}

func bestEffortVirtualPathFromAbsoluteCandidate(root string, candidateAbs string) (string, bool) {
	root = filepath.Clean(root)
	candidateAbs = filepath.Clean(candidateAbs)
	if root == "" || candidateAbs == "" {
		return "", false
	}

	rootSeg := strings.Split(strings.Trim(filepath.ToSlash(root), "/"), "/")
	candidateSeg := strings.Split(strings.Trim(filepath.ToSlash(candidateAbs), "/"), "/")
	if len(rootSeg) == 0 || len(candidateSeg) == 0 {
		return "", false
	}

	maxOverlap := len(rootSeg)
	if len(candidateSeg) < maxOverlap {
		maxOverlap = len(candidateSeg)
	}
	best := 0
	for k := maxOverlap; k >= 1; k-- {
		rootTail := rootSeg[len(rootSeg)-k:]
		candidateHead := candidateSeg[:k]
		match := true
		for i := 0; i < k; i++ {
			if !strings.EqualFold(rootTail[i], candidateHead[i]) {
				match = false
				break
			}
		}
		if match {
			best = k
			break
		}
	}
	if best == 0 {
		return "", false
	}

	remainder := candidateSeg[best:]
	virtualPath := "/"
	if len(remainder) > 0 {
		virtualPath = "/" + strings.Join(remainder, "/")
	}
	virtualPath = path.Clean(virtualPath)
	if virtualPath == "." || virtualPath == "" {
		virtualPath = "/"
	}

	realAbs := filepath.Clean(filepath.Join(root, filepath.FromSlash(strings.TrimPrefix(virtualPath, "/"))))
	ok, err := isWithinRoot(realAbs, root)
	if err != nil || !ok {
		return "", false
	}
	return virtualPath, true
}

func normalizePathValue(raw string, root string) (string, bool) {
	if raw == "" || root == "" {
		return "", false
	}

	candidate := strings.TrimSpace(raw)
	if candidate == "" {
		return "", false
	}
	candidate = strings.ReplaceAll(candidate, "\\", "/")

	if strings.HasPrefix(candidate, "~/") {
		candidate = "/" + strings.TrimPrefix(candidate, "~/")
	}

	if filepath.IsAbs(candidate) {
		cleanAbs := filepath.Clean(candidate)
		ok, err := isWithinRoot(cleanAbs, root)
		if err == nil && ok {
			return virtualPathFromReal(root, cleanAbs), true
		}
		if guessed, guessedOK := bestEffortVirtualPathFromAbsoluteCandidate(root, cleanAbs); guessedOK {
			return guessed, true
		}
		candidate = filepath.ToSlash(cleanAbs)
	}

	if !strings.HasPrefix(candidate, "/") {
		candidate = "/" + candidate
	}
	virtualPath := path.Clean(candidate)
	if virtualPath == "." || virtualPath == "" {
		virtualPath = "/"
	}
	if !strings.HasPrefix(virtualPath, "/") {
		virtualPath = "/" + virtualPath
	}

	realAbs := filepath.Clean(filepath.Join(root, filepath.FromSlash(strings.TrimPrefix(virtualPath, "/"))))
	ok, err := isWithinRoot(realAbs, root)
	if err != nil || !ok {
		return "", false
	}
	return virtualPath, true
}

func isWithinRoot(path string, root string) (bool, error) {
	path = filepath.Clean(path)
	root = filepath.Clean(root)
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false, err
	}
	rel = filepath.Clean(rel)
	if rel == "." {
		return true, nil
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return false, nil
	}
	return true, nil
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
	case ErrorCodeInvalidPath, ErrorCodeOutsideWorkspace, ErrorCodeNotFound:
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
