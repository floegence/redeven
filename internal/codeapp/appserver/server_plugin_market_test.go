package appserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/pluginmarket"
)

const pluginMarketCatalogPath = "/_redeven_proxy/api/plugins/market/catalog"
const pluginMarketDetailPath = "/_redeven_proxy/api/plugins/market/plugins/com.example.plugin?generation=41"
const pluginMarketIconDigest = "949adb221cd3e990ebe350947cc17d1b415d6175f99df98aeb5c47d70fb3cce1"
const pluginMarketIconPath = "/_redeven_proxy/api/plugins/market/plugins/com.example.plugin/icon?sha256=" + pluginMarketIconDigest

func performPluginMarketRequest(server *Server, route func(*http.Request) *http.Request) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, pluginMarketCatalogPath, nil)
	if route != nil {
		request = route(request)
	}
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	return response
}

func TestServerPluginMarketCatalogReturnsFrozenSnapshot(t *testing.T) {
	t.Parallel()

	cachedAt := time.Date(2026, 8, 1, 8, 30, 0, 0, time.UTC)
	want := pluginmarket.Snapshot{
		SchemaVersion: pluginmarket.SnapshotSchemaVersion,
		Generation:    41,
		ETag:          `"catalog-g41"`,
		CachedAt:      cachedAt,
		Stale:         true,
		Source:        pluginmarket.SnapshotSourceCache,
		Plugins:       []pluginmarket.CatalogPlugin{},
	}
	cap := config.PermissionSet{Read: true}
	server := &Server{
		localPermissionCap: &cap,
		pluginMarketSnapshot: func() (pluginmarket.Snapshot, bool) {
			return want, true
		},
	}

	response := performPluginMarketRequest(server, WithLocalUIEnvRoute)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	var envelope struct {
		OK   bool                  `json:"ok"`
		Data pluginmarket.Snapshot `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !envelope.OK || envelope.Data.Generation != want.Generation || envelope.Data.ETag != want.ETag ||
		!envelope.Data.CachedAt.Equal(cachedAt) || envelope.Data.Stale != want.Stale || envelope.Data.Source != want.Source {
		t.Fatalf("snapshot = %#v, want %#v", envelope.Data, want)
	}
}

func TestServerPluginMarketCatalogFailsClosed(t *testing.T) {
	t.Parallel()

	t.Run("read permission", func(t *testing.T) {
		cap := config.PermissionSet{Read: false}
		called := false
		server := &Server{
			localPermissionCap: &cap,
			pluginMarketSnapshot: func() (pluginmarket.Snapshot, bool) {
				called = true
				return pluginmarket.Snapshot{}, true
			},
		}
		response := performPluginMarketRequest(server, WithLocalUIEnvRoute)
		if response.Code != http.StatusForbidden || called {
			t.Fatalf("status = %d, callback called = %t", response.Code, called)
		}
	})

	t.Run("unavailable snapshot", func(t *testing.T) {
		cap := config.PermissionSet{Read: true}
		server := &Server{
			localPermissionCap: &cap,
			pluginMarketSnapshot: func() (pluginmarket.Snapshot, bool) {
				return pluginmarket.Snapshot{}, false
			},
		}
		response := performPluginMarketRequest(server, WithLocalUIEnvRoute)
		if response.Code != http.StatusServiceUnavailable {
			t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusServiceUnavailable, response.Body.String())
		}
	})

	t.Run("codespace isolation", func(t *testing.T) {
		cap := config.PermissionSet{Read: true}
		called := false
		server := &Server{
			localPermissionCap: &cap,
			pluginMarketSnapshot: func() (pluginmarket.Snapshot, bool) {
				called = true
				return pluginmarket.Snapshot{}, true
			},
		}
		response := performPluginMarketRequest(server, func(request *http.Request) *http.Request {
			return WithLocalUICodeSpaceRoute(request, "workspace")
		})
		if response.Code != http.StatusNotFound || called {
			t.Fatalf("status = %d, callback called = %t", response.Code, called)
		}
	})
}

func TestServerPluginMarketDetailReturnsManifestPresentation(t *testing.T) {
	t.Parallel()
	cap := config.PermissionSet{Read: true}
	server := &Server{
		localPermissionCap: &cap,
		pluginMarketDetail: func(_ context.Context, pluginID string) (pluginmarket.PluginDetail, int64, error) {
			if pluginID != "com.example.plugin" {
				t.Fatalf("plugin id = %q", pluginID)
			}
			return pluginmarket.PluginDetail{
				PluginID:    pluginID,
				PublisherID: "com.example.publisher",
				Presentation: pluginmarket.PresentationFull{
					DefaultLocale: "en-US",
					Locales:       []pluginmarket.PresentationFullLocale{{Locale: "en-US", Name: "Example", Summary: "Example summary.", Description: []string{"Example description."}, Keywords: []string{"example"}}},
				},
				Status: "active",
			}, 41, nil
		},
	}
	response := performPluginMarketRequest(server, func(request *http.Request) *http.Request {
		request.URL.Path, request.URL.RawQuery, _ = strings.Cut(pluginMarketDetailPath, "?")
		return WithLocalUIEnvRoute(request)
	})
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", response.Code, response.Body.String())
	}
	var envelope struct {
		OK   bool `json:"ok"`
		Meta struct {
			Generation int64 `json:"generation"`
		} `json:"meta"`
		Data pluginmarket.PluginDetail `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if !envelope.OK || envelope.Meta.Generation != 41 || envelope.Data.Presentation.DefaultLocale != "en-US" || envelope.Data.Presentation.Locales[0].Description[0] != "Example description." {
		t.Fatalf("detail = %#v", envelope.Data)
	}
}

func TestServerPluginMarketDetailRequiresMatchingGeneration(t *testing.T) {
	t.Parallel()
	cap := config.PermissionSet{Read: true}
	tests := []struct {
		name       string
		path       string
		generation int64
		wantStatus int
	}{
		{name: "missing", path: strings.Split(pluginMarketDetailPath, "?")[0], generation: 41, wantStatus: http.StatusBadRequest},
		{name: "duplicate", path: pluginMarketDetailPath + "&generation=41", generation: 41, wantStatus: http.StatusBadRequest},
		{name: "invalid", path: strings.Replace(pluginMarketDetailPath, "41", "latest", 1), generation: 41, wantStatus: http.StatusBadRequest},
		{name: "mismatch", path: pluginMarketDetailPath, generation: 42, wantStatus: http.StatusConflict},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			server := &Server{
				localPermissionCap: &cap,
				pluginMarketDetail: func(_ context.Context, pluginID string) (pluginmarket.PluginDetail, int64, error) {
					return pluginmarket.PluginDetail{PluginID: pluginID}, testCase.generation, nil
				},
			}
			response := performPluginMarketRequest(server, func(request *http.Request) *http.Request {
				request.URL.Path, request.URL.RawQuery, _ = strings.Cut(testCase.path, "?")
				return WithLocalUIEnvRoute(request)
			})
			if response.Code != testCase.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", response.Code, testCase.wantStatus, response.Body.String())
			}
		})
	}
}

