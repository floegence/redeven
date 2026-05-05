package codeserver

import (
	"context"
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

	mgr := newTestRuntimeManager(t)
	status := waitForActiveRuntimeDetection(t, mgr, RuntimeDetectionReady)
	if status.ActiveRuntime.Source != "env_override" {
		t.Fatalf("source=%q, want %q", status.ActiveRuntime.Source, "env_override")
	}
	if status.ActiveRuntime.BinaryPath != bin {
		t.Fatalf("binary_path=%q, want %q", status.ActiveRuntime.BinaryPath, bin)
	}
}

func TestRuntimeManagerSelectedManagedVersionDoesNotSilentlyFallBackToSystem(t *testing.T) {
	stateDir := t.TempDir()
	stateRoot := t.TempDir()
	systemRoot := t.TempDir()
	systemBin := filepath.Join(systemRoot, "code-server")
	writeFakeCodeServerBinary(t, systemBin, "4.108.2")
	t.Setenv("PATH", systemRoot+string(os.PathListSeparator)+os.Getenv("PATH"))

	if err := saveLocalEnvironmentRuntimeState(stateRoot, localEnvironmentRuntimeState{
		SelectedVersion: "4.109.1",
		UpdatedAtUnixMs: time.Now().UnixMilli(),
		Versions: map[string]localEnvironmentRuntimeVersion{
			"4.109.1": {InstalledAtUnixMs: time.Now().UnixMilli(), BinaryRelPath: filepath.Join("bin", codeServerBinaryName())},
		},
	}); err != nil {
		t.Fatalf("saveLocalEnvironmentRuntimeState() error = %v", err)
	}

	mgr := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:             stateDir,
		StateRoot:            stateRoot,
		InstallScriptContent: []byte(fakeInstallScript("4.109.1", false, 0)),
	})

	status := mgr.Status(context.Background())
	if status.ActiveRuntime.Source != "managed" {
		t.Fatalf("active source=%q, want managed", status.ActiveRuntime.Source)
	}
	if status.ActiveRuntime.DetectionState != RuntimeDetectionMissing {
		t.Fatalf("active detection_state=%q, want missing", status.ActiveRuntime.DetectionState)
	}
	if status.ActiveRuntime.ErrorCode != "managed_version_missing" {
		t.Fatalf("error_code=%q, want managed_version_missing", status.ActiveRuntime.ErrorCode)
	}
}

func TestRuntimeManagerStatusKeepsSelectedManagedRuntimeVisibleWhenOverrideIsActive(t *testing.T) {
	stateDir := t.TempDir()
	stateRoot := t.TempDir()
	overrideRoot := t.TempDir()
	overrideBin := filepath.Join(overrideRoot, "code-server")
	writeFakeCodeServerBinary(t, overrideBin, "4.108.2")
	t.Setenv("REDEVEN_CODE_SERVER_BIN", overrideBin)

	writeFakeCodeServerBinary(t, filepath.Join(sharedVersionRoot(stateRoot, "4.109.1"), "bin", codeServerBinaryName()), "4.109.1")
	if err := saveLocalEnvironmentRuntimeState(stateRoot, localEnvironmentRuntimeState{
		SelectedVersion: "4.109.1",
		UpdatedAtUnixMs: time.Now().UnixMilli(),
		Versions: map[string]localEnvironmentRuntimeVersion{
			"4.109.1": {InstalledAtUnixMs: time.Now().UnixMilli(), BinaryRelPath: filepath.Join("bin", codeServerBinaryName())},
		},
	}); err != nil {
		t.Fatalf("saveLocalEnvironmentRuntimeState() error = %v", err)
	}

	mgr := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:             stateDir,
		StateRoot:            stateRoot,
		InstallScriptContent: []byte(fakeInstallScript("4.109.1", false, 0)),
	})

	status := waitForActiveRuntimeDetection(t, mgr, RuntimeDetectionReady)
	if status.ActiveRuntime.Source != "env_override" {
		t.Fatalf("active source=%q, want env_override", status.ActiveRuntime.Source)
	}
	if status.ManagedRuntime.DetectionState != RuntimeDetectionReady {
		t.Fatalf("managed detection_state=%q, want ready", status.ManagedRuntime.DetectionState)
	}
	if status.ManagedRuntime.Version != "4.109.1" {
		t.Fatalf("managed version=%q, want 4.109.1", status.ManagedRuntime.Version)
	}
	if status.ManagedRuntimeSource != "managed" {
		t.Fatalf("managed_runtime_source=%q, want managed", status.ManagedRuntimeSource)
	}
}

