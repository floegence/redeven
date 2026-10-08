package gatewaymembership

import (
	"net/http"
	"testing"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestListenerOriginPolicyFollowsReachableEndpointUpdates(t *testing.T) {
	store, _ := membershipStore(t)
	request := func(origin string) *http.Request {
		req := &http.Request{Header: make(http.Header)}
		req.Header.Set("Origin", origin)
		return req
	}
	if !originAllowed(store, request("https://gateway.internal:7443")) {
		t.Fatal("initial endpoint was not accepted")
	}
	if err := store.UpdateEndpoints([]gp.GatewayEndpoint{{EndpointID: "overlay", Address: "https://overlay.internal:7443", Scope: gp.GatewayEndpointOverlay, Priority: 0}}); err != nil {
		t.Fatal(err)
	}
	if originAllowed(store, request("https://gateway.internal:7443")) {
		t.Fatal("removed endpoint remained accepted")
	}
	if !originAllowed(store, request("https://overlay.internal:7443")) {
		t.Fatal("new endpoint was not accepted without restarting the listener")
	}
}
