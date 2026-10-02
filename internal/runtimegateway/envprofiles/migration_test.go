package envprofiles

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"

	"github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func migrationV1Fixture(t *testing.T, path string) []byte {
	t.Helper()
	store := NewStore(path)
	for _, route := range []protocol.EnvProfileAccessRoute{
		{Kind: protocol.EnvProfileAccessRouteKindURL, URL: "https://runtime.example/base/", OriginLabel: "Office"},
		{Kind: protocol.EnvProfileAccessRouteKindSSHHost, SSHDestination: "dev@host", SSHPort: 2222, SSHRuntimeRoot: "/srv/runtime"},
		{Kind: protocol.EnvProfileAccessRouteKindSSHContainer, SSHDestination: "dev@host", SSHPort: 2222, SSHRuntimeRoot: "/srv/runtime", ContainerEngine: "docker", ContainerID: "workspace", ContainerRuntimeRoot: "/data/runtime"},
	} {
		_, err := store.Upsert(context.Background(), protocol.EnvProfileUpsertRequest{ProtocolVersion: protocol.Version, Profile: protocol.EnvProfileInput{
			GatewayEnvID: "env_" + string(route.Kind), DisplayName: "Preserved " + string(route.Kind), AccessRoute: route,
		}})
		if err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		t.Fatal(err)
	}
	data["schema_version"] = 1
	for _, profile := range data["profiles"].([]any) {
		delete(profile.(map[string]any), "access_mode")
	}
	raw, err = json.MarshalIndent(data, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestProfileMigrationPreservesEveryFieldAndExistingDirectAccess(t *testing.T) {
	path := filepath.Join(t.TempDir(), "environments.json")
	before := migrationV1Fixture(t, path)
	profiles, err := NewStore(path).List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 3 {
		t.Fatalf("profile count = %d", len(profiles))
	}
	for _, profile := range profiles {
		if profile.AccessMode != protocol.AccessModeDirectURL {
			t.Fatal("migration changed the access mode")
		}
	}
	var expected, actual map[string]any
	if err := json.Unmarshal(before, &expected); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(path)
	if err := json.Unmarshal(after, &actual); err != nil {
		t.Fatal(err)
	}
	expected["schema_version"] = float64(2)
	for _, profile := range expected["profiles"].([]any) {
		profile.(map[string]any)["access_mode"] = "direct_url"
	}
	if !reflect.DeepEqual(expected, actual) {
		t.Fatal("migration changed user profile fields")
	}
	if _, err := NewStore(path).List(context.Background()); err != nil {
		t.Fatal(err)
	}
	again, _ := os.ReadFile(path)
	if string(again) != string(after) {
		t.Fatal("current store was rewritten on read")
	}
}

func TestProfileMigrationRejectsDriftAndFutureSchemasReadOnly(t *testing.T) {
	for _, raw := range []string{
		`{"schema_version":3,"profiles":[]}`,
		`{"schema_version":1,"profiles":[],"unknown":true}`,
		`{"schema_version":1,"profiles":[{"gateway_env_id":"lost","display_name":"Broken"}]}`,
		`{"schema_version":2,"profiles":[]} {}`,
	} {
		path := filepath.Join(t.TempDir(), "environments.json")
		if err := os.WriteFile(path, []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		store := NewStore(path)
		if _, err := store.List(context.Background()); err == nil {
			t.Fatal("unsupported state accepted")
		}
		if _, err := store.Upsert(context.Background(), protocol.EnvProfileUpsertRequest{ProtocolVersion: protocol.Version, Profile: protocol.EnvProfileInput{
			DisplayName: "New", AccessRoute: protocol.EnvProfileAccessRoute{Kind: protocol.EnvProfileAccessRouteKindURL, URL: "https://runtime.example/"},
		}}); err == nil {
			t.Fatal("failed migration allowed a write")
		}
		after, _ := os.ReadFile(path)
		if string(after) != raw {
			t.Fatal("failed migration changed original bytes")
		}
	}
}

func TestProfileMigrationCommitFailurePreservesOriginalFile(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("requires POSIX directory write permissions")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "environments.json")
	before := migrationV1Fixture(t, path)
	if err := os.Chmod(dir, 0500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0700) })
	store := NewStore(path)
	if _, err := store.List(context.Background()); err == nil {
		t.Fatal("expected atomic commit failure")
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(before) || store.loaded {
		t.Fatal("failed migration published state")
	}
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := store.List(context.Background()); err != nil {
		t.Fatal(err)
	}
}
