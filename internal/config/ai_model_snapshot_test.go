package config

import (
	"errors"
	"path/filepath"
	"reflect"
	"testing"
)

func TestChatGPTSnapshotUsesAccountIdentityWithoutAPIKey(t *testing.T) {
	root := t.TempDir()
	p := AIProvider{ID: "openai", Type: "openai", AuthMethod: AIAuthChatGPT, AccountID: "account", ModelSelection: &AIModelSelection{SelectedModels: []string{"gpt-6.1-sol"}}}
	models := AIProviderCatalog("openai")
	if err := WriteModelCatalogSnapshot(root, ModelCatalogIdentity(p, ""), models); err != nil {
		t.Fatal(err)
	}
	for _, fail := range []bool{false, true} {
		resolved := WithLocalModelCatalogs(&AIConfig{Providers: []AIProvider{p}}, root, func(string) (string, bool, error) {
			t.Error("ChatGPT inventory must not resolve an API key")
			if fail {
				return "", false, errors.New("API-key vault unavailable")
			}
			return "previous-api-key", true, nil
		})
		if got := resolved.Providers[0].EffectiveModels(); len(got) != 1 || got[0].ContextWindow != models[0].ContextWindow {
			t.Fatalf("account model metadata lost: %+v", got)
		}
	}
	if ModelCatalogIdentity(p, "previous-api-key") != ModelCatalogIdentity(p, "") {
		t.Fatal("inactive API key changed account inventory scope")
	}
}

func TestAllChatGPTDefaultsSurviveConfigurationRestart(t *testing.T) {
	root := t.TempDir()
	models := AIProviderCatalog("openai")
	p := AIProvider{ID: "openai", Type: "openai", AuthMethod: AIAuthChatGPT, AccountID: "account", ModelSelection: &AIModelSelection{SelectedModels: []string{}}}
	for _, m := range models {
		p.ModelSelection.SelectedModels = append(p.ModelSelection.SelectedModels, m.ModelName)
		p.ModelSelection.ModelOverrides = append(p.ModelSelection.ModelOverrides, AIProviderModel{ModelName: m.ModelName})
	}
	path := filepath.Join(root, "config.json")
	if err := Save(path, &Config{AI: &AIConfig{Providers: []AIProvider{p}, CurrentModelID: p.ID + "/" + models[0].ModelName}}); err != nil {
		t.Fatal(err)
	}
	if err := WriteModelCatalogSnapshot(root, ModelCatalogIdentity(p, ""), models); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadForStartup(path)
	if err != nil {
		t.Fatal(err)
	}
	resolved := WithLocalModelCatalogs(cfg.AI, root, nil)
	if got := resolved.Providers[0].EffectiveModels(); !reflect.DeepEqual(got, models) {
		t.Fatal("saved sparse configuration changed account model defaults")
	}
	if resolved.CurrentModelID != cfg.AI.CurrentModelID || !reflect.DeepEqual(resolved.Providers[0].ModelSelection, p.ModelSelection) {
		t.Fatal("account metadata resolution changed persisted user intent")
	}
	other := *cfg.AI
	other.Providers = append([]AIProvider(nil), cfg.AI.Providers...)
	other.Providers[0].AccountID = "another-account"
	if got := WithLocalModelCatalogs(&other, root, nil).Providers[0].EffectiveModels(); len(got) != 0 {
		t.Fatal("another account reused model availability")
	}
}

