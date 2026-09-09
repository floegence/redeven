package config

import "strings"

func AIReasoningCapabilityForModel(providerType, modelName string) AIReasoningCapability {
	if model, ok := AIModelCatalogEntry(providerType, modelName); ok {
		return model.ReasoningCapability
	}
	switch strings.ToLower(strings.TrimSpace(providerType)) {
	case "openrouter":
		return openRouterDynamicReasoningCapability()
	case "ollama":
		return ollamaDynamicReasoningCapability()
	}
	return AIReasoningCapability{}
}

func openRouterDynamicReasoningCapability() AIReasoningCapability {
	return AIReasoningCapability{
		Kind:                    "dynamic",
		DynamicProviderMetadata: true,
		WireShape:               "openrouter_reasoning_metadata",
		SourceURLs:              []string{"https://openrouter.ai/docs/api-reference/parameters", "https://openrouter.ai/docs/guides/best-practices/reasoning-tokens", "https://openrouter.ai/api/v1/models"},
		SourceCheckedAt:         aiReasoningSourceCheckedAt,
		Fixture:                 "openrouter_model_reasoning_metadata",
	}.Normalize()
}

func ollamaDynamicReasoningCapability() AIReasoningCapability {
	return AIReasoningCapability{
		Kind:                    "dynamic",
		DynamicProviderMetadata: true,
		WireShape:               "ollama_model_family_think",
		SourceURLs:              []string{"https://docs.ollama.com/capabilities/thinking", "https://docs.ollama.com/api/chat"},
		SourceCheckedAt:         aiReasoningSourceCheckedAt,
		Fixture:                 "ollama_model_family_think",
	}.Normalize()
}
