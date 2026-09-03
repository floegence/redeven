package pluginmarket

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redevplugin/v3/pkg/host"
)

const validCatalogResponse = `{
  "data": [{
    "plugin_id": "com.example.metrics",
    "publisher_id": "com.redeven.official",
    "presentation": {
      "default_locale": "en-US",
      "icon": {
        "url": "/v1/plugins/com.example.metrics/icon?sha256=949adb221cd3e990ebe350947cc17d1b415d6175f99df98aeb5c47d70fb3cce1",
        "media_type": "image/png",
        "width": 512,
        "height": 512,
        "sha256": "949adb221cd3e990ebe350947cc17d1b415d6175f99df98aeb5c47d70fb3cce1"
      },
      "locales": [
        {"locale": "en-US", "name": "Metrics", "publisher_name": "Redeven Official", "summary": "Collect and display service metrics.", "keywords": ["metrics", "monitoring"]},
        {"locale": "zh-CN", "name": "指标", "publisher_name": "Redeven 官方", "summary": "收集并展示服务指标。", "keywords": ["指标", "监控"]}
      ]
    },
    "categories": ["monitoring"],
    "channels": ["stable"],
    "latest": {"channel": "stable", "version": "4.0.0", "availability_status": "visible"}
  }],
  "meta": {"request_id": "req_catalog", "generation": 7, "stale": false}
}`

const validLatestResponse = `{
  "data": {
    "plugin_id": "com.example.metrics",
    "channel": "stable",
    "version": "4.0.0",
    "source": {
      "provider": "github",
      "repository_id": 1289352675,
      "repository_owner": "floegence",
      "repository_name": "redeven-official-plugins",
      "release_id": 363464766,
      "tag": "v4.0.0",
      "target_commit": "6c446e9a72986a52ed57fe52ac0f52423a201edb"
    },
    "asset": {
      "asset_id": 497702097,
      "name": "metrics-4.0.0.redevplugin",
      "url": "https://github.com/floegence/redeven-official-plugins/releases/download/v4.0.0/metrics-4.0.0.redevplugin",
      "size": 409266,
      "sha256": "3dd8cc3fc30c347d6276b88ece0913ad8f15cd762704e7902ba6290351bb5e3c"
    },
    "release_ref": {
      "asset_id": 497702092,
      "name": "metrics-4.0.0.release-ref.json",
      "url": "https://github.com/floegence/redeven-official-plugins/releases/download/v4.0.0/metrics-4.0.0.release-ref.json",
      "size": 13225,
      "sha256": "47c919f9f629132ecd3a4f852df0d3d129167307a188b9ae3cdb4113d3eddbdb"
    },
    "trust_root": {
      "url": "https://github.com/floegence/redeven-official-plugins/releases/download/v4.0.0/root.public.json",
      "sha256": "5a625b201d0cc898932742daa69920aca1986567b145f477750a3f73540c3e7f"
    },
    "publisher_release_ref": {
      "schema_version": "redevplugin.publisher_release_ref.v1",
      "release_ref": {
        "source_id": "redeven_official",
        "channel": "stable",
        "release_metadata_ref": "plugins/com.redeven.official/com.example.metrics/4.0.0/release.json",
        "release_metadata_sha256": "921d7a2ca42e8faf52a26f2b0ca7768e62317c2d0859ceea5858cce218d2dadd",
        "publisher_id": "com.redeven.official",
        "plugin_id": "com.example.metrics",
        "version": "4.0.0",
        "expected_hashes": {
          "package_sha256": "sha256:8bc0bf9dc43c2f183e532e3f0d4d5921d3d103d40d6aca918958b3337563359a",
          "manifest_sha256": "sha256:79a512b3749024e1306cdb4ecc14c77684f180c07fdc32c2bbe59589c617767a",
          "entries_sha256": "sha256:5b5b5a0c16196cae96bed838aa22ebbacf09b14c9462d1dac1abffe56f27d639"
        }
      },
      "root": {
        "algorithm": "ed25519",
        "key_id": "redeven_official_root_2026",
        "public_key": "2nZtMCZWoIVm4ivB7e64IjRsQqYnlSug1XTiAlH1C9Y="
      },
      "files": [
        {
          "locator": "plugins/com.redeven.official/com.example.metrics/4.0.0/package.redevplugin",
          "asset_name": "metrics-4.0.0.redevplugin",
          "sha256": "3dd8cc3fc30c347d6276b88ece0913ad8f15cd762704e7902ba6290351bb5e3c",
          "size": 409266
        },
        {
          "locator": "plugins/com.redeven.official/com.example.metrics/4.0.0/release.json",
          "asset_name": "metrics-4.0.0.release.json",
          "sha256": "921d7a2ca42e8faf52a26f2b0ca7768e62317c2d0859ceea5858cce218d2dadd",
          "size": 3026
        },
        {
          "locator": "sources/redeven_official/root/current.json",
          "asset_name": "trust-root.json",
          "sha256": "8aef41598f631df76b79b1428376cd983347c31ffd7f30daa087c3588b3b32ae",
          "size": 842
        }
      ]
    },
    "transport_assets": [
      {
        "locator": "plugins/com.redeven.official/com.example.metrics/4.0.0/package.redevplugin",
        "asset_id": 497702097,
        "name": "metrics-4.0.0.redevplugin",
        "url": "https://github.com/floegence/redeven-official-plugins/releases/download/v4.0.0/metrics-4.0.0.redevplugin",
        "size": 409266,
        "sha256": "3dd8cc3fc30c347d6276b88ece0913ad8f15cd762704e7902ba6290351bb5e3c"
      },
      {
        "locator": "plugins/com.redeven.official/com.example.metrics/4.0.0/release.json",
        "asset_id": 497702096,
        "name": "metrics-4.0.0.release.json",
        "url": "https://github.com/floegence/redeven-official-plugins/releases/download/v4.0.0/metrics-4.0.0.release.json",
        "size": 3026,
        "sha256": "921d7a2ca42e8faf52a26f2b0ca7768e62317c2d0859ceea5858cce218d2dadd"
      },
      {
        "locator": "sources/redeven_official/root/current.json",
        "asset_id": 497702138,
        "name": "trust-root.json",
        "url": "https://github.com/floegence/redeven-official-plugins/releases/download/v4.0.0/trust-root.json",
        "size": 842,
        "sha256": "8aef41598f631df76b79b1428376cd983347c31ffd7f30daa087c3588b3b32ae"
      }
    ],
    "signer_key_id": "redeven_official_signing_2026_08",
    "compatibility": {"min_redeven_version": "1.0.0", "min_redevplugin_version": "0.6.22"},
    "release_identity_digest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  },
  "meta": {"request_id": "req_latest", "generation": 7, "stale": false}
}`

