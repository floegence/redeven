package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/gatewaycloud"
	"github.com/floegence/redeven/internal/gatewaystate"
	"github.com/floegence/redeven/internal/lockfile"
)

func TestCloudConnectDefaultsToOfficialCloud(t *testing.T) {
	if gatewaycloud.DefaultCloudOrigin != "https://"+strings.Join([]string{"redeven", "com"}, ".") {
		t.Fatalf("default Cloud origin = %q", gatewaycloud.DefaultCloudOrigin)
	}
}

func TestGatewayStartupExitReportsFailureWithoutWaitingForPIDDisappearance(t *testing.T) {
	root := t.TempDir()
	failure := gatewayStartupFailureForError(&gatewaystate.ReadError{Code: "gateway_state_unsupported", File: "members.json", Message: "unsupported schema_version 4; expected 5"})
	if err := writeGatewayStartupFailure(root, failure); err != nil {
		t.Fatal(err)
	}
	exited := make(chan struct{})
	close(exited)
	started := time.Now()
	_, err := waitServiceReady(root, os.Getpid(), exited, time.Second)
	if err == nil || !strings.Contains(err.Error(), "gateway_state_unsupported") || !strings.Contains(err.Error(), "schema_version 4") {
		t.Fatalf("startup error = %v", err)
	}
	if time.Since(started) > 500*time.Millisecond {
		t.Fatal("known failure waited for a live or zombie PID")
	}
}

func TestGatewayStartupIgnoresAnotherAttemptFailureAndBoundsTimeout(t *testing.T) {
	root := t.TempDir()
	failure := gatewayStartupFailure{SchemaVersion: 1, PID: os.Getpid() + 1, Code: "unrelated_failure", Reason: "stale"}
	if err := writeGatewayStartupFailure(root, failure); err != nil {
		t.Fatal(err)
	}
	exited := make(chan struct{})
	close(exited)
	_, err := waitServiceReady(root, os.Getpid(), exited, time.Second)
	if err == nil || strings.Contains(err.Error(), "stale") {
		t.Fatalf("stale failure = %v", err)
	}
	_, err = waitServiceReady(root, os.Getpid(), make(chan struct{}), time.Millisecond)
	if err == nil || !strings.Contains(err.Error(), "gateway_startup_timeout") {
		t.Fatalf("timeout = %v", err)
	}
}

func TestGatewayStatusExposesFailureUntilItsStateFileIsCorrected(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "members.json")
	if err := os.WriteFile(file, []byte(`{"schema_version":4}`), 0600); err != nil {
		t.Fatal(err)
	}
	cli := &cli{stderr: &strings.Builder{}}
	cli.failGatewayStartup(root, &gatewaystate.ReadError{Code: "gateway_state_unsupported", File: "members.json", Message: "unsupported schema_version 4"})
	if status := readServiceStatus(root); status.Status != "error" || status.ErrorCode != "gateway_state_unsupported" || status.Recovery == "" {
		t.Fatalf("status = %#v", status)
	}
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if status := readServiceStatus(root); status.Status != "not_running" {
		t.Fatalf("repaired status = %#v", status)
	}
}

func TestServiceProcessMatchesRejectsReusedPIDMetadata(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	status := serviceStatus{PID: os.Getpid(), Executable: executable, ProcessStartedAtUnixMS: processStartedAtUnixMS(os.Getpid())}
	if !serviceProcessMatches(status) {
		t.Fatal("current Gateway process did not match its recorded identity")
	}
	status.ProcessStartedAtUnixMS++
	if serviceProcessMatches(status) {
		t.Fatal("service status accepted a reused PID with a different start time")
	}
}

func TestServiceProcessMatchesEventuallyIsBounded(t *testing.T) {
	attempts := 0
	matched := serviceProcessMatchesEventually(serviceStatus{PID: os.Getpid()}, 3, 0, func(serviceStatus) bool {
		attempts++
		return attempts == 3
	})
	if !matched || attempts != 3 {
		t.Fatalf("probe = %v after %d attempts", matched, attempts)
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
	if err != nil || stopped {
		t.Fatalf("stopped = %v, err = %v while lock is held", stopped, err)
	}
	if err := serviceLock.Release(); err != nil {
		t.Fatal(err)
	}
	stopped, err = gatewayServiceStopped(stateRoot, status)
	if err != nil || !stopped {
		t.Fatalf("stopped = %v, err = %v after lock release", stopped, err)
	}
}

func TestGatewayServiceServeArgsContainOnlyGatewayArguments(t *testing.T) {
	args := gatewayServiceServeArgs("/tmp/state", "127.0.0.1:0")
	joined := strings.Join(args, "\x00")
	if !strings.Contains(joined, "serve\x00--state-root\x00/tmp/state") || strings.Contains(joined, "runtime") {
		t.Fatalf("Gateway child args contain Runtime lifecycle configuration: %#v", args)
	}
}

func TestGatewayServiceStartsWithoutRuntimeState(t *testing.T) {
	stateRoot := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	cli := &cli{stdin: strings.NewReader(""), stdout: &strings.Builder{}, stderr: &strings.Builder{}}
	if got := cli.runGatewayService(ctx, stateRoot, "127.0.0.1:0", false, false, "", "127.0.0.1:0", ""); got != 0 {
		t.Fatalf("service exit = %d", got)
	}
	if _, err := os.Stat(filepath.Join(stateRoot, "runtime-lifecycle")); !os.IsNotExist(err) {
		t.Fatalf("Gateway created Runtime lifecycle state: %v", err)
	}
}
