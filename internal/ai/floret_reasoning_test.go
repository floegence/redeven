package ai

import (
	"testing"

	flconfig "github.com/floegence/floret/config"
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
	if got.Reasoning == nil {
		t.Fatal("Reasoning=nil")
	}
	reasoning := got.Reasoning
	if reasoning.Kind != flconfig.ReasoningKindDynamic || reasoning.DefaultLevel != flconfig.ReasoningLevelHigh || !reasoning.DynamicModelValue {
		t.Fatalf("reasoning=%+v, want dynamic/high/provider metadata", *reasoning)
	}
	if reasoning.Budget.MinTokens != 128 || reasoning.Budget.MaxTokens != 4096 || !reasoning.DisableSupported || reasoning.DefaultEnabled == nil || *reasoning.DefaultEnabled != disabled {
		t.Fatalf("reasoning=%+v, want mapped controls", *reasoning)
	}
}

func TestFloretModelGatewayCapabilities_ZeroIsExplicitNone(t *testing.T) {
	got := floretModelGatewayCapabilities(config.AIReasoningCapability{})
	if got.Reasoning == nil || got.Reasoning.Kind != flconfig.ReasoningKindNone {
		t.Fatalf("Reasoning=%+v, want explicit none", got.Reasoning)
	}
}

func TestFloretModelGatewayCapabilities_PreservesInvalidKindForHostValidation(t *testing.T) {
	got := floretModelGatewayCapabilities(config.AIReasoningCapability{Kind: "future_kind"})
	if got.Reasoning == nil {
		t.Fatal("Reasoning=nil")
	}
	if err := got.Reasoning.Validate(); err == nil {
		t.Fatalf("Reasoning=%+v unexpectedly validated", *got.Reasoning)
	}
}