const validDetailResponse = `{
  "data": {
    "plugin_id": "com.example.metrics",
    "publisher_id": "com.redeven.official",
    "presentation": {
      "default_locale": "en-US",
      "icon": {
        "url": "/v1/plugins/com.example.metrics/icon?sha256=949adb221cd3e990ebe350947cc17d1b415d6175f99df98aeb5c47d70fb3cce1",
        "media_type": "image/png",
        "width": 512,
        "height": 512,
        "sha256": "949adb221cd3e990ebe350947cc17d1b415d6175f99df98aeb5c47d70fb3cce1"
      },
      "locales": [{"locale": "en-US", "name": "Metrics", "publisher_name": "Redeven Official", "summary": "Collect and display service metrics.", "description": ["Display endpoint metrics."], "highlights": ["Compare metric history."], "keywords": ["metrics"]}]
    },
    "categories": ["monitoring"],
    "channels": ["stable"],
    "repository": {"provider": "github", "repository_id": 1289352675, "owner": "floegence", "name": "redeven-official-plugins", "url": "https://github.com/floegence/redeven-official-plugins"},
    "compatibility": {"min_redeven_version": "1.0.0", "min_redevplugin_version": "0.7.1"},
    "status": "active",
    "latest": [{"channel": "stable", "version": "4.1.0", "availability_status": "visible"}]
  },
  "meta": {"request_id": "req_detail", "generation": 41, "stale": false}
}`

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return fn(request) }

func response(status int, body string, headers http.Header) *http.Response {
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     headers,
	}
}

