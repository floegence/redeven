package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/lockfile"
	gatewaysupervisor "github.com/floegence/redeven/internal/runtimegateway/supervisor"
)

func TestSupervisorEnrollRejectsEnrollmentCodeArgumentsWithoutEchoingSecret(t *testing.T) {
	secret := "rec_demo.0.rpn_demo.ren_never_echo"
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := runCLI([]string{
		"supervisor", "enroll", "--provider", "https://provider.example", "--environment", "env_demo", "--code=" + secret,
	}, strings.NewReader(""), &stdout, &stderr)
	if exitCode != 2 {
		t.Fatalf("exit code = %d, want 2", exitCode)
	}
	combined := stdout.String() + stderr.String()
	if strings.Contains(combined, secret) || strings.Contains(combined, "ren_never_echo") {
		t.Fatalf("CLI echoed enrollment secret: %q", combined)
	}
}

func TestReadEnrollmentCodeUsesStdinWithoutEcho(t *testing.T) {
	secret := "rec_demo.0.rpn_demo.ren_stdin_only"
	var prompt bytes.Buffer
	got, err := readEnrollmentCode(strings.NewReader(secret+"\n"), &prompt)
	if err != nil {
		t.Fatal(err)
	}
	if got != secret {
		t.Fatalf("enrollment code = %q", got)
	}
	if strings.Contains(prompt.String(), secret) {
		t.Fatal("stdin enrollment code was echoed")
	}
}

func TestServiceProcessMatchesRejectsReusedPIDMetadata(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	status := serviceStatus{
		PID:                    os.Getpid(),
		Executable:             executable,
		ProcessStartedAtUnixMS: processStartedAtUnixMS(os.Getpid()),
	}
	if !serviceProcessMatches(status) {
		t.Fatal("current Gateway process did not match its recorded identity")
	}
	status.ProcessStartedAtUnixMS++
	if serviceProcessMatches(status) {
		t.Fatal("service status accepted a reused PID with a different start time")
	}
}

func TestServiceProcessMatchesEventuallyRecoversTransientProbeFailure(t *testing.T) {
	attempts := 0
	matched := serviceProcessMatchesEventually(serviceStatus{PID: os.Getpid()}, 3, 0, func(serviceStatus) bool {
		attempts++
		return attempts == 3
	})
	if !matched || attempts != 3 {
		t.Fatalf("bounded process probe = %v after %d attempts, want success on attempt 3", matched, attempts)
	}

	attempts = 0
	matched = serviceProcessMatchesEventually(serviceStatus{PID: os.Getpid()}, 3, time.Nanosecond, func(serviceStatus) bool {
		attempts++
		return false
	})
	if matched || attempts != 3 {
		t.Fatalf("bounded process probe = %v after %d attempts, want failure after 3 attempts", matched, attempts)
	}
}

func TestGatewayServiceStoppedRequiresReleasedServiceLock(t *testing.T) {
	stateRoot := t.TempDir()
	serviceLock, err := lockfile.Acquire(filepath.Join(stateRoot, "gateway-service.lock"))
	if err != nil {
		t.Fatal(err)
	}
	status := serviceStatus{PID: 99999999, StateRoot: stateRoot}
	stopped, err := gatewayServiceStopped(stateRoot, status)
	if err != nil {
		t.Fatal(err)
	}
	if stopped {
		t.Fatal("Gateway service reported stopped while its service lock was held")
	}
	if err := serviceLock.Release(); err != nil {
		t.Fatal(err)
	}
	stopped, err = gatewayServiceStopped(stateRoot, status)
	if err != nil {
		t.Fatal(err)
	}
	if !stopped {
		t.Fatal("Gateway service did not report stopped after its process and lock were released")
	}
}

func TestGatewayServiceServeArgsPropagatesPrecompiledRuntimeManifest(t *testing.T) {
	args := gatewayServiceServeArgs(
		"managed_environment",
		"/tmp/redeven-gateway-state",
		"/tmp/redeven-runtime",
		"/Applications/Redeven.app/Contents/Resources/bin/desktop-bundle-manifest.json",
		"localhost:32140",
		"", "", "", "",
		"127.0.0.1:0",
	)
	joined := strings.Join(args, "\x00")
	if !strings.Contains(joined, "--precompiled-runtime-manifest\x00/Applications/Redeven.app/Contents/Resources/bin/desktop-bundle-manifest.json") {
		t.Fatalf("service-start child args do not contain the precompiled Runtime manifest: %#v", args)
	}
	if !strings.Contains(joined, "--precompiled-runtime-local-ui-bind\x00localhost:32140") {
		t.Fatalf("service-start child args do not contain the Runtime Local UI bind: %#v", args)
	}
}

