package config

import (
	bytespkg "bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

func TestGatewayPublicationSelectionMigration(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://one.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	route, err := gatewaycloud.PrepareRuntime(member, gp.MemberCloudContext{ProtocolVersion: gp.Version, Allowed: true, GatewayID: member.GatewayID, MemberID: member.MemberID, MemberVersion: member.MemberVersion, CloudOrigin: "https://cloud.example", RegionOrigin: "https://region.example", NamespacePublicID: "namespace", GatewayPublicID: "gateway"})
	if err != nil {
		t.Fatal(err)
	}
	for _, state := range []string{"implicit", "pending", "approved", "revoked", "current-explicit"} {
		t.Run(state, func(t *testing.T) {
			original := configWithDirectArtifact(json.RawMessage(directArtifactFixture), true)
			original.CloudID = "redeven"
			original.LocalEnvironmentPublicID = "runtime"
			original.Gateways = []*gatewaymembership.RuntimeConfig{member}
			original.GatewayCloudMemberID, original.GatewayEnvironmentChoice = member.MemberID, "preserve"
			if state != "implicit" && state != "current-explicit" {
				original.GatewayPublication = route.Clone()
				if state != "pending" {
					original.GatewayPublication.Binding = &gc.Binding{MemberID: member.MemberID, MemberVersion: member.MemberVersion, PublicID: "binding", EnvPublicID: original.EnvironmentID, NamespacePublicID: "namespace", GatewayPublicID: "gateway", RuntimePublicID: "runtime", Region: "sg", Generation: 1, State: "active"}
					original.GatewayPublication.Revoked = state == "revoked"
				}
			}
			encoded, _ := json.Marshal(original)
			var source map[string]json.RawMessage
			_ = json.Unmarshal(encoded, &source)
			if state != "current-explicit" {
				source["gateway_membership_schema_version"] = json.RawMessage("2")
			}
			encoded, _ = json.Marshal(source)
			configPath := filepath.Join(t.TempDir(), "config.json")
			if err := os.WriteFile(configPath, encoded, 0600); err != nil {
				t.Fatal(err)
			}
			upgraded, err := Load(configPath)
			if err != nil {
				t.Fatal(err)
			}
			want := *original
			if state == "implicit" {
				want.GatewayCloudMemberID, want.GatewayEnvironmentChoice = "", ""
				if err := upgraded.ValidateRemoteBinding(); err != nil {
					t.Fatal("saved direct binding was not restored:", err)
				}
			}
			gotJSON, _ := json.Marshal(upgraded)
			wantJSON, _ := json.Marshal(want)
			if !jsonEqual(gotJSON, wantJSON) {
				t.Fatal("upgrade changed member credentials, identity, policy or Cloud state")
			}
			first, _ := os.ReadFile(configPath)
			if _, err := Load(configPath); err != nil {
				t.Fatal(err)
			}
			second, _ := os.ReadFile(configPath)
			if !bytespkg.Equal(first, second) {
				t.Fatal("upgrade is not restart safe")
			}
			if state == "implicit" {
				if err := os.WriteFile(configPath, encoded, 0600); err != nil {
					t.Fatal(err)
				}
				writes := 0
				_, err := loadConfig(configPath, configPersistence{readFile: os.ReadFile, writeConfig: func(string, *Config) error { writes++; return errors.New("disk full") }})
				if err == nil || writes != 1 {
					t.Fatal("failed persistence returned a usable migrated config")
				}
				unchanged, _ := os.ReadFile(configPath)
				if !bytespkg.Equal(encoded, unchanged) {
					t.Fatal("failed migration changed the previous config")
				}
			}
		})
	}
}

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
	if len(migrated.Gateways) != 1 || !reflect.DeepEqual(migrated.Gateways[0], member) || migrated.CloudGateway() != nil || migrated.EnvironmentID != "existing" || migrated.GatewayEnvironmentChoice != "" {
		t.Fatal("migration lost member identity or retained implicit Cloud publication")
	}
	saved, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var current map[string]json.RawMessage
	if err := json.Unmarshal(saved, &current); err != nil {
		t.Fatal(err)
	}
	if _, old := current["gateway"]; old || string(current["gateway_membership_schema_version"]) != "3" {
		t.Fatal("singleton was retained")
	}
	for _, scenario := range []string{"future", "mixed", "missing-version", "duplicate", "dangling-cloud", "v2-dangling-cloud", "v2-invalid-choice", "v2-missing-publication"} {
		t.Run(scenario, func(t *testing.T) {
			var data map[string]json.RawMessage
			_ = json.Unmarshal(saved, &data)
			switch scenario {
			case "future":
				data["gateway_membership_schema_version"] = json.RawMessage("4")
			case "mixed":
				data["gateway"] = legacy["gateway"]
			case "missing-version":
				delete(data, "gateway_membership_schema_version")
			case "duplicate":
				data["gateways"], _ = json.Marshal([]*gatewaymembership.RuntimeConfig{member, member})
			case "dangling-cloud":
				data["gateway_cloud_member_id"] = json.RawMessage(`"missing"`)
			case "v2-dangling-cloud":
				data["gateway_membership_schema_version"] = json.RawMessage("2")
				data["gateway_cloud_member_id"] = json.RawMessage(`"missing"`)
			case "v2-invalid-choice":
				data["gateway_membership_schema_version"] = json.RawMessage("2")
				data["gateway_environment_choice"] = json.RawMessage(`"invalid"`)
			case "v2-missing-publication":
				data["gateway_membership_schema_version"] = json.RawMessage("2")
				pool := NewControlArtifactPool(1)
				pool.LogicalBindingID = "gateway-cloud-v2:binding"
				data["control_artifact_pool"], _ = json.Marshal(pool)
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

func TestGatewayMembershipUpgradePreservesLegacyEndpoint(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://one.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	for _, version := range []int{1, 2} {
		for _, protocol := range []string{"redeven-gateway-v4", gp.Version} {
			t.Run(fmt.Sprintf("schema-%d/%s", version, protocol), func(t *testing.T) {
				legacy := *member
				legacy.ProtocolVersion = protocol
				legacy.GatewayURL = member.GatewayEndpoints[0].Address
				legacy.GatewayEndpoints = nil
				source := map[string]any{
					"local_environment_public_id": "runtime", "agent_instance_id": "agent",
					"gateway_environment_choice": "preserve",
				}
				if version == 1 {
					source["gateway"] = &legacy
				} else {
					source["gateway_membership_schema_version"] = version
					source["gateways"] = []*gatewaymembership.RuntimeConfig{&legacy}
					source["gateway_cloud_member_id"] = member.MemberID
				}
				raw, err := json.Marshal(source)
				if err != nil {
					t.Fatal(err)
				}
				configPath := filepath.Join(t.TempDir(), "config.json")
				if err := os.WriteFile(configPath, raw, 0600); err != nil {
					t.Fatal(err)
				}
				upgraded, err := Load(configPath)
				if err != nil {
					t.Fatal(err)
				}
				want := *member
				want.GatewayEndpoints = []gp.GatewayEndpoint{{EndpointID: "endpoint_legacy", Address: legacy.GatewayURL, Scope: gp.GatewayEndpointLAN}}
				if len(upgraded.Gateways) != 1 || !reflect.DeepEqual(upgraded.Gateways[0], &want) || upgraded.CloudGateway() != nil || upgraded.GatewayEnvironmentChoice != "" {
					t.Fatal("upgrade changed member credentials or lost the legacy connection endpoint")
				}
				first, _ := os.ReadFile(configPath)
				if _, err := Load(configPath); err != nil {
					t.Fatal(err)
				}
				second, _ := os.ReadFile(configPath)
				if !bytespkg.Equal(first, second) {
					t.Fatal("legacy endpoint upgrade is not restart safe")
				}
			})
		}
	}
}