func catalogResponseWithInstallPreview(t *testing.T) string {
	t.Helper()
	var catalog CatalogResponse
	if err := json.Unmarshal([]byte(validCatalogResponse), &catalog); err != nil {
		t.Fatalf("decode catalog fixture: %v", err)
	}
	var latest LatestReleaseResponse
	if err := json.Unmarshal([]byte(validLatestResponse), &latest); err != nil {
		t.Fatalf("decode release fixture: %v", err)
	}
	preview := InstallPreview{
		Release:               latest.Data,
		ReleaseRef:            latest.Data.PublisherReleaseRef.ReleaseRef,
		TransportAssets:       slices.Clone(latest.Data.TransportAssets),
		Compatibility:         latest.Data.Compatibility,
		SecuritySummary:       host.ExternalPackageSecuritySummary{SummarySHA256: "sha256:" + strings.Repeat("a", 64)},
		ReleaseIdentityDigest: latest.Data.ReleaseIdentityDigest,
		ManifestSHA256:        "sha256:" + strings.Repeat("b", 64),
		ContractSetSHA256:     "sha256:" + strings.Repeat("c", 64),
		SummarySHA256:         "sha256:" + strings.Repeat("a", 64),
	}
	catalog.Data[0].Latest.InstallPreview = &preview
	raw, err := json.Marshal(catalog)
	if err != nil {
		t.Fatalf("encode catalog fixture: %v", err)
	}
	return string(raw)
}

func TestValidateLatestReleaseAcceptsInstallPreviewEvidence(t *testing.T) {
	var release LatestRelease
	if err := json.Unmarshal([]byte(validLatestResponse), &struct {
		Data *LatestRelease `json:"data"`
	}{Data: &release}); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	preview := InstallPreview{
		Release:               release,
		ReleaseRef:            release.PublisherReleaseRef.ReleaseRef,
		TransportAssets:       slices.Clone(release.TransportAssets),
		Compatibility:         release.Compatibility,
		SecuritySummary:       host.ExternalPackageSecuritySummary{SummarySHA256: "sha256:" + strings.Repeat("a", 64)},
		ReleaseIdentityDigest: release.ReleaseIdentityDigest,
		ManifestSHA256:        "sha256:" + strings.Repeat("b", 64),
		ContractSetSHA256:     "sha256:" + strings.Repeat("c", 64),
		SummarySHA256:         "sha256:" + strings.Repeat("a", 64),
	}
	release.InstallPreview = &preview
	if err := validateLatestRelease(release); err != nil {
		t.Fatalf("validateLatestRelease() error = %v", err)
	}

	preview.ReleaseIdentityDigest = "sha256:" + strings.Repeat("d", 64)
	release.InstallPreview = &preview
	if err := validateLatestRelease(release); err == nil {
		t.Fatal("validateLatestRelease() accepted mismatched preview identity")
	}
}

