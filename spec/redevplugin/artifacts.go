package redevpluginartifacts

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"path"
	"strings"

	"github.com/floegence/redevplugin/pkg/capabilitycontract"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/pluginpkg"
)

const (
	containersCapabilityRoot = "official-containers-capability"
	containersPluginRoot     = "official-containers-plugin"

	officialSourceID            = "redeven-official"
	officialPublisherID         = "com.redeven.official"
	officialContainersPluginID  = "com.redeven.official.containers"
	officialContainersVersion   = "2.0.0"
	officialSigningKeyID        = "redeven-official-v1"
	officialReleaseMetadataRef  = "plugins/com.redeven.official/com.redeven.official.containers/2.0.0/release.json"
	officialPackageArtifactRef  = "plugins/com.redeven.official/com.redeven.official.containers/2.0.0/plugin.redevplugin"
	officialReleaseSignatureRef = "plugins/com.redeven.official/com.redeven.official.containers/2.0.0/release.json.sig"
	officialPackageSignatureRef = "plugins/com.redeven.official/com.redeven.official.containers/2.0.0/plugin.sigbundle"
	officialRevocationsRef      = "sources/redeven-official/revocations.json"
	officialRevocationsSigRef   = "sources/redeven-official/revocations.json.sig"
)

// artifactFS contains only public, signed ReDevPlugin artifacts. Private
// signing keys are never part of the repository or the product binary.
//
//go:embed redeven-official-v1.public.json official-containers-capability/** official-containers-plugin/**
var artifactFS embed.FS

type signingPublicKey struct {
	SchemaVersion string `json:"schema_version"`
	Algorithm     string `json:"algorithm"`
	KeyID         string `json:"key_id"`
	PublicKey     string `json:"public_key"`
	CreatedAt     string `json:"created_at"`
}

type signedReleaseMetadata struct {
	SchemaVersion            string                        `json:"schema_version"`
	SourceID                 string                        `json:"source_id"`
	ReleaseMetadataRef       string                        `json:"release_metadata_ref"`
	PublisherID              string                        `json:"publisher_id"`
	PluginID                 string                        `json:"plugin_id"`
	Version                  string                        `json:"version"`
	DistributionRef          host.PackageDistributionRef   `json:"distribution_ref"`
	Hashes                   host.PackageHashSet           `json:"hashes"`
	ReleaseMetadataSignature host.ReleaseMetadataSignature `json:"release_metadata_signature"`
	PackageSignature         host.PackageReleaseSignature  `json:"package_signature"`
	Compatibility            host.ReleaseCompatibility     `json:"compatibility"`
	HostRequirements         []host.HostRequirement        `json:"host_requirements"`
	ReleaseEvidence          host.ReleaseEvidence          `json:"release_evidence"`
}

// ContainersPluginRelease is the immutable, closed official release set that
// Redeven makes available to ReDevPlugin's release module. All byte slices are
// freshly materialized from the embedded filesystem for each call.
type ContainersPluginRelease struct {
	Ref                      host.PluginReleaseRef
	PackageBytes             []byte
	PackageArtifactSHA256    string
	ReleaseMetadataBytes     []byte
	ReleaseMetadataSignature []byte
	RevocationMetadata       host.SourceRevocationMetadata
	RevocationMetadataBytes  []byte
	RevocationSignature      []byte
}

func ContainersCapabilityBundle() (capabilitycontract.Bundle, capabilitycontract.TrustedKey, error) {
	var pin capabilitycontract.Pin
	if err := readStrictJSON(containersCapabilityRoot+"/host-capability.pin.json", &pin); err != nil {
		return capabilitycontract.Bundle{}, capabilitycontract.TrustedKey{}, err
	}
	if err := capabilitycontract.ValidatePin(pin); err != nil {
		return capabilitycontract.Bundle{}, capabilitycontract.TrustedKey{}, err
	}
	refs := []string{
		pin.ArtifactRef,
		pin.ManifestRef,
		pin.SignatureRef,
		pin.CompatibilityRef,
		pin.GeneratedClientRef,
		pin.NoticesRef,
	}
	files := make(map[string][]byte, len(refs))
	for _, ref := range refs {
		content, err := artifactFS.ReadFile(path.Join(containersCapabilityRoot, ref))
		if err != nil {
			return capabilitycontract.Bundle{}, capabilitycontract.TrustedKey{}, err
		}
		files[ref] = content
	}

	publicBytes, err := officialPublicKey(pin.SignatureKeyID)
	if err != nil {
		return capabilitycontract.Bundle{}, capabilitycontract.TrustedKey{}, err
	}
	return capabilitycontract.Bundle{Pin: pin, Files: files}, capabilitycontract.TrustedKey{
		PublisherID:     pin.PublisherID,
		KeyID:           pin.SignatureKeyID,
		PublicKey:       publicBytes,
		PolicyEpoch:     pin.SignaturePolicyEpoch,
		RevocationEpoch: pin.SignatureRevocationEpoch,
	}, nil
}

