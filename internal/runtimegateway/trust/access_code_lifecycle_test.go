package trust

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
)

func TestAccessCodeAtomicConsumptionAndRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "trust.json")
	store := NewStore(path)
	if err := store.Initialize(); err != nil {
		t.Fatal(err)
	}
	code, err := store.IssueAccessCode()
	if err != nil {
		t.Fatal(err)
	}
	if delta := code.ExpiresAtUnixMS - time.Now().UnixMilli(); delta < 599_000 || delta > 600_000 {
		t.Fatal("code does not expire after ten minutes")
	}
	raw, _ := os.ReadFile(path)
	if strings.Contains(string(raw), code.AccessCode) {
		t.Fatal("raw access code persisted")
	}
	requests := make([]gp.PairingCompleteRequest, 16)
	for index := range requests {
		requests[index] = accessPairing(t, store, code.AccessCode, false)
	}
	var workers sync.WaitGroup
	winners := make(chan gp.PairingCompleteRequest, len(requests))
	for _, request := range requests {
		workers.Add(1)
		go func() {
			defer workers.Done()
			if _, err := store.CompletePairing(request, false); err == nil {
				winners <- request
			}
		}()
	}
	workers.Wait()
	close(winners)
	if len(winners) != 1 {
		t.Fatalf("got %d winners", len(winners))
	}
	winner := <-winners
	restarted := NewStore(path)
	if err := restarted.Initialize(); err != nil {
		t.Fatal(err)
	}
	if !restarted.ClientPermissions(winner.ClientKeyID).Access {
		t.Fatal("enrolled client lost access after restart")
	}
	if err := restarted.RevokeClient(winner.ClientKeyID); err != nil {
		t.Fatal(err)
	}
	restarted = NewStore(path)
	if restarted.ClientPermissions(winner.ClientKeyID).Access {
		t.Fatal("revocation was not retained after restart")
	}
	if _, ok := restarted.ClientPublicKey(winner.ClientKeyID, "https://gateway.example"); ok {
		t.Fatal("revoked client can authenticate")
	}
}

func TestAccessCodeExpiryAndFailedPersistence(t *testing.T) {
	store := NewStore("")
	if err := store.Initialize(); err != nil {
		t.Fatal(err)
	}
	code, err := store.IssueAccessCode()
	if err != nil {
		t.Fatal(err)
	}
	request := accessPairing(t, store, code.AccessCode, false)
	expired := store.state.AccessCodes[accessCodeHash(code.AccessCode)]
	expired.ExpiresAtUnixMS = time.Now().Add(-time.Second).UnixMilli()
	store.state.AccessCodes[accessCodeHash(code.AccessCode)] = expired
	if _, err := store.CompletePairing(request, false); err == nil {
		t.Fatal("expired code consumed")
	}
	code, err = store.IssueAccessCode()
	if err != nil {
		t.Fatal(err)
	}
	request = accessPairing(t, store, code.AccessCode, false)
	store.filePath = t.TempDir()
	if _, err := store.CompletePairing(request, false); err == nil {
		t.Fatal("failed commit reported success")
	}
	if store.state.AccessCodes[accessCodeHash(code.AccessCode)].ClientKeyID != "" || store.state.Clients[request.ClientKeyID].Access {
		t.Fatal("failed commit consumed the code")
	}
	store.filePath = ""
	if _, err := store.CompletePairing(request, false); err != nil {
		t.Fatalf("retry failed: %v", err)
	}
}

func TestMigrationDoesNotElevateDeniedClients(t *testing.T) {
	for _, allowed := range []bool{false, true} {
		t.Run(strings.ToUpper(map[bool]string{false: "denied", true: "allowed"}[allowed]), func(t *testing.T) {
			identity, _ := security.GenerateKeyPair()
			keys, _ := security.GenerateKeyPair()
			id := security.ClientKeyID(keys.PublicKeyPEM)
			path := filepath.Join(t.TempDir(), "trust.json")
			raw, err := json.Marshal(map[string]any{"schema_version": 2, "gateway": map[string]any{"gateway_id": "stable", "public_key": identity.PublicKeyPEM, "private_key": identity.PrivateKeyPEM}, "clients": map[string]any{id: map[string]any{"client_key_id": id, "client_public_key": keys.PublicKeyPEM, "permissions": gp.GatewayPermissions{Access: allowed, ManageMembers: true, ConfigureCloud: true}}}})
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
			if store.ClientPermissions(id) != (gp.GatewayPermissions{Access: allowed}) {
				t.Fatal("migration elevated authority")
			}
			metadata, _, err := store.GatewayMetadata("")
			if err != nil || metadata.GatewayID != "stable" {
				t.Fatal("migration replaced identity")
			}
		})
	}
}