func TestServiceRefreshesAndKeepsValidatedCacheSeparate(t *testing.T) {
	t.Parallel()
	cachePath := filepath.Join(t.TempDir(), "plugin-market-lkg.json")
	now := time.Date(2026, 8, 1, 8, 30, 0, 0, time.UTC)
	transport := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		switch request.URL.Path {
		case "/v1/catalog":
			if request.URL.Query().Get("redeven_version") != "1.2.3" || request.URL.Query().Get("redevplugin_version") != "3.0.9" {
				t.Fatalf("catalog compatibility query = %q", request.URL.RawQuery)
			}
			return response(http.StatusOK, catalogResponseWithInstallPreview(t), http.Header{"Etag": {`"catalog-g7"`}}), nil
		default:
			return response(http.StatusNotFound, `{}`, nil), nil
		}
	})
	service, err := NewService(ServiceOptions{
		Origin:             "https://plugins.redeven.com",
		CachePath:          cachePath,
		HTTPClient:         &http.Client{Transport: transport},
		Now:                func() time.Time { return now },
		RedevenVersion:     "v1.2.3",
		ReDevPluginVersion: "3.0.9",
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}

	snapshot, err := service.Refresh(context.Background())
	if err != nil {
		t.Fatalf("Refresh() error = %v", err)
	}
	if snapshot.Stale || snapshot.Generation != 7 || snapshot.ETag != `"catalog-g7"` || len(snapshot.Plugins) != 1 {
		t.Fatalf("unexpected live snapshot: %#v", snapshot)
	}
	if snapshot.Plugins[0].Release == nil || snapshot.Plugins[0].Release.Version != "4.0.0" {
		t.Fatalf("missing exact latest release: %#v", snapshot.Plugins[0])
	}
	if snapshot.Plugins[0].Presentation.Icon == nil || snapshot.Plugins[0].Presentation.Icon.SHA256 != "949adb221cd3e990ebe350947cc17d1b415d6175f99df98aeb5c47d70fb3cce1" {
		t.Fatalf("missing verified market icon: %#v", snapshot.Plugins[0].Presentation.Icon)
	}

	offline, err := NewService(ServiceOptions{
		Origin:    "https://plugins.redeven.com",
		CachePath: cachePath,
		HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return nil, errors.New("offline")
		})},
		Now: func() time.Time { return now.Add(time.Hour) },
	})
	if err != nil {
		t.Fatalf("NewService(offline) error = %v", err)
	}
	if local, ok := offline.CachedSnapshot(); !ok || !local.Stale || local.Source != SnapshotSourceCache {
		t.Fatalf("CachedSnapshot() = %#v, %v", local, ok)
	}
	if _, err := offline.Refresh(context.Background()); err == nil || !strings.Contains(err.Error(), "offline") {
		t.Fatalf("offline Refresh() error = %v", err)
	}
}

func TestServiceRefreshUsesCatalogInstallPreviewWithoutLatestRequest(t *testing.T) {
	t.Parallel()
	var requestedPaths []string
	transport := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requestedPaths = append(requestedPaths, request.URL.Path)
		return response(http.StatusOK, catalogResponseWithInstallPreview(t), nil), nil
	})
	service, err := NewService(ServiceOptions{
		Origin: "https://plugins.redeven.com", CachePath: filepath.Join(t.TempDir(), "market.json"),
		HTTPClient: &http.Client{Transport: transport},
	})
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := service.Refresh(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(requestedPaths, []string{"/v1/catalog"}) {
		t.Fatalf("requested paths = %v", requestedPaths)
	}
	if len(snapshot.Plugins) != 1 || snapshot.Plugins[0].Release == nil || snapshot.Plugins[0].Release.Version != "4.0.0" {
		t.Fatalf("snapshot release = %#v", snapshot.Plugins)
	}
}

func TestServiceRefreshRejectsVisibleReleaseWithoutInstallPreview(t *testing.T) {
	t.Parallel()
	service, err := NewService(ServiceOptions{
		Origin:    "https://plugins.redeven.com",
		CachePath: filepath.Join(t.TempDir(), "market.json"),
		HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return response(http.StatusOK, validCatalogResponse, nil), nil
		})},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Refresh(context.Background()); !errors.Is(err, ErrInvalidResponse) || !strings.Contains(err.Error(), "install preview") {
		t.Fatalf("Refresh() error = %v", err)
	}
}

func TestServiceRefreshDoesNotReplaceCacheWithOlderGeneration(t *testing.T) {
	t.Parallel()
	cachePath := filepath.Join(t.TempDir(), "market.json")
	requestCount := 0
	service, err := NewService(ServiceOptions{
		Origin:    "https://plugins.redeven.com",
		CachePath: cachePath,
		HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			requestCount++
			body := catalogResponseWithInstallPreview(t)
			if requestCount == 1 {
				body = strings.Replace(body, `"generation":7`, `"generation":9`, 1)
			}
			return response(http.StatusOK, body, nil), nil
		})},
	})
	if err != nil {
		t.Fatal(err)
	}
	first, err := service.Refresh(context.Background())
	if err != nil || first.Generation != 9 {
		t.Fatalf("first Refresh() = %#v, %v", first, err)
	}
	if _, err := service.Refresh(context.Background()); !errors.Is(err, ErrInvalidResponse) || !strings.Contains(err.Error(), "moved backwards") {
		t.Fatalf("older Refresh() error = %v", err)
	}

	reloaded, err := NewService(ServiceOptions{Origin: "https://plugins.redeven.com", CachePath: cachePath})
	if err != nil {
		t.Fatal(err)
	}
	cached, ok := reloaded.CachedSnapshot()
	if !ok || cached.Generation != 9 {
		t.Fatalf("CachedSnapshot() = %#v, %t", cached, ok)
	}
}

