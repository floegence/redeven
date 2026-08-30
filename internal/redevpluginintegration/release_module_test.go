package redevpluginintegration

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/pluginmarket"
	redevpluginartifacts "github.com/floegence/redeven/spec/redevplugin"
	"github.com/floegence/redevplugin/v3/pkg/externalsource"
	"github.com/floegence/redevplugin/v3/pkg/host"
)

type rejectingReleaseAssetFetcher struct{}

func (rejectingReleaseAssetFetcher) FetchArtifact(context.Context, externalsource.ArtifactFetchRequest) (externalsource.ArtifactFetchResult, error) {
	return externalsource.ArtifactFetchResult{}, errors.New("unexpected remote fetch")
}

func TestOfficialReleaseProviderTracksEveryOfficialMarketRelease(t *testing.T) {
	module, provider, err := newOfficialReleaseModulePending(rejectingReleaseAssetFetcher{})
	if err != nil {
		t.Fatal(err)
	}
	if module.Trust == nil || module.ReleaseArtifactResolver != provider {
		t.Fatalf("official release module is incomplete: %#v", module)
	}
	weather := officialMarketReleaseFixture(t, "com.redeven.official.weather", "1.0.0", "a")
	metrics := officialMarketReleaseFixture(t, "com.redeven.official.metrics", "2.0.0", "b")
	if err := provider.setSnapshot(officialReleaseSnapshot(weather, metrics)); err != nil {
		t.Fatal(err)
	}
	if len(provider.releases) != 2 || len(provider.documentTransports) != 2 {
		t.Fatalf("provider release projection = %d releases, %d document transports", len(provider.releases), len(provider.documentTransports))
	}
	for _, release := range []pluginmarket.LatestRelease{weather, metrics} {
		if _, ok := provider.releases[release.PublisherReleaseRef.ReleaseRef]; !ok {
			t.Fatalf("release %s is not resolvable", release.PluginID)
		}
	}
}

func TestOfficialReleaseProviderRefreshIsAtomicAndDropsMissingReleases(t *testing.T) {
	_, provider, err := newOfficialReleaseModulePending(rejectingReleaseAssetFetcher{})
	if err != nil {
		t.Fatal(err)
	}
	weather := officialMarketReleaseFixture(t, "com.redeven.official.weather", "1.0.0", "a")
	metrics := officialMarketReleaseFixture(t, "com.redeven.official.metrics", "2.0.0", "b")
	if err := provider.setSnapshot(officialReleaseSnapshot(weather, metrics)); err != nil {
		t.Fatal(err)
	}
	weatherTransport := provider.releases[weather.PublisherReleaseRef.ReleaseRef].transport

	tampered := weather
	tampered.PublisherReleaseRef.Root.PublicKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	if err := provider.setSnapshot(officialReleaseSnapshot(tampered)); err == nil || !strings.Contains(err.Error(), "trust anchors") {
		t.Fatalf("tampered snapshot error = %v", err)
	}
	if len(provider.releases) != 2 || provider.releases[weather.PublisherReleaseRef.ReleaseRef].transport != weatherTransport {
		t.Fatal("rejected snapshot partially changed the active release projection")
	}

	if err := provider.setSnapshot(officialReleaseSnapshot(weather)); err != nil {
		t.Fatal(err)
	}
	if len(provider.releases) != 1 || provider.releases[weather.PublisherReleaseRef.ReleaseRef].transport != weatherTransport {
		t.Fatal("exact retained release did not reuse its immutable transport")
	}
	if _, ok := provider.releases[metrics.PublisherReleaseRef.ReleaseRef]; ok {
		t.Fatal("release absent from the new market generation remained resolvable")
	}
}

func TestOfficialReleaseProviderRejectsUndeclaredRelease(t *testing.T) {
	_, provider, err := newOfficialReleaseModulePending(rejectingReleaseAssetFetcher{})
	if err != nil {
		t.Fatal(err)
	}
	release := officialMarketReleaseFixture(t, "com.redeven.official.weather", "1.0.0", "a")
	if err := provider.setSnapshot(officialReleaseSnapshot(release)); err != nil {
		t.Fatal(err)
	}
	unknown := release.PublisherReleaseRef.ReleaseRef
	unknown.Version = "1.0.1"
	if _, err := provider.ResolveReleaseArtifact(context.Background(), host.ReleaseArtifactResolveRequest{
		Action: host.PackageTrustActionInstall, ReleaseRef: unknown,
	}); !errors.Is(err, host.ErrReleaseRefVerificationFailed) {
		t.Fatalf("undeclared release error = %v", err)
	}
}

