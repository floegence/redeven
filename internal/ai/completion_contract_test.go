package ai

import (
	"testing"

	"github.com/floegence/redeven/internal/config"
)

func TestCompletionContractForExecutionContract(t *testing.T) {
	t.Parallel()

	if got := completionContractForExecutionContract(RunExecutionContractAgenticLoop); got != completionContractExplicitOnly {
		t.Fatalf("agentic_loop contract=%q, want %q", got, completionContractExplicitOnly)
	}
	if got := completionContractForExecutionContract(RunExecutionContractHybridFirstTurn); got != completionContractFirstTurn {
		t.Fatalf("hybrid_first_turn contract=%q, want %q", got, completionContractFirstTurn)
	}
	if got := completionContractForExecutionContract(RunExecutionContractDirectReply); got != completionContractNone {
		t.Fatalf("direct_reply contract=%q, want %q", got, completionContractNone)
	}
}

func TestClassifyFinalizationReason(t *testing.T) {
	t.Parallel()

	cases := []struct {
		reason string
		want   string
	}{
		{reason: "task_complete", want: finalizationClassSuccess},
		{reason: "task_complete_forced", want: finalizationClassSuccess},
		{reason: finalizationReasonProtocolCloseout, want: finalizationClassSuccess},
		{reason: "social_reply", want: finalizationClassSuccess},
		{reason: "creative_reply", want: finalizationClassSuccess},
		{reason: "hybrid_first_turn_reply", want: finalizationClassSuccess},
		{reason: "ask_user_waiting", want: finalizationClassWaitingUser},
		{reason: "ask_user_waiting_model", want: finalizationClassWaitingUser},
		{reason: "ask_user_waiting_guard", want: finalizationClassWaitingUser},
		{reason: finalizationReasonExitPlanModeWaiting, want: finalizationClassWaitingUser},
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

	if pass, reason := evaluateTaskCompletionGate("Everything is done.", runtimeState{}, TaskComplexityComplex, config.AIModeAct); !pass || reason != "ok" {
		t.Fatalf("no required todo policy (act) => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateTaskCompletionGate("Everything is done.", runtimeState{}, TaskComplexityComplex, config.AIModePlan); !pass || reason != "ok" {
		t.Fatalf("no required todo policy (plan) => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateTaskCompletionGate("Everything is done.", runtimeState{
		TodoPolicy:       TodoPolicyRequired,
		MinimumTodoItems: 3,
	}, TaskComplexityStandard, config.AIModeAct); pass || reason != todoRequirementMissingPolicyRequired {
		t.Fatalf("required todo policy without snapshot => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateTaskCompletionGate("Everything is done.", runtimeState{
		TodoPolicy:          TodoPolicyRequired,
		MinimumTodoItems:    3,
		TodoTrackingEnabled: true,
		TodoTotalCount:      2,
	}, TaskComplexityStandard, config.AIModeAct); pass || reason != todoRequirementInsufficientPolicyRequired {
		t.Fatalf("required todo policy with too few todos => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateTaskCompletionGate("I think you are in your late twenties. Did I guess right?", runtimeState{
		InteractionContract: interactionContract{Enabled: true},
	}, TaskComplexityStandard, config.AIModeAct); !pass || reason != "ok" {
		t.Fatalf("question-shaped completion should no longer be blocked => pass=%v reason=%q", pass, reason)
	}
}

func TestBuildRuntimeCloseout(t *testing.T) {
	t.Parallel()

	closeout, ok, reason := buildRuntimeCloseout("Final verified answer.", runtimeState{
		CompletedActionFacts: []string{"file.write: file.updated"},
	}, TaskComplexityStandard, config.AIModeAct, runtimeCloseoutAttempt{})
	if !ok || reason != "ok" {
		t.Fatalf("buildRuntimeCloseout => ok=%v reason=%q", ok, reason)
	}
	if closeout.Source != finalizationReasonProtocolCloseout {
		t.Fatalf("closeout source=%q, want %q", closeout.Source, finalizationReasonProtocolCloseout)
	}

	if _, ok, reason := buildRuntimeCloseout("Final answer.", runtimeState{
		CompletedActionFacts: []string{"write_todos: todos.updated"},
	}, TaskComplexityStandard, config.AIModeAct, runtimeCloseoutAttempt{}); ok || reason != "missing_verified_tool_work" {
		t.Fatalf("missing verified work => ok=%v reason=%q", ok, reason)
	}

	if _, ok, reason := buildRuntimeCloseout("Final verified answer.", runtimeState{
		CompletedActionFacts: []string{"file.write: file.updated"},
	}, TaskComplexityStandard, config.AIModeAct, runtimeCloseoutAttempt{Interrupted: true}); ok || reason != "interrupted_execution" {
		t.Fatalf("interrupted execution => ok=%v reason=%q", ok, reason)
	}
}
