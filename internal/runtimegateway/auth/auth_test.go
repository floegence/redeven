package auth

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
	"github.com/floegence/redeven/internal/runtimegateway/trust"
)

type testPairingMaterial struct {
	gatewayID        string
	bindingAudience  string
	clientKeyID      string
	clientPrivateKey string
}

func TestVerifierAcceptsSignedCanonicalRequest(t *testing.T) {
	store := trust.NewStore("")
	material := pairTestClient(t, store, "https://gateway.example.internal")
	verifier := NewVerifier(store)
	body := []byte(`{"z":2,"a":{"b":true}}`)
	req := newSignedTestRequest(t, material, http.MethodPost, "/gateway/v1/catalog", body, "nonce-ok")

	verified, err := verifier.Verify(context.Background(), req, body, material.bindingAudience)
	if err != nil {
		t.Fatalf("Verify() error = %v", err)
	}

	if verified.GatewayID != material.gatewayID {
		t.Fatalf("GatewayID = %q, want %q", verified.GatewayID, material.gatewayID)
	}
	if verified.ClientKeyID != material.clientKeyID {
		t.Fatalf("ClientKeyID = %q, want %q", verified.ClientKeyID, material.clientKeyID)
	}
	if verified.BindingAudience != material.bindingAudience {
		t.Fatalf("BindingAudience = %q, want %q", verified.BindingAudience, material.bindingAudience)
	}
}

func TestVerifierRejectsTamperedSignature(t *testing.T) {
	store := trust.NewStore("")
	material := pairTestClient(t, store, "https://gateway.example.internal")
	verifier := NewVerifier(store)
	body := []byte(`{"ok":true}`)
	req := newSignedTestRequest(t, material, http.MethodPost, "/gateway/v1/catalog", body, "nonce-tampered-signature")
	req.Header.Set("X-Redeven-Request-Signature", "not-a-valid-signature")

	if _, err := verifier.Verify(context.Background(), req, body, material.bindingAudience); err == nil {
		t.Fatal("Verify() error = nil, want invalid signature error")
	}
}

func TestVerifierInvalidSignatureDoesNotConsumeNonce(t *testing.T) {
	store := trust.NewStore("")
	material := pairTestClient(t, store, "https://gateway.example.internal")
	verifier := NewVerifier(store)
	body := []byte(`{"ok":true}`)
	req := newSignedTestRequest(t, material, http.MethodPost, "/gateway/v1/catalog", body, "nonce-retry-after-invalid-signature")
	validSignature := req.Header.Get("X-Redeven-Request-Signature")
	req.Header.Set("X-Redeven-Request-Signature", "not-a-valid-signature")

	if _, err := verifier.Verify(context.Background(), req, body, material.bindingAudience); err == nil {
		t.Fatal("Verify() error = nil, want invalid signature error")
	}

	req.Header.Set("X-Redeven-Request-Signature", validSignature)
	if _, err := verifier.Verify(context.Background(), req, body, material.bindingAudience); err != nil {
		t.Fatalf("Verify() after retry error = %v", err)
	}
}

func TestVerifierRejectsBodyDigestMismatch(t *testing.T) {
	store := trust.NewStore("")
	material := pairTestClient(t, store, "https://gateway.example.internal")
	verifier := NewVerifier(store)
	signedBody := []byte(`{"ok":true}`)
	req := newSignedTestRequest(t, material, http.MethodPost, "/gateway/v1/catalog", signedBody, "nonce-body-digest")
	tamperedBody := []byte(`{"ok":false}`)

	if _, err := verifier.Verify(context.Background(), req, tamperedBody, material.bindingAudience); err == nil {
		t.Fatal("Verify() error = nil, want body digest mismatch error")
	}
}

