package config

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestDefaultStateLayoutUsesSingleLocalEnvironment(t *testing.T) {
	restoreHome := stubUserHomeDir("/Users/tester", nil)
	restoreEnv := stubLookupEnv("", false)
	defer restoreHome()
	defer restoreEnv()

	layout, err := DefaultStateLayout()
	if err != nil {
		t.Fatalf("DefaultStateLayout() error = %v", err)
	}

	wantStateRoot := filepath.Clean("/Users/tester/.redeven")
	wantStateDir := filepath.Join(wantStateRoot, "local-environment")
	if layout.StateRoot != wantStateRoot {
		t.Fatalf("StateRoot = %q", layout.StateRoot)
	}
	if layout.ConfigPath != filepath.Join(wantStateDir, "config.json") {
		t.Fatalf("ConfigPath = %q", layout.ConfigPath)
	}
	if layout.SecretsPath != filepath.Join(wantStateDir, "secrets.json") {
		t.Fatalf("SecretsPath = %q", layout.SecretsPath)
	}
	if layout.LockPath != filepath.Join(wantStateDir, "agent.lock") {
		t.Fatalf("LockPath = %q", layout.LockPath)
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
	if layout.AuditDir != filepath.Join(wantStateDir, "audit") {
		t.Fatalf("AuditDir = %q", layout.AuditDir)
	}
	if layout.AppsDir != filepath.Join(wantStateDir, "apps") {
		t.Fatalf("AppsDir = %q", layout.AppsDir)
	}
	if layout.GatewayDir != filepath.Join(wantStateDir, "gateway") {
		t.Fatalf("GatewayDir = %q", layout.GatewayDir)
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

func TestLocalEnvironmentStateLayoutUsesStateRootOverride(t *testing.T) {
	layout, err := LocalEnvironmentStateLayout("/tmp/redeven-profile")
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}

	wantStateRoot := filepath.Clean("/tmp/redeven-profile")
	wantStateDir := filepath.Join(wantStateRoot, "local-environment")
	if layout.StateRoot != wantStateRoot {
		t.Fatalf("StateRoot = %q", layout.StateRoot)
	}
	if layout.ConfigPath != filepath.Join(wantStateDir, "config.json") {
		t.Fatalf("ConfigPath = %q", layout.ConfigPath)
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
