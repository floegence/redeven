package ai

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

type stopThreadTerminalProvider struct {
	mu         sync.Mutex
	mainCalls  int
	started    chan struct{}
	manager    *terminalProcessManager
	endpointID string
	threadID   string
	runID      string
	process    *terminalProcess
}

type stopThreadReadHost struct {
	floretThreadReadHost
	readOverview func(context.Context, flruntime.ThreadID) (flruntime.ThreadOverview, error)
}

func (h stopThreadReadHost) ReadThreadOverview(ctx context.Context, threadID flruntime.ThreadID) (flruntime.ThreadOverview, error) {
	return h.readOverview(ctx, threadID)
}

func newStopThreadStateMachineTestService(t *testing.T) (*Service, *session.Meta, string) {
	t.Helper()
	stateDir := t.TempDir()
	meta := &session.Meta{
		EndpointID: "env_stop_state_machine", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true,
	}
	svc, err := NewService(Options{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir,
		AgentHomeDir: stateDir, Shell: "/bin/sh", PersistOpTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	thread, err := svc.CreateThread(context.Background(), meta, "Stop state machine", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	return svc, meta, thread.ThreadID
}

func overrideStopThreadOverviewReader(
	t *testing.T,
	svc *Service,
	read func(context.Context, flruntime.ThreadID, floretThreadReadHost) (flruntime.ThreadOverview, error),
) {
	t.Helper()
	if svc == nil || svc.floretReads == nil || svc.floretReads.thread == nil {
		t.Fatal("Floret read capability is unavailable")
	}
	original := svc.floretReads.thread
	svc.floretReads.thread = func(ctx context.Context, threadID flruntime.ThreadID) (floretThreadReadHost, error) {
		host, err := original(ctx, threadID)
		if err != nil {
			return nil, err
		}
		return stopThreadReadHost{
			floretThreadReadHost: host,
			readOverview: func(readCtx context.Context, readThreadID flruntime.ThreadID) (flruntime.ThreadOverview, error) {
				return read(readCtx, readThreadID, host)
			},
		}, nil
	}
}

func exactStoppedThreadOverview(threadID string, runID string, turnID string) flruntime.ThreadOverview {
	return flruntime.ThreadOverview{
		Thread: flruntime.ThreadSnapshot{
			ID: flruntime.ThreadID(threadID), Status: flruntime.ThreadStatusCancelled, LatestRunID: flruntime.RunID(runID),
		},
		LatestTurn: &flruntime.ThreadTurnSnapshot{
			TurnID: flruntime.TurnID(turnID), RunID: flruntime.RunID(runID), Status: flruntime.TurnStatusCancelled,
		},
	}
}

func installStoppedRunForStopTest(svc *Service, endpointID string, threadID string, runID string, turnID string) *run {
	r := newRun(runOptions{RunID: runID, EndpointID: endpointID, ThreadID: threadID, TurnID: turnID})
	r.floretRunTurnStarted.Store(true)
	r.floretAuthorityBarrier.release(nil)
	r.markDone()
	key := runThreadKey(endpointID, threadID)
	svc.mu.Lock()
	svc.runs[runID] = r
	svc.activeRunByTh[key] = runID
	svc.mu.Unlock()
	return r
}

func (p *stopThreadTerminalProvider) StreamTurn(ctx context.Context, req ModelGatewayRequest, _ func(StreamEvent)) (ModelGatewayResult, error) {
	if isFloretThreadTitleRequest(req) {
		return ModelGatewayResult{FinishReason: "stop", Text: "Stop terminal task"}, nil
	}
	p.mu.Lock()
	p.mainCalls++
	call := p.mainCalls
	p.mu.Unlock()
	switch call {
	case 1:
		return ModelGatewayResult{
			FinishReason: "tool_calls",
			ToolCalls: []ToolCall{{
				ID:   "tool_stop_thread_exec",
				Name: "terminal.exec",
				Args: map[string]any{"command": "sleep 30", "yield_ms": 1},
			}},
		}, nil
	case 2:
		processes := p.manager.ProcessesForRun(p.endpointID, p.threadID, p.runID)
		if len(processes) != 1 {
			return ModelGatewayResult{}, errors.New("exact run terminal process was not registered")
		}
		p.mu.Lock()
		p.process = processes[0]
		p.mu.Unlock()
		close(p.started)
		<-ctx.Done()
		return ModelGatewayResult{}, ctx.Err()
	default:
		return ModelGatewayResult{}, errors.New("unexpected provider continuation")
	}
}

func (p *stopThreadTerminalProvider) terminalProcess() *terminalProcess {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.process
}

func TestStopThreadTerminatesExactFloretRunAndWaitsForCanonicalTerminal(t *testing.T) {
	workspace := t.TempDir()
	const endpointID = "env_stop_thread_integration"
	const threadID = "thread_stop_thread_integration"
	const runID = "run_stop_thread_integration"
	const turnID = "turn_stop_thread_integration"
	meta := &session.Meta{
		EndpointID: endpointID,
		CanRead:    true,
		CanWrite:   true,
		CanExecute: true,
		CanAdmin:   true,
	}
	r := newFloretRuntimeTestRun(t, runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, nil)),
		StateDir:     t.TempDir(),
		AgentHomeDir: workspace,
		WorkingDir:   workspace,
		Shell:        "/bin/bash",
		RunID:        runID,
		EndpointID:   endpointID,
		ThreadID:     threadID,
		TurnID:       turnID,
		MessageID:    turnID,
		SessionMeta:  meta,
	})
	svc := testServiceForRun(t, r)
	t.Cleanup(func() { _ = svc.terminalProcesses.Close(context.Background()) })
	svc.mu.Lock()
	svc.runs = map[string]*run{runID: r}
	svc.activeRunByTh = map[string]string{runThreadKey(endpointID, threadID): runID}
	svc.mu.Unlock()

	otherOwner := &terminalProcessTestOwner{}
	other, err := svc.terminalProcesses.Start(terminalProcessTestStartRequestWithIdentity(
		workspace, otherOwner, endpointID, "thread_other", "run_other", "turn_other",
		"run_other", "turn_other", "tool_other", "sleep 30",
	))
	if err != nil {
		t.Fatalf("start unrelated process: %v", err)
	}
	t.Cleanup(func() { _, _ = other.Terminate(context.Background()) })
	other.MarkPending()

	provider := &stopThreadTerminalProvider{
		started:    make(chan struct{}),
		manager:    svc.terminalProcesses,
		endpointID: endpointID,
		threadID:   threadID,
		runID:      runID,
	}
	runCtx, cancelRun := context.WithCancel(context.Background())
	t.Cleanup(cancelRun)
	r.muCancel.Lock()
	r.cancelFn = cancelRun
	r.muCancel.Unlock()
	runDone := make(chan error, 1)
	go func() {
		defer r.markDone()
		runDone <- r.runFloretHostedTurn(runCtx, RunRequest{
			Model:   "compat/gpt-5-mini",
			Input:   RunInput{Text: "start a long command"},
			Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
		}, config.AIProvider{ID: "compat", Type: "openai_compatible", BaseURL: "https://example.test/v1"}, "sk-test", "stop the exact command", provider)
	}()
	select {
	case <-provider.started:
	case <-time.After(5 * time.Second):
		t.Fatal("Floret turn did not reach the pending terminal continuation")
	}
	r.muCancel.Lock()
	if r.cancelRequested {
		r.muCancel.Unlock()
		t.Fatal("hosted turn was already marked canceled before StopThread")
	}
	if r.cancelFn == nil {
		r.muCancel.Unlock()
		t.Fatal("hosted turn did not retain its cancellation owner")
	}
	r.muCancel.Unlock()

	stopCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stopStartedAt := time.Now()
	resp, err := svc.StopThread(stopCtx, meta, threadID)
	stopElapsed := time.Since(stopStartedAt)
	if err != nil {
		t.Fatalf("StopThread: %v", err)
	}
	if !resp.OK {
		t.Fatalf("StopThread response=%#v, want ok", resp)
	}
	if stopElapsed > 2*time.Second {
		t.Fatalf("StopThread elapsed=%s, want no more than 2s", stopElapsed)
	}
	select {
	case err := <-runDone:
		if err != nil {
			t.Fatalf("runFloretHostedTurn after stop: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("run did not finish after StopThread returned")
	}

	stopped := provider.terminalProcess()
	if stopped == nil {
		t.Fatal("missing stopped terminal process")
	}
	stoppedSnapshot := stopped.Snapshot()
	if stoppedSnapshot.Status != terminalProcessStatusCanceled || !stopped.reaped {
		t.Fatalf("stopped process=%#v reaped=%v", stoppedSnapshot, stopped.reaped)
	}
	if otherSnapshot := other.Snapshot(); otherSnapshot.Status != terminalProcessStatusRunning {
		t.Fatalf("unrelated process=%#v, want running", otherSnapshot)
	}
	snapshot, latest, err := svc.readCanonicalThreadState(context.Background(), threadID)
	if err != nil {
		t.Fatalf("read canonical thread after stop: %v", err)
	}
	if err := validateStoppedRunCanonicalSnapshot(snapshot, latest, threadID, runID, true); err != nil {
		t.Fatalf("canonical stop proof: %v", err)
	}
	if latest == nil || strings.TrimSpace(string(latest.TurnID)) != turnID {
		t.Fatalf("canonical latest turn=%#v, want %q", latest, turnID)
	}
	repeated, err := svc.StopThread(context.Background(), meta, threadID)
	if err != nil || !repeated.OK {
		t.Fatalf("repeated StopThread response=%#v err=%v, want idempotent success", repeated, err)
	}
}

func TestStopActiveRunExecutionReturnsPendingWhenSettlementExceedsDeadline(t *testing.T) {
	workspace := t.TempDir()
	const endpointID = "env_stop_pending"
	const threadID = "thread_stop_pending"
	const runID = "run_stop_pending"
	const turnID = "turn_stop_pending"
	meta := &session.Meta{EndpointID: endpointID, CanRead: true, CanWrite: true, CanExecute: true}
	svc := &Service{terminalProcesses: newTerminalProcessManager(), persistOpTO: 5 * time.Second}
	r := newTerminalProcessTestRun(t, workspace, svc, nil, endpointID, threadID, runID, turnID)
	svc.runs = map[string]*run{runID: r}
	svc.activeRunByTh = map[string]string{runThreadKey(endpointID, threadID): runID}
	releaseSettlement := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseSettlement) }) }
	t.Cleanup(func() {
		release()
		r.markDone()
		_ = svc.terminalProcesses.Close(context.Background())
	})
	req := terminalProcessTestStartRequestWithIdentity(
		workspace, &terminalProcessTestOwner{}, endpointID, threadID, runID, turnID,
		runID, turnID, "tool_stop_pending", "sleep 30",
	)
	req.Finalize = func(context.Context, floretPendingToolSettler, flruntime.PendingToolSettlementTarget, terminalProcessSnapshot) error {
		<-releaseSettlement
		return nil
	}
	proc, err := svc.terminalProcesses.Start(req)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	proc.MarkPending()
	runCtx, cancelRun := context.WithCancel(context.Background())
	defer cancelRun()
	r.muCancel.Lock()
	r.cancelFn = cancelRun
	r.muCancel.Unlock()

	stopCtx, cancelStop := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancelStop()
	startedAt := time.Now()
	err = svc.stopActiveRunExecution(stopCtx, meta, endpointID, threadID, runID, r)
	if !errors.Is(err, ErrThreadStopPending) {
		t.Fatalf("stopActiveRunExecution error=%v, want %v", err, ErrThreadStopPending)
	}
	if elapsed := time.Since(startedAt); elapsed > time.Second {
		t.Fatalf("pending stop elapsed=%s, want prompt bounded response", elapsed)
	}
	if !errors.Is(r.requireExecutionOpen(), ErrRunExecutionClosed) {
		t.Fatal("run execution remained open after pending stop")
	}
	r.muCancel.Lock()
	cancelRequested := r.cancelRequested
	r.muCancel.Unlock()
	if !cancelRequested {
		t.Fatal("run context was not canceled after terminal settlement wait timed out")
	}
	proc.mu.Lock()
	terminationRequested := proc.terminationRequested
	proc.mu.Unlock()
	if !terminationRequested {
		t.Fatal("terminal process did not receive termination before pending response")
	}

	release()
	select {
	case <-proc.finalizationDone:
	case <-time.After(3 * time.Second):
		t.Fatal("terminal settlement did not finish after release")
	}
	select {
	case <-runCtx.Done():
	default:
		t.Fatal("run cancellation context was not closed")
	}
}

