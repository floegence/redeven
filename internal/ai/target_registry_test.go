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

func TestTargetRegistryResolvesLogicalKindsWithoutChangingCurrent(t *testing.T) {
	registry := NewTargetRegistry()
	for _, target := range []TargetDescriptor{
		{ID: "browser-main", Kind: "browser.managed"},
		{ID: "desktop-main", Kind: "desktop.screen"},
	} {
		if err := registry.Register(target); err != nil {
			t.Fatal(err)
		}
	}
	desktop, err := registry.ResolveTarget(t.Context(), "desktop.screen")
	if err != nil || desktop.ID != "desktop-main" {
		t.Fatalf("desktop alias: %+v, %v", desktop, err)
	}
	current, err := registry.ResolveTarget(t.Context(), "current")
	if err != nil || current.ID != "browser-main" {
		t.Fatalf("another call changed the default: %+v, %v", current, err)
	}
	if err := registry.Register(TargetDescriptor{ID: "desktop-other", Kind: "desktop.screen"}); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.ResolveTarget(t.Context(), "desktop.screen"); err == nil {
		t.Fatal("ambiguous kind was resolved arbitrarily")
	}
	if _, err := registry.ResolveTarget(t.Context(), "browser.connected"); err == nil {
		t.Fatal("unregistered kind was resolved")
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
