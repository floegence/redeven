package redevpluginartifacts

import (
	"bytes"
	"crypto/ed25519"
	"strings"
	"testing"
)

func TestContainersCapabilityContractPinsV4(t *testing.T) {
	contract, err := ContainersCapabilityContract()
	if err != nil {
		t.Fatal(err)
	}
	pin := contract.Pin
	if pin.PublisherID != "com.redeven.official" ||
		pin.ContractID != "redeven.container_resources.v4" || pin.ContractVersion != "4.0.0" ||
		pin.ArtifactSHA256 != "0137cd99569a48d3ef4061b19b2fda021ed02cf268094b79c29a40f74bce0b92" ||
		len(pin.ArtifactSHA256) != 64 || strings.Trim(pin.ArtifactSHA256, "0123456789abcdef") != "" {
		t.Fatalf("capability pin = %#v", pin)
	}
	if contract.Contract.CapabilityID != "redeven.capability.container_resources" || contract.Contract.CapabilityVersion != "3.0.0" {
		t.Fatalf("capability contract = %#v", contract.Contract)
	}
}

func TestOfficialReleaseTrustAnchorsArePinnedAndIndependent(t *testing.T) {
	first, err := OfficialReleaseTrustAnchorSet()
	if err != nil {
		t.Fatal(err)
	}
	if first.SourceID != "redeven_official" || first.Root.KeyID != "redeven_official_root_2026" ||
		len(first.Root.PublicKey) != ed25519.PublicKeySize {
		t.Fatalf("official release trust anchors = %#v", first)
	}
	first.Root.PublicKey[0] ^= 0xff
	second, err := OfficialReleaseTrustAnchorSet()
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(first.Root.PublicKey, second.Root.PublicKey) {
		t.Fatal("official release trust anchor calls unexpectedly share mutable bytes")
	}
}

func TestOfficialSigningPublicKeyReturnsIndependentBytes(t *testing.T) {
	first, err := OfficialSigningPublicKey()
	if err != nil {
		t.Fatal(err)
	}
	if first.KeyID != "redeven_official_signing_2026" || first.PublisherID != "com.redeven.official" {
		t.Fatalf("official signing key = %#v", first)
	}
	first.PublicKey[0] ^= 0xff
	second, err := OfficialSigningPublicKey()
	if err != nil {
		t.Fatal(err)
	}
	if first.KeyID != second.KeyID || bytes.Equal(first.PublicKey, second.PublicKey) {
		t.Fatal("official signing public key calls unexpectedly share mutable bytes")
	}
}

func TestContainersCapabilityContractReturnsIndependentValues(t *testing.T) {
	first, err := ContainersCapabilityContract()
	if err != nil {
		t.Fatal(err)
	}
	first.Contract.Methods[0].Name = "mutated"
	second, err := ContainersCapabilityContract()
	if err != nil {
		t.Fatal(err)
	}
	if second.Contract.Methods[0].Name == "mutated" {
		t.Fatal("capability contract calls unexpectedly share mutable values")
	}
}
