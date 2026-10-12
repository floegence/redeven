package config

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestModelSelectionUsesCatalogWithoutPersistingExpansion(t *testing.T) {
	p := AIProvider{ID: "brand", Type: "openai", ModelSelection: &AIModelSelection{SelectedModels: []string{"gpt-6-astra"}}}
	if len(p.EffectiveModels()) != 1 {
		t.Fatal("only selected models should be enabled")
	}
	old := modelCatalog["openai"]
	defer func() { modelCatalog["openai"] = old }()
	modelCatalog["openai"] = append(append([]AIProviderModel{}, old...), AIProviderModel{ModelName: "future-agent", ContextWindow: 128000})
	cfg := &AIConfig{Providers: []AIProvider{p}, CurrentModelID: "brand/gpt-6-astra"}
	if cfg.IsAllowedModelID("brand/future-agent") || cfg.IsAllowedModelID("brand/gpt-5.5") {
		t.Fatal("catalog updates must preserve selections without enabling additions")
	}
	if len(p.Models) != 0 {
		t.Fatal("resolution mutated persistent models")
	}
}

func TestModelSelectionMigrationPreservesUserIntentAndRestarts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	old := cloneAIModels(legacyModelCatalog["openai"][:1])
	old[0].ContextWindow = 800000
	custom := AIProviderModel{ModelName: "my-model", ContextWindow: 64000}
	cfg := &Config{AI: &AIConfig{CurrentModelID: "brand/gpt-5.5", Providers: []AIProvider{{ID: "brand", Type: "openai", Models: append(old, custom)}}}}
	if err := Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	readonly, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if readonly.AI.Providers[0].ModelSelection != nil {
		t.Fatal("read-only load migrated")
	}
	next, err := LoadForStartup(path)
	if err != nil {
		t.Fatal(err)
	}
	if next.AI.CurrentModelID != cfg.AI.CurrentModelID {
		t.Fatal("migration changed current model")
	}
	p := next.AI.Providers[0]
	if len(p.Models) != 0 || len(p.ModelSelection.CustomModels) != 1 || len(p.ModelSelection.ModelOverrides) != 1 {
		t.Fatalf("preferences = %+v", p)
	}
	_, m, ok := next.AI.ProviderModelByID("brand/gpt-5.5")
	if !ok || m.ContextWindow != 800000 {
		t.Fatal("custom context override lost")
	}
	current, _ := AIModelCatalogEntry("openai", "gpt-5.5")
	if m.ReasoningCapability.SourceCheckedAt != current.ReasoningCapability.SourceCheckedAt {
		t.Fatal("old preset reasoning remained pinned")
	}
	if next.AI.IsAllowedModelID("brand/gpt-6-astra") || !next.AI.IsAllowedModelID("brand/my-model") {
		t.Fatal("migration must retain the explicit selection without enabling additions")
	}
	after, _ := os.ReadFile(path)
	if bytes.Equal(before, after) {
		t.Fatal("migration was not persisted")
	}
	if _, err = LoadForStartup(path); err != nil {
		t.Fatal(err)
	}
	again, _ := os.ReadFile(path)
	if !bytes.Equal(after, again) {
		t.Fatal("restart rewrote current configuration")
	}
}

func TestModelSelectionMigrationWriteFailureRetainsOriginal(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := &Config{AI: &AIConfig{CurrentModelID: "brand/gpt-5.5", Providers: []AIProvider{{ID: "brand", Type: "openai", Models: cloneAIModels(legacyModelCatalog["openai"][:1])}}}}
	if err := Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	persistence := defaultConfigPersistence()
	persistence.writeConfig = func(string, *Config) error { return errors.New("write denied") }
	if next, err := loadConfigForStartup(path, persistence); err == nil || next != nil {
		t.Fatal("failed migration published a config")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("failed write modified original")
	}
}

