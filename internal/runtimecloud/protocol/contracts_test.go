package protocol

import (
	"crypto/ed25519"
	"encoding/base64"
	"testing"
	"time"
)

func TestBindingOwnerIsExplicitAndRouteIndependent(t *testing.T) {
	binding := BindingFence{PublicID: "binding", CloudID: "cloud", RuntimePublicID: "runtime", EnvPublicID: "env", NamespacePublicID: "namespace", OwnerKind: OwnerNamespace, OwnerPublicID: "namespace", Generation: 1}
	if !binding.Valid() {
		t.Fatal("namespace machine binding must not require a publisher or Gateway")
	}
	binding.OwnerPublicID = "another_namespace"
	if binding.Valid() {
		t.Fatal("namespace owner must match the assigned namespace")
	}
	binding.OwnerKind, binding.OwnerPublicID = OwnerUser, "user"
	if !binding.Valid() {
		t.Fatal("explicit user owner must be supported by the same contract")
	}
	binding.OwnerKind = ""
	if binding.Valid() {
		t.Fatal("empty owner kind cannot infer authorization")
	}
}

func TestRuntimeProofBindsPurposeSubjectAndPayload(t *testing.T) {
	key := ed25519.NewKeyFromSeed(make([]byte, 32))
	publicKey := base64.RawURLEncoding.EncodeToString(key.Public().(ed25519.PublicKey))
	now := time.Unix(2000000000, 0)
	proof := Proof{NamespacePublicID: "namespace", CloudOrigin: "https://cloud.example", ProtocolVersion: ProtocolVersion, Purpose: PurposeRecover, ChallengeID: "challenge", NonceB64u: base64.RawURLEncoding.EncodeToString(make([]byte, 32)), RuntimePublicID: "runtime", BindingPublicID: "binding", ExpiresAtUnixMS: now.Add(time.Minute).UnixMilli()}
	payload := []byte(`{"delivery_request_id":"delivery"}`)
	if err := proof.Sign(key, payload); err != nil {
		t.Fatal(err)
	}
	if err := proof.Verify(publicKey, payload, now); err != nil {
		t.Fatal(err)
	}
	for _, change := range []string{"purpose", "runtime", "binding", "body", "expired"} {
		t.Run(change, func(t *testing.T) {
			copy, body, at := proof, payload, now
			switch change {
			case "purpose":
				copy.Purpose = PurposeClosureAck
			case "runtime":
				copy.RuntimePublicID = "another"
			case "binding":
				copy.BindingPublicID = "another"
			case "body":
				body = []byte(`{}`)
			case "expired":
				at = now.Add(2 * time.Minute)
			}
			if copy.Verify(publicKey, body, at) == nil {
				t.Fatal("modified or expired proof must be rejected")
			}
		})
	}
}
