package ai

import (
	"testing"

	flconfig "github.com/floegence/floret/v3/config"
	flprovider "github.com/floegence/floret/v3/provider"
	"github.com/floegence/redeven/internal/config"
)

func TestFloretModelGatewayCapabilities_MapsResolvedCapability(t *testing.T) {
	disabled := true
	got := floretModelGatewayCapabilities(config.AIReasoningCapability{
		Kind:                    "dynamic",
		SupportedLevels:         []string{"low", "high"},
		DefaultLevel:            "high",
		DisableSupported:        true,
		DefaultEnabled:          &disabled,
		MinBudgetTokens:         128,
		MaxBudgetTokens:         4096,
		DynamicProviderMetadata: true,
	})
	if got.Reasoning != flprovider.ReasoningSupported {
		t.Fatalf("Reasoning=%q, want supported", got.Reasoning)
	}
	reasoning := got.ReasoningCapability
	if reasoning.Kind != flconfig.ReasoningKindDynamic || reasoning.DefaultLevel != flconfig.ReasoningLevelHigh || !reasoning.DynamicModelValue {
		t.Fatalf("reasoning=%+v, want dynamic/high/provider metadata", reasoning)
	}
	if reasoning.Budget.MinTokens != 128 || reasoning.Budget.MaxTokens != 4096 || !reasoning.DisableSupported || reasoning.DefaultEnabled == nil || *reasoning.DefaultEnabled != disabled {
		t.Fatalf("reasoning=%+v, want mapped controls", reasoning)
	}
}

func TestFloretModelGatewayCapabilities_ZeroIsExplicitNone(t *testing.T) {
	got := floretModelGatewayCapabilities(config.AIReasoningCapability{})
	if got.Reasoning != flprovider.ReasoningUnsupported || !got.ReasoningCapability.IsZero() {
		t.Fatalf("capabilities=%+v, want explicit unsupported reasoning", got)
	}
}

func TestFloretModelGatewayCapabilities_PreservesInvalidKindForHostValidation(t *testing.T) {
	got := floretModelGatewayCapabilities(config.AIReasoningCapability{Kind: "future_kind"})
	if got.Reasoning != flprovider.ReasoningSupported {
		t.Fatalf("Reasoning=%q, want supported", got.Reasoning)
	}
	if err := got.ReasoningCapability.Validate(); err == nil {
		t.Fatalf("ReasoningCapability=%+v unexpectedly validated", got.ReasoningCapability)
	}
}