func TestGatewayServiceServeArgsOmitsEmptyPrecompiledRuntimeManifest(t *testing.T) {
	args := gatewayServiceServeArgs("managed_environment", "/tmp/state", "/tmp/runtime", "  ", "", "", "", "", "", "127.0.0.1:0")
	if strings.Contains(strings.Join(args, "\x00"), "precompiled-runtime-manifest") {
		t.Fatalf("service-start child args contain an empty precompiled Runtime manifest: %#v", args)
	}
}

func TestGatewayServiceServeArgsStandaloneOmitsRuntimeFlags(t *testing.T) {
	args := gatewayServiceServeArgs("standalone", "/tmp/state", "", "", "", "", "", "", "", "127.0.0.1:0")
	joined := strings.Join(args, "\x00")
	if !strings.Contains(joined, "--mode\x00standalone") {
		t.Fatalf("standalone child args omit mode: %#v", args)
	}
	if strings.Contains(joined, "--runtime-root") || strings.Contains(joined, "--precompiled-runtime") {
		t.Fatalf("standalone child args contain Runtime flags: %#v", args)
	}
}

func TestStandaloneServeRejectsRuntimeConfiguration(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := runCLI([]string{
		"serve", "--mode", "standalone", "--runtime-root", filepath.Join(t.TempDir(), "runtime"),
	}, strings.NewReader(""), &stdout, &stderr)
	if exitCode != 2 || !strings.Contains(stderr.String(), "standalone mode cannot configure a Runtime") {
		t.Fatalf("standalone Runtime configuration result = %d stderr=%q", exitCode, stderr.String())
	}
}

func TestStandaloneGatewayServiceDoesNotCreateRuntimeState(t *testing.T) {
	stateRoot := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := (&cli{stdin: strings.NewReader(""), stdout: &stdout, stderr: &stderr}).runGatewayService(
		ctx, "standalone", stateRoot, "", "", "", "", "", "", "", "127.0.0.1:0", false, false, false, false, "", "",
	)
	if exitCode != 0 {
		t.Fatalf("standalone service exit = %d stderr=%q", exitCode, stderr.String())
	}
	if _, err := os.Stat(filepath.Join(stateRoot, "runtime-lifecycle")); !os.IsNotExist(err) {
		t.Fatalf("standalone Gateway created Runtime lifecycle state: %v", err)
	}
	if _, err := os.Stat(filepath.Join(stateRoot, "runtime-target-binding-v2.json")); !os.IsNotExist(err) {
		t.Fatalf("standalone Gateway created Runtime binding state: %v", err)
	}
}

func TestGatewayStartupFailurePreservesStructuredRuntimeConvergence(t *testing.T) {
	failure := gatewayStartupFailureForError(&gatewaysupervisor.PrecompiledRuntimeConvergenceError{
		Code:     "runtime_target_active_workload_confirmation_required",
		Reason:   "the managed Runtime still owns active workloads",
		Recovery: "close the environment workloads and retry",
	})
	if failure.Code != "runtime_target_active_workload_confirmation_required" ||
		failure.Reason != "the managed Runtime still owns active workloads" ||
		failure.Recovery != "close the environment workloads and retry" {
		t.Fatalf("structured startup failure = %#v", failure)
	}
}

func TestGatewayStartupFailureClassifiesLegacyBindingMigration(t *testing.T) {
	failure := gatewayStartupFailureForError(errors.New("initialize Runtime target binding: migrate Runtime target binding schema v1 to v2: unsupported suite"))
	if failure.Code != "runtime_target_binding_migration_failed" || !strings.Contains(failure.Recovery, "do not delete") {
		t.Fatalf("binding migration startup failure = %#v", failure)
	}
}

func TestWaitServiceReadyReadsPersistedStructuredStartupFailure(t *testing.T) {
	stateRoot := t.TempDir()
	want := gatewayStartupFailure{
		SchemaVersion: 1,
		Code:          "runtime_target_active_workload_confirmation_required",
		Reason:        "active workloads prevent automatic replacement",
		Recovery:      "close the workloads and retry",
	}
	if err := writeGatewayStartupFailure(stateRoot, want); err != nil {
		t.Fatal(err)
	}
	got := readGatewayStartupFailure(stateRoot)
	if got != want {
		t.Fatalf("readGatewayStartupFailure() = %#v, want %#v", got, want)
	}
	_, err := waitServiceReady(stateRoot, 99999999)
	if err == nil || !strings.Contains(err.Error(), want.Code) || !strings.Contains(err.Error(), want.Recovery) {
		t.Fatalf("waitServiceReady() error = %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(stateRoot, "gateway-startup-failure-v1.json")); statErr != nil {
		t.Fatal(statErr)
	}
}
