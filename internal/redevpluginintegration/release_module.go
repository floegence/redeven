package redevpluginintegration

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/floegence/redeven/internal/pluginmarket"
	redevpluginartifacts "github.com/floegence/redeven/spec/redevplugin"
	"github.com/floegence/redevplugin/v3/pkg/host"
	"github.com/floegence/redevplugin/v3/pkg/releasetrust"
	"github.com/floegence/redevplugin/v3/pkg/remoterelease"
)

const (
	officialReleaseSourceID = "redeven_official"
	officialReleaseChannel  = "stable"
)

var officialReleaseAllowedHosts = []string{
	"github.com",
	"objects.githubusercontent.com",
	"release-assets.githubusercontent.com",
}

type officialReleaseProjection struct {
	ref        host.PluginReleaseRef
	transport  *remoterelease.AssetSet
	projection string
}

// officialReleaseProvider binds every currently visible official market
// release to an immutable ReDevPlugin remote transport. A market refresh swaps
// the complete set atomically, so an install can never combine evidence from
// different catalog generations.
type officialReleaseProvider struct {
	mu                 sync.RWMutex
	fetcher            remoterelease.AssetFetcher
	releases           map[host.PluginReleaseRef]officialReleaseProjection
	documentTransports []*remoterelease.AssetSet
}

func newOfficialReleaseModulePending(fetcher remoterelease.AssetFetcher) (*host.ReleaseModule, *officialReleaseProvider, error) {
	if fetcher == nil {
		return nil, nil, errors.New("official release fetcher is unavailable")
	}
	provider := &officialReleaseProvider{
		fetcher:  fetcher,
		releases: make(map[host.PluginReleaseRef]officialReleaseProjection),
	}
	trust, err := newOfficialReleaseTrust(provider)
	if err != nil {
		return nil, nil, err
	}
	return &host.ReleaseModule{Trust: trust, ReleaseArtifactResolver: provider}, provider, nil
}

func (p *officialReleaseProvider) setSnapshot(snapshot pluginmarket.Snapshot) error {
	if p == nil || p.fetcher == nil {
		return errors.New("official release provider is unavailable")
	}
	anchors, err := redevpluginartifacts.OfficialReleaseTrustAnchorSet()
	if err != nil {
		return fmt.Errorf("load official release trust anchors: %w", err)
	}

	p.mu.RLock()
	previous := make(map[host.PluginReleaseRef]officialReleaseProjection, len(p.releases))
	for ref, projection := range p.releases {
		previous[ref] = projection
	}
	p.mu.RUnlock()

	next := make(map[host.PluginReleaseRef]officialReleaseProjection)
	for _, plugin := range snapshot.Plugins {
		if plugin.Release == nil || plugin.PublisherID != officialPublisherID {
			continue
		}
		projection, projectionErr := p.projectRelease(*plugin.Release, anchors, previous)
		if projectionErr != nil {
			return projectionErr
		}
		if _, exists := next[projection.ref]; exists {
			return errors.New("official market contains a duplicate release identity")
		}
		next[projection.ref] = projection
	}

	ordered := make([]officialReleaseProjection, 0, len(next))
	for _, projection := range next {
		ordered = append(ordered, projection)
	}
	sort.Slice(ordered, func(left, right int) bool {
		if ordered[left].ref.PluginID != ordered[right].ref.PluginID {
			return ordered[left].ref.PluginID < ordered[right].ref.PluginID
		}
		return ordered[left].ref.Version < ordered[right].ref.Version
	})
	documents := make([]*remoterelease.AssetSet, len(ordered))
	for index, projection := range ordered {
		documents[index] = projection.transport
	}

	p.mu.Lock()
	p.releases = next
	p.documentTransports = documents
	p.mu.Unlock()
	return nil
}

