package appserver

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/pluginmarket"
)

const pluginMarketCatalogPath = "/_redeven_proxy/api/plugins/market/catalog"
const pluginMarketDetailPath = "/_redeven_proxy/api/plugins/market/plugins/com.example.plugin"

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
		pluginMarketDetail: func(_ context.Context, pluginID string) (pluginmarket.PluginDetail, error) {
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
			}, nil
		},
	}
	response := performPluginMarketRequest(server, func(request *http.Request) *http.Request {
		request.URL.Path = pluginMarketDetailPath
		return WithLocalUIEnvRoute(request)
	})
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", response.Code, response.Body.String())
	}
	var envelope struct {
		OK   bool                      `json:"ok"`
		Data pluginmarket.PluginDetail `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if !envelope.OK || envelope.Data.Presentation.DefaultLocale != "en-US" || envelope.Data.Presentation.Locales[0].Description[0] != "Example description." {
		t.Fatalf("detail = %#v", envelope.Data)
	}
}
