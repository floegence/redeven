package config

import (
	"testing"

	"github.com/floegence/redeven/internal/gatewaymembership"
	rc "github.com/floegence/redeven/internal/runtimecloud/protocol"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

func TestGatewayManagementCanRestartWithoutCloudAuthorization(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	cfg := &Config{Gateways: []*gatewaymembership.RuntimeConfig{member}, LocalEnvironmentPublicID: "runtime", AgentInstanceID: "instance"}
	if err := cfg.ValidateGatewayManagement(); err != nil {
		t.Fatal(err)
	}
	if cfg.ValidateRemoteStrict() == nil {
		t.Fatal("local membership granted Cloud access")
	}
	cfg.CloudAssociation = testCloudAssociation()
	cfg.CloudAssociation.ApprovalState = rc.ApprovalRevoked
	cfg.CloudRoute = &CloudRoute{Kind: CloudRouteGateway, MemberID: member.MemberID, Revision: 1}
	if err := cfg.ValidateRemoteStrict(); err != nil {
		t.Fatal("revoked intent must be able to run the sole recovery controller", err)
	}
	cfg.CloudAssociation.Enabled = false
	if cfg.ValidateRemoteStrict() == nil {
		t.Fatal("disabled intent started recovery")
	}
	if err := cfg.ValidateGatewayManagement(); err != nil {
		t.Fatal("Cloud intent disabled independent local membership", err)
	}
	if (*Config)(nil).ValidateRemoteStrict() == nil {
		t.Fatal("nil configuration accepted")
	}
}
