package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	flruntime "github.com/floegence/floret/v3/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

var (
	ErrThreadStopPending     = errors.New("thread stop pending")
	ErrThreadStopUnavailable = errors.New("thread stop unavailable")
	errStopRunNotActive      = errors.New("exact run is no longer active")
)

type StopThreadRequest struct {
	ThreadID             string `json:"thread_id"`
	ExpectedRunID        string `json:"-"`
	ExpectedExecutionKey string `json:"-"`
}

type cmdStopThread struct {
	ctx  context.Context
	meta *session.Meta
	req  StopThreadRequest
	resp chan stopThreadResult
}

type stopThreadResult struct {
	resp StopThreadResponse
	err  error
}

func (s *Service) suppressQueuedDrain(endpointID string, threadID string) {
	if s == nil {
		return
	}
	key := runThreadKey(endpointID, threadID)
	if key == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.suppressQueuedDrainByTh == nil {
		s.suppressQueuedDrainByTh = make(map[string]bool)
	}
	s.suppressQueuedDrainByTh[key] = true
}

func (s *Service) clearQueuedDrainSuppression(endpointID string, threadID string) {
	if s == nil {
		return
	}
	key := runThreadKey(endpointID, threadID)
	if key == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.suppressQueuedDrainByTh, key)
}

func (s *Service) isQueuedDrainSuppressed(endpointID string, threadID string) bool {
	if s == nil {
		return false
	}
	key := runThreadKey(endpointID, threadID)
	if key == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.suppressQueuedDrainByTh[key]
}

func (s *Service) StopThread(ctx context.Context, meta *session.Meta, threadID string) (StopThreadResponse, error) {
	return s.stopThread(ctx, meta, StopThreadRequest{ThreadID: threadID})
}

func (s *Service) stopThreadWithExpectedExecutionKey(ctx context.Context, meta *session.Meta, threadID string, expectedExecutionKey string) (StopThreadResponse, error) {
	return s.stopThread(ctx, meta, StopThreadRequest{ThreadID: threadID, ExpectedExecutionKey: expectedExecutionKey})
}

