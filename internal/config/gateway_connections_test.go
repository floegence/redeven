package config

import (
	bytespkg "bytes"
	"encoding/json"
	"errors"
	"github.com/floegence/redeven/internal/gatewaymembership"
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
	cloud := NewControlArtifactPool(3)
	original := &Config{EnvironmentID: "existing", LocalEnvironmentPublicID: "runtime", ControlArtifactPool: cloud}
	next, err := original.PrepareGatewayJoin(first, gp.MemberMetadata{}, "")
	if err != nil {
		t.Fatal(err)
	}
	if next.EnvironmentID != original.EnvironmentID || next.ControlArtifactPool != cloud || next.GatewayPublication != nil || next.GatewayEnvironmentChoice != "" {
		t.Fatal("pairing changed Cloud authority")
	}
	joined, err := next.PrepareGatewayJoin(second, gp.MemberMetadata{}, "")
	if err != nil {
		t.Fatal("another Gateway was rejected:", err)
	}
	if len(joined.Gateways) != 2 || len(next.Gateways) != 1 {
		t.Fatal("pairing did not preserve independent members")
	}
}

func TestGatewayMembershipCollectionMigration(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://one.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	original := &Config{Gateways: []*gatewaymembership.RuntimeConfig{member}, LocalEnvironmentPublicID: "runtime", AgentInstanceID: "agent", EnvironmentID: "existing", GatewayEnvironmentChoice: "preserve"}
	encoded, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	var legacy map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &legacy); err != nil {
		t.Fatal(err)
	}
	legacy["gateway"], _ = json.Marshal(member)
	delete(legacy, "gateways")
	delete(legacy, "gateway_membership_schema_version")
	bytes, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, bytes, 0600); err != nil {
		t.Fatal(err)
	}
	migrated, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(migrated.Gateways) != 1 || !reflect.DeepEqual(migrated.Gateways[0], member) || migrated.CloudGateway().MemberID != member.MemberID || migrated.EnvironmentID != "existing" || migrated.GatewayEnvironmentChoice != "preserve" {
		t.Fatal("migration lost member identity or Cloud intent")
	}
	saved, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var current map[string]json.RawMessage
	if err := json.Unmarshal(saved, &current); err != nil {
		t.Fatal(err)
	}
	if _, old := current["gateway"]; old || string(current["gateway_membership_schema_version"]) != "2" {
		t.Fatal("singleton was retained")
	}
	for _, scenario := range []string{"future", "mixed", "missing-version", "duplicate", "dangling-cloud"} {
		t.Run(scenario, func(t *testing.T) {
			var data map[string]json.RawMessage
			_ = json.Unmarshal(saved, &data)
			switch scenario {
			case "future":
				data["gateway_membership_schema_version"] = json.RawMessage("3")
			case "mixed":
				data["gateway"] = legacy["gateway"]
			case "missing-version":
				delete(data, "gateway_membership_schema_version")
			case "duplicate":
				data["gateways"], _ = json.Marshal([]*gatewaymembership.RuntimeConfig{member, member})
			case "dangling-cloud":
				data["gateway_cloud_member_id"] = json.RawMessage(`"missing"`)
			}
			raw, _ := json.Marshal(data)
			if err := os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := Load(path); err == nil {
				t.Fatal("incompatible schema accepted")
			}
			after, _ := os.ReadFile(path)
			if !bytespkg.Equal(raw, after) {
				t.Fatal("rejected state was modified")
			}
		})
	}
}

func TestGatewayMembershipMigrationSaveFailurePreservesOriginal(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://one.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	raw, _ := json.Marshal(map[string]any{"gateway": member, "local_environment_public_id": "runtime", "agent_instance_id": "agent"})
	writes := 0
	_, err := loadConfig("fixture", configPersistence{readFile: func(string) ([]byte, error) { return raw, nil }, writeConfig: func(string, *Config) error { writes++; return errors.New("disk full") }})
	if err == nil || writes != 1 {
		t.Fatal("migration returned before atomic persistence")
	}
}
