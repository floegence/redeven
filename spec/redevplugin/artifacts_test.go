package redevpluginartifacts

import (
	"bytes"
	"crypto/ed25519"
	"testing"
)

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
	if first.KeyID != "redeven_official_signing_2026_08" || first.PublisherID != "com.redeven.official" {
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
