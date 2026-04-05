package tools

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

type orchestratorInvalidArgsError struct{}

func (orchestratorInvalidArgsError) Error() string {
	return "invalid arguments: inspect requires target or ids"
}

func (orchestratorInvalidArgsError) InvalidArgumentsCode() string {
	return "invalid_arguments.subagents.inspect_requires_target_or_ids"
}

func (orchestratorInvalidArgsError) InvalidArgumentsMeta() map[string]any {
	return map[string]any{"action": "inspect"}
}

func TestClassifyError_InvalidPathProducesNormalizedArgs(t *testing.T) {
	t.Parallel()

	home := t.TempDir()
	workspace := filepath.Join(home, "workspace")
	if err := os.MkdirAll(filepath.Join(workspace, "docs"), 0o755); err != nil {
		t.Fatalf("MkdirAll docs: %v", err)
	}

	inv := Invocation{
		ToolName:     "terminal.exec",
		WorkingDir:   workspace,
		AgentHomeDir: home,
		Args: map[string]any{
			"cwd": filepath.Join(workspace, "..", "workspace", "docs") + string(os.PathSeparator),
		},
	}
	toolErr := ClassifyError(inv, errors.New("invalid path"))
	if toolErr == nil {
		t.Fatalf("expected tool error")
	}
	if toolErr.Code != ErrorCodeInvalidPath {
		t.Fatalf("code=%q, want=%q", toolErr.Code, ErrorCodeInvalidPath)
	}
	if !toolErr.Retryable {
		t.Fatalf("retryable=false, want true")
	}
	wantDir, err := filepath.EvalSymlinks(filepath.Join(workspace, "docs"))
	if err != nil {
		t.Fatalf("EvalSymlinks(docs): %v", err)
	}
	if got := toolErr.NormalizedArgs["cwd"]; got != wantDir {
		t.Fatalf("normalized cwd=%v, want=%v", got, wantDir)
	}
}

func TestClassifyError_InvalidPathNormalizesRelativePath(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	inv := Invocation{
		ToolName:     "terminal.exec",
		WorkingDir:   root,
		AgentHomeDir: root,
		Args: map[string]any{
			"workdir": "docs/readme.md",
		},
	}
	toolErr := ClassifyError(inv, errors.New("path must be absolute"))
	if toolErr == nil {
		t.Fatalf("expected tool error")
	}
	if toolErr.Code != ErrorCodeInvalidPath {
		t.Fatalf("code=%q, want=%q", toolErr.Code, ErrorCodeInvalidPath)
	}
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatalf("EvalSymlinks(root): %v", err)
	}
	want := filepath.Join(resolvedRoot, "docs", "readme.md")
	if got := toolErr.NormalizedArgs["workdir"]; got != want {
		t.Fatalf("normalized workdir=%v, want=%v", got, want)
	}
}

func TestClassifyError_InvalidPathDoesNotNormalizeOutsideProjectRoot(t *testing.T) {
	t.Parallel()

	home := t.TempDir()
	project := filepath.Join(home, "workspace")
	other := filepath.Join(home, "other")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatalf("MkdirAll project: %v", err)
	}
	if err := os.MkdirAll(other, 0o755); err != nil {
		t.Fatalf("MkdirAll other: %v", err)
	}

	inv := Invocation{
		ToolName:     "terminal.exec",
		WorkingDir:   project,
		AgentHomeDir: home,
		Args: map[string]any{
			"cwd": filepath.Join(other, "docs"),
		},
	}
	toolErr := ClassifyError(inv, errors.New("invalid cwd"))
	if toolErr == nil {
		t.Fatalf("expected tool error")
	}
	if len(toolErr.NormalizedArgs) != 0 {
		t.Fatalf("normalized args=%v, want none for outside-project path", toolErr.NormalizedArgs)
	}
}

func TestClassifyError_NotFound(t *testing.T) {
	t.Parallel()

	toolErr := ClassifyError(Invocation{ToolName: "apply_patch"}, errors.New("not found"))
	if toolErr == nil {
		t.Fatalf("expected tool error")
	}
	if toolErr.Code != ErrorCodeNotFound {
		t.Fatalf("code=%q, want=%q", toolErr.Code, ErrorCodeNotFound)
	}
	if toolErr.Retryable {
		t.Fatalf("retryable=true, want false")
	}
}

func TestShouldRetryWithNormalizedArgs(t *testing.T) {
	t.Parallel()

	toolErr := &ToolError{
		Code:      ErrorCodeInvalidPath,
		Message:   "path must be absolute",
		Retryable: true,
		NormalizedArgs: map[string]any{
			"path": "/tmp/workspace",
		},
	}
	if !ShouldRetryWithNormalizedArgs(toolErr) {
		t.Fatalf("expected retry with normalized args")
	}
}

func TestShouldRetryWithNormalizedArgs_NotFound(t *testing.T) {
	t.Parallel()

	toolErr := &ToolError{
		Code:      ErrorCodeNotFound,
		Message:   "not found",
		Retryable: true,
		NormalizedArgs: map[string]any{
			"path": "/tmp/workspace",
		},
	}
	if ShouldRetryWithNormalizedArgs(toolErr) {
		t.Fatalf("did not expect normalized retry for not found")
	}
}

func TestClassifyError_InvalidArguments(t *testing.T) {
	t.Parallel()

	toolErr := ClassifyError(Invocation{ToolName: "subagents"}, orchestratorInvalidArgsError{})
	if toolErr == nil {
		t.Fatalf("expected tool error")
	}
	if toolErr.Code != ErrorCodeInvalidArguments {
		t.Fatalf("code=%q, want=%q", toolErr.Code, ErrorCodeInvalidArguments)
	}
	if toolErr.Retryable {
		t.Fatalf("retryable=true, want false")
	}
	if got := toolErr.Meta["validation_error_code"]; got != "invalid_arguments.subagents.inspect_requires_target_or_ids" {
		t.Fatalf("validation_error_code=%v, want inspect contract code", got)
	}
}
