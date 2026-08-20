package redevpluginintegration

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/pluginmarket"
	redevpluginartifacts "github.com/floegence/redeven/spec/redevplugin"
	"github.com/floegence/redevplugin/v3/pkg/host"
	"github.com/floegence/redevplugin/v3/pkg/releasetrust"
	"github.com/floegence/redevplugin/v3/pkg/remoterelease"
)

const (
	officialReleaseSourceID = "redeven_official"
	officialReleaseChannel  = "stable"
	officialMinHostVersion  = "1.0.0"
)

type officialReleaseProvider struct {
	mu         sync.RWMutex
	releaseRef host.PluginReleaseRef
	transport  *remoterelease.AssetSet
	fetcher    remoterelease.AssetFetcher
	transports map[string]*remoterelease.AssetSet
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
	trust, err := newOfficialReleaseTrust(provider)
	if err != nil {
		return nil, host.PluginReleaseRef{}, nil, err
	}
	return &host.ReleaseModule{Trust: trust, ReleaseArtifactResolver: provider}, provider.currentReleaseRef(), nil, nil
}

// newOfficialReleaseModulePending keeps the Host's release contract available
// while the market is temporarily unavailable. The provider is populated by
// the first successful market refresh before an install is attempted.
func newOfficialReleaseModulePending(fetcher remoterelease.AssetFetcher) (*host.ReleaseModule, *officialReleaseProvider, error) {
	provider := &officialReleaseProvider{fetcher: fetcher, transports: make(map[string]*remoterelease.AssetSet)}
	trust, err := newOfficialReleaseTrust(provider)
	if err != nil {
		return nil, nil, err
	}
	return &host.ReleaseModule{Trust: trust, ReleaseArtifactResolver: provider}, provider, nil
}

func newOfficialReleaseProvider(release pluginmarket.LatestRelease, fetcher remoterelease.AssetFetcher) (*officialReleaseProvider, error) {
	provider := &officialReleaseProvider{fetcher: fetcher}
	if err := provider.setRelease(release); err != nil {
		return nil, err
	}
	return provider, nil
}

func (p *officialReleaseProvider) setRelease(release pluginmarket.LatestRelease) error {
	ref, assets, err := release.RemoteProjection()
	if err != nil {
		return fmt.Errorf("project official Containers release: %w", err)
	}
	if release.PluginID != officialContainersPluginID || release.Channel != officialReleaseChannel ||
		ref.SourceID != officialReleaseSourceID ||
		ref.PublisherID != officialPublisherID || ref.PluginID != officialContainersPluginID ||
		ref.Channel != officialReleaseChannel || ref.Version != release.Version {
		return errors.New("official Containers market release identity is invalid")
	}
	anchors, err := redevpluginartifacts.OfficialReleaseTrustAnchorSet()
	if err != nil {
		return fmt.Errorf("load official release trust anchors: %w", err)
	}
	if release.PublisherReleaseRef.Root.Algorithm != "ed25519" ||
		release.PublisherReleaseRef.Root.KeyID != anchors.Root.KeyID ||
		release.PublisherReleaseRef.Root.PublicKey != encodePublicKey(anchors.Root.PublicKey) {
		return errors.New("official Containers market trust anchors do not match Redeven pins")
	}
	if p == nil || p.fetcher == nil {
		return errors.New("official Containers release fetcher is unavailable")
	}
	transport, err := remoterelease.NewAssetSet(remoterelease.AssetSetOptions{
		SourceID: ref.SourceID, Channel: ref.Channel,
		QuotaKey: "redeven.official.containers", AllowedHosts: []string{
			"github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com",
		},
		Assets: assets, Fetcher: p.fetcher,
	})
	if err != nil {
		return fmt.Errorf("create official Containers remote transport: %w", err)
	}
	p.mu.Lock()
	p.releaseRef = ref
	p.transport = transport
	if p.transports == nil {
		p.transports = make(map[string]*remoterelease.AssetSet)
	}
	p.transports[releaseRefKey(ref)] = transport
	p.mu.Unlock()
	return nil
}

func (p *officialReleaseProvider) currentReleaseRef() host.PluginReleaseRef {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.releaseRef
}

func encodePublicKey(value []byte) string {
	return base64.StdEncoding.EncodeToString(value)
}

func newOfficialReleaseTrust(provider *officialReleaseProvider) (*releasetrust.ServiceSet, error) {
	anchors, err := redevpluginartifacts.OfficialReleaseTrustAnchorSet()
	if err != nil {
		return nil, err
	}
	configuration, err := releasetrust.NewSourceConfiguration(anchors.SourceID, []string{officialReleaseChannel})
	if err != nil {
		return nil, err
	}
	rootAnchor, err := releasetrust.NewEd25519TrustAnchor(anchors.Root.KeyID, anchors.Root.PublicKey)
	if err != nil {
		return nil, err
	}
	options, err := releasetrust.NewReleaseTrustOptions(
		configuration, rootAnchor, releasetrust.SourceRelativeLocatorPolicyV1,
	)
	if err != nil {
		return nil, err
	}
	service, err := releasetrust.NewReleaseTrustService(options, releasetrust.ReleaseTrustAdapters{
		Documents: provider,
	})
	if err != nil {
		return nil, err
	}
	set, err := releasetrust.NewServiceSet(service)
	if err != nil {
		return nil, err
	}
	return set, nil
}

func (p *officialReleaseProvider) ResolveReleaseArtifact(ctx context.Context, req host.ReleaseArtifactResolveRequest) (host.ResolvedPackageArtifact, error) {
	if err := ctx.Err(); err != nil {
		return host.ResolvedPackageArtifact{}, err
	}
	if p == nil {
		return host.ResolvedPackageArtifact{}, officialReleaseVerificationError("release artifact is not declared by the verified source policy")
	}
	p.mu.RLock()
	transport := p.transports[releaseRefKey(req.ReleaseRef)]
	p.mu.RUnlock()
	if transport == nil ||
		(req.Action != host.PackageTrustActionInstall && req.Action != host.PackageTrustActionUpdate) {
		return host.ResolvedPackageArtifact{}, officialReleaseVerificationError("release artifact is not declared by the verified source policy")
	}
	return transport.ResolveReleaseArtifact(ctx, req)
}

func (p *officialReleaseProvider) FetchReleaseDocument(ctx context.Context, req releasetrust.ReleaseDocumentRequest) (releasetrust.ReleaseDocumentResult, error) {
	if p == nil {
		return releasetrust.ReleaseDocumentResult{}, remoterelease.ErrAssetMissing
	}
	p.mu.RLock()
	transport := p.transport
	p.mu.RUnlock()
	if transport == nil {
		return releasetrust.ReleaseDocumentResult{}, remoterelease.ErrAssetMissing
	}
	return transport.FetchReleaseDocument(ctx, req)
}

func releaseRefKey(ref host.PluginReleaseRef) string {
	return ref.ReleaseMetadataSHA256 + "\x00" + ref.Version
}

func officialReleaseVerificationError(reason string) error {
	return fmt.Errorf("%w: %s", host.ErrReleaseRefVerificationFailed, reason)
}

var _ host.ReleaseArtifactResolver = (*officialReleaseProvider)(nil)
