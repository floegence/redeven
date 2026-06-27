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
      permission_type: readonly
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
        permission_type: readonly
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
      permission_type: approval_required
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
	if tasks[0].Runtime.PermissionType != "readonly" {
		t.Fatalf("permission_type=%q", tasks[0].Runtime.PermissionType)
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

func TestLoadTaskSpecs_RejectsLegacyPermissionFields(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		runtime string
	}{
		{
			name: "execution_mode",
			runtime: `      execution_mode: plan
`,
		},
		{
			name: "mode",
			runtime: `      mode: act
`,
		},
		{
			name: "execution_policy",
			runtime: `      execution_policy:
        require_user_approval: true
        block_dangerous_commands: true
`,
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			dir := t.TempDir()
			path := filepath.Join(dir, "tasks.yaml")
			content := `version: v2

tasks:
  - id: legacy_permission
    title: Legacy Permission
    stage: screen
    turns:
      - "Inspect ${workspace}"
    runtime:
` + tc.runtime
			if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
				t.Fatalf("write task spec: %v", err)
			}

			if _, err := loadTaskSpecs(path); err == nil {
				t.Fatalf("expected legacy runtime field %s to be rejected", tc.name)
			}
		})
	}
}
