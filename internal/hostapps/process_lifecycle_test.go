//go:build unix

package hostapps

import (
	"context"
	"errors"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestWindowReadinessCancellationReapsProbeChildren(t *testing.T) {
	dir, err := os.MkdirTemp("", "xpra-cancel-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	listener, err := net.Listen("unix", filepath.Join(dir, "socket"))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	probe := filepath.Join(dir, "probe")
	// A child inheriting stdout must not hold readiness open after cancellation.
	if err = os.WriteFile(probe, []byte("#!/bin/sh\nsleep 5 &\ntouch "+quoteArgv([]string{filepath.Join(dir, "started")})+"\nwait\n"), 0700); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	finished := make(chan bool, 1)
	go func() { finished <- sessionHasWindows(ctx, probe, dir) }()
	// Wait until the probe really spawned its child before cancelling it.
	deadline := time.Now().Add(3 * time.Second)
	for {
		if _, err := os.Stat(filepath.Join(dir, "started")); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("probe did not start")
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	select {
	case ready := <-finished:
		if ready {
			t.Fatal("cancelled probe reported a window")
		}
	case <-time.After(time.Second):
		t.Fatal("probe outlived session cancellation")
	}
}

func TestProcessSupervisorReclaimsDescendantsWhenLeaderExits(t *testing.T) {
	m := macFixture(t)
	dir := filepath.Join(m.state, "sessions", "group")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	// This fake launcher exits while a child remains in its owned process group.
	launcher := filepath.Join(dir, "launcher")
	if err := os.WriteFile(launcher, []byte("#!/bin/sh\nsleep 30 &\nexit 0\n"), 0700); err != nil {
		t.Fatal(err)
	}
	f, err := m.forwards.OpenOwnedForwardSession(context.Background(), "http://127.0.0.1:45531/_redeven_host_app/")
	if err != nil {
		t.Fatal(err)
	}
	s := &ownedSession{view: Session{ID: "group", State: "starting", Forward: f}, owner: "alice", done: make(chan struct{}), tools: hostTools{dbus: launcher}}
	m.sessions[s.view.ID] = s
	m.run(s, dir, "127.0.0.1:45531")
	// Remove a child left by the old implementation even when this assertion fails.
	defer syscall.Kill(-s.cmd.Process.Pid, syscall.SIGKILL)
	deadline := time.Now().Add(time.Second)
	for {
		err = syscall.Kill(-s.cmd.Process.Pid, 0)
		if errors.Is(err, syscall.ESRCH) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("session completed with a live descendant process")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestStopBeforeProcessAdmissionWaitsForSupervisor(t *testing.T) {
	m := macFixture(t)
	f, err := m.forwards.OpenOwnedForwardSession(context.Background(), "http://127.0.0.1:45532/_redeven_host_app/")
	if err != nil {
		t.Fatal(err)
	}
	s := &ownedSession{view: Session{ID: "pending", State: "starting", Forward: f}, owner: "alice", done: make(chan struct{})}
	m.sessions[s.view.ID] = s
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	err = m.Stop(ctx, "alice", s.view.ID)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("stop returned before supervisor completed: %v", err)
	}
	dir := filepath.Join(m.state, "sessions", s.view.ID)
	if err = os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	m.run(s, dir, "127.0.0.1:45532")
	if err = m.Stop(context.Background(), "alice", s.view.ID); err != nil {
		t.Fatal(err)
	}
	if s.cmd != nil || s.view.State != "ended" {
		t.Fatal("cancelled admission launched a process")
	}
}

func TestStopCancellationDoesNotAbandonTermination(t *testing.T) {
	m := macFixture(t)
	f, err := m.forwards.OpenOwnedForwardSession(context.Background(), "http://127.0.0.1:45533/_redeven_host_app/")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("/bin/sh", "-c", "trap '' TERM; printf ready; exec sleep 30")
	configureProcess(cmd)
	output, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	buffer := make([]byte, 5)
	if _, err = output.Read(buffer); err != nil {
		t.Fatal(err)
	}
	s := &ownedSession{view: Session{ID: "cancelled-stop", State: "running", Forward: f}, owner: "alice", done: make(chan struct{}), cmd: cmd}
	m.sessions[s.view.ID] = s
	go func() { _ = cmd.Wait(); m.finish(s, "", nil) }()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err = m.Stop(ctx, "alice", s.view.ID); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected bounded caller cancellation, got %v", err)
	}
	select {
	case <-s.done:
	case <-time.After(7 * time.Second):
		_ = cmd.Process.Kill()
		t.Fatal("caller cancellation abandoned the process group")
	}
}
