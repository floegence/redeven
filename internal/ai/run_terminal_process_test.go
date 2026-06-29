package ai

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

func TestTerminalProcessManagerQuickCompletionCapturesPTYOutput(t *testing.T) {
	workspace := t.TempDir()
	manager := newTerminalProcessManager(nil)
	defer manager.Close()

	proc, err := manager.Start(terminalProcessStartRequest{
		EndpointID: "env_test",
		ThreadID:   "thread_test",
		RunID:      "run_test",
		TurnID:     "turn_test",
		ToolID:     "tool_test",
		ToolName:   "terminal.exec",
		Command:    "printf quick-output",
		CwdAbs:     workspace,
		Shell:      "/bin/bash",
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}

	snapshot := proc.WaitForYield(1000)
	if snapshot.Status != terminalProcessStatusSuccess {
		t.Fatalf("status=%q, want success; output=%q", snapshot.Status, snapshot.Output)
	}
	if !strings.Contains(snapshot.Output, "quick-output") {
		t.Fatalf("output=%q, want quick-output", snapshot.Output)
	}
	if snapshot.ProcessID == "" || snapshot.PendingHandle == "" {
		t.Fatalf("missing process identity: %+v", snapshot)
	}
	if snapshot.ExecutionLocation != ToolTargetModeLocalRuntime {
		t.Fatalf("execution_location=%q, want %q", snapshot.ExecutionLocation, ToolTargetModeLocalRuntime)
	}
	if snapshot.EndedAtUnixMs <= 0 || snapshot.DurationMS < 0 {
		t.Fatalf("ended_at_ms=%d duration_ms=%d", snapshot.EndedAtUnixMs, snapshot.DurationMS)
	}
}

func TestTerminalProcessManagerReadWriteAndTerminate(t *testing.T) {
	workspace := t.TempDir()
	manager := newTerminalProcessManager(nil)
	defer manager.Close()

	proc, err := manager.Start(terminalProcessStartRequest{
		EndpointID: "env_test",
		ThreadID:   "thread_test",
		RunID:      "run_test",
		TurnID:     "turn_test",
		ToolID:     "tool_test",
		ToolName:   "terminal.exec",
		Command:    "read line; printf 'reply:%s\\n' \"$line\"; sleep 5",
		CwdAbs:     workspace,
		Shell:      "/bin/bash",
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}

	running := proc.WaitForYield(20)
	if running.Status != terminalProcessStatusRunning {
		t.Fatalf("status=%q, want running", running.Status)
	}
	written, err := manager.Write(running.ProcessID, "hello\n")
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	read := managerReadUntil(t, manager, running.ProcessID, written.LastSeq, "reply:hello")
	if !strings.Contains(read.Output, "reply:hello") {
		t.Fatalf("output=%q, want reply", read.Output)
	}

	terminated, err := manager.Terminate(running.ProcessID)
	if err != nil {
		t.Fatalf("Terminate: %v", err)
	}
	if terminated.Status != terminalProcessStatusCanceled {
		t.Fatalf("status=%q, want canceled", terminated.Status)
	}
}

func TestHandleToolCallTerminalExecQuickCompletionPersistsProcessFields(t *testing.T) {
	workspace := t.TempDir()
	store := openTerminalProcessTestStore(t)
	defer func() { _ = store.Close() }()
	upsertTerminalProcessTestRun(t, store, "env_1", "thread_1", "run_quick", "turn_1")

	r := newTerminalProcessTestRun(workspace, &Service{terminalProcesses: newTerminalProcessManager(nil)}, store, "env_1", "thread_1", "run_quick", "turn_1")

	outcome, err := r.handleToolCall(context.Background(), "tool_quick", "terminal.exec", map[string]any{
		"command":  "printf quick-output",
		"yield_ms": 1000,
	})
	if err != nil {
		t.Fatalf("handleToolCall: %v", err)
	}
	if outcome == nil || !outcome.Success || outcome.Pending != nil {
		t.Fatalf("outcome=%#v, want quick success", outcome)
	}
	result, ok := outcome.Result.(map[string]any)
	if !ok {
		t.Fatalf("result type=%T, want map", outcome.Result)
	}
	if got := strings.TrimSpace(anyToString(result["status"])); got != terminalProcessStatusSuccess {
		t.Fatalf("status=%q, want success", got)
	}
	if strings.TrimSpace(anyToString(result["process_id"])) == "" {
		t.Fatalf("missing process_id: %#v", result)
	}
	if !strings.Contains(anyToString(result["output"]), "quick-output") {
		t.Fatalf("output=%q, want quick-output", result["output"])
	}
	if _, ok := result["timeout_ms"]; ok {
		t.Fatalf("timeout_ms should not be present: %#v", result)
	}
}

func TestHandleToolCallTerminalExecReturnsPendingProcess(t *testing.T) {
	workspace := t.TempDir()
	store := openTerminalProcessTestStore(t)
	defer func() { _ = store.Close() }()
	upsertTerminalProcessTestRun(t, store, "env_1", "thread_1", "run_pending", "turn_1")
	manager := newTerminalProcessManager(nil)
	defer manager.Close()

	r := newTerminalProcessTestRun(workspace, &Service{terminalProcesses: manager}, store, "env_1", "thread_1", "run_pending", "turn_1")

	outcome, err := r.handleToolCall(context.Background(), "tool_pending", "terminal.exec", map[string]any{
		"command":  "sleep 5",
		"yield_ms": 1,
	})
	if err != nil {
		t.Fatalf("handleToolCall: %v", err)
	}
	if outcome == nil || outcome.Pending == nil {
		t.Fatalf("outcome=%#v, want pending", outcome)
	}
	result, ok := outcome.Result.(map[string]any)
	if !ok {
		t.Fatalf("result type=%T, want map", outcome.Result)
	}
	processID := strings.TrimSpace(anyToString(result["process_id"]))
	if processID == "" {
		t.Fatalf("missing process_id: %#v", result)
	}
	if outcome.Pending.Handle != terminalProcessPendingHandle(processID) {
		t.Fatalf("pending handle=%q, want process handle for %s", outcome.Pending.Handle, processID)
	}
	if got := strings.TrimSpace(anyToString(result["status"])); got != terminalProcessStatusRunning {
		t.Fatalf("status=%q, want running", got)
	}
	if _, err := manager.Terminate(processID); err != nil {
		t.Fatalf("Terminate: %v", err)
	}
}

func managerReadUntil(t *testing.T, manager *terminalProcessManager, processID string, afterSeq int64, want string) terminalProcessSnapshot {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		snapshot, err := manager.Read(terminalProcessReadRequest{
			ProcessID: processID,
			AfterSeq:  afterSeq,
			WaitMS:    50,
			MaxBytes:  200_000,
		})
		if err != nil {
			t.Fatalf("Read: %v", err)
		}
		if strings.Contains(snapshot.Output, want) {
			return snapshot
		}
		afterSeq = snapshot.LastSeq
	}
	snapshot, _ := manager.Read(terminalProcessReadRequest{ProcessID: processID})
	t.Fatalf("process output never contained %q; last output=%q", want, snapshot.Output)
	return terminalProcessSnapshot{}
}

func openTerminalProcessTestStore(t *testing.T) *threadstore.Store {
	t.Helper()
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	return store
}

func upsertTerminalProcessTestRun(t *testing.T, store *threadstore.Store, endpointID string, threadID string, runID string, turnID string) {
	t.Helper()
	if err := store.UpsertRun(context.Background(), threadstore.RunRecord{
		RunID:      runID,
		EndpointID: endpointID,
		ThreadID:   threadID,
		MessageID:  turnID,
		State:      "running",
	}); err != nil {
		t.Fatalf("UpsertRun: %v", err)
	}
}

func newTerminalProcessTestRun(workspace string, svc *Service, store *threadstore.Store, endpointID string, threadID string, runID string, turnID string) *run {
	return newRun(runOptions{
		Log:              slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		RunID:            runID,
		EndpointID:       endpointID,
		ThreadID:         threadID,
		MessageID:        turnID,
		AgentHomeDir:     workspace,
		WorkingDir:       workspace,
		Shell:            "/bin/bash",
		Service:          svc,
		ThreadsDB:        store,
		PersistOpTimeout: 5 * time.Second,
		SessionMeta: &session.Meta{
			EndpointID: endpointID,
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
		},
	})
}
