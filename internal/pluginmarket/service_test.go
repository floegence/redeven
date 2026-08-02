package pluginmarket

import (
	"context"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const validCatalogResponse = `{
  "data": [{
    "plugin_id": "com.redeven.official.containers",
    "publisher_id": "com.redeven.official",
    "presentation": {
      "default_locale": "en-US",
      "locales": [
        {"locale": "en-US", "name": "Containers", "publisher_name": "Redeven Official", "summary": "Manage Docker and Podman resources.", "keywords": ["containers", "Docker"]},
        {"locale": "zh-CN", "name": "容器", "publisher_name": "Redeven 官方", "summary": "管理 Docker 和 Podman 资源。", "keywords": ["容器", "Docker"]}
      ]
    },
    "categories": ["infrastructure"],
    "channels": ["stable"],
    "latest": {"channel": "stable", "version": "4.0.0", "availability_status": "visible"}
  }],
  "meta": {"request_id": "req_catalog", "generation": 7, "stale": false}
}`

const validLatestResponse = `{
  "data": {
    "plugin_id": "com.redeven.official.containers",
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
      "name": "containers-4.0.0.redevplugin",
      "url": "https://github.com/floegence/redeven-official-plugins/releases/download/v4.0.0/containers-4.0.0.redevplugin",
      "size": 409266,
      "sha256": "3dd8cc3fc30c347d6276b88ece0913ad8f15cd762704e7902ba6290351bb5e3c"
    },
    "release_ref": {
      "asset_id": 497702092,
      "name": "containers-4.0.0.release-ref.json",
      "url": "https://github.com/floegence/redeven-official-plugins/releases/download/v4.0.0/containers-4.0.0.release-ref.json",
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
        "release_metadata_ref": "plugins/com.redeven.official/com.redeven.official.containers/4.0.0/release.json",
        "release_metadata_sha256": "921d7a2ca42e8faf52a26f2b0ca7768e62317c2d0859ceea5858cce218d2dadd",
        "publisher_id": "com.redeven.official",
        "plugin_id": "com.redeven.official.containers",
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
      "signing_ledger": {
        "log_id": "redeven_official_signing_log",
        "algorithm": "ed25519",
        "key_id": "redeven_official_ledger_2026",
        "public_key": "CjQqXNS/mR2MgLwWPhTLee6G5ay1XQ4J/bIgw2djtQY="
      },
      "files": [
        {
          "locator": "plugins/com.redeven.official/com.redeven.official.containers/4.0.0/package.redevplugin",
          "asset_name": "containers-4.0.0.redevplugin",
          "sha256": "3dd8cc3fc30c347d6276b88ece0913ad8f15cd762704e7902ba6290351bb5e3c",
          "size": 409266
        },
        {
          "locator": "plugins/com.redeven.official/com.redeven.official.containers/4.0.0/release.json",
          "asset_name": "containers-4.0.0.release.json",
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
        "locator": "plugins/com.redeven.official/com.redeven.official.containers/4.0.0/package.redevplugin",
        "asset_id": 497702097,
        "name": "containers-4.0.0.redevplugin",
        "url": "https://github.com/floegence/redeven-official-plugins/releases/download/v4.0.0/containers-4.0.0.redevplugin",
        "size": 409266,
        "sha256": "3dd8cc3fc30c347d6276b88ece0913ad8f15cd762704e7902ba6290351bb5e3c"
      },
      {
        "locator": "plugins/com.redeven.official/com.redeven.official.containers/4.0.0/release.json",
        "asset_id": 497702096,
        "name": "containers-4.0.0.release.json",
        "url": "https://github.com/floegence/redeven-official-plugins/releases/download/v4.0.0/containers-4.0.0.release.json",
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
    "signer_key_id": "redeven_official_signing_2026",
    "compatibility": {"min_redeven_version": "1.0.0", "min_redevplugin_version": "0.6.22"},
    "release_identity_digest": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  },
  "meta": {"request_id": "req_latest", "generation": 7, "stale": false}
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

func TestServiceRefreshesAndFallsBackToValidatedCache(t *testing.T) {
	t.Parallel()
	cachePath := filepath.Join(t.TempDir(), "plugin-market-lkg.json")
	now := time.Date(2026, 8, 1, 8, 30, 0, 0, time.UTC)
	transport := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		switch request.URL.Path {
		case "/v1/catalog":
			return response(http.StatusOK, validCatalogResponse, http.Header{"Etag": {`"catalog-g7"`}}), nil
		case "/v1/plugins/com.redeven.official.containers/latest":
			return response(http.StatusOK, validLatestResponse, nil), nil
		default:
			return response(http.StatusNotFound, `{}`, nil), nil
		}
	})
	service, err := NewService(ServiceOptions{
		Origin:     "https://plugins.redeven.com",
		CachePath:  cachePath,
		HTTPClient: &http.Client{Transport: transport},
		Now:        func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}

	snapshot, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("Snapshot() error = %v", err)
	}
	if snapshot.Stale || snapshot.Generation != 7 || snapshot.ETag != `"catalog-g7"` || len(snapshot.Plugins) != 1 {
		t.Fatalf("unexpected live snapshot: %#v", snapshot)
	}
	if snapshot.Plugins[0].Release == nil || snapshot.Plugins[0].Release.Version != "4.0.0" {
		t.Fatalf("missing exact latest release: %#v", snapshot.Plugins[0])
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
	cached, err := offline.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("offline Snapshot() error = %v", err)
	}
	if !cached.Stale || cached.Source != SnapshotSourceCache || cached.CachedAt != now {
		t.Fatalf("unexpected cached snapshot: %#v", cached)
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
	if _, err := service.Snapshot(context.Background()); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("Snapshot() error = %v, want ErrInvalidResponse", err)
	}
}

func TestServiceRejectsNonCanonicalOrDuplicatePresentation(t *testing.T) {
	t.Parallel()
	invalid := strings.ReplaceAll(validCatalogResponse, `"en-US"`, `"en-us"`)
	invalid = strings.Replace(invalid, `"keywords": ["containers", "Docker"]`, `"keywords": ["containers", "CONTAINERS"]`, 1)
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
	if _, err := service.Snapshot(context.Background()); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("Snapshot() error = %v, want ErrInvalidResponse", err)
	}
}

func TestLatestReleaseBuildsCompleteRemoteProjection(t *testing.T) {
	t.Parallel()
	service, err := NewService(ServiceOptions{
		Origin:    "https://plugins.redeven.com",
		CachePath: filepath.Join(t.TempDir(), "plugin-market-lkg.json"),
		HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			if request.URL.Path == "/v1/catalog" {
				return response(http.StatusOK, validCatalogResponse, nil), nil
			}
			return response(http.StatusOK, validLatestResponse, nil), nil
		})},
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	release, err := service.LatestRelease(context.Background(), "com.redeven.official.containers", "stable")
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
