package protocol

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"math/big"
	"strings"
	"testing"
	"time"
)

func clientPackageFixture(t *testing.T) ClientAccessPackage {
	t.Helper()
	public, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	publicDER, err := x509.MarshalPKIXPublicKey(public)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(1), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour)}
	der, err := x509.CreateCertificate(rand.Reader, template, template, public, key)
	if err != nil {
		t.Fatal(err)
	}
	return ClientAccessPackage{Purpose: ClientAccessPurpose, Version: 1, AccessCode: strings.Repeat("a", 32), GatewayID: "gateway_test", GatewayPublicKey: string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER})), TLSRootPEM: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})), ExpiresAtUnixMS: time.Now().Add(10 * time.Minute).UnixMilli()}
}

func TestClientAccessPackageRejectsWrongPurposeExpiryAndTrust(t *testing.T) {
	now := time.Now()
	valid := clientPackageFixture(t)
	encode := func(p ClientAccessPackage) string {
		raw, _ := json.Marshal(p)
		return clientAccessPrefix + base64.RawURLEncoding.EncodeToString(raw)
	}
	value, err := EncodeClientAccessPackage(valid)
	if err != nil {
		t.Fatal(err)
	}
	got, err := DecodeClientAccessPackage(value, now)
	if err != nil || got != valid {
		t.Fatal("valid package lost scoped trust", err)
	}
	for name, change := range map[string]func(*ClientAccessPackage){
		"runtime invitation": func(p *ClientAccessPackage) { p.Purpose = "redeven.gateway.enrollment.v1" },
		"version":            func(p *ClientAccessPackage) { p.Version = 2 },
		"expired":            func(p *ClientAccessPackage) { p.ExpiresAtUnixMS = now.UnixMilli() },
		"unbounded lifetime": func(p *ClientAccessPackage) { p.ExpiresAtUnixMS = now.Add(time.Hour).UnixMilli() },
		"root substitution":  func(p *ClientAccessPackage) { p.TLSRootPEM = p.GatewayPublicKey },
		"appended root":      func(p *ClientAccessPackage) { p.TLSRootPEM += p.TLSRootPEM },
		"appended key":       func(p *ClientAccessPackage) { p.GatewayPublicKey += "ignored" },
	} {
		t.Run(name, func(t *testing.T) {
			p := valid
			change(&p)
			if _, err := DecodeClientAccessPackage(encode(p), now); err == nil {
				t.Fatal("invalid package accepted")
			}
		})
	}
	raw, _ := json.Marshal(valid)
	for _, value := range []string{"raw-access-code", value + "=", clientAccessPrefix + base64.RawURLEncoding.EncodeToString(append(raw, []byte("{}")...)), clientAccessPrefix + base64.RawURLEncoding.EncodeToString([]byte(strings.TrimSuffix(string(raw), "}")+",\"unknown\":true}"))} {
		if _, err := DecodeClientAccessPackage(value, now); err == nil {
			t.Fatal("invalid envelope accepted")
		}
	}
}

func TestInvitationDeliveryBindsPurposeIdentityAddressAndExpiry(t *testing.T) {
	public, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	code, err := flowersec.DeriveInvitationCode(key.Seed(), "invitation_test")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	publicText := base64.RawURLEncoding.EncodeToString(public)
	delivery := InvitationCodeDelivery{ProtocolVersion: Version, InvitationID: "invitation_test", GatewayID: "gateway_test", GatewayName: "Office", GatewayPublicKey: publicText, ShareAddress: "https://gateway.example", ShareAddresses: []string{"https://gateway.example"}, Code: code.Text(), IssuedAtUnixMS: now.UnixMilli(), ExpiresAtUnixMS: now.Add(10 * time.Minute).UnixMilli()}
	if err := SignInvitationCodeDelivery(&delivery, key); err != nil {
		t.Fatal(err)
	}
	if err := delivery.Verify(delivery.GatewayID, publicText, now); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*InvitationCodeDelivery){func(d *InvitationCodeDelivery) { d.GatewayID = "other" }, func(d *InvitationCodeDelivery) { d.ShareAddress = "https://other.example" }, func(d *InvitationCodeDelivery) { d.Code = strings.Repeat("X", 26) }, func(d *InvitationCodeDelivery) { d.Signature = "" }} {
		d := delivery
		change(&d)
		if d.Verify(delivery.GatewayID, publicText, now) == nil {
			t.Fatal("tampered invitation accepted")
		}
	}
	if delivery.Verify(delivery.GatewayID, publicText, now.Add(10*time.Minute)) == nil {
		t.Fatal("expired invitation accepted")
	}
	if _, err := DecodeClientAccessPackage(code.Text(), now); err == nil {
		t.Fatal("Runtime invitation accepted as client package")
	}
}

func TestEgressDestinationsAreExactCanonicalAuthorities(t *testing.T) {
	for _, valid := range [][]string{nil, {}, {"cloud.example:443", "127.0.0.1:8443", "[::1]:443"}} {
		if err := ValidateEgressDestinations(valid); err != nil {
			t.Fatal(valid, err)
		}
	}
	for _, invalid := range [][]string{{"*.example:443"}, {"https://cloud.example:443"}, {"cloud.example:0443"}, {"cloud.example:443/path"}, {"Cloud.example:443"}, {"cloud.example.:443"}, {"bad_.example:443"}, {"cloud.example:443", "cloud.example:443"}, {"cloud.example:0"}, {"cloud.example:65536"}} {
		if ValidateEgressDestinations(invalid) == nil {
			t.Fatal("invalid destination accepted", invalid)
		}
	}
}