func TestServiceDetailReturnsMarketGeneration(t *testing.T) {
	t.Parallel()
	service, err := NewService(ServiceOptions{
		Origin:    "https://plugins.redeven.com",
		CachePath: filepath.Join(t.TempDir(), "plugin-market-lkg.json"),
		HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			if request.URL.Path != "/v1/plugins/com.example.metrics" {
				return response(http.StatusNotFound, `{}`, nil), nil
			}
			return response(http.StatusOK, validDetailResponse, nil), nil
		})},
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	detail, generation, err := service.Detail(context.Background(), "com.example.metrics")
	if err != nil {
		t.Fatalf("Detail() error = %v", err)
	}
	if generation != 41 || detail.PluginID != "com.example.metrics" {
		t.Fatalf("detail = %#v, generation = %d", detail, generation)
	}
	if detail.Presentation.Icon == nil || detail.Presentation.Icon.SHA256 != "949adb221cd3e990ebe350947cc17d1b415d6175f99df98aeb5c47d70fb3cce1" {
		t.Fatalf("detail icon = %#v", detail.Presentation.Icon)
	}
}

func TestServiceDetailRejectsStaleGeneration(t *testing.T) {
	t.Parallel()
	stale := strings.Replace(validDetailResponse, `"stale": false`, `"stale": true`, 1)
	service, err := NewService(ServiceOptions{
		Origin:    "https://plugins.redeven.com",
		CachePath: filepath.Join(t.TempDir(), "plugin-market-lkg.json"),
		HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return response(http.StatusOK, stale, nil), nil
		})},
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	if _, generation, err := service.Detail(context.Background(), "com.example.metrics"); !errors.Is(err, ErrInvalidResponse) || generation != -1 {
		t.Fatalf("Detail() error = %v, generation = %d", err, generation)
	}
}

func TestServiceIconReturnsEvidenceBoundBytes(t *testing.T) {
	t.Parallel()
	data := []byte("verified market icon")
	digest := fmt.Sprintf("%x", sha256.Sum256(data))
	icon := PresentationIcon{
		URL:       "/v1/plugins/com.example.metrics/icon?sha256=" + digest,
		MediaType: "image/png",
		Width:     128,
		Height:    128,
		SHA256:    digest,
	}
	service, err := NewService(ServiceOptions{
		Origin:    "https://plugins.redeven.com",
		CachePath: filepath.Join(t.TempDir(), "plugin-market-lkg.json"),
		HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			if request.URL.Path != "/v1/plugins/com.example.metrics/icon" || request.URL.Query().Get("sha256") != digest {
				t.Fatalf("request URL = %s", request.URL)
			}
			return response(http.StatusOK, string(data), http.Header{"Content-Type": {"image/png"}}), nil
		})},
	})
	if err != nil {
		t.Fatal(err)
	}
	asset, err := service.Icon(context.Background(), "com.example.metrics", icon)
	if err != nil {
		t.Fatalf("Icon() error = %v", err)
	}
	if string(asset.Data) != string(data) || asset.MediaType != icon.MediaType || asset.SHA256 != digest {
		t.Fatalf("asset = %#v", asset)
	}
}

