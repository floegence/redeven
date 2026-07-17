package main

import (
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/ai"
)

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
				RunStatus:      "success",
				PermissionType: "approval_required",
				WaitingPrompt:  "forbidden",
			},
			Tools: taskToolAssertions{
				MustCall:    []string{"terminal.exec", "write_todos", "task_complete"},
				MustSucceed: []string{"terminal.exec", "write_todos", "task_complete"},
				MustNotCall: []string{"apply_patch"},
				MaxCalls:    6,
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
			RunStatus:      "success",
			PermissionType: "approval_required",
			WaitingPrompt:  false,
		},
		rawToolCalls: []canonicalToolCall{
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
				RequireEvidence:        true,
				MustContain:            []string{"conclusion"},
				Forbidden:              []string{"No response"},
				MustNotEndWithFallback: true,
			},
		},
	}
	result := taskResult{
		Task:          task,
		WorkspacePath: "/workspace",
		FinalText:     "Tool workflow failed before a useful answer could be produced.",
	}
	outcome := assessTaskOutcome(task, result)
	if outcome.Passed {
		t.Fatalf("expected failure outcome")
	}
	if outcome.LoopSafe {
		t.Fatalf("expected loop unsafe outcome")
	}
}

func TestAssessTaskOutcome_StreamMonitorAbortFailsLoopSafety(t *testing.T) {
	t.Parallel()

	task := evalTask{
		ID: "stream_monitor_abort",
	}
	result := taskResult{
		Task:      task,
		FinalText: "Final answer with enough content.",
		Turns: []turnMetrics{{
			MonitorAbort: "tool_signature_loop",
		}},
	}
	outcome := assessTaskOutcome(task, result)
	if outcome.Passed {
		t.Fatalf("expected stream monitor abort to fail")
	}
	if outcome.LoopSafe {
		t.Fatalf("expected stream monitor abort to mark loop unsafe")
	}
	if reasons := strings.Join(outcome.HardFailReasons, ","); !strings.Contains(reasons, "monitor_abort:tool_signature_loop") {
		t.Fatalf("hard fail reasons %q missing monitor abort", reasons)
	}
}

func TestAssessTaskOutcome_CanonicalToolErrorMarksSuccessfulRecovery(t *testing.T) {
	t.Parallel()

	result := taskResult{
		FinalText: "The retry completed and produced the requested result.",
		Turns:     []turnMetrics{{ToolErrorCount: 1}},
	}
	outcome := assessTaskOutcome(evalTask{ID: "tool_error_recovery"}, result)
	if !outcome.Passed || !outcome.LoopSafe {
		t.Fatalf("expected recovered tool error to pass safely, got %+v", outcome)
	}
	if !outcome.RecoveryCandidate || !outcome.RecoverySucceeded {
		t.Fatalf("expected recovered tool error to count as successful recovery, got %+v", outcome)
	}
}

func TestAssessTaskOutcome_RunErrorFailsTask(t *testing.T) {
	t.Parallel()

	result := taskResult{
		FinalText: "The run stopped before it could complete the requested work.",
		Turns:     []turnMetrics{{RunError: "provider unavailable"}},
	}
	outcome := assessTaskOutcome(evalTask{ID: "run_error"}, result)
	if outcome.Passed {
		t.Fatalf("expected run error to fail task")
	}
	if reasons := strings.Join(outcome.HardFailReasons, ","); !strings.Contains(reasons, "run_error") {
		t.Fatalf("hard fail reasons %q missing run error", reasons)
	}
}

func TestAssessTaskOutcome_FailsWhenWorkspaceScopedToolEscapesSandbox(t *testing.T) {
	t.Parallel()

	task := evalTask{
		ID: "workspace_scope",
		Assertions: taskAssertionsSpec{
			Tools: taskToolAssertions{
				WorkspaceScopedTools: []string{"terminal.exec"},
			},
		},
	}
	result := taskResult{
		Task:          task,
		WorkspacePath: "/tmp/workspace",
		rawToolCalls: []canonicalToolCall{
			{
				ToolName: "terminal.exec",
				Status:   "success",
				ArgsJSON: `{"command":"cat /etc/hosts","cwd":"/tmp/workspace"}`,
			},
			{ToolName: "task_complete", Status: "success"},
		},
	}

	outcome := assessTaskOutcome(task, result)
	if outcome.Passed {
		t.Fatalf("expected workspace scope violation to fail")
	}
	if len(outcome.HardFailReasons) == 0 || outcome.HardFailReasons[0] != "tool_args_escape_workspace:terminal.exec" {
		t.Fatalf("hard_fail_reasons=%v", outcome.HardFailReasons)
	}
}

func TestExtractScopedPathCandidates_IgnoresAllowedSystemDevicePaths(t *testing.T) {
	t.Parallel()

	got := extractScopedPathCandidates(`cat /tmp/workspace/file.txt 2>/dev/null`)
	if len(got) != 1 || got[0] != "/tmp/workspace/file.txt" {
		t.Fatalf("extractScopedPathCandidates()=%v", got)
	}
}

