package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/lockfile"
)

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
	if got := cli.runGatewayService(ctx, stateRoot, "127.0.0.1:0", false, false, false, false, "", ""); got != 0 {
		t.Fatalf("service exit = %d", got)
	}
	if _, err := os.Stat(filepath.Join(stateRoot, "runtime-lifecycle")); !os.IsNotExist(err) {
		t.Fatalf("Gateway created Runtime lifecycle state: %v", err)
	}
}