func TestStopThreadUsesOneTotalBudgetAcrossCanonicalReads(t *testing.T) {
	svc, meta, threadID := newStopThreadStateMachineTestService(t)
	var reads atomic.Int32
	overrideStopThreadOverviewReader(t, svc, func(ctx context.Context, threadID flruntime.ThreadID, host floretThreadReadHost) (flruntime.ThreadOverview, error) {
		reads.Add(1)
		timer := time.NewTimer(1200 * time.Millisecond)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return flruntime.ThreadOverview{}, ctx.Err()
		case <-timer.C:
			return host.ReadThreadOverview(ctx, threadID)
		}
	})

	startedAt := time.Now()
	_, err := svc.StopThread(context.Background(), meta, threadID)
	elapsed := time.Since(startedAt)
	if !errors.Is(err, ErrThreadStopPending) {
		t.Fatalf("StopThread error=%v, want %v", err, ErrThreadStopPending)
	}
	if reads.Load() != 2 {
		t.Fatalf("canonical reads=%d, want two stages sharing one budget", reads.Load())
	}
	if elapsed < 1800*time.Millisecond || elapsed > 2500*time.Millisecond {
		t.Fatalf("StopThread elapsed=%s, want one approximately 2s total budget", elapsed)
	}
}

func TestStopThreadCallerDeadlineBoundsLifecycleGateWait(t *testing.T) {
	svc, meta, threadID := newStopThreadStateMachineTestService(t)
	unlock, err := svc.threadMgr.lockThreadLifecycle(meta.EndpointID, threadID)
	if err != nil {
		t.Fatalf("lockThreadLifecycle: %v", err)
	}
	defer unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	startedAt := time.Now()
	_, err = svc.StopThread(ctx, meta, threadID)
	if !errors.Is(err, ErrThreadStopPending) {
		t.Fatalf("StopThread error=%v, want %v", err, ErrThreadStopPending)
	}
	if elapsed := time.Since(startedAt); elapsed > 500*time.Millisecond {
		t.Fatalf("StopThread elapsed=%s, want caller deadline to bound lifecycle wait", elapsed)
	}
}

