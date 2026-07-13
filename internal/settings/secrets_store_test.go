package settings

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestSecretsStoreRuntimeDirectPSKs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.json")
	first := NewSecretsStore(path)
	second := NewSecretsStore(path)
	if err := first.SetAIProviderAPIKey("provider-1", "api-key"); err != nil {
		t.Fatalf("SetAIProviderAPIKey() error = %v", err)
	}
	if err := first.SetRuntimeDirectPSK("channel-old", "psk-old"); err != nil {
		t.Fatalf("SetRuntimeDirectPSK(old) error = %v", err)
	}
	if err := second.SetRuntimeDirectPSK("channel-current", "psk-current"); err != nil {
		t.Fatalf("SetRuntimeDirectPSK(current) error = %v", err)
	}
	if err := second.RetainRuntimeDirectPSK("channel-current"); err != nil {
		t.Fatalf("RetainRuntimeDirectPSK() error = %v", err)
	}
	if _, ok, err := first.GetRuntimeDirectPSK("channel-old"); err != nil || ok {
		t.Fatalf("old direct psk = ok:%v err:%v, want removed", ok, err)
	}
	if got, ok, err := first.GetRuntimeDirectPSK("channel-current"); err != nil || !ok || got != "psk-current" {
		t.Fatalf("current direct psk = %q, %v, %v", got, ok, err)
	}
	if got, ok, err := second.GetAIProviderAPIKey("provider-1"); err != nil || !ok || got != "api-key" {
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
	if raw["runtime"] == nil || raw["ai"] == nil {
		t.Fatalf("secrets file lost a section: %s", body)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("Stat() error = %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("secrets mode = %o, want 600", info.Mode().Perm())
	}
}
