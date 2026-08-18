package supervisor

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestControllerArtifactVersionProbeHasIndependentTimeout(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("executable fixture is a POSIX shell script")
	}
	stateRoot := t.TempDir()
	runtimeRoot := filepath.Join(t.TempDir(), "runtime-root")
	bindings, err := OpenLocalBindingStore(stateRoot, runtimeRoot)
	if err != nil {
		t.Fatal(err)
	}
	controller, err := NewController(ControllerOptions{BindingStore: bindings, ArtifactProbeTimeout: 50 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	executable := []byte("#!/bin/sh\nsleep 10\n")
	archivePath := filepath.Join(t.TempDir(), "runtime.tar.gz")
	writeRuntimeArchiveFixture(t, archivePath, executable)
	executablePath := filepath.Join(t.TempDir(), "redeven")
	if err := os.WriteFile(executablePath, executable, 0o700); err != nil {
		t.Fatal(err)
	}
	executableDigest, err := fileSHA256(executablePath)
	if err != nil {
		t.Fatal(err)
	}
	operation := gatewayprotocol.RuntimeOperation{
		OperationID:    "op-probe-timeout",
		DesiredRuntime: gatewayprotocol.DesiredRuntime{Version: "0.11.0"},
		Artifact:       &gatewayprotocol.RuntimeArtifact{StagedPath: archivePath, ExecutableSHA256: executableDigest},
	}
	startedAt := time.Now()
	_, err = controller.extractRuntimeArtifact(context.Background(), operation)
	if err == nil || err.Error() != "staged Runtime version check timed out" {
		t.Fatalf("extractRuntimeArtifact() error = %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed > 2*time.Second {
		t.Fatalf("version probe exceeded bounded timeout: %v", elapsed)
	}
	stagingRoot := filepath.Join(runtimeRoot, "runtime", "staging", safeOperationID(operation.OperationID))
	if _, statErr := os.Stat(stagingRoot); !os.IsNotExist(statErr) {
		t.Fatalf("failed artifact extraction left staging residue: %v", statErr)
	}
}

func TestControllerArtifactStagingPreservesRequiredRuntimeCompanions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("executable fixture is a POSIX shell script")
	}
	stateRoot := t.TempDir()
	runtimeRoot := filepath.Join(t.TempDir(), "runtime-root")
	bindings, err := OpenLocalBindingStore(stateRoot, runtimeRoot)
	if err != nil {
		t.Fatal(err)
	}
	controller, err := NewController(ControllerOptions{BindingStore: bindings})
	if err != nil {
		t.Fatal(err)
	}
	managedRoot := filepath.Join(runtimeRoot, "runtime", "managed")
	pluginBytes := []byte("published plugin runtime")
	descriptorBytes := []byte("{\"verified\":true}\n")
	writeExecutableFixture(t, filepath.Join(managedRoot, "bin", "redevplugin-runtime"), pluginBytes)
	if err := os.WriteFile(filepath.Join(managedRoot, "bin", ".redevplugin-release-artifacts-verified.json"), descriptorBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(managedRoot, "managed-runtime.stamp"), []byte("obsolete\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	candidate := []byte("#!/bin/sh\nprintf 'redeven v9.9.9-e2e\\n'\n")
	archivePath := filepath.Join(t.TempDir(), "runtime.tar.gz")
	writeRuntimeArchiveFixture(t, archivePath, candidate)
	candidatePath := filepath.Join(t.TempDir(), "redeven")
	if err := os.WriteFile(candidatePath, candidate, 0o700); err != nil {
		t.Fatal(err)
	}
	candidateDigest, err := fileSHA256(candidatePath)
	if err != nil {
		t.Fatal(err)
	}
	operation := gatewayprotocol.RuntimeOperation{
		OperationID:    "op-preserve-companions",
		DesiredRuntime: gatewayprotocol.DesiredRuntime{Version: "v9.9.9-e2e"},
		Artifact:       &gatewayprotocol.RuntimeArtifact{StagedPath: archivePath, ExecutableSHA256: candidateDigest},
	}
	stagingRoot, err := controller.extractRuntimeArtifact(context.Background(), operation)
	if err != nil {
		t.Fatal(err)
	}
	for path, expected := range map[string][]byte{
		filepath.Join(stagingRoot, "bin", "redevplugin-runtime"):                          pluginBytes,
		filepath.Join(stagingRoot, "bin", ".redevplugin-release-artifacts-verified.json"): descriptorBytes,
	} {
		actual, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read preserved Runtime companion %q: %v", path, err)
		}
		if !bytes.Equal(actual, expected) {
			t.Fatalf("preserved Runtime companion %q = %q, want %q", path, actual, expected)
		}
	}
	if _, err := os.Stat(filepath.Join(stagingRoot, "managed-runtime.stamp")); !os.IsNotExist(err) {
		t.Fatalf("obsolete managed Runtime stamp was preserved: %v", err)
	}
}

func writeRuntimeArchiveFixture(t *testing.T, path string, executable []byte) {
	t.Helper()
	var archive bytes.Buffer
	gzipWriter := gzip.NewWriter(&archive)
	tarWriter := tar.NewWriter(gzipWriter)
	if err := tarWriter.WriteHeader(&tar.Header{Name: "redeven", Mode: 0o700, Size: int64(len(executable)), Typeflag: tar.TypeReg}); err != nil {
		t.Fatal(err)
	}
	if _, err := tarWriter.Write(executable); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, archive.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
}

const recoveryRuntimeProcessHelperSource = `package main

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

func TestControllerRecoveryRestoresPreviousExecutableIdempotently(t *testing.T) {
	stateRoot := t.TempDir()
	runtimeRoot := filepath.Join(t.TempDir(), "runtime-root")
	bindings, err := OpenLocalBindingStore(stateRoot, runtimeRoot)
	if err != nil {
		t.Fatal(err)
	}
	controller, err := NewController(ControllerOptions{BindingStore: bindings})
	if err != nil {
		t.Fatal(err)
	}
	operation := gatewayprotocol.RuntimeOperation{OperationID: "op-recover"}
	managedRoot := filepath.Join(runtimeRoot, "runtime", "managed")
	previousRoot := managedRoot + ".previous." + safeOperationID(operation.OperationID)
	writeExecutableFixture(t, filepath.Join(managedRoot, "bin", "redeven"), []byte("failed candidate"))
	previousBinary := filepath.Join(previousRoot, "bin", "redeven")
	previousBytes := []byte("previous runtime")
	writeExecutableFixture(t, previousBinary, previousBytes)
	previousDigest, err := fileSHA256(previousBinary)
	if err != nil {
		t.Fatal(err)
	}
	checkpoint := operationCheckpoint{
		OperationID: operation.OperationID, Phase: checkpointArtifactActive,
		ManagedRoot: managedRoot, PreviousManagedRoot: previousRoot, PreviousManagedPresent: true,
		PreviousExecutableSHA256: previousDigest,
	}
	if err := controller.writeCheckpoint(checkpoint); err != nil {
		t.Fatal(err)
	}
	if err := controller.Recover(context.Background(), operation); err != nil {
		t.Fatalf("first Recover() error = %v", err)
	}
	if err := controller.Recover(context.Background(), operation); err != nil {
		t.Fatalf("second Recover() error = %v", err)
	}
	restored, err := os.ReadFile(filepath.Join(managedRoot, "bin", "redeven"))
	if err != nil {
		t.Fatal(err)
	}
	if string(restored) != string(previousBytes) {
		t.Fatalf("restored executable = %q", restored)
	}
}

func TestControllerRecoveryRemovesFailedFirstInstallIdempotently(t *testing.T) {
	stateRoot := t.TempDir()
	runtimeRoot := filepath.Join(t.TempDir(), "runtime-root")
	bindings, err := OpenLocalBindingStore(stateRoot, runtimeRoot)
	if err != nil {
		t.Fatal(err)
	}
	controller, err := NewController(ControllerOptions{BindingStore: bindings})
	if err != nil {
		t.Fatal(err)
	}
	operation := gatewayprotocol.RuntimeOperation{OperationID: "op-first-install"}
	managedRoot := filepath.Join(runtimeRoot, "runtime", "managed")
	writeExecutableFixture(t, filepath.Join(managedRoot, "bin", "redeven"), []byte("failed candidate"))
	checkpoint := operationCheckpoint{
		OperationID: operation.OperationID, Phase: checkpointArtifactActive,
		ManagedRoot: managedRoot, PreviousManagedRoot: managedRoot + ".previous." + safeOperationID(operation.OperationID),
	}
	if err := controller.writeCheckpoint(checkpoint); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := controller.Recover(context.Background(), operation); err != nil {
			t.Fatalf("Recover() error = %v", err)
		}
	}
	if _, err := os.Stat(managedRoot); !os.IsNotExist(err) {
		t.Fatalf("managed root still exists after failed first install: %v", err)
	}
}

func TestControllerRecoveryTerminatesCandidateFromDurableLaunchIntent(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Runtime process recovery is Unix-only")
	}
	stateRoot := t.TempDir()
	runtimeRoot := filepath.Join(t.TempDir(), "runtime-root")
	bindings, err := OpenLocalBindingStore(stateRoot, runtimeRoot)
	if err != nil {
		t.Fatal(err)
	}
	controller, err := NewController(ControllerOptions{BindingStore: bindings, ShutdownWait: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	managedRoot := filepath.Join(runtimeRoot, "runtime", "managed")
	executable := filepath.Join(managedRoot, "bin", "redeven")
	if err := os.MkdirAll(filepath.Dir(executable), 0o700); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(t.TempDir(), "runtime-process-helper.go")
	if err := os.WriteFile(source, []byte(recoveryRuntimeProcessHelperSource), 0o600); err != nil {
		t.Fatal(err)
	}
	build := exec.Command("go", "build", "-o", executable, source)
	build.Env = append(os.Environ(), "GOWORK=off")
	if output, buildErr := build.CombinedOutput(); buildErr != nil {
		t.Fatalf("build Runtime process helper: %v\n%s", buildErr, output)
	}
	readyFile := filepath.Join(t.TempDir(), "candidate.ready")
	command := exec.Command(executable, "run", "--mode", "desktop", "--state-root", runtimeRoot)
	command.Env = append(os.Environ(), "REDEVEN_TEST_READY_FILE="+readyFile)
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
	for {
		if _, err := os.Stat(readyFile); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("Runtime candidate did not become ready")
		}
		time.Sleep(20 * time.Millisecond)
	}

	operation := gatewayprotocol.RuntimeOperation{OperationID: "op-launch-intent"}
	if err := controller.writeCheckpoint(operationCheckpoint{
		OperationID: operation.OperationID,
		Phase:       operationCheckpointPhase("candidate_launching"),
		ManagedRoot: managedRoot,
	}); err != nil {
		t.Fatal(err)
	}
	if err := controller.Recover(context.Background(), operation); err != nil {
		t.Fatalf("Recover() error = %v", err)
	}
	exited := make(chan error, 1)
	go func() { exited <- command.Wait() }()
	select {
	case <-exited:
		command.Process = nil
	case <-time.After(3 * time.Second):
		t.Fatal("Runtime candidate survived recovery from launch intent")
	}
}

func TestControllerActivateStagingRestoresPreviousInstallationWhenActivationFails(t *testing.T) {
	runtimeRoot := t.TempDir()
	managedRoot := filepath.Join(runtimeRoot, "runtime", "managed")
	previousRoot := managedRoot + ".previous.operation"
	managedBinary := filepath.Join(managedRoot, "bin", "redeven")
	writeExecutableFixture(t, managedBinary, []byte("previous runtime"))
	controller := &Controller{}

	err := controller.activateStaging(operationCheckpoint{
		OperationID: "operation", ManagedRoot: managedRoot, PreviousManagedRoot: previousRoot,
		StagingRoot: filepath.Join(runtimeRoot, "runtime", "missing-staging"),
	})
	if err == nil {
		t.Fatal("activateStaging() succeeded without a staging root")
	}
	restored, readErr := os.ReadFile(managedBinary)
	if readErr != nil {
		t.Fatalf("read restored executable: %v", readErr)
	}
	if string(restored) != "previous runtime" {
		t.Fatalf("restored executable = %q", restored)
	}
	if _, statErr := os.Stat(previousRoot); !os.IsNotExist(statErr) {
		t.Fatalf("previous root still exists after activation rollback: %v", statErr)
	}
}

func TestControllerRecoveryIsIdempotentAcrossCheckpointPhases(t *testing.T) {
	phases := []operationCheckpointPhase{
		checkpointPrepared,
		checkpointRuntimeStopped,
		checkpointArtifactActive,
		operationCheckpointPhase("candidate_launching"),
		checkpointCandidateStarted,
		checkpointVerified,
		checkpointRecovering,
		checkpointRecovered,
	}
	for _, phase := range phases {
		t.Run(string(phase), func(t *testing.T) {
			stateRoot := t.TempDir()
			runtimeRoot := filepath.Join(t.TempDir(), "runtime-root")
			bindings, err := OpenLocalBindingStore(stateRoot, runtimeRoot)
			if err != nil {
				t.Fatal(err)
			}
			controller, err := NewController(ControllerOptions{BindingStore: bindings})
			if err != nil {
				t.Fatal(err)
			}
			operation := gatewayprotocol.RuntimeOperation{OperationID: "op-" + string(phase)}
			managedRoot := filepath.Join(runtimeRoot, "runtime", "managed")
			previousRoot := managedRoot + ".previous." + safeOperationID(operation.OperationID)
			stagingRoot := filepath.Join(runtimeRoot, "runtime", "staging", safeOperationID(operation.OperationID))
			failedRoot := managedRoot + ".failed." + safeOperationID(operation.OperationID)
			previousBytes := []byte("previous runtime")
			writeExecutableFixture(t, filepath.Join(stagingRoot, "bin", "redeven"), []byte("staged candidate"))
			writeExecutableFixture(t, filepath.Join(failedRoot, "bin", "redeven"), []byte("failed residue"))
			if phase == checkpointPrepared || phase == checkpointRuntimeStopped || phase == checkpointRecovered {
				writeExecutableFixture(t, filepath.Join(managedRoot, "bin", "redeven"), previousBytes)
			} else {
				writeExecutableFixture(t, filepath.Join(managedRoot, "bin", "redeven"), []byte("failed candidate"))
				writeExecutableFixture(t, filepath.Join(previousRoot, "bin", "redeven"), previousBytes)
			}
			managedPreviousBinary := filepath.Join(managedRoot, "bin", "redeven")
			previousDigest := ""
			if phase == checkpointPrepared || phase == checkpointRuntimeStopped || phase == checkpointRecovered {
				previousDigest, err = fileSHA256(managedPreviousBinary)
			} else {
				previousDigest, err = fileSHA256(filepath.Join(previousRoot, "bin", "redeven"))
			}
			if err != nil {
				t.Fatal(err)
			}
			checkpoint := operationCheckpoint{
				OperationID: operation.OperationID, Phase: phase,
				ManagedRoot: managedRoot, PreviousManagedRoot: previousRoot, StagingRoot: stagingRoot,
				PreviousManagedPresent: true, PreviousExecutableSHA256: previousDigest,
			}
			if err := controller.writeCheckpoint(checkpoint); err != nil {
				t.Fatal(err)
			}
			for range 2 {
				if err := controller.Recover(context.Background(), operation); err != nil {
					t.Fatalf("Recover() error = %v", err)
				}
			}
			restored, err := os.ReadFile(managedPreviousBinary)
			if err != nil {
				t.Fatal(err)
			}
			if string(restored) != string(previousBytes) {
				t.Fatalf("restored executable = %q", restored)
			}
			for _, residualRoot := range []string{stagingRoot, previousRoot, failedRoot} {
				if _, statErr := os.Stat(residualRoot); !os.IsNotExist(statErr) {
					t.Fatalf("recovery residual %q still exists: %v", residualRoot, statErr)
				}
			}
		})
	}
}

func TestCandidateExecutablePathsRetainEveryActivationLocation(t *testing.T) {
	checkpoint := operationCheckpoint{
		OperationID: "op-paths", ManagedRoot: "/runtime/managed",
		PreviousManagedRoot: "/runtime/managed.previous", StagingRoot: "/runtime/staging/op-paths",
		Candidate: &candidateProcessIdentity{ExecutablePath: "/runtime/managed-renamed/bin/redeven"},
	}
	paths := candidateExecutablePaths(checkpoint)
	expected := []string{
		"/runtime/managed-renamed/bin/redeven",
		"/runtime/managed/bin/redeven",
		"/runtime/managed.previous/bin/redeven",
		"/runtime/staging/op-paths/bin/redeven",
		"/runtime/managed.failed." + safeOperationID(checkpoint.OperationID) + "/bin/redeven",
	}
	for _, path := range expected {
		found := false
		for _, candidate := range paths {
			if candidate == path {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("candidate executable path %q is missing from %v", path, paths)
		}
	}
}

func writeExecutableFixture(t *testing.T, path string, value []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, value, 0o700); err != nil {
		t.Fatal(err)
	}
}
