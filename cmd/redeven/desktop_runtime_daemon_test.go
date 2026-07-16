package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/lockfile"
	"github.com/floegence/redeven/internal/runtimemanagement"
	"github.com/floegence/redeven/internal/runtimeservice"
)

func TestRuntimeProcessInventoryOptionsPreservesExplicitMachineScope(t *testing.T) {
	root := t.TempDir()
	stateRoot := filepath.Join(root, "state")
	runtimeRoot := filepath.Join(root, "runtime")
	options, err := runtimeProcessInventoryOptions(
		stateRoot,
		runtimeRoot,
		" desktop-owner ",
		[]string{filepath.Join(runtimeRoot, "bin", "redeven")},
	)
	if err != nil {
		t.Fatal(err)
	}
	if options.StateRoot != stateRoot || options.RuntimeRoot != runtimeRoot || options.DesktopOwnerID != "desktop-owner" {
		t.Fatalf("options = %#v", options)
	}
	if len(options.CurrentExecutables) != 1 {
		t.Fatalf("current executables = %#v", options.CurrentExecutables)
	}
}

func TestDesktopRuntimeStopAllMatchingRequiresDigestAsJSONError(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command := &cli{stdout: &stdout, stderr: &stderr}
	exitCode := command.desktopRuntimeStopCmd([]string{
		"--all-matching",
		"--json",
		"--state-root", t.TempDir(),
		"--runtime-root", t.TempDir(),
		"--desktop-owner-id", "desktop-owner",
	})
	if exitCode != 1 {
		t.Fatalf("exit code = %d, stderr = %q", exitCode, stderr.String())
	}
	var body runtimeProcessCommandError
	if err := json.Unmarshal(stdout.Bytes(), &body); err != nil {
		t.Fatalf("json error = %v, stdout = %q", err, stdout.String())
	}
	if body.SchemaVersion != runtimemanagement.RuntimeProcessInventorySchemaVersion || body.Error.Code != "runtime_process_operation_failed" {
		t.Fatalf("body = %#v", body)
	}
	if !strings.Contains(body.Error.Message, "--expected-inventory-digest") {
		t.Fatalf("message = %q", body.Error.Message)
	}
}

func TestRetireStaleRuntimeLeaseClearsStoppedRuntimeLock(t *testing.T) {
	lockPath := filepath.Join(t.TempDir(), "agent.lock")
	if err := os.WriteFile(lockPath, []byte("stale runtime lease\n"), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	status := runtimemanagement.RuntimeAttachStatus{
		State: runtimemanagement.AttachStateStaleLock,
		Diagnostics: runtimemanagement.RuntimeAttachDiagnostics{
			LockPath: lockPath,
			LockPID:  12345,
		},
	}
	if err := retireStaleRuntimeLease(status, 12345); err != nil {
		t.Fatalf("retireStaleRuntimeLease() error = %v", err)
	}
	body, err := os.ReadFile(lockPath)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if len(body) != 0 {
		t.Fatalf("lock content = %q, want empty retired lease", string(body))
	}
	lk, err := lockfile.Acquire(lockPath)
	if err != nil {
		t.Fatalf("Acquire() after retire error = %v", err)
	}
	if err := lk.Release(); err != nil {
		t.Fatalf("Release() after retire error = %v", err)
	}
}

func TestRetireStaleRuntimeLeaseRejectsDifferentStoppedPID(t *testing.T) {
	lockPath := filepath.Join(t.TempDir(), "agent.lock")
	original := []byte("another runtime lease\n")
	if err := os.WriteFile(lockPath, original, 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	status := runtimemanagement.RuntimeAttachStatus{
		State: runtimemanagement.AttachStateStaleLock,
		Diagnostics: runtimemanagement.RuntimeAttachDiagnostics{
			LockPath: lockPath,
			LockPID:  22222,
		},
	}
	err := retireStaleRuntimeLease(status, 11111)
	if err == nil || !strings.Contains(err.Error(), "expected stopped pid 11111") {
		t.Fatalf("retireStaleRuntimeLease() error = %v, want pid mismatch", err)
	}
	body, readErr := os.ReadFile(lockPath)
	if readErr != nil {
		t.Fatalf("ReadFile() error = %v", readErr)
	}
	if string(body) != string(original) {
		t.Fatalf("lock content changed to %q, want %q", string(body), string(original))
	}
}

func TestStoppedRuntimeStatusErrorRequiresConfirmedNotRunning(t *testing.T) {
	if err := stoppedRuntimeStatusError(runtimemanagement.RuntimeAttachStatus{
		State: runtimemanagement.AttachStateNotRunning,
	}); err != nil {
		t.Fatalf("stoppedRuntimeStatusError(not_running) error = %v", err)
	}

	err := stoppedRuntimeStatusError(runtimemanagement.RuntimeAttachStatus{
		State: runtimemanagement.AttachStateReady,
	})
	if err == nil || !strings.Contains(err.Error(), "state ready") {
		t.Fatalf("stoppedRuntimeStatusError(ready) error = %v, want ready state failure", err)
	}

	err = stoppedRuntimeStatusError(runtimemanagement.RuntimeAttachStatus{})
	if err == nil || !strings.Contains(err.Error(), "did not report a state") {
		t.Fatalf("stoppedRuntimeStatusError(empty) error = %v, want missing state failure", err)
	}
}

func TestDesktopLaunchReportFromRuntimeStatusIncludesStartTime(t *testing.T) {
	report := desktopLaunchReportFromRuntimeStatus(runtimemanagement.RuntimeAttachStatus{
		State: runtimemanagement.AttachStateReady,
		Identity: runtimemanagement.RuntimeInstanceIdentity{
			PID:             4242,
			StartedAtUnixMS: 1778751234567,
			DesktopManaged:  true,
			DesktopOwnerID:  "desktop-owner-status",
		},
		Endpoint: &runtimemanagement.RuntimeAttachEndpoint{
			LocalUIURL: "http://127.0.0.1:23998/",
		},
		RuntimeService: runtimeservice.NormalizeSnapshot(runtimeservice.Snapshot{
			ServiceOwner:     runtimeservice.OwnerDesktop,
			DesktopManaged:   true,
			EffectiveRunMode: "desktop",
			OpenReadiness: runtimeservice.OpenReadiness{
				State: runtimeservice.OpenReadinessOpenable,
			},
		}),
	}, desktopLaunchStatusReady)

	if report.StartedAtUnixMS != 1778751234567 {
		t.Fatalf("StartedAtUnixMS = %d", report.StartedAtUnixMS)
	}
	if report.PID != 4242 {
		t.Fatalf("PID = %d", report.PID)
	}
}
