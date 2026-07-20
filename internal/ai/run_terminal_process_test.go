package ai

import (
	"context"
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
	"github.com/floegence/redeven/internal/session"
)

type terminalProcessTestOwner struct {
	mu       sync.Mutex
	requests []flruntime.PendingToolSettlementRequest
	settle   func(context.Context, flruntime.PendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error)
}

type failingTerminalInitialInputWriter struct{}

func (failingTerminalInitialInputWriter) Write([]byte) (int, error) {
	return 0, errors.New("deterministic initial input failure")
}

func TestCompleteTerminalProcessStartReturnsObservableProcessAfterInitialInputFailure(t *testing.T) {
	proc := &terminalProcess{
		id:        "tp_initial_input_failure",
		status:    terminalProcessStatusRunning,
		startedAt: time.Now(),
	}
	proc.cond = sync.NewCond(&proc.mu)
	got, err := completeTerminalProcessStart(proc, failingTerminalInitialInputWriter{}, "input")
	if err != nil {
		t.Fatalf("completeTerminalProcessStart: %v", err)
	}
	if got != proc {
		t.Fatalf("returned process=%p, want dispatched process %p", got, proc)
	}
	snapshot := got.Snapshot()
	if snapshot.Status != terminalProcessStatusError || snapshot.Error == nil {
		t.Fatalf("snapshot=%#v, want observable terminal error", snapshot)
	}
	if snapshot.Error.Retryable || !strings.Contains(snapshot.Error.Message, "after the process started") {
		t.Fatalf("terminal error=%#v, want non-retryable post-dispatch failure", snapshot.Error)
	}
}

func pendingToolSettlementResultForTest(target flruntime.PendingToolSettlementTarget, availability flruntime.TurnProjectionAvailability, projection *flruntime.ThreadTurnProjection, projectionError string) flruntime.PendingToolSettlementResult {
	return flruntime.PendingToolSettlementResult{
		Target: target,
		Event: flruntime.ThreadDetailEvent{
			ThreadID: target.ThreadID,
			TurnID:   target.TurnID,
			Kind:     flruntime.ThreadDetailEventToolResult,
			Type:     "pending_tool_settlement",
			ToolResult: &flruntime.ThreadDetailToolResult{
				CallID:   target.ToolCallID,
				ToolName: target.ToolName,
				Status:   "completed",
			},
			Metadata: map[string]string{
				"run_id": string(target.RunID),
				"handle": target.Handle,
			},
		},
		ProjectionAvailability: availability,
		Projection:             projection,
		ProjectionError:        projectionError,
	}
}

func (o *terminalProcessTestOwner) SettlePendingTool(ctx context.Context, req flruntime.PendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error) {
	o.mu.Lock()
	o.requests = append(o.requests, req)
	settle := o.settle
	o.mu.Unlock()
	if settle != nil {
		return settle(ctx, req)
	}
	return pendingToolSettlementResultForTest(req.Target, flruntime.TurnProjectionAvailabilityUnavailable, nil, "test projection unavailable"), nil
}

func (o *terminalProcessTestOwner) requestCount() int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return len(o.requests)
}

func TestTerminalProcessQuickCompletionCapturesPTYOutput(t *testing.T) {
	manager := newTerminalProcessManager()
	defer func() { _ = manager.Close(context.Background()) }()
	owner := &terminalProcessTestOwner{}

	proc, err := manager.Start(terminalProcessTestStartRequest(t.TempDir(), owner, "tool_quick", "printf quick-output"))
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	snapshot := proc.WaitForYield(1000)
	if snapshot.Status != terminalProcessStatusSuccess || !strings.Contains(snapshot.Output, "quick-output") {
		t.Fatalf("snapshot=%#v, want successful quick output", snapshot)
	}
	if snapshot.ExecutionLocation != ToolTargetModeLocalRuntime || snapshot.EndedAtUnixMs <= 0 {
		t.Fatalf("snapshot metadata=%#v", snapshot)
	}
	if owner.requestCount() != 0 {
		t.Fatalf("non-pending process settled through pending lifecycle")
	}
}

