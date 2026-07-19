package redevpluginartifacts

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

func TestOfficialContainersPluginReleaseIsSignedAndClosed(t *testing.T) {
	release, err := OfficialContainersPluginRelease()
	if err != nil {
		t.Fatalf("OfficialContainersPluginRelease() error = %v", err)
	}
	if release.Ref.SourceID != officialSourceID || release.Ref.PluginID != officialContainersPluginID || release.Ref.Version != officialContainersVersion {
		t.Fatalf("release ref identity = %#v", release.Ref)
	}
	if len(release.ReleaseMetadataSignature) != ed25519.SignatureSize || len(release.RevocationSignature) != ed25519.SignatureSize {
		t.Fatalf("signature sizes = release:%d revocation:%d", len(release.ReleaseMetadataSignature), len(release.RevocationSignature))
	}
	physical := strings.TrimPrefix(release.PackageArtifactSHA256, "sha256:")
	canonical := strings.TrimPrefix(release.Ref.ExpectedHashes.PackageSHA256, "sha256:")
	if physical == canonical {
		t.Fatal("physical package artifact hash unexpectedly aliases canonical package hash")
	}
	if !matchesSHA256(release.PackageBytes, physical) || !matchesSHA256(release.ReleaseMetadataBytes, release.Ref.ReleaseMetadataSHA256) {
		t.Fatal("release artifact hashes do not match their embedded bytes")
	}
	if release.RevocationMetadata.SourceID != officialSourceID || release.RevocationMetadata.HighestSeenEpoch != "1" || len(release.RevocationMetadata.RevokedKeyIDs) != 0 {
		t.Fatalf("revocation metadata = %#v", release.RevocationMetadata)
	}
}

func TestOfficialArtifactsReturnIndependentBytes(t *testing.T) {
	first, err := OfficialContainersPluginRelease()
	if err != nil {
		t.Fatal(err)
	}
	first.PackageBytes[0] ^= 0xff
	first.ReleaseMetadataBytes[0] ^= 0xff
	first.RevocationMetadataBytes[0] ^= 0xff
	second, err := OfficialContainersPluginRelease()
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(first.PackageBytes, second.PackageBytes) || bytes.Equal(first.ReleaseMetadataBytes, second.ReleaseMetadataBytes) || bytes.Equal(first.RevocationMetadataBytes, second.RevocationMetadataBytes) {
		t.Fatal("embedded artifact calls unexpectedly share mutable byte slices")
	}
}

func TestOfficialCapabilityKeyHashUsesRawPublicKey(t *testing.T) {
	_, key, err := ContainersCapabilityBundle()
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(key.PublicKey)
	if got := hex.EncodeToString(sum[:]); got != "bcc77f2c254739a0257e533df1a61ee45df7cede9858f80f2b40d3047c2733b5" {
		t.Fatalf("raw public key sha256 = %s", got)
	}
}
