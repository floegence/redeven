package settings

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestSecretsStoreDropsRetiredRuntimeDirectPSKsOnWrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.json")
	legacy := []byte(`{"schema_version":1,"ai":{"provider_api_keys":{"provider-1":"api-key"}},"runtime":{"direct_psks":{"channel-old":"psk-old"}}}`)
	if err := os.WriteFile(path, legacy, 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	store := NewSecretsStore(path)
	if err := store.SetAIProviderAPIKey("provider-2", "api-key-2"); err != nil {
		t.Fatalf("SetAIProviderAPIKey() error = %v", err)
	}
	if got, ok, err := store.GetAIProviderAPIKey("provider-1"); err != nil || !ok || got != "api-key" {
		t.Fatalf("AI provider key = %q, %v, %v", got, ok, err)
	}

	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if raw["runtime"] != nil || raw["ai"] == nil {
		t.Fatalf("retired runtime secrets were not removed: %s", body)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("Stat() error = %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("secrets mode = %o, want 600", info.Mode().Perm())
	}
}
