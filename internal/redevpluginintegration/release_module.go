package redevpluginintegration

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"slices"
	"strings"
	"time"

	redevpluginartifacts "github.com/floegence/redeven/spec/redevplugin"
	"github.com/floegence/redevplugin/pkg/capabilitycontract"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/releasecontract"
	"github.com/floegence/redevplugin/pkg/releasetrust"
)

const (
	officialReleaseSourceID   = "redeven-official"
	officialReleaseChannel    = "stable"
	officialHostID            = "redeven"
	officialContainersVersion = "2.0.0"
)

type officialReleaseProvider struct {
	release       redevpluginartifacts.ContainersPluginRelease
	capability    capabilitycontract.Bundle
	sourcePolicy  releasecontract.SourcePolicyV2
	artifactFiles map[string][]byte
}

func newOfficialReleaseModule(stateDir string) (*host.ReleaseModule, host.PluginReleaseRef, func() error, error) {
	return newOfficialReleaseModuleWithClock(stateDir, time.Now)
}

func newOfficialReleaseModuleWithClock(stateDir string, now func() time.Time) (*host.ReleaseModule, host.PluginReleaseRef, func() error, error) {
	provider, err := newOfficialReleaseProvider()
	if err != nil {
		return nil, host.PluginReleaseRef{}, nil, err
	}
	trust, store, err := newOfficialReleaseTrust(stateDir, provider.release, now)
	if err != nil {
		return nil, host.PluginReleaseRef{}, nil, err
	}
	return &host.ReleaseModule{
		Trust:                       trust,
		ReleaseArtifactResolver:     provider,
		HostRequirements:            provider,
		CapabilityContractArtifacts: provider,
	}, provider.release.Ref, store.Close, nil
}

func newOfficialReleaseProvider() (*officialReleaseProvider, error) {
	release, err := redevpluginartifacts.OfficialContainersPluginRelease()
	if err != nil {
		return nil, fmt.Errorf("load official Containers release: %w", err)
	}
	bundle, _, err := redevpluginartifacts.ContainersCapabilityBundle()
	if err != nil {
		return nil, fmt.Errorf("load official Containers capability: %w", err)
	}
	policyBytes := release.ReleaseTrustDocuments["sources/redeven-official/stable/policy/1.json"]
	policy, err := releasecontract.DecodeSourcePolicy(policyBytes)
	if err != nil {
		return nil, fmt.Errorf("load official release source policy: %w", err)
	}
	files := make(map[string][]byte, len(bundle.Files))
	for ref, value := range bundle.Files {
		files[ref] = slices.Clone(value)
	}
	return &officialReleaseProvider{release: release, capability: bundle, sourcePolicy: policy, artifactFiles: files}, nil
}