func TestTerminalProcessStartRequiresOwnerAndCompleteTarget(t *testing.T) {
	manager := newTerminalProcessManager()
	defer func() { _ = manager.Close(context.Background()) }()
	workspace := t.TempDir()
	owner := &terminalProcessTestOwner{}
	base := terminalProcessTestStartRequest(workspace, owner, "tool_required", "printf should-not-run")

	tests := []struct {
		name    string
		mutate  func(*terminalProcessStartRequest)
		wantErr string
	}{
		{name: "missing owner", mutate: func(req *terminalProcessStartRequest) { req.SettlementOwner = nil }, wantErr: "settlement owner is required"},
		{name: "missing thread", mutate: func(req *terminalProcessStartRequest) { req.SettlementTarget.ThreadID = "" }, wantErr: "settlement target incomplete"},
		{name: "missing turn", mutate: func(req *terminalProcessStartRequest) { req.SettlementTarget.TurnID = "" }, wantErr: "settlement target incomplete"},
		{name: "missing run", mutate: func(req *terminalProcessStartRequest) { req.SettlementTarget.RunID = "" }, wantErr: "settlement target incomplete"},
		{name: "missing call", mutate: func(req *terminalProcessStartRequest) { req.SettlementTarget.ToolCallID = "" }, wantErr: "settlement target incomplete"},
		{name: "missing tool", mutate: func(req *terminalProcessStartRequest) { req.SettlementTarget.ToolName = "" }, wantErr: "settlement target incomplete"},
		{name: "missing handle", mutate: func(req *terminalProcessStartRequest) { req.SettlementTarget.Handle = "" }, wantErr: "settlement target incomplete"},
		{name: "missing effect attempt", mutate: func(req *terminalProcessStartRequest) { req.SettlementTarget.EffectAttemptID = "" }, wantErr: "settlement target incomplete"},
		{name: "mismatched handle", mutate: func(req *terminalProcessStartRequest) { req.SettlementTarget.Handle = "tp_other" }, wantErr: "settlement target mismatch"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			req := base
			test.mutate(&req)
			if _, err := manager.Start(req); err == nil || !strings.Contains(err.Error(), test.wantErr) {
				t.Fatalf("Start err=%v, want %q", err, test.wantErr)
			}
		})
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.active != 0 || len(manager.processes) != 0 {
		t.Fatalf("invalid process start changed manager state: active=%d processes=%d", manager.active, len(manager.processes))
	}
}

func TestTerminalProcessSnapshotDoesNotExposeSettlementTarget(t *testing.T) {
	manager := newTerminalProcessManager()
	defer func() { _ = manager.Close(context.Background()) }()
	owner := &terminalProcessTestOwner{}
	req := terminalProcessTestStartRequest(t.TempDir(), owner, "tool_snapshot", "printf done")
	req.SettlementTarget.ThreadID = "floret_thread_private"
	req.SettlementTarget.TurnID = "floret_turn_private"
	req.SettlementTarget.RunID = "floret_run_private"

	proc, err := manager.Start(req)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	raw, err := json.Marshal(proc.WaitForYield(1000))
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	for _, forbidden := range []string{"floret_thread_private", "floret_turn_private", "floret_run_private", "settlement_target"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("snapshot leaked settlement identity %q: %s", forbidden, raw)
		}
	}
}

func TestTerminalProcessFastExitAndMarkPendingFinalizeOnce(t *testing.T) {
	manager := newTerminalProcessManager()
	defer func() { _ = manager.Close(context.Background()) }()
	owner := &terminalProcessTestOwner{}
	var finalized atomic.Int32
	req := terminalProcessTestStartRequest(t.TempDir(), owner, "tool_fast", "printf fast-exit")
	req.Finalize = func(floretPendingToolSettler, flruntime.PendingToolSettlementTarget, terminalProcessSnapshot) error {
		finalized.Add(1)
		return nil
	}
	proc, err := manager.Start(req)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if snapshot := proc.WaitForYield(1000); snapshot.Status != terminalProcessStatusSuccess {
		t.Fatalf("snapshot=%#v, want success", snapshot)
	}

	var group sync.WaitGroup
	for range 8 {
		group.Add(1)
		go func() {
			defer group.Done()
			proc.MarkPending()
		}()
	}
	group.Wait()
	select {
	case <-proc.finalizationDone:
	case <-time.After(3 * time.Second):
		t.Fatal("finalization did not finish")
	}
	if finalized.Load() != 1 {
		t.Fatalf("finalizations=%d, want 1", finalized.Load())
	}
}

