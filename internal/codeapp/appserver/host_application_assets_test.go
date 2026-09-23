package appserver

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	nativeapps "github.com/floegence/floe-native-apps"
	"github.com/floegence/redeven/internal/hostapps"
	"github.com/floegence/redeven/internal/session"
)

func TestHostApplicationAssetsRequireOriginOwnerPermissionAndExactVersion(t *testing.T) {
	root, _ := filepath.Abs("../../hostapps/testdata/client")
	assets, err := nativeapps.OpenClientAssets(root)
	if err != nil {
		t.Fatal(err)
	}
	route := hostapps.ClientAssetsPath + assets.Digest() + "/js/Client.js"
	for _, tc := range []struct {
		name, origin, owner, state, path, method string
		full                                     bool
		status                                   int
	}{
		{"env", "env-123", "alice", "running", route, "GET", true, 200},
		{"share", "pf-owned", "alice", "running", route, "GET", true, 200},
		{"foreign", "env-123", "bob", "running", route, "GET", true, 404},
		{"read-only", "env-123", "alice", "running", route, "GET", false, 403},
		{"untrusted", "cs-owned", "alice", "running", route, "GET", true, 404},
		{"other-forward", "pf-other", "alice", "running", route, "GET", true, 404},
		{"retired", "pf-owned", "alice", "ended", route, "GET", true, 404},
		{"wrong-version", "env-123", "alice", "running", hostapps.ClientAssetsPath + strings.Repeat("0", 64) + "/js/Client.js", "GET", true, 404},
		{"private", "env-123", "alice", "running", hostapps.ClientAssetsPath + assets.Digest() + "/default-settings.txt", "GET", true, 404},
		{"mutation", "env-123", "alice", "running", route, "POST", true, 405},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := &Server{hostApps: &hostAppsStub{owner: "alice", state: tc.state, assets: assets}, resolveSessionMeta: resolveMetaForTest("ch_assets", session.Meta{UserPublicID: tc.owner, CanRead: true, CanWrite: tc.full, CanExecute: tc.full})}
			req := httptest.NewRequest(tc.method, "http://localhost"+tc.path, nil)
			req.Header.Set("Origin", strings.Replace(envOriginWithChannel("ch_assets"), "env-123", tc.origin, 1))
			req.Header.Set("Accept-Encoding", "gzip")
			w := httptest.NewRecorder()
			server.serveHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			if w.Code != 200 {
				if w.Header().Get("Cache-Control") != "no-store" {
					t.Fatal("denial was cached")
				}
				return
			}
			if !strings.Contains(w.Header().Get("Cache-Control"), "private") || !strings.Contains(w.Header().Get("Cache-Control"), "immutable") || w.Header().Get("Content-Encoding") != "gzip" {
				t.Fatalf("missing resource cache/compression: %v", w.Header())
			}
			z, err := gzip.NewReader(w.Body)
			if err != nil {
				t.Fatal(err)
			}
			body, _ := io.ReadAll(z)
			z.Close()
			if !strings.Contains(string(body), "FLOE_CLIENT_SCRIPT_URL") {
				t.Fatal("missing upstream worker transformation")
			}
			req.Header.Set("If-None-Match", w.Header().Get("ETag"))
			cached := httptest.NewRecorder()
			server.serveHTTP(cached, req)
			if cached.Code != http.StatusNotModified {
				t.Fatalf("conditional response: %d", cached.Code)
			}
			server.resolveSessionMeta = resolveMetaForTest("ch_assets", session.Meta{UserPublicID: "alice", CanRead: true})
			denied := httptest.NewRecorder()
			server.serveHTTP(denied, req)
			if denied.Code != 403 || denied.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("cached validator bypassed revoked permission")
			}
		})
	}
}
