package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPrepareTaskSandbox_SourceReadonlyReusesSourceWorkspaceAndCreatesState(t *testing.T) {
	t.Parallel()

	source := t.TempDir()
	workspaceRoot := filepath.Join(t.TempDir(), "workspaces")
	stateRoot := filepath.Join(t.TempDir(), "state")

	sandbox, err := prepareTaskSandbox(workspaceRoot, stateRoot, "task/demo", source, evalTaskWorkspace{
		Mode: taskWorkspaceModeSourceReadonly,
	})
	if err != nil {
		t.Fatalf("prepareTaskSandbox: %v", err)
	}

	if sandbox.WorkspacePath != source {
		t.Fatalf("WorkspacePath=%q, want %q", sandbox.WorkspacePath, source)
	}
	if sandbox.WorkspaceMode != taskWorkspaceModeSourceReadonly {
		t.Fatalf("WorkspaceMode=%q, want %q", sandbox.WorkspaceMode, taskWorkspaceModeSourceReadonly)
	}
	if sandbox.WorkspaceSeed != source {
		t.Fatalf("WorkspaceSeed=%q, want %q", sandbox.WorkspaceSeed, source)
	}
	if want := filepath.Join(stateRoot, "task_demo"); sandbox.StateDir != want {
		t.Fatalf("StateDir=%q, want %q", sandbox.StateDir, want)
	}
	if info, err := os.Stat(sandbox.StateDir); err != nil {
		t.Fatalf("sandbox state dir missing: %v", err)
	} else if !info.IsDir() {
		t.Fatalf("sandbox state path is not a directory")
	}
}

func TestPrepareTaskSandbox_NoneCreatesEmptyWorkspace(t *testing.T) {
	t.Parallel()

	workspaceRoot := filepath.Join(t.TempDir(), "workspaces")
	stateRoot := filepath.Join(t.TempDir(), "state")

	sandbox, err := prepareTaskSandbox(workspaceRoot, stateRoot, "task/demo", "", evalTaskWorkspace{
		Mode: taskWorkspaceModeNone,
	})
	if err != nil {
		t.Fatalf("prepareTaskSandbox: %v", err)
	}

	if want := filepath.Join(workspaceRoot, "task_demo"); sandbox.WorkspacePath != want {
		t.Fatalf("WorkspacePath=%q, want %q", sandbox.WorkspacePath, want)
	}
	if sandbox.WorkspaceMode != taskWorkspaceModeNone {
		t.Fatalf("WorkspaceMode=%q, want %q", sandbox.WorkspaceMode, taskWorkspaceModeNone)
	}
	entries, err := os.ReadDir(sandbox.WorkspacePath)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("workspace entries=%d, want 0", len(entries))
	}
}

func TestPrepareTaskSandbox_FixtureCopyMaterializesFixture(t *testing.T) {
	t.Parallel()

	fixture := t.TempDir()
	workspaceRoot := filepath.Join(t.TempDir(), "workspaces")
	stateRoot := filepath.Join(t.TempDir(), "state")

	if err := os.WriteFile(filepath.Join(fixture, "README.md"), []byte("fixture\n"), 0o600); err != nil {
		t.Fatalf("write fixture file: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(fixture, "docs"), 0o755); err != nil {
		t.Fatalf("mkdir fixture docs: %v", err)
	}
	if err := os.WriteFile(filepath.Join(fixture, "docs", "note.txt"), []byte("nested\n"), 0o600); err != nil {
		t.Fatalf("write fixture nested file: %v", err)
	}

	sandbox, err := prepareTaskSandbox(workspaceRoot, stateRoot, "task/demo", "", evalTaskWorkspace{
		Mode:        taskWorkspaceModeFixtureCopy,
		FixturePath: fixture,
	})
	if err != nil {
		t.Fatalf("prepareTaskSandbox: %v", err)
	}

	if want := filepath.Join(workspaceRoot, "task_demo"); sandbox.WorkspacePath != want {
		t.Fatalf("WorkspacePath=%q, want %q", sandbox.WorkspacePath, want)
	}
	if sandbox.WorkspaceMode != taskWorkspaceModeFixtureCopy {
		t.Fatalf("WorkspaceMode=%q, want %q", sandbox.WorkspaceMode, taskWorkspaceModeFixtureCopy)
	}
	if sandbox.WorkspaceSeed != fixture {
		t.Fatalf("WorkspaceSeed=%q, want %q", sandbox.WorkspaceSeed, fixture)
	}
	if _, err := os.Stat(filepath.Join(sandbox.WorkspacePath, "README.md")); err != nil {
		t.Fatalf("sandbox workspace missing README.md: %v", err)
	}
	if _, err := os.Stat(filepath.Join(sandbox.WorkspacePath, "docs", "note.txt")); err != nil {
		t.Fatalf("sandbox workspace missing nested note: %v", err)
	}
}
