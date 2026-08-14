package ai

import (
	flconfig "github.com/floegence/floret/v4/config"
	flprovider "github.com/floegence/floret/v4/provider"
	"github.com/floegence/redeven/internal/config"
)

// floretModelGatewayCapabilities adapts Redeven's resolved model contract to
// Floret's host contract. The host must always provide an explicit capability:
// Kind=none is authoritative for models that do not support reasoning.
func floretModelGatewayCapabilities(capability config.AIReasoningCapability) flprovider.Capabilities {
	capability = capability.Normalize()
	if capability.IsZero() {
		return flprovider.Capabilities{
			Reasoning:         flprovider.ReasoningUnsupported,
			AttachmentPayload: flprovider.AttachmentExpanded,
		}
	}
	kind := capability.Kind
	if kind == "dynamic" {
		kind = flconfig.ReasoningKindDynamic
	}
	levels := make([]flconfig.ReasoningLevel, 0, len(capability.SupportedLevels))
	for _, level := range capability.SupportedLevels {
		levels = append(levels, flconfig.ReasoningLevel(level))
	}
	reasoning := flconfig.ReasoningCapability{
		Kind:              kind,
		SupportedLevels:   levels,
		DefaultLevel:      flconfig.ReasoningLevel(capability.DefaultLevel),
		DisableSupported:  capability.DisableSupported,
		DefaultEnabled:    capability.DefaultEnabled,
		Budget:            flconfig.ReasoningBudget{MinTokens: int64(capability.MinBudgetTokens), MaxTokens: int64(capability.MaxBudgetTokens)},
		DynamicModelValue: capability.DynamicProviderMetadata,
	}
	return flprovider.Capabilities{
		Reasoning:           flprovider.ReasoningSupported,
		ReasoningCapability: reasoning,
		AttachmentPayload:   flprovider.AttachmentExpanded,
	}
}