func OfficialContainersPluginRelease() (ContainersPluginRelease, error) {
	var ref host.PluginReleaseRef
	if err := readStrictJSON(containersPluginRoot+"/release-ref.json", &ref); err != nil {
		return ContainersPluginRelease{}, err
	}
	if ref.SourceID != officialSourceID || ref.PublisherID != officialPublisherID ||
		ref.PluginID != officialContainersPluginID || ref.Version != officialContainersVersion ||
		ref.ReleaseMetadataRef != officialReleaseMetadataRef {
		return ContainersPluginRelease{}, errors.New("official Containers release ref identity is invalid")
	}

	packageBytes, err := readPluginReleaseFile(officialPackageArtifactRef)
	if err != nil {
		return ContainersPluginRelease{}, err
	}
	releaseBytes, err := readPluginReleaseFile(officialReleaseMetadataRef)
	if err != nil {
		return ContainersPluginRelease{}, err
	}
	releaseSignature, err := readPluginReleaseFile(officialReleaseSignatureRef)
	if err != nil {
		return ContainersPluginRelease{}, err
	}
	packageSignatureBundle, err := readPluginReleaseFile(officialPackageSignatureRef)
	if err != nil {
		return ContainersPluginRelease{}, err
	}
	revocationBytes, err := readPluginReleaseFile(officialRevocationsRef)
	if err != nil {
		return ContainersPluginRelease{}, err
	}
	revocationSignature, err := readPluginReleaseFile(officialRevocationsSigRef)
	if err != nil {
		return ContainersPluginRelease{}, err
	}

	var release signedReleaseMetadata
	if err := decodeStrictJSON(releaseBytes, &release); err != nil {
		return ContainersPluginRelease{}, err
	}
	if err := validateOfficialReleaseMetadata(ref, release); err != nil {
		return ContainersPluginRelease{}, err
	}
	if !matchesSHA256(releaseBytes, ref.ReleaseMetadataSHA256) {
		return ContainersPluginRelease{}, errors.New("official Containers release metadata hash is invalid")
	}

	pkg, err := pluginpkg.Read(context.Background(), bytes.NewReader(packageBytes), int64(len(packageBytes)), pluginpkg.DefaultReadLimits())
	if err != nil {
		return ContainersPluginRelease{}, err
	}
	if pkg.Manifest.Publisher.PublisherID != ref.PublisherID || pkg.Manifest.PluginID() != ref.PluginID || pkg.Manifest.Version() != ref.Version ||
		!equalHash(pkg.PackageHash, ref.ExpectedHashes.PackageSHA256) ||
		!equalHash(pkg.ManifestHash, ref.ExpectedHashes.ManifestSHA256) ||
		!equalHash(pkg.EntriesHash, ref.ExpectedHashes.EntriesSHA256) {
		return ContainersPluginRelease{}, errors.New("official Containers package identity or hashes are invalid")
	}
	packageSignature, ok := pkg.SignatureFiles[pluginpkg.PackageSignaturePath]
	if !ok || !bytes.Equal(packageSignature, packageSignatureBundle) {
		return ContainersPluginRelease{}, errors.New("official Containers package signature bundle is invalid")
	}

	var revocations host.SourceRevocationMetadata
	if err := decodeStrictJSON(revocationBytes, &revocations); err != nil {
		return ContainersPluginRelease{}, err
	}
	if revocations.SchemaVersion != "redevplugin.source_revocations.v1" || revocations.SourceID != officialSourceID ||
		revocations.HighestSeenEpoch != "1" || revocations.ExpiresAt == "" {
		return ContainersPluginRelease{}, errors.New("official source revocation metadata is invalid")
	}

	publicKey, err := officialPublicKey(officialSigningKeyID)
	if err != nil {
		return ContainersPluginRelease{}, err
	}
	if len(releaseSignature) != ed25519.SignatureSize || !ed25519.Verify(publicKey, releaseBytes, releaseSignature) {
		return ContainersPluginRelease{}, errors.New("official Containers release metadata signature is invalid")
	}
	if len(revocationSignature) != ed25519.SignatureSize || !ed25519.Verify(publicKey, revocationBytes, revocationSignature) {
		return ContainersPluginRelease{}, errors.New("official source revocation signature is invalid")
	}

	artifactSum := sha256.Sum256(packageBytes)
	return ContainersPluginRelease{
		Ref:                      ref,
		PackageBytes:             packageBytes,
		PackageArtifactSHA256:    hex.EncodeToString(artifactSum[:]),
		ReleaseMetadataBytes:     releaseBytes,
		ReleaseMetadataSignature: releaseSignature,
		RevocationMetadata:       revocations,
		RevocationMetadataBytes:  revocationBytes,
		RevocationSignature:      revocationSignature,
	}, nil
}

