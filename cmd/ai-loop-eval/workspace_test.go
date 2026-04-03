package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPrepareTaskSandbox_CreatesIsolatedWorkspaceAndState(t *testing.T) {
	t.Parallel()

	source := t.TempDir()
	workspaceRoot := filepath.Join(t.TempDir(), "workspaces")
	stateRoot := filepath.Join(t.TempDir(), "state")

	if err := os.WriteFile(filepath.Join(source, "README.md"), []byte("sandbox source\n"), 0o600); err != nil {
		t.Fatalf("write source file: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(source, "docs"), 0o755); err != nil {
		t.Fatalf("mkdir docs: %v", err)
	}
	if err := os.WriteFile(filepath.Join(source, "docs", "note.txt"), []byte("nested\n"), 0o600); err != nil {
		t.Fatalf("write nested file: %v", err)
	}

	sandbox, err := prepareTaskSandbox(workspaceRoot, stateRoot, "task/demo", source)
	if err != nil {
		t.Fatalf("prepareTaskSandbox: %v", err)
	}

	if want := filepath.Join(workspaceRoot, "task_demo"); sandbox.WorkspacePath != want {
		t.Fatalf("WorkspacePath=%q, want %q", sandbox.WorkspacePath, want)
	}
	if want := filepath.Join(stateRoot, "task_demo"); sandbox.StateDir != want {
		t.Fatalf("StateDir=%q, want %q", sandbox.StateDir, want)
	}
	if _, err := os.Stat(filepath.Join(sandbox.WorkspacePath, "README.md")); err != nil {
		t.Fatalf("sandbox workspace missing README.md: %v", err)
	}
	if _, err := os.Stat(filepath.Join(sandbox.WorkspacePath, "docs", "note.txt")); err != nil {
		t.Fatalf("sandbox workspace missing nested note: %v", err)
	}
	if info, err := os.Stat(sandbox.StateDir); err != nil {
		t.Fatalf("sandbox state dir missing: %v", err)
	} else if !info.IsDir() {
		t.Fatalf("sandbox state path is not a directory")
	}
}
