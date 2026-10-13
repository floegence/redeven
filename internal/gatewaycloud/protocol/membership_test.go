package gatewaycloud

import (
	"crypto/ed25519"
	"encoding/base64"
	"testing"
)

func TestStableGatewayIdentityCannotBeClaimedByAnotherCloudKey(t *testing.T) {
	_, stable, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	proof := Proof{ProtocolVersion: ProtocolVersion, Purpose: PurposeGatewayRegister, CloudOrigin: "https://cloud.example", ChallengeID: "challenge_one"}
	request := GatewayRegistration{Identity: GatewayMachineIdentity{GatewayID: "gateway_one", PublicKeyB64u: base64.RawURLEncoding.EncodeToString(stable.Public().(ed25519.PublicKey))}, PublicKeyB64u: "cloud_key_one"}
	if err := SignGatewayMachineIdentity(proof, &request, stable); err != nil {
		t.Fatal(err)
	}
	if err := VerifyGatewayMachineIdentity(proof, request); err != nil {
		t.Fatal(err)
	}
	request.PublicKeyB64u = "cloud_key_other"
	if VerifyGatewayMachineIdentity(proof, request) == nil {
		t.Fatal("stable identity claimed with another Cloud key")
	}
}