func TestTerminalProcessReadAndWriteDoNotTriggerSettlement(t *testing.T) {
	manager := newTerminalProcessManager()
	defer func() { _ = manager.Close(context.Background()) }()
	owner := &terminalProcessTestOwner{}
	var finalized atomic.Int32
	req := terminalProcessTestStartRequest(t.TempDir(), owner, "tool_interactive", "read line; printf 'reply:%s\\n' \"$line\"; sleep 5")
	req.Finalize = func(floretPendingToolSettler, flruntime.PendingToolSettlementTarget, terminalProcessSnapshot) error {
		finalized.Add(1)
		return nil
	}
	proc, err := manager.Start(req)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if snapshot := proc.WaitForYield(10); snapshot.Status != terminalProcessStatusRunning {
		t.Fatalf("snapshot=%#v, want running", snapshot)
	}
	proc.MarkPending()

	meta := &session.Meta{EndpointID: "env_test", CanRead: true, CanWrite: true, CanExecute: true}
	store := openTerminalProcessTestStore(t)
	defer store.Close()
	ensureThreadstoreThreadForTest(t, store, "env_test", "thread_test")
	svc := &Service{terminalProcesses: manager, threadsDB: store}
	svc.threadMgr = newThreadManager(svc)
	defer svc.threadMgr.Close()
	if _, err := svc.WriteTerminalProcess(context.Background(), meta, "run_test", proc.id, "hello\n"); err != nil {
		t.Fatalf("WriteTerminalProcess: %v", err)
	}
	read := managerReadUntil(t, manager, proc.id, 0, "reply:hello")
	if read.Status != terminalProcessStatusRunning {
		t.Fatalf("read status=%q, want running", read.Status)
	}
	if finalized.Load() != 0 {
		t.Fatalf("read/write triggered %d finalizations", finalized.Load())
	}
	if _, err := svc.TerminateTerminalProcess(context.Background(), meta, "run_test", proc.id); err != nil {
		t.Fatalf("TerminateTerminalProcess: %v", err)
	}
	if finalized.Load() != 1 {
		t.Fatalf("terminate finalizations=%d, want 1", finalized.Load())
	}
}

func TestTerminalProcessWriteRejectsPersistedDeleteIntent(t *testing.T) {
	manager := newTerminalProcessManager()
	defer func() { _ = manager.Close(context.Background()) }()
	owner := &terminalProcessTestOwner{}
	req := terminalProcessTestStartRequest(t.TempDir(), owner, "tool_delete_fence", "read line; printf 'unexpected:%s\\n' \"$line\"; sleep 5")
	proc, err := manager.Start(req)
	if err != nil {
		t.Fatal(err)
	}
	store := openTerminalProcessTestStore(t)
	defer store.Close()
	ensureThreadstoreThreadForTest(t, store, req.EndpointID, req.ThreadID)
	if _, err := store.PrepareThreadDeleteOperation(context.Background(), req.EndpointID, req.ThreadID, true); err != nil {
		t.Fatal(err)
	}
	svc := &Service{terminalProcesses: manager, threadsDB: store}
	svc.threadMgr = newThreadManager(svc)
	defer svc.threadMgr.Close()
	meta := &session.Meta{EndpointID: req.EndpointID, CanRead: true, CanWrite: true, CanExecute: true}
	if _, err := svc.WriteTerminalProcess(context.Background(), meta, req.RunID, proc.id, "must-not-write\n"); !errors.Is(err, threadstore.ErrThreadIDRetired) {
		t.Fatalf("WriteTerminalProcess error=%v, want %v", err, threadstore.ErrThreadIDRetired)
	}
}

func TestReadTerminalProcessReturnsTerminalSnapshots(t *testing.T) {
	meta := &session.Meta{EndpointID: "env_test", CanRead: true, CanWrite: true, CanExecute: true}

	for _, status := range []string{
		terminalProcessStatusSuccess,
		terminalProcessStatusError,
		terminalProcessStatusCanceled,
	} {
		t.Run(status, func(t *testing.T) {
			manager := newTerminalProcessManager()
			processID := "tp_" + status
			endedAt := time.Now()
			proc := &terminalProcess{
				manager:      manager,
				id:           processID,
				endpointID:   "env_test",
				threadID:     "thread_test",
				runID:        "run_test",
				turnID:       "turn_test",
				toolID:       "tool_test",
				toolName:     "terminal.exec",
				command:      "printf done",
				startedAt:    endedAt.Add(-time.Second),
				endedAt:      endedAt,
				status:       status,
				lastSeq:      4,
				total:        16,
				outputChunks: []terminalProcessOutputChunk{{seq: 4, data: []byte("done\n")}},
			}
			manager.processes[processID] = proc
			svc := &Service{terminalProcesses: manager}

			snapshot, err := svc.ReadTerminalProcess(context.Background(), meta, "run_test", processID, 4)
			if err != nil {
				t.Fatalf("ReadTerminalProcess: %v", err)
			}
			if snapshot.Status != status || snapshot.Output != "" {
				t.Fatalf("snapshot=%#v, want terminal status %q with empty delta", snapshot, status)
			}
			if snapshot.FirstSeq != 0 || snapshot.LastSeq != 4 || snapshot.LatestSeq != 4 || snapshot.HasMore {
				t.Fatalf("snapshot sequence=%#v, want empty delta at sequence 4", snapshot)
			}

			if _, err := svc.ReadTerminalProcess(context.Background(), meta, "run_test", processID, 5); err == nil || !strings.Contains(err.Error(), "exceeds latest sequence") {
				t.Fatalf("future cursor err=%v, want exceeds latest sequence", err)
			}
		})
	}
}