func TestRuntimeManagerInstallPromotesSharedVersionAndSelectsEnvironment(t *testing.T) {
	stateDir := t.TempDir()
	stateRoot := t.TempDir()
	mgr := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:             stateDir,
		StateRoot:            stateRoot,
		InstallScriptContent: []byte(fakeInstallScript("4.109.1", false, 0)),
	})

	status := mgr.StartInstall(context.Background())
	if status.Operation.State != RuntimeOperationStateRunning && status.Operation.State != RuntimeOperationStateSucceeded {
		t.Fatalf("initial operation.state=%q, want running or succeeded", status.Operation.State)
	}

	final := waitForOperationState(t, mgr, RuntimeOperationStateSucceeded)
	sharedBin := filepath.Join(sharedVersionRoot(stateRoot, "4.109.1"), "bin", codeServerBinaryName())
	if final.ActiveRuntime.DetectionState != RuntimeDetectionReady {
		t.Fatalf("active detection_state=%q, want ready", final.ActiveRuntime.DetectionState)
	}
	if final.ManagedRuntimeVersion != "4.109.1" {
		t.Fatalf("managed_runtime_version=%q, want 4.109.1", final.ManagedRuntimeVersion)
	}
	if _, err := os.Stat(sharedBin); err != nil {
		t.Fatalf("shared runtime missing: %v", err)
	}
	linkTarget, err := os.Readlink(managedRuntimePrefix(stateDir))
	if err != nil {
		t.Fatalf("Readlink(managedRuntimePrefix) error = %v", err)
	}
	if filepath.Clean(linkTarget) != filepath.Clean(sharedVersionRoot(stateRoot, "4.109.1")) {
		t.Fatalf("managed link target=%q, want %q", linkTarget, sharedVersionRoot(stateRoot, "4.109.1"))
	}
}

func TestRuntimeManagerInstallReusesExistingSharedVersion(t *testing.T) {
	stateRoot := t.TempDir()
	firstStateDir := t.TempDir()
	secondStateDir := t.TempDir()

	first := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:             firstStateDir,
		StateRoot:            stateRoot,
		InstallScriptContent: []byte(fakeInstallScript("4.109.1", false, 0)),
	})
	first.StartInstall(context.Background())
	waitForOperationState(t, first, RuntimeOperationStateSucceeded)

	second := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:             secondStateDir,
		StateRoot:            stateRoot,
		InstallScriptContent: []byte(fakeInstallScript("4.109.1", false, 0)),
	})
	second.StartInstall(context.Background())
	final := waitForOperationState(t, second, RuntimeOperationStateSucceeded)

	if final.ManagedRuntimeVersion != "4.109.1" {
		t.Fatalf("managed_runtime_version=%q, want 4.109.1", final.ManagedRuntimeVersion)
	}
	state, err := loadLocalEnvironmentRuntimeState(stateRoot)
	if err != nil {
		t.Fatalf("loadLocalEnvironmentRuntimeState() error = %v", err)
	}
	if state.SelectedVersion != "4.109.1" {
		t.Fatalf("selected_version=%q, want 4.109.1", state.SelectedVersion)
	}
	if len(state.Versions) != 1 {
		t.Fatalf("len(versions)=%d, want 1", len(state.Versions))
	}
}

func TestRuntimeManagerSelectVersionUpdatesLocalEnvironmentSelection(t *testing.T) {
	stateDir := t.TempDir()
	stateRoot := t.TempDir()
	writeFakeCodeServerBinary(t, filepath.Join(sharedVersionRoot(stateRoot, "4.108.2"), "bin", codeServerBinaryName()), "4.108.2")
	writeFakeCodeServerBinary(t, filepath.Join(sharedVersionRoot(stateRoot, "4.109.1"), "bin", codeServerBinaryName()), "4.109.1")

	if err := saveLocalEnvironmentRuntimeState(stateRoot, localEnvironmentRuntimeState{
		SelectedVersion: "4.108.2",
		UpdatedAtUnixMs: time.Now().UnixMilli(),
		Versions: map[string]localEnvironmentRuntimeVersion{
			"4.108.2": {InstalledAtUnixMs: time.Now().UnixMilli(), BinaryRelPath: filepath.Join("bin", codeServerBinaryName())},
			"4.109.1": {InstalledAtUnixMs: time.Now().UnixMilli(), BinaryRelPath: filepath.Join("bin", codeServerBinaryName())},
		},
	}); err != nil {
		t.Fatalf("saveLocalEnvironmentRuntimeState() error = %v", err)
	}

	mgr := NewRuntimeManager(RuntimeManagerOptions{StateDir: stateDir, StateRoot: stateRoot})
	status, err := mgr.SelectVersion(context.Background(), "4.109.1")
	if err != nil {
		t.Fatalf("SelectVersion() error = %v", err)
	}
	if status.ManagedRuntimeSource != "managed" {
		t.Fatalf("managed_runtime_source=%q, want managed", status.ManagedRuntimeSource)
	}
	if status.ManagedRuntimeVersion != "4.109.1" {
		t.Fatalf("managed_runtime_version=%q, want 4.109.1", status.ManagedRuntimeVersion)
	}
	state, err := loadLocalEnvironmentRuntimeState(stateRoot)
	if err != nil {
		t.Fatalf("loadLocalEnvironmentRuntimeState() error = %v", err)
	}
	if state.SelectedVersion != "4.109.1" {
		t.Fatalf("selected_version=%q, want 4.109.1", state.SelectedVersion)
	}
}

