package config

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultStateLayout(t *testing.T) {
	restoreHome := stubUserHomeDir("/Users/tester", nil)
	restoreEnv := stubLookupEnv("", false)
	defer restoreHome()
	defer restoreEnv()

	layout, err := DefaultStateLayout()
	if err != nil {
		t.Fatalf("DefaultStateLayout() error = %v", err)
	}

	if layout.StateRoot != filepath.Clean("/Users/tester/.redeven") {
		t.Fatalf("StateRoot = %q", layout.StateRoot)
	}
	if layout.ScopeKey != "local/default" {
		t.Fatalf("ScopeKey = %q", layout.ScopeKey)
	}
	if layout.ConfigPath != filepath.Clean("/Users/tester/.redeven/scopes/local/default/config.json") {
		t.Fatalf("ConfigPath = %q", layout.ConfigPath)
	}
	if layout.StateDir != filepath.Clean("/Users/tester/.redeven/scopes/local/default") {
		t.Fatalf("StateDir = %q", layout.StateDir)
	}
	if layout.RuntimeStatePath != filepath.Clean("/Users/tester/.redeven/scopes/local/default/runtime/local-ui.json") {
		t.Fatalf("RuntimeStatePath = %q", layout.RuntimeStatePath)
	}
	if layout.DiagnosticsDir != filepath.Clean("/Users/tester/.redeven/scopes/local/default/diagnostics") {
		t.Fatalf("DiagnosticsDir = %q", layout.DiagnosticsDir)
	}
	if layout.ScopeMetadataPath != filepath.Clean("/Users/tester/.redeven/scopes/local/default/scope.json") {
		t.Fatalf("ScopeMetadataPath = %q", layout.ScopeMetadataPath)
	}
}

func TestControlPlaneStateLayoutSanitizesIdentifiers(t *testing.T) {
	restoreHome := stubUserHomeDir("/Users/tester", nil)
	restoreEnv := stubLookupEnv("", false)
	defer restoreHome()
	defer restoreEnv()

	layout, err := ControlPlaneStateLayout("https://Region.Example.invalid/path?q=1", "env:bad/id", "")
	if err != nil {
		t.Fatalf("ControlPlaneStateLayout() error = %v", err)
	}

	if layout.ScopeKey != "controlplane/https__region.example.invalid/env_bad_id" {
		t.Fatalf("ScopeKey = %q", layout.ScopeKey)
	}
	if layout.ConfigPath != filepath.Clean("/Users/tester/.redeven/scopes/controlplane/https__region.example.invalid/env_bad_id/config.json") {
		t.Fatalf("ConfigPath = %q", layout.ConfigPath)
	}
	if layout.StateDir != filepath.Clean("/Users/tester/.redeven/scopes/controlplane/https__region.example.invalid/env_bad_id") {
		t.Fatalf("StateDir = %q", layout.StateDir)
	}
}

func TestResolveStateRootUsesEnvOverride(t *testing.T) {
	restoreHome := stubUserHomeDir("/Users/ignored", nil)
	restoreEnv := stubLookupEnv("/tmp/redeven-state", true)
	defer restoreHome()
	defer restoreEnv()

	root, err := ResolveStateRoot("")
	if err != nil {
		t.Fatalf("ResolveStateRoot() error = %v", err)
	}
	if root != filepath.Clean("/tmp/redeven-state") {
		t.Fatalf("ResolveStateRoot() = %q", root)
	}
}

func TestParseScopeRefSupportsLocalNamedAndControlPlane(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want ScopeRef
	}{
		{
			name: "local default",
			raw:  "local",
			want: ScopeRef{Kind: ScopeKindLocal, Name: DefaultLocalScopeName},
		},
		{
			name: "named",
			raw:  "named/dev-a",
			want: ScopeRef{Kind: ScopeKindNamed, Name: "dev-a"},
		},
		{
			name: "controlplane",
			raw:  "controlplane/https__dev.redeven.test/env_123",
			want: ScopeRef{Kind: ScopeKindControlPlane, ProviderKey: "https__dev.redeven.test", EnvironmentID: "env_123"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseScopeRef(tt.raw)
			if err != nil {
				t.Fatalf("ParseScopeRef() error = %v", err)
			}
			if got != tt.want {
				t.Fatalf("ParseScopeRef() = %#v, want %#v", got, tt.want)
			}
		})
	}
}

