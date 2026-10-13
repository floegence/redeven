package config

import "testing"

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
