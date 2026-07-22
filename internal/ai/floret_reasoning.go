package ai

import (
	flconfig "github.com/floegence/floret/config"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/config"
)

// floretModelGatewayCapabilities adapts Redeven's resolved model contract to
// Floret's host contract. The host must always provide an explicit capability:
// Kind=none is authoritative for models that do not support reasoning.
func floretModelGatewayCapabilities(capability config.AIReasoningCapability) flruntime.ModelGatewayCapabilities {
	capability = capability.Normalize()
	if capability.IsZero() {
		none := flconfig.ReasoningCapability{Kind: flconfig.ReasoningKindNone}
		return flruntime.ModelGatewayCapabilities{Reasoning: &none}
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
	return flruntime.ModelGatewayCapabilities{Reasoning: &reasoning}
}
