package ai

import (
	"strings"
	"testing"
)

func TestNormalizeAskUserReasonCode(t *testing.T) {
	t.Parallel()

	if got := normalizeAskUserReasonCode("permission_blocked"); got != AskUserReasonPermissionBlocked {
		t.Fatalf("permission_blocked => %q", got)
	}
	if got := normalizeAskUserReasonCode(" USER_DECISION_REQUIRED "); got != AskUserReasonUserDecisionRequired {
		t.Fatalf("user_decision_required => %q", got)
	}
	if got := normalizeAskUserReasonCode("unknown_code"); got != "" {
		t.Fatalf("unknown => %q", got)
	}
}

func TestParseAskUserPolicyDecision(t *testing.T) {
	t.Parallel()

	decision, err := parseAskUserPolicyDecision("```json\n{\"allow\":false,\"reason\":\"delegates_collectable_work\",\"confidence\":0.91}\n```")
	if err != nil {
		t.Fatalf("parseAskUserPolicyDecision: %v", err)
	}
	if decision.Allow {
		t.Fatalf("allow=%v, want false", decision.Allow)
	}
	if decision.Reason != "delegates_collectable_work" {
		t.Fatalf("reason=%q", decision.Reason)
	}
	if decision.Source != askUserPolicySourceModel {
		t.Fatalf("source=%q", decision.Source)
	}
}

func TestBuildAskUserPolicyClassifierMessages(t *testing.T) {
	t.Parallel()

	msgs := buildAskUserPolicyClassifierMessages("fix startup failure", askUserSignal{
		Question:         "Please approve privileged command execution.",
		ReasonCode:       AskUserReasonPermissionBlocked,
		RequiredFromUser: []string{"Approve elevated execution."},
		EvidenceRefs:     []string{"tool_123"},
	}, runtimeState{
		BlockedActionFacts: []string{"terminal.exec: permission denied"},
	})
	if len(msgs) != 2 {
		t.Fatalf("message count=%d, want 2", len(msgs))
	}
	if got := msgs[0].Content[0].Text; got == "" || !strings.Contains(got, askUserPolicyClassifierMarker) {
		t.Fatalf("missing classifier marker in system prompt")
	}
}

func TestDefaultGuardAskUserSignal(t *testing.T) {
	t.Parallel()

	signal := defaultGuardAskUserSignal("Need your choice.", []string{"Option A", "Option B"}, "missing_explicit_completion")
	if signal.ReasonCode != AskUserReasonUserDecisionRequired {
		t.Fatalf("reason_code=%q, want %q", signal.ReasonCode, AskUserReasonUserDecisionRequired)
	}
	if len(signal.RequiredFromUser) == 0 {
		t.Fatalf("required_from_user should not be empty")
	}
}

func TestAskUserReasonRequiresEvidence(t *testing.T) {
	t.Parallel()

	if !askUserReasonRequiresEvidence(AskUserReasonPermissionBlocked) {
		t.Fatalf("permission_blocked should require evidence")
	}
	if askUserReasonRequiresEvidence(AskUserReasonUserDecisionRequired) {
		t.Fatalf("user_decision_required should not require evidence")
	}
}