func TestRuntimeManagerRemoveLocalEnvironmentVersionEnforcesSafetyChecks(t *testing.T) {
	stateDir := t.TempDir()
	stateRoot := t.TempDir()
	writeFakeCodeServerBinary(t, filepath.Join(sharedVersionRoot(stateRoot, "4.108.2"), "bin", codeServerBinaryName()), "4.108.2")
	writeFakeCodeServerBinary(t, filepath.Join(sharedVersionRoot(stateRoot, "4.109.1"), "bin", codeServerBinaryName()), "4.109.1")
	if err := saveLocalEnvironmentRuntimeState(stateRoot, localEnvironmentRuntimeState{
		SelectedVersion: "4.108.2",
		UpdatedAtUnixMs: time.Now().UnixMilli(),
		Versions: map[string]localEnvironmentRuntimeVersion{
			"4.108.2": {InstalledAtUnixMs: time.Now().UnixMilli(), BinaryRelPath: filepath.Join("bin", codeServerBinaryName())},
			"4.109.1": {InstalledAtUnixMs: time.Now().UnixMilli(), BinaryRelPath: filepath.Join("bin", codeServerBinaryName())},
		},
	}); err != nil {
		t.Fatalf("saveLocalEnvironmentRuntimeState() error = %v", err)
	}

	mgr := NewRuntimeManager(RuntimeManagerOptions{StateDir: stateDir, StateRoot: stateRoot})
	if _, err := mgr.RemoveLocalEnvironmentVersion(context.Background(), "4.108.2"); err != nil {
		t.Fatalf("RemoveLocalEnvironmentVersion(default) returned error = %v, want nil status kickoff", err)
	}
	final := waitForOperationState(t, mgr, RuntimeOperationStateFailed)
	if !strings.Contains(final.Operation.LastError, "selected by the current Local Environment") {
		t.Fatalf("last_error=%q, want current Local Environment selection guidance", final.Operation.LastError)
	}

	state, err := loadLocalEnvironmentRuntimeState(stateRoot)
	if err != nil {
		t.Fatalf("loadLocalEnvironmentRuntimeState() error = %v", err)
	}
	state.SelectedVersion = ""
	if err := saveLocalEnvironmentRuntimeState(stateRoot, state); err != nil {
		t.Fatalf("saveLocalEnvironmentRuntimeState() error = %v", err)
	}

	if _, err := mgr.RemoveLocalEnvironmentVersion(context.Background(), "4.109.1"); err != nil {
		t.Fatalf("RemoveLocalEnvironmentVersion(removable) returned error = %v", err)
	}
	final = waitForOperationState(t, mgr, RuntimeOperationStateSucceeded)
	if final.Operation.TargetVersion != "4.109.1" {
		t.Fatalf("target_version=%q, want 4.109.1", final.Operation.TargetVersion)
	}
	if _, err := os.Stat(sharedVersionRoot(stateRoot, "4.109.1")); !os.IsNotExist(err) {
		t.Fatalf("shared version should be removed, err=%v", err)
	}
}

