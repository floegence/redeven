package config

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
)

//go:embed model_catalog.generated.json
var modelCatalogJSON []byte

var modelCatalog = func() map[string][]AIProviderModel {
	var data struct {
		Providers map[string][]AIProviderModel `json:"providers"`
	}
	if err := json.Unmarshal(modelCatalogJSON, &data); err != nil {
		panic(err)
	}
	return data.Providers
}()

// AIProviderCatalog returns a detached snapshot of the shipped Agent models.
func AIProviderCatalog(providerType string) []AIProviderModel {
	return cloneAIModels(modelCatalog[strings.ToLower(strings.TrimSpace(providerType))])
}

func AIProviderUsesCatalog(providerType string) bool {
	_, ok := modelCatalog[strings.ToLower(strings.TrimSpace(providerType))]
	return ok
}

func AIModelCatalogEntry(providerType, modelName string) (AIProviderModel, bool) {
	for _, m := range modelCatalog[strings.ToLower(strings.TrimSpace(providerType))] {
		if m.ModelName == modelName || m.EffectiveWireModelName() == modelName {
			return cloneAIModels([]AIProviderModel{m})[0], true
		}
	}
	return AIProviderModel{}, false
}

// AIModelLocalName keeps a provider's wire identifier separate from route paths.
func AIModelLocalName(wire string) string {
	return strings.ReplaceAll(strings.ReplaceAll(wire, "%", "%25"), "/", "%2F")
}

// AIModelSelection stores user intent independently of changing catalogs.
// Presence distinguishes the current shape from a legacy explicit brand list.
type AIModelSelection struct {
	DisabledModels []string          `json:"disabled_models,omitempty"`
	CustomModels   []AIProviderModel `json:"custom_models,omitempty"`
	ModelOverrides []AIProviderModel `json:"model_overrides,omitempty"`
}

func cloneAIModels(models []AIProviderModel) []AIProviderModel {
	out := slices.Clone(models)
	for i := range out {
		out[i].InputModalities = slices.Clone(out[i].InputModalities)
		out[i].ReasoningCapability.ResponseReasoningFields = slices.Clone(out[i].ReasoningCapability.ResponseReasoningFields)
		out[i].ReasoningCapability.HistoryReplayRequirements = slices.Clone(out[i].ReasoningCapability.HistoryReplayRequirements)
		out[i].ReasoningCapability.SourceURLs = slices.Clone(out[i].ReasoningCapability.SourceURLs)
		out[i].ReasoningCapability.SupportedLevels = slices.Clone(out[i].ReasoningCapability.SupportedLevels)
	}
	return out
}

// EffectiveModels resolves an in-memory view; the result is never persisted.
func (p AIProvider) EffectiveModels() []AIProviderModel {
	if p.ModelSelection == nil {
		return cloneAIModels(p.Models)
	}
	models := AIProviderCatalog(p.Type)
	if p.Type == "ollama" {
		models = cloneAIModels(p.discoveredModels)
	}
	for i := range models {
		for _, override := range p.ModelSelection.ModelOverrides {
			if override.ModelName == models[i].ModelName {
				models[i] = applyAIModelOverride(models[i], override)
				break
			}
		}
	}
	for _, custom := range cloneAIModels(p.ModelSelection.CustomModels) {
		found := false
		for i := range models {
			if models[i].ModelName == custom.ModelName {
				models[i] = applyAIModelOverride(models[i], custom)
				found = true
				break
			}
		}
		if !found {
			models = append(models, custom)
		}
	}
	return slices.DeleteFunc(models, func(m AIProviderModel) bool { return slices.Contains(p.ModelSelection.DisabledModels, m.ModelName) })
}

// WithDiscoveredModels binds the current Ollama inventory only to this value.
func (p AIProvider) WithDiscoveredModels(models []AIProviderModel) AIProvider {
	p.discoveredModels = cloneAIModels(models)
	return p
}

func applyAIModelOverride(model, override AIProviderModel) AIProviderModel {
	if override.WireModelName != "" {
		model.WireModelName = override.WireModelName
	}
	if override.ContextWindow != 0 {
		model.ContextWindow = override.ContextWindow
	}
	if override.MaxOutputTokens != 0 {
		model.MaxOutputTokens = override.MaxOutputTokens
	} else if model.ContextWindow > 0 && model.MaxOutputTokens > model.ContextWindow {
		model.MaxOutputTokens = model.ContextWindow
	}
	if override.EffectiveContextWindowPercent != 0 {
		model.EffectiveContextWindowPercent = override.EffectiveContextWindowPercent
	}
	if override.InputModalities != nil {
		model.InputModalities = slices.Clone(override.InputModalities)
	}
	if !override.ReasoningCapability.IsZero() {
		model.ReasoningCapability = override.ReasoningCapability
	}
	if !override.DefaultReasoningSelection.IsZero() {
		model.DefaultReasoningSelection = override.DefaultReasoningSelection
	}
	return model
}

func (p AIProvider) validateModelSelection() error {
	if p.ModelSelection == nil {
		return nil
	}
	if !AIProviderUsesCatalog(p.Type) && p.Type != "ollama" {
		return fmt.Errorf("model_selection is unsupported for %s", p.Type)
	}
	if len(p.Models) > 0 {
		return errors.New("models and model_selection are mutually exclusive")
	}
	seen := map[string]bool{}
	for _, name := range p.ModelSelection.DisabledModels {
		if strings.TrimSpace(name) == "" || strings.Contains(name, "/") || seen[name] {
			return errors.New("invalid or duplicate disabled model")
		}
		seen[name] = true
	}
	seen = map[string]bool{}
	for _, models := range [][]AIProviderModel{p.ModelSelection.CustomModels, p.ModelSelection.ModelOverrides} {
		for _, m := range models {
			if seen[m.ModelName] {
				return fmt.Errorf("duplicate custom model or override %q", m.ModelName)
			}
			seen[m.ModelName] = true
		}
	}
	if p.Type == "ollama" && len(p.ModelSelection.CustomModels) > 0 {
		return errors.New("Ollama models must come from the installed inventory")
	}
	for _, m := range p.ModelSelection.CustomModels {
		if m.ContextWindow <= 0 {
			return fmt.Errorf("custom model %q requires context_window", m.ModelName)
		}
	}
	return nil
}

func (p AIProvider) modelsForValidation() []AIProviderModel {
	if p.ModelSelection == nil {
		return p.Models
	}
	models := p.EffectiveModels()
	// Retain and validate inactive metadata without admitting it to the model list.
	for _, list := range [][]AIProviderModel{p.ModelSelection.ModelOverrides, p.ModelSelection.CustomModels} {
		for _, m := range list {
			found := false
			for _, active := range models {
				if active.ModelName == m.ModelName {
					found = true
					break
				}
			}
			if !found {
				models = append(models, m)
			}
		}
	}
	return models
}