func validateOfficialReleaseMetadata(ref host.PluginReleaseRef, release signedReleaseMetadata) error {
	if release.SchemaVersion != "redevplugin.release_metadata.v5" || release.SourceID != ref.SourceID ||
		release.ReleaseMetadataRef != ref.ReleaseMetadataRef || release.PublisherID != ref.PublisherID ||
		release.PluginID != ref.PluginID || release.Version != ref.Version {
		return errors.New("official Containers release metadata identity is invalid")
	}
	if release.DistributionRef.Distribution != host.PackageDistributionHostArtifactRef ||
		release.DistributionRef.ArtifactRef != officialPackageArtifactRef ||
		!equalHash(release.Hashes.PackageSHA256, ref.ExpectedHashes.PackageSHA256) ||
		!equalHash(release.Hashes.ManifestSHA256, ref.ExpectedHashes.ManifestSHA256) ||
		!equalHash(release.Hashes.EntriesSHA256, ref.ExpectedHashes.EntriesSHA256) {
		return errors.New("official Containers release distribution or hashes are invalid")
	}
	if release.ReleaseMetadataSignature.Algorithm != "ed25519" || release.ReleaseMetadataSignature.KeyID != officialSigningKeyID ||
		release.ReleaseMetadataSignature.SignatureRef != officialReleaseSignatureRef ||
		release.ReleaseMetadataSignature.SourcePolicyEpoch != "1" || release.ReleaseMetadataSignature.RevocationEpoch != "1" {
		return errors.New("official Containers release signature metadata is invalid")
	}
	if release.PackageSignature.Algorithm != "ed25519" || release.PackageSignature.KeyID != officialSigningKeyID ||
		release.PackageSignature.SignatureBundleRef != officialPackageSignatureRef ||
		release.PackageSignature.SourcePolicyEpoch != "1" || release.PackageSignature.RevocationEpoch != "1" {
		return errors.New("official Containers package signature metadata is invalid")
	}
	if release.Compatibility.MinReDevPluginVersion != "0.5.1" || release.Compatibility.MinRuntimeVersion != "0.5.1" ||
		release.Compatibility.UIProtocolVersion != "plugin-ui-v5" || len(release.HostRequirements) != 1 ||
		release.HostRequirements[0].HostID != "redeven" || len(release.HostRequirements[0].RequiredCapabilityContracts) != 1 {
		return errors.New("official Containers release compatibility or host requirement is invalid")
	}
	bundle, _, err := ContainersCapabilityBundle()
	if err != nil {
		return err
	}
	required := release.HostRequirements[0].RequiredCapabilityContracts[0]
	if required.CapabilityID != "redeven.capability.container_resources" || required.CapabilityVersion != "1.0.0" || required.Contract != bundle.Pin {
		return errors.New("official Containers release capability requirement is invalid")
	}
	return nil
}

func readPluginReleaseFile(ref string) ([]byte, error) {
	return artifactFS.ReadFile(path.Join(containersPluginRoot, ref))
}

func officialPublicKey(expectedKeyID string) (ed25519.PublicKey, error) {
	var public signingPublicKey
	if err := readStrictJSON("redeven-official-v1.public.json", &public); err != nil {
		return nil, err
	}
	if public.SchemaVersion != "redevplugin.ed25519_signing_key.v1" || public.Algorithm != "ed25519" || public.KeyID != expectedKeyID {
		return nil, errors.New("official signing key identity is invalid")
	}
	publicBytes, err := base64.StdEncoding.DecodeString(public.PublicKey)
	if err != nil || len(publicBytes) != ed25519.PublicKeySize {
		return nil, errors.New("official signing public key is invalid")
	}
	return ed25519.PublicKey(publicBytes), nil
}

func matchesSHA256(content []byte, expected string) bool {
	sum := sha256.Sum256(content)
	return strings.TrimPrefix(strings.ToLower(strings.TrimSpace(expected)), "sha256:") == hex.EncodeToString(sum[:])
}

func equalHash(left string, right string) bool {
	return strings.TrimPrefix(strings.ToLower(strings.TrimSpace(left)), "sha256:") ==
		strings.TrimPrefix(strings.ToLower(strings.TrimSpace(right)), "sha256:")
}

func readStrictJSON(name string, dst any) error {
	raw, err := artifactFS.ReadFile(name)
	if err != nil {
		return err
	}
	return decodeStrictJSON(raw, dst)
}

func decodeStrictJSON(raw []byte, dst any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("artifact JSON contains a trailing value")
		}
		return err
	}
	return nil
}
