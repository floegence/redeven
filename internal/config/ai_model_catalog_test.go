package config

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestModelSelectionUsesCatalogWithoutPersistingExpansion(t *testing.T) {
	p := AIProvider{ID: "brand", Type: "openai", ModelSelection: &AIModelSelection{DisabledModels: []string{"gpt-5.5"}}}
	if len(p.EffectiveModels()) != len(AIProviderCatalog("openai"))-1 {
		t.Fatal("brand must default to all models except exclusions")
	}
	old := modelCatalog["openai"]
	defer func() { modelCatalog["openai"] = old }()
	modelCatalog["openai"] = append(append([]AIProviderModel{}, old...), AIProviderModel{ModelName: "future-agent", ContextWindow: 128000})
	cfg := &AIConfig{Providers: []AIProvider{p}, CurrentModelID: "brand/gpt-6-astra"}
	if !cfg.IsAllowedModelID("brand/future-agent") || cfg.IsAllowedModelID("brand/gpt-5.5") {
		t.Fatal("catalog updates must preserve exclusions and enable additions")
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
	if m.ReasoningCapability.SourceCheckedAt != "2026-09-09" {
		t.Fatal("old preset reasoning remained pinned")
	}
	if !next.AI.IsAllowedModelID("brand/gpt-6-astra") || !next.AI.IsAllowedModelID("brand/my-model") {
		t.Fatal("migration failed to enable current and custom models")
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
