package ai

import "testing"

func TestEvaluateAskUserGate(t *testing.T) {
	t.Parallel()

	allowPolicy := askUserPolicyDecision{
		Allow:      true,
		Reason:     "policy_allowed_by_model",
		Confidence: 0.92,
		Source:     askUserPolicySourceModel,
	}

	if pass, reason := evaluateAskUserGate(askUserSignal{}, runtimeState{}, TaskComplexitySimple, allowPolicy); pass || reason != "empty_question" {
		t.Fatalf("empty question => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateAskUserGate(askUserSignal{
		Question: "Should I proceed?",
	}, runtimeState{}, TaskComplexitySimple, allowPolicy); pass || reason != "missing_reason_code" {
		t.Fatalf("missing reason_code => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateAskUserGate(askUserSignal{
		Question:   "Should I proceed?",
		ReasonCode: AskUserReasonUserDecisionRequired,
	}, runtimeState{}, TaskComplexitySimple, allowPolicy); pass || reason != "missing_required_from_user" {
		t.Fatalf("missing required_from_user => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateAskUserGate(askUserSignal{
		Question:         "I need a permission decision.",
		ReasonCode:       AskUserReasonPermissionBlocked,
		RequiredFromUser: []string{"Approve elevated execution."},
	}, runtimeState{}, TaskComplexitySimple, allowPolicy); pass || reason != "missing_evidence_refs" {
		t.Fatalf("missing evidence refs => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateAskUserGate(askUserSignal{
		Question:         "I need a permission decision.",
		ReasonCode:       AskUserReasonPermissionBlocked,
		RequiredFromUser: []string{"Approve elevated execution."},
		EvidenceRefs:     []string{"tool_missing"},
	}, runtimeState{ToolCallLedger: map[string]string{"tool_1": "failed"}}, TaskComplexitySimple, allowPolicy); pass || reason != "unresolved_evidence_refs" {
		t.Fatalf("unresolved evidence refs => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateAskUserGate(askUserSignal{
		Question:         "I need a permission decision.",
		ReasonCode:       AskUserReasonPermissionBlocked,
		RequiredFromUser: []string{"Approve elevated execution."},
		EvidenceRefs:     []string{"tool_1"},
	}, runtimeState{ToolCallLedger: map[string]string{"tool_1": "completed"}}, TaskComplexitySimple, allowPolicy); pass || reason != "permission_reason_without_blocked_evidence" {
		t.Fatalf("permission reason without blocked evidence => pass=%v reason=%q", pass, reason)
	}

	rejectPolicy := askUserPolicyDecision{
		Allow:      false,
		Reason:     "policy_rejected_by_model",
		Confidence: 0.64,
		Source:     askUserPolicySourceModel,
	}
	if pass, reason := evaluateAskUserGate(askUserSignal{
		Question:         "Which release strategy do you prefer?",
		ReasonCode:       AskUserReasonUserDecisionRequired,
		RequiredFromUser: []string{"Choose conservative or aggressive rollout."},
		EvidenceRefs:     []string{},
	}, runtimeState{}, TaskComplexitySimple, rejectPolicy); pass || reason != "policy_rejected_by_model" {
		t.Fatalf("policy rejected => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateAskUserGate(askUserSignal{
		Question:         "I need permission to continue with a privileged command.",
		ReasonCode:       AskUserReasonPermissionBlocked,
		RequiredFromUser: []string{"Approve elevated execution."},
		EvidenceRefs:     []string{"tool:tool_perm"},
	}, runtimeState{
		ToolCallLedger: map[string]string{"tool_perm": "failed"},
	}, TaskComplexityStandard, allowPolicy); !pass || reason != "ok" {
		t.Fatalf("valid signal => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateAskUserGate(askUserSignal{
		Question:         "I need your decision on deployment order.",
		ReasonCode:       AskUserReasonUserDecisionRequired,
		RequiredFromUser: []string{"Pick canary-first or full rollout."},
	}, runtimeState{
		TodoPolicy:       TodoPolicyRequired,
		MinimumTodoItems: 3,
	}, TaskComplexityStandard, allowPolicy); pass || reason != todoRequirementMissingPolicyRequired {
		t.Fatalf("required todo policy without snapshot => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateAskUserGate(askUserSignal{
		Question:         "I need your decision on deployment order.",
		ReasonCode:       AskUserReasonUserDecisionRequired,
		RequiredFromUser: []string{"Pick canary-first or full rollout."},
	}, runtimeState{
		TodoTrackingEnabled: true,
		TodoOpenCount:       2,
	}, TaskComplexityStandard, allowPolicy); pass || reason != "pending_todos_without_blocker" {
		t.Fatalf("pending todos without blocker => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateAskUserGate(askUserSignal{
		Question:         "Need approval for a privileged command.",
		ReasonCode:       AskUserReasonPermissionBlocked,
		RequiredFromUser: []string{"Approve elevated execution."},
		EvidenceRefs:     []string{"tool_1"},
	}, runtimeState{
		ToolCallLedger:      map[string]string{"tool_1": "failed"},
		TodoTrackingEnabled: true,
		TodoOpenCount:       1,
		BlockedActionFacts:  []string{"terminal.exec: permission denied"},
	}, TaskComplexityComplex, allowPolicy); !pass || reason != "ok" {
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
