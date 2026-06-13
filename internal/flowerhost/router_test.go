package flowerhost

import (
	"encoding/json"
	"testing"
)

func testIdentity() HostIdentity {
	return HostIdentity{
		SchemaVersion: SchemaVersion,
		HostID:        "flower-host:test",
		HostKind:      HostKindGlobal,
		CarrierKind:   CarrierKindDesktop,
		UserPublicID:  "user_flower_host_test",
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
	raw, err := json.Marshal(decision)
	if err != nil {
		t.Fatalf("Marshal decision: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("Unmarshal decision: %v", err)
	}
	selected, ok := payload["selected_handler"].(map[string]any)
	if !ok {
		t.Fatalf("selected_handler=%#v, want object", payload["selected_handler"])
	}
	assertJSONEmptyArray(t, selected, "selected_handler.allowed_target_ids", "allowed_target_ids")
	available, ok := payload["available_handlers"].([]any)
	if !ok || len(available) != 1 {
		t.Fatalf("available_handlers=%#v, want one handler", payload["available_handlers"])
	}
	availableHandler, ok := available[0].(map[string]any)
	if !ok {
		t.Fatalf("available_handlers[0]=%#v, want object", available[0])
	}
	assertJSONEmptyArray(t, availableHandler, "available_handlers[0].allowed_target_ids", "allowed_target_ids")
}

func assertJSONEmptyArray(t *testing.T, record map[string]any, label string, field string) {
	t.Helper()
	value, ok := record[field]
	if !ok {
		t.Fatalf("%s missing, want explicit empty array", label)
	}
	values, ok := value.([]any)
	if !ok || values == nil || len(values) != 0 {
		t.Fatalf("%s=%#v, want explicit empty array", label, value)
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
