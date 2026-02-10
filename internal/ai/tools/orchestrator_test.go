package tools

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestClassifyError_InvalidPathProducesNormalizedArgs(t *testing.T) {
	t.Parallel()

	root := filepath.Clean("/tmp/workspace")
	inv := Invocation{
		ToolName: "fs.list_dir",
		FSRoot:   root,
		Args: map[string]any{
			"path": "docs",
		},
	}
	err := ClassifyError(inv, errors.New("invalid path: must be absolute"))
	if err == nil {
		t.Fatalf("expected tool error")
	}
	if err.Code != ErrorCodeInvalidPath {
		t.Fatalf("code=%q, want=%q", err.Code, ErrorCodeInvalidPath)
	}
	if !err.Retryable {
		t.Fatalf("retryable=false, want true")
	}
	if got := err.NormalizedArgs["path"]; got != "/docs" {
		t.Fatalf("normalized path=%v", got)
	}
}

func TestClassifyError_NotFound(t *testing.T) {
	t.Parallel()

	err := ClassifyError(Invocation{ToolName: "fs.stat"}, errors.New("not found"))
	if err == nil {
		t.Fatalf("expected tool error")
	}
	if err.Code != ErrorCodeNotFound {
		t.Fatalf("code=%q, want=%q", err.Code, ErrorCodeNotFound)
	}
	if err.Retryable {
		t.Fatalf("retryable=true, want false")
	}
}

func TestShouldRetryWithNormalizedArgs(t *testing.T) {
	t.Parallel()

	te := &ToolError{
		Code:      ErrorCodeOutsideWorkspace,
		Message:   "path outside workspace root",
		Retryable: true,
		NormalizedArgs: map[string]any{
			"path": "/tmp/workspace",
		},
	}
	if !ShouldRetryWithNormalizedArgs(te) {
		t.Fatalf("expected retry with normalized args")
	}
}

func TestClassifyError_NotFoundWithRootAlignedAbsolutePath(t *testing.T) {
	t.Parallel()

	root := filepath.Clean("/Users/tangjianyin/Downloads/code/redeven")
	inv := Invocation{
		ToolName: "fs.list_dir",
		FSRoot:   root,
		Args: map[string]any{
			"path": "/Downloads/code/redeven",
		},
	}
	err := ClassifyError(inv, errors.New("not found"))
	if err == nil {
		t.Fatalf("expected tool error")
	}
	if err.Code != ErrorCodeNotFound {
		t.Fatalf("code=%q, want=%q", err.Code, ErrorCodeNotFound)
	}
	if !err.Retryable {
		t.Fatalf("retryable=false, want true")
	}
	if got := err.NormalizedArgs["path"]; got != "/" {
		t.Fatalf("normalized path=%v, want=/", got)
	}
}

func TestShouldRetryWithNormalizedArgs_NotFound(t *testing.T) {
	t.Parallel()

	te := &ToolError{
		Code:      ErrorCodeNotFound,
		Message:   "not found",
		Retryable: true,
		NormalizedArgs: map[string]any{
			"path": "/",
		},
	}
	if !ShouldRetryWithNormalizedArgs(te) {
		t.Fatalf("expected retry with normalized args for not found")
	}
}
