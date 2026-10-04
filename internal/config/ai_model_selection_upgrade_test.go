package config

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestModelSelectionUpgradeFreezesDynamicInventory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := &Config{AI: &AIConfig{CurrentModelID: "local/agent", Providers: []AIProvider{{ID: "local", Type: "ollama", BaseURL: "http://localhost:11434/v1", ModelSelection: &AIModelSelection{DisabledModels: []string{"hidden"}, ModelOverrides: []AIProviderModel{{ModelName: "agent", ContextWindow: 8192}}}}}}}
	if err := Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	offline := func(AIProvider) ([]AIProviderModel, error) { return nil, errors.New("offline") }
	pending, err := LoadForStartup(path, offline)
	if err != nil {
		t.Fatal(err)
	}
	unchanged, _ := os.ReadFile(path)
	if !bytes.Equal(before, unchanged) || len(pending.AI.Providers[0].EffectiveModels()) != 0 {
		t.Fatal("offline upgrade must retain bytes and require selection review")
	}
	inventory := []AIProviderModel{{ModelName: "agent", ContextWindow: 32768}, {ModelName: "alias", ContextWindow: 32768}, {ModelName: "hidden", ContextWindow: 32768}}
	migrated, err := LoadForStartup(path, func(AIProvider) ([]AIProviderModel, error) { return inventory, nil })
	if err != nil {
		t.Fatal(err)
	}
	p := migrated.AI.Providers[0]
	if !reflect.DeepEqual(p.ModelSelection.SelectedModels, []string{"agent", "alias"}) {
		t.Fatalf("selection: %+v", p.ModelSelection)
	}
	resolved := p.WithDiscoveredModels(append(inventory, AIProviderModel{ModelName: "new-install", ContextWindow: 32768})).EffectiveModels()
	if len(resolved) != 2 || resolved[0].ContextWindow != 8192 {
		t.Fatalf("new catalog changed intent: %+v", resolved)
	}
	frozen, _ := os.ReadFile(path)
	if _, err := LoadForStartup(path, func(AIProvider) ([]AIProviderModel, error) {
		t.Fatal("completed migration rediscovered models")
		return nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	restarted, _ := os.ReadFile(path)
	if !bytes.Equal(frozen, restarted) {
		t.Fatal("restart changed frozen selection")
	}
}

func TestModelSelectionRetainsUnavailableIdentityAndRejectsAmbiguity(t *testing.T) {
	p := AIProvider{ID: "p", Type: "ollama", ModelSelection: &AIModelSelection{SelectedModels: []string{"removed"}}}
	if len(p.WithDiscoveredModels([]AIProviderModel{{ModelName: "other"}}).EffectiveModels()) != 0 {
		t.Fatal("missing model was substituted")
	}
	if !reflect.DeepEqual(p.ModelSelection.SelectedModels, []string{"removed"}) {
		t.Fatal("selection lost")
	}
	p.ModelSelection.DisabledModels = []string{"other"}
	if p.validateModelSelection() == nil {
		t.Fatal("mixed selection policies accepted")
	}
}

func TestModelSelectionUpgradePreservesOpenRouterAliasAndAvailability(t *testing.T) {
	cfg := &AIConfig{CurrentModelID: "router/my-agent", Providers: []AIProvider{{ID: "router", Type: "openrouter", Models: []AIProviderModel{{ModelName: "my-agent", WireModelName: "vendor/agent", ContextWindow: 32768}}}}}
	if !migrateAIModelSelection(cfg) {
		t.Fatal("explicit legacy list was not migrated")
	}
	p := cfg.Providers[0]
	if cfg.CurrentModelID != "router/my-agent" || !reflect.DeepEqual(p.ModelSelection.SelectedModels, []string{"my-agent"}) {
		t.Fatal("migration changed model identity")
	}
	inventory := []AIProviderModel{{ModelName: "vendor%2Fagent", WireModelName: "vendor/agent", ContextWindow: 64000, MaxOutputTokens: 16000}, {ModelName: "new", ContextWindow: 64000}}
	models := p.WithDiscoveredModels(inventory).EffectiveModels()
	if len(models) != 1 || models[0].ModelName != "my-agent" || models[0].ContextWindow != 32768 || models[0].MaxOutputTokens != 16000 {
		t.Fatalf("alias or explicit override lost: %+v", models)
	}
	if len(p.WithDiscoveredModels(inventory[1:]).EffectiveModels()) != 0 {
		t.Fatal("stale override admitted an unavailable model")
	}
	if len(p.WithDiscoveredModels(inventory).EffectiveModels()) != 1 {
		t.Fatal("reappearing selection did not recover")
	}
}

func TestModelSelectionFreezeWriteFailurePreservesLegacyBytes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := &Config{AI: &AIConfig{CurrentModelID: "local/agent", Providers: []AIProvider{{ID: "local", Type: "ollama", BaseURL: "http://localhost:11434/v1", ModelSelection: &AIModelSelection{}}}}}
	if err := Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	persistence := defaultConfigPersistence()
	persistence.writeConfig = func(string, *Config) error { return errors.New("write denied") }
	resolver := func(AIProvider) ([]AIProviderModel, error) {
		return []AIProviderModel{{ModelName: "agent", ContextWindow: 8192}}, nil
	}
	if next, err := loadConfigForStartup(path, persistence, resolver); err == nil || next != nil {
		t.Fatal("failed freeze published configuration")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("failed freeze modified configuration")
	}
}
