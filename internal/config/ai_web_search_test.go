package config

import "testing"

func TestSearchCatalogReviewCoversEveryShippedModel(t *testing.T) {
	for provider, models := range modelCatalog {
		for _, model := range models {
			key := provider + "/" + model.EffectiveWireModelName()
			declaration, exists := webSearchCatalog[key]
			if !exists || len(declaration.SourceURLs) == 0 || declaration.SourceCheckedAt == "" {
				t.Errorf("missing search review: %s", key)
			}
		}
	}
}

func TestSearchResolutionRespectsEndpointAndCredentialBoundary(t *testing.T) {
	for _, tc := range []struct {
		name           string
		provider       AIProvider
		key            bool
		status, reason string
	}{
		{"official", AIProvider{Type: "openai", BaseURL: "https://api.openai.com/v1"}, false, "available", "catalog_supported"},
		{"custom", AIProvider{Type: "openai", BaseURL: "https://proxy.example/v1"}, false, "unavailable", "endpoint_not_supported"},
		{"unset", AIProvider{Type: "openai_compatible"}, false, "unavailable", "not_configured"},
		{"missing_key", AIProvider{Type: "openai_compatible", WebSearch: &AIProviderWebSearch{Mode: "brave"}}, false, "unavailable", "needs_credentials"},
		{"normalized", AIProvider{Type: " openai_compatible ", WebSearch: &AIProviderWebSearch{Mode: " Brave "}}, true, "available", "configured"},
		{"brave", AIProvider{Type: "openai_compatible", WebSearch: &AIProviderWebSearch{Mode: "brave"}}, true, "available", "configured"},
		{"invalid", AIProvider{Type: "openai_compatible", WebSearch: &AIProviderWebSearch{Mode: "invalid"}}, true, "unavailable", "invalid_configuration"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := ResolveAIWebSearch(tc.provider, "gpt-5.5", tc.key)
			if got.Status != tc.status || got.Reason != tc.reason {
				t.Fatalf("search=%+v", got)
			}
		})
	}
}
