package config

import (
	"testing"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

func TestGatewayJoinRequiresExplicitExistingEnvironmentChoice(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	invitation, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	existing := &Config{EnvironmentID: "existing_environment", LocalEnvironmentPublicID: "runtime", ControlArtifactPool: NewControlArtifactPool(3)}
	if _, err := existing.PrepareGatewayJoin(invitation, gp.MemberMetadata{}, ""); err == nil {
		t.Fatal("existing environment silently changed ownership")
	}
	preserved, err := existing.PrepareGatewayJoin(invitation, gp.MemberMetadata{}, "preserve")
	if err != nil {
		t.Fatal(err)
	}
	if preserved.EnvironmentID != existing.EnvironmentID || preserved.ControlArtifactPool != existing.ControlArtifactPool || preserved.GatewayEnvironmentChoice != "preserve" {
		t.Fatal("original proof was not retained for explicit conversion")
	}
	if _, err := preserved.PrepareGatewayJoin(invitation, gp.MemberMetadata{}, "new"); err == nil {
		t.Fatal("join replay changed the approved ownership decision")
	}
	created, err := existing.PrepareGatewayJoin(invitation, gp.MemberMetadata{}, "new")
	if err != nil {
		t.Fatal(err)
	}
	if created.ControlArtifactPool != nil || created.Direct != nil || created.EnvironmentID != existing.EnvironmentID {
		t.Fatal("new environment selection restored old control authority or lost its record")
	}
	if existing.Gateway != nil || existing.ControlArtifactPool == nil {
		t.Fatal("preparation mutated the source state")
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
	cfg.Gateway.GatewayID = "different_gateway"
	if cfg.ValidateGatewayManagement() == nil {
		t.Fatal("startup accepted an inconsistent member identity")
	}
}

func TestGatewayJoinWithoutOriginalProofCannotPreserveRetiredEnvironment(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	invitation, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	existing := &Config{EnvironmentID: "legacy_environment", LocalEnvironmentPublicID: "runtime", GatewayRejoinRequired: true}
	if _, err := existing.PrepareGatewayJoin(invitation, gp.MemberMetadata{}, "preserve"); err == nil {
		t.Fatal("a public environment ID was treated as ownership proof")
	}
	if _, err := existing.PrepareGatewayJoin(invitation, gp.MemberMetadata{}, "new"); err != nil {
		t.Fatal(err)
	}
	if _, err := (&Config{}).PrepareGatewayJoin(invitation, gp.MemberMetadata{}, "preserve"); err == nil {
		t.Fatal("migration allowed without an original environment")
	}
	if _, err := (&Config{}).PrepareGatewayJoin(invitation, gp.MemberMetadata{}, ""); err != nil {
		t.Fatal(err)
	}
}