func TestServerPluginMarketIconReturnsVerifiedAsset(t *testing.T) {
	t.Parallel()
	cap := config.PermissionSet{Read: true}
	want := []byte("verified icon")
	server := &Server{
		localPermissionCap: &cap,
		pluginMarketIcon: func(_ context.Context, pluginID, digest string) (pluginmarket.IconAsset, error) {
			if pluginID != "com.example.plugin" || digest != pluginMarketIconDigest {
				t.Fatalf("icon identity = %q %q", pluginID, digest)
			}
			return pluginmarket.IconAsset{Data: want, MediaType: "image/png", SHA256: digest}, nil
		},
	}
	request := httptest.NewRequest(http.MethodGet, pluginMarketIconPath, nil)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, WithLocalUIEnvRoute(request))
	if response.Code != http.StatusOK || !bytes.Equal(response.Body.Bytes(), want) {
		t.Fatalf("status = %d body = %q", response.Code, response.Body.Bytes())
	}
	if got := response.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("Content-Type = %q", got)
	}
	if got := response.Header().Get("ETag"); got != `"sha256:`+pluginMarketIconDigest+`"` {
		t.Fatalf("ETag = %q", got)
	}
	if response.Header().Get("X-Content-Type-Options") != "nosniff" || !strings.Contains(response.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("security headers = %#v", response.Header())
	}
}

func TestServerPluginMarketIconFailsClosed(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		path       string
		permission bool
		codespace  bool
		callback   func(context.Context, string, string) (pluginmarket.IconAsset, error)
		wantStatus int
	}{
		{name: "read permission", path: pluginMarketIconPath, wantStatus: http.StatusForbidden},
		{name: "codespace isolation", path: pluginMarketIconPath, permission: true, codespace: true, wantStatus: http.StatusNotFound},
		{name: "missing digest", path: strings.Split(pluginMarketIconPath, "?")[0], permission: true, wantStatus: http.StatusBadRequest},
		{name: "duplicate digest", path: pluginMarketIconPath + "&sha256=" + pluginMarketIconDigest, permission: true, wantStatus: http.StatusBadRequest},
		{name: "extra query", path: pluginMarketIconPath + "&download=1", permission: true, wantStatus: http.StatusBadRequest},
		{name: "invalid plugin id", path: strings.Replace(pluginMarketIconPath, "com.example.plugin", "BadPlugin", 1), permission: true, wantStatus: http.StatusBadRequest},
		{name: "invalid digest", path: strings.Replace(pluginMarketIconPath, pluginMarketIconDigest, "abc", 1), permission: true, wantStatus: http.StatusBadRequest},
		{name: "upstream failure", path: pluginMarketIconPath, permission: true, callback: func(context.Context, string, string) (pluginmarket.IconAsset, error) {
			return pluginmarket.IconAsset{}, errors.New("sensitive upstream failure")
		}, wantStatus: http.StatusServiceUnavailable},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			called := false
			callback := testCase.callback
			if callback == nil {
				callback = func(context.Context, string, string) (pluginmarket.IconAsset, error) {
					called = true
					return pluginmarket.IconAsset{Data: []byte("icon"), MediaType: "image/png", SHA256: pluginMarketIconDigest}, nil
				}
			}
			cap := config.PermissionSet{Read: testCase.permission}
			server := &Server{localPermissionCap: &cap, pluginMarketIcon: callback}
			request := httptest.NewRequest(http.MethodGet, testCase.path, nil)
			if testCase.codespace {
				request = WithLocalUICodeSpaceRoute(request, "workspace")
			} else {
				request = WithLocalUIEnvRoute(request)
			}
			response := httptest.NewRecorder()
			server.ServeHTTP(response, request)
			if response.Code != testCase.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", response.Code, testCase.wantStatus, response.Body.String())
			}
			if testCase.wantStatus != http.StatusOK && strings.Contains(response.Body.String(), "sensitive upstream failure") {
				t.Fatalf("response disclosed upstream error: %s", response.Body.String())
			}
			if !testCase.permission || testCase.codespace || strings.Contains(testCase.name, "digest") || strings.Contains(testCase.name, "query") || strings.Contains(testCase.name, "plugin id") {
				if called {
					t.Fatal("invalid request reached icon callback")
				}
			}
		})
	}
}
