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
	if officialContainersVersion != "4.4.2" {
		t.Fatalf("official Containers version = %q, want 4.4.2", officialContainersVersion)
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
		locator               = "plugins/com.redeven.official/com.redeven.official.containers/4.4.2/release.json"
		metadataSHA256        = "02b8618cf422c1cbed7cd6cbf42ead26fa6dab3fd1ab46d5bd05f3863503c6bf"
		packageIdentitySHA256 = "sha256:4fde89b1cb6bd09596aca03021eb015207b748567a4c829d70985d336b094522"
		manifestSHA256        = "sha256:07079b0455365bbf57795ceb7fa4043142059da13cff269e11e81312d94b9784"
		entriesSHA256         = "sha256:99f60a56dc2037fa01aa714f1cc1135640b93f74aa9ddab8db19d4281ee581c4"
	)
	packageAsset := pluginmarket.ReleaseAsset{
		AssetID: 509935682, Name: "containers-4.4.2.redevplugin",
		URL:  "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.2/containers-4.4.2.redevplugin",
		Size: 414894, SHA256: "701ab9916f207e21637e662e8be5b9e090af2b0e95239a79aa026d3a3746b31d",
	}
	metadataAsset := pluginmarket.ReleaseAsset{
		AssetID: 509935694, Name: "containers-4.4.2.release.json",
		URL:  "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.2/containers-4.4.2.release.json",
		Size: 3026, SHA256: metadataSHA256,
	}
	release := pluginmarket.LatestRelease{
		PluginID: officialContainersPluginID, Channel: officialReleaseChannel, Version: officialContainersVersion,
		Source: pluginmarket.ReleaseSource{
			Provider: "github", RepositoryID: 1289352675, RepositoryOwner: "floegence",
			RepositoryName: "redeven-official-plugins", ReleaseID: 368453757, Tag: "v4.4.2",
			TargetCommit: "d41485f257cf2e193628012d3e041b6418e893e7",
		},
		Asset: packageAsset,
		ReleaseRefAsset: pluginmarket.ReleaseAsset{
			AssetID: 509935693, Name: "containers-4.4.2.release-ref.json",
			URL:  "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.2/containers-4.4.2.release-ref.json",
			Size: 19556, SHA256: "aef489f96143e522268ef95f4570e7d7a8b02273ff6035c81741ac3c569d417b",
		},
		TransportAssets: []pluginmarket.TransportAsset{{Locator: locator, ReleaseAsset: metadataAsset}},
		SignerKeyID:     officialSigningKeyID,
		Compatibility: pluginmarket.Compatibility{
			MinRedevenVersion: officialMinHostVersion, MinReDevPluginVersion: "0.7.16",
		},
		ReleaseIdentityDigest: "19d96b6d535e65d2bc6bc92baa71484c842317896c6d179ac99b736b023864b7",
	}
	release.TrustRoot.URL = "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.2/root.public.json"
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
