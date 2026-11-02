package trust

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestTrustMigrationRetiresHostClassificationAndPreservesRevocation(t *testing.T) {
	for _, revoked := range []bool{false, true} {
		t.Run(map[bool]string{false: "active", true: "revoked"}[revoked], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "trust.json")
			store := NewStore(path)
			if err := store.Initialize(); err != nil {
				t.Fatal(err)
			}
			request := accessPairing(t, store, "", true)
			if _, err := store.CompletePairing(request, true); err != nil {
				t.Fatal(err)
			}
			if revoked {
				if err := store.RevokeClient(request.ClientKeyID); err != nil {
					t.Fatal(err)
				}
			}
			original := store.state
			raw, _ := os.ReadFile(path)
			var legacy map[string]any
			if err := json.Unmarshal(raw, &legacy); err != nil {
				t.Fatal(err)
			}
			legacy["schema_version"] = 3
			legacy["clients"].(map[string]any)[request.ClientKeyID].(map[string]any)["host_managed"] = true
			raw, _ = json.Marshal(legacy)
			if err := os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			migrated := NewStore(path)
			if err := migrated.Initialize(); err != nil {
				t.Fatal(err)
			}
			if migrated.state.Gateway != original.Gateway || migrated.state.Clients[request.ClientKeyID] != original.Clients[request.ClientKeyID] {
				t.Fatal("migration changed identity or access")
			}
			clients, err := migrated.ListClients()
			if err != nil || len(clients) != 1 {
				t.Fatal("migrated credential is invisible", err)
			}
			if migrated.ClientPermissions(request.ClientKeyID) != (gp.GatewayPermissions{Access: !revoked}) {
				t.Fatal("migration changed authority")
			}
			saved, _ := os.ReadFile(path)
			if bytes.Contains(saved, []byte("host_managed")) || migrated.state.SchemaVersion != 4 {
				t.Fatal("retired classification persisted")
			}
			restarted := NewStore(path)
			if err := restarted.Initialize(); err != nil {
				t.Fatal(err)
			}
			if err := restarted.RevokeClient(request.ClientKeyID); err != nil {
				t.Fatal(err)
			}
			if restarted.ClientPermissions(request.ClientKeyID).Access {
				t.Fatal("restart restored access")
			}
		})
	}
}

func TestUnsupportedTrustSchemaRemainsUnchanged(t *testing.T) {
	path := filepath.Join(t.TempDir(), "trust.json")
	store := NewStore(path)
	if err := store.Initialize(); err != nil {
		t.Fatal(err)
	}
	state := store.state
	state.SchemaVersion = 99
	raw, _ := json.Marshal(state)
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err := NewStore(path).Initialize(); err == nil {
		t.Fatal("future schema accepted")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(raw, after) {
		t.Fatal("unsupported state rewritten")
	}
}
