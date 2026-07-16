package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/session"
)

func TestTerminalProcessManagerQuickCompletionCapturesPTYOutput(t *testing.T) {
	workspace := t.TempDir()
	manager := newTerminalProcessManager(nil)
	defer manager.Close()

	proc, err := manager.Start(terminalProcessStartRequest{
		EndpointID:         "env_test",
		ThreadID:           "thread_test",
		RunID:              "run_test",
		TurnID:             "turn_test",
		SettlementThreadID: "thread_test",
		SettlementRunID:    "run_test",
		SettlementTurnID:   "turn_test",
		ToolID:             "tool_test",
		ToolName:           "terminal.exec",
		Command:            `if [ -n "${REDEVEN_LOCAL_UI_PASSWORD+x}${REDEVEN_BOOTSTRAP_TICKET+x}${REDEVEN_DESKTOP_BOOTSTRAP_TICKET+x}" ]; then printf secret-leaked; else printf quick-output; fi`,
		CwdAbs:             workspace,
		Shell:              "/bin/bash",
		Env: []string{
			"PATH=" + os.Getenv("PATH"),
			"REDEVEN_LOCAL_UI_PASSWORD=password-secret",
			"REDEVEN_BOOTSTRAP_TICKET=ticket-secret",
			"REDEVEN_DESKTOP_BOOTSTRAP_TICKET=legacy-ticket",
		},
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

func TestTerminalProcessManagerStartRequiresSettlementIdentity(t *testing.T) {
	workspace := t.TempDir()
	manager := newTerminalProcessManager(nil)
	defer manager.Close()

	_, err := manager.Start(terminalProcessStartRequest{
		EndpointID:         "env_test",
		ThreadID:           "thread_audit",
		RunID:              "run_audit",
		TurnID:             "turn_audit",
		SettlementThreadID: "thread_floret",
		SettlementTurnID:   "turn_floret",
		ToolID:             "tool_test",
		ToolName:           "terminal.exec",
		Command:            "printf should-not-run",
		CwdAbs:             workspace,
		Shell:              "/bin/bash",
	})
	if err == nil || !strings.Contains(err.Error(), "settlement target incomplete") {
		t.Fatalf("Start err=%v, want settlement target incomplete", err)
	}
	manager.mu.Lock()
	active := manager.active
	processes := len(manager.processes)
	manager.mu.Unlock()
	if active != 0 || processes != 0 {
		t.Fatalf("terminal process started without settlement identity: active=%d processes=%d", active, processes)
	}
}

func TestTerminalProcessSnapshotDoesNotExposeSettlementIdentityJSON(t *testing.T) {
	workspace := t.TempDir()
	manager := newTerminalProcessManager(nil)
	defer manager.Close()

	proc, err := manager.Start(terminalProcessStartRequest{
		EndpointID:         "env_test",
		ThreadID:           "thread_audit",
		RunID:              "run_audit",
		TurnID:             "turn_audit",
		SettlementThreadID: "thread_floret",
		SettlementRunID:    "run_floret",
		SettlementTurnID:   "turn_floret",
		ToolID:             "tool_test",
		ToolName:           "terminal.exec",
		Command:            "printf quick-output",
		CwdAbs:             workspace,
		Shell:              "/bin/bash",
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}

	snapshot := proc.WaitForYield(1000)
	if snapshot.SettlementThreadID != "thread_floret" ||
		snapshot.SettlementRunID != "run_floret" ||
		snapshot.SettlementTurnID != "turn_floret" {
		t.Fatalf("internal settlement identity = (%q,%q,%q), want Floret identity",
			snapshot.SettlementThreadID, snapshot.SettlementRunID, snapshot.SettlementTurnID)
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	encoded := string(raw)
	for _, forbidden := range []string{
		"settlement_thread_id",
		"settlement_run_id",
		"settlement_turn_id",
		"thread_floret",
		"run_floret",
		"turn_floret",
	} {
		if strings.Contains(encoded, forbidden) {
			t.Fatalf("terminal snapshot JSON leaked %q: %s", forbidden, encoded)
		}
	}
	if !strings.Contains(encoded, "run_audit") {
		t.Fatalf("terminal snapshot JSON missing audit run id: %s", encoded)
	}
}

func TestTerminalProcessReadAfterReturnsOnlyNewOutput(t *testing.T) {
	proc := newBufferedTerminalProcessForTest(terminalProcessStatusSuccess)
	proc.appendOutput([]byte("phase 1\n"))

	first, err := proc.ReadAfter(terminalProcessReadRequest{
		AfterSeq: 0,
		WaitMS:   0,
		MaxBytes: terminalProcessModelReadBytes,
	})
	if err != nil {
		t.Fatalf("first ReadAfter: %v", err)
	}
	if first.Output != "phase 1\n" || first.FirstSeq != 1 || first.LastSeq != 1 || first.LatestSeq != 1 || first.HasMore {
		t.Fatalf("first read=%#v, want only phase 1 at sequence 1", first)
	}

	proc.appendOutput([]byte("phase 2\n"))
	second, err := proc.ReadAfter(terminalProcessReadRequest{
		AfterSeq: first.LastSeq,
		WaitMS:   0,
		MaxBytes: terminalProcessModelReadBytes,
	})
	if err != nil {
		t.Fatalf("second ReadAfter: %v", err)
	}
	if second.Output != "phase 2\n" || strings.Contains(second.Output, "phase 1") || second.FirstSeq != 2 || second.LastSeq != 2 || second.LatestSeq != 2 || second.HasMore {
		t.Fatalf("second read=%#v, want only phase 2 at sequence 2", second)
	}
}

func TestTerminalProcessReadAfterPaginatesWithoutDuplicatesOrGaps(t *testing.T) {
	proc := newBufferedTerminalProcessForTest(terminalProcessStatusSuccess)
	want := strings.Repeat("a", terminalProcessOutputChunkBytes) +
		strings.Repeat("b", terminalProcessOutputChunkBytes) +
		strings.Repeat("c", 517)
	proc.appendOutput([]byte(want))

	afterSeq := int64(0)
	var got strings.Builder
	reads := 0
	for {
		read, err := proc.ReadAfter(terminalProcessReadRequest{
			AfterSeq: afterSeq,
			WaitMS:   0,
			MaxBytes: terminalProcessModelReadBytes,
		})
		if err != nil {
			t.Fatalf("ReadAfter(%d): %v", afterSeq, err)
		}
		reads++
		if read.LastSeq < afterSeq {
			t.Fatalf("last_seq moved backward: read=%#v", read)
		}
		got.WriteString(read.Output)
		afterSeq = read.LastSeq
		if !read.HasMore {
			if afterSeq != read.LatestSeq {
				t.Fatalf("final cursor=%d latest=%d", afterSeq, read.LatestSeq)
			}
			break
		}
	}
	if reads != 2 {
		t.Fatalf("reads=%d, want 2", reads)
	}
	if got.String() != want {
		t.Fatalf("paged output mismatch: got %d bytes, want %d", got.Len(), len(want))
	}
}

func TestTerminalProcessReadAfterEmptyDeltaPreservesCursor(t *testing.T) {
	proc := newBufferedTerminalProcessForTest(terminalProcessStatusSuccess)
	proc.appendOutput([]byte("done\n"))

	read, err := proc.ReadAfter(terminalProcessReadRequest{
		AfterSeq: 1,
		WaitMS:   0,
		MaxBytes: terminalProcessModelReadBytes,
	})
	if err != nil {
		t.Fatalf("ReadAfter: %v", err)
	}
	if read.Output != "" || read.FirstSeq != 0 || read.LastSeq != 1 || read.LatestSeq != 1 || read.HasMore {
		t.Fatalf("empty read=%#v, want unchanged cursor", read)
	}
}

func TestTerminalProcessReadAfterWaitsForNewOutput(t *testing.T) {
	proc := newBufferedTerminalProcessForTest(terminalProcessStatusRunning)
	result := make(chan terminalProcessSnapshot, 1)
	errs := make(chan error, 1)
	go func() {
		read, err := proc.ReadAfter(terminalProcessReadRequest{
			AfterSeq: 0,
			WaitMS:   500,
			MaxBytes: terminalProcessModelReadBytes,
		})
		result <- read
		errs <- err
	}()

	time.Sleep(20 * time.Millisecond)
	proc.appendOutput([]byte("ready\n"))
	select {
	case err := <-errs:
		if err != nil {
			t.Fatalf("ReadAfter: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("ReadAfter did not wake for new output")
	}
	read := <-result
	if read.Output != "ready\n" || read.LastSeq != 1 {
		t.Fatalf("read=%#v, want ready delta", read)
	}
}

func TestTerminalProcessReadAfterWakesWhenProcessEndsWithoutOutput(t *testing.T) {
	proc := newBufferedTerminalProcessForTest(terminalProcessStatusRunning)
	result := make(chan terminalProcessSnapshot, 1)
	errs := make(chan error, 1)
	go func() {
		read, err := proc.ReadAfter(terminalProcessReadRequest{
			AfterSeq: 0,
			WaitMS:   500,
			MaxBytes: terminalProcessModelReadBytes,
		})
		result <- read
		errs <- err
	}()

	time.Sleep(20 * time.Millisecond)
	proc.mu.Lock()
	proc.status = terminalProcessStatusSuccess
	proc.endedAt = time.Now()
	proc.cond.Broadcast()
	proc.mu.Unlock()
	select {
	case err := <-errs:
		if err != nil {
			t.Fatalf("ReadAfter: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("ReadAfter did not wake when the process ended")
	}
	read := <-result
	if read.Status != terminalProcessStatusSuccess || read.Output != "" || read.LastSeq != 0 {
		t.Fatalf("read=%#v, want completed empty delta", read)
	}
}

func TestTerminalProcessReadAfterRejectsFutureCursor(t *testing.T) {
	proc := newBufferedTerminalProcessForTest(terminalProcessStatusSuccess)
	proc.appendOutput([]byte("one\n"))

	_, err := proc.ReadAfter(terminalProcessReadRequest{
		AfterSeq: 2,
		WaitMS:   0,
		MaxBytes: terminalProcessModelReadBytes,
	})
	if err == nil || !strings.Contains(err.Error(), "exceeds latest sequence") {
		t.Fatalf("error=%v, want future cursor rejection", err)
	}
}

func TestTerminalProcessReadAfterMarksRetentionGapTruncated(t *testing.T) {
	proc := newBufferedTerminalProcessForTest(terminalProcessStatusSuccess)
	proc.appendOutput([]byte(strings.Repeat("x", terminalProcessTailCapBytes+terminalProcessOutputChunkBytes)))

	read, err := proc.ReadAfter(terminalProcessReadRequest{
		AfterSeq: 0,
		WaitMS:   0,
		MaxBytes: terminalProcessTailCapBytes,
	})
	if err != nil {
		t.Fatalf("ReadAfter: %v", err)
	}
	if !read.Truncated || read.FirstSeq != 2 || read.LastSeq != 251 || read.LatestSeq != 251 || read.HasMore {
		t.Fatalf("read=%#v, want retained sequences 2..251 with truncation", read)
	}
	if len(read.Output) != terminalProcessTailCapBytes {
		t.Fatalf("retained output bytes=%d, want %d", len(read.Output), terminalProcessTailCapBytes)
	}
	proc.mu.Lock()
	defer proc.mu.Unlock()
	for _, chunk := range proc.outputChunks {
		if len(chunk.data) > terminalProcessOutputChunkBytes {
			t.Fatalf("chunk %d has %d bytes, max %d", chunk.seq, len(chunk.data), terminalProcessOutputChunkBytes)
		}
	}
}

func newBufferedTerminalProcessForTest(status string) *terminalProcess {
	proc := &terminalProcess{
		id:        "tp_buffered_test",
		command:   "test command",
		cwd:       "/workspace",
		status:    status,
		startedAt: time.Now(),
	}
	proc.cond = sync.NewCond(&proc.mu)
	return proc
}

func TestTerminalProcessManagerReadWriteAndTerminate(t *testing.T) {
	workspace := t.TempDir()
	manager := newTerminalProcessManager(nil)
	defer manager.Close()

	proc, err := manager.Start(terminalProcessStartRequest{
		EndpointID:         "env_test",
		ThreadID:           "thread_test",
		RunID:              "run_test",
		TurnID:             "turn_test",
		SettlementThreadID: "thread_test",
		SettlementRunID:    "run_test",
		SettlementTurnID:   "turn_test",
		ToolID:             "tool_test",
		ToolName:           "terminal.exec",
		Command:            "read line; printf 'reply:%s\\n' \"$line\"; sleep 5",
		CwdAbs:             workspace,
		Shell:              "/bin/bash",
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
		EndpointID:         "env_test",
		ThreadID:           "thread_test",
		RunID:              "run_test",
		TurnID:             "turn_test",
		SettlementThreadID: "thread_test",
		SettlementRunID:    "run_test",
		SettlementTurnID:   "turn_test",
		ToolID:             "tool_test",
		ToolName:           "terminal.exec",
		Command:            "sleep 0.05; printf settled-output",
		CwdAbs:             workspace,
		Shell:              "/bin/bash",
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
		snapshot := proc.Snapshot()
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
	_ = proc.Snapshot()
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
		EndpointID:         "env_test",
		ThreadID:           "thread_test",
		RunID:              "run_test",
		TurnID:             "turn_test",
		SettlementThreadID: "thread_test",
		SettlementRunID:    "run_test",
		SettlementTurnID:   "turn_test",
		ToolID:             "tool_test",
		ToolName:           "terminal.exec",
		Command:            "printf retry-output",
		CwdAbs:             workspace,
		Shell:              "/bin/bash",
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

	if err := proc.publishDone(); err != nil {
		t.Fatalf("publishDone retry: %v", err)
	}
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
		EndpointID:         "env_owner",
		ThreadID:           "thread_owner",
		RunID:              "run_owner",
		TurnID:             "turn_owner",
		SettlementThreadID: "thread_owner",
		SettlementRunID:    "run_owner",
		SettlementTurnID:   "turn_owner",
		ToolID:             "tool_owner",
		ToolName:           "terminal.exec",
		Command:            "printf owner-output",
		CwdAbs:             workspace,
		Shell:              "/bin/bash",
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
	if _, err := svc.ReadTerminalProcess(context.Background(), wrongMeta, "run_owner", snapshot.ProcessID, 0); err == nil {
		t.Fatalf("ReadTerminalProcess with wrong endpoint succeeded")
	}
	if got := settlements.Load(); got != 0 {
		t.Fatalf("settlements after denied read=%d, want zero", got)
	}

	ownerMeta := &session.Meta{EndpointID: "env_owner", CanRead: true, CanWrite: true, CanExecute: true}
	if _, err := svc.ReadTerminalProcess(context.Background(), ownerMeta, "run_owner", snapshot.ProcessID, 0); err != nil {
		t.Fatalf("ReadTerminalProcess owner: %v", err)
	}
	if got := settlements.Load(); got != 1 {
		t.Fatalf("settlements after authorized read=%d, want one", got)
	}
}

func TestTerminalProcessServicesWithholdTerminalSnapshotUntilSettlementAcknowledged(t *testing.T) {
	workspace := t.TempDir()
	meta := &session.Meta{EndpointID: "env_owner", CanRead: true, CanWrite: true, CanExecute: true}

	tests := []struct {
		name string
		call func(*Service, string) (*terminalProcessSnapshot, error)
	}{
		{
			name: "read",
			call: func(svc *Service, processID string) (*terminalProcessSnapshot, error) {
				return svc.ReadTerminalProcess(context.Background(), meta, "run_owner", processID, 0)
			},
		},
		{
			name: "write",
			call: func(svc *Service, processID string) (*terminalProcessSnapshot, error) {
				return svc.WriteTerminalProcess(context.Background(), meta, "run_owner", processID, "input\n")
			},
		},
		{
			name: "terminate",
			call: func(svc *Service, processID string) (*terminalProcessSnapshot, error) {
				return svc.TerminateTerminalProcess(context.Background(), meta, "run_owner", processID)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var settlements atomic.Int32
			manager := newTerminalProcessManager(func(terminalProcessSnapshot) error {
				settlements.Add(1)
				return errors.New("canonical settlement unavailable")
			})
			defer manager.Close()

			proc, err := manager.Start(terminalProcessStartRequest{
				EndpointID:         "env_owner",
				ThreadID:           "thread_owner",
				RunID:              "run_owner",
				TurnID:             "turn_owner",
				SettlementThreadID: "thread_owner",
				SettlementRunID:    "run_owner",
				SettlementTurnID:   "turn_owner",
				ToolID:             "tool_owner",
				ToolName:           "terminal.exec",
				Command:            "printf owner-output",
				CwdAbs:             workspace,
				Shell:              "/bin/bash",
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
			returned, err := tt.call(svc, snapshot.ProcessID)
			if err == nil || !strings.Contains(err.Error(), "canonical settlement unavailable") {
				t.Fatalf("call err=%v, want canonical settlement error", err)
			}
			if returned != nil {
				t.Fatalf("call returned terminal snapshot before settlement acknowledgement: %#v", returned)
			}
			if got := settlements.Load(); got != 1 {
				t.Fatalf("settlements=%d, want one", got)
			}
			proc.mu.Lock()
			acknowledged := proc.settlementAcknowledged
			proc.mu.Unlock()
			if acknowledged {
				t.Fatalf("process acknowledged failed settlement")
			}
		})
	}
}

func TestReadTerminalProcessWaitsForInFlightSettlementAcknowledgement(t *testing.T) {
	workspace := t.TempDir()
	settlementStarted := make(chan struct{})
	releaseSettlement := make(chan struct{})
	manager := newTerminalProcessManager(func(terminalProcessSnapshot) error {
		close(settlementStarted)
		<-releaseSettlement
		return nil
	})
	defer manager.Close()

	proc, err := manager.Start(terminalProcessStartRequest{
		EndpointID:         "env_owner",
		ThreadID:           "thread_owner",
		RunID:              "run_owner",
		TurnID:             "turn_owner",
		SettlementThreadID: "thread_owner",
		SettlementRunID:    "run_owner",
		SettlementTurnID:   "turn_owner",
		ToolID:             "tool_owner",
		ToolName:           "terminal.exec",
		Command:            "printf owner-output",
		CwdAbs:             workspace,
		Shell:              "/bin/bash",
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	snapshot := proc.WaitForYield(1000)
	if snapshot.Status != terminalProcessStatusSuccess {
		t.Fatalf("status=%q, want success", snapshot.Status)
	}

	go proc.MarkPending()
	select {
	case <-settlementStarted:
	case <-time.After(3 * time.Second):
		t.Fatalf("settlement did not start")
	}

	svc := &Service{terminalProcesses: manager}
	meta := &session.Meta{EndpointID: "env_owner", CanRead: true, CanWrite: true, CanExecute: true}
	done := make(chan struct{})
	var returned *terminalProcessSnapshot
	var readErr error
	go func() {
		returned, readErr = svc.ReadTerminalProcess(context.Background(), meta, "run_owner", snapshot.ProcessID, 0)
		close(done)
	}()
	select {
	case <-done:
		t.Fatalf("terminal read returned before settlement acknowledgement: snapshot=%#v err=%v", returned, readErr)
	case <-time.After(50 * time.Millisecond):
	}

	close(releaseSettlement)
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatalf("terminal read did not return after settlement acknowledgement")
	}
	if readErr != nil {
		t.Fatalf("ReadTerminalProcess: %v", readErr)
	}
	if returned == nil || returned.Status != terminalProcessStatusSuccess {
		t.Fatalf("terminal read snapshot=%#v, want acknowledged success", returned)
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
		ProcessID:          "tp_settlement_first",
		EndpointID:         "env_1",
		ThreadID:           "thread_1",
		RunID:              "run_settlement_first",
		TurnID:             "turn_1",
		SettlementThreadID: "thread_1",
		SettlementRunID:    "run_settlement_first",
		SettlementTurnID:   "turn_1",
		ToolID:             "tool_settlement_first",
		ToolName:           "terminal.exec",
		Command:            "printf done",
		Cwd:                t.TempDir(),
		Status:             terminalProcessStatusSuccess,
		Output:             "done",
		StartedAtUnixMs:    100,
		EndedAtUnixMs:      200,
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

func TestHandleTerminalProcessDoneRequiresSettlementIdentity(t *testing.T) {
	store := openTerminalProcessTestStore(t)
	defer func() { _ = store.Close() }()
	upsertTerminalProcessTestRun(t, store, "env_1", "thread_child", "run_child_audit", "turn_child_audit")

	host := &recordingFloretHost{
		settleResult: terminalProcessTestSettlementResult(terminalProcessTestProjection("run_floret_child", "thread_child", "turn_floret_child", "tool_missing_target")),
	}
	activeRun := &run{id: "run_child_audit", endpointID: "env_1", threadID: "thread_child", messageID: "turn_child_audit"}
	activeRun.setActiveFloretHost(host)
	var events []any
	activeRun.onStreamEvent = func(ev any) { events = append(events, ev) }
	svc := &Service{
		threadsDB: store,
		runs:      map[string]*run{"run_child_audit": activeRun},
		log:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	err := svc.handleTerminalProcessDone(terminalProcessSnapshot{
		ProcessID:       "tp_missing_target",
		EndpointID:      "env_1",
		ThreadID:        "thread_child",
		RunID:           "run_child_audit",
		TurnID:          "turn_child_audit",
		ToolID:          "tool_missing_target",
		ToolName:        "terminal.exec",
		Command:         "printf done",
		Cwd:             t.TempDir(),
		Status:          terminalProcessStatusSuccess,
		Output:          "done",
		StartedAtUnixMs: 100,
		EndedAtUnixMs:   200,
	})
	if err == nil || !strings.Contains(err.Error(), "settlement target incomplete") {
		t.Fatalf("handleTerminalProcessDone err=%v, want settlement target incomplete", err)
	}
	if len(host.settleRequests) != 0 {
		t.Fatalf("Floret settlement was attempted without settlement target: %#v", host.settleRequests)
	}
	rec, err := store.GetToolCall(context.Background(), "env_1", "run_child_audit", "tool_missing_target")
	if err == nil {
		t.Fatalf("tool call was persisted without settlement target: %#v", rec)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("GetToolCall error=%v, want sql.ErrNoRows", err)
	}
	if len(activeRun.assistantBlocks) != 0 || len(events) != 0 {
		t.Fatalf("terminal completion was published without settlement target: blocks=%#v events=%#v", activeRun.assistantBlocks, events)
	}
}

func TestHandleTerminalProcessDoneDoesNotPublishCompletionBeforeAuditAck(t *testing.T) {
	store := openTerminalProcessTestStore(t)
	upsertTerminalProcessTestRun(t, store, "env_1", "thread_1", "run_audit_first", "turn_1")
	host := &recordingFloretHost{
		settleResult: terminalProcessTestSettlementResult(terminalProcessTestProjection("run_audit_first", "thread_1", "turn_1", "tool_audit_first")),
	}
	activeRun := &run{id: "run_audit_first", endpointID: "env_1", threadID: "thread_1", messageID: "turn_1"}
	activeRun.setActiveFloretHost(host)
	var events []any
	activeRun.onStreamEvent = func(ev any) { events = append(events, ev) }
	svc := &Service{
		threadsDB: store,
		runs:      map[string]*run{"run_audit_first": activeRun},
		log:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close store: %v", err)
	}

	err := svc.handleTerminalProcessDone(terminalProcessSnapshot{
		ProcessID:          "tp_audit_first",
		EndpointID:         "env_1",
		ThreadID:           "thread_1",
		RunID:              "run_audit_first",
		TurnID:             "turn_1",
		SettlementThreadID: "thread_1",
		SettlementRunID:    "run_audit_first",
		SettlementTurnID:   "turn_1",
		ToolID:             "tool_audit_first",
		ToolName:           "terminal.exec",
		Command:            "printf done",
		Cwd:                t.TempDir(),
		Status:             terminalProcessStatusSuccess,
		Output:             "done",
		StartedAtUnixMs:    100,
		EndedAtUnixMs:      200,
	})
	if err == nil {
		t.Fatalf("handleTerminalProcessDone succeeded despite audit persistence failure")
	}
	if len(host.settleRequests) != 1 {
		t.Fatalf("settle requests=%d, want one Floret settlement before audit failure", len(host.settleRequests))
	}
	if len(activeRun.assistantBlocks) != 0 || len(events) != 0 {
		t.Fatalf("terminal completion was published before audit ack: blocks=%#v events=%#v", activeRun.assistantBlocks, events)
	}
}

func TestToolTerminalReadSettlesOriginalExecWhenWaitObservesCompletion(t *testing.T) {
	workspace := t.TempDir()
	store := openTerminalProcessTestStore(t)
	defer func() { _ = store.Close() }()
	upsertTerminalProcessTestRun(t, store, "env_1", "thread_1", "run_read_settle", "turn_1")

	manager := newTerminalProcessManager(nil)
	defer manager.Close()
	svc := &Service{
		threadsDB:         store,
		terminalProcesses: manager,
		log:               slog.New(slog.NewTextHandler(io.Discard, nil)),
		persistOpTO:       5 * time.Second,
	}
	manager.onDone = svc.handleTerminalProcessDone
	r := newTerminalProcessTestRun(workspace, svc, store, "env_1", "thread_1", "run_read_settle", "turn_1")
	svc.runs = map[string]*run{"run_read_settle": r}
	projection := terminalProcessTestProjection("run_read_settle", "thread_1", "turn_1", "tool_exec")
	host := &recordingFloretHost{
		settleResult:   terminalProcessTestSettlementResult(projection),
		readProjection: projection,
	}
	r.setActiveFloretHost(host)

	outcome, err := r.handleToolCall(context.Background(), "tool_exec", "terminal.exec", map[string]any{
		"command":  "sleep 0.05; printf read-settled",
		"yield_ms": 1,
	})
	if err != nil {
		t.Fatalf("terminal.exec: %v", err)
	}
	if outcome == nil || outcome.Pending == nil {
		t.Fatalf("outcome=%#v, want pending terminal exec", outcome)
	}
	processID := strings.TrimSpace(outcome.Pending.Handle)
	if processID == "" {
		t.Fatalf("pending handle is empty: %#v", outcome.Pending)
	}
	missingDescription, readErr := r.handleToolCall(context.Background(), "tool_read_missing_description", "terminal.read", map[string]any{
		"process_id": processID,
	})
	if readErr != nil || missingDescription == nil || missingDescription.ToolError == nil || !strings.Contains(missingDescription.ToolError.Message, "description is required") {
		t.Fatalf("terminal.read missing description outcome=%#v error=%v", missingDescription, readErr)
	}
	longDescription, readErr := r.handleToolCall(context.Background(), "tool_read_long_description", "terminal.read", map[string]any{
		"process_id":  processID,
		"description": strings.Repeat("x", terminalDescriptionMaxRunes+1),
	})
	if readErr != nil || longDescription == nil || longDescription.ToolError == nil || !strings.Contains(longDescription.ToolError.Message, "description is too long") {
		t.Fatalf("terminal.read long description outcome=%#v error=%v", longDescription, readErr)
	}

	readOutcome, err := r.handleToolCall(context.Background(), "tool_read", "terminal.read", map[string]any{
		"process_id":  processID,
		"description": "Check the settled command output",
		"after_seq":   0,
	})
	if err != nil {
		t.Fatalf("terminal.read: %v", err)
	}
	readResult, _ := readOutcome.Result.(map[string]any)
	if strings.TrimSpace(anyToString(readResult["status"])) == terminalProcessStatusRunning {
		readOutcome, err = r.handleToolCall(context.Background(), "tool_read_settled", "terminal.read", map[string]any{
			"process_id":  processID,
			"description": "Check the settled command output again",
			"after_seq":   readInt64Field(readResult, "last_seq"),
		})
		if err != nil {
			t.Fatalf("second terminal.read: %v", err)
		}
		readResult, _ = readOutcome.Result.(map[string]any)
	}
	if got := strings.TrimSpace(anyToString(readResult["status"])); got != terminalProcessStatusSuccess {
		t.Fatalf("terminal.read status=%q, want success; result=%#v", got, readResult)
	}
	if len(host.settleRequests) != 1 {
		t.Fatalf("settle requests=%d, want one", len(host.settleRequests))
	}
	settleReq := host.settleRequests[0]
	if settleReq.ToolCallID != "tool_exec" || settleReq.Status != flruntime.PendingToolSettlementCompleted {
		t.Fatalf("settle request=%#v, want original exec completed", settleReq)
	}
	rec, err := store.GetToolCall(context.Background(), "env_1", "run_read_settle", "tool_exec")
	if err != nil {
		t.Fatalf("GetToolCall: %v", err)
	}
	if rec.Status != toolCallStatusSuccess {
		t.Fatalf("tool call status=%q, want success", rec.Status)
	}
}

func TestToolTerminalTerminateSettlesOriginalExec(t *testing.T) {
	workspace := t.TempDir()
	store := openTerminalProcessTestStore(t)
	defer func() { _ = store.Close() }()
	upsertTerminalProcessTestRun(t, store, "env_1", "thread_1", "run_terminate_settle", "turn_1")

	manager := newTerminalProcessManager(nil)
	defer manager.Close()
	svc := &Service{
		threadsDB:         store,
		terminalProcesses: manager,
		log:               slog.New(slog.NewTextHandler(io.Discard, nil)),
		persistOpTO:       5 * time.Second,
	}
	manager.onDone = svc.handleTerminalProcessDone
	r := newTerminalProcessTestRun(workspace, svc, store, "env_1", "thread_1", "run_terminate_settle", "turn_1")
	svc.runs = map[string]*run{"run_terminate_settle": r}
	projection := terminalProcessTestProjection("run_terminate_settle", "thread_1", "turn_1", "tool_exec")
	host := &recordingFloretHost{
		settleResult:   terminalProcessTestSettlementResult(projection),
		readProjection: projection,
	}
	r.setActiveFloretHost(host)

	outcome, err := r.handleToolCall(context.Background(), "tool_exec", "terminal.exec", map[string]any{
		"command":  "sleep 5",
		"yield_ms": 1,
	})
	if err != nil {
		t.Fatalf("terminal.exec: %v", err)
	}
	if outcome == nil || outcome.Pending == nil {
		t.Fatalf("outcome=%#v, want pending terminal exec", outcome)
	}
	processID := strings.TrimSpace(outcome.Pending.Handle)

	missingDescription, terminateErr := r.handleToolCall(context.Background(), "tool_terminate_missing_description", "terminal.terminate", map[string]any{
		"process_id": processID,
	})
	if terminateErr != nil || missingDescription == nil || missingDescription.ToolError == nil || !strings.Contains(missingDescription.ToolError.Message, "description is required") {
		t.Fatalf("terminal.terminate missing description outcome=%#v error=%v", missingDescription, terminateErr)
	}
	blankDescription, terminateErr := r.handleToolCall(context.Background(), "tool_terminate_blank_description", "terminal.terminate", map[string]any{
		"process_id":  processID,
		"description": "   ",
	})
	if terminateErr != nil || blankDescription == nil || blankDescription.ToolError == nil || !strings.Contains(blankDescription.ToolError.Message, "description is required") {
		t.Fatalf("terminal.terminate blank description outcome=%#v error=%v", blankDescription, terminateErr)
	}
	longDescription, terminateErr := r.handleToolCall(context.Background(), "tool_terminate_long_description", "terminal.terminate", map[string]any{
		"process_id":  processID,
		"description": strings.Repeat("x", terminalDescriptionMaxRunes+1),
	})
	if terminateErr != nil || longDescription == nil || longDescription.ToolError == nil || !strings.Contains(longDescription.ToolError.Message, "description is too long") {
		t.Fatalf("terminal.terminate long description outcome=%#v error=%v", longDescription, terminateErr)
	}

	terminateOutcome, err := r.handleToolCall(context.Background(), "tool_terminate", "terminal.terminate", map[string]any{
		"process_id":  processID,
		"description": "Stop the sleeping test command",
	})
	if err != nil {
		t.Fatalf("terminal.terminate: %v", err)
	}
	terminateResult, _ := terminateOutcome.Result.(map[string]any)
	if got := strings.TrimSpace(anyToString(terminateResult["status"])); got != terminalProcessStatusCanceled {
		t.Fatalf("terminal.terminate status=%q, want canceled; result=%#v", got, terminateResult)
	}
	if len(host.settleRequests) != 1 {
		t.Fatalf("settle requests=%d, want one", len(host.settleRequests))
	}
	settleReq := host.settleRequests[0]
	if settleReq.ToolCallID != "tool_exec" || settleReq.Status != flruntime.PendingToolSettlementCanceled {
		t.Fatalf("settle request=%#v, want original exec canceled", settleReq)
	}
	rec, err := store.GetToolCall(context.Background(), "env_1", "run_terminate_settle", "tool_exec")
	if err != nil {
		t.Fatalf("GetToolCall: %v", err)
	}
	if rec.Status != toolCallStatusError || rec.ErrorCode != string(aitools.ErrorCodeCanceled) {
		t.Fatalf("tool call record=%#v, want canceled error audit", rec)
	}
}

func TestRunTerminalCleanupSettlesPendingProcessesForRun(t *testing.T) {
	workspace := t.TempDir()
	store := openTerminalProcessTestStore(t)
	defer func() { _ = store.Close() }()
	upsertTerminalProcessTestRun(t, store, "env_1", "thread_1", "run_cleanup", "turn_1")

	manager := newTerminalProcessManager(nil)
	defer manager.Close()
	svc := &Service{
		threadsDB:         store,
		terminalProcesses: manager,
		log:               slog.New(slog.NewTextHandler(io.Discard, nil)),
		persistOpTO:       5 * time.Second,
	}
	manager.onDone = svc.handleTerminalProcessDone
	r := newTerminalProcessTestRun(workspace, svc, store, "env_1", "thread_1", "run_cleanup", "turn_1")
	svc.runs = map[string]*run{"run_cleanup": r}
	projection := terminalProcessTestProjection("run_cleanup", "thread_1", "turn_1", "tool_cleanup_a")
	host := &recordingFloretHost{
		settleResult:   terminalProcessTestSettlementResult(projection),
		readProjection: projection,
	}
	r.setActiveFloretHost(host)

	first := startPendingTerminalProcessForTest(t, manager, workspace, "env_1", "thread_1", "run_cleanup", "turn_1", "tool_cleanup_a")
	second := startPendingTerminalProcessForTest(t, manager, workspace, "env_1", "thread_1", "run_cleanup", "turn_1", "tool_cleanup_b")
	otherRun := startPendingTerminalProcessForTest(t, manager, workspace, "env_1", "thread_1", "run_other", "turn_1", "tool_other")

	changed, err := r.cleanupRunTerminalProcesses()
	if err != nil {
		t.Fatalf("cleanupRunTerminalProcesses: %v", err)
	}
	if !changed {
		t.Fatalf("cleanupRunTerminalProcesses changed=false, want true")
	}
	if len(host.readProjectionReqs) != 0 {
		t.Fatalf("ReadTurnProjection requests=%#v, want no immediate projection refresh", host.readProjectionReqs)
	}
	if len(host.settleRequests) != 2 {
		t.Fatalf("settle requests=%d, want two for this run", len(host.settleRequests))
	}
	settled := map[string]flruntime.PendingToolSettlementStatus{}
	for _, req := range host.settleRequests {
		settled[req.ToolCallID] = req.Status
	}
	if settled["tool_cleanup_a"] != flruntime.PendingToolSettlementCanceled ||
		settled["tool_cleanup_b"] != flruntime.PendingToolSettlementCanceled {
		t.Fatalf("settled=%#v, want cleanup tools canceled", settled)
	}
	for _, entry := range []struct {
		toolID string
		proc   *terminalProcess
	}{
		{toolID: "tool_cleanup_a", proc: first},
		{toolID: "tool_cleanup_b", proc: second},
	} {
		snapshot := entry.proc.Snapshot()
		if snapshot.Status != terminalProcessStatusCanceled {
			t.Fatalf("%s status=%q, want canceled", entry.toolID, snapshot.Status)
		}
		rec, err := store.GetToolCall(context.Background(), "env_1", "run_cleanup", entry.toolID)
		if err != nil {
			t.Fatalf("GetToolCall %s: %v", entry.toolID, err)
		}
		if rec.Status != toolCallStatusError {
			t.Fatalf("%s audit status=%q, want error", entry.toolID, rec.Status)
		}
	}
	if snapshot := otherRun.Snapshot(); snapshot.Status != terminalProcessStatusRunning {
		t.Fatalf("other run status=%q, want running", snapshot.Status)
	}
}

func TestServiceCloseSettlesTerminalProcessesBeforeClearingActiveRuns(t *testing.T) {
	workspace := t.TempDir()
	store := openTerminalProcessTestStore(t)
	upsertTerminalProcessTestRun(t, store, "env_1", "thread_1", "run_shutdown", "turn_1")

	svc := &Service{
		threadsDB:         store,
		log:               slog.New(slog.NewTextHandler(io.Discard, nil)),
		persistOpTO:       5 * time.Second,
		runs:              map[string]*run{},
		activeRunByTh:     map[string]string{},
		terminalProcesses: newTerminalProcessManager(nil),
	}
	svc.terminalProcesses.onDone = svc.handleTerminalProcessDone
	r := newTerminalProcessTestRun(workspace, svc, store, "env_1", "thread_1", "run_shutdown", "turn_1")
	projection := terminalProcessTestProjection("run_shutdown", "thread_1", "turn_1", "tool_shutdown")
	host := &recordingFloretHost{
		settleResult:   terminalProcessTestSettlementResult(projection),
		readProjection: projection,
	}
	r.setActiveFloretHost(host)
	svc.runs["run_shutdown"] = r
	svc.activeRunByTh[runThreadKey("env_1", "thread_1")] = "run_shutdown"

	proc := startPendingTerminalProcessForTest(t, svc.terminalProcesses, workspace, "env_1", "thread_1", "run_shutdown", "turn_1", "tool_shutdown")
	if err := svc.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if len(host.settleRequests) != 1 {
		t.Fatalf("settle requests=%d, want terminal settlement before active run registry is cleared", len(host.settleRequests))
	}
	req := host.settleRequests[0]
	if req.ToolCallID != "tool_shutdown" || req.RunID != flruntime.RunID("run_shutdown") || req.Status != flruntime.PendingToolSettlementCanceled {
		t.Fatalf("settlement request=%#v, want canceled shutdown settlement for active run", req)
	}
	if snapshot := proc.Snapshot(); snapshot.Status != terminalProcessStatusCanceled {
		t.Fatalf("shutdown process status=%q, want canceled", snapshot.Status)
	}
	if svc.runForFloretSettlement("env_1", "thread_1", "run_shutdown") != nil {
		t.Fatalf("active run registry was not cleared after terminal settlement drain")
	}
}

func TestRunTerminalCleanupWaitsForInFlightSettlementBeforeProjectionRead(t *testing.T) {
	workspace := t.TempDir()
	store := openTerminalProcessTestStore(t)
	defer func() { _ = store.Close() }()
	upsertTerminalProcessTestRun(t, store, "env_1", "thread_1", "run_inflight", "turn_1")

	settlementStarted := make(chan struct{})
	releaseSettlement := make(chan struct{})
	manager := newTerminalProcessManager(func(snapshot terminalProcessSnapshot) error {
		close(settlementStarted)
		<-releaseSettlement
		return nil
	})
	defer manager.Close()
	svc := &Service{
		threadsDB:         store,
		terminalProcesses: manager,
		log:               slog.New(slog.NewTextHandler(io.Discard, nil)),
		persistOpTO:       5 * time.Second,
	}
	r := newTerminalProcessTestRun(workspace, svc, store, "env_1", "thread_1", "run_inflight", "turn_1")
	svc.runs = map[string]*run{"run_inflight": r}
	projection := terminalProcessTestProjection("run_inflight", "thread_1", "turn_1", "tool_inflight")
	host := &recordingFloretHost{readProjection: projection}

	proc, err := manager.Start(terminalProcessStartRequest{
		EndpointID:         "env_1",
		ThreadID:           "thread_1",
		RunID:              "run_inflight",
		TurnID:             "turn_1",
		SettlementThreadID: "thread_1",
		SettlementRunID:    "run_inflight",
		SettlementTurnID:   "turn_1",
		ToolID:             "tool_inflight",
		ToolName:           "terminal.exec",
		Command:            "printf inflight",
		CwdAbs:             workspace,
		Shell:              "/bin/bash",
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	snapshot := proc.WaitForYield(1000)
	if snapshot.Status != terminalProcessStatusSuccess {
		t.Fatalf("status=%q, want success", snapshot.Status)
	}
	go proc.MarkPending()
	select {
	case <-settlementStarted:
	case <-time.After(3 * time.Second):
		t.Fatalf("settlement did not start")
	}

	done := make(chan struct{})
	var changed bool
	var cleanupErr error
	go func() {
		changed, cleanupErr = r.cleanupRunTerminalProcesses()
		close(done)
	}()
	select {
	case <-done:
		t.Fatalf("cleanup returned before in-flight settlement completed")
	case <-time.After(50 * time.Millisecond):
	}
	close(releaseSettlement)
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatalf("cleanup did not finish after settlement completed")
	}
	if cleanupErr != nil {
		t.Fatalf("cleanupRunTerminalProcesses: %v", cleanupErr)
	}
	if !changed {
		t.Fatalf("cleanupRunTerminalProcesses changed=false, want true")
	}
	if len(host.readProjectionReqs) != 0 {
		t.Fatalf("ReadTurnProjection requests=%#v, want no immediate projection refresh", host.readProjectionReqs)
	}
}

func TestTerminalProcessWaitForYieldContextTerminatesOnCancel(t *testing.T) {
	workspace := t.TempDir()
	manager := newTerminalProcessManager(nil)
	defer manager.Close()

	proc, err := manager.Start(terminalProcessStartRequest{
		EndpointID:         "env_test",
		ThreadID:           "thread_test",
		RunID:              "run_test",
		TurnID:             "turn_test",
		SettlementThreadID: "thread_test",
		SettlementRunID:    "run_test",
		SettlementTurnID:   "turn_test",
		ToolID:             "tool_test",
		ToolName:           "terminal.exec",
		Command:            "sleep 5",
		CwdAbs:             workspace,
		Shell:              "/bin/bash",
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
}

func TestNormalizeTerminalExecArgsClampsYieldMS(t *testing.T) {
	normalized := normalizeTerminalExecArgs(map[string]any{
		"command":  "sleep 1",
		"yield_ms": 1_200_000,
	})
	if got := parseIntRaw(normalized["yield_ms"], 0); got != terminalProcessMaxYieldMS {
		t.Fatalf("yield_ms=%v, want %d; normalized=%#v", normalized["yield_ms"], terminalProcessMaxYieldMS, normalized)
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
	proc, ok := manager.Get(processID)
	if !ok {
		t.Fatalf("canceled process %q not found", processID)
	}
	snapshot := proc.Snapshot()
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
		"process_id":  processID,
		"description": "Stop the interactive reply command",
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
			"process_id":  processID,
			"description": "Check the new process output",
			"after_seq":   afterSeq,
		})
		if err != nil {
			t.Fatalf("terminal.read with pending handle: %v", err)
		}
		last, _ = outcome.Result.(map[string]any)
		if strings.Contains(anyToString(last["output"]), want) {
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
		snapshot, err := manager.ReadAfter(terminalProcessReadRequest{
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
	proc, _ := manager.Get(processID)
	snapshot := proc.Snapshot()
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
	ensureThreadstoreThreadForTest(t, store, endpointID, threadID)
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

func terminalProcessTestProjection(runID string, threadID string, turnID string, toolID string) flruntime.ThreadTurnProjection {
	return flruntime.ThreadTurnProjection{
		ThreadID:       flruntime.ThreadID(threadID),
		TurnID:         flruntime.TurnID(turnID),
		RunID:          flruntime.RunID(runID),
		TraceID:        flruntime.TraceID(runID),
		Status:         flruntime.TurnStatusCompleted,
		ThroughOrdinal: 1,
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: floretProjectionTimeline(runID, threadID, turnID, toolID, "terminal.exec"),
		}},
	}
}

func terminalProcessTestSettlementResult(projection flruntime.ThreadTurnProjection) flruntime.PendingToolSettlementResult {
	return flruntime.PendingToolSettlementResult{
		ThreadID:               projection.ThreadID,
		TurnID:                 projection.TurnID,
		RunID:                  projection.RunID,
		ProjectionAvailability: flruntime.TurnProjectionAvailabilityReady,
		Projection:             &projection,
	}
}

func startPendingTerminalProcessForTest(t *testing.T, manager *terminalProcessManager, workspace string, endpointID string, threadID string, runID string, turnID string, toolID string) *terminalProcess {
	return startPendingTerminalProcessForTestWithSettlement(t, manager, workspace, endpointID, threadID, runID, turnID, runID, turnID, toolID)
}

func startPendingTerminalProcessForTestWithSettlement(t *testing.T, manager *terminalProcessManager, workspace string, endpointID string, threadID string, runID string, turnID string, settlementRunID string, settlementTurnID string, toolID string) *terminalProcess {
	t.Helper()
	proc, err := manager.Start(terminalProcessStartRequest{
		EndpointID:         endpointID,
		ThreadID:           threadID,
		RunID:              runID,
		TurnID:             turnID,
		SettlementThreadID: threadID,
		SettlementRunID:    settlementRunID,
		SettlementTurnID:   settlementTurnID,
		ToolID:             toolID,
		ToolName:           "terminal.exec",
		Command:            "sleep 5",
		CwdAbs:             workspace,
		Shell:              "/bin/bash",
	})
	if err != nil {
		t.Fatalf("Start %s: %v", toolID, err)
	}
	snapshot := proc.WaitForYield(1)
	if snapshot.Status != terminalProcessStatusRunning {
		t.Fatalf("%s status=%q, want running", toolID, snapshot.Status)
	}
	proc.MarkPending()
	return proc
}
