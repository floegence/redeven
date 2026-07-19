package redevpluginintegration

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"time"

	redevpluginartifacts "github.com/floegence/redeven/spec/redevplugin"
	"github.com/floegence/redevplugin/pkg/capabilitycontract"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/pluginpkg"
)

const (
	officialReleaseSourceID       = "redeven-official"
	officialHostID                = "redeven"
	officialContainersVersion     = "2.0.0"
	officialSourcePolicyEpoch     = "1"
	officialSourceRevocationEpoch = "1"
	officialSigningKeyValidFrom   = "2026-07-19T00:00:00Z"
)

var errCapabilityArtifactProvenanceUnavailable = errors.New("embedded capability artifact provenance is unavailable")

type officialReleaseProvider struct {
	release         redevpluginartifacts.ContainersPluginRelease
	capabilityPin   capabilitycontract.Pin
	publicKey       ed25519.PublicKey
	publicKeySHA256 string
}

func newOfficialReleaseModule(verifier strictPackageTrustVerifier) (*host.ReleaseModule, host.PluginReleaseRef, error) {
	provider, err := newOfficialReleaseProvider()
	if err != nil {
		return nil, host.PluginReleaseRef{}, err
	}
	return &host.ReleaseModule{
		ReleaseMetadataVerifier:     verifier,
		RevocationVerifier:          verifier,
		ReleaseSourcePolicy:         provider,
		ReleaseArtifactResolver:     provider,
		HostRequirements:            provider,
		CapabilityContractArtifacts: provider,
		CapabilityContractKeys:      provider,
	}, provider.release.Ref, nil
}

func newOfficialReleaseProvider() (*officialReleaseProvider, error) {
	release, err := redevpluginartifacts.OfficialContainersPluginRelease()
	if err != nil {
		return nil, fmt.Errorf("load official Containers release: %w", err)
	}
	bundle, trustedKey, err := redevpluginartifacts.ContainersCapabilityBundle()
	if err != nil {
		return nil, fmt.Errorf("load official Containers capability: %w", err)
	}
	if trustedKey.KeyID != officialSigningKeyID || len(trustedKey.PublicKey) != ed25519.PublicKeySize {
		return nil, errors.New("official release capability signing key is invalid")
	}
	keyHash := sha256.Sum256(trustedKey.PublicKey)
	return &officialReleaseProvider{
		release:         release,
		capabilityPin:   bundle.Pin,
		publicKey:       append(ed25519.PublicKey(nil), trustedKey.PublicKey...),
		publicKeySHA256: hex.EncodeToString(keyHash[:]),
	}, nil
}

func (p *officialReleaseProvider) ResolveReleaseSourcePolicy(ctx context.Context, req host.ReleaseSourcePolicyRequest) (host.SourcePolicySnapshot, error) {
	if err := ctx.Err(); err != nil {
		return host.SourcePolicySnapshot{}, err
	}
	if p == nil || req.ReleaseRef != p.release.Ref || (req.Action != host.PackageTrustActionInstall && req.Action != host.PackageTrustActionUpdate) {
		return host.SourcePolicySnapshot{}, officialReleaseVerificationError("release source is not declared")
	}
	now := req.Now.UTC()
	if now.IsZero() {
		now = time.Now().UTC()
	}
	return p.sourcePolicy(now), nil
}

func (p *officialReleaseProvider) ResolveReleaseArtifact(ctx context.Context, req host.ReleaseArtifactResolveRequest) (host.ResolvedPackageArtifact, error) {
	if err := ctx.Err(); err != nil {
		return host.ResolvedPackageArtifact{}, err
	}
	if p == nil || req.ReleaseRef != p.release.Ref || (req.Action != host.PackageTrustActionInstall && req.Action != host.PackageTrustActionUpdate) {
		return host.ResolvedPackageArtifact{}, officialReleaseVerificationError("release artifact is not declared")
	}
	if err := p.validateSourcePolicy(req.SourcePolicySnapshot); err != nil {
		return host.ResolvedPackageArtifact{}, err
	}
	packageBytes := append([]byte(nil), p.release.PackageBytes...)
	return host.ResolvedPackageArtifact{
		ReleaseMetadataBytes:     append([]byte(nil), p.release.ReleaseMetadataBytes...),
		ReleaseMetadataSignature: append([]byte(nil), p.release.ReleaseMetadataSignature...),
		Reader:                   bytes.NewReader(packageBytes),
		Size:                     int64(len(packageBytes)),
		ArtifactSHA256:           p.release.PackageArtifactSHA256,
	}, nil
}

