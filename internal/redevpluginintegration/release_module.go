package redevpluginintegration

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/floegence/redeven/internal/pluginmarket"
	redevpluginartifacts "github.com/floegence/redeven/spec/redevplugin"
	"github.com/floegence/redevplugin/v3/pkg/host"
	"github.com/floegence/redevplugin/v3/pkg/releasetrust"
	"github.com/floegence/redevplugin/v3/pkg/remoterelease"
)

const (
	officialReleaseSourceID   = "redeven_official"
	officialReleaseChannel    = "stable"
	officialContainersVersion = "4.4.4"
	officialMinHostVersion    = "1.0.0"
)

type officialReleaseProvider struct {
	releaseRef host.PluginReleaseRef
	transport  *remoterelease.AssetSet
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
	return &host.ReleaseModule{Trust: trust, ReleaseArtifactResolver: provider}, provider.releaseRef, nil, nil
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
		release.PublisherReleaseRef.Root.PublicKey != encodePublicKey(anchors.Root.PublicKey) {
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
	return &officialReleaseProvider{
		releaseRef: ref, transport: transport,
	}, nil
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
		Documents: provider.transport,
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
	if p == nil || req.ReleaseRef != p.releaseRef ||
		(req.Action != host.PackageTrustActionInstall && req.Action != host.PackageTrustActionUpdate) {
		return host.ResolvedPackageArtifact{}, officialReleaseVerificationError("release artifact is not declared by the verified source policy")
	}
	return p.transport.ResolveReleaseArtifact(ctx, req)
}

func officialReleaseVerificationError(reason string) error {
	return fmt.Errorf("%w: %s", host.ErrReleaseRefVerificationFailed, reason)
}

var _ host.ReleaseArtifactResolver = (*officialReleaseProvider)(nil)
