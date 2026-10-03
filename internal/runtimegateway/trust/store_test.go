package trust

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"

	"github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
)

func TestGatewayMetadataDoesNotInitializeGatewayIdentity(t *testing.T) {
	audience := "https://gateway.example.internal"
	path := filepath.Join(t.TempDir(), "gateway-trust.json")
	store := NewStore(path)

	if _, _, err := store.GatewayMetadata(audience); err == nil {
		t.Fatalf("GatewayMetadata() error = nil, want uninitialized identity error")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("GatewayMetadata() should not create trust state, stat err = %v", err)
	}
}

func TestPairingChallengeUsesBindingAudienceForGatewayID(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gateway-trust.json")
	store := NewStore(path)
	audience := "https://gateway.example.internal"
	keys, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair() error = %v", err)
	}

	challenge, err := store.PairingChallenge(protocol.PairingChallengeRequest{
		ProtocolVersion: protocol.Version,
		ClientNonce:     "client-nonce",
		ClientPublicKey: keys.PublicKeyPEM,
		BindingAudience: audience,
	})
	if err != nil {
		t.Fatalf("PairingChallenge() error = %v", err)
	}

	if want := security.StableGatewayID(audience); challenge.GatewayID != want {
		t.Fatalf("GatewayID = %q, want %q", challenge.GatewayID, want)
	}
	persisted := readTestState(t, path)
	if persisted.Gateway.GatewayID != challenge.GatewayID {
		t.Fatalf("persisted GatewayID = %q, want %q", persisted.Gateway.GatewayID, challenge.GatewayID)
	}
}

func TestPairingIsAudienceScoped(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "gateway-trust.json"))
	audience := "https://gateway.example.internal"
	otherAudience := "https://other-gateway.example.internal"
	clientKeyID, clientPublicKey := pairTrustTestClient(t, store, audience)

	if !store.IsPaired(clientKeyID, audience) {
		t.Fatalf("IsPaired(%q, %q) = false, want true", clientKeyID, audience)
	}
	if store.IsPaired(clientKeyID, otherAudience) {
		t.Fatalf("IsPaired(%q, %q) = true, want false", clientKeyID, otherAudience)
	}
	if got, ok := store.ClientPublicKey(clientKeyID, audience); !ok || got != clientPublicKey {
		t.Fatalf("ClientPublicKey(%q, %q) = (%q, %v), want paired public key", clientKeyID, audience, got, ok)
	}
	if got, ok := store.ClientPublicKey(clientKeyID, otherAudience); ok || got != "" {
		t.Fatalf("ClientPublicKey(%q, %q) = (%q, %v), want not paired", clientKeyID, otherAudience, got, ok)
	}
}

func TestPairingChallengeEchoesPairingCodeInSignedPayload(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "gateway-trust.json"))
	audience := "https://gateway.example.internal"
	keys, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair() error = %v", err)
	}

	challenge, err := store.PairingChallenge(protocol.PairingChallengeRequest{
		ProtocolVersion: protocol.Version,
		ClientNonce:     "client-nonce",
		ClientPublicKey: keys.PublicKeyPEM,
		BindingAudience: audience,
		PairingCode:     "pair-123456",
	})
	if err != nil {
		t.Fatalf("PairingChallenge() error = %v", err)
	}

	if challenge.PairingCode != "pair-123456" {
		t.Fatalf("PairingCode = %q, want echoed pairing code", challenge.PairingCode)
	}
	payload, err := security.CanonicalJSON(map[string]any{
		"binding_audience":   audience,
		"client_nonce":       "client-nonce",
		"client_public_key":  strings.TrimSpace(keys.PublicKeyPEM),
		"expires_at_unix_ms": challenge.ExpiresAtUnixMS,
		"gateway_id":         challenge.GatewayID,
		"gateway_nonce":      challenge.GatewayNonce,
		"gateway_public_key": challenge.GatewayPublicKey,
		"pairing_code":       "pair-123456",
		"protocol_version":   protocol.Version,
	})
	if err != nil {
		t.Fatalf("CanonicalJSON() error = %v", err)
	}
	if !security.VerifySignature(challenge.GatewayPublicKey, payload, challenge.Signature) {
		t.Fatalf("PairingChallenge() signature did not cover pairing_code")
	}
}

func pairTrustTestClient(t *testing.T, store *Store, audience string) (string, string) {
	t.Helper()
	keys, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair() error = %v", err)
	}
	clientNonce := "pair-client-nonce"
	challenge, err := store.PairingChallenge(protocol.PairingChallengeRequest{
		ProtocolVersion: protocol.Version,
		ClientNonce:     clientNonce,
		ClientPublicKey: keys.PublicKeyPEM,
		BindingAudience: audience,
	})
	if err != nil {
		t.Fatalf("PairingChallenge() error = %v", err)
	}
	clientPublicKey := strings.TrimSpace(keys.PublicKeyPEM)
	clientKeyID := security.ClientKeyID(clientPublicKey)
	payload, err := security.CanonicalJSON(map[string]any{
		"binding_audience": audience,
		"client_key_id":    clientKeyID,
		"client_nonce":     clientNonce,
		"gateway_id":       challenge.GatewayID,
		"gateway_nonce":    challenge.GatewayNonce,
		"protocol_version": protocol.Version,
	})
	if err != nil {
		t.Fatalf("CanonicalJSON() error = %v", err)
	}
	proof, err := security.SignPayload(keys.PrivateKeyPEM, payload)
	if err != nil {
		t.Fatalf("SignPayload() error = %v", err)
	}
	if _, err := store.CompletePairing(protocol.PairingCompleteRequest{
		ProtocolVersion: protocol.Version,
		ClientNonce:     clientNonce,
		GatewayNonce:    challenge.GatewayNonce,
		GatewayID:       challenge.GatewayID,
		BindingAudience: audience,
		ClientKeyID:     clientKeyID,
		Proof:           proof,
	}); err != nil {
		t.Fatalf("CompletePairing() error = %v", err)
	}
	return clientKeyID, clientPublicKey
}