func TestAllReviewedCatalogDefaultsRefreshCachedInventories(t *testing.T) {
	for providerType, catalog := range modelCatalog {
		t.Run(providerType, func(t *testing.T) {
			for _, expected := range catalog {
				p := AIProvider{Type: providerType, ModelSelection: &AIModelSelection{SelectedModels: []string{expected.ModelName}}}
				// An older complete inventory contains identities but missing/stale defaults.
				cached := AIProviderModel{ModelName: expected.ModelName, WireModelName: expected.WireModelName, ContextWindow: 4096, MaxOutputTokens: 512, InputModalities: []string{"text"}, Status: "needs_configuration", DisplayName: "Account display name"}
				if providerType == "google" {
					// Native Google limits are serving metadata, not shipped defaults.
					cached.ContextWindow, cached.MaxOutputTokens = expected.ContextWindow, expected.MaxOutputTokens
				}
				got := p.WithDiscoveredModels([]AIProviderModel{cached}).EffectiveModels()
				want := expected
				want.DisplayName = cached.DisplayName
				if len(got) != 1 || !reflect.DeepEqual(got[0], want) {
					t.Fatalf("%s defaults did not refresh: %+v", expected.ModelName, got)
				}
				p.ModelSelection.ModelOverrides = []AIProviderModel{{ModelName: expected.ModelName, ContextWindow: 32000, MaxOutputTokens: 1024}}
				got = p.WithDiscoveredModels([]AIProviderModel{cached}).EffectiveModels()
				if len(got) != 1 || got[0].ContextWindow != 32000 || got[0].MaxOutputTokens != 1024 {
					t.Fatalf("%s user override lost: %+v", expected.ModelName, got)
				}
				if len(p.WithDiscoveredModels([]AIProviderModel{}).EffectiveModels()) != 0 {
					t.Fatal("defaults bypassed empty inventory")
				}
			}
		})
	}
}

func TestCatalogRefreshRetainsServingLimitsAndProtocolRejection(t *testing.T) {
	google := AIProviderCatalog("google")[0]
	p := AIProvider{Type: "google", ModelSelection: &AIModelSelection{SelectedModels: []string{google.ModelName}}}
	google.ContextWindow, google.MaxOutputTokens = 16384, 1024
	if got := p.WithDiscoveredModels([]AIProviderModel{google}).EffectiveModels(); len(got) != 1 || got[0].ContextWindow != 16384 || got[0].MaxOutputTokens != 1024 {
		t.Fatal("shipped defaults replaced live serving limits")
	}
	openai := AIProviderCatalog("openai")[0]
	p.Type = "openai"
	p.ModelSelection.SelectedModels = []string{openai.ModelName}
	no := false
	for _, rejected := range []AIProviderModel{
		{ModelName: openai.ModelName, Status: "unsupported"},
		{ModelName: openai.ModelName, SupportsTools: &no},
	} {
		if len(p.WithDiscoveredModels([]AIProviderModel{rejected}).EffectiveModels()) != 0 {
			t.Fatal("reviewed defaults bypassed protocol rejection")
		}
	}
	for _, providerType := range []string{"openrouter", "ollama", "openai_compatible"} {
		p := AIProvider{Type: providerType}.WithDiscoveredModels([]AIProviderModel{google})
		if !reflect.DeepEqual(p.CatalogModels(), []AIProviderModel{google}) {
			t.Fatal("static defaults replaced dynamic or explicit model metadata")
		}
	}
}

func TestUnreviewedCachedModelNeedsExplicitCapabilities(t *testing.T) {
	yes := true
	cached := AIProviderModel{ModelName: "retired-or-unreviewed", ContextWindow: 64000, MaxOutputTokens: 4096, SupportsTools: &yes}
	p := AIProvider{Type: "openai", ModelSelection: &AIModelSelection{SelectedModels: []string{cached.ModelName}}}.WithDiscoveredModels([]AIProviderModel{cached})
	if len(p.EffectiveModels()) != 0 || p.CatalogModels()[0].Status != "needs_configuration" {
		t.Fatal("old metadata bypassed current model review")
	}
	p.ModelSelection.ModelOverrides = []AIProviderModel{cached}
	if got := p.EffectiveModels(); len(got) != 1 || got[0].ContextWindow != cached.ContextWindow {
		t.Fatal("explicit capability configuration was lost")
	}
}

