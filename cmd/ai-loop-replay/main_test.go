package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRunReplay_UsesTaskCompleteFallback(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "message.log.json")
	content := `{
  "ok": true,
  "data": {
    "messages": [
      {
        "role": "assistant",
        "blocks": [
          {
            "type": "tool-call",
            "toolName": "task_complete",
            "args": {
              "result": "Completed the verification and documented the remaining risks."
            }
          }
        ]
      }
    ]
  }
}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	report, err := runReplay(path)
	if err != nil {
		t.Fatalf("runReplay: %v", err)
	}
	if report.Status != "pass" {
		t.Fatalf("status=%q reasons=%v", report.Status, report.Reasons)
	}
	if report.AssistantChars == 0 {
		t.Fatalf("expected structured fallback text to count as assistant text")
	}
}

func TestRunReplay_UsesAskUserFallback(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "message.log.json")
	content := `{
  "ok": true,
  "data": {
    "messages": [
      {
        "role": "assistant",
        "blocks": [
          {
            "type": "tool-call",
            "toolName": "ask_user",
            "args": {
              "questions": [
                {
                  "header": "Need mode switch",
                  "question": "Switch this thread to act mode so I can apply the change."
                }
              ]
            },
            "result": {
              "waiting_user": true
            }
          }
        ]
      }
    ]
  }
}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	report, err := runReplay(path)
	if err != nil {
		t.Fatalf("runReplay: %v", err)
	}
	if report.Status != "pass" {
		t.Fatalf("status=%q reasons=%v", report.Status, report.Reasons)
	}
	if report.AssistantChars == 0 {
		t.Fatalf("expected ask_user fallback text to count as assistant text")
	}
}