func TestResolveBinaryReturnsSelectedManagedRuntime(t *testing.T) {
	stateDir := t.TempDir()
	stateRoot := t.TempDir()
	managedBin := filepath.Join(sharedVersionRoot(stateRoot, "4.109.1"), "bin", codeServerBinaryName())
	writeFakeCodeServerBinary(t, managedBin, "4.109.1")
	if err := saveLocalEnvironmentRuntimeState(stateRoot, localEnvironmentRuntimeState{
		SelectedVersion: "4.109.1",
		UpdatedAtUnixMs: time.Now().UnixMilli(),
		Versions: map[string]localEnvironmentRuntimeVersion{
			"4.109.1": {InstalledAtUnixMs: time.Now().UnixMilli(), BinaryRelPath: filepath.Join("bin", codeServerBinaryName())},
		},
	}); err != nil {
		t.Fatalf("saveLocalEnvironmentRuntimeState() error = %v", err)
	}

	got, err := ResolveBinary(stateDir, stateRoot)
	if err != nil {
		t.Fatalf("ResolveBinary() error = %v", err)
	}
	if got != managedBin {
		t.Fatalf("ResolveBinary()=%q, want %q", got, managedBin)
	}
}

func TestRuntimeManagerStatusUsesOfficialLatestInstallerURL(t *testing.T) {
	mgr := NewRuntimeManager(RuntimeManagerOptions{StateDir: t.TempDir(), StateRoot: t.TempDir()})

	status := mgr.Status(context.Background())
	if status.InstallerScriptURL != defaultInstallScriptURL {
		t.Fatalf("installer_script_url=%q, want %q", status.InstallerScriptURL, defaultInstallScriptURL)
	}
}

func newTestRuntimeManager(t *testing.T) *RuntimeManager {
	t.Helper()
	return NewRuntimeManager(RuntimeManagerOptions{
		StateDir:             t.TempDir(),
		StateRoot:            t.TempDir(),
		InstallScriptContent: []byte(fakeInstallScript("4.109.1", false, 0)),
	})
}

func waitForActiveRuntimeDetection(t *testing.T, mgr *RuntimeManager, want RuntimeDetectionState) RuntimeStatus {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	last := RuntimeStatus{}
	for time.Now().Before(deadline) {
		status := mgr.Status(context.Background())
		last = status
		if status.ActiveRuntime.DetectionState == want {
			return status
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("active detection_state=%q, want %q (last=%+v)", last.ActiveRuntime.DetectionState, want, last)
	return RuntimeStatus{}
}

func waitForOperationState(t *testing.T, mgr *RuntimeManager, want RuntimeOperationState) RuntimeStatus {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
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

func fakeInstallScript(installedVersion string, fail bool, sleep time.Duration) string {
	var b strings.Builder
	b.WriteString("#!/bin/sh\nset -eu\n")
	b.WriteString("prefix=\"\"\nrequested_version=\"\"\n")
	b.WriteString("while [ $# -gt 0 ]; do\n")
	b.WriteString("  case \"$1\" in\n")
	b.WriteString("    --prefix) prefix=\"$2\"; shift 2 ;;\n")
	b.WriteString("    --prefix=*) prefix=\"${1#*=}\"; shift ;;\n")
	b.WriteString("    --version) requested_version=\"$2\"; shift 2 ;;\n")
	b.WriteString("    --version=*) requested_version=\"${1#*=}\"; shift ;;\n")
	b.WriteString("    *) shift ;;\n")
	b.WriteString("  esac\n")
	b.WriteString("done\n")
	b.WriteString("if [ -n \"$requested_version\" ]; then\n")
	b.WriteString("  echo \"unexpected --version flag: $requested_version\" >&2\n")
	b.WriteString("  exit 1\n")
	b.WriteString("fi\n")
	if sleep > 0 {
		b.WriteString(fmt.Sprintf("sleep %.3f\n", sleep.Seconds()))
	}
	if fail {
		b.WriteString("echo \"installer boom\" >&2\nexit 1\n")
		return b.String()
	}
	b.WriteString(fmt.Sprintf("bundle_version=%q\n", installedVersion))
	b.WriteString("mkdir -p \"$prefix/lib/code-server-$bundle_version/bin\" \"$prefix/bin\"\n")
	b.WriteString("printf '#!/bin/sh\nif [ \"${1:-}\" = \"--version\" ]; then\n  echo \"%s\"\n  exit 0\nfi\necho \"started\"\n' \"$bundle_version\" > \"$prefix/lib/code-server-$bundle_version/bin/code-server\"\n")
	b.WriteString("chmod +x \"$prefix/lib/code-server-$bundle_version/bin/code-server\"\n")
	b.WriteString("ln -fs \"$prefix/lib/code-server-$bundle_version/bin/code-server\" \"$prefix/bin/code-server\"\n")
	return b.String()
}
