package config

import (
	"encoding/json"

	flconfig "github.com/floegence/floret/v7/config"
	flprovider "github.com/floegence/floret/v7/provider"
)

func AIReasoningCapabilityForModel(providerType, modelName string) AIReasoningCapability {
	if model, ok := AIModelCatalogEntry(providerType, modelName); ok {
		return model.ReasoningCapability
	}
	return AIReasoningCapability{}
}

// OpenRouterReasoningCapability describes advertised reasoning without inventing effort controls.
func OpenRouterReasoningCapability() AIReasoningCapability {
	return AIReasoningCapability{
		Kind:                    "dynamic",
		DynamicProviderMetadata: true,
		WireShape:               "openrouter_reasoning_metadata",
		ResponseReasoningFields: []string{"reasoning", "reasoning_content"},
		SourceURLs:              []string{"https://openrouter.ai/docs/api-reference/parameters", "https://openrouter.ai/docs/guides/best-practices/reasoning-tokens", "https://openrouter.ai/api/v1/models"},
		SourceCheckedAt:         aiReasoningSourceCheckedAt,
		Fixture:                 "openrouter_model_reasoning_metadata",
	}.Normalize()
}

// OllamaReasoningCapability maps the published Floret contract to product metadata.
func OllamaReasoningCapability(raw json.RawMessage, thinkingCapable bool) (AIReasoningCapability, error) {
	cap, err := flprovider.ParseOllamaReasoningCapability(raw, thinkingCapable)
	if err != nil {
		return AIReasoningCapability{}, err
	}
	if cap.Kind == flconfig.ReasoningKindNone {
		return AIReasoningCapability{}, nil
	}
	kind := cap.Kind
	if kind == flconfig.ReasoningKindDynamic {
		kind = "dynamic"
	}
	levels := make([]string, 0, len(cap.SupportedLevels))
	for _, level := range cap.SupportedLevels {
		levels = append(levels, string(level))
	}
	return AIReasoningCapability{
		Kind: kind, SupportedLevels: levels, DefaultLevel: string(cap.DefaultLevel),
		DisableSupported: cap.DisableSupported, DynamicProviderMetadata: true,
		WireShape: "ollama_model_family_think", ResponseReasoningFields: []string{"reasoning"},
		HistoryReplayRequirements: []string{"reasoning"},
		SourceURLs:                []string{"https://docs.ollama.com/capabilities/thinking", "https://docs.ollama.com/api/openai-compatibility"},
		SourceCheckedAt:           "2026-10-04", Fixture: "ollama_show_thinking",
	}.Normalize(), nil
}
