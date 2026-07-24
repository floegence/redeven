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
	"io/fs"
	"path"
	"strings"

	"github.com/floegence/redevplugin/pkg/capabilitycontract"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/pluginpkg"
	"github.com/floegence/redevplugin/pkg/releasecontract"
)

const (
	containersCapabilityRoot = "official-containers-capability"
	containersPluginRoot     = "official-containers-plugin"
	containersCatalogRoot    = "catalog-containers-plugin"

	officialSourceID             = "redeven-official"
	officialPublisherID          = "com.redeven.official"
	officialContainersPluginID   = "com.redeven.official.containers"
	officialContainersVersion    = "2.0.0"
	officialChannel              = "stable"
	officialSigningKeyID         = "redeven-official-signing-2026"
	officialReleaseMetadataRef   = "plugins/com.redeven.official/com.redeven.official.containers/2.0.0/release.json"
	officialPackageArtifactRef   = "plugins/com.redeven.official/com.redeven.official.containers/2.0.0/plugin.redevplugin"
	officialReleaseSignatureRef  = "plugins/com.redeven.official/com.redeven.official.containers/2.0.0/release.json.sig"
	officialPackageSignatureRef  = "plugins/com.redeven.official/com.redeven.official.containers/2.0.0/plugin.sigbundle"
	officialRootRef              = "sources/redeven-official/root/current.json"
	officialPolicyPointerRef     = "sources/redeven-official/stable/policy/current.json"
	officialPolicyRef            = "sources/redeven-official/stable/policy/1.json"
	officialRevocationPointerRef = "sources/redeven-official/stable/revocation/current.json"
	officialRevocationRef        = "sources/redeven-official/stable/revocation/1.json"
	officialRootPublicKeyRef     = "sources/redeven-official/root.public.json"
	officialLedgerPublicKeyRef   = "sources/redeven-official/signing-ledger.public.json"
	officialLedgerRoot           = "sources/redeven-official/signing-ledger"
)

// artifactFS contains public signed release artifacts and the unsigned catalog
// package derived from the same verified content. Private signing keys are
// never part of the repository or the product binary.
//
//go:embed redeven-official-v1.public.json official-containers-capability/** official-containers-plugin/** catalog-containers-plugin/**
var artifactFS embed.FS

type signingPublicKey struct {
	SchemaVersion string `json:"schema_version"`
	Algorithm     string `json:"algorithm"`
	KeyID         string `json:"key_id"`
	PublicKey     string `json:"public_key"`
	CreatedAt     string `json:"created_at"`
}

type ReleaseTrustPublicKey struct {
	KeyID     string
	PublicKey ed25519.PublicKey
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
	RevocationMetadata       releasecontract.RevocationV2
	RevocationMetadataBytes  []byte
	ReleaseTrustDocuments    map[string][]byte
	SigningLedgerArtifacts   map[string][]byte
	RootTrustAnchor          ReleaseTrustPublicKey
	SigningLedgerAnchor      ReleaseTrustPublicKey
}

func OfficialSigningPublicKey() (ReleaseTrustPublicKey, error) {
	key, err := readSigningPublicKey("redeven-official-v1.public.json", officialSigningKeyID)
	if err != nil {
		return ReleaseTrustPublicKey{}, err
	}
	return ReleaseTrustPublicKey{KeyID: key.KeyID, PublicKey: append(ed25519.PublicKey(nil), key.PublicKey...)}, nil
}

func CatalogContainersPluginPackage() ([]byte, error) {
	value, err := artifactFS.ReadFile(path.Join(containersCatalogRoot, officialContainersVersion, "plugin.redevplugin"))
	if err != nil {
		return nil, err
	}
	pkg, err := pluginpkg.Read(context.Background(), bytes.NewReader(value), int64(len(value)), pluginpkg.DefaultReadLimits())
	if err != nil {
		return nil, err
	}
	if pkg.PackageSignature != nil || pkg.Manifest.Publisher.PublisherID != officialPublisherID ||
		pkg.Manifest.PluginID() != officialContainersPluginID || pkg.Manifest.Version() != officialContainersVersion {
		return nil, errors.New("catalog Containers package identity is invalid")
	}
	release, err := OfficialContainersPluginRelease()
	if err != nil {
		return nil, err
	}
	if !equalHash(pkg.PackageHash, release.Ref.ExpectedHashes.PackageSHA256) ||
		!equalHash(pkg.ManifestHash, release.Ref.ExpectedHashes.ManifestSHA256) ||
		!equalHash(pkg.EntriesHash, release.Ref.ExpectedHashes.EntriesSHA256) {
		return nil, errors.New("catalog Containers package content is invalid")
	}
	return append([]byte(nil), value...), nil
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

	public, err := readSigningPublicKey("redeven-official-v1.public.json", pin.SignatureKeyID)
	if err != nil {
		return capabilitycontract.Bundle{}, capabilitycontract.TrustedKey{}, err
	}
	return capabilitycontract.Bundle{Pin: pin, Files: files}, capabilitycontract.TrustedKey{
		PublisherID:     pin.PublisherID,
		KeyID:           pin.SignatureKeyID,
		PublicKey:       public.PublicKey,
		PolicyEpoch:     pin.SignaturePolicyEpoch,
		RevocationEpoch: pin.SignatureRevocationEpoch,
	}, nil
}

