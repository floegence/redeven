package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestSearchCustomOpenAIEndpointIsNotBlacklisted(t *testing.T) {
	got := ResolveAIWebSearch(AIProvider{Type: "openai", BaseURL: "https://flow-node.com/v1"}, "gpt-6.1-sol", false)
	if !got.HostedTool() {
		t.Fatalf("custom endpoint search disabled: %+v", got)
	}
}

func searchBool(value bool) *bool { return &value }

func TestSearchRequiresProviderAndModelIntent(t *testing.T) {
	for _, providerEnabled := range []bool{false, true} {
		for _, modelEnabled := range []bool{false, true} {
			p := AIProvider{Type: "openai", BaseURL: "https://flow-node.com/v1", WebSearch: &AIProviderWebSearch{Enabled: providerEnabled, Source: AIWebSearchSourceNative}, Models: []AIProviderModel{{ModelName: "custom", WebSearchEnabled: searchBool(modelEnabled)}}}
			got := ResolveAIWebSearch(p, "custom", false)
			if got.HostedTool() != (providerEnabled && modelEnabled) || got.ModelEnabled != modelEnabled {
				t.Fatalf("provider=%v model=%v: %+v", providerEnabled, modelEnabled, got)
			}
		}
	}
}

func TestSearchDefaultsAndExplicitOverrides(t *testing.T) {
	for _, tc := range []struct {
		provider, model               string
		providerDefault, modelDefault bool
	}{
		{"openai", "gpt-5.5", true, true}, {"openai", "custom", true, true},
		{"openai_compatible", "custom", false, true},
		{"moonshot", "kimi-k2.6", true, true}, {"moonshot", "custom", true, false},
		{"chatglm", "glm-5.1", true, true}, {"chatglm", "custom", true, false},
		{"qwen", "qwen3.6-plus", true, true}, {"qwen", "qwen3.6-max-preview", true, false},
		{"anthropic", "custom", false, false}, {"google", "custom", false, false}, {"deepseek", "deepseek-v4-pro", false, false},
	} {
		t.Run(tc.provider+"/"+tc.model, func(t *testing.T) {
			p := AIProvider{Type: tc.provider}
			policy := ResolveAIWebSearchPolicy(p)
			got := ResolveAIWebSearch(p, tc.model, false)
			if policy.Enabled != tc.providerDefault || got.ModelEnabled != tc.modelDefault {
				t.Fatalf("defaults: %+v %+v", policy, got)
			}
			p.Models = []AIProviderModel{{ModelName: tc.model, WebSearchEnabled: searchBool(!tc.modelDefault)}}
			if got = ResolveAIWebSearch(p, tc.model, false); got.ModelEnabled == tc.modelDefault {
				t.Fatalf("explicit preference ignored: %+v", got)
			}
			if !policy.Editable && got.HostedTool() {
				t.Fatalf("unintegrated adapter exposed search: %+v", got)
			}
		})
	}
}

func TestSearchAliasAndRefreshPreserveIntent(t *testing.T) {
	p := AIProvider{Type: "openai", ModelSelection: &AIModelSelection{SelectedModels: []string{"agent"}, ModelOverrides: []AIProviderModel{{ModelName: "agent", WireModelName: "gpt-5.5", WebSearchEnabled: searchBool(false)}}}}
	for _, refreshed := range []AIProvider{p, p.WithDiscoveredModels(AIProviderCatalog("openai"))} {
		got := ResolveAIWebSearch(refreshed, "agent", false)
		if got.Status != "unavailable" || got.Reason != "model_disabled" || !got.RecommendedEnabled {
			t.Fatalf("alias intent changed: %+v", got)
		}
	}
	// An explicit choice on an unreviewed catalog entry wins over its recommendation.
	p = AIProvider{Type: "qwen", Models: []AIProviderModel{{ModelName: "qwen3.6-max-preview", WebSearchEnabled: searchBool(true)}}}
	if got := ResolveAIWebSearch(p, "qwen3.6-max-preview", false); !got.HostedTool() {
		t.Fatalf("hidden catalog gate: %+v", got)
	}
}

func TestSearchLegacyStartupMigrationIsAtomicAndIdempotent(t *testing.T) {
	for _, mode := range []string{"disabled", "openai_builtin", "brave"} {
		t.Run(mode, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "config.json")
			cfg := &Config{AI: &AIConfig{CurrentModelID: "p/agent", Providers: []AIProvider{{ID: "p", Type: "openai_compatible", BaseURL: "https://example.com/v1", Models: []AIProviderModel{{ModelName: "agent", ContextWindow: 32768, MaxOutputTokens: 4096, WebSearchEnabled: searchBool(false)}}}}}}
			if err := Save(path, cfg); err != nil {
				t.Fatal(err)
			}
			raw, _ := os.ReadFile(path)
			var data map[string]any
			if err := json.Unmarshal(raw, &data); err != nil {
				t.Fatal(err)
			}
			data["ai"].(map[string]any)["providers"].([]any)[0].(map[string]any)["web_search"] = map[string]any{"mode": mode}
			before, _ := json.Marshal(data)
			if err := os.WriteFile(path, before, 0600); err != nil {
				t.Fatal(err)
			}
			persistence := defaultConfigPersistence()
			persistence.writeConfig = func(string, *Config) error { return errors.New("write denied") }
			if next, err := loadConfigForStartup(path, persistence); err == nil || next != nil {
				t.Fatal("failed migration published configuration")
			}
			unchanged, _ := os.ReadFile(path)
			if !bytes.Equal(before, unchanged) {
				t.Fatal("failed migration changed bytes")
			}
			next, err := LoadForStartup(path)
			if err != nil {
				t.Fatal(err)
			}
			p := next.AI.Providers[0]
			if p.WebSearch.Enabled != (mode != "disabled") || (p.WebSearch.Source == "brave") != (mode == "brave") || *p.Models[0].WebSearchEnabled {
				t.Fatalf("lost intent: %+v", p)
			}
			after, _ := os.ReadFile(path)
			if bytes.Contains(after, []byte("\"mode\"")) {
				t.Fatal("legacy mode remained")
			}
			if _, err = LoadForStartup(path); err != nil {
				t.Fatal(err)
			}
			again, _ := os.ReadFile(path)
			if !bytes.Equal(after, again) {
				t.Fatal("restart rewrote canonical configuration")
			}
		})
	}
}

func TestSearchLegacyEmptyObjectPreservesExplicitDisable(t *testing.T) {
	for _, raw := range []string{"{}", "{  }", "{\n\t}"} {
		var search AIProviderWebSearch
		if err := json.Unmarshal([]byte(raw), &search); err != nil || search.Enabled || !search.legacy || search.Source != AIWebSearchSourceNative {
			t.Fatalf("empty legacy object lost disabled intent: %+v %v", search, err)
		}
	}
}
