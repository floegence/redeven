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
			name:     "chinese output request",
			question: "请执行命令并把输出贴上来。",
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

	if pass, reason := evaluateAskUserGate("请执行命令并把输出贴上来。", runtimeState{}, TaskComplexitySimple); pass || reason != "delegated_collectable_work" {
		t.Fatalf("delegated work => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateAskUserGate("Need your decision on deployment order.", runtimeState{}, TaskComplexityComplex); pass || reason != "missing_todos_for_complex_task" {
		t.Fatalf("complex task without todos => pass=%v reason=%q", pass, reason)
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
}