func TestReadTerminalProcessReturnsCompletionDuringWait(t *testing.T) {
	manager := newTerminalProcessManager()
	defer func() { _ = manager.Close(context.Background()) }()
	owner := &terminalProcessTestOwner{}
	workspace := t.TempDir()
	releasePath := filepath.Join(workspace, "release")
	req := terminalProcessTestStartRequest(
		workspace,
		owner,
		"tool_complete_during_read",
		"printf initial-output; while [ ! -f release ]; do sleep 0.01; done",
	)
	req.Env = []string{"HOME=" + t.TempDir(), "PATH=/usr/bin:/bin"}
	proc, err := manager.Start(req)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	initial := managerReadUntil(t, manager, proc.id, 0, "initial-output")
	if initial.Status != terminalProcessStatusRunning || initial.LastSeq <= 0 {
		t.Fatalf("initial snapshot=%#v, want running output cursor", initial)
	}
	go func() {
		time.Sleep(20 * time.Millisecond)
		_ = os.WriteFile(releasePath, []byte("release\n"), 0o600)
	}()

	meta := &session.Meta{EndpointID: "env_test", CanRead: true, CanWrite: true, CanExecute: true}
	snapshot, err := (&Service{terminalProcesses: manager}).ReadTerminalProcess(
		context.Background(),
		meta,
		"run_test",
		proc.id,
		initial.LastSeq,
	)
	if err != nil {
		t.Fatalf("ReadTerminalProcess: %v", err)
	}
	if snapshot.Status != terminalProcessStatusSuccess || snapshot.Output != "" {
		t.Fatalf("snapshot=%#v, want successful empty completion delta", snapshot)
	}
	if snapshot.EndedAtUnixMs <= 0 || snapshot.LastSeq != initial.LastSeq || snapshot.LatestSeq != initial.LastSeq || snapshot.HasMore {
		t.Fatalf("snapshot completion facts=%#v", snapshot)
	}
	if owner.requestCount() != 0 {
		t.Fatalf("process read triggered %d settlement requests", owner.requestCount())
	}
}

