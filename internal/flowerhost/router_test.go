package flowerhost

import "testing"

func testIdentity() HostIdentity {
	return HostIdentity{
		SchemaVersion: SchemaVersion,
		HostID:        "flower-host:test",
		HostKind:      HostKindGlobal,
		CarrierKind:   CarrierKindDesktop,
	}
}

func TestRouterResolveSelectsVisibleGlobalHandler(t *testing.T) {
	router := NewRouter(testIdentity())
	decision, err := router.Resolve(ResolveRequest{
		ThreadKind:    ThreadKindChat,
		ClientSurface: ClientSurfaceFlowerSurface,
	})
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if decision.Route != RouteFlowerHost {
		t.Fatalf("route=%q, want %q", decision.Route, RouteFlowerHost)
	}
	if decision.SelectedHandler == nil || decision.SelectedHandler.HandlerID != "flower-host:test" {
		t.Fatalf("selected handler = %#v, want flower-host:test", decision.SelectedHandler)
	}
	if len(decision.AvailableHandlers) != 1 {
		t.Fatalf("available handlers len=%d, want 1", len(decision.AvailableHandlers))
	}
	if !decision.HandlerSelection.RequiresUserVisibleConfirmation {
		t.Fatalf("handler selection should require visible confirmation")
	}
	if decision.DecisionScope.ContextEnvelopeID != nil || decision.DecisionScope.PrimaryTargetID != nil {
		t.Fatalf("plain new chat scope should not inherit context: %#v", decision.DecisionScope)
	}
}

func TestRouterSwitchUnavailableHandlerBlocksWithoutAutoFallback(t *testing.T) {
	router := NewRouter(testIdentity())
	decision, err := router.Switch(HandlerSwitchRequest{
		RequestedHandlerID: "env:env_a",
		DecisionScope: DecisionScope{
			ThreadKind:    ThreadKindTask,
			ClientSurface: ClientSurfaceWelcomeAskFlower,
		},
	})
	if err != nil {
		t.Fatalf("Switch() error = %v", err)
	}
	if decision.Route != RouteBlocked {
		t.Fatalf("route=%q, want blocked", decision.Route)
	}
	if decision.SelectedHandler != nil {
		t.Fatalf("selected handler=%#v, want nil when requested handler is unavailable", decision.SelectedHandler)
	}
	if len(decision.UnavailableHandlers) != 1 || decision.UnavailableHandlers[0].HandlerID != "env:env_a" {
		t.Fatalf("unavailable handlers=%#v, want env:env_a", decision.UnavailableHandlers)
	}
	if len(decision.AllowedActions) != 0 {
		t.Fatalf("allowed actions=%#v, want none", decision.AllowedActions)
	}
}
