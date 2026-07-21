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

type terminalProcessTestRecoveryCoordinator struct {
	owner floretPendingToolSettler
	calls *atomic.Int32
	err   error
}

func (c terminalProcessTestRecoveryCoordinator) Settle(ctx context.Context, _ string, _ string, settle func(context.Context, floretPendingToolSettler) error) error {
	if c.calls != nil {
		c.calls.Add(1)
	}
	if c.err != nil {
		return c.err
	}
	if c.owner == nil || settle == nil {
		return errors.New("test recovery settlement is unavailable")
	}
	return settle(ctx, c.owner)
}

type terminalProcessRecordingRecoveryCoordinator struct {
	mu                  sync.Mutex
	owner               floretPendingToolSettler
	executionThreadID   string
	authorityThreadID   string
	settlementCallCount int
}

func (c *terminalProcessRecordingRecoveryCoordinator) Settle(ctx context.Context, executionThreadID string, authorityThreadID string, settle func(context.Context, floretPendingToolSettler) error) error {
	c.mu.Lock()
	c.executionThreadID = executionThreadID
	c.authorityThreadID = authorityThreadID
	c.settlementCallCount++
	c.mu.Unlock()
	return settle(ctx, c.owner)
}

func (c *terminalProcessRecordingRecoveryCoordinator) snapshot() (string, string, int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.executionThreadID, c.authorityThreadID, c.settlementCallCount
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

func TestTerminalProcessNonZeroExitIsCanonicalToolFailure(t *testing.T) {
	manager := newTerminalProcessManager()
	defer func() { _ = manager.Close(context.Background()) }()
	owner := &terminalProcessTestOwner{}

	proc, err := manager.Start(terminalProcessTestStartRequest(t.TempDir(), owner, "tool_exit_137", "exit 137"))
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	snapshot := proc.WaitForYield(1000)
	if snapshot.Status != terminalProcessStatusError || snapshot.ExitCode != 137 {
		t.Fatalf("snapshot=%#v, want terminal error with exit code 137", snapshot)
	}
	if snapshot.Error == nil || snapshot.Error.Retryable || !strings.Contains(snapshot.Error.Message, "137") {
		t.Fatalf("snapshot error=%#v, want non-retryable exit-code failure", snapshot.Error)
	}

	proc.MarkPending()
	select {
	case <-proc.finalizationDone:
	case <-time.After(3 * time.Second):
		t.Fatal("pending non-zero exit did not settle")
	}
	owner.mu.Lock()
	defer owner.mu.Unlock()
	if len(owner.requests) != 1 || owner.requests[0].Status != flruntime.PendingToolSettlementFailed {
		t.Fatalf("settlement requests=%#v, want one failed canonical settlement", owner.requests)
	}
}

func TestToolTerminalExecNonZeroExitReturnsToolError(t *testing.T) {
	workingDir := t.TempDir()
	manager := newTerminalProcessManager()
	defer func() { _ = manager.Close(context.Background()) }()
	r := newTerminalProcessTestRun(t, workingDir, &Service{terminalProcesses: manager}, nil, "env_exit", "thread_exit", "run_exit", "turn_exit")
	r.permissionType = FlowerPermissionFullAccess
	allowToolsForTest(t, r, "terminal.exec")

	outcome, err := r.handleToolCall(
		authorizedToolContextForTest(t, r, "tool_exec_exit_137", "terminal.exec"),
		"tool_exec_exit_137",
		"terminal.exec",
		map[string]any{"command": "exit 137", "yield_ms": 1000},
	)
	if err != nil {
		t.Fatalf("handleToolCall: %v", err)
	}
	if outcome == nil || outcome.Success || outcome.ToolError == nil {
		t.Fatalf("outcome=%#v, want canonical tool error", outcome)
	}
	result, ok := outcome.Result.(map[string]any)
	if !ok || anyToString(result["status"]) != terminalProcessStatusError || parseIntRaw(result["exit_code"], 0) != 137 {
		t.Fatalf("result=%#v tool_error=%#v, want terminal error payload with exit code 137", outcome.Result, outcome.ToolError)
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
		{name: "missing active owner", mutate: func(req *terminalProcessStartRequest) { req.ActiveSettlementOwner = nil }, wantErr: "active settlement owner is required"},
		{name: "missing recovery coordinator", mutate: func(req *terminalProcessStartRequest) { req.RecoveryCoordinator = nil }, wantErr: "recovery coordinator is required"},
		{name: "missing recovery authority", mutate: func(req *terminalProcessStartRequest) { req.RecoveryAuthorityThreadID = "" }, wantErr: "recovery authority thread is required"},
		{name: "missing authority barrier", mutate: func(req *terminalProcessStartRequest) { req.AuthorityBarrier = nil }, wantErr: "authority barrier is required"},
		{name: "missing thread", mutate: func(req *terminalProcessStartRequest) { req.SettlementTarget.ThreadID = "" }, wantErr: "settlement target incomplete"},
		{name: "missing turn", mutate: func(req *terminalProcessStartRequest) { req.SettlementTarget.TurnID = "" }, wantErr: "settlement target incomplete"},
		{name: "missing run", mutate: func(req *terminalProcessStartRequest) { req.SettlementTarget.RunID = "" }, wantErr: "settlement target incomplete"},
		{name: "missing call", mutate: func(req *terminalProcessStartRequest) { req.SettlementTarget.ToolCallID = "" }, wantErr: "settlement target incomplete"},
		{name: "missing tool", mutate: func(req *terminalProcessStartRequest) { req.SettlementTarget.ToolName = "" }, wantErr: "settlement target incomplete"},
		{name: "missing handle", mutate: func(req *terminalProcessStartRequest) { req.SettlementTarget.Handle = "" }, wantErr: "settlement target incomplete"},
		{name: "missing effect attempt", mutate: func(req *terminalProcessStartRequest) { req.SettlementTarget.EffectAttemptID = "" }, wantErr: "settlement target incomplete"},
		{name: "mismatched handle", mutate: func(req *terminalProcessStartRequest) { req.SettlementTarget.Handle = "tp_other" }, wantErr: "settlement target mismatch"},
		{name: "mismatched execution thread", mutate: func(req *terminalProcessStartRequest) { req.SettlementTarget.ThreadID = "thread_other" }, wantErr: "settlement identity mismatch"},
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
	req.SettlementTarget.EffectAttemptID = "private_effect_attempt"

	proc, err := manager.Start(req)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	raw, err := json.Marshal(proc.WaitForYield(1000))
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	for _, forbidden := range []string{"private_effect_attempt", "settlement_target"} {
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
	req.Finalize = func(context.Context, floretPendingToolSettler, flruntime.PendingToolSettlementTarget, terminalProcessSnapshot) error {
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
	req.Finalize = func(context.Context, floretPendingToolSettler, flruntime.PendingToolSettlementTarget, terminalProcessSnapshot) error {
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
	req.Finalize = func(context.Context, floretPendingToolSettler, flruntime.PendingToolSettlementTarget, terminalProcessSnapshot) error {
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

func TestTerminalProcessTerminateForActiveTurnSettlesWithActiveOwnerOnce(t *testing.T) {
	manager := newTerminalProcessManager()
	defer func() { _ = manager.Close(context.Background()) }()
	owner := &terminalProcessTestOwner{}
	barrier := newFloretAuthorityBarrier()
	settlementStarted := make(chan struct{})
	var recoveryCalls atomic.Int32
	req := terminalProcessTestStartRequest(t.TempDir(), owner, "tool_active_turn", "sleep 5")
	req.AuthorityBarrier = barrier
	req.RecoveryCoordinator = terminalProcessTestRecoveryCoordinator{owner: owner, calls: &recoveryCalls}
	req.Finalize = func(context.Context, floretPendingToolSettler, flruntime.PendingToolSettlementTarget, terminalProcessSnapshot) error {
		close(settlementStarted)
		return nil
	}
	proc, err := manager.Start(req)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	proc.MarkPending()

	started := time.Now()
	snapshot, err := proc.TerminateForActiveTurn(context.Background())
	if err != nil {
		t.Fatalf("TerminateForActiveTurn: %v", err)
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("TerminateForActiveTurn took %s, want active settlement completion", elapsed)
	}
	if snapshot.Status != terminalProcessStatusCanceled || !proc.reaped {
		t.Fatalf("snapshot=%#v reaped=%v, want canceled and reaped", snapshot, proc.reaped)
	}
	select {
	case <-settlementStarted:
	default:
		t.Fatal("active-turn termination returned before canonical settlement")
	}

	barrier.release(nil)
	time.Sleep(50 * time.Millisecond)
	if recoveryCalls.Load() != 0 {
		t.Fatalf("recovery settlement calls=%d, want zero after active settlement", recoveryCalls.Load())
	}
}

func TestBoundRunTerminalHostDefersExactRecoveryIdentityUntilBarrierRelease(t *testing.T) {
	for _, test := range []struct {
		name              string
		executionThreadID string
		authorityThreadID string
	}{
		{name: "root", executionThreadID: "thread_root", authorityThreadID: "thread_root"},
		{name: "subagent", executionThreadID: "thread_child", authorityThreadID: "thread_parent"},
	} {
		t.Run(test.name, func(t *testing.T) {
			manager := newTerminalProcessManager()
			defer func() { _ = manager.Close(context.Background()) }()
			owner := &terminalProcessTestOwner{}
			recovery := &terminalProcessRecordingRecoveryCoordinator{owner: owner}
			host, err := newBoundRunTerminalHost(
				manager,
				"env_recovery_identity",
				test.executionThreadID,
				test.authorityThreadID,
				recovery,
				func(context.Context, floretPendingToolSettler, flruntime.PendingToolSettlementTarget, terminalProcessSnapshot) error {
					return nil
				},
			)
			if err != nil {
				t.Fatalf("newBoundRunTerminalHost: %v", err)
			}
			req := terminalProcessTestStartRequestWithIdentity(
				t.TempDir(), owner, "env_recovery_identity", test.executionThreadID,
				"run_recovery_identity", "turn_recovery_identity",
				"run_recovery_identity", "turn_recovery_identity", "tool_recovery_identity", "printf done",
			)
			barrier := newFloretAuthorityBarrier()
			req.AuthorityBarrier = barrier
			proc, err := host.Start(req)
			if err != nil {
				t.Fatalf("Start: %v", err)
			}
			if snapshot := proc.WaitForYield(1000); snapshot.Status != terminalProcessStatusSuccess {
				t.Fatalf("snapshot=%#v, want success", snapshot)
			}
			proc.MarkPending()
			if _, _, calls := recovery.snapshot(); calls != 0 {
				t.Fatalf("recovery calls before barrier=%d, want zero", calls)
			}
			barrier.release(nil)
			select {
			case <-proc.finalizationDone:
			case <-time.After(3 * time.Second):
				t.Fatal("recovery settlement did not finish")
			}
			executionThreadID, authorityThreadID, calls := recovery.snapshot()
			if executionThreadID != test.executionThreadID || authorityThreadID != test.authorityThreadID || calls != 1 {
				t.Fatalf("recovery identity=(%q,%q) calls=%d, want (%q,%q) once", executionThreadID, authorityThreadID, calls, test.executionThreadID, test.authorityThreadID)
			}
		})
	}
}

func TestRunTerminateTerminalProcessesUsesExactRunAndWaitsForSettlement(t *testing.T) {
	manager := newTerminalProcessManager()
	defer func() { _ = manager.Close(context.Background()) }()
	owner := &terminalProcessTestOwner{}
	workspace := t.TempDir()
	settlementStarted := make(chan struct{})
	releaseSettlement := make(chan struct{})

	runA := newTerminalProcessTestRun(t, workspace, &Service{terminalProcesses: manager}, nil, "env_stop", "thread_stop", "run_stop_a", "turn_stop_a")
	reqA := terminalProcessTestStartRequestWithIdentity(workspace, owner, "env_stop", "thread_stop", "run_stop_a", "turn_stop_a", "run_stop_a", "turn_stop_a", "tool_stop_a", "sleep 30")
	reqA.Finalize = func(context.Context, floretPendingToolSettler, flruntime.PendingToolSettlementTarget, terminalProcessSnapshot) error {
		close(settlementStarted)
		<-releaseSettlement
		return nil
	}
	procA, err := manager.Start(reqA)
	if err != nil {
		t.Fatalf("Start run A: %v", err)
	}
	procA.MarkPending()
	procB, err := manager.Start(terminalProcessTestStartRequestWithIdentity(workspace, owner, "env_stop", "thread_stop", "run_stop_b", "turn_stop_b", "run_stop_b", "turn_stop_b", "tool_stop_b", "sleep 30"))
	if err != nil {
		t.Fatalf("Start run B: %v", err)
	}
	procB.MarkPending()

	resultCh := make(chan error, 1)
	go func() {
		_, err := runA.terminateRunTerminalProcesses(context.Background())
		resultCh <- err
	}()
	select {
	case <-settlementStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("run A settlement did not start")
	}
	if snapshot := procA.Snapshot(); snapshot.Status != terminalProcessStatusCanceled || !procA.reaped {
		t.Fatalf("run A snapshot=%#v reaped=%v, want canceled and reaped", snapshot, procA.reaped)
	}
	if snapshot := procB.Snapshot(); snapshot.Status != terminalProcessStatusRunning {
		t.Fatalf("run B snapshot=%#v, want untouched running process", snapshot)
	}
	select {
	case err := <-resultCh:
		t.Fatalf("run termination returned before settlement: %v", err)
	default:
	}
	close(releaseSettlement)
	select {
	case err := <-resultCh:
		if err != nil {
			t.Fatalf("terminateRunTerminalProcesses: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("run termination did not return after settlement")
	}
}

func TestRunTerminateTerminalProcessesSignalsEveryExactRunProcessBeforeWaitingForSettlement(t *testing.T) {
	manager := newTerminalProcessManager()
	defer func() { _ = manager.Close(context.Background()) }()
	owner := &terminalProcessTestOwner{}
	workspace := t.TempDir()
	settlementStarted := make(chan string, 2)
	releaseSettlement := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseSettlement) }) }
	t.Cleanup(release)

	r := newTerminalProcessTestRun(t, workspace, &Service{terminalProcesses: manager}, nil, "env_stop_all", "thread_stop_all", "run_stop_all", "turn_stop_all")
	processes := make([]*terminalProcess, 0, 2)
	for _, toolID := range []string{"tool_stop_all_a", "tool_stop_all_b"} {
		req := terminalProcessTestStartRequestWithIdentity(
			workspace, owner, "env_stop_all", "thread_stop_all", "run_stop_all", "turn_stop_all",
			"run_stop_all", "turn_stop_all", toolID, "sleep 30",
		)
		req.Finalize = func(_ context.Context, _ floretPendingToolSettler, _ flruntime.PendingToolSettlementTarget, snapshot terminalProcessSnapshot) error {
			settlementStarted <- snapshot.ProcessID
			<-releaseSettlement
			return nil
		}
		proc, err := manager.Start(req)
		if err != nil {
			t.Fatalf("Start %s: %v", toolID, err)
		}
		proc.MarkPending()
		processes = append(processes, proc)
	}

	resultCh := make(chan error, 1)
	go func() {
		_, err := r.terminateRunTerminalProcesses(context.Background())
		resultCh <- err
	}()
	select {
	case <-settlementStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("run settlement did not start")
	}
	for i, proc := range processes {
		proc.mu.Lock()
		terminationRequested := proc.terminationRequested
		proc.mu.Unlock()
		if !terminationRequested {
			t.Fatalf("process %d did not receive termination before settlement wait", i)
		}
	}

	release()
	select {
	case err := <-resultCh:
		if err != nil {
			t.Fatalf("terminateRunTerminalProcesses: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("run termination did not return after settlements")
	}
}

func TestRunTerminateTerminalProcessesPreservesNaturalExit(t *testing.T) {
	manager := newTerminalProcessManager()
	defer func() { _ = manager.Close(context.Background()) }()
	owner := &terminalProcessTestOwner{}
	workspace := t.TempDir()
	r := newTerminalProcessTestRun(t, workspace, &Service{terminalProcesses: manager}, nil, "env_natural", "thread_natural", "run_natural", "turn_natural")
	proc, err := manager.Start(terminalProcessTestStartRequestWithIdentity(
		workspace, owner, "env_natural", "thread_natural", "run_natural", "turn_natural",
		"run_natural", "turn_natural", "tool_natural", "printf done",
	))
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if snapshot := proc.WaitForYield(1000); snapshot.Status != terminalProcessStatusSuccess {
		t.Fatalf("natural exit snapshot=%#v, want success", snapshot)
	}
	proc.MarkPending()
	if _, err := r.terminateRunTerminalProcesses(context.Background()); err != nil {
		t.Fatalf("terminateRunTerminalProcesses after natural exit: %v", err)
	}
	proc.mu.Lock()
	terminationRequested := proc.terminationRequested
	proc.mu.Unlock()
	if snapshot := proc.Snapshot(); snapshot.Status != terminalProcessStatusSuccess || terminationRequested {
		t.Fatalf("natural exit changed by cleanup: snapshot=%#v termination_requested=%t", snapshot, terminationRequested)
	}
}

func TestWaitForStoppedRunRequiresDoneAndExactCanonicalTerminal(t *testing.T) {
	r := &run{id: "run_stop", threadID: "thread_stop", doneCh: make(chan struct{})}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := waitForStoppedRun(ctx, r); !errors.Is(err, ErrThreadStopPending) {
		t.Fatalf("waitForStoppedRun error=%v, want %v", err, ErrThreadStopPending)
	}

	r.markDone()
	if err := waitForStoppedRun(context.Background(), r); err != nil {
		t.Fatalf("waitForStoppedRun after done: %v", err)
	}
	exact := flruntime.ThreadSnapshot{
		ID:          "thread_stop",
		Status:      flruntime.ThreadStatusCancelled,
		LatestRunID: "run_stop",
	}
	latest := &flruntime.ThreadTurnSnapshot{TurnID: "turn_stop", RunID: "run_stop", Status: flruntime.TurnStatusCancelled}
	if err := validateStoppedRunCanonicalSnapshot(exact, latest, "thread_stop", "run_stop", true); err != nil {
		t.Fatalf("validate exact canonical terminal: %v", err)
	}
	preAdmission := flruntime.ThreadSnapshot{ID: "thread_stop", Status: flruntime.ThreadStatusIdle}
	if err := validateStoppedRunCanonicalSnapshot(preAdmission, nil, "thread_stop", "run_stop", false); err != nil {
		t.Fatalf("validate pre-admission stop: %v", err)
	}
	if err := validateStoppedRunCanonicalSnapshot(preAdmission, nil, "thread_stop", "run_stop", true); !errors.Is(err, ErrThreadStopUnavailable) {
		t.Fatalf("started run without exact canonical terminal error=%v, want %v", err, ErrThreadStopUnavailable)
	}

	for name, mutate := range map[string]func(*flruntime.ThreadSnapshot, *flruntime.ThreadTurnSnapshot){
		"wrong run": func(snapshot *flruntime.ThreadSnapshot, latest *flruntime.ThreadTurnSnapshot) {
			latest.RunID = "run_other"
		},
		"running turn": func(snapshot *flruntime.ThreadSnapshot, latest *flruntime.ThreadTurnSnapshot) {
			snapshot.Status = flruntime.ThreadStatusRunning
			latest.Status = flruntime.TurnStatusRunning
		},
	} {
		t.Run(name, func(t *testing.T) {
			snapshot := exact
			turn := *latest
			mutate(&snapshot, &turn)
			if err := validateStoppedRunCanonicalSnapshot(snapshot, &turn, "thread_stop", "run_stop", true); !errors.Is(err, ErrThreadStopUnavailable) {
				t.Fatalf("validation error=%v, want %v", err, ErrThreadStopUnavailable)
			}
		})
	}
	if err := validateStoppedRunCanonicalSnapshot(exact, nil, "thread_stop", "run_stop", true); !errors.Is(err, ErrThreadStopUnavailable) {
		t.Fatalf("missing latest error=%v, want %v", err, ErrThreadStopUnavailable)
	}
}

func TestTerminalProcessSettlementFailureIsNotRetried(t *testing.T) {
	manager := newTerminalProcessManager()
	owner := &terminalProcessTestOwner{}
	var finalized atomic.Int32
	wantErr := errors.New("canonical settlement failed")
	req := terminalProcessTestStartRequest(t.TempDir(), owner, "tool_failure", "printf done")
	req.Finalize = func(context.Context, floretPendingToolSettler, flruntime.PendingToolSettlementTarget, terminalProcessSnapshot) error {
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

func TestTerminalProcessRecoveryCoordinatorFailureIsNotRetried(t *testing.T) {
	manager := newTerminalProcessManager()
	defer func() { _ = manager.Close(context.Background()) }()
	owner := &terminalProcessTestOwner{}
	var recoveryCalls atomic.Int32
	var finalized atomic.Int32
	req := terminalProcessTestStartRequest(t.TempDir(), owner, "tool_recovery_busy", "printf done")
	req.RecoveryCoordinator = terminalProcessTestRecoveryCoordinator{
		owner: owner,
		calls: &recoveryCalls,
		err:   flruntime.ErrThreadBusy,
	}
	req.Finalize = func(context.Context, floretPendingToolSettler, flruntime.PendingToolSettlementTarget, terminalProcessSnapshot) error {
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
	proc.MarkPending()
	select {
	case <-proc.finalizationDone:
	case <-time.After(3 * time.Second):
		t.Fatal("recovery failure did not finish finalization")
	}
	if _, err := proc.Terminate(context.Background()); !errors.Is(err, flruntime.ErrThreadBusy) {
		t.Fatalf("Terminate error=%v, want %v", err, flruntime.ErrThreadBusy)
	}
	if recoveryCalls.Load() != 1 || finalized.Load() != 0 {
		t.Fatalf("recovery calls=%d finalizations=%d, want one recovery call and no finalizer call", recoveryCalls.Load(), finalized.Load())
	}
}

func TestTerminalProcessAuthorityBarrierFailurePreventsSettlement(t *testing.T) {
	manager := newTerminalProcessManager()
	defer func() { _ = manager.Close(context.Background()) }()
	owner := &terminalProcessTestOwner{}
	barrier := newFloretAuthorityBarrier()
	var recoveryCalls atomic.Int32
	var finalized atomic.Int32
	wantErr := errors.New("invalid Floret terminal authority proof")
	req := terminalProcessTestStartRequest(t.TempDir(), owner, "tool_barrier_failure", "printf done")
	req.AuthorityBarrier = barrier
	req.RecoveryCoordinator = terminalProcessTestRecoveryCoordinator{owner: owner, calls: &recoveryCalls}
	req.Finalize = func(context.Context, floretPendingToolSettler, flruntime.PendingToolSettlementTarget, terminalProcessSnapshot) error {
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
	proc.MarkPending()
	select {
	case <-proc.finalizationDone:
		t.Fatal("settlement completed before authority barrier release")
	default:
	}

	barrier.release(wantErr)
	select {
	case <-proc.finalizationDone:
	case <-time.After(3 * time.Second):
		t.Fatal("barrier failure did not finish terminal finalization")
	}
	if recoveryCalls.Load() != 0 || finalized.Load() != 0 {
		t.Fatalf("recovery calls=%d settlement attempts=%d, want zero after invalid authority proof", recoveryCalls.Load(), finalized.Load())
	}
	if _, err := proc.Terminate(context.Background()); !errors.Is(err, wantErr) {
		t.Fatalf("Terminate error=%v, want %v", err, wantErr)
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
	barrier := newFloretAuthorityBarrier()
	barrier.release(nil)
	return terminalProcessStartRequest{
		ProcessID:                 processID,
		EndpointID:                endpointID,
		ThreadID:                  threadID,
		RunID:                     runID,
		TurnID:                    turnID,
		ActiveSettlementOwner:     owner,
		RecoveryCoordinator:       terminalProcessTestRecoveryCoordinator{owner: owner},
		RecoveryAuthorityThreadID: threadID,
		AuthorityBarrier:          barrier,
		SettlementTarget: flruntime.PendingToolSettlementTarget{
			ThreadID:        flruntime.ThreadID(threadID),
			TurnID:          flruntime.TurnID(settlementTurnID),
			RunID:           flruntime.RunID(settlementRunID),
			ToolCallID:      toolID,
			ToolName:        "terminal.exec",
			Handle:          processID,
			EffectAttemptID: "test_effect:" + toolID,
		},
		Finalize: func(ctx context.Context, owner floretPendingToolSettler, target flruntime.PendingToolSettlementTarget, snapshot terminalProcessSnapshot) error {
			request, err := terminalProcessSettlementRequest(target, snapshot, terminalProcessResultPayload(snapshot))
			if err != nil {
				return err
			}
			_, err = owner.SettlePendingTool(ctx, request)
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
		TurnID:           turnID,
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
	// This helper models terminal-process unit tests without a live Floret turn;
	// production runs publish the barrier from RunTurn's exact terminal result.
	r.floretAuthorityBarrier.release(nil)
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