func TestVerifierRejectsNonceReplay(t *testing.T) {
	store := trust.NewStore("")
	material := pairTestClient(t, store, "https://gateway.example.internal")
	verifier := NewVerifier(store)
	body := []byte(`{"ok":true}`)
	first := newSignedTestRequest(t, material, http.MethodPost, "/gateway/v1/catalog", body, "nonce-replay")
	if _, err := verifier.Verify(context.Background(), first, body, material.bindingAudience); err != nil {
		t.Fatalf("first Verify() error = %v", err)
	}
	replayed := newSignedTestRequest(t, material, http.MethodPost, "/gateway/v1/catalog", body, "nonce-replay")

	if _, err := verifier.Verify(context.Background(), replayed, body, material.bindingAudience); err == nil {
		t.Fatal("Verify() error = nil, want nonce replay error")
	}
}

func TestVerifierRejectsWrongAudience(t *testing.T) {
	store := trust.NewStore("")
	material := pairTestClient(t, store, "https://gateway.example.internal")
	verifier := NewVerifier(store)
	body := []byte(`{"ok":true}`)
	req := newSignedTestRequest(t, material, http.MethodPost, "/gateway/v1/catalog", body, "nonce-wrong-audience")

	if _, err := verifier.Verify(context.Background(), req, body, "https://other-gateway.example.internal"); err == nil {
		t.Fatal("Verify() error = nil, want wrong audience error")
	}
}

func TestVerifierDoesNotInitializeUnpairedGatewayIdentity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gateway-trust.json")
	store := trust.NewStore(path)
	verifier := NewVerifier(store)
	body := []byte(`{"ok":true}`)
	req, err := http.NewRequest(http.MethodPost, "http://runtime.local/gateway/v1/catalog", nil)
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	req.Header.Set("X-Redeven-Gateway-ID", security.StableGatewayID("https://attacker.example/"))
	req.Header.Set("X-Redeven-Client-Key-ID", "gck_attacker")
	req.Header.Set("X-Redeven-Client-Nonce", "nonce")
	req.Header.Set("X-Redeven-Request-TS", strconv.FormatInt(time.Now().UnixMilli(), 10))
	req.Header.Set("X-Redeven-Request-Signature", "invalid")

	if _, err := verifier.Verify(context.Background(), req, body, "https://attacker.example/"); err == nil {
		t.Fatal("Verify() error = nil, want unpaired identity error")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("Verify() should not create trust state, stat err = %v", err)
	}
}

func pairTestClient(t *testing.T, store *trust.Store, audience string) testPairingMaterial {
	t.Helper()
	keys, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair() error = %v", err)
	}
	clientNonce := "pair-client-nonce-" + audience
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
	return testPairingMaterial{
		gatewayID:        challenge.GatewayID,
		bindingAudience:  audience,
		clientKeyID:      clientKeyID,
		clientPrivateKey: keys.PrivateKeyPEM,
	}
}

func newSignedTestRequest(t *testing.T, material testPairingMaterial, method string, route string, body []byte, nonce string) *http.Request {
	t.Helper()
	req, err := http.NewRequest(method, "http://runtime.local"+route, nil)
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	ts := time.Now().UnixMilli()
	digest, err := security.CanonicalJSONDigestFromBytes(body)
	if err != nil {
		t.Fatalf("CanonicalJSONDigestFromBytes() error = %v", err)
	}
	payload, err := security.CanonicalJSON(map[string]any{
		"binding_audience":  material.bindingAudience,
		"body_digest":       digest,
		"gateway_id":        material.gatewayID,
		"method":            method,
		"nonce":             nonce,
		"protocol_version":  protocol.Version,
		"route":             route,
		"timestamp_unix_ms": ts,
	})
	if err != nil {
		t.Fatalf("CanonicalJSON() error = %v", err)
	}
	signature, err := security.SignPayload(material.clientPrivateKey, payload)
	if err != nil {
		t.Fatalf("SignPayload() error = %v", err)
	}
	req.Header.Set("X-Redeven-Gateway-ID", material.gatewayID)
	req.Header.Set("X-Redeven-Client-Key-ID", material.clientKeyID)
	req.Header.Set("X-Redeven-Client-Nonce", nonce)
	req.Header.Set("X-Redeven-Request-TS", strconv.FormatInt(ts, 10))
	req.Header.Set("X-Redeven-Request-Signature", signature)
	return req
}
