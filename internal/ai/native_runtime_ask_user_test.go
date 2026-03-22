package ai

import "testing"

func testAskUserSignal(question string) askUserSignal {
	return askUserSignal{
		Questions: []RequestUserInputQuestion{{
			ID:       "question_1",
			Header:   question,
			Question: question,
			IsOther:  true,
		}},
	}
}

func TestEvaluateAskUserGate(t *testing.T) {
	t.Parallel()

	if pass, reason := evaluateAskUserGate(askUserSignal{}, runtimeState{}, TaskComplexitySimple); pass || reason != "empty_question" {
		t.Fatalf("empty question => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateAskUserGate(testAskUserSignal("Should I proceed?"), runtimeState{}, TaskComplexitySimple); pass || reason != "missing_reason_code" {
		t.Fatalf("missing reason_code => pass=%v reason=%q", pass, reason)
	}

	signal := testAskUserSignal("Should I proceed?")
	signal.ReasonCode = AskUserReasonUserDecisionRequired
	if pass, reason := evaluateAskUserGate(signal, runtimeState{}, TaskComplexitySimple); pass || reason != "missing_required_from_user" {
		t.Fatalf("missing required_from_user => pass=%v reason=%q", pass, reason)
	}

	signal = testAskUserSignal("I need a permission decision.")
	signal.ReasonCode = AskUserReasonPermissionBlocked
	signal.RequiredFromUser = []string{"Approve elevated execution."}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{}, TaskComplexitySimple); pass || reason != "missing_evidence_refs" {
		t.Fatalf("missing evidence refs => pass=%v reason=%q", pass, reason)
	}

	signal = testAskUserSignal("I need a permission decision.")
	signal.ReasonCode = AskUserReasonPermissionBlocked
	signal.RequiredFromUser = []string{"Approve elevated execution."}
	signal.EvidenceRefs = []string{"tool_missing"}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{ToolCallLedger: map[string]string{"tool_1": "failed"}}, TaskComplexitySimple); pass || reason != "unresolved_evidence_refs" {
		t.Fatalf("unresolved evidence refs => pass=%v reason=%q", pass, reason)
	}

	signal = testAskUserSignal("I need a permission decision.")
	signal.ReasonCode = AskUserReasonPermissionBlocked
	signal.RequiredFromUser = []string{"Approve elevated execution."}
	signal.EvidenceRefs = []string{"tool_1"}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{ToolCallLedger: map[string]string{"tool_1": "completed"}}, TaskComplexitySimple); pass || reason != "permission_reason_without_blocked_evidence" {
		t.Fatalf("permission reason without blocked evidence => pass=%v reason=%q", pass, reason)
	}

	signal = testAskUserSignal("I need permission to continue with a privileged command.")
	signal.ReasonCode = AskUserReasonPermissionBlocked
	signal.RequiredFromUser = []string{"Approve elevated execution."}
	signal.EvidenceRefs = []string{"tool:tool_perm"}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{
		ToolCallLedger: map[string]string{"tool_perm": "failed"},
	}, TaskComplexityStandard); !pass || reason != "ok" {
		t.Fatalf("valid signal => pass=%v reason=%q", pass, reason)
	}

	signal = testAskUserSignal("I need your decision on deployment order.")
	signal.ReasonCode = AskUserReasonUserDecisionRequired
	signal.RequiredFromUser = []string{"Pick canary-first or full rollout."}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{
		TodoPolicy:       TodoPolicyRequired,
		MinimumTodoItems: 3,
	}, TaskComplexityStandard); pass || reason != todoRequirementMissingPolicyRequired {
		t.Fatalf("required todo policy without snapshot => pass=%v reason=%q", pass, reason)
	}

	signal = testAskUserSignal("I need your decision on deployment order.")
	signal.ReasonCode = AskUserReasonUserDecisionRequired
	signal.RequiredFromUser = []string{"Pick canary-first or full rollout."}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{
		TodoTrackingEnabled: true,
		TodoOpenCount:       2,
	}, TaskComplexityStandard); pass || reason != "pending_todos_without_blocker" {
		t.Fatalf("pending todos without blocker => pass=%v reason=%q", pass, reason)
	}

	signal = testAskUserSignal("Need approval for a privileged command.")
	signal.ReasonCode = AskUserReasonPermissionBlocked
	signal.RequiredFromUser = []string{"Approve elevated execution."}
	signal.EvidenceRefs = []string{"tool_1"}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{
		ToolCallLedger:      map[string]string{"tool_1": "failed"},
		TodoTrackingEnabled: true,
		TodoOpenCount:       1,
		BlockedActionFacts:  []string{"terminal.exec: permission denied"},
	}, TaskComplexityComplex); !pass || reason != "ok" {
		t.Fatalf("pending todos with blocker => pass=%v reason=%q", pass, reason)
	}
}

func TestEvaluateGuardAskUserGate(t *testing.T) {
	t.Parallel()

	if pass, reason := evaluateGuardAskUserGate("tool_mistake_loop", runtimeState{
		ToolCallLedger: map[string]string{"tool_1": "failed"},
	}, TaskComplexityStandard); pass || reason != "missing_evidence_refs" {
		t.Fatalf("tool_mistake_loop without evidence => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateGuardAskUserGate("tool_mistake_loop", runtimeState{
		ToolCallLedger:      map[string]string{"tool_1": "failed"},
		BlockedEvidenceRefs: []string{"tool:tool_1"},
	}, TaskComplexityStandard); !pass || reason != "ok" {
		t.Fatalf("tool_mistake_loop with evidence => pass=%v reason=%q", pass, reason)
	}

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
