package gatewaycloud

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestProofV2SharedFixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/proof-v2.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Seed    string        `json:"test_seed_b64u"`
		Public  string        `json:"public_key_b64u"`
		Bytes   string        `json:"signing_bytes_b64u"`
		Request SignedRequest `json:"request"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	proof := fixture.Request.Proof
	body := fixture.Request.Payload
	now := time.UnixMilli(proof.ExpiresAtUnixMS - 60_000)
	if err := proof.Verify(fixture.Public, body, now); err != nil {
		t.Fatal(err)
	}
	encoded, err := proof.SigningBytes()
	if err != nil || base64.RawURLEncoding.EncodeToString(encoded) != fixture.Bytes {
		t.Fatal("signing format drift", err)
	}
	seed, err := DecodeKey(fixture.Seed)
	if err != nil {
		t.Fatal(err)
	}
	reproduced := proof
	if err := reproduced.Sign(ed25519.NewKeyFromSeed(seed), body); err != nil || reproduced != proof {
		t.Fatal("signature drift", err)
	}
	changes := map[string]func(*Proof){
		"version":    func(p *Proof) { p.ProtocolVersion++ },
		"purpose":    func(p *Proof) { p.Purpose = PurposeRuntimeJoin },
		"cloud":      func(p *Proof) { p.CloudOrigin = "https://other.example" },
		"namespace":  func(p *Proof) { p.NamespacePublicID += "other" },
		"gateway":    func(p *Proof) { p.GatewayPublicID += "other" },
		"runtime":    func(p *Proof) { p.RuntimePublicID += "other" },
		"binding":    func(p *Proof) { p.BindingPublicID += "other" },
		"generation": func(p *Proof) { p.BindingGeneration++ },
		"challenge":  func(p *Proof) { p.ChallengeID += "other" },
		"expiry":     func(p *Proof) { p.ExpiresAtUnixMS++ },
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			altered := proof
			change(&altered)
			if altered.Verify(fixture.Public, body, now) == nil {
				t.Fatal("altered proof accepted")
			}
		})
	}
	if proof.Verify(fixture.Public, append(append([]byte(nil), body...), ' '), now) == nil {
		t.Fatal("different payload bytes accepted")
	}
	if proof.Verify(fixture.Public, body, time.UnixMilli(proof.ExpiresAtUnixMS)) == nil {
		t.Fatal("expired proof accepted")
	}
}
