package redevpluginintegration

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
	"github.com/floegence/redevplugin/v3/pkg/host"
	"github.com/floegence/redevplugin/v3/pkg/pluginpkg"
	"github.com/floegence/redevplugin/v3/pkg/sessionctx"
)

func TestOrdinaryPluginSettingsPersistThroughProductRestart(t *testing.T) {
	const channel = "settings_product_channel"
	const origin = "https://env.example.test"
	stateDir := t.TempDir()
	meta := &session.Meta{ChannelID: channel, EndpointID: "settings_env", UserPublicID: "settings_user",
		CodeSpaceID: "env-ui", FloeApp: "com.floegence.redeven.agent", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
	options := ownerScopeTestOptions(t, stateDir)
	options.PermissionPolicy = testPermissionPolicy(t, "execute_read_write")
	options.ResolveSessionMeta = func(id string) (*session.Meta, bool) { return meta, id == channel }
	integration, err := New(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if integration != nil {
			_ = integration.Close()
		}
	})
	request := func(method, path string, body any) map[string]any {
		t.Helper()
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(method, "/_redevplugin/api/plugins"+path, bytes.NewReader(raw))
		req.Host = "env.example.test"
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", origin)
		req.Header.Set(csrfHeader, csrfProof)
		req.Header.Set(sessionhop.HeaderChannelID, channel)
		req = WithRouteRole(req, RouteRoleEnvTrusted)
		req, err = WithTrustedOrigin(req, origin)
		if err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		integration.Handler().ServeHTTP(response, req)
		if response.Code != http.StatusOK {
			t.Fatalf("%s %s: %d %s", method, path, response.Code, response.Body.String())
		}
		var envelope struct {
			OK   bool           `json:"ok"`
			Data map[string]any `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		if !envelope.OK {
			t.Fatalf("request failed: %s", response.Body.String())
		}
		return envelope.Data
	}
	request(http.MethodPost, "/catalog/query", map[string]any{})
	resolved, err := canonicalPluginSessionContextFromMeta(channel, meta)
	if err != nil {
		t.Fatal(err)
	}
	permissionCap := options.PermissionPolicy.ResolveCap(meta.UserPublicID, meta.FloeApp)
	resolved.CanRead = meta.CanRead && permissionCap.Read
	resolved.CanWrite = meta.CanWrite && permissionCap.Write
	ctx := sessionctx.WithContext(context.Background(), resolved)
	ctx = context.WithValue(ctx, trustedOriginContextKey{}, origin)
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "ui"), 0700); err != nil {
		t.Fatal(err)
	}
	manifest := []byte(`{
  "schema_version":"redevplugin.manifest.v9",
  "publisher":{"publisher_id":"dev.redeven.acceptance","display_name":"Redeven Acceptance"},
  "plugin":{"plugin_id":"dev.redeven.acceptance.settings","display_name":"Settings acceptance","version":"1.0.0"},
  "api":{"major":1,"required_features":[],"optional_features":[]},
  "permissions":[],"presentation":{"locales":{"default":"en-US"}},
  "surfaces":[{"surface_id":"settings.view","kind":"view","label":"Settings acceptance","entry":"ui/index.html","web":{"root":"ui","spa":false}}],
  "workers":[],"methods":[],"storage":{"stores":[]},
  "settings":{"schema_version":1,"fields":[{"key":"show_stopped","type":"boolean","scope":"user","label":"Show stopped","default":true}]}
 }`)
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), manifest, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "ui", "index.html"), []byte("<!doctype html><html><body>Settings acceptance</body></html>"), 0600); err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	if _, err := pluginpkg.BuildFromDir(ctx, dir, &archive, pluginpkg.DefaultReadLimits()); err != nil {
		t.Fatal(err)
	}
	inspected, err := integration.host.InspectUploadedExternalPackage(ctx, host.InspectUploadedExternalPackageRequest{
		Intent: host.ExternalPackageIntent{Action: "install"}, Package: bytes.NewReader(archive.Bytes()), DeclaredSize: int64(archive.Len()),
	})
	if err != nil {
		t.Fatal(err)
	}
	installed, err := integration.host.InstallInspectedPackage(ctx, host.InstallInspectedPackageRequest{
		InspectionID: inspected.InspectionID, ExpectedPackageSHA256: inspected.InspectedHashes.PackageSHA256,
	})
	if err != nil {
		t.Fatal(err)
	}
	if installed.Plugin == nil {
		t.Fatal("installed plugin missing")
	}
	path := "/" + installed.Plugin.PluginInstanceID + "/settings"
	before := request(http.MethodPost, path+"/query", map[string]any{"scope": "user"})
	assertValue := func(snapshot map[string]any, value bool) {
		t.Helper()
		values, ok := snapshot["values"].(map[string]any)
		secrets, array := snapshot["secret_metadata"].([]any)
		if !ok || values["show_stopped"] != value || !array || len(secrets) != 0 {
			t.Fatalf("settings snapshot = %#v", snapshot)
		}
	}
	assertValue(before, true)
	after := request(http.MethodPatch, path, map[string]any{"scope": "user", "expected_values_revision": before["values_revision"], "set": map[string]any{"show_stopped": false}})
	assertValue(after, false)
	if after["values_revision"].(float64) <= before["values_revision"].(float64) {
		t.Fatal("settings revision did not advance")
	}
	if err := integration.Close(); err != nil {
		t.Fatal(err)
	}
	integration = nil
	integration, err = New(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	request(http.MethodPost, "/catalog/query", map[string]any{})
	reopened := request(http.MethodPost, path+"/query", map[string]any{"scope": "user"})
	assertValue(reopened, false)
	if reopened["values_revision"] != after["values_revision"] {
		t.Fatal("restart changed persisted settings revision")
	}
}
