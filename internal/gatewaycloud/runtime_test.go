package gatewaycloud

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"testing"
	"time"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
)

func TestMachineRotationSigningContextIsNotReusable(t *testing.T) {
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	proof := gc.Proof{ProtocolVersion: gc.ProtocolVersion, Purpose: gc.PurposeIdentityRotate, CloudOrigin: "https://cloud.example", NamespacePublicID: "namespace", GatewayPublicID: "gateway", ChallengeID: "challenge", ChallengeB64u: base64.RawURLEncoding.EncodeToString(make([]byte, 32)), ExpiresAtUnixMS: time.Now().Add(time.Minute).UnixMilli()}
	public := base64.RawURLEncoding.EncodeToString(key.Public().(ed25519.PublicKey))
	message, err := gc.RotationSigningBytes(proof, public)
	if err != nil {
		t.Fatal(err)
	}
	signature := ed25519.Sign(key, message)
	proof.NamespacePublicID = "other"
	other, err := gc.RotationSigningBytes(proof, public)
	if err != nil {
		t.Fatal(err)
	}
	if ed25519.Verify(key.Public().(ed25519.PublicKey), other, signature) {
		t.Fatal("rotation replayed across namespaces")
	}
}
