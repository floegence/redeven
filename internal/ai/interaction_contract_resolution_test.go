package ai

import "testing"

func TestResolveInteractionContract_UsesDeterministicSeed(t *testing.T) {
	t.Parallel()

	got := resolveInteractionContract(
		RunIntentTask,
		interactionContract{
			Enabled:                  true,
			SingleQuestionPerTurn:    true,
			FixedChoicesRequired:     true,
			OpenTextFallbackRequired: true,
		},
		false,
	)
	if !got.Enabled {
		t.Fatalf("seed contract should stay enabled")
	}
	if !got.OpenTextFallbackRequired {
		t.Fatalf("open_text_fallback_required=false, want true")
	}
}

func TestResolveInteractionContractWithMetadata_ReusesSeedForStructuredContinuation(t *testing.T) {
	t.Parallel()

	got, meta := resolveInteractionContractWithMetadata(
		RunIntentTask,
		interactionContract{
			Enabled:                  true,
			Source:                   interactionContractSourceModel,
			SingleQuestionPerTurn:    true,
			FixedChoicesRequired:     true,
			OpenTextFallbackRequired: true,
		},
		true,
	)
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

func TestResolveInteractionContractWithMetadata_NonTaskDisablesContract(t *testing.T) {
	t.Parallel()

	got, meta := resolveInteractionContractWithMetadata(
		RunIntentSocial,
		interactionContract{
			Enabled:                  true,
			SingleQuestionPerTurn:    true,
			FixedChoicesRequired:     true,
			OpenTextFallbackRequired: true,
		},
		false,
	)
	if got.Enabled {
		t.Fatalf("non-task intent should clear the contract: %+v", got)
	}
	if meta.Mode != interactionContractClassificationModeDeterministic {
		t.Fatalf("classification_mode=%q, want %q", meta.Mode, interactionContractClassificationModeDeterministic)
	}
}

func TestStructuredClassifierResultPayload_FallsBackToReasoning(t *testing.T) {
	t.Parallel()

	got := structuredClassifierResultPayload(TurnResult{
		Reasoning: `{"enabled":true}`,
	}, structuredClassifierRunPolicyToolName)
	if got != `{"enabled":true}` {
		t.Fatalf("structuredClassifierResultPayload=%q, want reasoning fallback", got)
	}
}
