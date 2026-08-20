package redevpluginintegration

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/pluginmarket"
	redevpluginartifacts "github.com/floegence/redeven/spec/redevplugin"
	"github.com/floegence/redevplugin/v3/pkg/externalsource"
	"github.com/floegence/redevplugin/v3/pkg/host"
)

func officialReleaseFixtureTime() time.Time {
	return time.Date(2026, time.August, 14, 15, 20, 0, 0, time.UTC)
}

type rejectingReleaseAssetFetcher struct{}

func (rejectingReleaseAssetFetcher) FetchArtifact(context.Context, externalsource.ArtifactFetchRequest) (externalsource.ArtifactFetchResult, error) {
	return externalsource.ArtifactFetchResult{}, errors.New("unexpected remote fetch")
}

func TestOfficialReleaseModuleUsesValidatedMarketProjection(t *testing.T) {
	release := officialMarketReleaseFixture(t)
	module, ref, closeTrust, err := newOfficialReleaseModuleWithClock(
		context.Background(), filepath.Join(t.TempDir(), "trust"), release,
		rejectingReleaseAssetFetcher{}, officialReleaseFixtureTime,
	)
	if err != nil {
		t.Fatal(err)
	}
	if closeTrust != nil {
		t.Cleanup(func() { _ = closeTrust() })
	}
	if ref != release.PublisherReleaseRef.ReleaseRef || module.Trust == nil || module.ReleaseArtifactResolver == nil {
		t.Fatalf("release module is incomplete: ref=%#v module=%#v", ref, module)
	}

	provider, ok := module.ReleaseArtifactResolver.(*officialReleaseProvider)
	if !ok || provider.transport == nil {
		t.Fatalf("release resolver = %#v", module.ReleaseArtifactResolver)
	}
	tampered := ref
	tampered.ReleaseMetadataSHA256 = strings.Repeat("b", 64)
	if _, err := provider.ResolveReleaseArtifact(context.Background(), host.ReleaseArtifactResolveRequest{
		Action: host.PackageTrustActionInstall, ReleaseRef: tampered,
	}); !errors.Is(err, host.ErrReleaseRefVerificationFailed) {
		t.Fatalf("tampered release error = %v", err)
	}
}

func TestOfficialReleaseProviderRejectsTrustAnchorDrift(t *testing.T) {
	release := officialMarketReleaseFixture(t)
	release.PublisherReleaseRef.Root.PublicKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	_, err := newOfficialReleaseProvider(release, rejectingReleaseAssetFetcher{})
	if err == nil || !strings.Contains(err.Error(), "trust anchors") {
		t.Fatalf("newOfficialReleaseProvider() error = %v", err)
	}
}

func TestOfficialReleaseProviderUsesMarketVersion(t *testing.T) {
	release := officialMarketReleaseFixture(t)
	release.Version = "4.4.5"
	release.Source.Tag = "v4.4.5"
	release.Asset.Name = "containers-4.4.5.redevplugin"
	release.Asset.URL = "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.5/containers-4.4.5.redevplugin"
	release.ReleaseRefAsset.Name = "containers-4.4.5.release-ref.json"
	release.ReleaseRefAsset.URL = "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.5/containers-4.4.5.release-ref.json"
	release.TrustRoot.URL = "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.5/root.public.json"
	release.PublisherReleaseRef.ReleaseRef.Version = release.Version
	release.PublisherReleaseRef.ReleaseRef.ReleaseMetadataRef = "plugins/com.redeven.official/com.redeven.official.containers/4.4.5/release.json"
	release.PublisherReleaseRef.Files[0].Locator = release.PublisherReleaseRef.ReleaseRef.ReleaseMetadataRef
	release.TransportAssets[0].Locator = release.PublisherReleaseRef.ReleaseRef.ReleaseMetadataRef

	provider, err := newOfficialReleaseProvider(release, rejectingReleaseAssetFetcher{})
	if err != nil {
		t.Fatalf("newOfficialReleaseProvider() rejected market version: %v", err)
	}
	if provider.releaseRef.Version != "4.4.5" {
		t.Fatalf("release ref version = %q, want 4.4.5", provider.releaseRef.Version)
	}
}

func TestOfficialReleaseProviderAdvancesToRefreshedMarketRelease(t *testing.T) {
	first := officialMarketReleaseFixture(t)
	provider, err := newOfficialReleaseProvider(first, rejectingReleaseAssetFetcher{})
	if err != nil {
		t.Fatal(err)
	}
	second := first
	second.Version = "4.4.7"
	second.Source.Tag = "v4.4.7"
	second.Asset.Name = "containers-4.4.7.redevplugin"
	second.Asset.URL = "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.7/containers-4.4.7.redevplugin"
	second.ReleaseRefAsset.Name = "containers-4.4.7.release-ref.json"
	second.ReleaseRefAsset.URL = "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.7/containers-4.4.7.release-ref.json"
	second.TrustRoot.URL = "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.7/root.public.json"
	second.PublisherReleaseRef.ReleaseRef.Version = second.Version
	second.PublisherReleaseRef.ReleaseRef.ReleaseMetadataRef = "plugins/com.redeven.official/com.redeven.official.containers/4.4.7/release.json"
	second.PublisherReleaseRef.Files[0].Locator = second.PublisherReleaseRef.ReleaseRef.ReleaseMetadataRef
	second.TransportAssets[0].Locator = second.PublisherReleaseRef.ReleaseRef.ReleaseMetadataRef
	if err := provider.setRelease(second); err != nil {
		t.Fatal(err)
	}
	firstRef, _, err := first.RemoteProjection()
	if err != nil {
		t.Fatal(err)
	}
	if got := provider.currentReleaseRef().Version; got != "4.4.7" {
		t.Fatalf("provider version = %q, want 4.4.7", got)
	}
	if _, err := provider.ResolveReleaseArtifact(context.Background(), host.ReleaseArtifactResolveRequest{
		Action: host.PackageTrustActionInstall, ReleaseRef: firstRef,
	}); errors.Is(err, host.ErrReleaseRefVerificationFailed) {
		t.Fatalf("stale release ref error = %v", err)
	}
}

