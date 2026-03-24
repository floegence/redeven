package ai

const (
	interactionContractClassificationModeSeedReuse     = "structured_response_seed_reuse"
	interactionContractClassificationModeDeterministic = "run_policy_contract"
)

type interactionContractClassificationMetadata struct {
	Mode                           string
	SeedReused                     bool
	StructuredResponseContinuation bool
}

func resolveInteractionContract(intent string, seed interactionContract, structuredResponseContinuation bool) interactionContract {
	contract, _ := resolveInteractionContractWithMetadata(intent, seed, structuredResponseContinuation)
	return contract
}

func resolveInteractionContractWithMetadata(intent string, seed interactionContract, structuredResponseContinuation bool) (interactionContract, interactionContractClassificationMetadata) {
	meta := interactionContractClassificationMetadata{
		Mode:                           interactionContractClassificationModeDeterministic,
		StructuredResponseContinuation: structuredResponseContinuation,
	}
	if normalizeRunIntent(intent) != RunIntentTask {
		return normalizeInteractionContract(interactionContract{Source: interactionContractSourceDeterministic}), meta
	}

	normalizedSeed := normalizeInteractionContract(seed)
	if structuredResponseContinuation && normalizedSeed.Enabled {
		meta.Mode = interactionContractClassificationModeSeedReuse
		meta.SeedReused = true
		return normalizedSeed, meta
	}
	if normalizedSeed.Enabled {
		return normalizedSeed, meta
	}
	return normalizeInteractionContract(interactionContract{Source: interactionContractSourceDeterministic}), meta
}
