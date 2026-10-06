package gatewaycloud

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestRuntimeMembershipRequiresBothProofsInTheSameContext(t *testing.T) {
	raw, err := os.ReadFile("testdata/membership-v2.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Seed    string        `json:"test_seed_b64u"`
		Request SignedRequest `json:"request"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	var request RuntimeJoin
	if err := json.Unmarshal(fixture.Request.Payload, &request); err != nil {
		t.Fatal(err)
	}
	proof := fixture.Request.Proof
	now := time.UnixMilli(proof.ExpiresAtUnixMS - 60_000)
	if err := proof.Verify(request.PublicKeyB64u, fixture.Request.Payload, now); err != nil {
		t.Fatal(err)
	}
	if err := VerifyRuntimeMembership(proof, request, request.Delegation.GatewayID, now); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*Proof, *RuntimeJoin){
		"cloud":          func(p *Proof, _ *RuntimeJoin) { p.CloudOrigin = "https://other.example" },
		"namespace":      func(p *Proof, _ *RuntimeJoin) { p.NamespacePublicID += "other" },
		"gateway_access": func(p *Proof, _ *RuntimeJoin) { p.GatewayPublicID += "other" },
		"challenge":      func(p *Proof, _ *RuntimeJoin) { p.ChallengeID += "other" },
		"expiry":         func(p *Proof, _ *RuntimeJoin) { p.ExpiresAtUnixMS++ },
		"member_version": func(_ *Proof, r *RuntimeJoin) { r.MemberVersion++ },
		"delegation":     func(_ *Proof, r *RuntimeJoin) { r.Delegation.ManageCloudPublication = false },
		"cloud_key":      func(_ *Proof, r *RuntimeJoin) { r.PublicKeyB64u += "x" },
	} {
		t.Run(name, func(t *testing.T) {
			p, r := proof, request
			mutate(&p, &r)
			if VerifyRuntimeMembership(p, r, request.Delegation.GatewayID, now) == nil {
				t.Fatal("modified member authorization accepted")
			}
		})
	}
	if VerifyRuntimeMembership(proof, request, "another_gateway", now) == nil {
		t.Fatal("delegation crossed stable Gateway identities")
	}
	// Possession of a Cloud key cannot substitute for the member delegation key.
	_, otherKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := SignRuntimeMembership(proof, &request, otherKey); err != nil {
		t.Fatal(err)
	}
	if VerifyRuntimeMembership(proof, request, request.Delegation.GatewayID, now) == nil {
		t.Fatal("unrelated Cloud key impersonated membership")
	}
}

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
