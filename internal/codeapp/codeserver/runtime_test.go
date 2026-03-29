package codeserver

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRuntimeManagerStatusDetectsSupportedOverride(t *testing.T) {
	root := t.TempDir()
	bin := filepath.Join(root, "code-server")
	writeFakeCodeServerBinary(t, bin, "4.108.2")
	t.Setenv("REDEVEN_CODE_SERVER_BIN", bin)

	mgr := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:             t.TempDir(),
		SupportedVersion:     "4.108.2",
		InstallScriptContent: []byte("#!/bin/sh\nexit 0\n"),
	})

	status := mgr.Status(context.Background())
	if status.ActiveRuntime.DetectionState != RuntimeDetectionReady {
		t.Fatalf("active detection_state=%q, want %q", status.ActiveRuntime.DetectionState, RuntimeDetectionReady)
	}
	if status.ActiveRuntime.Source != "env_override" {
		t.Fatalf("source=%q, want %q", status.ActiveRuntime.Source, "env_override")
	}
	if status.ActiveRuntime.BinaryPath != bin {
		t.Fatalf("binary_path=%q, want %q", status.ActiveRuntime.BinaryPath, bin)
	}
}

func TestRuntimeManagerStatusRejectsUnsupportedOverride(t *testing.T) {
	root := t.TempDir()
	bin := filepath.Join(root, "code-server")
	writeFakeCodeServerBinary(t, bin, "4.99.0")
	t.Setenv("REDEVEN_CODE_SERVER_BIN", bin)

	mgr := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:             t.TempDir(),
		SupportedVersion:     "4.108.2",
		InstallScriptContent: []byte("#!/bin/sh\nexit 0\n"),
	})

	status := mgr.Status(context.Background())
	if status.ActiveRuntime.DetectionState != RuntimeDetectionIncompatible {
		t.Fatalf("active detection_state=%q, want %q", status.ActiveRuntime.DetectionState, RuntimeDetectionIncompatible)
	}
	if status.ActiveRuntime.InstalledVersion != "4.99.0" {
		t.Fatalf("installed_version=%q, want %q", status.ActiveRuntime.InstalledVersion, "4.99.0")
	}
	if status.ActiveRuntime.ErrorCode != "unsupported_version" {
		t.Fatalf("error_code=%q, want %q", status.ActiveRuntime.ErrorCode, "unsupported_version")
	}
}

func TestRuntimeManagerStatusKeepsManagedRuntimeVisibleWhenOverrideIsActive(t *testing.T) {
	stateDir := t.TempDir()
	overrideRoot := t.TempDir()
	overrideBin := filepath.Join(overrideRoot, "code-server")
	writeFakeCodeServerBinary(t, overrideBin, "4.108.2")
	t.Setenv("REDEVEN_CODE_SERVER_BIN", overrideBin)

	managedBin := filepath.Join(managedRuntimePrefix(stateDir), "bin", codeServerBinaryName())
	writeFakeCodeServerBinary(t, managedBin, "4.108.2")

	mgr := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:             stateDir,
		SupportedVersion:     "4.108.2",
		InstallScriptContent: []byte("#!/bin/sh\nexit 0\n"),
	})

	status := mgr.Status(context.Background())
	if status.ActiveRuntime.Source != "env_override" {
		t.Fatalf("active source=%q, want env_override", status.ActiveRuntime.Source)
	}
	if !status.ManagedRuntime.Present {
		t.Fatalf("managed runtime should be present")
	}
	if status.ManagedRuntime.Source != "managed" {
		t.Fatalf("managed source=%q, want managed", status.ManagedRuntime.Source)
	}
	if status.ManagedRuntime.DetectionState != RuntimeDetectionReady {
		t.Fatalf("managed detection_state=%q, want %q", status.ManagedRuntime.DetectionState, RuntimeDetectionReady)
	}
}

func TestRuntimeManagerInstallSucceedsAndPromotesManagedRuntime(t *testing.T) {
	stateDir := t.TempDir()
	version := "4.108.2"
	mgr := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:             stateDir,
		SupportedVersion:     version,
		InstallScriptContent: []byte(fakeInstallScript(false, 0)),
	})

	status := mgr.StartInstall(context.Background())
	if status.Operation.State != RuntimeOperationStateRunning && status.Operation.State != RuntimeOperationStateSucceeded {
		t.Fatalf("initial operation.state=%q, want running or succeeded", status.Operation.State)
	}

	final := waitForOperationState(t, mgr, RuntimeOperationStateSucceeded)
	managedBin := filepath.Join(managedRuntimePrefix(stateDir), "bin", codeServerBinaryName())
	if final.ActiveRuntime.DetectionState != RuntimeDetectionReady {
		t.Fatalf("active detection_state=%q, want %q", final.ActiveRuntime.DetectionState, RuntimeDetectionReady)
	}
	if final.ManagedRuntime.DetectionState != RuntimeDetectionReady {
		t.Fatalf("managed detection_state=%q, want %q", final.ManagedRuntime.DetectionState, RuntimeDetectionReady)
	}
	if final.ManagedRuntime.InstalledVersion != version {
		t.Fatalf("managed installed_version=%q, want %q", final.ManagedRuntime.InstalledVersion, version)
	}
	if _, err := os.Stat(managedBin); err != nil {
		t.Fatalf("managed runtime missing: %v", err)
	}
	managedVersion, err := detectBinaryVersion(context.Background(), managedBin)
	if err != nil {
		t.Fatalf("detectBinaryVersion(managedBin) error = %v", err)
	}
	if managedVersion != version {
		t.Fatalf("managedVersion=%q, want %q", managedVersion, version)
	}
}

