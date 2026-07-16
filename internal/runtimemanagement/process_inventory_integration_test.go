package runtimemanagement

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
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
	lockPath := filepath.Join(stateRoot, "local-environment", "agent.lock")
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o755); err != nil {
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
	if err := os.WriteFile(lockPath, body, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestRuntimeProcessInventoryRequiresConfirmationForOwnerlessCurrentProcess(t *testing.T) {
	root := t.TempDir()
	runtimeRoot := filepath.Join(root, ".redeven")
	executable := filepath.Join(runtimeRoot, "runtime", "managed", "bin", "redeven")
	buildRuntimeProcessHelper(t, executable)
	current := startRuntimeProcessHelper(t, executable, runtimeRoot, "desktop-owner", filepath.Join(root, "current.ready"))
	ownerless := startRuntimeProcessHelper(t, executable, runtimeRoot, "", filepath.Join(root, "ownerless.ready"))
	writeRuntimeProcessLock(t, runtimeRoot, current.Process.Pid, "desktop-owner")
	if err := os.RemoveAll(filepath.Join(runtimeRoot, "local-environment")); err != nil {
		t.Fatal(err)
	}

	options := RuntimeProcessInventoryOptions{
		RuntimeRoot:        runtimeRoot,
		StateRoot:          runtimeRoot,
		DesktopOwnerID:     "desktop-owner",
		CurrentExecutables: []string{executable},
	}
	inventory, err := InspectRuntimeProcesses(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	if len(inventory.Instances) != 2 {
		t.Fatalf("instances = %#v", inventory.Instances)
	}
	if inventory.Summary.Automatic != 0 || inventory.Summary.ConfirmedTakeover != 2 || inventory.Summary.Blocked != 0 {
		t.Fatalf("summary = %#v", inventory.Summary)
	}
	if _, err := StopRuntimeProcesses(context.Background(), options, inventory.InventoryDigest, 2*time.Second); RuntimeProcessErrorCode(err) != RuntimeProcessErrorTakeoverRequired {
		t.Fatalf("automatic stop error = %v", err)
	}
	result, err := StopRuntimeProcessesWithMode(
		context.Background(),
		options,
		inventory.InventoryDigest,
		2*time.Second,
		RuntimeProcessReconciliationConfirmedTakeover,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.After.Instances) != 0 || len(result.Stopped) != 2 {
		t.Fatalf("result = %#v", result)
	}
	waitRuntimeProcessHelper(t, current)
	waitRuntimeProcessHelper(t, ownerless)
}

func TestRuntimeProcessInventoryFindsDeletedCurrentExecutableOnLinux(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("deleted executable identity is exposed through Linux /proc")
	}
	root := t.TempDir()
	runtimeRoot := filepath.Join(root, ".redeven")
	stateRoot := runtimeRoot
	executable := filepath.Join(runtimeRoot, "runtime", "managed", "bin", "redeven")
	buildRuntimeProcessHelper(t, executable)
	process := startRuntimeProcessHelper(t, executable, stateRoot, "", filepath.Join(root, "deleted.ready"))
	if err := os.Remove(executable); err != nil {
		t.Fatal(err)
	}

	options := RuntimeProcessInventoryOptions{
		RuntimeRoot:        runtimeRoot,
		StateRoot:          stateRoot,
		DesktopOwnerID:     "desktop-owner",
		CurrentExecutables: []string{executable},
	}
	inventory, err := InspectRuntimeProcesses(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	if len(inventory.Instances) != 1 || !inventory.Instances[0].ExecutableDeleted {
		t.Fatalf("inventory = %#v", inventory)
	}
	if inventory.Instances[0].LayoutStatus != RuntimeProcessLayoutCurrent ||
		inventory.Instances[0].StopAuthority != RuntimeProcessStopConfirmedTakeover {
		t.Fatalf("instance = %#v", inventory.Instances[0])
	}
	result, err := StopRuntimeProcessesWithMode(
		context.Background(),
		options,
		inventory.InventoryDigest,
		2*time.Second,
		RuntimeProcessReconciliationConfirmedTakeover,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.After.Instances) != 0 {
		t.Fatalf("after = %#v", result.After)
	}
	waitRuntimeProcessHelper(t, process)
}