func TestFirstWorkspaceScopeViolation_AllowsWorkspaceBoundTerminalExecCommands(t *testing.T) {
	t.Parallel()

	workspace := "/tmp/workspace"
	calls := []canonicalToolCall{
		{
			ToolName: "terminal.exec",
			Status:   "success",
			ArgsJSON: `{"command":"cat /tmp/workspace/README.md 2>/dev/null","description":"Read README"}`,
		},
		{
			ToolName: "terminal.exec",
			Status:   "success",
			ArgsJSON: `{"command":"find /tmp/workspace -type f | head -20","description":"List files"}`,
		},
	}

	if violation := firstWorkspaceScopeViolation("terminal.exec", calls, workspace); violation != "" {
		t.Fatalf("unexpected violation: %s", violation)
	}
}

func TestFirstWorkspaceScopeViolation_ApplyPatchIgnoresOutsidePathMentionsInFileBody(t *testing.T) {
	t.Parallel()

	workspace := "/tmp/workspace"
	calls := []canonicalToolCall{
		{
			ToolName: "apply_patch",
			Status:   "success",
			ArgsJSON: `{"patch":"*** Begin Patch\n*** Add File: boundary_note.txt\n+Original request: write /tmp/outside.txt\n*** End Patch"}`,
		},
	}

	if violation := firstWorkspaceScopeViolation("apply_patch", calls, workspace); violation != "" {
		t.Fatalf("unexpected violation: %s", violation)
	}
}

func TestFirstWorkspaceScopeViolation_AllowsStructuredFileToolInsideWorkspace(t *testing.T) {
	t.Parallel()

	workspace := "/tmp/workspace"
	calls := []canonicalToolCall{
		{
			ToolName: "file.write",
			Status:   "success",
			ArgsJSON: `{"file_path":"/tmp/workspace/notes/inside.txt","content":"hello"}`,
		},
		{
			ToolName: "file.read",
			Status:   "success",
			ArgsJSON: `{"file_path":"/tmp/workspace/README.md"}`,
		},
	}

	if violation := firstWorkspaceScopeViolation("file.write", calls[:1], workspace); violation != "" {
		t.Fatalf("unexpected file.write violation: %s", violation)
	}
	if violation := firstWorkspaceScopeViolation("file.read", calls[1:], workspace); violation != "" {
		t.Fatalf("unexpected file.read violation: %s", violation)
	}
}

func TestFirstWorkspaceScopeViolation_ChecksReadonlyToolsInsideWorkspace(t *testing.T) {
	t.Parallel()

	workspace := "/tmp/workspace"
	cases := []struct {
		name     string
		toolName string
		argsJSON string
	}{
		{name: "read_file", toolName: "read_file", argsJSON: `{"path":"/tmp/workspace/README.md"}`},
		{name: "read_files", toolName: "read_files", argsJSON: `{"paths":["/tmp/workspace/README.md","docs/note.md"]}`},
		{name: "find", toolName: "find", argsJSON: `{"root":"/tmp/workspace/internal"}`},
		{name: "rgrep", toolName: "rgrep", argsJSON: `{"query":"TODO","paths":["/tmp/workspace/internal"]}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			calls := []canonicalToolCall{{ToolName: tc.toolName, Status: "success", ArgsJSON: tc.argsJSON}}
			if violation := firstWorkspaceScopeViolation(tc.toolName, calls, workspace); violation != "" {
				t.Fatalf("unexpected %s violation: %s", tc.toolName, violation)
			}
		})
	}
}

func TestFirstWorkspaceScopeViolation_FailsWhenReadonlyToolEscapesWorkspace(t *testing.T) {
	t.Parallel()

	workspace := "/tmp/workspace"
	cases := []struct {
		name     string
		toolName string
		argsJSON string
		want     string
	}{
		{name: "read_file_abs", toolName: "read_file", argsJSON: `{"path":"/tmp/outside.txt"}`, want: "/tmp/outside.txt"},
		{name: "read_files_parent", toolName: "read_files", argsJSON: `{"paths":["../outside.txt"]}`, want: "parent:../outside.txt"},
		{name: "find_abs", toolName: "find", argsJSON: `{"root":"/var/tmp"}`, want: "/var/tmp"},
		{name: "rgrep_parent", toolName: "rgrep", argsJSON: `{"query":"x","paths":["../outside"]}`, want: "parent:../outside"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			calls := []canonicalToolCall{{ToolName: tc.toolName, Status: "success", ArgsJSON: tc.argsJSON}}
			if violation := firstWorkspaceScopeViolation(tc.toolName, calls, workspace); violation != tc.want {
				t.Fatalf("%s violation=%q, want %q", tc.toolName, violation, tc.want)
			}
		})
	}
}

func TestAssessTaskOutcome_FailsWhenStructuredFileToolEscapesSandbox(t *testing.T) {
	t.Parallel()

	task := evalTask{
		ID: "structured_file_scope",
		Assertions: taskAssertionsSpec{
			Tools: taskToolAssertions{
				WorkspaceScopedTools: []string{"file.write"},
			},
		},
	}
	result := taskResult{
		Task:          task,
		WorkspacePath: "/tmp/workspace",
		rawToolCalls: []canonicalToolCall{
			{
				ToolName: "file.write",
				Status:   "success",
				ArgsJSON: `{"file_path":"/tmp/outside.txt","content":"escape"}`,
			},
		},
	}

	outcome := assessTaskOutcome(task, result)
	if outcome.Passed {
		t.Fatalf("expected workspace scope violation to fail")
	}
	if len(outcome.HardFailReasons) == 0 || outcome.HardFailReasons[0] != "tool_args_escape_workspace:file.write" {
		t.Fatalf("hard_fail_reasons=%v", outcome.HardFailReasons)
	}
}