func readTestState(t *testing.T, path string) fileState {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	var state fileState
	if err := json.Unmarshal(raw, &state); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	return state
}

func TestConcurrentPairingAndAuthorization(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "trust.json"))
	audience := "https://gateway.example.internal"
	id, _ := pairTrustTestClient(t, store, audience)
	stop, done := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		for {
			select {
			case <-stop:
				return
			default:
				store.ClientPublicKey(id, audience)
				store.ClientCanWriteProfiles(id, audience)
			}
		}
	}()
	defer func() { close(stop); <-done }()
	var writers sync.WaitGroup
	ids := make(chan string, 30)
	for i := 0; i < 30; i++ {
		writers.Add(1)
		go func() { defer writers.Done(); id, _ := pairTrustTestClient(t, store, audience); ids <- id }()
	}
	writers.Wait()
	close(ids)
	reloaded := NewStore(store.filePath)
	for id := range ids {
		if !store.IsPaired(id, audience) || !reloaded.IsPaired(id, audience) {
			t.Fatalf("lost concurrent pairing %q", id)
		}
	}
}

func TestFailedPairingDoesNotPublishTrust(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "trust.json")
	store := NewStore(statePath)
	audience := "https://gateway.example.internal"
	existingID, _ := pairTrustTestClient(t, store, audience)
	before, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	keys, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	challenge, err := store.PairingChallenge(protocol.PairingChallengeRequest{
		ProtocolVersion: protocol.Version, ClientNonce: "review-client",
		ClientPublicKey: keys.PublicKeyPEM, BindingAudience: audience,
	})
	if err != nil {
		t.Fatal(err)
	}
	clientID := security.ClientKeyID(strings.TrimSpace(keys.PublicKeyPEM))
	payload, err := security.CanonicalJSON(map[string]any{
		"protocol_version": protocol.Version, "client_nonce": "review-client",
		"gateway_nonce": challenge.GatewayNonce, "gateway_id": challenge.GatewayID,
		"binding_audience": audience, "client_key_id": clientID,
		"client_capability": "env_profile_write",
	})
	if err != nil {
		t.Fatal(err)
	}
	proof, err := security.SignPayload(keys.PrivateKeyPEM, payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(statePath, statePath+".retained"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(statePath, 0700); err != nil {
		t.Fatal(err)
	}
	_, err = store.CompletePairing(protocol.PairingCompleteRequest{
		ProtocolVersion: protocol.Version, ClientNonce: "review-client",
		GatewayNonce: challenge.GatewayNonce, GatewayID: challenge.GatewayID,
		BindingAudience: audience, ClientKeyID: clientID, ClientCapability: "env_profile_write", Proof: proof,
	})
	if err == nil {
		t.Fatal("expected injected persistence failure")
	}
	if store.IsPaired(clientID, audience) || store.ClientCanWriteProfiles(clientID, audience) {
		t.Fatal("failed pairing published client trust and profile-write permission in memory")
	}
	retained, err := os.ReadFile(statePath + ".retained")
	if err != nil || !bytes.Equal(before, retained) {
		t.Fatal("failed write changed retained trust")
	}
	if !store.IsPaired(existingID, audience) {
		t.Fatal("failed write removed existing in-memory trust")
	}
	if err := os.Remove(statePath); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(statePath+".retained", statePath); err != nil {
		t.Fatal(err)
	}
	if !NewStore(statePath).IsPaired(existingID, audience) {
		t.Fatal("existing trust was not reloadable")
	}
	temporary, err := filepath.Glob(filepath.Join(filepath.Dir(statePath), ".gateway-trust-*"))
	if err != nil || len(temporary) != 0 {
		t.Fatalf("temporary trust files leaked: %v, %v", temporary, err)
	}
}

func TestPairingReplacesTrustFileAtomically(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "trust.json")
	store := NewStore(statePath)
	audience := "https://gateway.example.internal"
	first, _ := pairTrustTestClient(t, store, audience)
	original, err := os.Open(statePath)
	if err != nil {
		t.Fatal(err)
	}
	defer original.Close()
	before, err := io.ReadAll(original)
	if err != nil {
		t.Fatal(err)
	}
	second, _ := pairTrustTestClient(t, store, audience)
	if _, err := original.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	oldBytes, err := io.ReadAll(original)
	if err != nil || !bytes.Equal(before, oldBytes) {
		t.Fatal("pairing overwrote the committed trust file in place")
	}
	reloaded := NewStore(statePath)
	if !reloaded.IsPaired(first, audience) || !reloaded.IsPaired(second, audience) {
		t.Fatal("pairing lost persisted clients")
	}
	info, err := os.Stat(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Fatalf("trust permissions = %v", info.Mode().Perm())
	}
}