func officialMarketReleaseFixture(t *testing.T) pluginmarket.LatestRelease {
	t.Helper()
	anchors, err := redevpluginartifacts.OfficialReleaseTrustAnchorSet()
	if err != nil {
		t.Fatal(err)
	}
	const (
		locator               = "plugins/com.redeven.official/com.redeven.official.containers/4.4.4/release.json"
		metadataSHA256        = "a1c0c9391816a04ea9269664f86fc00d8814c401f8a1bcbf4c4a14472d783577"
		packageIdentitySHA256 = "sha256:fdb81d456a11219fa3e5060b15ea55ad824790020c949dc17728ee8af18281a8"
		manifestSHA256        = "sha256:28c0e3c9548b9528c068605e34d26ffbc73ab6543b62dc8ad98078855d39cf1f"
		entriesSHA256         = "sha256:33480ae1405e6ec1098cbeba1a559b83a021dae738de9da0fe5c9344fde3b177"
	)
	packageAsset := pluginmarket.ReleaseAsset{
		AssetID: 514555388, Name: "containers-4.4.4.redevplugin",
		URL:  "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.4/containers-4.4.4.redevplugin",
		Size: 413883, SHA256: "6debb130711c556d668eb62b025606f3a7c80cf1273c3ff49ea0fe9802b3cbc4",
	}
	metadataAsset := pluginmarket.ReleaseAsset{
		AssetID: 514555395, Name: "containers-4.4.4.release.json",
		URL:  "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.4/containers-4.4.4.release.json",
		Size: 1794, SHA256: metadataSHA256,
	}
	release := pluginmarket.LatestRelease{
		PluginID: officialContainersPluginID, Channel: officialReleaseChannel, Version: "4.4.4",
		Source: pluginmarket.ReleaseSource{
			Provider: "github", RepositoryID: 1289352675, RepositoryOwner: "floegence",
			RepositoryName: "redeven-official-plugins", ReleaseID: 370650709, Tag: "v4.4.4",
			TargetCommit: "0b3c5839ad84cdf6beb2003889fe765c1040e730",
		},
		Asset: packageAsset,
		ReleaseRefAsset: pluginmarket.ReleaseAsset{
			AssetID: 514555384, Name: "containers-4.4.4.release-ref.json",
			URL:  "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.4/containers-4.4.4.release-ref.json",
			Size: 3462, SHA256: "5a31ca87d2a94021eea807977c34451768c8e29d8a2fa4be44cea5b5a9eae1dd",
		},
		TransportAssets: []pluginmarket.TransportAsset{{Locator: locator, ReleaseAsset: metadataAsset}},
		SignerKeyID:     officialSigningKeyID,
		Compatibility: pluginmarket.Compatibility{
			MinRedevenVersion: officialMinHostVersion, MinReDevPluginVersion: "1.1.2",
		},
		ReleaseIdentityDigest: "cdee2f2f1170e65aa24694656d6662f77d9587f8c5642422cce7608cb638b02b",
	}
	release.TrustRoot.URL = "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.4/root.public.json"
	release.TrustRoot.SHA256 = "5a625b201d0cc898932742daa69920aca1986567b145f477750a3f73540c3e7f"
	release.PublisherReleaseRef.SchemaVersion = "redevplugin.publisher_release_ref.v1"
	release.PublisherReleaseRef.ReleaseRef = host.PluginReleaseRef{
		SourceID: officialReleaseSourceID, Channel: officialReleaseChannel,
		ReleaseMetadataRef: locator, ReleaseMetadataSHA256: metadataSHA256,
		PublisherID: officialPublisherID, PluginID: officialContainersPluginID, Version: "4.4.4",
		ExpectedHashes: host.PackageHashSet{
			PackageSHA256: packageIdentitySHA256, ManifestSHA256: manifestSHA256, EntriesSHA256: entriesSHA256,
		},
	}
	release.PublisherReleaseRef.Root = pluginmarket.PublicKey{
		Algorithm: "ed25519", KeyID: anchors.Root.KeyID, PublicKey: encodePublicKey(anchors.Root.PublicKey),
	}
	release.PublisherReleaseRef.Files = []pluginmarket.PublishedFile{{
		Locator: locator, AssetName: metadataAsset.Name, SHA256: metadataSHA256, Size: metadataAsset.Size,
	}}
	return release
}
