//go:build !windows

package ai

import (
	"context"
	"errors"
	"os/exec"
	"sync"
	"testing"
	"time"
)

func TestTerminalStopPreservesConcurrentNormalExit(t *testing.T) {
	for _, exit := range []string{"0", "1"} {
		t.Run(exit, func(t *testing.T) {
			cmd := exec.Command("/bin/sh", "-c", "exit "+exit)
			if err := cmd.Start(); err != nil {
				t.Fatal(err)
			}
			drained := make(chan struct{})
			close(drained)
			process := &terminalProcess{cmd: cmd, status: terminalProcessStatusRunning, terminationRequested: true, readDone: drained, reapedDone: make(chan struct{})}
			process.cond = sync.NewCond(&process.mu)
			process.waitLoop()
			want := terminalProcessStatusSuccess
			if exit == "1" {
				want = terminalProcessStatusError
			}
			if got := process.Snapshot().Status; got != want {
				t.Fatalf("concurrent exit %s became %s", exit, got)
			}
		})
	}
}

func TestTerminalStopReturnsTerminationFailureWithoutWaiting(t *testing.T) {
	process := &terminalProcess{status: terminalProcessStatusRunning, reapedDone: make(chan struct{})}
	process.cond = sync.NewCond(&process.mu)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	start := time.Now()
	snapshot, err := process.WaitForYieldContext(ctx, 10000)
	if err == nil || errors.Is(err, context.DeadlineExceeded) || time.Since(start) > time.Second {
		t.Fatalf("termination failure was hidden or blocked: %v", err)
	}
	if snapshot.Status != terminalProcessStatusRunning || process.terminationRequested {
		t.Fatalf("failed termination was marked confirmed: %#v", snapshot)
	}
}

func TestTerminalStopRequiresOutputDrain(t *testing.T) {
	cmd := exec.Command("/bin/sh", "-c", "exit 0")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	process := &terminalProcess{cmd: cmd, status: terminalProcessStatusRunning, readDone: make(chan struct{}), reapedDone: make(chan struct{})}
	process.cond = sync.NewCond(&process.mu)
	process.waitLoop()
	_, err := process.WaitForYieldContext(t.Context(), 10000)
	if err == nil {
		t.Fatal("undrained output was confirmed")
	}
}
