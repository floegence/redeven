package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOldOrUnknownCloudConfigurationIsRejectedReadOnly(t *testing.T) {
	for _, raw := range []string{
		`{"provider_origin":"https://cloud.example"}`,
		`{"runtime_config_version":99}`,
		`{"runtime_config_version":1,"gateway_publication":{}}`,
		`{"runtime_config_version":1,"unknown_contract":true}`,
		`{"runtime_config_version":1,"cloud_origin":"https://cloud.example"}`,
	} {
		path := filepath.Join(t.TempDir(), "config.json")
		if err := os.WriteFile(path, []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		_, err := Load(path)
		if err == nil || !strings.Contains(err.Error(), "state root") {
			t.Fatalf("old configuration has no recovery guidance: %v", err)
		}
		retained, err := os.ReadFile(path)
		if err != nil || string(retained) != raw {
			t.Fatal("rejected configuration was silently rewritten")
		}
	}
}

func TestCurrentConfigurationHasOneVersionAndNoRetiredReaders(t *testing.T) {
	current := Config{LocalEnvironmentPublicID: "runtime", AgentInstanceID: "instance"}
	encoded, err := json.Marshal(current)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "gateway_membership_schema_version") || strings.Contains(string(encoded), `"direct"`) {
		t.Fatal("retired configuration field was written")
	}
	var decoded Config
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.ConfigVersion != RuntimeConfigVersion {
		t.Fatal("configuration version did not round trip")
	}
}
