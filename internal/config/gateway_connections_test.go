package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

func TestGatewayPairingPreservesCloudAndAcceptsAnotherGateway(t *testing.T) {
	one, _ := gatewayfixture.New(t, "https://one.internal:7443", "127.0.0.1:7443")
	two, _ := gatewayfixture.NewWithID(t, "gateway_two", "https://two.internal:7443", "127.0.0.1:7443")
	first, _ := one.Invite("admin")
	second, _ := two.Invite("admin")
	original := &Config{EnvironmentID: "environment", LocalEnvironmentPublicID: "runtime", CloudAssociation: testCloudAssociation(), CloudRoute: &CloudRoute{Kind: CloudRouteDirect, Revision: 3}, ControlArtifactPool: NewControlArtifactPool(7)}
	next, err := original.PrepareGatewayJoin(first, gp.MemberMetadata{}, "")
	if err != nil {
		t.Fatal(err)
	}
	joined, err := next.PrepareGatewayJoin(second, gp.MemberMetadata{}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(joined.Gateways) != 2 || len(next.Gateways) != 1 || len(original.Gateways) != 0 {
		t.Fatal("members do not have independent ownership")
	}
	if joined.EnvironmentID != original.EnvironmentID || joined.ControlArtifactPool != original.ControlArtifactPool || !reflect.DeepEqual(joined.CloudAssociation, original.CloudAssociation) || *joined.CloudRoute != *original.CloudRoute {
		t.Fatal("pairing changed Cloud identity, authorization or route")
	}
}

func TestRetiredGatewayConfigurationIsRejectedWithoutWriting(t *testing.T) {
	for _, raw := range []string{
		`{"gateway":{},"local_environment_public_id":"runtime"}`,
		`{"runtime_config_version":1,"gateway_membership_schema_version":2,"gateways":[]}`,
		`{"runtime_config_version":1,"gateway_cloud_member_id":"member"}`,
		`{"runtime_config_version":1,"gateway_environment_choice":"preserve"}`,
		`{"runtime_config_version":1,"gateway_migration_evidence":{}}`,
	} {
		path := filepath.Join(t.TempDir(), "config.json")
		if err := os.WriteFile(path, []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := Load(path); err == nil {
			t.Fatal("retired configuration was accepted")
		}
		saved, err := os.ReadFile(path)
		if err != nil || string(saved) != raw {
			t.Fatal("retired state was rewritten")
		}
	}
}

func TestCurrentGatewayConfigurationRoundTripPreservesCredentials(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://one.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	original := &Config{LocalEnvironmentPublicID: "runtime", AgentInstanceID: "agent"}
	original.SetGatewayMember(member.GatewayID, member)
	encoded, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	var restored Config
	if err := json.Unmarshal(encoded, &restored); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(restored.Gateways, original.Gateways) || restored.CloudAssociation != nil || restored.CloudRoute != nil {
		t.Fatal("membership round trip changed credentials or selected Cloud access")
	}
}
