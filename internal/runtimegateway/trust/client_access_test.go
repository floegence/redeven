package trust

import (
	"strings"
	"testing"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
)

func accessPairing(t *testing.T, store *Store, code string, host bool) gp.PairingCompleteRequest {
	t.Helper()
	keys, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	challenge, err := store.PairingChallenge(gp.PairingChallengeRequest{ProtocolVersion: gp.Version, ClientNonce: "client-nonce", ClientPublicKey: keys.PublicKeyPEM, BindingAudience: "https://gateway.example", AccessCode: code, ClientName: "Office Desktop"}, host)
	if err != nil {
		t.Fatal(err)
	}
	request := gp.PairingCompleteRequest{ProtocolVersion: gp.Version, ClientNonce: "client-nonce", GatewayNonce: challenge.GatewayNonce, GatewayID: challenge.GatewayID, BindingAudience: "https://gateway.example", ClientKeyID: security.ClientKeyID(strings.TrimSpace(keys.PublicKeyPEM))}
	payload, err := security.CanonicalJSON(map[string]any{"protocol_version": request.ProtocolVersion, "client_nonce": request.ClientNonce, "gateway_nonce": request.GatewayNonce, "gateway_id": request.GatewayID, "binding_audience": request.BindingAudience, "client_key_id": request.ClientKeyID})
	if err != nil {
		t.Fatal(err)
	}
	request.Proof, err = security.SignPayload(keys.PrivateKeyPEM, payload)
	if err != nil {
		t.Fatal(err)
	}
	return request
}

func TestAccessCodeSingleUseAndCompletionRetry(t *testing.T) {
	store := NewStore("")
	if err := store.Initialize(); err != nil {
		t.Fatal(err)
	}
	code, err := store.IssueAccessCode()
	if err != nil {
		t.Fatal(err)
	}
	first := accessPairing(t, store, code.AccessCode, false)
	second := accessPairing(t, store, code.AccessCode, false)
	completed, err := store.CompletePairing(first, false)
	if err != nil {
		t.Fatal(err)
	}
	if completed.Permissions != (gp.GatewayPermissions{Access: true}) {
		t.Fatal("client received management authority")
	}
	retry, err := store.CompletePairing(first, false)
	if err != nil || retry.Proof != completed.Proof {
		t.Fatalf("completion retry: %v", err)
	}
	if _, err := store.CompletePairing(second, false); err == nil {
		t.Fatal("access code reused by another client")
	}
	if err := store.RevokeClient(first.ClientKeyID); err != nil {
		t.Fatal(err)
	}
	if store.ClientPermissions(first.ClientKeyID).Access {
		t.Fatal("revoked client retains access")
	}
	if _, err := store.CompletePairing(first, false); err == nil {
		t.Fatal("retry reactivated revoked access")
	}
}

func TestHostPairingDoesNotCreatePersistentManagementGrant(t *testing.T) {
	store := NewStore("")
	if err := store.Initialize(); err != nil {
		t.Fatal(err)
	}
	request := accessPairing(t, store, "", true)
	if _, err := store.CompletePairing(request, false); err == nil {
		t.Fatal("host challenge completed without host proof")
	}
	if _, err := store.CompletePairing(request, true); err != nil {
		t.Fatal(err)
	}
	if store.ClientPermissions(request.ClientKeyID) != (gp.GatewayPermissions{Access: true}) {
		t.Fatal("host authority persisted in client credential")
	}
}
