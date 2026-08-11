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
	if officialContainersVersion != "4.4.3" {
		t.Fatalf("official Containers version = %q, want 4.4.3", officialContainersVersion)
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
		locator               = "plugins/com.redeven.official/com.redeven.official.containers/4.4.3/release.json"
		metadataSHA256        = "2e00303ab686c4d0ae9862895f949c6286828c8496e64846012f3ca39c152be3"
		packageIdentitySHA256 = "sha256:4dde36627e17753c4cf145f3baebd0223c9219a471be75d1c25d8e858f609f69"
		manifestSHA256        = "sha256:fe038b3c44bf44b8dcfd7c6e94ffe80ccee15daf258e0a11518e307ebf9e2312"
		entriesSHA256         = "sha256:4bec0de1afb29a56a89d4b51a62c8d6487f5d88a5c06bf7b1026856f7b20103a"
	)
	packageAsset := pluginmarket.ReleaseAsset{
		AssetID: 510026040, Name: "containers-4.4.3.redevplugin",
		URL:  "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.3/containers-4.4.3.redevplugin",
		Size: 414945, SHA256: "c1505aedd252b56ff46f2b4b7622b317011e6ee38490e5be36195e22832e05b4",
	}
	metadataAsset := pluginmarket.ReleaseAsset{
		AssetID: 510026048, Name: "containers-4.4.3.release.json",
		URL:  "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.3/containers-4.4.3.release.json",
		Size: 3026, SHA256: metadataSHA256,
	}
	release := pluginmarket.LatestRelease{
		PluginID: officialContainersPluginID, Channel: officialReleaseChannel, Version: officialContainersVersion,
		Source: pluginmarket.ReleaseSource{
			Provider: "github", RepositoryID: 1289352675, RepositoryOwner: "floegence",
			RepositoryName: "redeven-official-plugins", ReleaseID: 368507595, Tag: "v4.4.3",
			TargetCommit: "b5907da7dd6362235b1fb3655c291b8779b2afcd",
		},
		Asset: packageAsset,
		ReleaseRefAsset: pluginmarket.ReleaseAsset{
			AssetID: 510026049, Name: "containers-4.4.3.release-ref.json",
			URL:  "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.3/containers-4.4.3.release-ref.json",
			Size: 20076, SHA256: "e215cec5da3bd2c6486bceebbbab75144ecc40338f6edea55f987deae94fa5e0",
		},
		TransportAssets: []pluginmarket.TransportAsset{{Locator: locator, ReleaseAsset: metadataAsset}},
		SignerKeyID:     officialSigningKeyID,
		Compatibility: pluginmarket.Compatibility{
			MinRedevenVersion: officialMinHostVersion, MinReDevPluginVersion: "0.7.16",
		},
		ReleaseIdentityDigest: "517b3d410bf409f3d9a5ad42f6a6f00539e89a287a96b00eca88dfc74b3659d7",
	}
	release.TrustRoot.URL = "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.3/root.public.json"
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
