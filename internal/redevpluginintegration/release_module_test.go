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
	"github.com/floegence/redevplugin/pkg/externalsource"
	"github.com/floegence/redevplugin/pkg/host"
)

func officialReleaseFixtureTime() time.Time {
	return time.Date(2026, time.August, 1, 8, 0, 0, 0, time.UTC)
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
	t.Cleanup(func() { _ = closeTrust() })
	if ref != release.PublisherReleaseRef.ReleaseRef || module.Trust == nil || module.ReleaseArtifactResolver == nil ||
		module.HostRequirements == nil || module.CapabilityContractArtifacts == nil {
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
	for name, mutate := range map[string]func(*pluginmarket.LatestRelease){
		"root": func(release *pluginmarket.LatestRelease) {
			release.PublisherReleaseRef.Root.PublicKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
		},
		"ledger": func(release *pluginmarket.LatestRelease) {
			release.PublisherReleaseRef.SigningLedger.KeyID = "redeven_official_ledger_other"
		},
	} {
		t.Run(name, func(t *testing.T) {
			release := officialMarketReleaseFixture(t)
			mutate(&release)
			_, err := newOfficialReleaseProvider(release, rejectingReleaseAssetFetcher{})
			if err == nil || !strings.Contains(err.Error(), "trust anchors") {
				t.Fatalf("newOfficialReleaseProvider() error = %v", err)
			}
		})
	}
}

func TestOfficialReleaseProviderPinsV4HostCapability(t *testing.T) {
	provider, err := newOfficialReleaseProvider(officialMarketReleaseFixture(t), rejectingReleaseAssetFetcher{})
	if err != nil {
		t.Fatal(err)
	}
	bundle, _, err := redevpluginartifacts.ContainersCapabilityBundle()
	if err != nil {
		t.Fatal(err)
	}
	selection, err := provider.SelectHostRequirement(context.Background(), host.HostRequirementSelectionRequest{
		SourceID: officialReleaseSourceID, PublisherID: officialPublisherID,
		PluginID: officialContainersPluginID, PluginVersion: officialContainersVersion,
		Requirements: []host.HostRequirement{{
			HostID: officialHostID, MinHostVersion: officialMinHostVersion,
			RequiredCapabilityContracts: []host.HostCapabilityRequirement{{
				CapabilityID: containersCapabilityID, CapabilityVersion: containersCapabilityVersion, Contract: bundle.Pin,
			}},
		}},
	})
	if err != nil || selection.HostID != officialHostID {
		t.Fatalf("host requirement selection = %#v, error = %v", selection, err)
	}
	resolved, err := provider.ResolveCapabilityContract(context.Background(), host.CapabilityContractResolveRequest{
		SourceID: officialReleaseSourceID, PluginPublisherID: officialPublisherID, Pin: bundle.Pin,
	})
	if err != nil || resolved.Artifacts == nil {
		t.Fatalf("capability resolution error = %v", err)
	}
	artifact, err := resolved.Artifacts.OpenCapabilityContractArtifact(context.Background(), bundle.Pin.ArtifactRef)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = artifact.Reader.Close() })
	if artifact.Size <= 0 || artifact.MediaType != "application/schema+json" || len(artifact.FetchChain) != 0 {
		t.Fatalf("capability artifact = %#v", artifact)
	}
}

func officialMarketReleaseFixture(t *testing.T) pluginmarket.LatestRelease {
	t.Helper()
	anchors, err := redevpluginartifacts.OfficialReleaseTrustAnchorSet()
	if err != nil {
		t.Fatal(err)
	}
	const (
		digest    = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
		locator   = "plugins/com.redeven.official/com.redeven.official.containers/4.0.1/release.json"
		assetName = "containers-4.0.1.release.json"
		assetURL  = "https://github.com/floegence/redeven-official-plugins/releases/download/v4.0.1/containers-4.0.1.release.json"
	)
	asset := pluginmarket.ReleaseAsset{AssetID: 497879350, Name: assetName, URL: assetURL, Size: 1, SHA256: digest}
	release := pluginmarket.LatestRelease{
		PluginID: officialContainersPluginID, Channel: officialReleaseChannel, Version: officialContainersVersion,
		Source: pluginmarket.ReleaseSource{
			Provider: "github", RepositoryID: 1289352675, RepositoryOwner: "floegence",
			RepositoryName: "redeven-official-plugins", ReleaseID: 363517742, Tag: "v4.0.1",
			TargetCommit: "16429991dc3daa446385a933676b26c8031d3d7b",
		},
		Asset: asset,
		ReleaseRefAsset: pluginmarket.ReleaseAsset{
			AssetID: 497879353, Name: "containers-4.0.1.release-ref.json",
			URL:  "https://github.com/floegence/redeven-official-plugins/releases/download/v4.0.1/containers-4.0.1.release-ref.json",
			Size: 1, SHA256: digest,
		},
		TransportAssets: []pluginmarket.TransportAsset{{Locator: locator, ReleaseAsset: asset}},
		SignerKeyID:     officialSigningKeyID,
		Compatibility: pluginmarket.Compatibility{
			MinRedevenVersion: officialMinHostVersion, MinReDevPluginVersion: "0.6.23",
		},
		ReleaseIdentityDigest: digest,
	}
	release.TrustRoot.URL = "https://github.com/floegence/redeven-official-plugins/releases/download/v4.0.1/root.public.json"
	release.TrustRoot.SHA256 = digest
	release.PublisherReleaseRef.SchemaVersion = "redevplugin.publisher_release_ref.v1"
	release.PublisherReleaseRef.ReleaseRef = host.PluginReleaseRef{
		SourceID: officialReleaseSourceID, Channel: officialReleaseChannel,
		ReleaseMetadataRef: locator, ReleaseMetadataSHA256: digest,
		PublisherID: officialPublisherID, PluginID: officialContainersPluginID, Version: officialContainersVersion,
		ExpectedHashes: host.PackageHashSet{
			PackageSHA256: "sha256:" + digest, ManifestSHA256: "sha256:" + digest, EntriesSHA256: "sha256:" + digest,
		},
	}
	release.PublisherReleaseRef.Root = pluginmarket.PublicKey{
		Algorithm: "ed25519", KeyID: anchors.Root.KeyID, PublicKey: encodePublicKey(anchors.Root.PublicKey),
	}
	release.PublisherReleaseRef.SigningLedger = pluginmarket.SigningLedger{
		LogID: anchors.SigningLedgerLog, Algorithm: "ed25519", KeyID: anchors.SigningLedger.KeyID,
		PublicKey: encodePublicKey(anchors.SigningLedger.PublicKey),
	}
	release.PublisherReleaseRef.Files = []pluginmarket.PublishedFile{{
		Locator: locator, AssetName: assetName, SHA256: digest, Size: 1,
	}}
	return release
}
