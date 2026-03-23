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
`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write task spec: %v", err)
	}

	tasks, err := loadTaskSpecs(path)
	if err != nil {
		t.Fatalf("loadTaskSpecs: %v", err)
	}
	if len(tasks) != 1 {
		t.Fatalf("len(tasks)=%d, want 1", len(tasks))
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
}
