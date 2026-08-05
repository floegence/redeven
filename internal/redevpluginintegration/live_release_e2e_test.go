//go:build live_release_e2e

package redevpluginintegration

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/pluginmarket"
	"github.com/floegence/redevplugin/pkg/externalsource"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/pluginpkg"
	"github.com/floegence/redevplugin/pkg/releasecontract"
	"github.com/floegence/redevplugin/pkg/releasetrust"
)

func TestLiveOfficialContainersReleaseTrust(t *testing.T) {
	snapshotPath := os.Getenv("REDEVEN_LIVE_PLUGIN_MARKET_SNAPSHOT")
	if snapshotPath == "" {
		t.Skip("REDEVEN_LIVE_PLUGIN_MARKET_SNAPSHOT is not set")
	}
	raw, err := os.ReadFile(snapshotPath)
	if err != nil {
		t.Fatal(err)
	}
	var snapshot pluginmarket.Snapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		t.Fatal(err)
	}
	release, err := snapshot.LatestRelease(officialContainersPluginID, officialReleaseChannel)
	if err != nil {
		t.Fatal(err)
	}
	stage, err := externalsource.NewStageStore(filepath.Join(t.TempDir(), "external-stage"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = stage.Close() })
	fetcher, err := externalsource.NewFetcher(externalsource.FetcherOptions{
		Stage: stage, SourceID: "redeven.live-release-e2e", TotalTimeout: 5 * time.Minute,
	})
	if err != nil {
		t.Fatal(err)
	}
	provider, err := newOfficialReleaseProvider(release, fetcher)
	if err != nil {
		t.Fatal(err)
	}
	trustDir := os.Getenv("REDEVEN_LIVE_RELEASE_TRUST_DIR")
	if trustDir == "" {
		trustDir = filepath.Join(t.TempDir(), "trust")
	}
	trust, store, err := newOfficialReleaseTrust(trustDir, provider, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	ref := release.PublisherReleaseRef.ReleaseRef
	ctx := context.Background()
	prepared, err := trust.PrepareRelease(ctx, releasetrust.ReleaseIdentity{
		SourceID: ref.SourceID, Channel: ref.Channel, ReleaseMetadataRef: ref.ReleaseMetadataRef,
		ReleaseMetadataSHA256: ref.ReleaseMetadataSHA256, PublisherID: ref.PublisherID,
		PluginID: ref.PluginID, Version: ref.Version,
	})
	if err != nil {
		t.Fatalf("prepare live official release: %T: %v", err, err)
	}
	resolved, err := provider.ResolveReleaseArtifact(ctx, host.ReleaseArtifactResolveRequest{
		Action: host.PackageTrustActionInstall, ReleaseRef: provider.releaseRef,
		SourcePolicy:     prepared.SourcePolicy(),
		PluginInstanceID: "catalog_com.redeven.official_com.redeven.official.containers",
		Now:              time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("resolve live official package: %T: %v", err, err)
	}
	metadata, err := trust.VerifyReleaseMetadata(
		ctx, prepared, resolved.ReleaseMetadataBytes, resolved.ReleaseMetadataSignature,
	)
	if err != nil {
		t.Fatalf("verify live official release metadata: %T: %v", err, err)
	}
	pkg, err := pluginpkg.Read(ctx, resolved.Reader, resolved.Size, pluginpkg.DefaultReadLimits())
	if err != nil {
		t.Fatalf("read live official package: %T: %v", err, err)
	}
	if pkg.PackageSignature == nil {
		t.Fatal("live official package has no package signature")
	}
	signature := *pkg.PackageSignature
	_, err = trust.VerifyPackage(ctx, metadata, releasecontract.PackageSignatureV1{
		SchemaVersion: signature.SchemaVersion, Algorithm: signature.Algorithm, KeyID: signature.KeyID,
		PublisherID: signature.PublisherID, PluginID: signature.PluginID,
		PackageHash:  "sha256:" + strings.TrimPrefix(signature.PackageHash, "sha256:"),
		ManifestHash: "sha256:" + strings.TrimPrefix(signature.ManifestHash, "sha256:"),
		EntriesHash:  "sha256:" + strings.TrimPrefix(signature.EntriesHash, "sha256:"),
		Signature:    signature.Signature, SignedAt: signature.SignedAt,
	})
	if err != nil {
		t.Fatalf("verify live official package signature: %T: %v", err, err)
	}
	if _, err := trust.VerifyCapabilityContract(metadata, provider.capability, provider.capability.Pin); err != nil {
		t.Fatalf("verify live official capability contract: %T: %v", err, err)
	}
}
