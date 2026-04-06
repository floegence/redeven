package config

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultStateLayout(t *testing.T) {
	restore := stubUserHomeDir("/Users/tester", nil)
	defer restore()

	layout, err := DefaultStateLayout()
	if err != nil {
		t.Fatalf("DefaultStateLayout() error = %v", err)
	}

	if layout.ConfigPath != filepath.Clean("/Users/tester/.redeven/config.json") {
		t.Fatalf("ConfigPath = %q", layout.ConfigPath)
	}
	if layout.StateDir != filepath.Clean("/Users/tester/.redeven") {
		t.Fatalf("StateDir = %q", layout.StateDir)
	}
	if layout.RuntimeStatePath != filepath.Clean("/Users/tester/.redeven/runtime/local-ui.json") {
		t.Fatalf("RuntimeStatePath = %q", layout.RuntimeStatePath)
	}
	if layout.DiagnosticsDir != filepath.Clean("/Users/tester/.redeven/diagnostics") {
		t.Fatalf("DiagnosticsDir = %q", layout.DiagnosticsDir)
	}
}

func TestEnvStateLayoutSanitizesEnvironmentID(t *testing.T) {
	restore := stubUserHomeDir("/Users/tester", nil)
	defer restore()

	layout, err := EnvStateLayout("env:bad/id")
	if err != nil {
		t.Fatalf("EnvStateLayout() error = %v", err)
	}

	if layout.ConfigPath != filepath.Clean("/Users/tester/.redeven/envs/env_bad_id/config.json") {
		t.Fatalf("ConfigPath = %q", layout.ConfigPath)
	}
	if layout.StateDir != filepath.Clean("/Users/tester/.redeven/envs/env_bad_id") {
		t.Fatalf("StateDir = %q", layout.StateDir)
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
	if layout.RuntimeStatePath != filepath.Join(expectedStateDir, "runtime", "local-ui.json") {
		t.Fatalf("RuntimeStatePath = %q", layout.RuntimeStatePath)
	}
}

func TestDefaultStateLayoutReturnsMissingHomeError(t *testing.T) {
	restore := stubUserHomeDir("", errors.New("home missing"))
	defer restore()

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