func TestStopThreadRetriesCanonicalFinalizationAfterTransientReadFailure(t *testing.T) {
	svc, meta, threadID := newStopThreadStateMachineTestService(t)
	const runID = "run_stop_retry"
	const turnID = "turn_stop_retry"
	r := installStoppedRunForStopTest(svc, meta.EndpointID, threadID, runID, turnID)
	var reads atomic.Int32
	overrideStopThreadOverviewReader(t, svc, func(context.Context, flruntime.ThreadID, floretThreadReadHost) (flruntime.ThreadOverview, error) {
		if reads.Add(1) == 1 {
			return flruntime.ThreadOverview{}, errors.New("transient canonical read failure")
		}
		return exactStoppedThreadOverview(threadID, runID, turnID), nil
	})

	if _, err := svc.StopThread(context.Background(), meta, threadID); !errors.Is(err, ErrThreadStopUnavailable) {
		t.Fatalf("first StopThread error=%v, want %v", err, ErrThreadStopUnavailable)
	}
	key := runThreadKey(meta.EndpointID, threadID)
	svc.mu.Lock()
	if svc.stopFinalizingByTh[key] != runID || svc.runs[runID] != r {
		svc.mu.Unlock()
		t.Fatal("transient failure discarded the exact finalization owner")
	}
	svc.mu.Unlock()

	response, err := svc.StopThread(context.Background(), meta, threadID)
	if err != nil || !response.OK {
		t.Fatalf("second StopThread response=%#v err=%v, want success", response, err)
	}
	svc.mu.Lock()
	defer svc.mu.Unlock()
	if svc.stopFinalizingByTh[key] != "" || svc.runs[runID] != nil {
		t.Fatal("successful retry did not clear exact finalization ownership")
	}
}

