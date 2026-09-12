package ai

import (
	"context"
	"testing"
)

func TestTargetRegistryResolvesCurrentAlias(t *testing.T) {
	registry := NewTargetRegistry()
	if err := registry.Register(TargetDescriptor{ID: "browser-main", Kind: "browser.managed", DisplayName: "Redeven Managed Browser", Ready: true}); err != nil {
		t.Fatal(err)
	}
	target, err := registry.ResolveTarget(context.Background(), "current")
	if err != nil {
		t.Fatal(err)
	}
	if target.ID != "browser-main" || target.DisplayName != "Redeven Managed Browser" {
		t.Fatalf("unexpected current target: %#v", target)
	}
	if err := registry.SetCurrent("missing"); err == nil {
		t.Fatal("expected unknown current target to fail")
	}
}

func TestDefaultInteractionSafetyGateBlocksSecretLikeInput(t *testing.T) {
	gate := defaultInteractionSafetyGate{}
	decision, err := gate.AssessInteraction(context.Background(), TargetToolCall{
		ToolCallID: "call-1", ToolName: "computer.type",
		Arguments: []byte(`{"text":"enter password"}`),
	}, TargetDescriptor{ID: "browser-main", Ready: true})
	if err != ErrInteractionTakeoverRequired {
		t.Fatalf("error = %v, want takeover", err)
	}
	if decision.Level != "takeover" || decision.SafeToCapture || decision.SafeToSendToModel {
		t.Fatalf("unexpected safety decision: %#v", decision)
	}
}