func TestTerminalProcessTerminateWaitsForReapAndSettlement(t *testing.T) {
	manager := newTerminalProcessManager()
	defer func() { _ = manager.Close(context.Background()) }()
	owner := &terminalProcessTestOwner{}
	settlementStarted := make(chan struct{})
	releaseSettlement := make(chan struct{})
	req := terminalProcessTestStartRequest(t.TempDir(), owner, "tool_wait", "sleep 5")
	req.Finalize = func(floretPendingToolSettler, flruntime.PendingToolSettlementTarget, terminalProcessSnapshot) error {
		close(settlementStarted)
		<-releaseSettlement
		return nil
	}
	proc, err := manager.Start(req)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	proc.MarkPending()

	type result struct {
		snapshot terminalProcessSnapshot
		err      error
	}
	resultCh := make(chan result, 1)
	go func() {
		snapshot, err := proc.Terminate(context.Background())
		resultCh <- result{snapshot: snapshot, err: err}
	}()
	select {
	case <-settlementStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("settlement did not start after termination")
	}
	select {
	case got := <-resultCh:
		t.Fatalf("terminate returned before settlement completed: %#v", got)
	default:
	}
	close(releaseSettlement)
	select {
	case got := <-resultCh:
		if got.err != nil || got.snapshot.Status != terminalProcessStatusCanceled || !proc.reaped {
			t.Fatalf("terminate result=%#v reaped=%v", got, proc.reaped)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("terminate did not return after settlement")
	}
}

func TestTerminalProcessSettlementFailureIsNotRetried(t *testing.T) {
	manager := newTerminalProcessManager()
	owner := &terminalProcessTestOwner{}
	var finalized atomic.Int32
	wantErr := errors.New("canonical settlement failed")
	req := terminalProcessTestStartRequest(t.TempDir(), owner, "tool_failure", "printf done")
	req.Finalize = func(floretPendingToolSettler, flruntime.PendingToolSettlementTarget, terminalProcessSnapshot) error {
		finalized.Add(1)
		return wantErr
	}
	proc, err := manager.Start(req)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if snapshot := proc.WaitForYield(1000); snapshot.Status != terminalProcessStatusSuccess {
		t.Fatalf("snapshot=%#v, want success", snapshot)
	}
	proc.MarkPending()
	select {
	case <-proc.finalizationDone:
	case <-time.After(3 * time.Second):
		t.Fatal("finalization did not finish")
	}
	if _, err := proc.ReadAfter(terminalProcessReadRequest{AfterSeq: 0, WaitMS: 0, MaxBytes: terminalProcessOutputChunkBytes}); err != nil {
		t.Fatalf("ReadAfter: %v", err)
	}
	if _, err := proc.Terminate(context.Background()); !errors.Is(err, wantErr) {
		t.Fatalf("Terminate err=%v, want %v", err, wantErr)
	}
	if _, err := proc.finalizePendingForRunEnd(context.Background()); !errors.Is(err, wantErr) {
		t.Fatalf("finalizePendingForRunEnd err=%v, want %v", err, wantErr)
	}
	if err := manager.Close(context.Background()); !errors.Is(err, wantErr) {
		t.Fatalf("Close err=%v, want %v", err, wantErr)
	}
	if finalized.Load() != 1 {
		t.Fatalf("finalizations=%d, want one failed attempt", finalized.Load())
	}
}

func TestServiceCloseFinalizesBeforeClosingThreadstore(t *testing.T) {
	store := openTerminalProcessTestStore(t)
	const (
		endpointID = "env_close"
		threadID   = "thread_close"
		runID      = "run_close"
		turnID     = "turn_close"
	)
	upsertTerminalProcessTestRun(t, store, endpointID, threadID, runID, turnID)
	manager := newTerminalProcessManager()
	owner := &terminalProcessTestOwner{}
	owner.settle = func(_ context.Context, req flruntime.PendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error) {
		thread, err := store.GetThreadSettings(context.Background(), endpointID, threadID)
		if err != nil || thread == nil {
			return flruntime.PendingToolSettlementResult{}, errors.New("threadstore closed before terminal settlement")
		}
		return pendingToolSettlementResultForTest(req.Target, flruntime.TurnProjectionAvailabilityUnavailable, nil, "test projection unavailable"), nil
	}
	svc := &Service{terminalProcesses: manager, threadsDB: store, persistOpTO: 5 * time.Second}
	req := terminalProcessTestStartRequestWithIdentity(t.TempDir(), owner, endpointID, threadID, runID, turnID, runID, turnID, "tool_close", "sleep 5")
	req.Finalize = svc.finalizeTerminalProcess
	proc, err := manager.Start(req)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	proc.MarkPending()
	if err := svc.Close(); err != nil {
		t.Fatalf("Service.Close: %v", err)
	}
	if owner.requestCount() != 1 {
		t.Fatalf("settlement requests=%d, want 1", owner.requestCount())
	}
}

func TestTerminalSettlementStatusRejectsNonTerminalAndUnknownValues(t *testing.T) {
	t.Parallel()

	for _, status := range []string{terminalProcessStatusRunning, "", "unknown"} {
		if got, err := terminalSettlementStatus(status); err == nil || got != "" {
			t.Fatalf("terminalSettlementStatus(%q)=(%q, %v), want explicit error", status, got, err)
		}
	}
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
			t.Fatalf("ReadAfter: %v", err)
		}
		if strings.Contains(snapshot.Output, want) {
			return snapshot
		}
		afterSeq = snapshot.LastSeq
	}
	proc, _ := manager.Get(processID)
	t.Fatalf("process output never contained %q; snapshot=%#v", want, proc.Snapshot())
	return terminalProcessSnapshot{}
}

func terminalProcessTestStartRequest(workspace string, owner floretPendingToolSettler, toolID string, command string) terminalProcessStartRequest {
	return terminalProcessTestStartRequestWithIdentity(workspace, owner, "env_test", "thread_test", "run_test", "turn_test", "run_test", "turn_test", toolID, command)
}

