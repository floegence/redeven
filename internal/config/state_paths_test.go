package config

import (
	"errors"
	"path/filepath"
	"strings"
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
	if layout.RuntimeControlSocketPath != filepath.Join(wantStateDir, "runtime", "control.sock") {
		t.Fatalf("RuntimeControlSocketPath = %q", layout.RuntimeControlSocketPath)
	}
	if layout.RuntimeMaintenancePath != filepath.Join(wantStateDir, "runtime", "maintenance", "current.json") {
		t.Fatalf("RuntimeMaintenancePath = %q", layout.RuntimeMaintenancePath)
	}
	if RuntimeMaintenancePathFromConfigPath(layout.ConfigPath) != layout.RuntimeMaintenancePath {
		t.Fatalf("RuntimeMaintenancePathFromConfigPath() = %q, want %q", RuntimeMaintenancePathFromConfigPath(layout.ConfigPath), layout.RuntimeMaintenancePath)
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

func TestLocalEnvironmentStateLayoutShortensLongRuntimeControlSocketPath(t *testing.T) {
	stateRoot := filepath.Join(t.TempDir(), strings.Repeat("long-state-segment-", 8))
	layout, err := LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatal(err)
	}

	legacyPath := filepath.Join(layout.StateDir, "runtime", "control.sock")
	if len([]byte(legacyPath)) <= maxUnixSocketPathBytes {
		t.Fatalf("test fixture path length = %d, want > %d", len([]byte(legacyPath)), maxUnixSocketPathBytes)
	}
	if layout.RuntimeControlSocketPath == legacyPath {
		t.Fatalf("RuntimeControlSocketPath retained overlong path %q", layout.RuntimeControlSocketPath)
	}
	if len([]byte(layout.RuntimeControlSocketPath)) > maxUnixSocketPathBytes {
		t.Fatalf("RuntimeControlSocketPath length = %d, want <= %d: %q", len([]byte(layout.RuntimeControlSocketPath)), maxUnixSocketPathBytes, layout.RuntimeControlSocketPath)
	}
	if filepath.Ext(layout.RuntimeControlSocketPath) != ".sock" {
		t.Fatalf("RuntimeControlSocketPath = %q, want .sock suffix", layout.RuntimeControlSocketPath)
	}
	if got := RuntimeControlSocketPathFromConfigPath(layout.ConfigPath); got != layout.RuntimeControlSocketPath {
		t.Fatalf("RuntimeControlSocketPathFromConfigPath() = %q, want %q", got, layout.RuntimeControlSocketPath)
	}

	second, err := LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatal(err)
	}
	if second.RuntimeControlSocketPath != layout.RuntimeControlSocketPath {
		t.Fatalf("short Runtime control socket is not deterministic: first=%q second=%q", layout.RuntimeControlSocketPath, second.RuntimeControlSocketPath)
	}
	if filepath.Dir(layout.RuntimeControlSocketPath) != "/tmp" {
		t.Fatalf("RuntimeControlSocketPath directory = %q, want /tmp", filepath.Dir(layout.RuntimeControlSocketPath))
	}
}

func TestLongRuntimeControlSocketPathDoesNotDependOnProcessTempEnvironment(t *testing.T) {
	stateRoot := filepath.Join(t.TempDir(), strings.Repeat("cross-process-state-segment-", 8))
	t.Setenv("TMPDIR", filepath.Join(t.TempDir(), "gateway-temp"))
	gatewayLayout, err := LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("TMPDIR", filepath.Join(t.TempDir(), "desktop-temp"))
	desktopLayout, err := LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatal(err)
	}

	if gatewayLayout.RuntimeControlSocketPath != desktopLayout.RuntimeControlSocketPath {
		t.Fatalf(
			"Runtime control socket changed across process temp environments: gateway=%q desktop=%q",
			gatewayLayout.RuntimeControlSocketPath,
			desktopLayout.RuntimeControlSocketPath,
		)
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