func newOfficialReleaseTrust(stateDir string, release redevpluginartifacts.ContainersPluginRelease, now func() time.Time) (*releasetrust.ServiceSet, *releaseTrustStore, error) {
	configuration, err := releasetrust.NewSourceConfiguration(officialReleaseSourceID, []string{officialReleaseChannel})
	if err != nil {
		return nil, nil, err
	}
	rootAnchor, err := releasetrust.NewEd25519TrustAnchor(release.RootTrustAnchor.KeyID, release.RootTrustAnchor.PublicKey)
	if err != nil {
		return nil, nil, err
	}
	store, err := openReleaseTrustStore(filepath.Join(stateDir, "release-trust.sqlite"))
	if err != nil {
		return nil, nil, err
	}
	closeOnError := func(err error) (*releasetrust.ServiceSet, *releaseTrustStore, error) {
		_ = store.Close()
		return nil, nil, err
	}
	trustedTime, err := newLocalTrustedTimeAdapter(store, filepath.Join(stateDir, "trusted-time"), now)
	if err != nil {
		return closeOnError(err)
	}
	timeAnchor, err := releasetrust.NewEd25519TrustAnchor(localTrustedTimeKeyID, trustedTime.PublicKey())
	if err != nil {
		return closeOnError(err)
	}
	timeRoot, err := releasetrust.NewTransparencyRoot(localTrustedTimeLogID, timeAnchor)
	if err != nil {
		return closeOnError(err)
	}
	ledgerLogID, err := signingLedgerLogID(release.SigningLedgerArtifacts, release.SigningLedgerAnchor.KeyID)
	if err != nil {
		return closeOnError(err)
	}
	ledgerAnchor, err := releasetrust.NewEd25519TrustAnchor(release.SigningLedgerAnchor.KeyID, release.SigningLedgerAnchor.PublicKey)
	if err != nil {
		return closeOnError(err)
	}
	ledgerRoot, err := releasetrust.NewPinnedSigningLedgerRoot(ledgerLogID, ledgerAnchor)
	if err != nil {
		return closeOnError(err)
	}
	options, err := releasetrust.NewReleaseTrustOptions(
		configuration, rootAnchor, []releasetrust.TransparencyRoot{timeRoot}, ledgerRoot,
		releasetrust.SourceRelativeLocatorPolicyV1,
	)
	if err != nil {
		return closeOnError(err)
	}
	service, err := releasetrust.NewReleaseTrustService(options, releasetrust.ReleaseTrustAdapters{
		Documents:   &embeddedReleaseDocumentTransport{values: cloneArtifactMap(release.ReleaseTrustDocuments)},
		Ledger:      &embeddedSigningLedgerTransport{values: cloneArtifactMap(release.SigningLedgerArtifacts)},
		State:       store,
		TrustedTime: trustedTime,
		Monotonic:   store,
	})
	if err != nil {
		return closeOnError(err)
	}
	set, err := releasetrust.NewServiceSet(service)
	if err != nil {
		return closeOnError(err)
	}
	return set, store, nil
}

func signingLedgerLogID(artifacts map[string][]byte, keyID string) (string, error) {
	for ref, value := range artifacts {
		if !strings.Contains(ref, "/signing-ledger/checkpoints/") {
			continue
		}
		checkpoint, err := releasecontract.DecodeSigningLedgerCheckpoint(value)
		if err != nil || checkpoint.KeyID != keyID {
			return "", errors.New("official signing ledger checkpoint identity is invalid")
		}
		return checkpoint.LogID, nil
	}
	return "", errors.New("official signing ledger checkpoint is missing")
}