func (p *officialReleaseProvider) SelectHostRequirement(ctx context.Context, req host.HostRequirementSelectionRequest) (host.HostRequirementSelection, error) {
	if err := ctx.Err(); err != nil {
		return host.HostRequirementSelection{}, err
	}
	if p == nil || req.SourceID != officialReleaseSourceID || req.PublisherID != officialPublisherID ||
		req.PluginID != officialContainersPluginID || req.PluginVersion != officialContainersVersion || len(req.Requirements) != 1 {
		return host.HostRequirementSelection{}, officialReleaseVerificationError("host requirement is not declared")
	}
	requirement := req.Requirements[0]
	if requirement.HostID != officialHostID || requirement.MinHostVersion != "" || len(requirement.RequiredCapabilityContracts) != 1 {
		return host.HostRequirementSelection{}, officialReleaseVerificationError("host requirement is invalid")
	}
	required := requirement.RequiredCapabilityContracts[0]
	if required.CapabilityID != containersCapabilityID || required.CapabilityVersion != containersCapabilityVersion || required.Contract != p.capabilityPin {
		return host.HostRequirementSelection{}, officialReleaseVerificationError("host capability requirement is invalid")
	}
	return host.HostRequirementSelection{HostID: officialHostID}, nil
}

func (p *officialReleaseProvider) ResolveCapabilityContract(ctx context.Context, req host.CapabilityContractResolveRequest) (host.ResolvedCapabilityContractArtifact, error) {
	if err := ctx.Err(); err != nil {
		return host.ResolvedCapabilityContractArtifact{}, err
	}
	if p == nil || req.SourceID != officialReleaseSourceID || req.PluginPublisherID != officialPublisherID || req.Pin != p.capabilityPin {
		return host.ResolvedCapabilityContractArtifact{}, officialReleaseVerificationError("capability contract is not declared")
	}
	if err := p.validateSourcePolicy(req.SourcePolicySnapshot); err != nil {
		return host.ResolvedCapabilityContractArtifact{}, err
	}
	// ReDevPlugin v0.5.1 requires network fetch provenance even for an
	// embed.FS-backed artifact set. Redeven pre-registers the exact verified
	// contract during startup, so this path must never be needed. Fail closed
	// instead of fabricating a URL or resolved IP.
	return host.ResolvedCapabilityContractArtifact{}, fmt.Errorf("%w: %w", host.ErrReleaseRefVerificationFailed, errCapabilityArtifactProvenanceUnavailable)
}

func (p *officialReleaseProvider) ResolveCapabilityContractKey(ctx context.Context, req host.CapabilityContractKeyRequest) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if p == nil || req.SourceID != officialReleaseSourceID || req.PublisherID != officialPublisherID || req.KeyID != officialSigningKeyID {
		return nil, officialReleaseVerificationError("capability signing key is not declared")
	}
	if err := p.validateSourcePolicy(req.SourcePolicySnapshot); err != nil {
		return nil, err
	}
	return append([]byte(nil), p.publicKey...), nil
}

