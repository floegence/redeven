package gatewaycloud

import (
	"testing"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewaystate"
)

func TestHistoricalClosureRouteRetainsOnlyExactAssociation(t *testing.T) {
	old := GatewayConfig{CloudOrigin: "https://old.example", NamespacePublicID: "old_namespace", GatewayPublicID: "old_gateway"}
	routes, err := retireClosureRoute(old)
	if err != nil {
		t.Fatal(err)
	}
	next := GatewayConfig{SchemaVersion: 2, CloudOrigin: "https://new.example", NamespacePublicID: "new_namespace", GatewayPublicID: "new_gateway", ClosureRoutes: routes}
	path := GatewayConfigPath(t.TempDir())
	if err := gatewaystate.Write(path, next); err != nil {
		t.Fatal(err)
	}
	var restarted GatewayConfig
	if err := readGatewayConfig(path, &restarted); err != nil {
		t.Fatal(err)
	}
	request := gc.RuntimeClosureExchangeRequest{CloudOrigin: old.CloudOrigin, Binding: gc.BindingFence{NamespacePublicID: old.NamespacePublicID, GatewayPublicID: old.GatewayPublicID}}
	if !restarted.permitsClosure(request) {
		t.Fatal("old closure destination lost on restart")
	}
	for _, mutate := range []func(*gc.RuntimeClosureExchangeRequest){
		func(r *gc.RuntimeClosureExchangeRequest) { r.CloudOrigin = "https://unapproved.example" },
		func(r *gc.RuntimeClosureExchangeRequest) { r.Binding.NamespacePublicID = "another_namespace" },
		func(r *gc.RuntimeClosureExchangeRequest) { r.Binding.GatewayPublicID = "another_gateway" },
	} {
		invalid := request
		mutate(&invalid)
		if restarted.permitsClosure(invalid) {
			t.Fatal("receipt escaped approved association")
		}
	}
	old.ClosureRoutes = routes
	repeated, err := retireClosureRoute(old)
	if err != nil || len(repeated) != 1 {
		t.Fatal("repeated retirement duplicated receipt route")
	}
	old.ClosureRoutes = make([]ClosureRoute, 1024)
	if _, err := retireClosureRoute(old); err == nil {
		t.Fatal("unbounded receipt destinations")
	}
}
