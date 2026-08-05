package redevpluginintegration

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"slices"
	"time"

	"github.com/floegence/redeven/internal/pluginmarket"
	redevpluginartifacts "github.com/floegence/redeven/spec/redevplugin"
	"github.com/floegence/redevplugin/pkg/capabilitycontract"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/releasetrust"
	"github.com/floegence/redevplugin/pkg/remoterelease"
)

const (
	officialReleaseSourceID   = "redeven_official"
	officialReleaseChannel    = "stable"
	officialHostID            = "redeven"
	officialContainersVersion = "4.1.0"
	officialMinHostVersion    = "1.0.0"
)

type officialReleaseProvider struct {
	releaseRef    host.PluginReleaseRef
	transport     *remoterelease.AssetSet
	capability    capabilitycontract.Bundle
	artifactFiles map[string][]byte
}

func newOfficialReleaseModuleWithClock(
	ctx context.Context,
	stateDir string,
	release pluginmarket.LatestRelease,
	fetcher remoterelease.AssetFetcher,
	now func() time.Time,
) (*host.ReleaseModule, host.PluginReleaseRef, func() error, error) {
	if err := ctx.Err(); err != nil {
		return nil, host.PluginReleaseRef{}, nil, err
	}
	provider, err := newOfficialReleaseProvider(release, fetcher)
	if err != nil {
		return nil, host.PluginReleaseRef{}, nil, err
	}
	trust, store, err := newOfficialReleaseTrust(stateDir, provider, now)
	if err != nil {
		return nil, host.PluginReleaseRef{}, nil, err
	}
	return &host.ReleaseModule{
		Trust:                       trust,
		ReleaseArtifactResolver:     provider,
		HostRequirements:            provider,
		CapabilityContractArtifacts: provider,
	}, provider.releaseRef, store.Close, nil
}

func newOfficialReleaseProvider(release pluginmarket.LatestRelease, fetcher remoterelease.AssetFetcher) (*officialReleaseProvider, error) {
	ref, assets, err := release.RemoteProjection()
	if err != nil {
		return nil, fmt.Errorf("project official Containers release: %w", err)
	}
	if release.PluginID != officialContainersPluginID || release.Channel != officialReleaseChannel ||
		release.Version != officialContainersVersion || ref.SourceID != officialReleaseSourceID ||
		ref.PublisherID != officialPublisherID || ref.PluginID != officialContainersPluginID ||
		ref.Channel != officialReleaseChannel || ref.Version != officialContainersVersion {
		return nil, errors.New("official Containers market release identity is invalid")
	}
	anchors, err := redevpluginartifacts.OfficialReleaseTrustAnchorSet()
	if err != nil {
		return nil, fmt.Errorf("load official release trust anchors: %w", err)
	}
	if release.PublisherReleaseRef.Root.Algorithm != "ed25519" ||
		release.PublisherReleaseRef.Root.KeyID != anchors.Root.KeyID ||
		release.PublisherReleaseRef.Root.PublicKey != encodePublicKey(anchors.Root.PublicKey) ||
		release.PublisherReleaseRef.SigningLedger.Algorithm != "ed25519" ||
		release.PublisherReleaseRef.SigningLedger.LogID != anchors.SigningLedgerLog ||
		release.PublisherReleaseRef.SigningLedger.KeyID != anchors.SigningLedger.KeyID ||
		release.PublisherReleaseRef.SigningLedger.PublicKey != encodePublicKey(anchors.SigningLedger.PublicKey) {
		return nil, errors.New("official Containers market trust anchors do not match Redeven pins")
	}
	transport, err := remoterelease.NewAssetSet(remoterelease.AssetSetOptions{
		SourceID: ref.SourceID, Channel: ref.Channel,
		QuotaKey: "redeven.official.containers", AllowedHosts: []string{
			"github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com",
		},
		Assets: assets, Fetcher: fetcher,
	})
	if err != nil {
		return nil, fmt.Errorf("create official Containers remote transport: %w", err)
	}
	bundle, _, err := redevpluginartifacts.ContainersCapabilityBundle()
	if err != nil {
		return nil, fmt.Errorf("load official Containers capability: %w", err)
	}
	files := make(map[string][]byte, len(bundle.Files))
	for ref, value := range bundle.Files {
		files[ref] = slices.Clone(value)
	}
	return &officialReleaseProvider{
		releaseRef: ref, transport: transport,
		capability: bundle, artifactFiles: files,
	}, nil
}

func encodePublicKey(value []byte) string {
	return base64.StdEncoding.EncodeToString(value)
}

func newOfficialReleaseTrust(stateDir string, provider *officialReleaseProvider, now func() time.Time) (*releasetrust.ServiceSet, *releaseTrustStore, error) {
	anchors, err := redevpluginartifacts.OfficialReleaseTrustAnchorSet()
	if err != nil {
		return nil, nil, err
	}
	configuration, err := releasetrust.NewSourceConfiguration(anchors.SourceID, []string{officialReleaseChannel})
	if err != nil {
		return nil, nil, err
	}
	rootAnchor, err := releasetrust.NewEd25519TrustAnchor(anchors.Root.KeyID, anchors.Root.PublicKey)
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
	ledgerAnchor, err := releasetrust.NewEd25519TrustAnchor(anchors.SigningLedger.KeyID, anchors.SigningLedger.PublicKey)
	if err != nil {
		return closeOnError(err)
	}
	ledgerRoot, err := releasetrust.NewPinnedSigningLedgerRoot(anchors.SigningLedgerLog, ledgerAnchor)
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
		Documents:   provider.transport,
		Ledger:      provider.transport,
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

func (p *officialReleaseProvider) ResolveReleaseArtifact(ctx context.Context, req host.ReleaseArtifactResolveRequest) (host.ResolvedPackageArtifact, error) {
	if err := ctx.Err(); err != nil {
		return host.ResolvedPackageArtifact{}, err
	}
	if p == nil || req.ReleaseRef != p.releaseRef ||
		(req.Action != host.PackageTrustActionInstall && req.Action != host.PackageTrustActionUpdate) {
		return host.ResolvedPackageArtifact{}, officialReleaseVerificationError("release artifact is not declared by the verified source policy")
	}
	return p.transport.ResolveReleaseArtifact(ctx, req)
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
	if requirement.HostID != officialHostID || requirement.MinHostVersion != officialMinHostVersion || len(requirement.RequiredCapabilityContracts) != 1 {
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
		req.Pin != p.capability.Pin {
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
		Origin:     host.CapabilityArtifactOriginHost,
		FetchChain: []host.CapabilityArtifactFetchHop{},
	}, nil
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
