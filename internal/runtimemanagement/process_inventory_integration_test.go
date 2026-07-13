package runtimemanagement

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"
)

const runtimeProcessHelperSource = `package main

import (
	"os"
	"os/signal"
	"syscall"
)

func main() {
	if ready := os.Getenv("REDEVEN_TEST_READY_FILE"); ready != "" {
		_ = os.WriteFile(ready, []byte("ready"), 0o600)
	}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
}
`

func buildRuntimeProcessHelper(t *testing.T, executable string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("runtime process signaling integration is Unix-only")
	}
	root := filepath.Dir(filepath.Dir(filepath.Dir(filepath.Dir(executable))))
	source := filepath.Join(root, "runtime-process-helper.go")
	if err := os.MkdirAll(filepath.Dir(executable), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte(runtimeProcessHelperSource), 0o600); err != nil {
		t.Fatal(err)
	}
	command := exec.Command("go", "build", "-o", executable, source)
	command.Env = append(os.Environ(), "GOWORK=off")
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("build runtime process helper: %v\n%s", err, output)
	}
}

func startRuntimeProcessHelper(
	t *testing.T,
	executable string,
	stateRoot string,
	ownerID string,
	readyFile string,
) *exec.Cmd {
	t.Helper()
	command := exec.Command(executable, "run", "--mode", "desktop", "--desktop-managed", "--state-root", stateRoot)
	command.Env = append(os.Environ(),
		"REDEVEN_TEST_READY_FILE="+readyFile,
		desktopOwnerIDEnvName+"="+ownerID,
	)
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if command.Process != nil {
			_ = command.Process.Kill()
			_, _ = command.Process.Wait()
		}
	})
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(readyFile); err == nil {
			return command
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("runtime process helper %s did not become ready", executable)
	return nil
}

func waitRuntimeProcessHelper(t *testing.T, command *exec.Cmd) {
	t.Helper()
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	select {
	case err := <-done:
		if err != nil && !strings.Contains(err.Error(), "signal") {
			t.Fatalf("runtime process helper exit: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("runtime process helper %d did not exit", command.Process.Pid)
	}
	command.Process = nil
}

func writeRuntimeProcessLock(t *testing.T, stateRoot string, pid int, ownerID string) {
	t.Helper()
	if err := os.MkdirAll(stateRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(runtimeLockMetadata{
		PID:            pid,
		InstanceID:     "runtime-process-integration",
		RuntimeVersion: "vtest",
		DesktopOwnerID: ownerID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stateRoot, "agent.lock"), body, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestRuntimeProcessInventoryFindsAndStopsCurrentAndHistoricalProcesses(t *testing.T) {
	root := t.TempDir()
	runtimeRoot := filepath.Join(root, ".redeven")
	stateRoot := filepath.Join(runtimeRoot, "scopes", "local", "default")
	currentExecutable := filepath.Join(runtimeRoot, "runtime", "managed", "bin", "redeven")
	legacyExecutable := filepath.Join(runtimeRoot, "runtime", "releases", "v0.5.0", "bin", "redeven")
	buildRuntimeProcessHelper(t, currentExecutable)
	if err := os.MkdirAll(filepath.Dir(legacyExecutable), 0o755); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(currentExecutable)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacyExecutable, body, 0o755); err != nil {
		t.Fatal(err)
	}
	legacyStateRoot := filepath.Join(runtimeRoot, "instances", "envinst_gzcom_fixture", "state")
	if err := os.MkdirAll(stateRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(legacyStateRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	current := startRuntimeProcessHelper(t, currentExecutable, stateRoot, "desktop-owner", filepath.Join(root, "current.ready"))
	legacy := startRuntimeProcessHelper(t, legacyExecutable, legacyStateRoot, "", filepath.Join(root, "legacy.ready"))
	writeRuntimeProcessLock(t, stateRoot, current.Process.Pid, "desktop-owner")

	if err := os.RemoveAll(legacyStateRoot); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(legacyStateRoot, 0o755); err != nil {
		t.Fatal(err)
	}

	options := RuntimeProcessInventoryOptions{
		RuntimeRoot:        runtimeRoot,
		StateRoot:          stateRoot,
		DesktopOwnerID:     "desktop-owner",
		CurrentExecutables: []string{currentExecutable},
		IncludeKnownLegacy: true,
	}
	inventory, err := InspectRuntimeProcesses(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	if len(inventory.Instances) != 2 {
		t.Fatalf("instances = %#v", inventory.Instances)
	}
	classifications := []RuntimeProcessClassification{
		inventory.Instances[0].Classification,
		inventory.Instances[1].Classification,
	}
	sort.Slice(classifications, func(i, j int) bool { return classifications[i] < classifications[j] })
	if classifications[0] != RuntimeProcessCurrentOwned || classifications[1] != RuntimeProcessLegacyOwnerless {
		t.Fatalf("classifications = %#v", classifications)
	}
	if inventory.Instances[0].ExecutableInode == inventory.Instances[1].ExecutableInode {
		t.Fatalf("expected distinct executable inodes: %#v", inventory.Instances)
	}
	result, err := StopRuntimeProcesses(context.Background(), options, inventory.InventoryDigest, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.After.Instances) != 0 {
		t.Fatalf("after = %#v", result.After)
	}
	lockBody, err := os.ReadFile(filepath.Join(stateRoot, "agent.lock"))
	if err != nil {
		t.Fatal(err)
	}
	if len(lockBody) != 0 {
		t.Fatalf("runtime lock content after stop = %q, want empty", string(lockBody))
	}
	waitRuntimeProcessHelper(t, current)
	waitRuntimeProcessHelper(t, legacy)
}

func TestRuntimeProcessInventoryFindsDeletedLegacyExecutableOnLinux(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("deleted executable identity is exposed through Linux /proc")
	}
	root := t.TempDir()
	runtimeRoot := filepath.Join(root, ".redeven")
	stateRoot := filepath.Join(runtimeRoot, "local-environment", "state", "local-environment")
	executable := filepath.Join(runtimeRoot, "runtime", "releases", "v0.4.0", "bin", "redeven")
	buildRuntimeProcessHelper(t, executable)
	process := startRuntimeProcessHelper(t, executable, stateRoot, "", filepath.Join(root, "deleted.ready"))
	if err := os.Remove(executable); err != nil {
		t.Fatal(err)
	}

	options := RuntimeProcessInventoryOptions{
		RuntimeRoot:        runtimeRoot,
		StateRoot:          filepath.Join(runtimeRoot, "scopes", "local", "default"),
		DesktopOwnerID:     "desktop-owner",
		IncludeKnownLegacy: true,
	}
	inventory, err := InspectRuntimeProcesses(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	if len(inventory.Instances) != 1 || !inventory.Instances[0].ExecutableDeleted {
		t.Fatalf("inventory = %#v", inventory)
	}
	if inventory.Instances[0].Classification != RuntimeProcessLegacyOwnerless {
		t.Fatalf("classification = %q", inventory.Instances[0].Classification)
	}
	result, err := StopRuntimeProcesses(context.Background(), options, inventory.InventoryDigest, 2*time.Second)
	if err != nil && !errors.Is(err, os.ErrProcessDone) {
		t.Fatal(err)
	}
	if len(result.After.Instances) != 0 {
		t.Fatalf("after = %#v", result.After)
	}
	waitRuntimeProcessHelper(t, process)
}