func OfficialContainersPluginRelease() (ContainersPluginRelease, error) {
	var ref host.PluginReleaseRef
	if err := readStrictJSON(containersPluginRoot+"/release-ref.json", &ref); err != nil {
		return ContainersPluginRelease{}, err
	}
	if ref.SourceID != officialSourceID || ref.Channel != officialChannel || ref.PublisherID != officialPublisherID ||
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
	release, err := releasecontract.DecodeReleaseMetadata(releaseBytes)
	if err != nil {
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

	documents, err := readReleaseTrustDocuments()
	if err != nil {
		return ContainersPluginRelease{}, err
	}
	revocationBytes := documents[officialRevocationRef]
	revocations, err := releasecontract.DecodeRevocation(revocationBytes)
	if err != nil {
		return ContainersPluginRelease{}, err
	}
	if revocations.SchemaVersion != releasecontract.RevocationSchemaVersion || revocations.SourceID != officialSourceID ||
		revocations.Epoch != "1" || revocations.ExpiresAt == "" {
		return ContainersPluginRelease{}, errors.New("official source revocation metadata is invalid")
	}

	public, err := readSigningPublicKey("redeven-official-v1.public.json", officialSigningKeyID)
	if err != nil {
		return ContainersPluginRelease{}, err
	}
	verifier := releasecontract.Ed25519PublicKeyVerifier{public.KeyID: public.PublicKey}
	if len(releaseSignature) != ed25519.SignatureSize || releasecontract.VerifyReleaseMetadata(ref.Channel, release, releaseSignature, verifier) != nil {
		return ContainersPluginRelease{}, errors.New("official Containers release metadata signature is invalid")
	}
	if pkg.PackageSignature == nil || pkg.PackageSignature.KeyID != officialSigningKeyID || pkg.PackageSignature.Signature == "" {
		return ContainersPluginRelease{}, errors.New("official Containers package signature identity is invalid")
	}

	root, err := releasecontract.DecodeRootDelegation(documents[officialRootRef])
	if err != nil {
		return ContainersPluginRelease{}, err
	}
	rootAnchor, err := readSigningPublicKey(path.Join(containersPluginRoot, officialRootPublicKeyRef), root.KeyID)
	if err != nil || releasecontract.VerifyRootDelegation(root, releasecontract.Ed25519PublicKeyVerifier{rootAnchor.KeyID: rootAnchor.PublicKey}) != nil {
		return ContainersPluginRelease{}, errors.New("official release root delegation is invalid")
	}
	ledgerArtifacts, err := readSigningLedgerArtifacts()
	if err != nil {
		return ContainersPluginRelease{}, err
	}
	ledgerAnchor, err := readSigningPublicKey(path.Join(containersPluginRoot, officialLedgerPublicKeyRef), "")
	if err != nil {
		return ContainersPluginRelease{}, err
	}
	if err := verifySigningLedgerCheckpoint(ledgerArtifacts, ledgerAnchor); err != nil {
		return ContainersPluginRelease{}, err
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
		ReleaseTrustDocuments:    documents,
		SigningLedgerArtifacts:   ledgerArtifacts,
		RootTrustAnchor:          rootAnchor,
		SigningLedgerAnchor:      ledgerAnchor,
	}, nil
}

func validateOfficialReleaseMetadata(ref host.PluginReleaseRef, release releasecontract.ReleaseMetadataV5) error {
	if release.SchemaVersion != releasecontract.ReleaseMetadataSchemaVersion || release.SourceID != ref.SourceID ||
		release.ReleaseMetadataRef != ref.ReleaseMetadataRef || release.PublisherID != ref.PublisherID ||
		release.PluginID != ref.PluginID || release.Version != ref.Version {
		return errors.New("official Containers release metadata identity is invalid")
	}
	if release.DistributionRef.Distribution != string(host.PackageDistributionHostArtifactRef) ||
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
	if release.Compatibility.MinReDevPluginVersion != "0.6.5" || release.Compatibility.MinRuntimeVersion != "0.6.5" ||
		release.Compatibility.UIProtocolVersion != "plugin-ui-v5" || len(release.HostRequirements) != 1 ||
		release.HostRequirements[0].HostID != "redeven" || len(release.HostRequirements[0].RequiredCapabilityContracts) != 1 {
		return errors.New("official Containers release compatibility or host requirement is invalid")
	}
	bundle, _, err := ContainersCapabilityBundle()
	if err != nil {
		return err
	}
	required := release.HostRequirements[0].RequiredCapabilityContracts[0]
	if required.CapabilityID != "redeven.capability.container_resources" || required.CapabilityVersion != "1.0.0" ||
		!capabilityPinMatches(required.Contract, bundle.Pin) {
		return errors.New("official Containers release capability requirement is invalid")
	}
	return nil
}

func readPluginReleaseFile(ref string) ([]byte, error) {
	return artifactFS.ReadFile(path.Join(containersPluginRoot, ref))
}

func readSigningPublicKey(name, expectedKeyID string) (ReleaseTrustPublicKey, error) {
	var public signingPublicKey
	if err := readStrictJSON(name, &public); err != nil {
		return ReleaseTrustPublicKey{}, err
	}
	if public.SchemaVersion != "redevplugin.ed25519_signing_key.v1" || public.Algorithm != "ed25519" ||
		(expectedKeyID != "" && public.KeyID != expectedKeyID) {
		return ReleaseTrustPublicKey{}, errors.New("official signing key identity is invalid")
	}
	publicBytes, err := base64.StdEncoding.DecodeString(public.PublicKey)
	if err != nil || len(publicBytes) != ed25519.PublicKeySize {
		return ReleaseTrustPublicKey{}, errors.New("official signing public key is invalid")
	}
	return ReleaseTrustPublicKey{KeyID: public.KeyID, PublicKey: ed25519.PublicKey(publicBytes)}, nil
}

func readReleaseTrustDocuments() (map[string][]byte, error) {
	refs := []string{officialRootRef, officialPolicyPointerRef, officialPolicyRef, officialRevocationPointerRef, officialRevocationRef}
	documents := make(map[string][]byte, len(refs))
	for _, ref := range refs {
		value, err := readPluginReleaseFile(ref)
		if err != nil {
			return nil, err
		}
		documents[ref] = value
	}
	return documents, nil
}

func readSigningLedgerArtifacts() (map[string][]byte, error) {
	root := path.Join(containersPluginRoot, officialLedgerRoot)
	artifacts := map[string][]byte{}
	err := fs.WalkDir(artifactFS, root, func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() {
			return walkErr
		}
		value, err := artifactFS.ReadFile(name)
		if err != nil {
			return err
		}
		artifacts[strings.TrimPrefix(name, containersPluginRoot+"/")] = value
		return nil
	})
	if err != nil || len(artifacts) == 0 {
		return nil, errors.New("official signing ledger artifact set is empty or unreadable")
	}
	return artifacts, nil
}

