package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCloudConfigMigrationPreservesIdentityAndCredentialState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := configWithDirectArtifact(json.RawMessage(directArtifactFixture), true)
	cfg.CloudID = "cloud-existing"
	cfg.ControlArtifactPool = NewControlArtifactPool(7)
	cfg.ControlArtifactPool.LogicalBindingID = "binding-existing"
	raw, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	legacy := strings.NewReplacer(
		`"cloud_origin"`, `"provider_origin"`, `"cloud_id"`, `"controlplane_provider_id"`,
		`"access_point_origin"`, `"controlplane_base_url"`, `"logical_cloud_binding_id"`, `"logical_provider_binding_id"`,
		`"schema_version":2`, `"schema_version":1`,
	).Replace(string(raw))
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.CloudID != cfg.CloudID || loaded.AgentInstanceID != cfg.AgentInstanceID ||
		loaded.LocalEnvironmentPublicID != cfg.LocalEnvironmentPublicID || loaded.BindingGeneration != cfg.BindingGeneration ||
		loaded.Direct == nil || !loaded.Direct.Spent || !jsonEqual(loaded.Direct.ArtifactJSON, cfg.Direct.ArtifactJSON) ||
		loaded.ControlArtifactPool.LogicalBindingID != cfg.ControlArtifactPool.LogicalBindingID {
		t.Fatal("migration changed identity or credential state")
	}
	first, _ := os.ReadFile(path)
	if bytes.Contains(first, []byte(`"provider_origin"`)) || bytes.Contains(first, []byte(`logical_provider_binding_id`)) {
		t.Fatal("retired fields were persisted")
	}
	if _, err := Load(path); err != nil {
		t.Fatal(err)
	}
	second, _ := os.ReadFile(path)
	if !bytes.Equal(first, second) {
		t.Fatal("migration is not idempotent")
	}
}

func TestCloudConfigMigrationRejectsConflictAndPreservesWriteFailure(t *testing.T) {
	for _, raw := range []string{
		`{"provider_origin":"https://old.example","cloud_origin":"https://new.example"}`,
		`{"control_artifact_pool":{"schema_version":99}}`,
	} {
		path := filepath.Join(t.TempDir(), "config.json")
		if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := Load(path); err == nil {
			t.Fatal("unsupported state was accepted")
		}
		after, _ := os.ReadFile(path)
		if string(after) != raw {
			t.Fatal("rejected migration modified the file")
		}
	}
	path := filepath.Join(t.TempDir(), "config.json")
	raw := `{"provider_origin":"https://redeven.test","agent_instance_id":"same-agent"}`
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	persistence := defaultConfigPersistence()
	persistence.writeConfig = func(string, *Config) error { return errors.New("write denied") }
	if _, err := loadConfig(path, persistence); err == nil {
		t.Fatal("write failure was ignored")
	}
	after, _ := os.ReadFile(path)
	if string(after) != raw {
		t.Fatal("failed migration modified the file")
	}
}

func TestCloudDeliveryMigrationRetainsLocalIdentityAndRotatesRequest(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	oldID := strings.Repeat("A", 43)
	legacy := `{"version":1,"provider_origin":"https://cloud.example","access_point_origin":"https://old.example","env_public_id":"env-one","local_environment_public_id":"le-one","agent_instance_id":"ai-one","bootstrap_delivery_request_id_b64u":"` + oldID + `"}`
	legacyPath := configPath + ".bootstrap-delivery-v1.json"
	if err := os.WriteFile(legacyPath, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	attempt, path, err := prepareBootstrapDeliveryAttempt(configPath, "https://cloud.example", "https://new.example", "env-one", nil)
	if err != nil {
		t.Fatal(err)
	}
	if attempt.AgentInstanceID != "ai-one" || attempt.LocalEnvironmentPublicID != "le-one" ||
		attempt.BootstrapDeliveryRequestIDB64u == oldID || attempt.AccessPointOrigin != "https://new.example" {
		t.Fatal("legacy delivery identity or protocol boundary was lost")
	}
	again, againPath, err := prepareBootstrapDeliveryAttempt(configPath, "https://cloud.example", "https://new.example", "env-one", nil)
	if err != nil || again != attempt || againPath != path {
		t.Fatal("delivery migration was not idempotent")
	}
	if _, err := os.Stat(legacyPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("legacy journal remains active")
	}
}
