//go:build darwin || linux

package ai

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/runtimeservice"
)

func terminalTestProcessAlive(t *testing.T, pid int) bool {
	t.Helper()
	out, err := exec.Command("ps", "-p", strconv.Itoa(pid), "-o", "stat=").Output()
	state := strings.TrimSpace(string(out))
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() == 1 && state == "" {
			return false
		}
		t.Errorf("inspect test process %d: %v", pid, err)
		return true
	}
	return state != "" && !strings.HasPrefix(state, "Z")
}

func TestTerminalCleanupSignalFailureRequiresGroupExit(t *testing.T) {
	cmd := exec.Command("sleep", "60")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	process := &terminalProcess{cmd: cmd}
	if err := process.waitForGroupExit(syscall.EPERM); !errors.Is(err, syscall.EPERM) {
		t.Fatalf("live group lost signal failure: %v", err)
	}
	if err := terminateTerminalExecProcessGroup(cmd); err != nil {
		t.Fatal(err)
	}
	// Model a final signal racing a successful Stop. The original failure
	// becomes harmless only after every live member has actually exited.
	if err := process.waitForGroupExit(syscall.EPERM); err != nil {
		t.Fatalf("exited group reported a stale signal failure: %v", err)
	}
}

func TestTerminalCleanupAcrossStopPaths(t *testing.T) {
	for _, action := range []string{"terminate", "close", "cancel", "timeout", "input-failure"} {
		t.Run(action, func(t *testing.T) {
			manager, process, child, released := startTerminalCleanupTest(t, "/bin/sh", "wait")
			snapshot, err := process.WaitForYieldContext(t.Context(), 20)
			if err != nil || snapshot.Status != terminalProcessStatusRunning || !terminalTestProcessAlive(t, child) || released.Load() != 0 {
				t.Fatalf("yield changed process ownership: %+v err=%v", snapshot, err)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			defer cancel()
			switch action {
			case "terminate":
				_, err = process.Terminate(ctx)
			case "close":
				err = manager.Close(ctx)
			case "cancel":
				canceled, stop := context.WithCancel(ctx)
				stop()
				_, err = process.WaitForYieldContext(canceled, 1000)
			case "timeout":
				process.maxRuntimeLoop(time.Millisecond)
			case "input-failure":
				process.recordInitialInputFailure(errors.New("input closed"))
			}
			if err != nil {
				t.Fatal(err)
			}
			if err := process.waitForReap(ctx); err != nil {
				t.Fatal(err)
			}
			terminalTestWaitGone(t, child)
			want := terminalProcessStatusCanceled
			if action == "input-failure" {
				want = terminalProcessStatusError
			}
			if process.Snapshot().Status != want || released.Load() != 1 {
				t.Fatalf("stop settlement: %+v released=%d", process.Snapshot(), released.Load())
			}
		})
	}
}

func TestTerminalCleanupPinsRootUntilFinalSignal(t *testing.T) {
	dir := t.TempDir()
	cmd := exec.Command("/bin/sh", "-c", "exit 7")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	waitExit := terminalExecExitWaiter(cmd)
	if err := waitExit(); err != nil {
		t.Fatal(err)
	}
	// Observing exit leaves the exact child available for Wait. Cleanup must
	// never turn its recorded exit status into cancellation.
	state, err := exec.Command("ps", "-p", strconv.Itoa(cmd.Process.Pid), "-o", "stat=").Output()
	if err != nil || !strings.HasPrefix(strings.TrimSpace(string(state)), "Z") {
		t.Fatalf("root was not retained as an unreaped child: state=%q err=%v", state, err)
	}
	drained := make(chan struct{})
	close(drained)
	process := &terminalProcess{cmd: cmd, cwd: dir, waitForExit: waitExit, status: terminalProcessStatusRunning, readDone: drained, reapedDone: make(chan struct{})}
	process.cond = sync.NewCond(&process.mu)
	process.waitLoop()
	if got := process.Snapshot(); got.ExitCode != 7 || got.Error == nil || got.Error.Code != aitools.ErrorCodeCommandFailed {
		t.Fatalf("cleanup changed exit: %+v", got)
	}
	// Even before output/result settlement, a retired root must never signal a
	// numeric group again. An unavailable command makes an accidental call fail.
	process.mu.Lock()
	process.status = terminalProcessStatusRunning
	process.cmd = nil
	process.mu.Unlock()
	if err := process.requestTermination(); err != nil {
		t.Fatalf("signaled a retired group: %v", err)
	}
}

func TestTerminalCleanupFailureRetainsAdmissionAndReportsError(t *testing.T) {
	cmd := exec.Command("/bin/sh", "-c", "exit 0")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	waitExit := terminalExecExitWaiter(cmd)
	if err := waitExit(); err != nil {
		t.Fatal(err)
	}
	failure := errors.New("exit observer failed")
	manager := newTerminalProcessManager()
	manager.active = 1
	var released atomic.Int32
	drained := make(chan struct{})
	close(drained)
	process := &terminalProcess{manager: manager, cmd: cmd, waitForExit: func() error { return failure }, status: terminalProcessStatusRunning, readDone: drained, reapedDone: make(chan struct{}), workloadRelease: func() { released.Add(1) }}
	process.cond = sync.NewCond(&process.mu)
	process.waitLoop()
	snapshot, err := process.Terminate(t.Context())
	if !errors.Is(err, failure) || snapshot.Status != terminalProcessStatusError || snapshot.Error == nil || snapshot.Error.Code != aitools.ErrorCodeTerminalRuntimeFailure {
		t.Fatalf("unconfirmed cleanup was hidden: %+v err=%v", snapshot, err)
	}
	if manager.active != 1 || released.Load() != 0 {
		t.Fatal("unconfirmed cleanup released workload admission")
	}
}

func TestTerminalWatchdogExitsAfterSettlement(t *testing.T) {
	process := &terminalProcess{reapedDone: make(chan struct{})}
	close(process.reapedDone)
	done := make(chan struct{})
	go func() { process.maxRuntimeLoop(time.Hour); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("completed command retained its watchdog")
	}
}

func terminalTestWaitGone(t *testing.T, pid int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for terminalTestProcessAlive(t, pid) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if terminalTestProcessAlive(t, pid) {
		t.Fatalf("owned child %d survived terminal cleanup", pid)
	}
}

func startTerminalCleanupTest(t *testing.T, shell, suffix string) (*terminalProcessManager, *terminalProcess, int, *atomic.Int32) {
	t.Helper()
	if _, err := os.Stat(shell); err != nil {
		t.Skipf("shell unavailable: %v", err)
	}
	dir := t.TempDir()
	manager := newTerminalProcessManager()
	released := &atomic.Int32{}
	manager.SetWorkloadAdmission(func(runtimeservice.ManagedWorkload) (func(), error) {
		return func() {
			raw, _ := os.ReadFile(filepath.Join(dir, "child.pid"))
			pid, _ := strconv.Atoi(strings.TrimSpace(string(raw)))
			if pid > 0 && terminalTestProcessAlive(t, pid) {
				t.Error("workload admission released before owned child exited")
			}
			released.Add(1)
		}, nil
	})
	readPID := func() int {
		raw, _ := os.ReadFile(filepath.Join(dir, "child.pid"))
		pid, _ := strconv.Atoi(strings.TrimSpace(string(raw)))
		return pid
	}
	t.Cleanup(func() {
		_ = manager.Close(context.Background())
		if pid := readPID(); pid > 0 {
			if terminalTestProcessAlive(t, pid) {
				_ = syscall.Kill(pid, syscall.SIGKILL)
			}
			terminalTestWaitGone(t, pid)
		}
	})
	// The ready handshake ensures the child ignores HUP before its parent exits.
	command := "nohup /bin/sh -c 'printf ready > ready; exec sleep 60' </dev/null >child.log 2>&1 & child=$!; printf '%s\n' \"$child\" > child.pid; while [ ! -f ready ]; do sleep 0.01; done; " + suffix
	process, err := manager.Start(terminalProcessStartRequest{
		ProcessID: t.Name(), EndpointID: "env", ThreadID: "thread", RunID: "run", TurnID: "turn",
		ToolID: "tool", ToolName: "terminal.exec", Command: command, CwdAbs: dir, Shell: shell,
		Env: []string{"HOME=" + dir, "PATH=/usr/bin:/bin"},
	})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if pid := readPID(); pid > 0 {
			if _, err := os.Stat(filepath.Join(dir, "ready")); err == nil {
				return manager, process, pid, released
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("child did not become ready: %+v", process.Snapshot())
	return nil, nil, 0, nil
}

func TestTerminalExitCleansBackgroundChildren(t *testing.T) {
	for _, shell := range []string{"/bin/sh", "/bin/bash", "/bin/zsh"} {
		for _, code := range []int{0, 7} {
			t.Run(fmt.Sprintf("%s/exit-%d", filepath.Base(shell), code), func(t *testing.T) {
				manager, process, child, released := startTerminalCleanupTest(t, shell, fmt.Sprintf("exit %d", code))
				ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
				defer cancel()
				if err := process.waitForReap(ctx); err != nil {
					t.Fatal(err)
				}
				terminalTestWaitGone(t, child)
				snapshot := process.Snapshot()
				want := terminalProcessStatusSuccess
				if code != 0 {
					want = terminalProcessStatusError
					if snapshot.Error == nil || snapshot.Error.Code != aitools.ErrorCodeCommandFailed {
						t.Fatalf("command failure was lost: %+v", snapshot)
					}
				}
				if snapshot.Status != want || snapshot.ExitCode != code || snapshot.ProcessID != process.id {
					t.Fatalf("exit facts changed: %+v", snapshot)
				}
				manager.mu.Lock()
				active := manager.active
				manager.mu.Unlock()
				if active != 0 || released.Load() != 1 {
					t.Fatalf("resource accounting after cleanup: active=%d released=%d", active, released.Load())
				}
				if _, err := process.Terminate(ctx); err != nil {
					t.Fatal(err)
				}
				if err := manager.Close(ctx); err != nil {
					t.Fatal(err)
				}
				if released.Load() != 1 || process.Snapshot().Status != want {
					t.Fatal("repeated cleanup changed terminal settlement")
				}
			})
		}
	}
}

func TestTerminalCleanupKeepsUnrelatedProcessAlive(t *testing.T) {
	unrelated := exec.Command("sleep", "60")
	unrelated.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := unrelated.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = unrelated.Process.Kill(); _ = unrelated.Wait() })
	_, process, child, _ := startTerminalCleanupTest(t, "/bin/sh", "exit 0")
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	if err := process.waitForReap(ctx); err != nil {
		t.Fatal(err)
	}
	terminalTestWaitGone(t, child)
	if !terminalTestProcessAlive(t, unrelated.Process.Pid) {
		t.Fatal("cleanup signaled an unrelated process group")
	}
}