func verifySigningLedgerCheckpoint(artifacts map[string][]byte, anchor ReleaseTrustPublicKey) error {
	prefix := officialLedgerRoot + "/checkpoints/"
	var checkpointBytes []byte
	for ref, value := range artifacts {
		if strings.HasPrefix(ref, prefix) && strings.HasSuffix(ref, ".json") {
			if checkpointBytes != nil {
				return errors.New("official signing ledger contains multiple checkpoints")
			}
			checkpointBytes = value
		}
	}
	checkpoint, err := releasecontract.DecodeSigningLedgerCheckpoint(checkpointBytes)
	if err != nil || checkpoint.KeyID != anchor.KeyID ||
		releasecontract.VerifySigningLedgerCheckpoint(checkpoint, releasecontract.Ed25519PublicKeyVerifier{anchor.KeyID: anchor.PublicKey}) != nil {
		return errors.New("official signing ledger checkpoint is invalid")
	}
	return nil
}

func capabilityPinMatches(ref releasecontract.HostCapabilityContractRef, pin capabilitycontract.Pin) bool {
	return ref.PublisherID == pin.PublisherID && ref.ContractID == pin.ContractID && ref.ContractVersion == pin.ContractVersion &&
		ref.ArtifactRef == pin.ArtifactRef && ref.ArtifactSHA256 == pin.ArtifactSHA256 && ref.ManifestRef == pin.ManifestRef &&
		ref.ManifestSHA256 == pin.ManifestSHA256 && ref.SignatureRef == pin.SignatureRef && ref.SignatureSHA256 == pin.SignatureSHA256 &&
		ref.SignatureKeyID == pin.SignatureKeyID && ref.SignaturePolicyEpoch == pin.SignaturePolicyEpoch &&
		ref.SignatureRevocationEpoch == pin.SignatureRevocationEpoch && ref.CompatibilityRef == pin.CompatibilityRef &&
		ref.CompatibilitySHA256 == pin.CompatibilitySHA256 && ref.GeneratedClientRef == pin.GeneratedClientRef &&
		ref.GeneratedClientSHA256 == pin.GeneratedClientSHA256 && ref.NoticesRef == pin.NoticesRef && ref.NoticesSHA256 == pin.NoticesSHA256
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
