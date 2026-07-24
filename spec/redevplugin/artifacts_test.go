package redevpluginartifacts

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/floegence/redevplugin/pkg/pluginpkg"
)

func TestOfficialContainersPluginReleaseIsSignedAndClosed(t *testing.T) {
	release, err := OfficialContainersPluginRelease()
	if err != nil {
		t.Fatalf("OfficialContainersPluginRelease() error = %v", err)
	}
	if release.Ref.SourceID != officialSourceID || release.Ref.PluginID != officialContainersPluginID || release.Ref.Version != officialContainersVersion {
		t.Fatalf("release ref identity = %#v", release.Ref)
	}
	if len(release.ReleaseMetadataSignature) != ed25519.SignatureSize {
		t.Fatalf("release signature size = %d", len(release.ReleaseMetadataSignature))
	}
	if release.Ref.Channel != officialChannel || len(release.ReleaseTrustDocuments) != 5 || len(release.SigningLedgerArtifacts) == 0 ||
		len(release.RootTrustAnchor.PublicKey) != ed25519.PublicKeySize || len(release.SigningLedgerAnchor.PublicKey) != ed25519.PublicKeySize {
		t.Fatalf("release trust artifacts are incomplete: %#v", release.Ref)
	}
	physical := strings.TrimPrefix(release.PackageArtifactSHA256, "sha256:")
	canonical := strings.TrimPrefix(release.Ref.ExpectedHashes.PackageSHA256, "sha256:")
	if physical == canonical {
		t.Fatal("physical package artifact hash unexpectedly aliases canonical package hash")
	}
	if !matchesSHA256(release.PackageBytes, physical) || !matchesSHA256(release.ReleaseMetadataBytes, release.Ref.ReleaseMetadataSHA256) {
		t.Fatal("release artifact hashes do not match their embedded bytes")
	}
	if release.RevocationMetadata.SourceID != officialSourceID || release.RevocationMetadata.Epoch != "1" || len(release.RevocationMetadata.RevokedKeyIDs) != 0 {
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
	first.ReleaseTrustDocuments[officialRootRef][0] ^= 0xff
	for ref := range first.SigningLedgerArtifacts {
		first.SigningLedgerArtifacts[ref][0] ^= 0xff
		break
	}
	second, err := OfficialContainersPluginRelease()
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(first.PackageBytes, second.PackageBytes) || bytes.Equal(first.ReleaseMetadataBytes, second.ReleaseMetadataBytes) || bytes.Equal(first.RevocationMetadataBytes, second.RevocationMetadataBytes) {
		t.Fatal("embedded artifact calls unexpectedly share mutable byte slices")
	}
	if bytes.Equal(first.ReleaseTrustDocuments[officialRootRef], second.ReleaseTrustDocuments[officialRootRef]) {
		t.Fatal("release trust document calls unexpectedly share mutable byte slices")
	}
}

func TestOfficialCapabilityKeyHashUsesRawPublicKey(t *testing.T) {
	_, key, err := ContainersCapabilityBundle()
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(key.PublicKey)
	if got := hex.EncodeToString(sum[:]); got != "1077debbcad6eb5a03652f11aa01c35e13663151021d418cb46aa9a74986391c" {
		t.Fatalf("raw public key sha256 = %s", got)
	}
}

func TestCatalogContainersPluginPackageIsUnsignedReleaseContent(t *testing.T) {
	catalogPackage, err := CatalogContainersPluginPackage()
	if err != nil {
		t.Fatal(err)
	}
	release, err := OfficialContainersPluginRelease()
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := pluginpkg.Read(context.Background(), bytes.NewReader(catalogPackage), int64(len(catalogPackage)), pluginpkg.DefaultReadLimits())
	if err != nil {
		t.Fatal(err)
	}
	if pkg.PackageSignature != nil {
		t.Fatal("catalog package unexpectedly contains release signature evidence")
	}
	if pkg.PackageHash != release.Ref.ExpectedHashes.PackageSHA256 ||
		pkg.ManifestHash != release.Ref.ExpectedHashes.ManifestSHA256 ||
		pkg.EntriesHash != release.Ref.ExpectedHashes.EntriesSHA256 {
		t.Fatalf("catalog package hashes = %q %q %q", pkg.PackageHash, pkg.ManifestHash, pkg.EntriesHash)
	}
}

func TestOfficialSigningPublicKeyReturnsIndependentBytes(t *testing.T) {
	first, err := OfficialSigningPublicKey()
	if err != nil {
		t.Fatal(err)
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