func (s *Service) stopThread(ctx context.Context, meta *session.Meta, req StopThreadRequest) (StopThreadResponse, error) {
	if s == nil {
		return StopThreadResponse{}, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	stopCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	ctx = stopCtx
	if err := requireRWX(meta); err != nil {
		return StopThreadResponse{}, err
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID := strings.TrimSpace(req.ThreadID)
	if endpointID == "" || threadID == "" {
		return StopThreadResponse{}, errors.New("invalid request")
	}
	if s.threadMgr == nil {
		return StopThreadResponse{}, errors.New("thread manager not ready")
	}
	actor := s.threadMgr.Get(endpointID, threadID)
	if actor == nil {
		// A rebuilt session can briefly lack the in-memory owner while the
		// canonical Floret thread is already terminal. Treat that lifecycle
		// command as idempotently complete; a canonical busy thread is only
		// accepted as pending so the recovery path can recreate its owner.
		snapshot, _, err := s.readCanonicalThreadState(ctx, threadID)
		if err != nil {
			return StopThreadResponse{}, err
		}
		if canonicalThreadBusy(snapshot) {
			return StopThreadResponse{}, fmt.Errorf("%w: thread actor is unavailable during recovery", ErrThreadStopPending)
		}
		return StopThreadResponse{OK: true}, nil
	}
	// Stop is an exact lifecycle barrier. Execute it directly so a queued actor
	// command cannot delay cancellation behind a long-running admission task.
	req.ThreadID = threadID
	req.ExpectedRunID = strings.TrimSpace(req.ExpectedRunID)
	req.ExpectedExecutionKey = strings.TrimSpace(req.ExpectedExecutionKey)
	return actor.handleStopThread(ctx, meta, req)
}

func (a *threadActor) StopThread(ctx context.Context, meta *session.Meta, req StopThreadRequest) (StopThreadResponse, error) {
	if a == nil {
		return StopThreadResponse{}, errors.New("thread actor not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ch := make(chan stopThreadResult, 1)
	cmd := cmdStopThread{ctx: ctx, meta: meta, req: req, resp: ch}
	select {
	case <-a.stopCh:
		return StopThreadResponse{}, errors.New("thread actor closed")
	case <-ctx.Done():
		return StopThreadResponse{}, fmt.Errorf("%w: waiting for thread actor: %v", ErrThreadStopPending, ctx.Err())
	case a.inbox <- cmd:
	}
	select {
	case <-a.stopCh:
		return StopThreadResponse{}, errors.New("thread actor closed")
	case <-ctx.Done():
		return StopThreadResponse{}, fmt.Errorf("%w: waiting for thread actor: %v", ErrThreadStopPending, ctx.Err())
	case res := <-ch:
		return res.resp, res.err
	}
}

func waitForStoppedRun(ctx context.Context, r *run) error {
	if r == nil || r.doneCh == nil {
		return fmt.Errorf("%w: run completion authority is unavailable", ErrThreadStopUnavailable)
	}
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-r.doneCh:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("%w: waiting for run %q completion: %v", ErrThreadStopPending, strings.TrimSpace(r.id), ctx.Err())
	}
}

func validateStoppedRunCanonicalSnapshot(snapshot flruntime.ThreadSnapshot, latest *flruntime.ThreadTurnSnapshot, threadID string, runID string, runTurnStarted bool) error {
	threadID = strings.TrimSpace(threadID)
	runID = strings.TrimSpace(runID)
	if threadID == "" || strings.TrimSpace(string(snapshot.ID)) != threadID {
		return fmt.Errorf("%w: canonical thread identity does not match stopped run", ErrThreadStopUnavailable)
	}
	if runID == "" {
		if runTurnStarted {
			return fmt.Errorf("%w: canonical run identity is missing after turn admission", ErrThreadStopUnavailable)
		}
		if canonicalThreadBusy(snapshot) {
			return fmt.Errorf("%w: canonical thread is busy after pre-admission stop", ErrThreadStopUnavailable)
		}
		return nil
	}
	latestRunID := strings.TrimSpace(string(snapshot.LatestRunID))
	if latestRunID != runID {
		if runTurnStarted {
			return fmt.Errorf("%w: canonical latest run does not match stopped run %q", ErrThreadStopUnavailable, runID)
		}
		if canonicalThreadBusy(snapshot) {
			return fmt.Errorf("%w: canonical thread is busy after pre-admission stop", ErrThreadStopUnavailable)
		}
		return nil
	}
	if latest == nil || strings.TrimSpace(string(latest.RunID)) != runID {
		return fmt.Errorf("%w: canonical latest run does not match stopped run %q", ErrThreadStopUnavailable, runID)
	}
	if !latest.Status.IsTerminal() || canonicalThreadBusy(snapshot) {
		return fmt.Errorf("%w: canonical run %q is not terminal", ErrThreadStopUnavailable, runID)
	}
	return nil
}

func stoppedRunCanonicalProof(snapshot flruntime.ThreadSnapshot, latest *flruntime.ThreadTurnSnapshot, threadID string, runID string, runTurnStarted bool) (bool, error) {
	if err := validateStoppedRunCanonicalSnapshot(snapshot, latest, threadID, runID, runTurnStarted); err == nil {
		return true, nil
	} else {
		threadID = strings.TrimSpace(threadID)
		runID = strings.TrimSpace(runID)
		if threadID == "" || strings.TrimSpace(string(snapshot.ID)) != threadID {
			return false, err
		}
		if runID == "" {
			if !runTurnStarted && canonicalThreadBusy(snapshot) {
				return false, nil
			}
			return false, err
		}
		if strings.TrimSpace(string(snapshot.LatestRunID)) != runID || latest == nil || strings.TrimSpace(string(latest.RunID)) != runID {
			return false, err
		}
		if !latest.Status.IsTerminal() || canonicalThreadBusy(snapshot) {
			return false, nil
		}
		return false, err
	}
}

func (s *Service) waitForExactStoppedRunAuthority(ctx context.Context, threadID string, r *run) (string, string, string, error) {
	if s == nil || r == nil {
		return "", "", "", fmt.Errorf("%w: exact run authority is unavailable", ErrThreadStopUnavailable)
	}
	if ctx == nil {
		ctx = context.Background()
	}
	// Before durable Floret admission there is no canonical run identity to
	// stop or prove terminal. Wait for the local execution to settle first: it
	// will either finish binding canonical identity or release the durable
	// pending command. This keeps a normal immediate Stop out of the authority
	// barrier path that requires a complete StartTurn identity.
	if !r.floretAdmitted.Load() {
		select {
		case <-ctx.Done():
			return "", "", "", fmt.Errorf("%w: waiting for pre-admission execution: %v", ErrThreadStopPending, ctx.Err())
		case <-r.doneCh:
		}
		if !r.floretAdmitted.Load() {
			persistTO := s.persistOpTO
			if persistTO <= 0 {
				persistTO = defaultPersistOpTimeout
			}
			readCtx, cancel := context.WithTimeout(ctx, persistTO)
			snapshot, latest, err := s.readCanonicalThreadState(readCtx, threadID)
			cancel()
			if err != nil {
				return "", "", "", stopExecutionError("reading canonical Floret state after pre-admission stop", err)
			}
			if err := validateStoppedRunCanonicalSnapshot(snapshot, latest, threadID, "", false); err != nil {
				return "", "", "", err
			}
			status, errorCode, runErr, err := threadViewRunState(snapshot, latest)
			return status, errorCode, runErr, err
		}
	}
	canonicalRunID, _ := r.canonicalRunTurnIdentity()
	persistTO := s.persistOpTO
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	doneCh := r.doneCh
	var authorityCh <-chan struct{}
	if r.floretAuthorityBarrier != nil {
		authorityCh = r.floretAuthorityBarrier.done
	}
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		readCtx, cancel := context.WithTimeout(ctx, persistTO)
		snapshot, latest, err := s.readCanonicalThreadState(readCtx, threadID)
		cancel()
		if err != nil {
			return "", "", "", stopExecutionError("reading canonical Floret terminal snapshot", err)
		}
		proven, err := stoppedRunCanonicalProof(snapshot, latest, threadID, canonicalRunID, r.floretRunTurnStarted.Load())
		if err != nil {
			return "", "", "", err
		}
		if proven {
			status, errorCode, runErr, err := threadViewRunState(snapshot, latest)
			return status, errorCode, runErr, err
		}

		select {
		case <-ctx.Done():
			return "", "", "", fmt.Errorf("%w: waiting for exact canonical run terminal proof: %v", ErrThreadStopPending, ctx.Err())
		case <-doneCh:
			doneCh = nil
		case <-authorityCh:
			if err := r.floretAuthorityBarrier.waitContext(context.Background()); err != nil {
				return "", "", "", fmt.Errorf("%w: waiting for Floret authority release: %v", ErrThreadStopUnavailable, err)
			}
			authorityCh = nil
		case <-ticker.C:
		}
	}
}

func stopExecutionError(stage string, err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, ErrThreadStopPending) {
		return fmt.Errorf("%w: %s: %v", ErrThreadStopPending, stage, err)
	}
	return fmt.Errorf("%w: %s: %v", ErrThreadStopUnavailable, stage, err)
}

type stopFinalizationAttempt struct {
	done chan struct{}
	once sync.Once
	err  error
}

func beginStopFinalizationAttempt(r *run) (*stopFinalizationAttempt, bool) {
	if r == nil {
		return nil, false
	}
	r.muStopFinalization.Lock()
	defer r.muStopFinalization.Unlock()
	if current := r.stopFinalizationAttempt; current != nil {
		select {
		case <-current.done:
		default:
			return current, false
		}
	}
	attempt := &stopFinalizationAttempt{done: make(chan struct{})}
	r.stopFinalizationAttempt = attempt
	return attempt, true
}

func finishStopFinalizationAttempt(attempt *stopFinalizationAttempt, err error) {
	if attempt == nil {
		return
	}
	attempt.once.Do(func() {
		attempt.err = err
		close(attempt.done)
	})
}

func (s *Service) stopActiveRunExecution(ctx context.Context, meta *session.Meta, endpointID string, threadID string, executionKey string, active *run) error {
	if s == nil || active == nil {
		return fmt.Errorf("%w: active run owner is unavailable", ErrThreadStopUnavailable)
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	executionKey = strings.TrimSpace(executionKey)
	if endpointID == "" || threadID == "" || executionKey == "" ||
		strings.TrimSpace(active.endpointID) != endpointID ||
		strings.TrimSpace(active.threadID) != threadID {
		return fmt.Errorf("%w: active run identity mismatch", ErrThreadStopUnavailable)
	}
	exact, _, err := s.beginExactRunStop(endpointID, threadID, executionKey, active)
	if err != nil {
		return err
	}
	if exact == nil {
		return fmt.Errorf("%w: exact run owner is unavailable", ErrThreadStopUnavailable)
	}
	exact.requestCancel("canceled")
	termination, _ := exact.requestRunTerminalProcessTermination()
	attempt, start := beginStopFinalizationAttempt(exact)
	if start {
		go s.finishExactRunStop(endpointID, threadID, executionKey, exact, termination, attempt)
	}
	// Cancellation admission is the synchronous API boundary. Canonical
	// terminal proof and product cleanup continue in the background.
	return nil
}

func currentStopFinalizationAttempt(r *run) *stopFinalizationAttempt {
	if r == nil {
		return nil
	}
	r.muStopFinalization.Lock()
	defer r.muStopFinalization.Unlock()
	return r.stopFinalizationAttempt
}

func (s *Service) finishAcceptedThreadStop(endpointID string, threadID string, r *run, db interface {
	RecoverQueuedTurnsToDrafts(context.Context, string, string) ([]threadstore.QueuedTurn, int64, error)
}) {
	if s == nil || r == nil || db == nil {
		return
	}
	defer s.clearQueuedDrainSuppression(endpointID, threadID)
	attempt := currentStopFinalizationAttempt(r)
	if attempt == nil {
		return
	}
	<-attempt.done
	if attempt.err != nil {
		if s.log != nil {
			s.log.Warn("ai: accepted thread stop failed to reconcile", "endpoint_id", endpointID, "thread_id", threadID, "error", attempt.err)
		}
		return
	}
	if r.admissionDone != nil {
		<-r.admissionDone
	}
	persistTO := s.persistOpTO
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	ctx, cancel := context.WithTimeout(context.Background(), persistTO)
	defer cancel()
	if err := s.closeThreadSubagents(ctx, endpointID, threadID, persistTO); err != nil && s.log != nil {
		s.log.Warn("ai: accepted thread stop failed to close SubAgents", "endpoint_id", endpointID, "thread_id", threadID, "error", err)
	}
	if _, _, err := db.RecoverQueuedTurnsToDrafts(ctx, endpointID, threadID); err != nil {
		if s.log != nil {
			s.log.Warn("ai: accepted thread stop failed to recover queued turns", "endpoint_id", endpointID, "thread_id", threadID, "error", err)
		}
		return
	}
	s.broadcastThreadSummary(endpointID, threadID)
}

// reconcileStaleActiveRun removes a local run mapping only after Floret proves
// that the canonical thread is no longer busy and the mapping still names the
// same missing run. A changed mapping or canonical busy state is preserved.
func (s *Service) reconcileStaleActiveRun(ctx context.Context, endpointID string, threadID string, staleRunID string) (bool, error) {
	if s == nil {
		return false, fmt.Errorf("%w: service unavailable", ErrThreadStopUnavailable)
	}
	canonical, _, err := s.readCanonicalThreadState(ctx, threadID)
	if err != nil {
		return false, stopExecutionError("reading canonical Floret thread state", err)
	}
	if canonicalThreadBusy(canonical) {
		return false, fmt.Errorf("%w: canonical active run has no local execution owner", ErrThreadStopUnavailable)
	}
	key := runThreadKey(endpointID, threadID)
	s.mu.Lock()
	defer s.mu.Unlock()
	if strings.TrimSpace(s.activeRunByTh[key]) != strings.TrimSpace(staleRunID) || s.runs[strings.TrimSpace(staleRunID)] != nil || strings.TrimSpace(s.stopFinalizingByTh[key]) != "" {
		return false, nil
	}
	delete(s.activeRunByTh, key)
	return true, nil
}

func (s *Service) beginExactRunStop(endpointID string, threadID string, executionKey string, expected *run) (*run, bool, error) {
	if s == nil || expected == nil {
		return nil, false, fmt.Errorf("%w: exact run owner is unavailable", ErrThreadStopUnavailable)
	}
	key := runThreadKey(endpointID, threadID)
	if key == "" {
		return nil, false, fmt.Errorf("%w: exact run identity is incomplete", ErrThreadStopUnavailable)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if finalizingID := strings.TrimSpace(s.stopFinalizingByTh[key]); finalizingID != "" {
		if finalizingID != executionKey {
			return nil, false, fmt.Errorf("%w: another exact run is finalizing", ErrThreadStopPending)
		}
		r := s.runs[executionKey]
		if r == nil || r != expected {
			return nil, false, fmt.Errorf("%w: stopped run owner is unavailable", ErrThreadStopUnavailable)
		}
		return r, true, nil
	}
	if strings.TrimSpace(s.activeRunByTh[key]) != executionKey || s.runs[executionKey] != expected {
		return nil, false, errStopRunNotActive
	}
	if strings.TrimSpace(expected.endpointID) != strings.TrimSpace(endpointID) || strings.TrimSpace(expected.threadID) != strings.TrimSpace(threadID) {
		return nil, false, fmt.Errorf("%w: exact run identity mismatch", ErrThreadStopUnavailable)
	}
	expected.closeExecution()
	expected.markDetached()
	delete(s.activeRunByTh, key)
	if s.stopFinalizingByTh == nil {
		s.stopFinalizingByTh = make(map[string]string)
	}
	s.stopFinalizingByTh[key] = executionKey
	return expected, false, nil
}

func (s *Service) finishExactRunStop(endpointID string, threadID string, executionKey string, r *run, termination runTerminalTermination, attempt *stopFinalizationAttempt) {
	if s == nil || r == nil {
		return
	}
	finalizationCtx := context.Background()
	s.mu.Lock()
	if s.lifecycleCtx != nil {
		finalizationCtx = s.lifecycleCtx
	}
	s.mu.Unlock()
	var finalErr error
	var canonicalStatus string
	var canonicalErrorCode string
	var canonicalError string
	if err := termination.wait(finalizationCtx); err != nil {
		finalErr = stopExecutionError("terminating run terminal processes", err)
	}
	if finalErr == nil {
		canonicalStatus, canonicalErrorCode, canonicalError, finalErr = s.waitForExactStoppedRunAuthority(finalizationCtx, threadID, r)
	}
	if finalErr != nil {
		finishStopFinalizationAttempt(attempt, finalErr)
		return
	}
	key := runThreadKey(endpointID, threadID)
	s.mu.Lock()
	if strings.TrimSpace(s.stopFinalizingByTh[key]) == executionKey && s.runs[executionKey] == r {
		delete(s.stopFinalizingByTh, key)
		delete(s.runs, executionKey)
	} else {
		if s.runs[executionKey] == r {
			delete(s.runs, executionKey)
		}
		finalErr = fmt.Errorf("%w: exact stop ownership changed during finalization", ErrThreadStopUnavailable)
	}
	s.mu.Unlock()
	if finalErr != nil {
		finishStopFinalizationAttempt(attempt, finalErr)
		return
	}
	canonicalRunID, _ := r.canonicalRunTurnIdentity()
	s.broadcastThreadState(endpointID, threadID, canonicalRunID, canonicalStatus, canonicalErrorCode, canonicalError)
	finishStopFinalizationAttempt(attempt, nil)
	if s.threadMgr != nil {
		s.threadMgr.Wake(endpointID, threadID)
	}
}

func waitForExactStopFinalization(ctx context.Context, attempt *stopFinalizationAttempt) error {
	if attempt == nil || attempt.done == nil {
		return fmt.Errorf("%w: finalization authority is unavailable", ErrThreadStopUnavailable)
	}
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-attempt.done:
		return attempt.err
	case <-ctx.Done():
		return fmt.Errorf("%w: waiting for exact run finalization: %v", ErrThreadStopPending, ctx.Err())
	}
}

func (a *threadActor) handleStopThread(ctx context.Context, meta *session.Meta, req StopThreadRequest) (StopThreadResponse, error) {
	if a == nil || a.mgr == nil || a.mgr.svc == nil {
		return StopThreadResponse{}, errors.New("service not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return StopThreadResponse{}, err
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID := strings.TrimSpace(req.ThreadID)
	if endpointID == "" || endpointID != strings.TrimSpace(a.endpointID) || threadID == "" || threadID != strings.TrimSpace(a.threadID) {
		return StopThreadResponse{}, errors.New("invalid request")
	}
	a.mgr.svc.suppressQueuedDrain(endpointID, threadID)
	asyncStop := false
	defer func() {
		if !asyncStop {
			a.mgr.svc.clearQueuedDrainSuppression(endpointID, threadID)
		}
	}()

	a.mgr.svc.mu.Lock()
	db := a.mgr.svc.threadsDB
	persistTO := a.mgr.svc.persistOpTO
	a.mgr.svc.mu.Unlock()
	if db == nil {
		return StopThreadResponse{}, errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	activeExecutionKey, activeRun := a.lookupActiveRun(endpointID, threadID)
	if activeExecutionKey == "" {
		key := runThreadKey(endpointID, threadID)
		a.mgr.svc.mu.Lock()
		rawID := strings.TrimSpace(a.mgr.svc.activeRunByTh[key])
		rawRun := a.mgr.svc.runs[rawID]
		a.mgr.svc.mu.Unlock()
		if rawID != "" {
			activeExecutionKey, activeRun = rawID, rawRun
		}
	}
	expectedRunID := strings.TrimSpace(req.ExpectedRunID)
	expectedExecutionKey := strings.TrimSpace(req.ExpectedExecutionKey)
	if activeExecutionKey != "" && activeRun == nil {
		if _, err := a.mgr.svc.reconcileStaleActiveRun(ctx, endpointID, threadID, activeExecutionKey); err != nil {
			return StopThreadResponse{}, err
		}
		activeExecutionKey, activeRun = a.lookupActiveRun(endpointID, threadID)
	}
	activeCanonicalRunID := ""
	if activeRun != nil {
		activeCanonicalRunID, _ = activeRun.canonicalRunTurnIdentity()
	}
	finalizingExecutionKey := a.mgr.svc.stopFinalizingRunID(endpointID, threadID)
	if expectedExecutionKey != "" && activeExecutionKey != expectedExecutionKey && finalizingExecutionKey != expectedExecutionKey {
		return StopThreadResponse{}, errStopRunNotActive
	}
	if expectedRunID != "" && activeCanonicalRunID != expectedRunID {
		a.mgr.svc.mu.Lock()
		finalizingRun := a.mgr.svc.runs[finalizingExecutionKey]
		a.mgr.svc.mu.Unlock()
		finalizingCanonicalRunID := ""
		if finalizingRun != nil {
			finalizingCanonicalRunID, _ = finalizingRun.canonicalRunTurnIdentity()
		}
		if finalizingCanonicalRunID != expectedRunID {
			return StopThreadResponse{}, errStopRunNotActive
		}
	}
	switch {
	case activeExecutionKey != "":
		if err := a.mgr.svc.stopActiveRunExecution(ctx, meta, endpointID, threadID, activeExecutionKey, activeRun); err != nil {
			if !errors.Is(err, errStopRunNotActive) {
				return StopThreadResponse{}, err
			}
		}
		asyncStop = true
		go a.mgr.svc.finishAcceptedThreadStop(endpointID, threadID, activeRun, db)
		return StopThreadResponse{OK: true}, nil
	case a.mgr.svc.stopFinalizingRunID(endpointID, threadID) != "":
		finalizingID := a.mgr.svc.stopFinalizingRunID(endpointID, threadID)
		a.mgr.svc.mu.Lock()
		finalizingRun := a.mgr.svc.runs[finalizingID]
		a.mgr.svc.mu.Unlock()
		if finalizingRun == nil {
			return StopThreadResponse{}, fmt.Errorf("%w: a previous stop owner is unavailable", ErrThreadStopUnavailable)
		}
		if err := a.mgr.svc.stopActiveRunExecution(ctx, meta, endpointID, threadID, finalizingID, finalizingRun); err != nil {
			return StopThreadResponse{}, err
		}
		asyncStop = true
		go a.mgr.svc.finishAcceptedThreadStop(endpointID, threadID, finalizingRun, db)
		return StopThreadResponse{OK: true}, nil
	default:
		canonical, _, err := a.mgr.svc.readCanonicalThreadState(ctx, threadID)
		if err != nil {
			return StopThreadResponse{}, stopExecutionError("reading canonical Floret thread state", err)
		}
		if canonicalThreadBusy(canonical) {
			return StopThreadResponse{}, fmt.Errorf("%w: canonical active run has no local execution owner", ErrThreadStopUnavailable)
		}
		if a.mgr.svc.idleThreadCompactionRequestID(endpointID, threadID) != "" {
			a.mgr.svc.cancelIdleThreadCompactionWithBroadcast(endpointID, threadID)
		}
	}
	if activeExecutionKey != "" {
		// The exact run may have completed naturally between the actor lookup and
		// the atomic stop admission. Canonical terminal state is the authority in
		// that case; do not report a synthetic ownership failure.
		canonical, _, err := a.mgr.svc.readCanonicalThreadState(ctx, threadID)
		if err != nil {
			return StopThreadResponse{}, stopExecutionError("reading canonical Floret thread state", err)
		}
		if canonicalThreadBusy(canonical) {
			return StopThreadResponse{}, fmt.Errorf("%w: canonical active run has no local execution owner", ErrThreadStopUnavailable)
		}
	}

	unlockLifecycle, err := a.mgr.lockThreadLifecycleContext(ctx, endpointID, threadID)
	if err != nil {
		return StopThreadResponse{}, stopExecutionError("waiting for thread lifecycle authority", err)
	}
	defer unlockLifecycle()
	if _, _, err := a.mgr.svc.readCanonicalThreadState(ctx, threadID); err != nil {
		return StopThreadResponse{}, stopExecutionError("verifying canonical Floret thread state", err)
	}
	if err := a.mgr.svc.closeThreadSubagents(ctx, endpointID, threadID, persistTO); err != nil {
		return StopThreadResponse{}, stopExecutionError("closing thread SubAgents", err)
	}
	rctx, cancel := context.WithTimeout(ctx, persistTO)
	recovered, _, err := db.RecoverQueuedTurnsToDrafts(rctx, endpointID, threadID)
	cancel()
	if err != nil {
		return StopThreadResponse{}, stopExecutionError("recovering queued turns", err)
	}
	a.mgr.svc.broadcastThreadSummary(endpointID, threadID)
	resp := StopThreadResponse{OK: true, RecoveredFollowups: make([]FollowupItemView, 0, len(recovered))}
	for i, rec := range recovered {
		view, err := a.mgr.svc.followupRecordView(ctx, rec, i+1)
		if err != nil {
			return StopThreadResponse{}, fmt.Errorf("decode recovered followup %q: %w", rec.QueueID, err)
		}
		resp.RecoveredFollowups = append(resp.RecoveredFollowups, view)
	}
	return resp, nil
}