func TestServiceIconRejectsUnverifiedResponses(t *testing.T) {
	t.Parallel()
	data := []byte("verified market icon")
	digest := fmt.Sprintf("%x", sha256.Sum256(data))
	icon := PresentationIcon{
		URL:       "/v1/plugins/com.example.metrics/icon?sha256=" + digest,
		MediaType: "image/png",
		Width:     128,
		Height:    128,
		SHA256:    digest,
	}
	tests := []struct {
		name     string
		response func(*http.Request) *http.Response
	}{
		{name: "digest mismatch", response: func(*http.Request) *http.Response {
			return response(http.StatusOK, "different bytes", http.Header{"Content-Type": {"image/png"}})
		}},
		{name: "oversized body", response: func(*http.Request) *http.Response {
			return response(http.StatusOK, strings.Repeat("x", maxMarketIcon+1), http.Header{"Content-Type": {"image/png"}})
		}},
		{name: "wrong content type", response: func(*http.Request) *http.Response {
			return response(http.StatusOK, string(data), http.Header{"Content-Type": {"image/webp"}})
		}},
		{name: "redirected response", response: func(*http.Request) *http.Response {
			result := response(http.StatusOK, string(data), http.Header{"Content-Type": {"image/png"}})
			result.Request = &http.Request{URL: &url.URL{Scheme: "https", Host: "other.invalid", Path: "/icon"}}
			return result
		}},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			service, err := NewService(ServiceOptions{
				Origin:    "https://plugins.redeven.com",
				CachePath: filepath.Join(t.TempDir(), "plugin-market-lkg.json"),
				HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
					return testCase.response(request), nil
				})},
			})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := service.Icon(context.Background(), "com.example.metrics", icon); !errors.Is(err, ErrInvalidResponse) {
				t.Fatalf("Icon() error = %v, want ErrInvalidResponse", err)
			}
		})
	}
}

func TestServiceIconRejectsInvalidEvidenceBeforeRequest(t *testing.T) {
	t.Parallel()
	called := false
	service, err := NewService(ServiceOptions{
		Origin:    "https://plugins.redeven.com",
		CachePath: filepath.Join(t.TempDir(), "plugin-market-lkg.json"),
		HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			called = true
			return response(http.StatusOK, "icon", http.Header{"Content-Type": {"image/png"}}), nil
		})},
	})
	if err != nil {
		t.Fatal(err)
	}
	invalid := PresentationIcon{URL: "/v1/plugins/com.example.plugin/icon?sha256=abc", MediaType: "image/png", Width: 128, Height: 128, SHA256: "abc"}
	if _, err := service.Icon(context.Background(), "BadPlugin", invalid); !errors.Is(err, ErrInvalidResponse) || called {
		t.Fatalf("Icon() error = %v, request called = %t", err, called)
	}
}

func TestServiceRejectsUnknownFieldsWithoutReplacingCache(t *testing.T) {
	t.Parallel()
	invalid := strings.Replace(validCatalogResponse, `"generation": 7`, `"generation": 7, "unexpected": true`, 1)
	service, err := NewService(ServiceOptions{
		Origin:    "https://plugins.redeven.com",
		CachePath: filepath.Join(t.TempDir(), "plugin-market-lkg.json"),
		HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return response(http.StatusOK, invalid, nil), nil
		})},
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	if _, err := service.Refresh(context.Background()); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("Refresh() error = %v, want ErrInvalidResponse", err)
	}
}

func TestServiceRejectsNonCanonicalOrDuplicatePresentation(t *testing.T) {
	t.Parallel()
	invalid := strings.ReplaceAll(validCatalogResponse, `"en-US"`, `"en-us"`)
	invalid = strings.Replace(invalid, `"keywords": ["metrics", "monitoring"]`, `"keywords": ["metrics", "METRICS"]`, 1)
	service, err := NewService(ServiceOptions{
		Origin:    "https://plugins.redeven.com",
		CachePath: filepath.Join(t.TempDir(), "plugin-market-lkg.json"),
		HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return response(http.StatusOK, invalid, nil), nil
		})},
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	if _, err := service.Refresh(context.Background()); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("Refresh() error = %v, want ErrInvalidResponse", err)
	}
}

