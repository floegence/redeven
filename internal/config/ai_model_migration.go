package config

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"reflect"
)

// The shipped explicit presets identify old defaults, never current availability.
//
//go:embed model_catalog_legacy.json
var legacyModelCatalogJSON []byte

var legacyModelCatalog = func() map[string][]AIProviderModel {
	var out map[string][]AIProviderModel
	if err := json.Unmarshal(legacyModelCatalogJSON, &out); err != nil {
		panic(err)
	}
	return out
}()

// LoadForStartup upgrades model preferences before the runtime becomes available.
// Read-only consumers continue to use Load.
func LoadForStartup(path string) (*Config, error) {
	return loadConfigForStartup(path, defaultConfigPersistence())
}

func loadConfigForStartup(path string, persistence configPersistence) (*Config, error) {
	cfg, err := loadConfig(path, persistence)
	if err != nil {
		return nil, err
	}
	if cfg.AI == nil {
		return cfg, nil
	}
	// Work on a detached value so a failed write cannot publish a partial upgrade.
	raw, err := json.Marshal(cfg)
	if err != nil {
		return nil, err
	}
	var next Config
	if err = json.Unmarshal(raw, &next); err != nil {
		return nil, err
	}
	if !migrateAIModelSelection(next.AI) {
		return cfg, nil
	}
	if err = saveConfig(path, &next, persistence); err != nil {
		return nil, fmt.Errorf("save model selection migration: %w", err)
	}
	return &next, nil
}

func migrateAIModelSelection(cfg *AIConfig) bool {
	if cfg == nil {
		return false
	}
	changed := false
	for i := range cfg.Providers {
		p := &cfg.Providers[i]
		if p.ModelSelection != nil || (!AIProviderUsesCatalog(p.Type) && p.Type != "ollama") {
			continue
		}
		selection := &AIModelSelection{}
		for _, m := range p.Models {
			var old AIProviderModel
			known := false
			for _, preset := range legacyModelCatalog[p.Type] {
				if preset.ModelName == m.ModelName {
					old = preset
					known = true
					break
				}
			}
			if !known {
				if preset, ok := AIModelCatalogEntry(p.Type, m.ModelName); ok {
					old = preset
					known = true
				}
			}
			if known || p.Type == "ollama" {
				override := aiModelDifference(m, old)
				if _, current := AIModelCatalogEntry(p.Type, m.ModelName); !current {
					override = m
				}
				if !reflect.DeepEqual(override, AIProviderModel{ModelName: m.ModelName}) {
					selection.ModelOverrides = append(selection.ModelOverrides, override)
				}
			} else {
				selection.CustomModels = append(selection.CustomModels, m)
			}
		}
		p.ModelSelection = selection
		p.Models = nil
		changed = true
	}
	return changed
}

func aiModelDifference(model, base AIProviderModel) AIProviderModel {
	out := AIProviderModel{ModelName: model.ModelName}
	if model.WireModelName != "" && model.WireModelName != base.WireModelName {
		out.WireModelName = model.WireModelName
	}
	if model.ContextWindow != 0 && model.ContextWindow != base.ContextWindow {
		out.ContextWindow = model.ContextWindow
	}
	if model.MaxOutputTokens != 0 && model.MaxOutputTokens != base.MaxOutputTokens {
		out.MaxOutputTokens = model.MaxOutputTokens
	}
	if model.EffectiveContextWindowPercent != 0 && model.EffectiveContextWindowPercent != 95 && model.EffectiveContextWindowPercent != base.EffectiveContextWindowPercent {
		out.EffectiveContextWindowPercent = model.EffectiveContextWindowPercent
	}
	if model.InputModalities != nil && !reflect.DeepEqual(model.NormalizedInputModalities(), base.NormalizedInputModalities()) {
		out.InputModalities = model.InputModalities
	}
	if !model.ReasoningCapability.IsZero() && !reflect.DeepEqual(model.ReasoningCapability.Normalize(), base.ReasoningCapability.Normalize()) {
		out.ReasoningCapability = model.ReasoningCapability
	}
	if !model.DefaultReasoningSelection.IsZero() && model.DefaultReasoningSelection != base.DefaultReasoningSelection {
		out.DefaultReasoningSelection = model.DefaultReasoningSelection
	}
	return out
}