func (p *officialReleaseProvider) ResolveReleaseArtifact(ctx context.Context, req host.ReleaseArtifactResolveRequest) (host.ResolvedPackageArtifact, error) {
	if err := ctx.Err(); err != nil {
		return host.ResolvedPackageArtifact{}, err
	}
	if p == nil || req.ReleaseRef != p.release.Ref ||
		(req.Action != host.PackageTrustActionInstall && req.Action != host.PackageTrustActionUpdate) ||
		!sameSourcePolicy(req.SourcePolicy, p.sourcePolicy) {
		return host.ResolvedPackageArtifact{}, officialReleaseVerificationError("release artifact is not declared by the verified source policy")
	}
	packageBytes := slices.Clone(p.release.PackageBytes)
	return host.ResolvedPackageArtifact{
		ReleaseMetadataBytes:     slices.Clone(p.release.ReleaseMetadataBytes),
		ReleaseMetadataSignature: slices.Clone(p.release.ReleaseMetadataSignature),
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
	if required.CapabilityID != containersCapabilityID || required.CapabilityVersion != containersCapabilityVersion || required.Contract != p.capability.Pin {
		return host.HostRequirementSelection{}, officialReleaseVerificationError("host capability requirement is invalid")
	}
	return host.HostRequirementSelection{HostID: officialHostID}, nil
}

func (p *officialReleaseProvider) ResolveCapabilityContract(ctx context.Context, req host.CapabilityContractResolveRequest) (host.ResolvedCapabilityContractArtifact, error) {
	if err := ctx.Err(); err != nil {
		return host.ResolvedCapabilityContractArtifact{}, err
	}
	if p == nil || req.SourceID != officialReleaseSourceID || req.PluginPublisherID != officialPublisherID ||
		req.Pin != p.capability.Pin || !sameSourcePolicy(req.SourcePolicy, p.sourcePolicy) {
		return host.ResolvedCapabilityContractArtifact{}, officialReleaseVerificationError("capability contract is not declared")
	}
	return host.ResolvedCapabilityContractArtifact{Artifacts: &embeddedCapabilityArtifactSet{
		pin: p.capability.Pin, files: cloneArtifactMap(p.artifactFiles),
	}}, nil
}

type embeddedCapabilityArtifactSet struct {
	pin   capabilitycontract.Pin
	files map[string][]byte
}

func (set *embeddedCapabilityArtifactSet) OpenCapabilityContractArtifact(ctx context.Context, ref string) (host.ResolvedCapabilityContractFile, error) {
	if err := ctx.Err(); err != nil {
		return host.ResolvedCapabilityContractFile{}, err
	}
	value, ok := set.files[ref]
	if !ok {
		return host.ResolvedCapabilityContractFile{}, errors.New("embedded capability contract artifact is not declared")
	}
	mediaType := "application/json"
	switch ref {
	case set.pin.ArtifactRef:
		mediaType = "application/schema+json"
	case set.pin.GeneratedClientRef:
		mediaType = "text/typescript"
	}
	return host.ResolvedCapabilityContractFile{
		Reader: io.NopCloser(bytes.NewReader(value)), Size: int64(len(value)), MediaType: mediaType,
		FetchChain: []host.CapabilityArtifactFetchHop{},
	}, nil
}

type embeddedReleaseDocumentTransport struct {
	values map[string][]byte
}

func (transport *embeddedReleaseDocumentTransport) FetchReleaseDocument(ctx context.Context, request releasetrust.ReleaseDocumentRequest) (releasetrust.ReleaseDocumentResult, error) {
	if err := ctx.Err(); err != nil {
		return releasetrust.ReleaseDocumentResult{}, err
	}
	value := transport.values[request.Locator().String()]
	if len(value) == 0 {
		return releasetrust.ReleaseDocumentResult{}, errors.New("embedded release trust document is missing")
	}
	token := "embedded-" + trustDigest(append([]byte(request.Locator().String()), value...))[:32]
	return releasetrust.NewReleaseDocumentResult(request, token, value)
}

type embeddedSigningLedgerTransport struct {
	values map[string][]byte
}

func (transport *embeddedSigningLedgerTransport) FetchSigningLedgerArtifact(ctx context.Context, request releasetrust.SigningLedgerRequest) (releasetrust.SigningLedgerResult, error) {
	if err := ctx.Err(); err != nil {
		return releasetrust.SigningLedgerResult{}, err
	}
	value := transport.values[request.Locator().String()]
	if len(value) == 0 {
		return releasetrust.SigningLedgerResult{}, errors.New("embedded signing ledger artifact is missing")
	}
	return releasetrust.NewSigningLedgerResult(request, value)
}

func sameSourcePolicy(left, right releasecontract.SourcePolicyV2) bool {
	leftBytes, leftErr := releasecontract.CanonicalSourcePolicy(left)
	rightBytes, rightErr := releasecontract.CanonicalSourcePolicy(right)
	return leftErr == nil && rightErr == nil && bytes.Equal(leftBytes, rightBytes)
}

func cloneArtifactMap(values map[string][]byte) map[string][]byte {
	cloned := make(map[string][]byte, len(values))
	for ref, value := range values {
		cloned[ref] = slices.Clone(value)
	}
	return cloned
}

func officialReleaseVerificationError(reason string) error {
	return fmt.Errorf("%w: %s", host.ErrReleaseRefVerificationFailed, reason)
}

var _ host.ReleaseArtifactResolver = (*officialReleaseProvider)(nil)
var _ host.HostRequirementPolicy = (*officialReleaseProvider)(nil)
var _ host.CapabilityContractArtifactResolver = (*officialReleaseProvider)(nil)
var _ host.CapabilityContractArtifactSet = (*embeddedCapabilityArtifactSet)(nil)
var _ releasetrust.ReleaseDocumentTransport = (*embeddedReleaseDocumentTransport)(nil)
var _ releasetrust.SigningLedgerTransport = (*embeddedSigningLedgerTransport)(nil)