func TestPresentationValidationRejectsUnsafeAndIncompleteFields(t *testing.T) {
	t.Parallel()

	compact := PresentationCompact{
		DefaultLocale: "en-US",
		Locales: []PresentationCompactLocale{
			{Locale: "en-US", Name: "Example", PublisherName: "Publisher", Summary: "Summary", Keywords: []string{"example"}},
			{Locale: "zh-CN", Name: "示例", PublisherName: "发布者", Summary: "摘要", Keywords: []string{"示例"}},
		},
	}
	compactCases := []struct {
		name   string
		mutate func(*PresentationCompact)
	}{
		{name: "C1 control character", mutate: func(value *PresentationCompact) { value.Locales[0].Summary = "bad\u0085text" }},
		{name: "missing localized publisher", mutate: func(value *PresentationCompact) { value.Locales[1].PublisherName = "" }},
		{name: "summary too long", mutate: func(value *PresentationCompact) { value.Locales[0].Summary = strings.Repeat("s", 241) }},
		{name: "keyword too long", mutate: func(value *PresentationCompact) { value.Locales[0].Keywords[0] = strings.Repeat("k", 65) }},
	}
	for _, testCase := range compactCases {
		t.Run(testCase.name, func(t *testing.T) {
			candidate := compact
			candidate.Locales = append([]PresentationCompactLocale(nil), compact.Locales...)
			candidate.Locales[0].Keywords = append([]string(nil), compact.Locales[0].Keywords...)
			candidate.Locales[1].Keywords = append([]string(nil), compact.Locales[1].Keywords...)
			testCase.mutate(&candidate)
			if validateCompactPresentation(candidate, "com.example.plugin") {
				t.Fatal("validateCompactPresentation accepted invalid presentation")
			}
		})
	}

	full := validFullPresentationForTest()
	full.Locales[1].PublisherName = ""
	if validateFullPresentation(full, "com.example.plugin") {
		t.Fatal("validateFullPresentation accepted incomplete publisher localization")
	}
	full = validFullPresentationForTest()
	full.Locales[0].Description[0] = strings.Repeat("d", 1001)
	if validateFullPresentation(full, "com.example.plugin") {
		t.Fatal("validateFullPresentation accepted an overlong paragraph")
	}
}

func validFullPresentationForTest() PresentationFull {
	return PresentationFull{
		DefaultLocale: "en-US",
		Locales: []PresentationFullLocale{
			{
				Locale: "en-US", Name: "Example", PublisherName: "Publisher", Summary: "Summary",
				Description: []string{"Description"}, Highlights: []string{"Highlight"}, Keywords: []string{"example"},
				Surfaces: []PresentationSurface{{SurfaceID: "example.main", Label: "Example"}},
				Settings: []PresentationSetting{{Key: "mode", Label: "Mode", Options: []PresentationSettingOption{{Value: "safe", Label: "Safe"}}}},
			},
			{
				Locale: "zh-CN", Name: "示例", PublisherName: "发布者", Summary: "摘要",
				Description: []string{"介绍"}, Highlights: []string{"亮点"}, Keywords: []string{"示例"},
				Surfaces: []PresentationSurface{{SurfaceID: "example.main", Label: "示例"}},
				Settings: []PresentationSetting{{Key: "mode", Label: "模式", Options: []PresentationSettingOption{{Value: "safe", Label: "安全"}}}},
			},
		},
	}
}

func TestCatalogInstallPreviewBuildsCompleteRemoteProjection(t *testing.T) {
	t.Parallel()
	service, err := NewService(ServiceOptions{
		Origin:    "https://plugins.redeven.com",
		CachePath: filepath.Join(t.TempDir(), "plugin-market-lkg.json"),
		HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			if request.URL.Path == "/v1/catalog" {
				return response(http.StatusOK, catalogResponseWithInstallPreview(t), nil), nil
			}
			return response(http.StatusNotFound, `{}`, nil), nil
		})},
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	snapshot, err := service.Refresh(context.Background())
	if err != nil {
		t.Fatalf("Refresh() error = %v", err)
	}
	release, err := snapshot.LatestRelease("com.example.metrics", "stable")
	if err != nil {
		t.Fatalf("LatestRelease() error = %v", err)
	}
	ref, assets, err := release.RemoteProjection()
	if err != nil {
		t.Fatalf("RemoteProjection() error = %v", err)
	}
	if ref.SourceID != "redeven_official" || ref.Version != "4.0.0" || len(assets) != 3 {
		t.Fatalf("unexpected remote projection: ref=%#v assets=%#v", ref, assets)
	}
	if assets[0].Locator >= assets[1].Locator {
		t.Fatalf("remote assets are not stable-sorted: %#v", assets)
	}
}