func terminalProcessTestStartRequestWithIdentity(workspace string, owner floretPendingToolSettler, endpointID string, threadID string, runID string, turnID string, settlementRunID string, settlementTurnID string, toolID string, command string) terminalProcessStartRequest {
	processID := "tp_" + strings.TrimPrefix(strings.TrimSpace(toolID), "tool_")
	return terminalProcessStartRequest{
		ProcessID:       processID,
		EndpointID:      endpointID,
		ThreadID:        threadID,
		RunID:           runID,
		TurnID:          turnID,
		SettlementOwner: owner,
		SettlementTarget: flruntime.PendingToolSettlementTarget{
			ThreadID:        flruntime.ThreadID(threadID),
			TurnID:          flruntime.TurnID(settlementTurnID),
			RunID:           flruntime.RunID(settlementRunID),
			ToolCallID:      toolID,
			ToolName:        "terminal.exec",
			Handle:          processID,
			EffectAttemptID: "test_effect:" + toolID,
		},
		Finalize: func(owner floretPendingToolSettler, target flruntime.PendingToolSettlementTarget, snapshot terminalProcessSnapshot) error {
			request, err := terminalProcessSettlementRequest(target, snapshot, terminalProcessResultPayload(snapshot))
			if err != nil {
				return err
			}
			_, err = owner.SettlePendingTool(context.Background(), request)
			return err
		},
		ToolID:   toolID,
		ToolName: "terminal.exec",
		Command:  command,
		CwdAbs:   workspace,
		Shell:    "/bin/bash",
	}
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
}

func newTerminalProcessTestRun(t *testing.T, workspace string, svc *Service, store *threadstore.Store, endpointID string, threadID string, runID string, turnID string) *run {
	t.Helper()
	if svc != nil && store != nil && svc.threadMgr == nil {
		svc.threadMgr = newThreadManager(svc)
	}
	options := runOptions{
		Log:              slog.New(slog.NewTextHandler(io.Discard, nil)),
		RunID:            runID,
		EndpointID:       endpointID,
		ThreadID:         threadID,
		MessageID:        turnID,
		AgentHomeDir:     workspace,
		WorkingDir:       workspace,
		Shell:            "/bin/bash",
		HostCapabilities: bindTestRunHostCapabilities(t, svc, endpointID, threadID),
		PersistOpTimeout: 5 * time.Second,
		SessionMeta: &session.Meta{
			EndpointID: endpointID,
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
		},
	}
	if store != nil {
		capabilities, err := bindRootRunProductCapabilities(store, endpointID, threadID, runID)
		if err != nil {
			t.Fatalf("bindRootRunProductCapabilities: %v", err)
		}
		options.ProductCapabilities = capabilities
	}
	r := newRun(options)
	if store != nil {
		runThreadStoresForTest.Store(r, store)
		t.Cleanup(func() { runThreadStoresForTest.Delete(r) })
	}
	r.settlementThreadID = threadID
	r.settlementRunID = runID
	r.settlementTurnID = turnID
	owner := &terminalProcessTestOwner{}
	r.setPendingToolSettlementOwnerResolver(func() floretPendingToolSettler { return owner })
	return r
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
		ProjectionAvailability: flruntime.TurnProjectionAvailabilityReady,
		Projection:             &projection,
	}
}

func startPendingTerminalProcessForTest(t *testing.T, manager *terminalProcessManager, owner floretPendingToolSettler, workspace string, endpointID string, threadID string, runID string, turnID string, toolID string) *terminalProcess {
	return startPendingTerminalProcessForTestWithSettlement(t, manager, owner, workspace, endpointID, threadID, runID, turnID, runID, turnID, toolID)
}

func startPendingTerminalProcessForTestWithSettlement(t *testing.T, manager *terminalProcessManager, owner floretPendingToolSettler, workspace string, endpointID string, threadID string, runID string, turnID string, settlementRunID string, settlementTurnID string, toolID string) *terminalProcess {
	t.Helper()
	req := terminalProcessTestStartRequestWithIdentity(workspace, owner, endpointID, threadID, runID, turnID, settlementRunID, settlementTurnID, toolID, "sleep 5")
	proc, err := manager.Start(req)
	if err != nil {
		t.Fatalf("Start %s: %v", toolID, err)
	}
	if snapshot := proc.WaitForYield(1); snapshot.Status != terminalProcessStatusRunning {
		t.Fatalf("%s status=%q, want running", toolID, snapshot.Status)
	}
	proc.MarkPending()
	return proc
}