func officialReleaseSnapshot(releases ...pluginmarket.LatestRelease) pluginmarket.Snapshot {
	plugins := make([]pluginmarket.CatalogPlugin, len(releases))
	for index := range releases {
		release := releases[index]
		plugins[index] = pluginmarket.CatalogPlugin{
			PluginID: release.PluginID, PublisherID: officialPublisherID, Release: &release,
		}
	}
	return pluginmarket.Snapshot{Plugins: plugins}
}

func officialMarketReleaseFixture(t *testing.T, pluginID, version, hashDigit string) pluginmarket.LatestRelease {
	t.Helper()
	anchors, err := redevpluginartifacts.OfficialReleaseTrustAnchorSet()
	if err != nil {
		t.Fatal(err)
	}
	if len(hashDigit) != 1 {
		t.Fatal("fixture hash digit must contain exactly one character")
	}
	digest := strings.Repeat(hashDigit, 64)
	name := pluginID[strings.LastIndex(pluginID, ".")+1:]
	locator := fmt.Sprintf("plugins/%s/%s/%s/release.json", officialPublisherID, pluginID, version)
	metadataAsset := pluginmarket.ReleaseAsset{
		AssetID: 2, Name: name + "-" + version + ".release.json",
		URL:  "https://github.com/floegence/redeven-official-plugins/releases/download/v" + version + "/" + name + "-" + version + ".release.json",
		Size: 1024, SHA256: digest,
	}
	release := pluginmarket.LatestRelease{
		PluginID: pluginID, Channel: officialReleaseChannel, Version: version,
		Source: pluginmarket.ReleaseSource{
			Provider: "github", RepositoryID: 1289352675, RepositoryOwner: "floegence",
			RepositoryName: "redeven-official-plugins", ReleaseID: 1, Tag: "v" + version,
			TargetCommit: strings.Repeat(hashDigit, 40),
		},
		Asset: pluginmarket.ReleaseAsset{
			AssetID: 1, Name: name + "-" + version + ".redevplugin",
			URL:  "https://github.com/floegence/redeven-official-plugins/releases/download/v" + version + "/" + name + "-" + version + ".redevplugin",
			Size: 4096, SHA256: digest,
		},
		ReleaseRefAsset: pluginmarket.ReleaseAsset{
			AssetID: 3, Name: name + "-" + version + ".release-ref.json",
			URL:  "https://github.com/floegence/redeven-official-plugins/releases/download/v" + version + "/" + name + "-" + version + ".release-ref.json",
			Size: 2048, SHA256: digest,
		},
		TransportAssets: []pluginmarket.TransportAsset{{Locator: locator, ReleaseAsset: metadataAsset}},
		SignerKeyID:     officialSigningKeyID,
		Compatibility: pluginmarket.Compatibility{
			MinRedevenVersion: "1.0.0", MinReDevPluginVersion: "3.0.18",
		},
		ReleaseIdentityDigest: "sha256:" + digest,
	}
	release.TrustRoot.URL = "https://github.com/floegence/redeven-official-plugins/releases/download/v" + version + "/root.public.json"
	release.TrustRoot.SHA256 = digest
	release.PublisherReleaseRef = pluginmarket.PublisherReleaseRef{
		SchemaVersion: "redevplugin.publisher_release_ref.v1",
		ReleaseRef: host.PluginReleaseRef{
			SourceID: officialReleaseSourceID, Channel: officialReleaseChannel,
			ReleaseMetadataRef: locator, ReleaseMetadataSHA256: digest,
			PublisherID: officialPublisherID, PluginID: pluginID, Version: version,
			ExpectedHashes: host.PackageHashSet{
				PackageSHA256: "sha256:" + digest, ManifestSHA256: "sha256:" + digest, EntriesSHA256: "sha256:" + digest,
			},
		},
		Root: pluginmarket.PublicKey{
			Algorithm: "ed25519", KeyID: anchors.Root.KeyID, PublicKey: encodePublicKey(anchors.Root.PublicKey),
		},
		Files: []pluginmarket.PublishedFile{{
			Locator: locator, AssetName: metadataAsset.Name, SHA256: digest, Size: metadataAsset.Size,
		}},
	}
	return release
}
