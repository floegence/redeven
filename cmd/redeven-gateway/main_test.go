package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

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

func TestGatewayServiceServeArgsPropagatesPrecompiledRuntimeManifest(t *testing.T) {
	args := gatewayServiceServeArgs(
		"/tmp/redeven-gateway-state",
		"/tmp/redeven-runtime",
		"/Applications/Redeven.app/Contents/Resources/bin/desktop-bundle-manifest.json",
		"localhost:32140",
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
	args := gatewayServiceServeArgs("/tmp/state", "/tmp/runtime", "  ", "", "127.0.0.1:0")
	if strings.Contains(strings.Join(args, "\x00"), "precompiled-runtime-manifest") {
		t.Fatalf("service-start child args contain an empty precompiled Runtime manifest: %#v", args)
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
