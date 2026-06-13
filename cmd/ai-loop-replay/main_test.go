package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRunReplay_UsesActivityTimelineAndFinalText(t *testing.T) {
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
            "type": "activity-timeline",
            "schema_version": 1,
            "run_id": "run_1",
            "summary": {
              "status": "success",
              "severity": "quiet",
              "needs_attention": false,
              "total_items": 1,
              "counts": {
                "success": 1
              }
            },
            "items": [
              {
                "item_id": "tool_done",
                "tool_id": "tool_done",
                "tool_name": "task_complete",
                "kind": "control",
                "status": "success",
                "severity": "quiet",
                "needs_attention": false,
                "requires_approval": false
              }
            ]
          },
          {
            "type": "text",
            "content": "Completed the verification and documented the remaining risks."
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
		t.Fatalf("expected final text to count as assistant text")
	}
	if report.ToolCalls != 1 {
		t.Fatalf("toolCalls=%d, want 1", report.ToolCalls)
	}
}

func TestRunReplay_RejectsActivityOnlyAssistantOutput(t *testing.T) {
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
            "type": "activity-timeline",
            "schema_version": 1,
            "run_id": "run_1",
            "summary": {
              "status": "waiting",
              "severity": "blocking",
              "needs_attention": true,
              "attention_reasons": ["waiting"],
              "total_items": 1,
              "counts": {
                "waiting": 1
              }
            },
            "items": [
              {
                "item_id": "tool_ask",
                "tool_id": "tool_ask",
                "tool_name": "ask_user",
                "kind": "control",
                "status": "waiting",
                "severity": "blocking",
                "needs_attention": true,
                "attention_reasons": ["waiting"],
                "requires_approval": false
              }
            ]
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
	if report.Status != "fail" {
		t.Fatalf("status=%q reasons=%v, want fail", report.Status, report.Reasons)
	}
	if report.AssistantChars != 0 {
		t.Fatalf("assistantChars=%d, want 0", report.AssistantChars)
	}
	if report.ToolCalls != 1 {
		t.Fatalf("toolCalls=%d, want 1", report.ToolCalls)
	}
}
