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
	content := `version: v1

tasks:
  - id: sample
    title: Sample
    stage: screen
    category: generic
    turns:
      - "Analyze ${workspace}"
    max_steps: 3
    timeout_seconds: 20
    require_evidence: true
    must_contain:
      - "result"
    forbidden:
      - "No response"
`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write task spec: %v", err)
	}

	tasks, err := loadTaskSpecs(path, "/tmp/workspace")
	if err != nil {
		t.Fatalf("loadTaskSpecs: %v", err)
	}
	if len(tasks) != 1 {
		t.Fatalf("len(tasks)=%d, want 1", len(tasks))
	}
	if tasks[0].Turns[0] != "Analyze /tmp/workspace" {
		t.Fatalf("turn=%q", tasks[0].Turns[0])
	}
}