func TestConcurrentStopThreadSharesOneFinalizationAttempt(t *testing.T) {
	svc, meta, threadID := newStopThreadStateMachineTestService(t)
	const runID = "run_stop_concurrent"
	const turnID = "turn_stop_concurrent"
	installStoppedRunForStopTest(svc, meta.EndpointID, threadID, runID, turnID)
	readStarted := make(chan struct{})
	releaseRead := make(chan struct{})
	var reads atomic.Int32
	var startedOnce sync.Once
	overrideStopThreadOverviewReader(t, svc, func(ctx context.Context, _ flruntime.ThreadID, _ floretThreadReadHost) (flruntime.ThreadOverview, error) {
		call := reads.Add(1)
		if call == 1 {
			startedOnce.Do(func() { close(readStarted) })
			select {
			case <-ctx.Done():
				return flruntime.ThreadOverview{}, ctx.Err()
			case <-releaseRead:
			}
		}
		return exactStoppedThreadOverview(threadID, runID, turnID), nil
	})

	results := make(chan error, 2)
	for range 2 {
		go func() {
			response, err := svc.StopThread(context.Background(), meta, threadID)
			if err == nil && !response.OK {
				err = errors.New("StopThread returned a non-OK response")
			}
			results <- err
		}()
	}
	select {
	case <-readStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("finalization canonical read did not start")
	}
	time.Sleep(20 * time.Millisecond)
	if reads.Load() != 1 {
		t.Fatalf("in-flight finalization reads=%d, want one", reads.Load())
	}
	close(releaseRead)
	for range 2 {
		if err := <-results; err != nil {
			t.Fatalf("concurrent StopThread: %v", err)
		}
	}
}

