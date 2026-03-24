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
		InteractionContract: interactionContract{
			Enabled:                  true,
			SingleQuestionPerTurn:    true,
			FixedChoicesRequired:     true,
			OpenTextFallbackRequired: true,
		},
	})
	if len(msgs) != 2 {
		t.Fatalf("message count=%d, want 2", len(msgs))
	}
	if got := msgs[0].Content[0].Text; got == "" || !strings.Contains(got, askUserPolicyClassifierMarker) {
		t.Fatalf("missing classifier marker in system prompt")
	}
	if got := msgs[0].Content[0].Text; !strings.Contains(got, structuredClassifierAskUserPolicyToolName) {
		t.Fatalf("system prompt missing classifier tool name: %q", got)
	}
	if got := msgs[0].Content[0].Text; !strings.Contains(got, "violates_requested_interaction_shape") {
		t.Fatalf("system prompt missing interaction-shape rejection guidance: %q", got)
	}
	if got := msgs[0].Content[0].Text; !strings.Contains(got, "active interaction contract") {
		t.Fatalf("system prompt missing interaction-contract guidance: %q", got)
	}
	if got := msgs[1].Content[0].Text; !strings.Contains(got, "\"fixed_choices_required\":true") {
		t.Fatalf("user prompt missing interaction contract payload: %q", got)
	}
}

func TestBuildAskUserPolicyClassifierMessages_AllowsStructuredInteractionTurns(t *testing.T) {
	t.Parallel()

	msgs := buildAskUserPolicyClassifierMessages("Run a guided music-preference questionnaire", askUserSignal{
		Questions: []RequestUserInputQuestion{{
			ID:       "music_habit",
			Header:   "Music Habit",
			Question: "How do you usually listen to music?",
			Choices: []RequestUserInputChoice{
				{ChoiceID: "streaming", Label: "Streaming apps", Kind: requestUserInputChoiceKindSelect},
				{ChoiceID: "other", Label: "Other", Kind: requestUserInputChoiceKindWrite},
			},
		}},
		ReasonCode:       AskUserReasonUserDecisionRequired,
		RequiredFromUser: []string{"Choose the closest listening habit."},
	}, runtimeState{})
	if len(msgs) != 2 {
		t.Fatalf("message count=%d, want 2", len(msgs))
	}
	system := msgs[0].Content[0].Text
	if !strings.Contains(system, "guided structured interaction turns") {
		t.Fatalf("system prompt missing structured interaction allowance: %q", system)
	}
	if !strings.Contains(system, "questionnaires, interviews, quizzes, guessing games, decision trees, and option-driven conversations") {
		t.Fatalf("system prompt missing structured interaction examples: %q", system)
	}
	if !strings.Contains(system, "interaction-shape constraints") {
		t.Fatalf("system prompt missing interaction-shape guidance: %q", system)
	}
	if !strings.Contains(system, "delegates collectable work") {
		t.Fatalf("system prompt missing collectable-work rejection: %q", system)
	}
}

func TestEnforcedAskUserPolicyReason(t *testing.T) {
	t.Parallel()

	if reason, ok := enforcedAskUserPolicyReason(askUserPolicyDecision{
		Allow:  false,
		Reason: askUserPolicyReasonInteractionShapeViolation,
		Source: askUserPolicySourceModel,
	}); !ok || reason != askUserGateReasonInteractionShapeMismatch {
		t.Fatalf("enforced reason => ok=%v reason=%q", ok, reason)
	}

	if reason, ok := enforcedAskUserPolicyReason(askUserPolicyDecision{
		Allow:  false,
		Reason: askUserPolicyReasonInteractionShapeViolation,
		Source: askUserPolicySourceFallback,
	}); ok || reason != "" {
		t.Fatalf("fallback classifier should not enforce => ok=%v reason=%q", ok, reason)
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

	signal = defaultGuardAskUserSignal("Need direction.", nil, "tool_mistake_loop", "tool:tool_1", "tool:tool_1")
	if signal.ReasonCode != AskUserReasonConflictingWork {
		t.Fatalf("reason_code=%q, want %q", signal.ReasonCode, AskUserReasonConflictingWork)
	}
	if len(signal.EvidenceRefs) != 1 || signal.EvidenceRefs[0] != "tool:tool_1" {
		t.Fatalf("evidence_refs=%v, want [tool:tool_1]", signal.EvidenceRefs)
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

func TestStructuredContinuationAskUserPolicyDecision(t *testing.T) {
	t.Parallel()

	decision, ok := structuredContinuationAskUserPolicyDecision(runtimeState{
		InteractionContract: interactionContract{
			Enabled:                  true,
			SingleQuestionPerTurn:    true,
			FixedChoicesRequired:     true,
			OpenTextFallbackRequired: true,
		},
	}, true)
	if !ok {
		t.Fatalf("structured continuation fast path should be enabled")
	}
	if !decision.Allow {
		t.Fatalf("allow=%v, want true", decision.Allow)
	}
	if decision.Source != askUserPolicySourceStructuredContinuation {
		t.Fatalf("source=%q, want %q", decision.Source, askUserPolicySourceStructuredContinuation)
	}
	if decision.Reason != "structured_response_contract_continuation" {
		t.Fatalf("reason=%q, want structured_response_contract_continuation", decision.Reason)
	}
}
