package ai

import "testing"

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

func TestNormalizeAskUserSignal(t *testing.T) {
	t.Parallel()

	choicesExhaustive := true
	got := normalizeAskUserSignal(askUserSignal{
		Questions: []RequestUserInputQuestion{{
			ID:                "q1",
			Header:            "Choose",
			Question:          "Choose",
			ResponseMode:      requestUserInputResponseModeSelect,
			ChoicesExhaustive: &choicesExhaustive,
			Choices: []RequestUserInputChoice{
				{ChoiceID: "a", Label: "A", Kind: requestUserInputChoiceKindSelect},
			},
		}},
		ReasonCode:       " USER_DECISION_REQUIRED ",
		RequiredFromUser: []string{" Pick one ", "pick one"},
		EvidenceRefs:     []string{" tool:123 ", "tool:123"},
	})
	if got.Question != "Choose" {
		t.Fatalf("question=%q, want %q", got.Question, "Choose")
	}
	if got.ReasonCode != AskUserReasonUserDecisionRequired {
		t.Fatalf("reason_code=%q, want %q", got.ReasonCode, AskUserReasonUserDecisionRequired)
	}
	if len(got.RequiredFromUser) != 1 || got.RequiredFromUser[0] != "Pick one" {
		t.Fatalf("required_from_user=%v", got.RequiredFromUser)
	}
	if len(got.EvidenceRefs) != 1 || got.EvidenceRefs[0] != "tool:123" {
		t.Fatalf("evidence_refs=%v", got.EvidenceRefs)
	}
}