func TestStopFinalizationWaiterKeepsCompletedAttemptResultAcrossRetry(t *testing.T) {
	r := newRun(runOptions{RunID: "run_stop_attempt_generation"})
	firstAttempt, start := beginStopFinalizationAttempt(r)
	if !start {
		t.Fatal("first finalization attempt did not start")
	}
	firstErr := errors.New("first finalization failed")
	finishStopFinalizationAttempt(firstAttempt, firstErr)
	select {
	case <-firstAttempt.done:
	default:
		t.Fatal("first finalization attempt did not complete")
	}

	secondAttempt, start := beginStopFinalizationAttempt(r)
	if !start {
		t.Fatal("second finalization attempt did not start")
	}
	defer func() {
		finishStopFinalizationAttempt(secondAttempt, nil)
		<-secondAttempt.done
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if err := waitForExactStopFinalization(ctx, firstAttempt); !errors.Is(err, firstErr) {
		t.Fatalf("waitForExactStopFinalization error=%v, want first attempt error", err)
	}
}

func TestStopFinalizerDoesNotDeleteReplacementRunMapping(t *testing.T) {
	svc, meta, threadID := newStopThreadStateMachineTestService(t)
	const oldRunID = "run_stop_old"
	const oldTurnID = "turn_stop_old"
	oldRun := installStoppedRunForStopTest(svc, meta.EndpointID, threadID, oldRunID, oldTurnID)
	readStarted := make(chan struct{})
	releaseRead := make(chan struct{})
	overrideStopThreadOverviewReader(t, svc, func(ctx context.Context, _ flruntime.ThreadID, _ floretThreadReadHost) (flruntime.ThreadOverview, error) {
		select {
		case <-readStarted:
		default:
			close(readStarted)
		}
		select {
		case <-ctx.Done():
			return flruntime.ThreadOverview{}, ctx.Err()
		case <-releaseRead:
			return exactStoppedThreadOverview(threadID, oldRunID, oldTurnID), nil
		}
	})

	result := make(chan error, 1)
	go func() {
		_, err := svc.StopThread(context.Background(), meta, threadID)
		result <- err
	}()
	select {
	case <-readStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("old finalizer did not reach canonical read")
	}
	const newRunID = "run_stop_new"
	newRun := newRun(runOptions{RunID: newRunID, EndpointID: meta.EndpointID, ThreadID: threadID, TurnID: "turn_stop_new"})
	key := runThreadKey(meta.EndpointID, threadID)
	svc.mu.Lock()
	svc.activeRunByTh[key] = newRunID
	svc.stopFinalizingByTh[key] = newRunID
	svc.runs[newRunID] = newRun
	svc.mu.Unlock()
	close(releaseRead)
	if err := <-result; !errors.Is(err, ErrThreadStopUnavailable) {
		t.Fatalf("old StopThread error=%v, want ownership change failure", err)
	}
	svc.mu.Lock()
	defer svc.mu.Unlock()
	if svc.activeRunByTh[key] != newRunID || svc.stopFinalizingByTh[key] != newRunID || svc.runs[newRunID] != newRun {
		t.Fatal("old finalizer deleted replacement run ownership")
	}
	if svc.runs[oldRunID] == oldRun {
		t.Fatal("old exact run remained retained after its finalizer lost ownership")
	}
}

func TestReconcileStaleActiveRunRequiresCanonicalIdle(t *testing.T) {
	svc, meta, threadID := newStopThreadStateMachineTestService(t)
	const staleRunID = "run_stale_missing"
	key := runThreadKey(meta.EndpointID, threadID)
	svc.mu.Lock()
	svc.activeRunByTh[key] = staleRunID
	svc.mu.Unlock()
	var busy atomic.Bool
	busy.Store(true)
	overrideStopThreadOverviewReader(t, svc, func(context.Context, flruntime.ThreadID, floretThreadReadHost) (flruntime.ThreadOverview, error) {
		status := flruntime.ThreadStatusIdle
		if busy.Load() {
			status = flruntime.ThreadStatusRunning
		}
		return flruntime.ThreadOverview{Thread: flruntime.ThreadSnapshot{ID: flruntime.ThreadID(threadID), Status: status}}, nil
	})

	if removed, err := svc.reconcileStaleActiveRun(context.Background(), meta.EndpointID, threadID, staleRunID); removed || !errors.Is(err, ErrThreadStopUnavailable) {
		t.Fatalf("busy reconcile removed=%v err=%v, want retained unavailable", removed, err)
	}
	svc.mu.Lock()
	if svc.activeRunByTh[key] != staleRunID {
		svc.mu.Unlock()
		t.Fatal("canonical busy state lost the stale mapping")
	}
	svc.mu.Unlock()

	busy.Store(false)
	if removed, err := svc.reconcileStaleActiveRun(context.Background(), meta.EndpointID, threadID, staleRunID); err != nil || !removed {
		t.Fatalf("idle reconcile removed=%v err=%v, want removal", removed, err)
	}
	svc.mu.Lock()
	defer svc.mu.Unlock()
	if svc.activeRunByTh[key] != "" {
		t.Fatal("canonical idle state retained the stale mapping")
	}
}

func TestRunExecutionClosureIsScopedToExactRun(t *testing.T) {
	stopped := &run{}
	stopped.closeExecution()
	stopped.closeExecution()
	if !errors.Is(stopped.requireExecutionOpen(), ErrRunExecutionClosed) {
		t.Fatal("stopped run execution unexpectedly reopened")
	}
	fresh := &run{}
	if err := fresh.requireExecutionOpen(); err != nil {
		t.Fatalf("fresh run inherited stopped execution state: %v", err)
	}
}

func TestRunExecutionAdmissionLinearizesWithClose(t *testing.T) {
	t.Parallel()

	type admissionResult struct {
		ctx     context.Context
		release func()
		err     error
	}
	for iteration := 0; iteration < 1000; iteration++ {
		r := &run{}
		start := make(chan struct{})
		closed := make(chan struct{})
		admitted := make(chan admissionResult, 1)
		go func() {
			<-start
			ctx, release, err := r.beginExecutionAdmission(context.Background())
			admitted <- admissionResult{ctx: ctx, release: release, err: err}
		}()
		go func() {
			<-start
			r.closeExecution()
			close(closed)
		}()
		close(start)
		result := <-admitted
		<-closed
		if result.err != nil {
			if !errors.Is(result.err, ErrRunExecutionClosed) {
				t.Fatalf("iteration %d admission error=%v, want %v", iteration, result.err, ErrRunExecutionClosed)
			}
			continue
		}
		select {
		case <-result.ctx.Done():
			if !errors.Is(context.Cause(result.ctx), ErrRunExecutionClosed) {
				t.Fatalf("iteration %d admission cause=%v, want %v", iteration, context.Cause(result.ctx), ErrRunExecutionClosed)
			}
		default:
			t.Fatalf("iteration %d admitted execution remained live after close returned", iteration)
		}
		result.release()
	}
}
