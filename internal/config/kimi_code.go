package config

import (
	"fmt"
	"slices"
	"strings"
)

// Kimi Code is a user-owned subscription, separate from the Moonshot API.
// An unrecognized model can be silently routed elsewhere by the service.
func validateKimiCodeProvider(p AIProvider) error {
	endpoint := strings.TrimRight(strings.TrimSpace(p.BaseURL), "/")
	if endpoint != "https://api.kimi.com/coding/v1" && endpoint != "https://api.kimi.ai/coding/v1" {
		return fmt.Errorf("Kimi Code requires an official coding endpoint")
	}
	if p.ModelSelection != nil {
		if len(p.ModelSelection.CustomModels) != 0 {
			return fmt.Errorf("Kimi Code requires reviewed subscription models")
		}
		for _, name := range p.ModelSelection.SelectedModels {
			if _, ok := AIModelCatalogEntry("kimi_code", name); !ok {
				return fmt.Errorf("unknown Kimi Code model %q", name)
			}
		}
	}
	for _, m := range p.modelsForValidation() {
		reviewed, ok := AIModelCatalogEntry("kimi_code", m.EffectiveWireModelName())
		if !ok || m.ModelName != m.EffectiveWireModelName() {
			return fmt.Errorf("unknown Kimi Code model %q", m.ModelName)
		}
		limit := 1048576
		if m.ModelName == "k3-256k" || m.ModelName == "kimi-for-coding-highspeed" {
			limit = 262144
		}
		if m.ContextWindow > limit || m.MaxOutputTokens > reviewed.MaxOutputTokens {
			return fmt.Errorf("Kimi Code model capacity exceeds the reviewed limit")
		}
		if !m.ReasoningCapability.IsZero() && (m.ReasoningCapability.DisableSupported || m.ReasoningCapability.Kind != reviewed.ReasoningCapability.Kind || m.ReasoningCapability.WireShape != reviewed.ReasoningCapability.WireShape || !slices.Equal(m.ReasoningCapability.SupportedLevels, reviewed.ReasoningCapability.SupportedLevels) || m.ReasoningCapability.DefaultLevel != reviewed.ReasoningCapability.DefaultLevel || m.ReasoningCapability.SupportsBudget()) {
			return fmt.Errorf("Kimi Code requires the reviewed reasoning capability")
		}
	}
	return nil
}
