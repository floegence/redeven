package config

import (
	"github.com/floegence/redeven/internal/gatewaymembership"
	"testing"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

func TestGatewayPublicationRequiresExplicitExistingEnvironmentChoice(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	existing := &Config{Gateways: []*gatewaymembership.RuntimeConfig{member}, EnvironmentID: "existing_environment", LocalEnvironmentPublicID: "runtime", ControlArtifactPool: NewControlArtifactPool(3)}
	if _, err := existing.PrepareGatewayPublication(member.GatewayID, ""); err == nil {
		t.Fatal("Cloud ownership changed without consent")
	}
	preserved, err := existing.PrepareGatewayPublication(member.GatewayID, "preserve")
	if err != nil {
		t.Fatal(err)
	}
	if preserved.ControlArtifactPool != existing.ControlArtifactPool || preserved.GatewayEnvironmentChoice != "preserve" || preserved.CloudGateway().MemberID != member.MemberID {
		t.Fatal("explicit conversion lost original proof")
	}
	created, err := existing.PrepareGatewayPublication(member.GatewayID, "new")
	if err != nil {
		t.Fatal(err)
	}
	if created.ControlArtifactPool != nil || created.EnvironmentID != existing.EnvironmentID {
		t.Fatal("new publication retained old authority or lost its record")
	}
	if existing.CloudGateway() != nil {
		t.Fatal("preparation mutated source")
	}
}

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

func TestGatewayPublicationWithoutOriginalProofCannotPreserveRetiredEnvironment(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	existing := &Config{Gateways: []*gatewaymembership.RuntimeConfig{member}, EnvironmentID: "legacy_environment", LocalEnvironmentPublicID: "runtime", GatewayRejoinRequired: true}
	if _, err := existing.PrepareGatewayPublication(member.GatewayID, "preserve"); err == nil {
		t.Fatal("public ID was treated as ownership proof")
	}
	if _, err := existing.PrepareGatewayPublication(member.GatewayID, "new"); err != nil {
		t.Fatal(err)
	}
	existing.EnvironmentID, existing.GatewayRejoinRequired = "", false
	if _, err := existing.PrepareGatewayPublication(member.GatewayID, "preserve"); err == nil {
		t.Fatal("migration allowed without original environment")
	}
	if _, err := existing.PrepareGatewayPublication(member.GatewayID, ""); err != nil {
		t.Fatal(err)
	}
}
