package localui

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/config"
)

func TestRuntimeAccessPendingTracksAppliedSettingsAndPassword(t *testing.T) {
	layout, err := config.LocalEnvironmentStateLayout(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	initial := RuntimeAccessUpdate{Bind: "localhost:23998", Protocol: "http", PasswordMode: "replace", Password: "original-password"}
	applied, err := SaveRuntimeAccess(layout, initial)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := accessgate.ReadPasswordHash(layout.StateDir)
	if err != nil {
		t.Fatal(err)
	}
	s := &runtimeControlServer{token: "management-secret", accessLayout: &layout, accessCurrent: *applied, accessPasswordHash: hash}
	checkPending := func(want bool) {
		t.Helper()
		r := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:3000/v2/runtime/access", nil)
		r.RemoteAddr = "127.0.0.1:1234"
		r.Header.Set("Authorization", "Bearer management-secret")
		w := httptest.NewRecorder()
		s.routes().ServeHTTP(w, r)
		var response struct {
			Data struct {
				RestartRequired bool `json:"restart_required"`
			} `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || w.Code != 200 || response.Data.RestartRequired != want {
			t.Fatalf("pending = %s, want %v: %v", w.Body, want, err)
		}
	}
	checkPending(false)
	for _, input := range []RuntimeAccessUpdate{
		{Bind: "localhost:25000", Protocol: "http", PasswordMode: "keep"},
		{Bind: "localhost:23998", Protocol: "https", PasswordMode: "keep"},
		{Bind: "localhost:23998", Protocol: "http", PasswordMode: "replace", Password: "replacement-password"},
	} {
		if _, err := SaveRuntimeAccess(layout, input); err != nil {
			t.Fatal(err)
		}
		checkPending(true)
	}
	// A new Runtime captures its own applied configuration and verifier.
	applied, err = config.ReadEnvironmentCatalogAccess(layout)
	if err != nil {
		t.Fatal(err)
	}
	s.accessCurrent = *applied
	s.accessPasswordHash, err = accessgate.ReadPasswordHash(layout.StateDir)
	if err != nil {
		t.Fatal(err)
	}
	checkPending(false)
}

func TestRuntimeAccessFailedSavePreservesPasswordAndSettings(t *testing.T) {
	layout, err := config.LocalEnvironmentStateLayout(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	initial := RuntimeAccessUpdate{Bind: "localhost:23998", Protocol: "http", PasswordMode: "replace", Password: "original-password"}
	if _, err := SaveRuntimeAccess(layout, initial); err != nil {
		t.Fatal(err)
	}
	before, err := accessgate.ReadPasswordHash(layout.StateDir)
	if err != nil {
		t.Fatal(err)
	}
	// Force a catalog write failure after the new verifier has been saved.
	if err := os.Mkdir(filepath.Join(layout.StateRoot, "catalog", "local-environment.json.tmp"), 0o700); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"replace", "clear"} {
		update := RuntimeAccessUpdate{Bind: "localhost:25000", Protocol: "https", PasswordMode: mode}
		if mode == "replace" {
			update.Password = "replacement-password"
		}
		if _, err := SaveRuntimeAccess(layout, update); err == nil {
			t.Fatal("expected catalog write failure")
		}
		after, err := accessgate.ReadPasswordHash(layout.StateDir)
		if err != nil || !bytes.Equal(before, after) {
			t.Fatalf("failed %s changed the password: %v", mode, err)
		}
		access, err := config.ReadEnvironmentCatalogAccess(layout)
		if err != nil || access.LocalUIBind != initial.Bind || access.LocalUIProtocol != initial.Protocol || !access.LocalUIPasswordConfigured {
			t.Fatalf("failed save changed access settings: %+v, %v", access, err)
		}
	}
}

func TestRuntimeAccessRequiresPrivateManagementAuthority(t *testing.T) {
	layout, err := config.LocalEnvironmentStateLayout(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := config.WriteEnvironmentCatalogRecord(layout, nil, &config.EnvironmentCatalogAccess{LocalUIBind: "localhost:23998", LocalUIProtocol: "http"}); err != nil {
		t.Fatal(err)
	}
	s := &runtimeControlServer{token: "management-secret", accessLayout: &layout}
	for _, tc := range []struct {
		name, host, token, remote string
		want                      int
	}{
		{"missing", "127.0.0.1:3000", "", "127.0.0.1:1234", 401},
		{"wrong", "127.0.0.1:3000", "wrong", "127.0.0.1:1234", 401},
		{"host", "example.com", "management-secret", "127.0.0.1:1234", 421},
		{"remote", "127.0.0.1:3000", "management-secret", "192.0.2.1:1234", 403},
		{"authorized", "127.0.0.1:3000", "management-secret", "127.0.0.1:1234", 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "http://"+tc.host+"/v2/runtime/access", nil)
			r.RemoteAddr = tc.remote
			if tc.token != "" {
				r.Header.Set("Authorization", "Bearer "+tc.token)
			}
			w := httptest.NewRecorder()
			s.routes().ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("status = %d, body = %s", w.Code, w.Body)
			}
			if strings.Contains(w.Body.String(), "management-secret") {
				t.Fatal("management secret leaked")
			}
		})
	}

	body := `{"local_ui_bind":"0.0.0.0:23998","local_ui_protocol":"http","local_ui_password_mode":"replace","local_ui_password":"environment-secret"}`
	r := httptest.NewRequest(http.MethodPut, "http://127.0.0.1:3000/v2/runtime/access", bytes.NewBufferString(body))
	r.RemoteAddr = "127.0.0.1:1234"
	r.Header.Set("Authorization", "Bearer management-secret")
	w := httptest.NewRecorder()
	s.routes().ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("save = %d: %s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), "environment-secret") || strings.Contains(w.Body.String(), "$2") {
		t.Fatal("password material leaked")
	}
	hash, err := accessgate.ReadPasswordHash(layout.StateDir)
	if err != nil {
		t.Fatal(err)
	}
	gate, err := accessgate.NewWithPasswordHash(hash)
	if err != nil || !gate.VerifyPassword("environment-secret") {
		t.Fatal("saved server credential is unusable")
	}
	if _, err := SaveRuntimeAccess(layout, RuntimeAccessUpdate{Bind: "0.0.0.0:23998", Protocol: "http", PasswordMode: "clear"}); err == nil {
		t.Fatal("network password cleared")
	}
	if _, err := SaveRuntimeAccess(layout, RuntimeAccessUpdate{Bind: "127.0.0.1:23998", Protocol: "https", PasswordMode: "keep"}); err != nil {
		t.Fatal(err)
	}
	access, err := config.ReadEnvironmentCatalogAccess(layout)
	if err != nil || access.LocalUIProtocol != "https" || !access.LocalUIPasswordConfigured {
		t.Fatalf("saved access = %+v, %v", access, err)
	}
}

func TestRuntimeAccessKeepImportsOnlyAMissingPasswordVerifier(t *testing.T) {
	layout, err := config.LocalEnvironmentStateLayout(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := config.WriteEnvironmentCatalogRecord(layout, nil, &config.EnvironmentCatalogAccess{
		LocalUIBind: "localhost:23998", LocalUIProtocol: "http", LocalUIPasswordConfigured: true,
	}); err != nil {
		t.Fatal(err)
	}
	input := RuntimeAccessUpdate{Bind: "localhost:24000", Protocol: "http", PasswordMode: "keep"}
	if _, err := SaveRuntimeAccess(layout, input); err == nil {
		t.Fatal("keep silently cleared a missing password verifier")
	}
	input.Password = "retained-desktop-password"
	blockedCatalog := filepath.Join(layout.StateRoot, "catalog", "local-environment.json.tmp")
	if err := os.Mkdir(blockedCatalog, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := SaveRuntimeAccess(layout, input); err == nil {
		t.Fatal("expected catalog write failure")
	}
	if hash, err := accessgate.ReadPasswordHash(layout.StateDir); err != nil || len(hash) != 0 {
		t.Fatalf("failed save retained an imported verifier: %v", err)
	}
	if err := os.Remove(blockedCatalog); err != nil {
		t.Fatal(err)
	}
	if _, err := SaveRuntimeAccess(layout, input); err != nil {
		t.Fatal(err)
	}
	hash, err := accessgate.ReadPasswordHash(layout.StateDir)
	if err != nil {
		t.Fatal(err)
	}
	gate, err := accessgate.NewWithPasswordHash(hash)
	if err != nil || !gate.VerifyPassword(input.Password) {
		t.Fatal("retained password was not imported")
	}
	// A different manager may have updated the server password. Keeping it must
	// never replace the verifier with this Desktop's stale retained password.
	input.Password = "stale-desktop-password"
	if _, err := SaveRuntimeAccess(layout, input); err != nil {
		t.Fatal(err)
	}
	after, err := accessgate.ReadPasswordHash(layout.StateDir)
	if err != nil || !bytes.Equal(hash, after) {
		t.Fatalf("keep replaced the server-owned verifier: %v", err)
	}
}
