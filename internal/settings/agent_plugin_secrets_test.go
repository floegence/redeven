package settings

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestAgentPluginSecretsMigratePreserveAndIsolate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.json")
	raw := []byte("{\"schema_version\":3,\"ai\":{\"provider_api_keys\":{\"provider\":\"preserved\"}}}")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	store := NewSecretsStore(path)
	values := map[string]string{"API_KEY": "plugin-secret"}
	ref, err := store.PutAgentPluginCredential(values)
	if err != nil {
		t.Fatal(err)
	}
	values["API_KEY"] = "caller mutation"
	reopened := NewSecretsStore(path)
	got, err := reopened.AgentPluginCredential(ref)
	if err != nil || got["API_KEY"] != "plugin-secret" {
		t.Fatal("secret not retained", err)
	}
	got["API_KEY"] = "reader mutation"
	got, err = reopened.AgentPluginCredential(ref)
	if err != nil || got["API_KEY"] != "plugin-secret" {
		t.Fatal("reader changed state", err)
	}
	if err = reopened.DeleteAgentPluginCredential(ref); err != nil {
		t.Fatal(err)
	}
	if _, err = store.AgentPluginCredential(ref); err == nil {
		t.Fatal("deleted credential resolved")
	}
	if key, ok, err := store.GetAIProviderAPIKey("provider"); err != nil || !ok || key != "preserved" {
		t.Fatal("migration lost provider secret", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var stored secretsFile
	if err = json.Unmarshal(data, &stored); err != nil || stored.SchemaVersion != 4 {
		t.Fatal("incorrect migrated schema", err)
	}
}
