//go:build live_release_e2e

package redevpluginintegration

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/pluginmarket"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
	"github.com/floegence/redevplugin/v3/pkg/execution"
	"github.com/floegence/redevplugin/v3/pkg/externalsource"
	"github.com/floegence/redevplugin/v3/pkg/host"
	"github.com/floegence/redevplugin/v3/pkg/pluginpkg"
	"github.com/floegence/redevplugin/v3/pkg/releasecontract"
	"github.com/floegence/redevplugin/v3/pkg/releasetrust"
)

type localReleaseAssetFetcher struct {
	dir string
}

func (fetcher localReleaseAssetFetcher) FetchArtifact(_ context.Context, request externalsource.ArtifactFetchRequest) (externalsource.ArtifactFetchResult, error) {
	name := filepath.Base(request.URL)
	raw, err := os.ReadFile(filepath.Join(fetcher.dir, name))
	if err != nil {
		return externalsource.ArtifactFetchResult{}, err
	}
	if request.Progress != nil {
		request.Progress(int64(len(raw)), int64(len(raw)))
	}
	return externalsource.ArtifactFetchResult{Bytes: raw, Source: request.URL, Final: request.URL}, nil
}

func TestLiveOfficialContainersReleaseInstallCompletes(t *testing.T) {
	snapshotPath := os.Getenv("REDEVEN_LIVE_PLUGIN_MARKET_SNAPSHOT")
	assetDir := os.Getenv("REDEVEN_LIVE_PLUGIN_RELEASE_DIR")
	if snapshotPath == "" || assetDir == "" {
		t.Skip("REDEVEN_LIVE_PLUGIN_MARKET_SNAPSHOT and REDEVEN_LIVE_PLUGIN_RELEASE_DIR are not set")
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
	stateDir := t.TempDir()
	var releaseRef host.PluginReleaseRef
	integration, err := New(context.Background(), Options{
		StateDir:         stateDir,
		PermissionPolicy: testPermissionPolicy(t, "execute_read"),
		RuntimePath:      testRuntimePath(t, stateDir),
		Containers:       mustContainersAdapter(t, &capabilityEngineClient{}),
		ResolveSessionMeta: func(channelID string) (*session.Meta, bool) {
			return &session.Meta{
				ChannelID: channelID, EndpointID: "env_release_install", UserPublicID: "user_release_install",
				FloeApp: "com.floegence.redeven.agent", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true,
			}, true
		},
		newReleaseModule: func(trustDir string) (*host.ReleaseModule, host.PluginReleaseRef, func() error, error) {
			module, ref, closeTrust, err := newOfficialReleaseModuleWithClock(
				context.Background(), trustDir, release, localReleaseAssetFetcher{dir: assetDir}, officialReleaseFixtureTime,
			)
			releaseRef = ref
			return module, ref, closeTrust, err
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := integration.Close(); err != nil {
			t.Errorf("close integration: %v", err)
		}
	})

	startBody, err := json.Marshal(map[string]any{
		"request_id": "request_release_install", "plugin_instance_id": "catalog_com.redeven.official_com.redeven.official.containers",
		"release_ref": releaseRef,
	})
	if err != nil {
		t.Fatal(err)
	}
	start := liveReleaseRequest(http.MethodPost, "/_redevplugin/api/plugins/executions/release-installs", startBody)
	startResponse := httptest.NewRecorder()
	integration.Handler().ServeHTTP(startResponse, start)
	if startResponse.Code != http.StatusOK {
		t.Fatalf("start release install status = %d body = %s", startResponse.Code, startResponse.Body.String())
	}
	var started struct {
		OK   bool                `json:"ok"`
		Data execution.Execution `json:"data"`
	}
	if err := json.Unmarshal(startResponse.Body.Bytes(), &started); err != nil || !started.OK || started.Data.ID == "" {
		t.Fatalf("decode started execution: value=%#v error=%v", started, err)
	}

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		query := liveReleaseRequest(http.MethodPost, fmt.Sprintf("/_redevplugin/api/plugins/executions/%s/query", started.Data.ID), []byte("{}"))
		response := httptest.NewRecorder()
		integration.Handler().ServeHTTP(response, query)
		if response.Code != http.StatusOK {
			t.Fatalf("get release install status = %d body = %s", response.Code, response.Body.String())
		}
		var current struct {
			OK   bool                `json:"ok"`
			Data execution.Execution `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &current); err != nil || !current.OK {
			t.Fatalf("decode current execution: value=%#v error=%v", current, err)
		}
		if current.Data.TerminalAt != nil {
			if current.Data.Status != execution.StatusCompleted {
				t.Fatalf("release install terminal status = %s failure = %s", current.Data.Status, current.Data.FailureCode)
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("release install did not complete before deadline")
}

func liveReleaseRequest(method, path string, body []byte) *http.Request {
	request := httptest.NewRequest(method, path, bytes.NewReader(body))
	request.Host = "env.example.test"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://env.example.test")
	request.Header.Set(csrfHeader, csrfProof)
	request.Header.Set(sessionhop.HeaderChannelID, "channel_release_install")
	request = WithRouteRole(request, RouteRoleEnvTrusted)
	request, err := WithTrustedOrigin(request, "https://env.example.test")
	if err != nil {
		panic(err)
	}
	return request
}

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
	trust, err := newOfficialReleaseTrust(provider)
	if err != nil {
		t.Fatal(err)
	}
	ref := release.PublisherReleaseRef.ReleaseRef
	ctx := context.Background()
	prepared, err := trust.PrepareRelease(ctx, releasetrust.ReleaseIdentity{
		SourceID: ref.SourceID, Channel: ref.Channel, ReleaseMetadataRef: ref.ReleaseMetadataRef,
		ReleaseMetadataSHA256: ref.ReleaseMetadataSHA256, PublisherID: ref.PublisherID,
		PluginID: ref.PluginID, Version: ref.Version,
	})
	if err != nil {
		logLiveReleaseErrorTree(t, err, "")
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
}

func logLiveReleaseErrorTree(t *testing.T, err error, indent string) {
	t.Helper()
	if err == nil {
		return
	}
	t.Logf("%sprepare live official release cause: %T: %v", indent, err, err)
	if joined, ok := err.(interface{ Unwrap() []error }); ok {
		for _, cause := range joined.Unwrap() {
			logLiveReleaseErrorTree(t, cause, indent+"  ")
		}
		return
	}
	logLiveReleaseErrorTree(t, errors.Unwrap(err), indent+"  ")
}
