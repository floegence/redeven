//go:build live_release_e2e

package redevpluginintegration

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/pluginmarket"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
	"github.com/floegence/redevplugin/v3/pkg/host"
)

// TestLiveOfficialMarketReleaseInstallCompletes proves the product integration
// against a live market refresh or a validated snapshot and ordinary release assets.
// It is opt-in because it performs bounded public HTTPS downloads.
func TestLiveOfficialMarketReleaseInstallCompletes(t *testing.T) {
	snapshotPath := os.Getenv("REDEVEN_LIVE_PLUGIN_MARKET_SNAPSHOT")
	liveOrigin := os.Getenv("REDEVEN_LIVE_PLUGIN_MARKET_ORIGIN")
	pluginID := os.Getenv("REDEVEN_LIVE_PLUGIN_ID")
	if snapshotPath == "" && liveOrigin == "" {
		t.Skip("REDEVEN_LIVE_PLUGIN_MARKET_SNAPSHOT or REDEVEN_LIVE_PLUGIN_MARKET_ORIGIN is not set")
	}
	runtimePath := os.Getenv("REDEVEN_LIVE_PLUGIN_RUNTIME_PATH")
	if runtimePath == "" {
		t.Fatal("live acceptance requires REDEVEN_LIVE_PLUGIN_RUNTIME_PATH from verified published artifacts")
	}
	if pluginID == "" {
		pluginID = "github.repo.1289352675.weather"
	}
	stateDir := t.TempDir()
	cachePath := filepath.Join(stateDir, "market-lkg.json")
	market, err := pluginmarket.NewService(pluginmarket.ServiceOptions{
		Origin: liveOrigin, CachePath: cachePath,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := market.Close(); err != nil {
			t.Errorf("close market: %v", err)
		}
	})
	var snapshot pluginmarket.Snapshot
	if snapshotPath != "" {
		raw, err := os.ReadFile(snapshotPath)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(cachePath, raw, 0o600); err != nil {
			t.Fatal(err)
		}
		var valid bool
		snapshot, valid = market.CachedSnapshot()
		if !valid {
			t.Fatal("market service rejected the supplied snapshot")
		}
	} else {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		snapshot, err = market.Refresh(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if snapshot.Stale || snapshot.Source != pluginmarket.SnapshotSourceRemote {
			t.Fatal("live acceptance requires a fresh remote market snapshot")
		}
		t.Logf("validated live market generation %d with %d listings", snapshot.Generation, len(snapshot.Plugins))
	}
	release, err := snapshot.LatestRelease(pluginID, "stable")
	if err != nil {
		t.Fatal(err)
	}
	var preview *pluginmarket.InstallPreview
	for _, item := range snapshot.Plugins {
		if item.PluginID == pluginID {
			preview = item.Latest.InstallPreview
		}
	}
	if preview == nil {
		t.Fatal("live release is missing its verified install preview")
	}

	const channelID = "channel_live_official_release"
	options := Options{
		StateDir: stateDir, PermissionPolicy: testPermissionPolicy(t, "execute_read_write"),
		RuntimePath: runtimePath, PluginMarket: market,
		ResolveSessionMeta: func(got string) (*session.Meta, bool) {
			return &session.Meta{
				ChannelID: channelID, EndpointID: "env_live_official_release", UserPublicID: "user_live_official_release",
				FloeApp: "com.floegence.redeven.agent", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true,
			}, got == channelID
		},
	}
	integration, err := New(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if integration != nil {
			if err := integration.Close(); err != nil {
				t.Errorf("close integration: %v", err)
			}
		}
	})

	inspectBody, err := json.Marshal(host.InspectExternalPackageRequest{
		Intent: host.ExternalPackageIntent{Action: "install"},
		Source: host.ExternalPackageSource{Kind: "github_repository", Host: "redeven", PluginID: pluginID,
			URL: "https://github.com/" + release.Source.RepositoryOwner + "/" + release.Source.RepositoryName, Tag: release.Source.Tag,
			RepositoryID: strconv.FormatInt(release.Source.RepositoryID, 10),
			ReleaseID:    strconv.FormatInt(release.Source.ReleaseID, 10),
			AssetID:      strconv.FormatInt(release.Asset.AssetID, 10)},
		ExpectedPublisherID: release.PublisherID, ExpectedPluginID: pluginID, ExpectedVersion: release.Version,
		ExpectedPackageSHA256: "sha256:" + release.PackageSHA256, ExpectedSecuritySummarySHA256: preview.SummarySHA256,
		ExpectedContractSetSHA256: preview.ContractSetSHA256,
	})
	if err != nil {
		t.Fatal(err)
	}
	inspectedResponse := httptest.NewRecorder()
	integration.Handler().ServeHTTP(inspectedResponse, liveReleaseRequest(t, http.MethodPost, "/_redevplugin/api/plugins/external-packages/inspect", channelID, inspectBody))
	if inspectedResponse.Code != http.StatusOK {
		t.Fatalf("inspect: %d %s", inspectedResponse.Code, inspectedResponse.Body.String())
	}
	var inspected struct {
		OK   bool                           `json:"ok"`
		Data host.ExternalPackageInspection `json:"data"`
	}
	if err := json.Unmarshal(inspectedResponse.Body.Bytes(), &inspected); err != nil || !inspected.OK {
		t.Fatalf("inspection decode: %v", err)
	}
	startBody, err := json.Marshal(map[string]any{"request_id": "00000000-0000-4000-8000-000000000001", "inspection_id": inspected.Data.InspectionID, "expected_package_sha256": inspected.Data.InspectedHashes.PackageSHA256})
	if err != nil {
		t.Fatal(err)
	}
	start := liveReleaseRequest(t, http.MethodPost, "/_redevplugin/api/plugins/external-packages/install-operations", channelID, startBody)
	startResponse := httptest.NewRecorder()
	integration.Handler().ServeHTTP(startResponse, start)
	if startResponse.Code != http.StatusOK {
		t.Fatalf("start release install status = %d body = %s", startResponse.Code, startResponse.Body.String())
	}
	var started struct {
		OK   bool                           `json:"ok"`
		Data host.InspectedInstallOperation `json:"data"`
	}
	if err := json.Unmarshal(startResponse.Body.Bytes(), &started); err != nil || !started.OK || started.Data.Execution.ID == "" {
		t.Fatalf("decode started execution: value=%#v error=%v", started, err)
	}

	deadline := time.Now().Add(3 * time.Minute)
	for time.Now().Before(deadline) {
		query := liveReleaseRequest(t, http.MethodPost, "/_redevplugin/api/plugins/external-packages/install-operations/query", channelID, []byte(`{"request_id":"00000000-0000-4000-8000-000000000001"}`))
		response := httptest.NewRecorder()
		integration.Handler().ServeHTTP(response, query)
		if response.Code != http.StatusOK {
			t.Fatalf("get release install status = %d body = %s", response.Code, response.Body.String())
		}
		var current struct {
			OK   bool                           `json:"ok"`
			Data host.InspectedInstallOperation `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &current); err != nil || !current.OK {
			t.Fatalf("decode current execution: value=%#v error=%v", current, err)
		}
		if current.Data.Execution.TerminalAt != nil {
			if current.Data.MutationOutcome != "committed" {
				t.Fatalf("release install terminal status = %s failure = %s", current.Data.Execution.Status, current.Data.Execution.FailureCode)
			}
			// Inspect durable inventory, then renew the Host and recover the exact
			// receipt before relying on any process-local inspection state.
			catalogResponse := httptest.NewRecorder()
			integration.Handler().ServeHTTP(catalogResponse, liveReleaseRequest(t, http.MethodPost, "/_redevplugin/api/plugins/catalog/query", channelID, []byte(`{}`)))
			var catalog struct {
				Data struct {
					Plugins []struct {
						PluginInstanceID string                               `json:"plugin_instance_id"`
						PluginID         string                               `json:"plugin_id"`
						PublisherID      string                               `json:"publisher_id"`
						PackageHash      string                               `json:"package_hash"`
						EnableState      string                               `json:"enable_state"`
						SourceProvenance host.ExternalPackageSourceProvenance `json:"source_provenance"`
					} `json:"plugins"`
				} `json:"data"`
			}
			if catalogResponse.Code != http.StatusOK || json.Unmarshal(catalogResponse.Body.Bytes(), &catalog) != nil || len(catalog.Data.Plugins) != 1 {
				t.Fatalf("installed inventory: %s", catalogResponse.Body.String())
			}
			record := catalog.Data.Plugins[0]
			if record.PluginInstanceID != current.Data.Execution.PluginInstanceID || record.PackageHash != inspected.Data.InspectedHashes.PackageSHA256 || record.EnableState != "enabled" {
				t.Fatalf("installed identity: %+v", record)
			}
			if record.PluginID != pluginID || record.PublisherID != release.PublisherID ||
				record.SourceProvenance.Kind != "github_repository" ||
				record.SourceProvenance.RepositoryID != strconv.FormatInt(release.Source.RepositoryID, 10) ||
				record.SourceProvenance.ReleaseID != strconv.FormatInt(release.Source.ReleaseID, 10) ||
				record.SourceProvenance.AssetID != strconv.FormatInt(release.Asset.AssetID, 10) {
				t.Fatalf("installed source identity differs from observed release: %+v", record)
			}
			if err := integration.Close(); err != nil {
				t.Fatal(err)
			}
			integration, err = New(context.Background(), options)
			if err != nil {
				t.Fatal(err)
			}
			recovered := httptest.NewRecorder()
			integration.Handler().ServeHTTP(recovered, liveReleaseRequest(t, http.MethodPost, "/_redevplugin/api/plugins/external-packages/install-operations", channelID, startBody))
			var replay struct {
				Data host.InspectedInstallOperation `json:"data"`
			}
			if recovered.Code != http.StatusOK || json.Unmarshal(recovered.Body.Bytes(), &replay) != nil || replay.Data.Execution.ID != current.Data.Execution.ID || replay.Data.MutationOutcome != "committed" {
				t.Fatalf("restart receipt: %d %s", recovered.Code, recovered.Body.String())
			}
			restartedCatalog := httptest.NewRecorder()
			integration.Handler().ServeHTTP(restartedCatalog, liveReleaseRequest(t, http.MethodPost, "/_redevplugin/api/plugins/catalog/query", channelID, []byte(`{}`)))
			catalog.Data.Plugins = nil
			if restartedCatalog.Code != http.StatusOK || json.Unmarshal(restartedCatalog.Body.Bytes(), &catalog) != nil || len(catalog.Data.Plugins) != 1 {
				t.Fatalf("restarted inventory: %s", restartedCatalog.Body.String())
			}
			persisted := catalog.Data.Plugins[0]
			if persisted.PluginInstanceID != record.PluginInstanceID || persisted.PluginID != record.PluginID ||
				persisted.PublisherID != record.PublisherID || persisted.PackageHash != record.PackageHash ||
				persisted.SourceProvenance.Kind != "github_repository" ||
				persisted.SourceProvenance.RepositoryID != record.SourceProvenance.RepositoryID ||
				persisted.SourceProvenance.ReleaseID != record.SourceProvenance.ReleaseID ||
				persisted.SourceProvenance.AssetID != record.SourceProvenance.AssetID {
				t.Fatalf("source identity was not preserved across Host restart: %+v", persisted)
			}
			t.Logf("verified %s %s, exact package %s, durable request %s after Host restart", pluginID, release.Version, record.PackageHash, replay.Data.RequestID)
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("release install did not complete before deadline")
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
