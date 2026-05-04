package config

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultStateLayoutUsesLocalEnvironmentScope(t *testing.T) {
	restoreHome := stubUserHomeDir("/Users/tester", nil)
	restoreEnv := stubLookupEnv("", false)
	defer restoreHome()
	defer restoreEnv()

	layout, err := DefaultStateLayout()
	if err != nil {
		t.Fatalf("DefaultStateLayout() error = %v", err)
	}

	wantStateDir := filepath.Clean("/Users/tester/.redeven/local-environment")
	if layout.StateRoot != filepath.Clean("/Users/tester/.redeven") {
		t.Fatalf("StateRoot = %q", layout.StateRoot)
	}
	if layout.ScopeKey != "local_environment" {
		t.Fatalf("ScopeKey = %q", layout.ScopeKey)
	}
	if layout.Scope.Kind != ScopeKindLocalEnvironment {
		t.Fatalf("Scope.Kind = %q", layout.Scope.Kind)
	}
	if layout.ConfigPath != filepath.Join(wantStateDir, "config.json") {
		t.Fatalf("ConfigPath = %q", layout.ConfigPath)
	}
	if layout.StateDir != wantStateDir {
		t.Fatalf("StateDir = %q", layout.StateDir)
	}
	if layout.RuntimeStatePath != filepath.Join(wantStateDir, "runtime", "local-ui.json") {
		t.Fatalf("RuntimeStatePath = %q", layout.RuntimeStatePath)
	}
	if layout.DiagnosticsDir != filepath.Join(wantStateDir, "diagnostics") {
		t.Fatalf("DiagnosticsDir = %q", layout.DiagnosticsDir)
	}
	if layout.ScopeMetadataPath != filepath.Join(wantStateDir, "scope.json") {
		t.Fatalf("ScopeMetadataPath = %q", layout.ScopeMetadataPath)
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

func TestParseScopeRefSupportsLocalEnvironmentOnly(t *testing.T) {
	got, err := ParseScopeRef("local_environment")
	if err != nil {
		t.Fatalf("ParseScopeRef() error = %v", err)
	}
	if got != (ScopeRef{Kind: ScopeKindLocalEnvironment, Name: DefaultLocalEnvironmentScopeName}) {
		t.Fatalf("ParseScopeRef() = %#v", got)
	}

	if _, err := ParseScopeRef("named/dev-a"); err == nil {
		t.Fatalf("ParseScopeRef(named/dev-a) error = nil, want error")
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
