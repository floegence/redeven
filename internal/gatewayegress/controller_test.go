package gatewayegress

import (
	"context"
	"github.com/floegence/redeven/internal/gatewayflow"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"strings"
	"testing"
	"time"
)

func TestLocalPolicyRevokesOnlyEgressAndExpiryCannotRestoreOldPolicy(t *testing.T) {
	budget := gatewayflow.New(0, 0)
	controller, err := NewController(budget)
	if err != nil {
		t.Fatal(err)
	}
	defer controller.Close()
	connections := gatewaymembership.NewConnections(budget)
	defer connections.Close()
	records := []gatewaymembership.MemberRecord{{Member: gp.RuntimeAttachment{AttachmentID: "runtime", AttachmentVersion: 1, State: "active", EgressPermission: gp.EgressInherit}, ClientExpiresAtUnixMS: time.Now().Add(150 * time.Millisecond).UnixMilli(), ClientCertificateSHA256: strings.Repeat("a", 64), HookEgressAllowed: true, HookPolicyRevision: 1}}
	policy := gp.GatewayPolicy{Revision: 1, DefaultEgressAllowed: true, Destinations: []string{"cloud.example:443"}}
	controller.Apply(records, policy)
	connections.Apply(records, policy)
	lan, lanCancel := context.WithCancel(t.Context())
	defer lanCancel()
	reservation, err := budget.Reserve("runtime", 1, gatewayflow.LAN, lanCancel)
	if err != nil {
		t.Fatal(err)
	}
	defer reservation.Release()
	egress, egressCancel := context.WithCancel(t.Context())
	defer egressCancel()
	flow, code := controller.server.reserve(records[0].ClientCertificateSHA256, "cloud.example:443", egressCancel)
	if code != 200 {
		t.Fatalf("local policy did not admit egress: %d", code)
	}
	defer flow.reservation.Release()
	// Caller mutations must not change either active admission or its expiry snapshot.
	records[0].ClientExpiresAtUnixMS = time.Now().Add(time.Hour).UnixMilli()
	policy.Destinations[0] = "evil.example:443"
	controller.server.mu.Lock()
	_, widened := controller.server.members[strings.Repeat("a", 64)].destinations["evil.example:443"]
	controller.server.mu.Unlock()
	if widened {
		t.Fatal("caller mutation widened policy")
	}
	denied := gp.GatewayPolicy{Revision: 2, DefaultEgressAllowed: false, Destinations: []string{"cloud.example:443"}}
	controller.Apply(records, denied)
	connections.Apply(records, denied)
	select {
	case <-egress.Done():
	case <-time.After(time.Second):
		t.Fatal("egress revocation did not close flow")
	}
	select {
	case <-lan.Done():
		t.Fatal("egress revocation closed independent LAN access")
	default:
	}
	time.Sleep(200 * time.Millisecond)
	_, code = controller.server.reserve(strings.Repeat("a", 64), "cloud.example:443", func() {})
	if code != 403 {
		t.Fatal("old expiry timer restored revoked policy")
	}
}
