package main

import (
	"testing"

	"github.com/floegence/redeven-agent/internal/ai"
	"github.com/floegence/redeven-agent/internal/ai/threadstore"
)

func TestDetectPhasePingPong(t *testing.T) {
	t.Parallel()
	flow := []string{
		"completion:needs_synthesis_after_tool_calls",
		"task:analysis_requires_more_evidence",
		"completion:needs_synthesis_after_tool_calls",
		"task:analysis_requires_more_evidence",
		"completion:needs_synthesis_after_tool_calls",
		"task:analysis_requires_more_evidence",
	}
	if !detectPhasePingPong(flow) {
		t.Fatalf("expected ping-pong detection")
	}
}

func TestEvaluateGate_RejectBelowBaseline(t *testing.T) {
	t.Parallel()

	metrics := suiteMetrics{
		PassRate:            0.60,
		LoopSafetyRate:      0.80,
		RecoverySuccessRate: 0.70,
		FallbackFreeRate:    0.75,
		AverageAccuracy:     65,
	}
	baselines := benchmarkBaselines{Sources: map[string]benchmarkMetrics{
		"codex": {
			PassRate:            0.85,
			LoopSafetyRate:      0.95,
			RecoverySuccessRate: 0.85,
			FallbackFreeRate:    0.95,
			AverageAccuracy:     80,
		},
	}}
	thresholds := gateThresholds{
		MinPassRate:         0.8,
		MinLoopSafetyRate:   0.9,
		MinFallbackFreeRate: 0.9,
		MinAverageAccuracy:  75,
	}
	report := evaluateGate(metrics, baselines, thresholds)
	if report.Status != "reject" {
		t.Fatalf("status=%s, want reject", report.Status)
	}
	if report.Passed {
		t.Fatalf("expected gate to fail")
	}
}

func TestAssessTaskOutcome_PassesStructuredFlowerAssertions(t *testing.T) {
	t.Parallel()

	task := evalTask{
		ID: "todo_task",
		Assertions: taskAssertionsSpec{
			Output: taskOutputAssertions{
				RequireEvidence:  true,
				MinEvidencePaths: 2,
				MustContain:      []string{"risk"},
				MinLength:        60,
			},
			Thread: taskThreadAssertions{
				RunStatus:     "success",
				ExecutionMode: "act",
				WaitingPrompt: "forbidden",
			},
			Tools: taskToolAssertions{
				MustCall:    []string{"terminal.exec", "write_todos", "task_complete"},
				MustSucceed: []string{"terminal.exec", "write_todos", "task_complete"},
				MustNotCall: []string{"apply_patch"},
				MaxCalls:    6,
			},
			Events: taskEventAssertions{
				MustInclude: []string{"todos.updated"},
				HardFail:    []string{"turn.loop.exhausted"},
			},
			Todos: taskTodoAssertions{
				RequireSnapshot:             true,
				RequireNonEmpty:             true,
				RequireClosed:               true,
				RequireInProgressDiscipline: true,
			},
		},
	}
	result := taskResult{
		Task:          task,
		WorkspacePath: "/tmp/workspace",
		FinalText:     "Risk: config drift. Evidence: /tmp/workspace/README.md and /tmp/workspace/cmd/app/main.go. Verification: run tests.",
		EvidencePaths: []string{"/tmp/workspace/README.md", "/tmp/workspace/cmd/app/main.go"},
		ThreadState: threadStateSummary{
			RunStatus:     "success",
			ExecutionMode: "act",
			WaitingPrompt: false,
		},
		EventCounts: map[string]int{"todos.updated": 1},
		rawToolCalls: []threadstore.ToolCallRecord{
			{ToolName: "terminal.exec", Status: "success"},
			{ToolName: "write_todos", Status: "success", ArgsJSON: `{"todos":[{"content":"Inspect repo","status":"in_progress"},{"content":"Summarize risk","status":"pending"},{"content":"Verify command","status":"pending"}]}`},
			{ToolName: "write_todos", Status: "success", ArgsJSON: `{"todos":[{"content":"Inspect repo","status":"completed"},{"content":"Summarize risk","status":"completed"},{"content":"Verify command","status":"completed"}]}`},
			{ToolName: "task_complete", Status: "success"},
		},
		rawTodos: &ai.ThreadTodosView{
			Version: 1,
			Todos: []ai.TodoItem{
				{Content: "Inspect repo", Status: ai.TodoStatusCompleted},
				{Content: "Summarize risk", Status: ai.TodoStatusCompleted},
				{Content: "Verify command", Status: ai.TodoStatusCompleted},
			},
		},
	}
	outcome := assessTaskOutcome(task, result)
	if !outcome.Passed {
		t.Fatalf("expected passing outcome, got reasons=%v", outcome.HardFailReasons)
	}
	if !outcome.LoopSafe {
		t.Fatalf("expected loop-safe outcome")
	}
}

func TestAssessTaskOutcome_FallbackFails(t *testing.T) {
	t.Parallel()
	task := evalTask{
		ID: "t1",
		Assertions: taskAssertionsSpec{
			Output: taskOutputAssertions{
				RequireEvidence: true,
				MustContain:     []string{"conclusion"},
				Forbidden:       []string{"No response"},
			},
			Events: taskEventAssertions{
				HardFail: []string{"turn.loop.exhausted"},
			},
		},
	}
	result := taskResult{
		Task:          task,
		WorkspacePath: "/workspace",
		FinalText:     "I have reached the current automatic loop limit. Reply with one concrete next step.",
		Turns: []turnMetrics{{
			LoopExhausted: true,
		}},
	}
	outcome := assessTaskOutcome(task, result)
	if outcome.Passed {
		t.Fatalf("expected failure outcome")
	}
	if outcome.LoopSafe {
		t.Fatalf("expected loop unsafe outcome")
	}
}
