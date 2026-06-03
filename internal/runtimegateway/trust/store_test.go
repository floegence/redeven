package trust

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
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
