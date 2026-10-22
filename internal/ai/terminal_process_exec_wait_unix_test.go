//go:build !windows

package ai

import (
	"context"
	"testing"
	"time"
)

func TestTerminalExecYieldReturnsRunningProcessThenFinalStatus(t *testing.T) {
	manager := newTerminalProcessManager()
	t.Cleanup(func() { _ = manager.Close(context.Background()) })

	process, err := manager.Start(terminalProcessStartRequest{
		ProcessID: "terminal-exec-yield-test", EndpointID: "endpoint-test", ThreadID: "thread-test",
		RunID: "run-test", TurnID: "turn-test", ToolID: "tool-test", ToolName: "terminal.exec",
		Command: "read input; printf 'finished:%s\\n' \"$input\"", CwdAbs: t.TempDir(), Shell: "/bin/sh",
		Env: []string{"HOME=" + t.TempDir(), "PATH=/usr/bin:/bin"},
	})
	if err != nil {
		t.Fatal(err)
	}

	snapshot, err := process.WaitForYieldContext(t.Context(), 20)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Status != terminalProcessStatusRunning || snapshot.ProcessID != "terminal-exec-yield-test" {
		t.Fatalf("yield did not return the live process: %+v", snapshot)
	}
	if terminalProcessResultPayload(snapshot)["completed"] != false {
		t.Fatal("running terminal.exec result was marked completed")
	}
	process.mu.Lock()
	terminationRequested := process.terminationRequested
	process.mu.Unlock()
	if terminationRequested {
		t.Fatal("ending the initial wait requested process termination")
	}
	select {
	case <-process.reapedDone:
		t.Fatal("process was reaped when only the initial wait ended")
	default:
	}

	if _, err := process.Write("done\n"); err != nil {
		t.Fatalf("release interactive command: %v", err)
	}
	snapshot, err = process.WaitForYieldContext(t.Context(), int64(time.Second/time.Millisecond))
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Status != terminalProcessStatusSuccess || terminalProcessResultPayload(snapshot)["completed"] != true {
		t.Fatalf("completed terminal.exec result not returned: %+v", snapshot)
	}
	if snapshot.ProcessID != "terminal-exec-yield-test" || snapshot.ExitCode != 0 {
		t.Fatalf("completed process identity or exit code lost: %+v", snapshot)
	}
}
