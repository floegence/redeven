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

func TestEveryAccessCredentialRemainsVisibleAndRevocable(t *testing.T) {
	for _, hostPairing := range []bool{false, true} {
		t.Run(map[bool]string{false: "access-code", true: "host"}[hostPairing], func(t *testing.T) {
			store := NewStore("")
			if err := store.Initialize(); err != nil {
				t.Fatal(err)
			}
			code, err := store.IssueAccessCode()
			if err != nil {
				t.Fatal(err)
			}
			request := accessPairing(t, store, code.AccessCode, hostPairing)
			if _, err := store.CompletePairing(request, hostPairing); err != nil {
				t.Fatal(err)
			}
			if err := store.RecordVerified(request.ClientKeyID); err != nil {
				t.Fatal(err)
			}
			clients, err := store.ListClients()
			if err != nil || len(clients) != 1 || clients[0].ClientKeyID != request.ClientKeyID {
				t.Fatalf("public access credential disappeared after host verification: %v, %v", clients, err)
			}
			if err := store.RevokeClient(request.ClientKeyID); err != nil {
				t.Fatal(err)
			}
			if store.ClientPermissions(request.ClientKeyID).Access {
				t.Fatal("revoked credential retains access")
			}
			if _, err := store.CompletePairing(request, hostPairing); err == nil {
				t.Fatal("old pairing completion restored access")
			}
		})
	}
}

func TestRevokedKeyCannotRegainAccessThroughNewChallenge(t *testing.T) {
	store := NewStore("")
	if err := store.Initialize(); err != nil {
		t.Fatal(err)
	}
	keys, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	pair := func() (gp.PairingCompleteResponse, error) {
		challenge, err := store.PairingChallenge(gp.PairingChallengeRequest{ProtocolVersion: gp.Version, ClientNonce: "nonce", ClientPublicKey: keys.PublicKeyPEM, BindingAudience: "https://gateway.example"}, true)
		if err != nil {
			return gp.PairingCompleteResponse{}, err
		}
		req := gp.PairingCompleteRequest{ProtocolVersion: gp.Version, ClientNonce: "nonce", GatewayNonce: challenge.GatewayNonce, GatewayID: challenge.GatewayID, BindingAudience: "https://gateway.example", ClientKeyID: security.ClientKeyID(strings.TrimSpace(keys.PublicKeyPEM))}
		payload, _ := security.CanonicalJSON(map[string]any{"protocol_version": req.ProtocolVersion, "client_nonce": req.ClientNonce, "gateway_nonce": req.GatewayNonce, "gateway_id": req.GatewayID, "binding_audience": req.BindingAudience, "client_key_id": req.ClientKeyID})
		req.Proof, err = security.SignPayload(keys.PrivateKeyPEM, payload)
		if err != nil {
			return gp.PairingCompleteResponse{}, err
		}
		return store.CompletePairing(req, true)
	}
	first, err := pair()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RevokeClient(first.ClientKeyID); err != nil {
		t.Fatal(err)
	}
	if _, err := pair(); err == nil || err.Error() != "CLIENT_ACCESS_REVOKED" {
		t.Fatal("new challenge reactivated old identity", err)
	}
	fresh := accessPairing(t, store, "", true)
	if _, err := store.CompletePairing(fresh, true); err != nil {
		t.Fatal("explicit fresh identity cannot pair", err)
	}
	if store.ClientPermissions(first.ClientKeyID).Access || !store.ClientPermissions(fresh.ClientKeyID).Access {
		t.Fatal("revocation scope changed")
	}
}
