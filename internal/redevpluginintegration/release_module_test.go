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
	"github.com/floegence/redevplugin/v2/pkg/externalsource"
	"github.com/floegence/redevplugin/v2/pkg/host"
)

func officialReleaseFixtureTime() time.Time {
	return time.Date(2026, time.August, 14, 15, 20, 0, 0, time.UTC)
}

func TestOfficialContainersVersionMatchesPublishedRelease(t *testing.T) {
	if officialContainersVersion != "4.4.4" {
		t.Fatalf("official Containers version = %q, want 4.4.4", officialContainersVersion)
	}
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
	if ref != release.PublisherReleaseRef.ReleaseRef || module.Trust == nil || module.ReleaseArtifactResolver == nil ||
		module.HostRequirements == nil {
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

func TestOfficialReleaseProviderPinsV4HostCapability(t *testing.T) {
	provider, err := newOfficialReleaseProvider(officialMarketReleaseFixture(t), rejectingReleaseAssetFetcher{})
	if err != nil {
		t.Fatal(err)
	}
	selection, err := provider.SelectHostRequirement(context.Background(), host.HostRequirementSelectionRequest{
		SourceID: officialReleaseSourceID, PublisherID: officialPublisherID,
		PluginID: officialContainersPluginID, PluginVersion: officialContainersVersion,
		Requirements: []host.HostRequirement{{
			HostID: officialHostID, MinHostVersion: officialMinHostVersion,
			RequiredCapabilityContracts: []host.HostCapabilityRequirement{{
				CapabilityID: containersCapabilityID, CapabilityVersion: containersCapabilityVersion,
			}},
		}},
	})
	if err != nil || selection.HostID != officialHostID {
		t.Fatalf("host requirement selection = %#v, error = %v", selection, err)
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
		PluginID: officialContainersPluginID, Channel: officialReleaseChannel, Version: officialContainersVersion,
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
		PublisherID: officialPublisherID, PluginID: officialContainersPluginID, Version: officialContainersVersion,
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