func (p *officialReleaseProvider) sourcePolicy(now time.Time) host.SourcePolicySnapshot {
	revocations := p.release.RevocationMetadata
	return host.SourcePolicySnapshot{
		SchemaVersion:     "redevplugin.source_policy.v1",
		SourceID:          officialReleaseSourceID,
		SourceType:        host.PackageSourceHostArtifact,
		SourceClass:       host.PackageSourceClassOfficial,
		AllowedPublishers: []string{officialPublisherID},
		TrustedKeyIDs:     []string{officialSigningKeyID},
		TrustedKeys: []host.SourcePolicyTrustedKey{{
			Algorithm:                   pluginpkg.PackageSignatureAlgorithmEd25519,
			KeyID:                       officialSigningKeyID,
			PublicKeySHA256:             p.publicKeySHA256,
			Usage:                       []string{"release_metadata", "package_signature", "revocation_metadata", "host_capability_contract"},
			AllowedCapabilityPublishers: []string{officialPublisherID},
			ValidFrom:                   officialSigningKeyValidFrom,
			ValidUntil:                  revocations.ExpiresAt,
			RevocationEpoch:             officialSourceRevocationEpoch,
		}},
		RevocationEvidence: &host.SourcePolicyRevocationEvidence{
			MetadataRef:      "sources/redeven-official/revocations.json",
			MetadataSHA256:   sha256Hex(p.release.RevocationMetadataBytes),
			SignatureRef:     "sources/redeven-official/revocations.json.sig",
			SignatureKeyID:   officialSigningKeyID,
			VerifiedAt:       now.Format(time.RFC3339),
			ExpiresAt:        revocations.ExpiresAt,
			HighestSeenEpoch: revocations.HighestSeenEpoch,
			MetadataBytes:    append([]byte(nil), p.release.RevocationMetadataBytes...),
			SignatureBytes:   append([]byte(nil), p.release.RevocationSignature...),
		},
		RequireSignature: true,
		InstallPolicy:    host.PackageInstallAllow,
		UnsignedPolicy:   host.PackageUnsignedBlock,
		DowngradePolicy:  host.PackageDowngradeBlock,
		PolicyEpoch:      officialSourcePolicyEpoch,
		KeyRotationEpoch: officialSourcePolicyEpoch,
		RevocationEpoch:  officialSourceRevocationEpoch,
		AssessedAt:       now.Format(time.RFC3339),
	}
}

func (p *officialReleaseProvider) validateSourcePolicy(snapshot host.SourcePolicySnapshot) error {
	if p == nil || snapshot.SchemaVersion != "redevplugin.source_policy.v1" || snapshot.SourceID != officialReleaseSourceID ||
		snapshot.SourceType != host.PackageSourceHostArtifact || snapshot.SourceClass != host.PackageSourceClassOfficial ||
		!slices.Equal(snapshot.AllowedPublishers, []string{officialPublisherID}) || len(snapshot.AllowedArtifactHosts) != 0 ||
		!slices.Equal(snapshot.TrustedKeyIDs, []string{officialSigningKeyID}) || len(snapshot.TrustedKeys) != 1 ||
		!snapshot.RequireSignature || snapshot.InstallPolicy != host.PackageInstallAllow || snapshot.UnsignedPolicy != host.PackageUnsignedBlock ||
		snapshot.DowngradePolicy != host.PackageDowngradeBlock || snapshot.PolicyEpoch != officialSourcePolicyEpoch ||
		snapshot.KeyRotationEpoch != officialSourcePolicyEpoch || snapshot.RevocationEpoch != officialSourceRevocationEpoch {
		return officialReleaseVerificationError("source policy does not match the official release")
	}
	key := snapshot.TrustedKeys[0]
	if key.Algorithm != pluginpkg.PackageSignatureAlgorithmEd25519 || key.KeyID != officialSigningKeyID || key.PublicKeySHA256 != p.publicKeySHA256 ||
		!slices.Equal(key.Usage, []string{"release_metadata", "package_signature", "revocation_metadata", "host_capability_contract"}) ||
		!slices.Equal(key.AllowedCapabilityPublishers, []string{officialPublisherID}) || key.ValidFrom != officialSigningKeyValidFrom ||
		key.ValidUntil != p.release.RevocationMetadata.ExpiresAt || key.RevocationEpoch != officialSourceRevocationEpoch {
		return officialReleaseVerificationError("source signing key policy does not match the official release")
	}
	evidence := snapshot.RevocationEvidence
	if evidence == nil || evidence.MetadataRef != "sources/redeven-official/revocations.json" ||
		evidence.MetadataSHA256 != sha256Hex(p.release.RevocationMetadataBytes) || evidence.SignatureRef != "sources/redeven-official/revocations.json.sig" ||
		evidence.SignatureKeyID != officialSigningKeyID || evidence.ExpiresAt != p.release.RevocationMetadata.ExpiresAt ||
		evidence.HighestSeenEpoch != officialSourceRevocationEpoch || !bytes.Equal(evidence.MetadataBytes, p.release.RevocationMetadataBytes) ||
		!bytes.Equal(evidence.SignatureBytes, p.release.RevocationSignature) {
		return officialReleaseVerificationError("source revocation policy does not match the official release")
	}
	return nil
}

func officialReleaseVerificationError(reason string) error {
	return fmt.Errorf("%w: %s", host.ErrReleaseRefVerificationFailed, reason)
}

func sha256Hex(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:])
}
