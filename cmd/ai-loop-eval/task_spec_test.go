package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadTaskSpecs(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "tasks.yaml")
	fixtureDir := filepath.Join(dir, "fixtures", "sample")
	if err := os.MkdirAll(fixtureDir, 0o755); err != nil {
		t.Fatalf("mkdir fixture: %v", err)
	}
	content := `version: v2

tasks:
  - id: sample
    title: Sample
    stage: screen
    category: generic
    turns:
      - "Analyze ${workspace}"
    runtime:
      execution_mode: plan
      max_steps: 3
      max_no_tool_rounds: 1
      timeout_seconds: 20
      no_user_interaction: true
    assertions:
      output:
        require_evidence: true
        min_evidence_paths: 2
        must_contain:
          - "result"
      thread:
        run_status: waiting_user
        execution_mode: plan
        waiting_prompt: required
      tools:
        must_call:
          - "ask_user"
        workspace_scoped_tools:
          - "apply_patch"
  - id: fixture_task
    title: Fixture Task
    stage: deep
    category: generic
    turns:
      - "Mutate ${workspace}"
    runtime:
      execution_mode: act
      max_steps: 2
      timeout_seconds: 15
      workspace:
        mode: fixture_copy
        fixture: ./fixtures/sample
`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write task spec: %v", err)
	}

	tasks, err := loadTaskSpecs(path)
	if err != nil {
		t.Fatalf("loadTaskSpecs: %v", err)
	}
	if len(tasks) != 2 {
		t.Fatalf("len(tasks)=%d, want 2", len(tasks))
	}
	if tasks[0].Turns[0] != "Analyze ${workspace}" {
		t.Fatalf("turn=%q", tasks[0].Turns[0])
	}
	if tasks[0].Runtime.ExecutionMode != "plan" {
		t.Fatalf("execution_mode=%q", tasks[0].Runtime.ExecutionMode)
	}
	if !tasks[0].Runtime.NoUserInteraction {
		t.Fatalf("expected no_user_interaction=true")
	}
	if tasks[0].Assertions.Thread.WaitingPrompt != "required" {
		t.Fatalf("waiting_prompt=%q", tasks[0].Assertions.Thread.WaitingPrompt)
	}
	if len(tasks[0].Assertions.Tools.WorkspaceScopedTools) != 1 || tasks[0].Assertions.Tools.WorkspaceScopedTools[0] != "apply_patch" {
		t.Fatalf("workspace_scoped_tools=%v", tasks[0].Assertions.Tools.WorkspaceScopedTools)
	}
	if tasks[0].Runtime.Workspace.Mode != taskWorkspaceModeSourceReadonly {
		t.Fatalf("workspace.mode=%q, want %q", tasks[0].Runtime.Workspace.Mode, taskWorkspaceModeSourceReadonly)
	}
	if tasks[1].Runtime.Workspace.Mode != taskWorkspaceModeFixtureCopy {
		t.Fatalf("fixture workspace.mode=%q, want %q", tasks[1].Runtime.Workspace.Mode, taskWorkspaceModeFixtureCopy)
	}
	if tasks[1].Runtime.Workspace.FixturePath != fixtureDir {
		t.Fatalf("fixture path=%q, want %q", tasks[1].Runtime.Workspace.FixturePath, fixtureDir)
	}
}

func TestLoadTaskSpecs_InvalidWorkspaceMode(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "tasks.yaml")
	content := `version: v2

tasks:
  - id: bad_mode
    title: Bad Mode
    stage: screen
    turns:
      - "Inspect ${workspace}"
    runtime:
      workspace:
        mode: full_clone
`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write task spec: %v", err)
	}

	if _, err := loadTaskSpecs(path); err == nil {
		t.Fatalf("expected invalid workspace mode error")
	}
}
