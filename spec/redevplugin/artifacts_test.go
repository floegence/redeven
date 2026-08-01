package redevpluginartifacts

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestContainersCapabilityBundlePinsV4Artifacts(t *testing.T) {
	bundle, key, err := ContainersCapabilityBundle()
	if err != nil {
		t.Fatal(err)
	}
	pin := bundle.Pin
	if pin.PublisherID != "com.redeven.official" ||
		pin.ContractID != "redeven.container_resources.v4" || pin.ContractVersion != "4.0.0" ||
		pin.ArtifactSHA256 != "0137cd99569a48d3ef4061b19b2fda021ed02cf268094b79c29a40f74bce0b92" ||
		pin.ManifestSHA256 != "a7892eadf3e7e3e1015d8fa9aab5bbefedc362bb1f99444b4230ce8093644c8d" ||
		pin.SignatureSHA256 != "70d5af3516533ed77ceb5d91b79feb96468af72601732ec8f1c44b42d1391da8" {
		t.Fatalf("capability pin = %#v", pin)
	}
	if len(bundle.Files) != 6 || len(key.PublicKey) != ed25519.PublicKeySize ||
		key.PublisherID != pin.PublisherID || key.KeyID != pin.SignatureKeyID {
		t.Fatalf("capability bundle or key is incomplete: files=%d key=%#v", len(bundle.Files), key)
	}
	for ref, expected := range map[string]string{
		pin.ArtifactRef:        pin.ArtifactSHA256,
		pin.ManifestRef:        pin.ManifestSHA256,
		pin.SignatureRef:       pin.SignatureSHA256,
		pin.CompatibilityRef:   pin.CompatibilitySHA256,
		pin.GeneratedClientRef: pin.GeneratedClientSHA256,
		pin.NoticesRef:         pin.NoticesSHA256,
	} {
		sum := sha256.Sum256(bundle.Files[ref])
		if got := hex.EncodeToString(sum[:]); got != expected {
			t.Fatalf("%s sha256 = %s, want %s", ref, got, expected)
		}
	}
}

func TestOfficialReleaseTrustAnchorsArePinnedAndIndependent(t *testing.T) {
	first, err := OfficialReleaseTrustAnchorSet()
	if err != nil {
		t.Fatal(err)
	}
	if first.SourceID != "redeven_official" || first.Root.KeyID != "redeven_official_root_2026" ||
		first.SigningLedgerLog != "redeven_official_signing_log" || first.SigningLedger.KeyID != "redeven_official_ledger_2026" ||
		len(first.Root.PublicKey) != ed25519.PublicKeySize || len(first.SigningLedger.PublicKey) != ed25519.PublicKeySize {
		t.Fatalf("official release trust anchors = %#v", first)
	}
	first.Root.PublicKey[0] ^= 0xff
	first.SigningLedger.PublicKey[0] ^= 0xff
	second, err := OfficialReleaseTrustAnchorSet()
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(first.Root.PublicKey, second.Root.PublicKey) || bytes.Equal(first.SigningLedger.PublicKey, second.SigningLedger.PublicKey) {
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

func TestContainersCapabilityBundleReturnsIndependentBytes(t *testing.T) {
	first, firstKey, err := ContainersCapabilityBundle()
	if err != nil {
		t.Fatal(err)
	}
	first.Files[first.Pin.ArtifactRef][0] ^= 0xff
	firstKey.PublicKey[0] ^= 0xff
	second, secondKey, err := ContainersCapabilityBundle()
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(first.Files[first.Pin.ArtifactRef], second.Files[second.Pin.ArtifactRef]) ||
		bytes.Equal(firstKey.PublicKey, secondKey.PublicKey) {
		t.Fatal("capability bundle calls unexpectedly share mutable bytes")
	}
}
