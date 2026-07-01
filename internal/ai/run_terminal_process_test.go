package ai

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"sync/atomic"
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
	if snapshot.ProcessID == "" {
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

func TestTerminalProcessManagerSettlesPendingProcessOnceWhenProcessEnds(t *testing.T) {
	workspace := t.TempDir()
	var settlements atomic.Int32
	var settlementErr atomic.Value
	manager := newTerminalProcessManager(func(snapshot terminalProcessSnapshot) error {
		settlements.Add(1)
		if snapshot.Status != terminalProcessStatusSuccess {
			settlementErr.Store("settlement status was not success")
		}
		if !strings.Contains(snapshot.Output, "settled-output") {
			settlementErr.Store("settlement output did not include settled-output")
		}
		return nil
	})
	defer manager.Close()

	proc, err := manager.Start(terminalProcessStartRequest{
		EndpointID: "env_test",
		ThreadID:   "thread_test",
		RunID:      "run_test",
		TurnID:     "turn_test",
		ToolID:     "tool_test",
		ToolName:   "terminal.exec",
		Command:    "sleep 0.05; printf settled-output",
		CwdAbs:     workspace,
		Shell:      "/bin/bash",
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	running := proc.WaitForYield(1)
	if running.Status != terminalProcessStatusRunning {
		t.Fatalf("status=%q, want running", running.Status)
	}
	proc.MarkPending()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		snapshot, err := manager.Read(terminalProcessReadRequest{ProcessID: running.ProcessID, WaitMS: 50})
		if err != nil {
			t.Fatalf("Read: %v", err)
		}
		if snapshot.Status == terminalProcessStatusSuccess && settlements.Load() == 1 {
			break
		}
	}
	if got := settlements.Load(); got != 1 {
		t.Fatalf("settlements=%d, want one", got)
	}
	if raw := settlementErr.Load(); raw != nil {
		t.Fatalf("settlement callback error: %v", raw)
	}
	if _, err := manager.Read(terminalProcessReadRequest{ProcessID: running.ProcessID}); err != nil {
		t.Fatalf("Read after settlement: %v", err)
	}
	if got := settlements.Load(); got != 1 {
		t.Fatalf("settlements after reread=%d, want one", got)
	}
}

func TestTerminalProcessManagerRetriesDoneUntilSettlementAcknowledged(t *testing.T) {
	workspace := t.TempDir()
	var settlements atomic.Int32
	var settlementErr atomic.Value
	manager := newTerminalProcessManager(func(snapshot terminalProcessSnapshot) error {
		if snapshot.Status != terminalProcessStatusSuccess {
			settlementErr.Store("settlement status was not success")
		}
		if settlements.Add(1) == 1 {
			return errors.New("floret settlement unavailable")
		}
		return nil
	})
	defer manager.Close()

	proc, err := manager.Start(terminalProcessStartRequest{
		EndpointID: "env_test",
		ThreadID:   "thread_test",
		RunID:      "run_test",
		TurnID:     "turn_test",
		ToolID:     "tool_test",
		ToolName:   "terminal.exec",
		Command:    "printf retry-output",
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
	if got := settlements.Load(); got != 0 {
		t.Fatalf("settlements before pending=%d, want zero", got)
	}

	proc.MarkPending()
	if got := settlements.Load(); got != 1 {
		t.Fatalf("settlements after failed mark pending=%d, want one", got)
	}
	if raw := settlementErr.Load(); raw != nil {
		t.Fatalf("settlement callback error: %v", raw)
	}
	proc.mu.Lock()
	acknowledged := proc.settlementAcknowledged
	proc.mu.Unlock()
	if acknowledged {
		t.Fatalf("process acknowledged settlement before Floret success")
	}

	proc.publishDone()
	if got := settlements.Load(); got != 2 {
		t.Fatalf("settlements after retry=%d, want two", got)
	}
	proc.mu.Lock()
	acknowledged = proc.settlementAcknowledged
	proc.mu.Unlock()
	if !acknowledged {
		t.Fatalf("process did not acknowledge settlement after retry success")
	}
}

func TestReadTerminalProcessPublishesDoneOnlyAfterAccessValidation(t *testing.T) {
	workspace := t.TempDir()
	var settlements atomic.Int32
	manager := newTerminalProcessManager(func(snapshot terminalProcessSnapshot) error {
		settlements.Add(1)
		if snapshot.EndpointID != "env_owner" {
			return errors.New("unexpected endpoint settled")
		}
		return nil
	})
	defer manager.Close()

	proc, err := manager.Start(terminalProcessStartRequest{
		EndpointID: "env_owner",
		ThreadID:   "thread_owner",
		RunID:      "run_owner",
		TurnID:     "turn_owner",
		ToolID:     "tool_owner",
		ToolName:   "terminal.exec",
		Command:    "printf owner-output",
		CwdAbs:     workspace,
		Shell:      "/bin/bash",
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	snapshot := proc.WaitForYield(1000)
	if snapshot.Status != terminalProcessStatusSuccess {
		t.Fatalf("status=%q, want success", snapshot.Status)
	}
	proc.mu.Lock()
	proc.pending = true
	proc.mu.Unlock()

	svc := &Service{terminalProcesses: manager}
	wrongMeta := &session.Meta{EndpointID: "env_other", CanRead: true, CanWrite: true, CanExecute: true}
	if _, err := svc.ReadTerminalProcess(context.Background(), wrongMeta, "run_owner", snapshot.ProcessID, 0, 0, 0); err == nil {
		t.Fatalf("ReadTerminalProcess with wrong endpoint succeeded")
	}
	if got := settlements.Load(); got != 0 {
		t.Fatalf("settlements after denied read=%d, want zero", got)
	}

	ownerMeta := &session.Meta{EndpointID: "env_owner", CanRead: true, CanWrite: true, CanExecute: true}
	if _, err := svc.ReadTerminalProcess(context.Background(), ownerMeta, "run_owner", snapshot.ProcessID, 0, 0, 0); err != nil {
		t.Fatalf("ReadTerminalProcess owner: %v", err)
	}
	if got := settlements.Load(); got != 1 {
		t.Fatalf("settlements after authorized read=%d, want one", got)
	}
}

func TestHandleTerminalProcessDoneDoesNotAuditBeforeSettlement(t *testing.T) {
	store := openTerminalProcessTestStore(t)
	defer func() { _ = store.Close() }()
	upsertTerminalProcessTestRun(t, store, "env_1", "thread_1", "run_settlement_first", "turn_1")

	host := &recordingFloretHost{settleErr: errors.New("settlement failed")}
	activeRun := &run{id: "run_settlement_first", endpointID: "env_1", threadID: "thread_1", messageID: "turn_1"}
	activeRun.setActiveFloretHost(host)
	svc := &Service{
		threadsDB: store,
		runs:      map[string]*run{"run_settlement_first": activeRun},
		log:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	err := svc.handleTerminalProcessDone(terminalProcessSnapshot{
		ProcessID:       "tp_settlement_first",
		EndpointID:      "env_1",
		ThreadID:        "thread_1",
		RunID:           "run_settlement_first",
		TurnID:          "turn_1",
		ToolID:          "tool_settlement_first",
		ToolName:        "terminal.exec",
		Command:         "printf done",
		Cwd:             t.TempDir(),
		Status:          terminalProcessStatusSuccess,
		Output:          "done",
		StartedAtUnixMs: 100,
		EndedAtUnixMs:   200,
	})
	if err == nil {
		t.Fatalf("handleTerminalProcessDone succeeded despite settlement failure")
	}
	if len(host.settleRequests) != 1 {
		t.Fatalf("settle requests=%d, want one", len(host.settleRequests))
	}
	rec, err := store.GetToolCall(context.Background(), "env_1", "run_settlement_first", "tool_settlement_first")
	if err == nil {
		t.Fatalf("tool call was persisted before settlement success: %#v", rec)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("GetToolCall error=%v, want sql.ErrNoRows", err)
	}
}

func TestTerminalProcessWaitForYieldContextTerminatesOnCancel(t *testing.T) {
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
		Command:    "sleep 5",
		CwdAbs:     workspace,
		Shell:      "/bin/bash",
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	snapshot := proc.WaitForYieldContext(ctx, 10_000)
	if snapshot.Status != terminalProcessStatusCanceled {
		t.Fatalf("status=%q, want canceled", snapshot.Status)
	}
	if snapshot.EndedAtUnixMs <= 0 || snapshot.DurationMS < 0 {
		t.Fatalf("ended_at_ms=%d duration_ms=%d", snapshot.EndedAtUnixMs, snapshot.DurationMS)
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

func TestHandleToolCallTerminalExecCancelTerminatesProcess(t *testing.T) {
	workspace := t.TempDir()
	manager := newTerminalProcessManager(nil)
	defer manager.Close()
	store := openTerminalProcessTestStore(t)
	defer func() { _ = store.Close() }()
	upsertTerminalProcessTestRun(t, store, "env_1", "thread_1", "run_cancel", "turn_1")

	r := newTerminalProcessTestRun(workspace, &Service{terminalProcesses: manager}, store, "env_1", "thread_1", "run_cancel", "turn_1")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	outcome, err := r.handleToolCall(ctx, "tool_cancel", "terminal.exec", map[string]any{
		"command":  "sleep 5",
		"yield_ms": 10_000,
	})
	if err != nil {
		t.Fatalf("handleToolCall: %v", err)
	}
	if outcome == nil || outcome.Success || outcome.ToolError == nil || outcome.ToolError.Code != "CANCELED" {
		t.Fatalf("outcome=%#v, want canceled tool error", outcome)
	}
	result, ok := outcome.Result.(map[string]any)
	if !ok {
		t.Fatalf("result type=%T, want map", outcome.Result)
	}
	if got := strings.TrimSpace(anyToString(result["status"])); got != terminalProcessStatusCanceled {
		t.Fatalf("status=%q, want canceled in result payload %#v", got, result)
	}
	processID := strings.TrimSpace(anyToString(result["process_id"]))
	if processID == "" {
		t.Fatalf("missing process_id in canceled result: %#v", result)
	}
	snapshot, err := manager.Read(terminalProcessReadRequest{ProcessID: processID})
	if err != nil {
		t.Fatalf("Read canceled process: %v", err)
	}
	if snapshot.Status != terminalProcessStatusCanceled {
		t.Fatalf("process status=%q, want canceled", snapshot.Status)
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
	if outcome.Pending.Handle != processID {
		t.Fatalf("pending handle=%q, want process id %s", outcome.Pending.Handle, processID)
	}
	if _, ok := result["pending_handle"]; ok {
		t.Fatalf("terminal result must not expose pending_handle: %#v", result)
	}
	if got := strings.TrimSpace(anyToString(result["status"])); got != terminalProcessStatusRunning {
		t.Fatalf("status=%q, want running", got)
	}
	if _, err := manager.Terminate(processID); err != nil {
		t.Fatalf("Terminate: %v", err)
	}
}

func TestHandleToolCallTerminalPendingHandleIsProcessIDForInteractiveTools(t *testing.T) {
	workspace := t.TempDir()
	store := openTerminalProcessTestStore(t)
	defer func() { _ = store.Close() }()
	upsertTerminalProcessTestRun(t, store, "env_1", "thread_1", "run_interactive", "turn_1")
	manager := newTerminalProcessManager(nil)
	defer manager.Close()

	r := newTerminalProcessTestRun(workspace, &Service{terminalProcesses: manager}, store, "env_1", "thread_1", "run_interactive", "turn_1")

	outcome, err := r.handleToolCall(context.Background(), "tool_exec", "terminal.exec", map[string]any{
		"command":  "read line; printf 'reply:%s\\n' \"$line\"; sleep 5",
		"yield_ms": 1,
	})
	if err != nil {
		t.Fatalf("terminal.exec: %v", err)
	}
	if outcome == nil || outcome.Pending == nil {
		t.Fatalf("outcome=%#v, want pending", outcome)
	}
	processID := strings.TrimSpace(outcome.Pending.Handle)
	if processID == "" {
		t.Fatalf("pending handle is empty: %#v", outcome.Pending)
	}

	if _, err := r.handleToolCall(context.Background(), "tool_write", "terminal.write", map[string]any{
		"process_id": processID,
		"input":      "hello\n",
	}); err != nil {
		t.Fatalf("terminal.write with pending handle: %v", err)
	}
	readResult := readTerminalToolUntil(t, r, processID, "reply:hello")
	if _, err := r.handleToolCall(context.Background(), "tool_terminate", "terminal.terminate", map[string]any{
		"process_id": processID,
	}); err != nil {
		t.Fatalf("terminal.terminate with pending handle after output %#v: %v", readResult, err)
	}
}

func readTerminalToolUntil(t *testing.T, r *run, processID string, want string) map[string]any {
	t.Helper()
	var afterSeq int64
	deadline := time.Now().Add(3 * time.Second)
	var last map[string]any
	for time.Now().Before(deadline) {
		outcome, err := r.handleToolCall(context.Background(), "tool_read", "terminal.read", map[string]any{
			"process_id": processID,
			"after_seq":  afterSeq,
			"wait_ms":    500,
			"max_bytes":  10000,
		})
		if err != nil {
			t.Fatalf("terminal.read with pending handle: %v", err)
		}
		last, _ = outcome.Result.(map[string]any)
		if strings.Contains(anyToString(last["output"]), want) || strings.Contains(anyToString(last["latest_output"]), want) {
			return last
		}
		if seq := readInt64Field(last, "last_seq"); seq > afterSeq {
			afterSeq = seq
		}
	}
	t.Fatalf("terminal.read output=%#v, want %q", last, want)
	return nil
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