func TestRuntimeManagerInstallFailsWithInstallerError(t *testing.T) {
	mgr := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:             t.TempDir(),
		SupportedVersion:     "4.108.2",
		InstallScriptContent: []byte(fakeInstallScript(true, 0)),
	})

	mgr.StartInstall(context.Background())
	final := waitForOperationState(t, mgr, RuntimeOperationStateFailed)
	if final.Operation.LastErrorCode != "installer_failed" {
		t.Fatalf("last_error_code=%q, want %q", final.Operation.LastErrorCode, "installer_failed")
	}
}

func TestRuntimeManagerCancelInstall(t *testing.T) {
	mgr := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:             t.TempDir(),
		SupportedVersion:     "4.108.2",
		InstallScriptContent: []byte(fakeInstallScript(false, 5*time.Second)),
	})

	mgr.StartInstall(context.Background())
	waitForRunning(t, mgr)
	mgr.CancelOperation(context.Background())
	final := waitForOperationState(t, mgr, RuntimeOperationStateCancelled)
	if final.Operation.FinishedAtUnixMs == 0 {
		t.Fatalf("finished_at_unix_ms=%d, want > 0", final.Operation.FinishedAtUnixMs)
	}
}

func TestRuntimeManagerUninstallRemovesManagedRuntime(t *testing.T) {
	stateDir := t.TempDir()
	managedBin := filepath.Join(managedRuntimePrefix(stateDir), "bin", codeServerBinaryName())
	writeFakeCodeServerBinary(t, managedBin, "4.108.2")

	mgr := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:             stateDir,
		SupportedVersion:     "4.108.2",
		InstallScriptContent: []byte(fakeInstallScript(false, 0)),
	})

	status := mgr.StartUninstall(context.Background())
	if status.Operation.State != RuntimeOperationStateRunning && status.Operation.State != RuntimeOperationStateSucceeded {
		t.Fatalf("initial operation.state=%q, want running or succeeded", status.Operation.State)
	}

	final := waitForOperationState(t, mgr, RuntimeOperationStateSucceeded)
	if final.ManagedRuntime.DetectionState != RuntimeDetectionMissing {
		t.Fatalf("managed detection_state=%q, want %q", final.ManagedRuntime.DetectionState, RuntimeDetectionMissing)
	}
	if final.ManagedRuntime.Present {
		t.Fatalf("managed runtime should not be present after uninstall")
	}
	if _, err := os.Lstat(managedBin); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("managed binary should be removed, err=%v", err)
	}
}

func TestResolveBinaryReturnsManagedRuntime(t *testing.T) {
	stateDir := t.TempDir()
	managedBin := filepath.Join(managedRuntimePrefix(stateDir), "bin", codeServerBinaryName())
	writeFakeCodeServerBinary(t, managedBin, "4.108.2")

	got, err := ResolveBinary(stateDir)
	if err != nil {
		t.Fatalf("ResolveBinary() error = %v", err)
	}
	if got != managedBin {
		t.Fatalf("ResolveBinary() = %q, want %q", got, managedBin)
	}
}

func waitForRunning(t *testing.T, mgr *RuntimeManager) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		status := mgr.Status(context.Background())
		if status.Operation.State == RuntimeOperationStateRunning {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("operation never entered running state")
}

func waitForOperationState(t *testing.T, mgr *RuntimeManager, want RuntimeOperationState) RuntimeStatus {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	last := RuntimeStatus{}
	for time.Now().Before(deadline) {
		status := mgr.Status(context.Background())
		last = status
		if status.Operation.State == want {
			return status
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("operation.state never reached %q (last=%+v)", want, last)
	return RuntimeStatus{}
}

func writeFakeCodeServerBinary(t *testing.T, path string, version string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	script := fmt.Sprintf(`#!/bin/sh
if [ "${1:-}" = "--version" ]; then
  echo "%s"
  exit 0
fi
echo "ok"
`, version)
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func fakeInstallScript(fail bool, sleep time.Duration) string {
	var b strings.Builder
	b.WriteString("#!/bin/sh\nset -eu\n")
	b.WriteString("prefix=\"\"\nversion=\"\"\n")
	b.WriteString("while [ $# -gt 0 ]; do\n")
	b.WriteString("  case \"$1\" in\n")
	b.WriteString("    --prefix) prefix=\"$2\"; shift 2 ;;\n")
	b.WriteString("    --prefix=*) prefix=\"${1#*=}\"; shift ;;\n")
	b.WriteString("    --version) version=\"$2\"; shift 2 ;;\n")
	b.WriteString("    --version=*) version=\"${1#*=}\"; shift ;;\n")
	b.WriteString("    *) shift ;;\n")
	b.WriteString("  esac\n")
	b.WriteString("done\n")
	if sleep > 0 {
		b.WriteString(fmt.Sprintf("sleep %.3f\n", sleep.Seconds()))
	}
	if fail {
		b.WriteString("echo \"installer boom\" >&2\nexit 1\n")
		return b.String()
	}
	b.WriteString("mkdir -p \"$prefix/lib/code-server-$version/bin\" \"$prefix/bin\"\n")
	b.WriteString("printf '#!/bin/sh\nif [ \"${1:-}\" = \"--version\" ]; then\n  echo \"%s\"\n  exit 0\nfi\necho \"started\"\n' \"$version\" > \"$prefix/lib/code-server-$version/bin/code-server\"\n")
	b.WriteString("chmod +x \"$prefix/lib/code-server-$version/bin/code-server\"\n")
	b.WriteString("ln -fs \"$prefix/lib/code-server-$version/bin/code-server\" \"$prefix/bin/code-server\"\n")
	return b.String()
}
