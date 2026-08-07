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
	return time.Date(2026, time.August, 7, 10, 0, 0, 0, time.UTC)
}

func TestOfficialContainersVersionMatchesPublishedRelease(t *testing.T) {
	if officialContainersVersion != "4.4.0" {
		t.Fatalf("official Containers version = %q, want 4.4.0", officialContainersVersion)
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
	if artifact.Size <= 0 || artifact.MediaType != "application/schema+json" ||
		artifact.Origin != host.CapabilityArtifactOriginHost || len(artifact.FetchChain) != 0 {
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
		locator               = "plugins/com.redeven.official/com.redeven.official.containers/4.4.0/release.json"
		metadataSHA256        = "439316f415741c2972e87a8972b932f76404b87368173f09af9ba9bf1cf54c7c"
		packageIdentitySHA256 = "sha256:2b70270fe548dbd6742bbe56d40b706cdd1bdb95cc75e2fb32d9ce676b7dc6d2"
		manifestSHA256        = "sha256:7f6f3f70235d7ec2f876738bbb8038914b353dc559621e9cbaffad2a7ad98c23"
		entriesSHA256         = "sha256:33d5e20fd5d18ed514b3e70dabfd7d9603382e8c42d6ef06e8280069c9180630"
	)
	packageAsset := pluginmarket.ReleaseAsset{
		AssetID: 504929112, Name: "containers-4.4.0.redevplugin",
		URL:  "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.0/containers-4.4.0.redevplugin",
		Size: 414867, SHA256: "c9adda34e0e94bf6e66b31c8842aa546396ebc30254483e760b49223164bad03",
	}
	metadataAsset := pluginmarket.ReleaseAsset{
		AssetID: 504929115, Name: "containers-4.4.0.release.json",
		URL:  "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.0/containers-4.4.0.release.json",
		Size: 3026, SHA256: metadataSHA256,
	}
	release := pluginmarket.LatestRelease{
		PluginID: officialContainersPluginID, Channel: officialReleaseChannel, Version: officialContainersVersion,
		Source: pluginmarket.ReleaseSource{
			Provider: "github", RepositoryID: 1289352675, RepositoryOwner: "floegence",
			RepositoryName: "redeven-official-plugins", ReleaseID: 366632394, Tag: "v4.4.0",
			TargetCommit: "dfb76f621534bd24ac81690a405b641b22424dff",
		},
		Asset: packageAsset,
		ReleaseRefAsset: pluginmarket.ReleaseAsset{
			AssetID: 504929114, Name: "containers-4.4.0.release-ref.json",
			URL:  "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.0/containers-4.4.0.release-ref.json",
			Size: 18516, SHA256: "9141e4d09896882b517d04e32fdc60bb2018d9af027628eb5458f2f79ee9d84c",
		},
		TransportAssets: []pluginmarket.TransportAsset{{Locator: locator, ReleaseAsset: metadataAsset}},
		SignerKeyID:     officialSigningKeyID,
		Compatibility: pluginmarket.Compatibility{
			MinRedevenVersion: officialMinHostVersion, MinReDevPluginVersion: "0.7.16",
		},
		ReleaseIdentityDigest: "0a5b4d86a19df60152de0f12b370f8940421c2637d1cdbb8d6fc49044834ba8e",
	}
	release.TrustRoot.URL = "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.0/root.public.json"
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
