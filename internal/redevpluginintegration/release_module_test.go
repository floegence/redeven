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
		locator               = "plugins/com.redeven.official/com.redeven.official.containers/4.1.0/release.json"
		metadataSHA256        = "04cdedd57d93428028fdb2ae284c150e7973de4cbffd4ef96bf6ef8f89e0e6a6"
		packageIdentitySHA256 = "sha256:749aac3b48c3c3e2ced98ad1738c187cebf1001b5e6f5ed22c4e73d7c56c764c"
		manifestSHA256        = "sha256:001ad248eb6aea058bb3386e12a03cfb89f4599222aef9b83960738cbe7e24ab"
		entriesSHA256         = "sha256:4cb3f856929e85c5f71e128a25b6f2108b295868dc522c716b67ba75b0d575ba"
	)
	packageAsset := pluginmarket.ReleaseAsset{
		AssetID: 499839437, Name: "containers-4.1.0.redevplugin",
		URL:  "https://github.com/floegence/redeven-official-plugins/releases/download/v4.1.0/containers-4.1.0.redevplugin",
		Size: 414779, SHA256: "6a9a543a31e415b7b223446d268ff3ffe09d8d712cd7ef095bf23e35e2d706ce",
	}
	metadataAsset := pluginmarket.ReleaseAsset{
		AssetID: 499839450, Name: "containers-4.1.0.release.json",
		URL:  "https://github.com/floegence/redeven-official-plugins/releases/download/v4.1.0/containers-4.1.0.release.json",
		Size: 3024, SHA256: metadataSHA256,
	}
	release := pluginmarket.LatestRelease{
		PluginID: officialContainersPluginID, Channel: officialReleaseChannel, Version: officialContainersVersion,
		Source: pluginmarket.ReleaseSource{
			Provider: "github", RepositoryID: 1289352675, RepositoryOwner: "floegence",
			RepositoryName: "redeven-official-plugins", ReleaseID: 364084844, Tag: "v4.1.0",
			TargetCommit: "deb768572aa1055eaf1f90ffc67c8e693c89be2e",
		},
		Asset: packageAsset,
		ReleaseRefAsset: pluginmarket.ReleaseAsset{
			AssetID: 499839449, Name: "containers-4.1.0.release-ref.json",
			URL:  "https://github.com/floegence/redeven-official-plugins/releases/download/v4.1.0/containers-4.1.0.release-ref.json",
			Size: 13225, SHA256: "1d294e926cd2e00a963d2094245f4527f5cd0faa3e3e5908c6040787861fe9d0",
		},
		TransportAssets: []pluginmarket.TransportAsset{{Locator: locator, ReleaseAsset: metadataAsset}},
		SignerKeyID:     officialSigningKeyID,
		Compatibility: pluginmarket.Compatibility{
			MinRedevenVersion: officialMinHostVersion, MinReDevPluginVersion: "0.7.1",
		},
		ReleaseIdentityDigest: "b0d6f62575d5047b316b80510f0b1cbaeb76893b94ac529691acf6ce983255c3",
	}
	release.TrustRoot.URL = "https://github.com/floegence/redeven-official-plugins/releases/download/v4.1.0/root.public.json"
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
	release.PublisherReleaseRef.SigningLedger = pluginmarket.SigningLedger{
		LogID: anchors.SigningLedgerLog, Algorithm: "ed25519", KeyID: anchors.SigningLedger.KeyID,
		PublicKey: encodePublicKey(anchors.SigningLedger.PublicKey),
	}
	release.PublisherReleaseRef.Files = []pluginmarket.PublishedFile{{
		Locator: locator, AssetName: metadataAsset.Name, SHA256: metadataSHA256, Size: metadataAsset.Size,
	}}
	return release
}
