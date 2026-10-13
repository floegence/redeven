package config

import (
	"testing"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

func TestPendingGatewayJoinCanStartWithoutCloudAuthority(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	invitation, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := (&Config{}).PrepareGatewayJoin(invitation, gp.MemberMetadata{}, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := cfg.ValidateGatewayManagement(); err != nil {
		t.Fatal(err)
	}
	if cfg.ValidateRemoteStrict() == nil {
		t.Fatal("pending membership authorized Cloud control")
	}
	cfg.GatewayMember("").GatewayID = "different_gateway"
	if cfg.ValidateGatewayManagement() == nil {
		t.Fatal("startup accepted an inconsistent member identity")
	}
}
