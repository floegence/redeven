package trust

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/runtimegateway/security"
)

func TestLegacyPairingPreservesAccessWithoutPromotingProfileWrite(t *testing.T) {
	identity, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	client, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	id := security.ClientKeyID(client.PublicKeyPEM)
	path := filepath.Join(t.TempDir(), "trust.json")
	raw, err := json.Marshal(map[string]any{
		"schema_version": 1,
		"gateway":        map[string]any{"gateway_id": "old_stable_id", "public_key": identity.PublicKeyPEM, "private_key": identity.PrivateKeyPEM},
		"clients":        map[string]any{id: map[string]any{"client_key_id": id, "client_public_key": client.PublicKeyPEM, "binding_audience": "old-url", "profile_write": true}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	store := NewStore(path)
	if err := store.Initialize(); err != nil {
		t.Fatal(err)
	}
	permissions := store.ClientPermissions(id)
	if !permissions.Access || permissions.ManageMembers || permissions.ConfigureCloud {
		t.Fatalf("legacy permissions were elevated: %+v", permissions)
	}
	metadata, _, err := store.GatewayMetadata("new-url")
	if err != nil || metadata.GatewayID != "old_stable_id" {
		t.Fatalf("machine identity changed: %v", err)
	}
	migrated, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var state fileState
	if json.Unmarshal(migrated, &state) != nil || state.SchemaVersion != 3 {
		t.Fatal("migration was not persisted")
	}
}
