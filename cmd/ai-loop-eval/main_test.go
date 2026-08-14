package main

import (
	"encoding/json"
	"testing"

	"github.com/floegence/floret/v4/identity"
	"github.com/floegence/floret/v4/observation"
	flruntime "github.com/floegence/floret/v4/runtime"
)

func TestObserveTypedTurnUsesInteractionAndTurnScopedToolState(t *testing.T) {
	t.Parallel()

	turnID := identity.TurnID("turn_eval_1")
	current := flruntime.ThreadView{
		Thread:   flruntime.ThreadSnapshot{ID: identity.ThreadID("thread_eval")},
		Version:  3,
		Activity: flruntime.ThreadActivityActive,
		TurnID:   turnID,
		Interactions: []flruntime.ThreadInteraction{{
			ID: "interaction_approval", Kind: flruntime.ThreadInteractionApproval,
		}},
		Items: []flruntime.ThreadItem{
			{ID: "tool_current", TurnID: turnID, Kind: flruntime.ThreadItemTool, Activity: &observation.ActivityItem{ToolID: "tool_current", ToolName: "terminal.exec", Status: observation.ActivityStatusWaiting, RequiresApproval: true}},
			{ID: "tool_previous", TurnID: identity.TurnID("turn_old"), Kind: flruntime.ThreadItemTool, Activity: &observation.ActivityItem{ToolID: "tool_previous", ToolName: "terminal.exec", Status: observation.ActivityStatusSuccess}},
		},
	}

	observation := observeTypedTurn(current, turnID)
	if observation.Terminal {
		t.Fatal("active turn was reported terminal")
	}
	if len(observation.PendingApprovals) != 1 || observation.PendingApprovals[0] != "interaction_approval" {
		t.Fatalf("pending approvals=%v", observation.PendingApprovals)
	}
	if observation.ToolCallCount != 1 || observation.ToolErrorCount != 0 {
		t.Fatalf("tool counts=(%d,%d), want current turn only", observation.ToolCallCount, observation.ToolErrorCount)
	}

	current.Activity = flruntime.ThreadActivityIdle
	current.Outcome = flruntime.TurnOutcomeCompleted
	observation = observeTypedTurn(current, turnID)
	if !observation.Terminal || observation.RunError != "" {
		t.Fatalf("completed observation=%+v", observation)
	}
}

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

func TestCanonicalToolCallsFromMessagePagesUsesLatestActivityProjection(t *testing.T) {
	t.Parallel()

	pages := [][]any{
		{
			map[string]any{
				"blocks": []any{
					map[string]any{
						"type":   "activity-timeline",
						"run_id": "run_1",
						"items": []any{
							map[string]any{
								"tool_id":   "tool_1",
								"tool_name": "terminal.exec",
								"status":    "success",
								"payload": map[string]any{
									"command":   "go test ./...",
									"exit_code": 0,
								},
							},
						},
					},
				},
			},
		},
		{
			map[string]any{
				"blocks": []any{
					map[string]any{
						"type":   "activity-timeline",
						"run_id": "run_1",
						"items": []any{
							map[string]any{
								"tool_id":   "tool_1",
								"tool_name": "terminal.exec",
								"status":    "running",
								"payload": map[string]any{
									"command": "go test ./...",
								},
							},
						},
					},
				},
			},
		},
	}

	calls := canonicalToolCallsFromMessagePages(pages)
	if len(calls) != 1 {
		t.Fatalf("tool call count=%d, want 1", len(calls))
	}
	call := calls[0]
	if call.RunID != "run_1" || call.ToolID != "tool_1" || call.ToolName != "terminal.exec" || call.Status != "success" {
		t.Fatalf("canonical tool call=%+v", call)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(call.ArgsJSON), &payload); err != nil {
		t.Fatalf("decode canonical payload: %v", err)
	}
	if got := payload["command"]; got != "go test ./..." {
		t.Fatalf("command=%v, want go test ./...", got)
	}
	if got := payload["exit_code"]; got != float64(0) {
		t.Fatalf("exit_code=%v, want 0", got)
	}
}