func (p *officialReleaseProvider) projectRelease(
	release pluginmarket.LatestRelease,
	anchors redevpluginartifacts.OfficialReleaseTrustAnchors,
	previous map[host.PluginReleaseRef]officialReleaseProjection,
) (officialReleaseProjection, error) {
	ref, assets, err := release.RemoteProjection()
	if err != nil {
		return officialReleaseProjection{}, fmt.Errorf("project official release: %w", err)
	}
	if release.Channel != officialReleaseChannel || ref.SourceID != officialReleaseSourceID ||
		ref.PublisherID != officialPublisherID || ref.PluginID != release.PluginID ||
		ref.Channel != officialReleaseChannel || ref.Version != release.Version {
		return officialReleaseProjection{}, errors.New("official market release identity is invalid")
	}
	if release.PublisherReleaseRef.Root.Algorithm != "ed25519" ||
		release.PublisherReleaseRef.Root.KeyID != anchors.Root.KeyID ||
		release.PublisherReleaseRef.Root.PublicKey != encodePublicKey(anchors.Root.PublicKey) {
		return officialReleaseProjection{}, errors.New("official market trust anchors do not match Redeven pins")
	}

	projectionKey := releaseAssetProjectionKey(assets)
	if existing, ok := previous[ref]; ok && existing.projection == projectionKey {
		return existing, nil
	}
	transport, err := remoterelease.NewAssetSet(remoterelease.AssetSetOptions{
		SourceID:     ref.SourceID,
		Channel:      ref.Channel,
		QuotaKey:     "redeven.official:" + ref.PluginID,
		AllowedHosts: append([]string(nil), officialReleaseAllowedHosts...),
		Assets:       assets,
		Fetcher:      p.fetcher,
	})
	if err != nil {
		return officialReleaseProjection{}, fmt.Errorf("create official release transport: %w", err)
	}
	return officialReleaseProjection{ref: ref, transport: transport, projection: projectionKey}, nil
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
	options, err := releasetrust.NewReleaseTrustOptions(configuration, rootAnchor, releasetrust.SourceRelativeLocatorPolicyV1)
	if err != nil {
		return nil, err
	}
	service, err := releasetrust.NewReleaseTrustService(options, releasetrust.ReleaseTrustAdapters{Documents: provider})
	if err != nil {
		return nil, err
	}
	return releasetrust.NewServiceSet(service)
}

func (p *officialReleaseProvider) ResolveReleaseArtifact(ctx context.Context, req host.ReleaseArtifactResolveRequest) (host.ResolvedPackageArtifact, error) {
	if err := ctx.Err(); err != nil {
		return host.ResolvedPackageArtifact{}, err
	}
	if p == nil || (req.Action != host.PackageTrustActionInstall && req.Action != host.PackageTrustActionUpdate) {
		return host.ResolvedPackageArtifact{}, officialReleaseVerificationError("release artifact is not declared by the verified market snapshot")
	}
	p.mu.RLock()
	projection, ok := p.releases[req.ReleaseRef]
	p.mu.RUnlock()
	if !ok || projection.transport == nil {
		return host.ResolvedPackageArtifact{}, officialReleaseVerificationError("release artifact is not declared by the verified market snapshot")
	}
	return projection.transport.ResolveReleaseArtifact(ctx, req)
}

func (p *officialReleaseProvider) FetchReleaseDocument(ctx context.Context, req releasetrust.ReleaseDocumentRequest) (releasetrust.ReleaseDocumentResult, error) {
	if err := ctx.Err(); err != nil {
		return releasetrust.ReleaseDocumentResult{}, err
	}
	if p == nil {
		return releasetrust.ReleaseDocumentResult{}, remoterelease.ErrAssetMissing
	}
	p.mu.RLock()
	transports := append([]*remoterelease.AssetSet(nil), p.documentTransports...)
	p.mu.RUnlock()
	for _, transport := range transports {
		result, err := transport.FetchReleaseDocument(ctx, req)
		if err == nil {
			return result, nil
		}
		if !errors.Is(err, remoterelease.ErrAssetMissing) {
			return releasetrust.ReleaseDocumentResult{}, err
		}
	}
	return releasetrust.ReleaseDocumentResult{}, remoterelease.ErrAssetMissing
}

func releaseAssetProjectionKey(assets []remoterelease.Asset) string {
	parts := make([]string, 0, len(assets)*4)
	for _, asset := range assets {
		parts = append(parts, asset.Locator, asset.URL, asset.SHA256, fmt.Sprintf("%d", asset.Size))
	}
	return strings.Join(parts, "\x00")
}

func officialReleaseVerificationError(reason string) error {
	return fmt.Errorf("%w: %s", host.ErrReleaseRefVerificationFailed, reason)
}

var _ host.ReleaseArtifactResolver = (*officialReleaseProvider)(nil)
var _ releasetrust.ReleaseDocumentTransport = (*officialReleaseProvider)(nil)
