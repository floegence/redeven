package ai

import (
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v4/identity"
	"github.com/floegence/redeven/internal/runtimeservice"
)

func TestSendUserTurnRejectsLifecycleAdmissionBeforeFloretMutation(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "lifecycle admission", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	svc.SetWorkloadAdmission(func(workload runtimeservice.ManagedWorkload) (func(), error) {
		if workload.Kind != "ai_turn" || !workload.Protected {
			t.Fatalf("workload = %#v", workload)
		}
		return nil, runtimeservice.ErrLifecycleAdmissionClosed
	})

	_, err = svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{
		ClientRequestID: "request-fenced", ThreadID: thread.ThreadID, Input: RunInput{Text: "must not start"},
	})
	if !errors.Is(err, runtimeservice.ErrLifecycleAdmissionClosed) {
		t.Fatalf("SendUserTurn error = %v", err)
	}
	view, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Items) != 0 || len(view.Queue) != 0 {
		t.Fatalf("fenced turn mutated Floret view = %#v", view)
	}
}

func TestAITurnWorkloadLeaseCoversCanonicalTurnLifetime(t *testing.T) {
	svc := newRealtimeTestService(t, 50*time.Millisecond)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "lifecycle lease", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	var admitted atomic.Int32
	var released atomic.Int32
	svc.SetWorkloadAdmission(func(workload runtimeservice.ManagedWorkload) (func(), error) {
		if workload.Kind != "ai_turn" {
			t.Fatalf("workload = %#v", workload)
		}
		admitted.Add(1)
		return func() { released.Add(1) }, nil
	})

	response, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{
		ClientRequestID: "request-leased", ThreadID: thread.ThreadID, Input: RunInput{Text: "finish"},
	})
	if err != nil || response.Kind != "start" {
		t.Fatalf("SendUserTurn response=%#v error=%v", response, err)
	}
	if admitted.Load() != 1 || released.Load() != 0 {
		t.Fatalf("lease immediately after admission = admitted:%d released:%d", admitted.Load(), released.Load())
	}
	deadline := time.Now().Add(3 * time.Second)
	for released.Load() != 1 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if released.Load() != 1 {
		t.Fatalf("turn lease was not released at canonical terminal state: admitted=%d released=%d", admitted.Load(), released.Load())
	}
}

func TestHostedTerminalProcessLeaseEndsAfterProcessReap(t *testing.T) {
	manager := newTerminalProcessManager()
	var released atomic.Int32
	manager.SetWorkloadAdmission(func(workload runtimeservice.ManagedWorkload) (func(), error) {
		if workload.Kind != "ai_terminal_process" || workload.Identity != "ai_terminal_process:process-leased" || !workload.Protected {
			t.Fatalf("workload = %#v", workload)
		}
		return func() { released.Add(1) }, nil
	})
	process, err := manager.Start(terminalProcessStartRequest{
		ProcessID: "process-leased", EndpointID: "env", ThreadID: "thread", RunID: "run", TurnID: "turn",
		ToolID: "tool", ToolName: "terminal.exec", Command: "exit 0", CwdAbs: t.TempDir(), Shell: "/bin/sh",
	})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-process.reapedDone:
	case <-time.After(3 * time.Second):
		t.Fatal("terminal process did not reap")
	}
	if released.Load() != 1 {
		t.Fatalf("terminal process release count = %d", released.Load())
	}
}

func TestHostedTerminalProcessRejectsLifecycleAdmissionBeforeSpawn(t *testing.T) {
	manager := newTerminalProcessManager()
	manager.SetWorkloadAdmission(func(runtimeservice.ManagedWorkload) (func(), error) {
		return nil, runtimeservice.ErrLifecycleAdmissionClosed
	})
	_, err := manager.Start(terminalProcessStartRequest{
		ProcessID: "process-fenced", EndpointID: "env", ThreadID: "thread", RunID: "run", TurnID: "turn",
		ToolID: "tool", ToolName: "terminal.exec", Command: "exit 0", CwdAbs: t.TempDir(), Shell: "/bin/sh",
	})
	if !errors.Is(err, runtimeservice.ErrLifecycleAdmissionClosed) {
		t.Fatalf("Start error = %v", err)
	}
	if manager.active != 0 || len(manager.processes) != 0 {
		t.Fatalf("fenced process mutated manager = active:%d processes:%d", manager.active, len(manager.processes))
	}
}
