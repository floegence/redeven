package gitutil

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
)

// CommandContext builds a git command with stable non-interactive output settings.
func CommandContext(ctx context.Context, repoRoot string, env []string, args ...string) (*exec.Cmd, error) {
	repoRoot = filepath.Clean(strings.TrimSpace(repoRoot))
	if repoRoot == "" {
		return nil, errors.New("missing repo root")
	}
	cmdArgs := append([]string{"-C", repoRoot, "--no-pager", "-c", "color.ui=never", "-c", "core.quotepath=false"}, args...)
	cmd := exec.CommandContext(ctx, "git", cmdArgs...)
	if len(env) > 0 {
		cmd.Env = append([]string(nil), env...)
	}
	return cmd, nil
}

// RunCombinedOutput runs git and returns combined stdout/stderr with normalized errors.
func RunCombinedOutput(ctx context.Context, repoRoot string, env []string, args ...string) ([]byte, error) {
	return runCombinedOutput(ctx, repoRoot, env, nil, args...)
}

// RunCombinedOutputAllowExitCodes runs git and treats selected exit codes as success.
func RunCombinedOutputAllowExitCodes(ctx context.Context, repoRoot string, env []string, allowedExitCodes []int, args ...string) ([]byte, error) {
	return runCombinedOutput(ctx, repoRoot, env, allowedExitCodes, args...)
}

func runCombinedOutput(ctx context.Context, repoRoot string, env []string, allowedExitCodes []int, args ...string) ([]byte, error) {
	cmd, err := CommandContext(ctx, repoRoot, env, args...)
	if err != nil {
		return nil, err
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) && containsExitCode(allowedExitCodes, exitErr.ExitCode()) {
			return out, nil
		}
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("git %s failed: %s", strings.Join(args, " "), msg)
	}
	return out, nil
}

func containsExitCode(allowedExitCodes []int, code int) bool {
	for _, allowed := range allowedExitCodes {
		if allowed == code {
			return true
		}
	}
	return false
}

// ShowTopLevel resolves the git worktree root for dir.
func ShowTopLevel(ctx context.Context, dir string) (string, bool) {
	dir = filepath.Clean(strings.TrimSpace(dir))
	if dir == "" {
		return "", false
	}
	out, err := RunCombinedOutput(ctx, dir, nil, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", false
	}
	root := filepath.Clean(strings.TrimSpace(string(out)))
	if root == "" {
		return "", false
	}
	if mapped := preferOriginalPathRoot(dir, root); mapped != "" {
		return mapped, true
	}
	return root, true
}

func preferOriginalPathRoot(dir string, root string) string {
	dirEval, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return ""
	}
	rootEval, err := filepath.EvalSymlinks(root)
	if err != nil {
		return ""
	}
	dirEval = filepath.Clean(dirEval)
	rootEval = filepath.Clean(rootEval)
	if dirEval == rootEval {
		return dir
	}
	rel, err := filepath.Rel(rootEval, dirEval)
	if err != nil {
		return ""
	}
	rel = filepath.Clean(rel)
	if rel == "." {
		return dir
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return ""
	}
	mapped := dir
	for _, part := range strings.Split(rel, string(filepath.Separator)) {
		if part == "" || part == "." {
			continue
		}
		mapped = filepath.Dir(mapped)
	}
	return filepath.Clean(mapped)
}
