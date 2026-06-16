package main

import "testing"

func TestMatchesRequirement_WithAlternatives(t *testing.T) {
	t.Parallel()

	if !matchesRequirement("the project has clear structure", "structure|module") {
		t.Fatalf("expected matchesRequirement to match alternative token")
	}
	if matchesRequirement("short text", "risk") {
		t.Fatalf("expected matchesRequirement to fail when no alternative matches")
	}
}

func TestExtractEvidencePaths_FiltersToWorkspace(t *testing.T) {
	t.Parallel()

	workspace := "/tmp/eval/workspace"
	text := "Use /tmp/eval/workspace/README.md and /tmp/eval/workspace/cmd/app/main.go, not /etc/hosts."
	paths := extractEvidencePaths(text, workspace)
	if len(paths) != 2 {
		t.Fatalf("len(paths)=%d, want 2", len(paths))
	}
	if paths[0] != "/tmp/eval/workspace/README.md" {
		t.Fatalf("paths[0]=%q", paths[0])
	}
	if paths[1] != "/tmp/eval/workspace/cmd/app/main.go" {
		t.Fatalf("paths[1]=%q", paths[1])
	}
}

func TestRenderTaskTurns_ReplacesWorkspacePlaceholder(t *testing.T) {
	t.Parallel()

	turns := renderTaskTurns([]string{"Analyze ${workspace}", "continue in ${workspace}"}, "/tmp/run")
	if turns[0] != "Analyze /tmp/run" {
		t.Fatalf("turns[0]=%q", turns[0])
	}
	if turns[1] != "continue in /tmp/run" {
		t.Fatalf("turns[1]=%q", turns[1])
	}
}

func TestStreamMonitorConsumesSnakeCaseActivityTimelineItems(t *testing.T) {
	t.Parallel()

	monitor := newStreamMonitor(nil, nil, "thread_1", "run_1", nil, func() {})
	monitor.consumeBlock(map[string]any{
		"type": "activity-timeline",
		"items": []any{
			map[string]any{
				"item_id":           "tool_1",
				"tool_id":           "tool_1",
				"tool_name":         "terminal.exec",
				"kind":              "tool",
				"status":            "success",
				"severity":          "quiet",
				"needs_attention":   false,
				"requires_approval": false,
			},
		},
	})

	if got := monitor.toolSigCounter["terminal.exec|{}"]; got != 1 {
		t.Fatalf("tool signature count=%d, want 1", got)
	}
}

func TestExtractLatestAssistantTextIgnoresRawToolCallBlocks(t *testing.T) {
	t.Parallel()

	got := visibleAssistantTextFromBlocks([]any{
		map[string]any{
			"type":     "tool-call",
			"toolName": "task_complete",
			"args": map[string]any{
				"result": "This raw tool payload must not become visible output.",
			},
		},
	})
	if got != "" {
		t.Fatalf("visibleAssistantTextFromBlocks()=%q, want empty", got)
	}
}