func TestStateLayoutForConfigPathNormalizesRelativePath(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd() error = %v", err)
	}
	tmpDir := t.TempDir()
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatalf("Chdir() error = %v", err)
	}
	defer func() {
		if chdirErr := os.Chdir(wd); chdirErr != nil {
			t.Fatalf("restore cwd: %v", chdirErr)
		}
	}()

	layout, err := StateLayoutForConfigPath(filepath.Join(".", "nested", "..", "state", "config.json"))
	if err != nil {
		t.Fatalf("StateLayoutForConfigPath() error = %v", err)
	}

	expectedConfigPath, err := filepath.Abs(filepath.Join(".", "state", "config.json"))
	if err != nil {
		t.Fatalf("Abs() error = %v", err)
	}
	if layout.ConfigPath != expectedConfigPath {
		t.Fatalf("ConfigPath = %q, want %q", layout.ConfigPath, expectedConfigPath)
	}
	expectedStateDir := filepath.Dir(expectedConfigPath)
	if layout.StateDir != expectedStateDir {
		t.Fatalf("StateDir = %q", layout.StateDir)
	}
	if layout.ScopeDir != expectedStateDir {
		t.Fatalf("ScopeDir = %q", layout.ScopeDir)
	}
	if layout.RuntimeStatePath != filepath.Join(expectedStateDir, "runtime", "local-ui.json") {
		t.Fatalf("RuntimeStatePath = %q", layout.RuntimeStatePath)
	}
	if layout.ScopeMetadataPath != filepath.Join(expectedStateDir, "scope.json") {
		t.Fatalf("ScopeMetadataPath = %q", layout.ScopeMetadataPath)
	}
}

func TestStateLayoutForScopeMigratesLegacyRootEntries(t *testing.T) {
	stateRoot := t.TempDir()
	legacyConfigPath := filepath.Join(stateRoot, "config.json")
	if err := os.WriteFile(legacyConfigPath, []byte("{}\n"), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	layout, err := LocalStateLayout(DefaultLocalScopeName, stateRoot)
	if err != nil {
		t.Fatalf("LocalStateLayout() error = %v", err)
	}

	if pathExists(legacyConfigPath) {
		t.Fatalf("legacy config still exists at %q", legacyConfigPath)
	}
	if !pathExists(layout.ConfigPath) {
		t.Fatalf("expected migrated config at %q", layout.ConfigPath)
	}
}

func TestStateLayoutForScopeMigratesLegacyEnvironmentDirs(t *testing.T) {
	stateRoot := t.TempDir()
	legacyEnvDir := filepath.Join(stateRoot, "envs", "env_legacy")
	if err := os.MkdirAll(legacyEnvDir, 0o700); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := Save(filepath.Join(legacyEnvDir, "config.json"), &Config{
		ControlplaneBaseURL: "https://dev.redeven.test",
		EnvironmentID:       "env_legacy",
	}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	layout, err := LocalStateLayout(DefaultLocalScopeName, stateRoot)
	if err != nil {
		t.Fatalf("LocalStateLayout() error = %v", err)
	}
	_ = layout

	expectedControlPlaneLayout, err := ControlPlaneStateLayout("https://dev.redeven.test", "env_legacy", stateRoot)
	if err != nil {
		t.Fatalf("ControlPlaneStateLayout() error = %v", err)
	}
	if pathExists(legacyEnvDir) {
		t.Fatalf("legacy env dir still exists at %q", legacyEnvDir)
	}
	if !pathExists(expectedControlPlaneLayout.ConfigPath) {
		t.Fatalf("expected migrated config at %q", expectedControlPlaneLayout.ConfigPath)
	}
}

func TestDefaultStateLayoutReturnsMissingHomeError(t *testing.T) {
	restoreHome := stubUserHomeDir("", errors.New("home missing"))
	restoreEnv := stubLookupEnv("", false)
	defer restoreHome()
	defer restoreEnv()

	_, err := DefaultStateLayout()
	if !errors.Is(err, ErrHomeDirUnavailable) {
		t.Fatalf("DefaultStateLayout() error = %v, want ErrHomeDirUnavailable", err)
	}
}

func stubUserHomeDir(home string, err error) func() {
	previous := userHomeDir
	userHomeDir = func() (string, error) {
		return home, err
	}
	return func() {
		userHomeDir = previous
	}
}

func stubLookupEnv(value string, ok bool) func() {
	previous := lookupEnv
	lookupEnv = func(key string) (string, bool) {
		if key == stateRootEnvName {
			return value, ok
		}
		return "", false
	}
	return func() {
		lookupEnv = previous
	}
}
