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
	SelectedModels []string `json:"selected_models"`
	// DisabledModels is decoded only to upgrade the previous exclusion policy.
	DisabledModels []string          `json:"disabled_models,omitempty"`
	CustomModels   []AIProviderModel `json:"custom_models,omitempty"`
	ModelOverrides []AIProviderModel `json:"model_overrides,omitempty"`
}

func cloneAIModels(models []AIProviderModel) []AIProviderModel {
	out := slices.Clone(models)
	for i := range out {
		if out[i].SupportsTools != nil {
			value := *out[i].SupportsTools
			out[i].SupportsTools = &value
		}
		if out[i].ReasoningCapability.DefaultEnabled != nil {
			value := *out[i].ReasoningCapability.DefaultEnabled
			out[i].ReasoningCapability.DefaultEnabled = &value
		}
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
		models := cloneAIModels(p.Models)
		if p.catalogResolved {
			resolved := []AIProviderModel{}
			for _, model := range models {
				for _, listed := range p.discoveredModels {
					if listed.EffectiveWireModelName() == model.EffectiveWireModelName() && listed.Status != "unsupported" {
						merged := applyAIModelOverride(listed, model)
						merged.ModelName = model.ModelName
						if merged.Status != "needs_configuration" && (merged.SupportsTools == nil || *merged.SupportsTools) {
							resolved = append(resolved, merged)
						}
						break
					}
				}
			}
			return resolved
		}
		return slices.DeleteFunc(models, func(m AIProviderModel) bool {
			return m.Status == "needs_configuration" || m.Status == "unsupported" || m.SupportsTools != nil && !*m.SupportsTools
		})
	}
	models := AIProviderCatalog(p.Type)
	if p.catalogResolved || p.Type == "ollama" || p.Type == "openrouter" || p.EffectiveAuthMethod() == AIAuthChatGPT {
		models = cloneAIModels(p.discoveredModels)
		if !p.catalogResolved && p.EffectiveAuthMethod() != AIAuthChatGPT {
			// Explicit saved metadata remains usable before the first successful sync.
			for _, m := range p.ModelSelection.ModelOverrides {
				if m.ContextWindow > 0 {
					models = append(models, m)
				}
			}
		}
	}
	// A selected local alias may have a different name from its provider wire ID.
	for _, override := range p.ModelSelection.ModelOverrides {
		if override.WireModelName == "" || slices.ContainsFunc(models, func(m AIProviderModel) bool { return m.ModelName == override.ModelName }) {
			continue
		}
		for _, discovered := range models {
			if discovered.EffectiveWireModelName() == override.WireModelName {
				discovered.ModelName = override.ModelName
				models = append(models, discovered)
				break
			}
		}
	}
	for i := range models {
		for _, override := range p.ModelSelection.ModelOverrides {
			if override.ModelName == models[i].ModelName {
				if (p.catalogResolved || p.EffectiveAuthMethod() == AIAuthChatGPT) && override.WireModelName != "" && override.WireModelName != models[i].EffectiveWireModelName() {
					for _, target := range cloneAIModels(p.discoveredModels) {
						if target.EffectiveWireModelName() == override.WireModelName {
							target.ModelName = models[i].ModelName
							models[i] = target
							break
						}
					}
				}
				models[i] = applyAIModelOverride(models[i], override)
				break
			}
		}
	}
	for _, custom := range cloneAIModels(p.ModelSelection.CustomModels) {
		custom = applyAIModelOverride(custom, custom)
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
	if p.catalogResolved || p.EffectiveAuthMethod() == AIAuthChatGPT {
		models = slices.DeleteFunc(models, func(model AIProviderModel) bool {
			return !slices.ContainsFunc(p.discoveredModels, func(available AIProviderModel) bool {
				return available.EffectiveWireModelName() == model.EffectiveWireModelName()
			})
		})
	}
	models = slices.DeleteFunc(models, func(m AIProviderModel) bool {
		return m.Status == "needs_configuration" || m.Status == "unsupported" || m.SupportsTools != nil && !*m.SupportsTools
	})
	if p.ModelSelection.SelectedModels == nil {
		// Legacy dynamic preferences are unavailable until their selection is frozen.
		if p.Type == "ollama" || p.Type == "openrouter" || p.EffectiveAuthMethod() == AIAuthChatGPT {
			return nil
		}
		return slices.DeleteFunc(models, func(m AIProviderModel) bool { return slices.Contains(p.ModelSelection.DisabledModels, m.ModelName) })
	}
	return slices.DeleteFunc(models, func(m AIProviderModel) bool { return !slices.Contains(p.ModelSelection.SelectedModels, m.ModelName) })
}

// CatalogModels exposes discovered identities without enabling them. It is a
// detached settings projection, never a persisted preference list.
func (p AIProvider) CatalogModels() []AIProviderModel {
	if p.catalogResolved {
		return cloneAIModels(p.discoveredModels)
	}
	if p.EffectiveAuthMethod() == AIAuthChatGPT {
		return []AIProviderModel{}
	}
	if p.ModelSelection == nil {
		if p.Models == nil {
			return []AIProviderModel{}
		}
		return cloneAIModels(p.Models)
	}
	return AIProviderCatalog(p.Type)
}

// WithDiscoveredModels binds the current remote inventory only to this value.
func (p AIProvider) WithDiscoveredModels(models []AIProviderModel) AIProvider {
	p.discoveredModels = cloneAIModels(models)
	for i, discovered := range p.discoveredModels {
		reviewed, known := AIModelCatalogEntry(p.Type, discovered.EffectiveWireModelName())
		if !known {
			if AIProviderUsesCatalog(p.Type) && discovered.Status != "unsupported" && (discovered.SupportsTools == nil || *discovered.SupportsTools) {
				p.discoveredModels[i].Status = "needs_configuration"
				p.discoveredModels[i].SupportsTools = nil
			}
			continue
		}
		// Inventories own availability. The shipped catalog owns reviewed
		// defaults, so an older snapshot cannot pin missing or stale capabilities.
		reviewed.ModelName = discovered.ModelName
		if discovered.DisplayName != "" {
			reviewed.DisplayName = discovered.DisplayName
		}
		if p.Type == "google" {
			// Google's native inventory publishes actual serving limits.
			if discovered.ContextWindow > 0 {
				reviewed.ContextWindow = discovered.ContextWindow
			}
			if discovered.MaxOutputTokens > 0 {
				reviewed.MaxOutputTokens = discovered.MaxOutputTokens
			}
		}
		if discovered.Status == "unsupported" || discovered.SupportsTools != nil && !*discovered.SupportsTools {
			reviewed.Status, reviewed.SupportsTools = "unsupported", discovered.SupportsTools
		}
		p.discoveredModels[i] = reviewed
	}
	p.catalogResolved = true
	return p
}

// ModelMetadata resolves settings information even for an unavailable model.
// It never admits the model to EffectiveModels or substitutes a wire identity.
func (p AIProvider) ModelMetadata(name string) AIProviderModel {
	override := AIProviderModel{ModelName: name}
	for _, m := range p.Models {
		if m.ModelName == name {
			override = m
		}
	}
	if p.ModelSelection != nil {
		for _, models := range [][]AIProviderModel{p.ModelSelection.ModelOverrides, p.ModelSelection.CustomModels} {
			for _, m := range models {
				if m.ModelName == name {
					override = m
				}
			}
		}
	}
	wire := override.EffectiveWireModelName()
	metadata, _ := AIModelCatalogEntry(p.Type, wire)
	for _, m := range p.CatalogModels() {
		if m.EffectiveWireModelName() == wire {
			metadata = m
			break
		}
	}
	metadata.ModelName = name
	return applyAIModelOverride(metadata, override)
}

func applyAIModelOverride(model, override AIProviderModel) AIProviderModel {
	if override.WireModelName != "" {
		model.WireModelName = override.WireModelName
	}
	if override.SupportsTools != nil && (model.SupportsTools == nil || *model.SupportsTools) {
		model.SupportsTools = override.SupportsTools
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
	if model.Status == "needs_configuration" && model.ContextWindow > 0 && model.MaxOutputTokens > 0 && model.SupportsTools != nil && *model.SupportsTools {
		model.Status = ""
	}
	return cloneAIModels([]AIProviderModel{model})[0]
}

func (p AIProvider) validateModelSelection() error {
	if p.ModelSelection == nil {
		return nil
	}
	if !AIProviderUsesCatalog(p.Type) && p.Type != "ollama" && p.Type != "openrouter" {
		return fmt.Errorf("model_selection is unsupported for %s", p.Type)
	}
	if len(p.Models) > 0 {
		return errors.New("models and model_selection are mutually exclusive")
	}
	if p.ModelSelection.SelectedModels != nil && len(p.ModelSelection.DisabledModels) > 0 {
		return errors.New("selected_models and disabled_models are mutually exclusive")
	}
	seen := map[string]bool{}
	for _, name := range append(slices.Clone(p.ModelSelection.SelectedModels), p.ModelSelection.DisabledModels...) {
		if strings.TrimSpace(name) == "" || strings.Contains(name, "/") || seen[name] {
			return errors.New("invalid or duplicate selected model")
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
		return errors.New("ollama models must come from the installed inventory")
	}
	for _, m := range p.ModelSelection.CustomModels {
		if m.ContextWindow <= 0 {
			return fmt.Errorf("custom model %q requires context_window", m.ModelName)
		}
		if m.SupportsTools != nil && m.MaxOutputTokens <= 0 {
			return fmt.Errorf("custom model %q requires max_output_tokens", m.ModelName)
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
