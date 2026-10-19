package config

import (
	"encoding/json"
	flprovider "github.com/floegence/floret/v7/provider"
	"testing"
)

func TestSearchCatalogReviewCoversEveryShippedModel(t *testing.T) {
	for provider, models := range modelCatalog {
		for _, model := range models {
			key := provider + "/" + model.EffectiveWireModelName()
			if provider == "deepseek" {
				if _, ok := flprovider.DeepSeekModelCapabilities(model.EffectiveWireModelName()); !ok {
					t.Errorf("missing upstream DeepSeek capability: %s", key)
				}
				continue
			}
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
		{"custom", AIProvider{Type: "openai", BaseURL: "https://proxy.example/v1"}, false, "available", "catalog_supported"},
		{"unset", AIProvider{Type: "openai_compatible"}, false, "unavailable", "provider_disabled"},
		{"missing_key", AIProvider{Type: "openai_compatible", WebSearch: &AIProviderWebSearch{Enabled: true, Source: "brave"}}, false, "unavailable", "needs_credentials"},
		{"normalized", AIProvider{Type: " openai_compatible ", WebSearch: &AIProviderWebSearch{Enabled: true, Source: "brave"}}, true, "available", "configured"},
		{"brave", AIProvider{Type: "openai_compatible", WebSearch: &AIProviderWebSearch{Enabled: true, Source: "brave"}}, true, "available", "configured"},
		{"invalid", AIProvider{Type: "openai_compatible", WebSearch: &AIProviderWebSearch{Enabled: true, Source: "invalid"}}, true, "unavailable", "invalid_configuration"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := ResolveAIWebSearch(tc.provider, "gpt-5.5", tc.key)
			if got.Status != tc.status || got.Reason != tc.reason {
				t.Fatalf("search=%+v", got)
			}
		})
	}
}

func TestDeepSeekSearchRoutingAndDefaults(t *testing.T) {
	for _, model := range []string{"deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro"} {
		p := AIProvider{ID: "ds", Type: "deepseek"}
		got := ResolveAIWebSearch(p, model, true)
		if got.Status != "available" || got.LocalTool() != (model != "deepseek-v4-pro") || got.HostedTool() != (model == "deepseek-v4-pro") {
			t.Fatalf("%s: %+v", model, got)
		}
		p.WebSearch = &AIProviderWebSearch{Enabled: false, Source: AIWebSearchSourceNative}
		if got := ResolveAIWebSearch(p, model, true); got.Status == "available" {
			t.Fatalf("disabled: %+v", got)
		}
	}
	if got := ResolveAIWebSearch(AIProvider{ID: "ds", Type: "deepseek"}, "custom", true); got.Status == "available" {
		t.Fatalf("unknown: %+v", got)
	}
}
func TestWebFetchConfiguration(t *testing.T) {
	p := AIProvider{Type: "deepseek"}
	if p.WebFetchSource() != "direct" {
		t.Fatal("changed direct default")
	}
	p.WebFetch = &AIProviderWebFetch{Source: "deepseek"}
	if err := p.validateWebFetch(); err != nil {
		t.Fatal(err)
	}
	p.Type = "openai"
	if err := p.validateWebFetch(); err == nil {
		t.Fatal("accepted remote fetch for another provider")
	}
	p.WebFetch = &AIProviderWebFetch{Source: "unknown"}
	if err := p.validateWebFetch(); err == nil {
		t.Fatal("accepted invalid source")
	}
}

func TestDeepSeekFetchProfileRoundTrip(t *testing.T) {
	for _, source := range []string{"direct", "deepseek"} {
		original := AIProvider{ID: "ds", Type: "deepseek", WebFetch: &AIProviderWebFetch{Source: source}, WebSearch: &AIProviderWebSearch{Enabled: false, Source: "native"}}
		data, err := json.Marshal(original)
		if err != nil {
			t.Fatal(err)
		}
		var restored AIProvider
		if err = json.Unmarshal(data, &restored); err != nil {
			t.Fatal(err)
		}
		if restored.WebFetchSource() != source || restored.WebSearch.Enabled {
			t.Fatalf("intent lost: %s", data)
		}
	}
}