func TestCatalogAvailabilityCannotBeOverridden(t *testing.T) {
	yes, no := true, false
	manual := AIProviderModel{ModelName: "alias", WireModelName: "wire", ContextWindow: 8192, MaxOutputTokens: 1024, SupportsTools: &yes}
	p := AIProvider{ID: "p", Type: "openai_compatible", Models: []AIProviderModel{manual}}
	for _, models := range [][]AIProviderModel{
		{}, {{ModelName: "wire", ContextWindow: 8192, SupportsTools: &no}}, {{ModelName: "wire", ContextWindow: 8192, Status: "unsupported"}},
	} {
		if len(p.WithDiscoveredModels(models).EffectiveModels()) != 0 {
			t.Fatal("manual capability bypassed confirmed inventory")
		}
	}
	models := []AIProviderModel{{ModelName: "wire", Status: "needs_configuration"}}
	resolved := p.WithDiscoveredModels(models).EffectiveModels()
	if len(resolved) != 1 || resolved[0].ModelName != "alias" || resolved[0].Status != "" {
		t.Fatal("configured capability did not preserve alias")
	}
	yes = false
	if !*resolved[0].SupportsTools {
		t.Fatal("catalog projection retained mutable pointer")
	}
}

func TestModelSnapshotScopeValidationAndDetachedRead(t *testing.T) {
	root := t.TempDir()
	p := AIProvider{ID: "provider", Type: "openai"}
	identity := ModelCatalogIdentity(p, "key")
	tools := true
	models := []AIProviderModel{{ModelName: "agent", ContextWindow: 8192, SupportsTools: &tools}}
	if err := WriteModelCatalogSnapshot(root, identity, models); err != nil {
		t.Fatal(err)
	}
	a, err := ReadModelCatalogSnapshot(root, identity)
	if err != nil {
		t.Fatal(err)
	}
	*a[0].SupportsTools = false
	b, err := ReadModelCatalogSnapshot(root, identity)
	if err != nil || !*b[0].SupportsTools {
		t.Fatal("read changed canonical snapshot")
	}
	if err := WriteModelCatalogSnapshot(root, "../escape", models); err == nil {
		t.Fatal("invalid scope accepted")
	}
	if _, err := ReadModelCatalogSnapshot(root, ModelCatalogIdentity(p, "another-key")); err == nil {
		t.Fatal("another credential reused snapshot")
	}
}

func TestSettingsCatalogRetainsRawIdentityAndCapabilities(t *testing.T) {
	yes := true
	manual := AIProviderModel{ModelName: "alias", WireModelName: "wire", ContextWindow: 8192, MaxOutputTokens: 1024, SupportsTools: &yes}
	for _, p := range []AIProvider{
		{Models: []AIProviderModel{manual}},
		{ModelSelection: &AIModelSelection{SelectedModels: []string{"alias"}, ModelOverrides: []AIProviderModel{manual}}},
	} {
		p = p.WithDiscoveredModels([]AIProviderModel{{ModelName: "wire", Status: "needs_configuration"}})
		catalog := p.CatalogModels()
		if len(catalog) != 1 || catalog[0].ModelName != "wire" || catalog[0].ContextWindow != 0 || catalog[0].Status != "needs_configuration" {
			t.Fatalf("settings baseline absorbed user intent: %+v", catalog)
		}
		if models := p.EffectiveModels(); len(models) != 1 || models[0].ModelName != "alias" || models[0].Status != "" {
			t.Fatalf("configured alias did not resolve: %+v", models)
		}
	}
}

func TestWireOverrideUsesActualTargetCapabilities(t *testing.T) {
	yes, no := true, false
	known := AIProviderModel{ModelName: "known", ContextWindow: 32768, MaxOutputTokens: 4096, SupportsTools: &yes}
	p := AIProvider{Type: "deepseek", ModelSelection: &AIModelSelection{SelectedModels: []string{"known"}, ModelOverrides: []AIProviderModel{{ModelName: "known", WireModelName: "target"}}}}
	for _, target := range []AIProviderModel{
		{ModelName: "target", Status: "needs_configuration"},
		{ModelName: "target", ContextWindow: 8192, SupportsTools: &no},
	} {
		if got := p.WithDiscoveredModels([]AIProviderModel{known, target}).EffectiveModels(); len(got) != 0 {
			t.Fatalf("alias borrowed capabilities from another wire model: %+v", got)
		}
	}
}
