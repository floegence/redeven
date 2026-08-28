package redevpluginartifacts

import (
	"bytes"
	"testing"
)

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
