package ai

import (
	"testing"

	"github.com/floegence/redeven-agent/internal/config"
)

func TestCompletionContractForIntent(t *testing.T) {
	t.Parallel()

	if got := completionContractForIntent(RunIntentTask); got != completionContractExplicitOnly {
		t.Fatalf("task contract=%q, want %q", got, completionContractExplicitOnly)
	}
	if got := completionContractForIntent(RunIntentSocial); got != completionContractNone {
		t.Fatalf("social contract=%q, want %q", got, completionContractNone)
	}
}

func TestClassifyFinalizationReason(t *testing.T) {
	t.Parallel()

	cases := []struct {
		reason string
		want   string
	}{
		{reason: "task_complete", want: finalizationClassSuccess},
		{reason: "social_reply", want: finalizationClassSuccess},
		{reason: "ask_user_waiting", want: finalizationClassWaitingUser},
		{reason: "ask_user_waiting_model", want: finalizationClassWaitingUser},
		{reason: "ask_user_waiting_guard", want: finalizationClassWaitingUser},
		{reason: "implicit_complete_backpressure", want: finalizationClassFailure},
	}
	for _, tc := range cases {
		if got := classifyFinalizationReason(tc.reason); got != tc.want {
			t.Fatalf("reason=%q => %q, want %q", tc.reason, got, tc.want)
		}
	}
}

func TestEvaluateTaskCompletionGate(t *testing.T) {
	t.Parallel()

	if pass, reason := evaluateTaskCompletionGate("", runtimeState{}, TaskComplexitySimple, config.AIModeAct); pass || reason != "empty_result" {
		t.Fatalf("empty result => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateTaskCompletionGate("Task finished with final answer.", runtimeState{
		CompletedActionFacts: []string{"terminal.exec: go test ./..."},
	}, TaskComplexitySimple, config.AIModeAct); !pass || reason != "ok" {
		t.Fatalf("non-empty result => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateTaskCompletionGate("Everything is done.", runtimeState{
		TodoTrackingEnabled: true,
		TodoOpenCount:       1,
	}, TaskComplexityStandard, config.AIModeAct); pass || reason != "pending_todos" {
		t.Fatalf("pending todos (act) => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateTaskCompletionGate("Everything is done.", runtimeState{
		TodoTrackingEnabled: true,
		TodoOpenCount:       1,
	}, TaskComplexityStandard, config.AIModePlan); !pass || reason != "ok" {
		t.Fatalf("pending todos (plan) => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateTaskCompletionGate("Everything is done.", runtimeState{}, TaskComplexityComplex, config.AIModeAct); pass || reason != "missing_todos_for_complex_task" {
		t.Fatalf("complex task without todos (act) => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateTaskCompletionGate("Everything is done.", runtimeState{}, TaskComplexityComplex, config.AIModePlan); pass || reason != "missing_todos_for_complex_task" {
		t.Fatalf("complex task without todos (plan) => pass=%v reason=%q", pass, reason)
	}
}
