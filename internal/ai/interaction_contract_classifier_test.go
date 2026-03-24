package ai

import (
	"strings"
	"testing"
)

func TestBuildInteractionContractClassifierMessages(t *testing.T) {
	t.Parallel()

	msgs := buildInteractionContractClassifierMessages(
		RunObjectiveModeContinue,
		"请你和我一问一答猜我的岁数，不要有直接的问题，每个问题应该提供几个选项。",
		"A",
	)
	if len(msgs) != 2 {
		t.Fatalf("message count=%d, want 2", len(msgs))
	}
	system := msgs[0].Content[0].Text
	if !strings.Contains(system, interactionContractClassifierMarker) {
		t.Fatalf("system prompt missing classifier marker: %q", system)
	}
	if !strings.Contains(system, structuredClassifierInteractionContractToolName) {
		t.Fatalf("system prompt missing classifier tool name: %q", system)
	}
	if !strings.Contains(system, "open_text_fallback_required") {
		t.Fatalf("system prompt missing open_text_fallback_required guidance: %q", system)
	}
	if !strings.Contains(system, "hidden-target inference turns") {
		t.Fatalf("system prompt missing hidden-target fixed-choice guidance: %q", system)
	}
	if !strings.Contains(system, "indirect_questions_only") {
		t.Fatalf("system prompt missing indirect_questions_only guidance: %q", system)
	}
	user := msgs[1].Content[0].Text
	if !strings.Contains(user, "Objective mode:") || !strings.Contains(user, "Active objective:") {
		t.Fatalf("user prompt missing context sections: %q", user)
	}
}

func TestParseInteractionContractDecision(t *testing.T) {
	t.Parallel()

	got, err := parseInteractionContractDecision("```json\n{\"enabled\":true,\"reason\":\"guided_option_interaction\",\"single_question_per_turn\":true,\"fixed_choices_required\":true,\"open_text_fallback_required\":true,\"indirect_questions_only\":true,\"confidence\":0.91}\n```")
	if err != nil {
		t.Fatalf("parseInteractionContractDecision: %v", err)
	}
	if !got.Enabled {
		t.Fatalf("enabled=false, want true")
	}
	if !got.MustUseStructuredAskUser {
		t.Fatalf("must_use_structured_ask_user=false, want true")
	}
	if !got.MustNotFinalizeWithQuestion {
		t.Fatalf("must_not_finalize_with_new_question=false, want true")
	}
	if !got.DisallowDirectTargetAttribute {
		t.Fatalf("disallow_direct_target_attribute=false, want true")
	}
}

func TestClassifyInteractionContract_UsesSeedFallback(t *testing.T) {
	t.Parallel()

	got := classifyInteractionContract(
		RunIntentTask,
		"请你和我一问一答猜我的岁数，不要有直接的问题，每个问题应该提供几个选项。",
		"A",
		interactionContract{
			Enabled:                  true,
			SingleQuestionPerTurn:    true,
			FixedChoicesRequired:     true,
			OpenTextFallbackRequired: true,
		},
		func() (interactionContract, error) {
			return interactionContract{}, assertErr{}
		},
	)
	if !got.Enabled {
		t.Fatalf("seed contract should be retained on classifier failure")
	}
	if !got.OpenTextFallbackRequired {
		t.Fatalf("open_text_fallback_required=false, want true")
	}
}

func TestClassifyInteractionContractWithMetadata_ReusesSeedForStructuredContinuation(t *testing.T) {
	t.Parallel()

	called := false
	got, meta := classifyInteractionContractWithMetadata(
		RunIntentTask,
		"请你和我一问一答猜我的岁数，不要有直接的问题，每个问题应该提供几个选项。",
		"A",
		interactionContract{
			Enabled:                  true,
			Source:                   interactionContractSourceModel,
			SingleQuestionPerTurn:    true,
			FixedChoicesRequired:     true,
			OpenTextFallbackRequired: true,
		},
		true,
		func() (interactionContract, error) {
			called = true
			return interactionContract{}, nil
		},
	)
	if called {
		t.Fatalf("model classifier should be skipped when structured continuation can reuse the seed")
	}
	if !got.Enabled {
		t.Fatalf("expected the persisted seed contract to stay enabled")
	}
	if got.Source != interactionContractSourceModel {
		t.Fatalf("source=%q, want %q", got.Source, interactionContractSourceModel)
	}
	if meta.Mode != interactionContractClassificationModeSeedReuse {
		t.Fatalf("classification_mode=%q, want %q", meta.Mode, interactionContractClassificationModeSeedReuse)
	}
	if !meta.SeedReused {
		t.Fatalf("seed_reused=false, want true")
	}
}

func TestStructuredClassifierResultPayload_FallsBackToReasoning(t *testing.T) {
	t.Parallel()

	got := structuredClassifierResultPayload(TurnResult{
		Reasoning: `{"enabled":true}`,
	}, structuredClassifierInteractionContractToolName)
	if got != `{"enabled":true}` {
		t.Fatalf("structuredClassifierResultPayload=%q, want reasoning fallback", got)
	}
}
