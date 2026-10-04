package config

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"strings"
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

// ModelCatalogResolver reads authenticated inventory without changing a provider.
type ModelCatalogResolver func(AIProvider) ([]AIProviderModel, error)

// LoadForStartup upgrades model preferences before the runtime becomes available.
// Read-only consumers continue to use Load.
func LoadForStartup(path string, discover ...ModelCatalogResolver) (*Config, error) {
	return loadConfigForStartup(path, defaultConfigPersistence(), discover...)
}

func loadConfigForStartup(path string, persistence configPersistence, discover ...ModelCatalogResolver) (*Config, error) {
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
	if !migrateAIModelSelection(next.AI, discover...) {
		return cfg, nil
	}
	if err = saveConfig(path, &next, persistence); err != nil {
		return nil, fmt.Errorf("save model selection migration: %w", err)
	}
	return &next, nil
}

func migrateAIModelSelection(cfg *AIConfig, discover ...ModelCatalogResolver) bool {
	if cfg == nil {
		return false
	}
	changed := false
	for i := range cfg.Providers {
		p := &cfg.Providers[i]
		if !AIProviderUsesCatalog(p.Type) && p.Type != "ollama" && p.Type != "openrouter" {
			continue
		}
		if p.ModelSelection != nil && p.ModelSelection.SelectedModels != nil {
			continue
		}
		selection := &AIModelSelection{SelectedModels: []string{}}
		if p.ModelSelection != nil {
			*selection = *p.ModelSelection
			selection.SelectedModels = []string{}
			models := p.EffectiveModels()
			if p.Type == "ollama" {
				if len(discover) == 0 || discover[0] == nil {
					continue
				}
				inventory, err := discover[0](*p)
				// Keep the original profile when offline; saving a reviewed selection can recover it.
				if err != nil {
					continue
				}
				models = inventory
			}
			for _, m := range models {
				if !slices.Contains(selection.DisabledModels, m.ModelName) {
					selection.SelectedModels = append(selection.SelectedModels, m.ModelName)
				}
			}
			// Preserve the current identity and historical overrides even when uninstalled.
			for _, m := range selection.ModelOverrides {
				if !slices.Contains(selection.DisabledModels, m.ModelName) && !slices.Contains(selection.SelectedModels, m.ModelName) {
					selection.SelectedModels = append(selection.SelectedModels, m.ModelName)
				}
			}
			if pid, name, ok := strings.Cut(cfg.CurrentModelID, "/"); ok && pid == p.ID && !slices.Contains(selection.DisabledModels, name) && !slices.Contains(selection.SelectedModels, name) {
				selection.SelectedModels = append(selection.SelectedModels, name)
			}
			selection.DisabledModels = nil
		} else {
			// An explicit old list already records intent. Never expand it during upgrade.
			for _, m := range p.Models {
				selection.SelectedModels = append(selection.SelectedModels, m.ModelName)
				old, known := AIModelCatalogEntry(p.Type, m.ModelName)
				for _, preset := range legacyModelCatalog[p.Type] {
					if preset.ModelName == m.ModelName {
						old = preset
						known = true
						break
					}
				}
				if known || p.Type == "ollama" || p.Type == "openrouter" {
					override := aiModelDifference(m, old)
					if !reflect.DeepEqual(override, AIProviderModel{ModelName: m.ModelName}) {
						selection.ModelOverrides = append(selection.ModelOverrides, override)
					}
				} else {
					selection.CustomModels = append(selection.CustomModels, m)
				}
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
