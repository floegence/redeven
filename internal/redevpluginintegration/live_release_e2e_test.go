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
	"github.com/floegence/redevplugin/v3/pkg/host"
	"github.com/floegence/redevplugin/v3/pkg/pluginpkg"
	"github.com/floegence/redevplugin/v3/pkg/releasecontract"
	"github.com/floegence/redevplugin/v3/pkg/releasetrust"
)

// TestLiveOfficialMarketReleaseInstallCompletes proves the product integration
// against a validated market snapshot and its real immutable release assets.
// It is opt-in because it performs bounded public HTTPS downloads.
func TestLiveOfficialMarketReleaseInstallCompletes(t *testing.T) {
	snapshotPath := os.Getenv("REDEVEN_LIVE_PLUGIN_MARKET_SNAPSHOT")
	pluginID := os.Getenv("REDEVEN_LIVE_PLUGIN_ID")
	if snapshotPath == "" {
		t.Skip("REDEVEN_LIVE_PLUGIN_MARKET_SNAPSHOT is not set")
	}
	if pluginID == "" {
		pluginID = "com.redeven.official.weather"
	}
	raw, err := os.ReadFile(snapshotPath)
	if err != nil {
		t.Fatal(err)
	}
	var snapshot pluginmarket.Snapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		t.Fatal(err)
	}
	release, err := snapshot.LatestRelease(pluginID, officialReleaseChannel)
	if err != nil {
		t.Fatal(err)
	}
	if release.InstallPreview == nil {
		t.Fatal("live release is missing its verified install preview")
	}

	stateDir := t.TempDir()
	cachePath := filepath.Join(stateDir, "market-lkg.json")
	if err := os.WriteFile(cachePath, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	market, err := pluginmarket.NewService(pluginmarket.ServiceOptions{
		Origin: "https://plugins.redeven.com", CachePath: cachePath,
		RedevenVersion: "1.0.0", ReDevPluginVersion: "3.0.26",
	})
	if err != nil {
		t.Fatal(err)
	}
	const channelID = "channel_live_official_release"
	runtimePath := os.Getenv("REDEVEN_LIVE_PLUGIN_RUNTIME_PATH")
	if runtimePath == "" {
		runtimePath = testRuntimePath(t, stateDir)
	}
	integration, err := New(context.Background(), Options{
		StateDir: stateDir, PermissionPolicy: testPermissionPolicy(t, "execute_read_write"),
		RuntimePath: runtimePath, PluginMarket: market,
		ResolveSessionMeta: func(got string) (*session.Meta, bool) {
			return &session.Meta{
				ChannelID: channelID, EndpointID: "env_live_official_release", UserPublicID: "user_live_official_release",
				FloeApp: "com.floegence.redeven.agent", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true,
			}, got == channelID
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

	preview := release.InstallPreview
	verifyLiveRelease(t, integration.releaseProvider, preview.ReleaseRef)
	startBody, err := json.Marshal(map[string]any{
		"request_id":              "00000000-0000-4000-8000-000000000001",
		"plugin_instance_id":      "catalog_" + officialPublisherID + "_" + pluginID,
		"release_ref":             preview.ReleaseRef,
		"release_identity_digest": preview.ReleaseIdentityDigest,
		"manifest_sha256":         preview.ManifestSHA256,
		"contract_set_sha256":     preview.ContractSetSHA256,
		"summary_sha256":          preview.SummarySHA256,
	})
	if err != nil {
		t.Fatal(err)
	}
	start := liveReleaseRequest(t, http.MethodPost, "/_redevplugin/api/plugins/executions/release-installs", channelID, startBody)
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

	deadline := time.Now().Add(3 * time.Minute)
	for time.Now().Before(deadline) {
		query := liveReleaseRequest(t, http.MethodPost, fmt.Sprintf("/_redevplugin/api/plugins/executions/%s/query", started.Data.ID), channelID, []byte(`{}`))
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
	t.Fatal("release install did not complete before deadline")
}

func verifyLiveRelease(t *testing.T, provider *officialReleaseProvider, ref host.PluginReleaseRef) {
	t.Helper()
	trust, err := newOfficialReleaseTrust(provider)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	prepared, err := trust.PrepareRelease(ctx, releasetrust.ReleaseIdentity{
		SourceID: ref.SourceID, Channel: ref.Channel, ReleaseMetadataRef: ref.ReleaseMetadataRef,
		ReleaseMetadataSHA256: ref.ReleaseMetadataSHA256, PublisherID: ref.PublisherID,
		PluginID: ref.PluginID, Version: ref.Version,
	})
	if err != nil {
		logLiveReleaseErrorTree(t, err, "")
		t.Fatal("prepare live release trust failed")
	}
	resolved, err := provider.ResolveReleaseArtifact(ctx, host.ReleaseArtifactResolveRequest{
		Action: host.PackageTrustActionInstall, ReleaseRef: ref, SourcePolicy: prepared.SourcePolicy(),
		PluginInstanceID: "catalog_" + officialPublisherID + "_" + ref.PluginID, Now: time.Now().UTC(),
	})
	if err != nil {
		logLiveReleaseErrorTree(t, err, "")
		t.Fatal("resolve live release failed")
	}
	metadata, err := trust.VerifyReleaseMetadata(ctx, prepared, resolved.ReleaseMetadataBytes, resolved.ReleaseMetadataSignature)
	if err != nil {
		logLiveReleaseErrorTree(t, err, "")
		t.Fatal("verify live release metadata failed")
	}
	pkg, err := pluginpkg.Read(ctx, resolved.Reader, resolved.Size, pluginpkg.DefaultReadLimits())
	if err != nil {
		t.Fatal(err)
	}
	if pkg.PackageSignature == nil {
		t.Fatal("live official package has no package signature")
	}
	signature := *pkg.PackageSignature
	if _, err := trust.VerifyPackage(ctx, metadata, releasecontract.PackageSignatureV1{
		SchemaVersion: signature.SchemaVersion, Algorithm: signature.Algorithm, KeyID: signature.KeyID,
		PublisherID: signature.PublisherID, PluginID: signature.PluginID,
		PackageHash:  "sha256:" + strings.TrimPrefix(signature.PackageHash, "sha256:"),
		ManifestHash: "sha256:" + strings.TrimPrefix(signature.ManifestHash, "sha256:"),
		EntriesHash:  "sha256:" + strings.TrimPrefix(signature.EntriesHash, "sha256:"),
		Signature:    signature.Signature, SignedAt: signature.SignedAt,
	}); err != nil {
		logLiveReleaseErrorTree(t, err, "")
		t.Fatal("verify live package failed")
	}
}

func liveReleaseRequest(t *testing.T, method, path, channelID string, body []byte) *http.Request {
	t.Helper()
	request := httptest.NewRequest(method, path, bytes.NewReader(body))
	request.Host = "env.example.test"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://env.example.test")
	request.Header.Set(csrfHeader, csrfProof)
	request.Header.Set(sessionhop.HeaderChannelID, channelID)
	request = WithRouteRole(request, RouteRoleEnvTrusted)
	request, err := WithTrustedOrigin(request, "https://env.example.test")
	if err != nil {
		t.Fatal(err)
	}
	return request
}

func logLiveReleaseErrorTree(t *testing.T, err error, indent string) {
	t.Helper()
	if err == nil {
		return
	}
	t.Logf("%srelease cause: %T: %v", indent, err, err)
	if joined, ok := err.(interface{ Unwrap() []error }); ok {
		for _, cause := range joined.Unwrap() {
			logLiveReleaseErrorTree(t, cause, indent+"  ")
		}
		return
	}
	logLiveReleaseErrorTree(t, errors.Unwrap(err), indent+"  ")
}
