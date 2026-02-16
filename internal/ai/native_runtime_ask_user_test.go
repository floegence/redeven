package ai

import "testing"

func TestAsksUserToRunCollectableWork(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		question string
		want     bool
	}{
		{
			name:     "english command output request",
			question: "Please run the command and paste the output here.",
			want:     true,
		},
		{
			name:     "english shell output request",
			question: "Run the terminal command and share the logs.",
			want:     true,
		},
		{
			name:     "normal clarification",
			question: "Should I prefer a quick fix or a full refactor?",
			want:     false,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := asksUserToRunCollectableWork(tc.question); got != tc.want {
				t.Fatalf("asksUserToRunCollectableWork(%q)=%v, want %v", tc.question, got, tc.want)
			}
		})
	}
}

func TestEvaluateAskUserGate(t *testing.T) {
	t.Parallel()

	if pass, reason := evaluateAskUserGate("", runtimeState{}, TaskComplexitySimple); pass || reason != "empty_question" {
		t.Fatalf("empty question => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateAskUserGate("Please execute the command and paste the output.", runtimeState{}, TaskComplexitySimple); pass || reason != "delegated_collectable_work" {
		t.Fatalf("delegated work => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateAskUserGate("Need your decision on deployment order.", runtimeState{}, TaskComplexityComplex); !pass || reason != "ok" {
		t.Fatalf("no required todo policy => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateAskUserGate("Need your decision on deployment order.", runtimeState{
		TodoPolicy:       TodoPolicyRequired,
		MinimumTodoItems: 3,
	}, TaskComplexityStandard); pass || reason != todoRequirementMissingPolicyRequired {
		t.Fatalf("required todo policy without snapshot => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateAskUserGate("Need your decision on deployment order.", runtimeState{
		TodoPolicy:          TodoPolicyRequired,
		MinimumTodoItems:    3,
		TodoTrackingEnabled: true,
		TodoTotalCount:      2,
	}, TaskComplexityStandard); pass || reason != todoRequirementInsufficientPolicyRequired {
		t.Fatalf("required todo policy with too few todos => pass=%v reason=%q", pass, reason)
	}

	pendingTodos := runtimeState{
		TodoTrackingEnabled: true,
		TodoOpenCount:       2,
	}
	if pass, reason := evaluateAskUserGate("Need your decision on deployment order.", pendingTodos, TaskComplexityStandard); pass || reason != "pending_todos_without_blocker" {
		t.Fatalf("pending todos without blocker => pass=%v reason=%q", pass, reason)
	}

	withBlocker := runtimeState{
		TodoTrackingEnabled: true,
		TodoOpenCount:       1,
		BlockedActionFacts:  []string{"terminal.exec: permission denied"},
	}
	if pass, reason := evaluateAskUserGate("Need approval for a privileged command.", withBlocker, TaskComplexityComplex); !pass || reason != "ok" {
		t.Fatalf("pending todos with blocker => pass=%v reason=%q", pass, reason)
	}
}

func TestEvaluateGuardAskUserGate(t *testing.T) {
	t.Parallel()

	if pass, reason := evaluateGuardAskUserGate("missing_explicit_completion", runtimeState{
		TodoTrackingEnabled: true,
		TodoOpenCount:       2,
	}, TaskComplexityStandard); pass || reason != "pending_todos_without_blocker" {
		t.Fatalf("pending todos without blocker => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateGuardAskUserGate("missing_explicit_completion", runtimeState{
		TodoTrackingEnabled: true,
		TodoOpenCount:       1,
		BlockedActionFacts:  []string{"tool failed due to permission"},
	}, TaskComplexityStandard); !pass || reason != "ok" {
		t.Fatalf("pending todos with blocker => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateGuardAskUserGate("complex_task_missing_todos", runtimeState{}, TaskComplexityComplex); !pass || reason != "ok" {
		t.Fatalf("complex_task_missing_todos must be allowed => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateGuardAskUserGate("missing_explicit_completion", runtimeState{
		TodoPolicy:       TodoPolicyRequired,
		MinimumTodoItems: 3,
	}, TaskComplexityStandard); pass || reason != todoRequirementMissingPolicyRequired {
		t.Fatalf("required todo policy guard without snapshot => pass=%v reason=%q", pass, reason)
	}
}