func TestRetiredCurrentModelIsPreservedButUnavailable(t *testing.T) {
	old := AIProviderModel{ModelName: "gpt-5.2-mini", ContextWindow: 123456}
	cfg := &AIConfig{CurrentModelID: "brand/gpt-5.2-mini", Providers: []AIProvider{{ID: "brand", Type: "openai", Models: []AIProviderModel{old}}}}
	if !migrateAIModelSelection(cfg) {
		t.Fatal("not migrated")
	}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	if cfg.CurrentModelID != "brand/gpt-5.2-mini" || cfg.IsAllowedModelID(cfg.CurrentModelID) {
		t.Fatal("retired model was substituted or re-enabled")
	}
	if got := cfg.Providers[0].ModelSelection.ModelOverrides[0]; got.ContextWindow != 123456 {
		t.Fatal("retired model override lost")
	}
}

func TestCatalogAdditionPreservesMatchingCustomModel(t *testing.T) {
	entry := AIProviderCatalog("deepseek")[0]
	custom := entry
	custom.ContextWindow = 87654
	custom.MaxOutputTokens = 16000
	p := AIProvider{ID: "brand", Type: "deepseek", BaseURL: "https://api.deepseek.com", ModelSelection: &AIModelSelection{CustomModels: []AIProviderModel{custom}}}
	cfg := &AIConfig{CurrentModelID: "brand/" + entry.ModelName, Providers: []AIProvider{p}}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	found := 0
	for _, m := range p.EffectiveModels() {
		if m.ModelName == entry.ModelName {
			found++
			if m.ContextWindow != custom.ContextWindow {
				t.Fatal("catalog replaced custom parameters")
			}
		}
	}
	if found != 1 {
		t.Fatalf("model duplicated: %d", found)
	}
}

func TestModelMigrationPreservesSmallerContextWithInheritedOutputLimit(t *testing.T) {
	cfg := &AIConfig{CurrentModelID: "brand/gpt-5.5", Providers: []AIProvider{{ID: "brand", Type: "openai", Models: []AIProviderModel{{ModelName: "gpt-5.5", ContextWindow: 32000}}}}}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	if !migrateAIModelSelection(cfg) {
		t.Fatal("not migrated")
	}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	_, model, ok := cfg.ProviderModelByID(cfg.CurrentModelID)
	if !ok || model.ContextWindow != 32000 || model.MaxOutputTokens > model.ContextWindow {
		t.Fatalf("context override lost: %+v", model)
	}
}

func TestChatGPTModelOverridesRemainBoundToReviewedAccountInventory(t *testing.T) {
	first := AIProviderModel{ModelName: "first", ContextWindow: 100000, InputModalities: []string{"text", "image"}}
	second := AIProviderModel{ModelName: "second", ContextWindow: 200000, InputModalities: []string{"text"}}
	for _, wire := range []string{"unavailable", "second"} {
		t.Run(wire, func(t *testing.T) {
			selection := &AIModelSelection{SelectedModels: []string{"first"}, ModelOverrides: []AIProviderModel{{ModelName: "first", WireModelName: wire, MaxOutputTokens: 1234}}}
			p := AIProvider{Type: "openai", AuthMethod: AIAuthChatGPT, AccountID: "account", ModelSelection: selection}.WithDiscoveredModels([]AIProviderModel{first, second})
			models := p.EffectiveModels()
			if wire == "unavailable" {
				if len(models) != 0 {
					t.Fatalf("wire override bypassed account inventory: %+v", models)
				}
			} else if len(models) != 1 || models[0].ModelName != "first" || models[0].EffectiveWireModelName() != "second" || models[0].ContextWindow != second.ContextWindow || len(models[0].InputModalities) != 1 || models[0].MaxOutputTokens != 1234 {
				t.Fatalf("override lost identity, target capabilities, or user parameters: %+v", models)
			}
			if selection.SelectedModels[0] != "first" || selection.ModelOverrides[0].WireModelName != wire {
				t.Fatal("inventory resolution mutated saved preferences")
			}
		})
	}
}
