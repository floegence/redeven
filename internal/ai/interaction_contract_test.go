package ai

import "testing"

func TestNormalizeInteractionContract(t *testing.T) {
	t.Parallel()

	got := normalizeInteractionContract(interactionContract{
		Enabled:                  true,
		Reason:                   "guided interaction requested",
		OpenTextFallbackRequired: true,
		IndirectQuestionsOnly:    true,
		Confidence:               1.4,
		Source:                   interactionContractSourceModel,
	})
	if !got.MustUseStructuredAskUser {
		t.Fatalf("must_use_structured_ask_user=false, want true")
	}
	if !got.FixedChoicesRequired {
		t.Fatalf("fixed_choices_required=false, want true")
	}
	if !got.DisallowDirectTargetAttribute {
		t.Fatalf("disallow_direct_target_attribute=false, want true")
	}
	if !got.MustNotFinalizeWithQuestion {
		t.Fatalf("must_not_finalize_with_new_question=false, want true")
	}
	if got.Confidence != 1 {
		t.Fatalf("confidence=%v, want 1", got.Confidence)
	}
	if got.Reason != "guided_interaction_requested" {
		t.Fatalf("reason=%q, want %q", got.Reason, "guided_interaction_requested")
	}
}

func TestCompletionResultRequestsUserInput(t *testing.T) {
	t.Parallel()

	contract := interactionContract{Enabled: true}
	if !completionResultRequestsUserInput("I think you are around 26. Did I guess correctly？", contract) {
		t.Fatalf("question-shaped completion should require waiting_user")
	}
	if completionResultRequestsUserInput("I think you are around 26.", contract) {
		t.Fatalf("non-question completion should not require waiting_user")
	}
	if completionResultRequestsUserInput("Did I guess correctly?", interactionContract{}) {
		t.Fatalf("disabled contract should not block completion")
	}
}

func TestMergeInteractionContractSeed_PreservesDurableRequirements(t *testing.T) {
	t.Parallel()

	got := mergeInteractionContractSeed(
		interactionContract{
			Enabled:                  true,
			Reason:                   "guided_option_interaction",
			SingleQuestionPerTurn:    true,
			FixedChoicesRequired:     true,
			OpenTextFallbackRequired: false,
			IndirectQuestionsOnly:    true,
			Confidence:               0.51,
			Source:                   interactionContractSourceModel,
		},
		interactionContract{
			Enabled:                  true,
			Reason:                   "guided_option_interaction",
			SingleQuestionPerTurn:    true,
			FixedChoicesRequired:     true,
			OpenTextFallbackRequired: true,
			IndirectQuestionsOnly:    true,
			Confidence:               0.93,
			Source:                   interactionContractSourceModel,
		},
	)
	if !got.OpenTextFallbackRequired {
		t.Fatalf("open_text_fallback_required=false, want true")
	}
	if got.Confidence != 0.93 {
		t.Fatalf("confidence=%v, want 0.93", got.Confidence)
	}
}
