package codeapp

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sync"
	"sync/atomic"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/codeapp/appserver"
	"github.com/floegence/redeven/internal/logsafe"
)

type aiServiceFactory func(context.Context, ai.Options) (*ai.Service, error)
type aiServiceCloser func(*ai.Service) error

type aiServiceGeneration struct {
	id       uint64
	service  *ai.Service
	ctx      context.Context
	cancel   context.CancelFunc
	leases   int
	draining bool
	drained  chan struct{}
}

type aiReadinessController struct {
	mu sync.Mutex

	ctx           context.Context
	cancel        context.CancelFunc
	opts          ai.Options
	optsRevision  uint64
	scopeRevision uint64
	create        aiServiceFactory
	close         aiServiceCloser
	reconcile     func(context.Context, *ai.Service) (int, error)

	snapshot      appserver.AIReadinessSnapshot
	current       *aiServiceGeneration
	nextID        uint64
	attemptCancel context.CancelFunc
	stopRequested bool
	running       bool
	closed        bool
	terminalErr   error

	workers     sync.WaitGroup
	closeOnce   sync.Once
	closeDone   chan struct{}
	closeResult error

	maxStartupRetries     int
	startupRetryDelay     func(int) time.Duration
	startupTraceID        string
	startupPhase          string
	startupStartedAt      time.Time
	startupPhaseStartedAt time.Time
}

var readinessTraceSequence uint64

func newAIReadinessController(parent context.Context, opts ai.Options, create aiServiceFactory, closeService aiServiceCloser) *aiReadinessController {
	if create == nil {
		create = ai.NewServiceContext
	}
	if closeService == nil {
		closeService = func(service *ai.Service) error {
			if service == nil {
				return nil
			}
			return service.Close()
		}
	}
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	controller := &aiReadinessController{
		ctx: ctx, cancel: cancel, opts: opts, optsRevision: 1, scopeRevision: filesystemScopeRevision(opts.FilesystemScope), create: create, close: closeService,
		snapshot:          appserver.AIReadinessSnapshot{State: appserver.AIReadinessUnavailable},
		closeDone:         make(chan struct{}),
		maxStartupRetries: 5,
		startupRetryDelay: defaultStartupRetryDelay,
	}
	controller.reconcile = func(ctx context.Context, service *ai.Service) (int, error) {
		return service.ReconcileCanonicalRootOwnership(ctx)
	}
	controller.opts.StoreStartupProgress = controller.observeStoreStartupPhase
	controller.opts.StoreStartupWorkProgress = controller.observeStoreStartupWork
	controller.opts.DeferExecution = true
	go func() {
		<-ctx.Done()
		_ = controller.Close()
	}()
	return controller
}

func defaultStartupRetryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	base := 250 * time.Millisecond
	for i := 1; i < attempt && base < 3*time.Second; i++ {
		base *= 2
	}
	if base > 3*time.Second {
		base = 3 * time.Second
	}
	// A small time-based jitter prevents multiple runtimes recovering in lockstep.
	jitter := time.Duration(time.Now().UnixNano() % int64(base/4+1))
	return base + jitter
}

func newReadinessTraceID() string {
	return fmt.Sprintf("ai-start-%x", atomic.AddUint64(&readinessTraceSequence, 1))
}

func (c *aiReadinessController) Start() {
	if c == nil {
		return
	}
	_ = c.startAttempt()
}

func (c *aiReadinessController) RetryAIReadiness() error {
	if c == nil {
		return appserver.ErrAIServiceUnavailable
	}
	c.mu.Lock()
	if c.closed || c.terminalErr != nil {
		c.mu.Unlock()
		return appserver.ErrAIServiceUnavailable
	}
	if c.running {
		c.mu.Unlock()
		return appserver.ErrAIRetryInProgress
	}
	if c.snapshot.State == appserver.AIReadinessDegraded && c.current != nil && !c.current.draining && c.current.service != nil {
		c.running = true
		generation := c.current
		generation.leases++
		c.workers.Add(1)
		c.mu.Unlock()
		go c.runDegradedRecheck(generation)
		return nil
	}
	c.mu.Unlock()
	return c.startAttempt()
}

// StopAIReadiness cancels preparation, then waits for its owner to roll back and
// close before a new attempt can start. Repeated requests are idempotent.
func (c *aiReadinessController) StopAIReadiness() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || c.terminalErr != nil {
		return appserver.ErrAIServiceUnavailable
	}
	if c.stopRequested || c.snapshot.State == appserver.AIReadinessStopped {
		return nil
	}
	if !c.running || c.attemptCancel == nil || !c.snapshot.Stoppable {
		return appserver.ErrAIServiceUnavailable
	}
	c.stopRequested = true
	c.snapshot = appserver.AIReadinessSnapshot{State: appserver.AIReadinessStopping, TraceID: c.startupTraceID, StartupPhase: c.startupPhase}
	c.attemptCancel()
	return nil
}

func (c *aiReadinessController) finishAttempt() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.attemptCancel != nil {
		c.attemptCancel()
		c.attemptCancel = nil
	}
	c.running = false
	if c.stopRequested && !c.closed && c.terminalErr == nil {
		c.snapshot = appserver.AIReadinessSnapshot{State: appserver.AIReadinessStopped, TraceID: c.startupTraceID, StartupPhase: c.startupPhase}
	}
}

func (c *aiReadinessController) runDegradedRecheck(generation *aiServiceGeneration) {
	defer c.workers.Done()
	defer c.releaseGenerationLease(generation)
	issueCount, err := c.reconcile(generation.ctx, generation.service)
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || c.current != generation || generation.draining {
		c.running = false
		return
	}
	if err != nil {
		// A maintenance recheck is observational. Its failure must not revoke the
		// still-valid service generation or pretend that the orphan was repaired.
		c.running = false
		return
	}
	c.snapshot = aiReadinessSnapshotForIssueCount(issueCount)
	c.running = false
}

func (c *aiReadinessController) ReviewOrphanCanonicalRoots(ctx context.Context) (ai.OrphanCanonicalRootReview, error) {
	service, leaseCtx, generation, release, err := c.AcquireAIService(ctx)
	if err != nil {
		return ai.OrphanCanonicalRootReview{}, err
	}
	defer release()
	review, err := service.ReviewOrphanCanonicalRoots(leaseCtx)
	if err != nil {
		return ai.OrphanCanonicalRootReview{}, err
	}
	c.applyAIReadinessIssueCount(generation, service, review.IssueCount)
	return review, nil
}

func (c *aiReadinessController) AdoptOrphanCanonicalRoot(ctx context.Context, req ai.AdoptOrphanCanonicalRootRequest) (int, error) {
	service, leaseCtx, generation, release, err := c.AcquireAIService(ctx)
	if err != nil {
		return 0, err
	}
	defer release()
	issueCount, err := service.AdoptOrphanCanonicalRoot(leaseCtx, req)
	if err != nil {
		return 0, err
	}
	c.applyAIReadinessIssueCount(generation, service, issueCount)
	return issueCount, nil
}

func (c *aiReadinessController) DeleteOrphanCanonicalRoot(ctx context.Context, req ai.DeleteOrphanCanonicalRootRequest) (int, error) {
	service, leaseCtx, generation, release, err := c.AcquireAIService(ctx)
	if err != nil {
		return 0, err
	}
	defer release()
	issueCount, err := service.DeleteOrphanCanonicalRoot(leaseCtx, req)
	if err != nil {
		return 0, err
	}
	c.applyAIReadinessIssueCount(generation, service, issueCount)
	return issueCount, nil
}

func (c *aiReadinessController) applyAIReadinessIssueCount(generationID uint64, service *ai.Service, issueCount int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || c.current == nil || c.current.id != generationID || c.current.service != service || c.current.draining {
		return
	}
	c.snapshot = aiReadinessSnapshotForIssueCount(issueCount)
}

func (c *aiReadinessController) startAttempt() error {
	return c.startAttemptWithRestore("")
}

func (c *aiReadinessController) ListFlowerSnapshots(ctx context.Context) ([]ai.FlowerSnapshotSummary, error) {
	c.mu.Lock()
	state := c.opts.StateDir
	c.mu.Unlock()
	return ai.ListFlowerSnapshots(ctx, state)
}

func (c *aiReadinessController) RestoreFlowerSnapshot(id string) error {
	c.mu.Lock()
	state := c.opts.StateDir
	c.mu.Unlock()
	if err := ai.CheckFlowerSnapshot(c.ctx, state, id); err != nil {
		return err
	}
	return c.startAttemptWithRestore(id)
}

func (c *aiReadinessController) startAttemptWithRestore(restoreID string) error {
	c.mu.Lock()
	if c.closed || c.terminalErr != nil {
		c.mu.Unlock()
		return appserver.ErrAIServiceUnavailable
	}
	if c.running {
		c.mu.Unlock()
		return appserver.ErrAIRetryInProgress
	}
	c.running = true
	c.stopRequested = false
	attemptCtx, attemptCancel := context.WithCancel(c.ctx)
	c.attemptCancel = attemptCancel
	previous := c.current
	c.current = nil
	if previous != nil {
		previous.draining = true
		previous.cancel()
		if previous.leases == 0 {
			close(previous.drained)
		}
	}
	c.snapshot = appserver.AIReadinessSnapshot{State: appserver.AIReadinessInspecting, Stoppable: true}
	if restoreID != "" {
		c.snapshot.State = appserver.AIReadinessRestoring
	}
	c.startupTraceID = newReadinessTraceID()
	c.startupPhase = ""
	c.startupStartedAt = time.Now()
	c.startupPhaseStartedAt = c.startupStartedAt
	c.logStartupPhaseLocked(string(c.snapshot.State))
	c.snapshot.TraceID, c.snapshot.StartupPhase = c.startupTraceID, c.startupPhase
	c.workers.Add(1)
	c.mu.Unlock()

	go c.runAttempt(attemptCtx, previous, restoreID)
	return nil
}

func (c *aiReadinessController) runAttempt(attemptCtx context.Context, previous *aiServiceGeneration, restoreID string) {
	defer c.workers.Done()
	defer c.finishAttempt()
	if previous != nil {
		select {
		case <-previous.drained:
		case <-attemptCtx.Done():
			<-previous.drained
		}
		if err := c.close(previous.service); err != nil {
			c.finishCloseFailure(err)
			return
		}
	}

	if restoreID != "" {
		c.mu.Lock()
		opts := c.opts
		c.mu.Unlock()
		if err := ai.RestoreFlowerSnapshot(attemptCtx, opts, restoreID); err != nil {
			if errors.Is(err, ai.ErrFlowerGenerationClose) {
				c.finishCloseFailure(err)
				return
			}
			c.finishFailure(err)
			return
		}
	}
	retryAttempt := 0
	for {
		c.setTransientState(appserver.AIReadinessInspecting)
		c.mu.Lock()
		opts := c.opts
		revision := c.optsRevision
		c.mu.Unlock()

		service, err := c.create(attemptCtx, opts)
		if err != nil {
			if errors.Is(err, ai.ErrFlowerGenerationClose) {
				c.finishCloseFailure(err)
				return
			}
			var startupErr *ai.FloretStoreStartupError
			if attemptCtx.Err() == nil && errors.As(err, &startupErr) && isAutomaticStartupRecovery(startupErr) && retryAttempt < c.maxStartupRetries {
				retryAttempt++
				delay := c.startupRetryDelay(retryAttempt)
				c.setRecovering(startupErr)
				c.logStartupRetry(startupErr, retryAttempt, delay)
				if !waitForStartupRetry(attemptCtx, delay) {
					return
				}
				continue
			}
			c.finishFailure(err)
			return
		}
		if service == nil {
			c.finishFailure(errors.New("AI service factory returned no service"))
			return
		}

		c.mu.Lock()
		closed := c.closed || attemptCtx.Err() != nil
		stale := revision != c.optsRevision
		if !closed && !stale {
			if err := service.Activate(attemptCtx); err != nil {
				c.mu.Unlock()
				if closeErr := c.close(service); closeErr != nil {
					c.finishCloseFailure(closeErr)
				} else {
					c.finishFailure(err)
				}
				return
			}
			c.nextID++
			generationCtx, generationCancel := context.WithCancel(c.ctx)
			c.current = &aiServiceGeneration{
				id: c.nextID, service: service, ctx: generationCtx, cancel: generationCancel,
				drained: make(chan struct{}),
			}
			c.snapshot = aiReadinessSnapshotForIssueCount(service.OrphanCanonicalRootIssueCount())
			c.logStartupPhaseLocked(string(c.snapshot.State))
			if c.opts.Logger != nil {
				c.opts.Logger.Info("ai: service startup complete", "trace_id", c.startupTraceID, "state", c.snapshot.State, "duration_ms", time.Since(c.startupStartedAt).Milliseconds())
			}
			c.mu.Unlock()
			return
		}
		c.mu.Unlock()

		if err := c.close(service); err != nil {
			c.finishCloseFailure(err)
			return
		}
		if closed {
			return
		}
	}
}

func isAutomaticStartupRecovery(startupErr *ai.FloretStoreStartupError) bool {
	if startupErr == nil || !startupErr.Retryable || !startupErr.SafeToRetry {
		return false
	}
	return startupErr.Class == ai.FloretStoreStartupTemporarilyBlocked
}

func (c *aiReadinessController) observeStoreStartupPhase(phase ai.FloretStoreStartupPhase) {
	var state appserver.AIReadinessState
	switch phase {
	case ai.FloretStoreStartupBackingUp:
		state = appserver.AIReadinessBackingUp
	case ai.FloretStoreStartupRestoring:
		state = appserver.AIReadinessRestoring
	case ai.FloretStoreStartupOptimizing:
		state = appserver.AIReadinessOptimizing
	case ai.FloretStoreStartupMigrating:
		state = appserver.AIReadinessMigrating
	case ai.FloretStoreStartupIndexing:
		state = appserver.AIReadinessIndexing
	case ai.FloretStoreStartupPreparing:
		state = appserver.AIReadinessPreparing
	case ai.FloretStoreStartupVerifying:
		state = appserver.AIReadinessVerifying
	case ai.FloretStoreStartupInspecting:
		state = appserver.AIReadinessInspecting
	case ai.FloretStoreStartupRecovering:
		state = appserver.AIReadinessRecovering
	default:
		return
	}
	c.setTransientState(state)
}

func (c *aiReadinessController) setTransientState(state appserver.AIReadinessState) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || !c.running || c.stopRequested {
		return
	}
	c.logStartupPhaseLocked(string(state))
	c.snapshot = appserver.AIReadinessSnapshot{
		State: state, TraceID: c.startupTraceID, StartupPhase: c.startupPhase, Stoppable: true,
	}
}

func (c *aiReadinessController) setRecovering(startupErr *ai.FloretStoreStartupError) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || !c.running || c.stopRequested {
		return
	}
	c.logStartupPhaseLocked(string(ai.FloretStoreStartupRecovering))
	snapshot := appserver.AIReadinessSnapshot{
		State: appserver.AIReadinessRecovering, TraceID: c.startupTraceID, Stoppable: true,
		StartupPhase: string(ai.FloretStoreStartupRecovering), RetryReason: "temporary_store_open",
	}
	if startupErr != nil {
		snapshot.ReasonCode = string(startupErr.Class)
		snapshot.Retryable = startupErr.Retryable
		snapshot.SafeToRetry = startupErr.SafeToRetry
	}
	c.snapshot = snapshot
}

func (c *aiReadinessController) observeStoreStartupWork(work flruntime.StartupWork) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || !c.running || c.stopRequested {
		return
	}
	if string(c.snapshot.State) != string(work.Phase) {
		return
	}
	c.snapshot.WorkCompleted, c.snapshot.WorkTotal = work.Completed, work.Total
}

// Timings follow the existing phase transitions; no timer or parallel lifecycle
// advances readiness independently of the controller.
func (c *aiReadinessController) logStartupPhaseLocked(next string) {
	if next == c.startupPhase {
		return
	}
	now := time.Now()
	if c.startupPhase != "" && c.opts.Logger != nil {
		c.opts.Logger.Info("ai: service startup phase complete", "trace_id", c.startupTraceID, "startup_phase", c.startupPhase,
			"duration_ms", now.Sub(c.startupPhaseStartedAt).Milliseconds(), "elapsed_ms", now.Sub(c.startupStartedAt).Milliseconds())
	}
	c.startupPhase = next
	c.startupPhaseStartedAt = now
}

func (c *aiReadinessController) logStartupRetry(startupErr *ai.FloretStoreStartupError, attempt int, delay time.Duration) {
	if c == nil || c.opts.Logger == nil || startupErr == nil {
		return
	}
	c.mu.Lock()
	traceID := c.startupTraceID
	c.mu.Unlock()
	c.opts.Logger.Warn("ai: service startup recovering",
		"trace_id", traceID,
		"startup_phase", ai.FloretStoreStartupRecovering,
		"classification", startupErr.Class,
		"retry_reason", "temporary_store_open",
		"retry_attempt", attempt,
		"retry_delay", delay,
		"error", startupErr.Unwrap(),
	)
}

func waitForStartupRetry(ctx context.Context, delay time.Duration) bool {
	if delay <= 0 {
		select {
		case <-ctx.Done():
			return false
		default:
			return true
		}
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
		return true
	case <-ctx.Done():
		return false
	}
}

func (c *aiReadinessController) finishFailure(err error) {
	if c == nil {
		return
	}
	snapshot := appserver.AIReadinessSnapshot{
		State:      appserver.AIReadinessBlocked,
		ReasonCode: appserver.AIServiceStartupErrorReasonCode,
	}
	c.mu.Lock()
	snapshot.TraceID = c.startupTraceID
	snapshot.StartupPhase = c.startupPhase
	elapsed := time.Since(c.startupStartedAt).Milliseconds()
	phaseElapsed := time.Since(c.startupPhaseStartedAt).Milliseconds()
	c.mu.Unlock()
	var startupErr *ai.FloretStoreStartupError
	if errors.As(err, &startupErr) {
		snapshot.Component = startupErr.Component
		if startupErr.Phase != "" {
			snapshot.StartupPhase = startupErr.Phase
		}
		snapshot.ReasonCode = string(startupErr.Class)
		snapshot.Retryable = startupErr.Retryable
		snapshot.SafeToRetry = startupErr.SafeToRetry
		if isAutomaticStartupRecovery(startupErr) {
			snapshot.RetryReason = "retry_window_exhausted"
		} else {
			snapshot.RetryReason = "non_retryable_startup_error"
		}
	} else {
		snapshot.RetryReason = "service_construction_failed"
	}
	if c.opts.Logger != nil && err != nil {
		cause := err
		if startupErr != nil && startupErr.Unwrap() != nil {
			cause = startupErr.Unwrap()
		}
		c.opts.Logger.Error("ai: service startup failed",
			"trace_id", logsafe.Text(snapshot.TraceID, 256),
			"startup_phase", logsafe.Text(snapshot.StartupPhase, 256),
			"classification", logsafe.Text(snapshot.ReasonCode, 256),
			"retry_reason", logsafe.Text(snapshot.RetryReason, 256),
			"duration_ms", elapsed,
			"phase_duration_ms", phaseElapsed,
			"error", logsafe.Error(cause),
		)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || c.stopRequested {
		return
	}
	c.snapshot = snapshot
}

func (c *aiReadinessController) finishCloseFailure(err error) {
	if err == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.terminalErr = errors.Join(c.terminalErr, err)
	c.running = false
	if !c.closed {
		c.snapshot = appserver.AIReadinessSnapshot{
			State:        appserver.AIReadinessBlocked,
			ReasonCode:   appserver.AIGenerationCloseFailedReasonCode,
			TraceID:      c.startupTraceID,
			StartupPhase: c.startupPhase,
		}
	}
}

func (c *aiReadinessController) UpdateAIServiceStartupOptions(next appserver.AIServiceStartupOptions) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	if reflect.DeepEqual(c.opts.Config, next.Config) &&
		c.opts.AgentHomeDir == next.AgentHomeDir &&
		c.opts.Shell == next.Shell &&
		c.opts.FilesystemScope == next.FilesystemScope &&
		c.scopeRevision == filesystemScopeRevision(next.FilesystemScope) {
		return
	}
	c.opts.Config = next.Config
	c.opts.AgentHomeDir = next.AgentHomeDir
	c.opts.Shell = next.Shell
	c.opts.FilesystemScope = next.FilesystemScope
	c.scopeRevision = filesystemScopeRevision(next.FilesystemScope)
	c.optsRevision++
}

func filesystemScopeRevision(scope interface{ Revision() uint64 }) uint64 {
	if scope == nil {
		return 0
	}
	return scope.Revision()
}

func (c *aiReadinessController) AcquireAIService(ctx context.Context) (*ai.Service, context.Context, uint64, func(), error) {
	if c == nil {
		return nil, nil, 0, nil, appserver.ErrAIServiceUnavailable
	}
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-ctx.Done():
		return nil, nil, 0, nil, ctx.Err()
	default:
	}
	c.mu.Lock()
	generation := c.current
	if c.closed || (c.snapshot.State != appserver.AIReadinessReady && c.snapshot.State != appserver.AIReadinessDegraded) || generation == nil || generation.draining || generation.service == nil {
		c.mu.Unlock()
		return nil, nil, 0, nil, appserver.ErrAIServiceUnavailable
	}
	generation.leases++
	c.mu.Unlock()
	leaseCtx, cancelLease := context.WithCancel(ctx)
	stopGenerationCancel := context.AfterFunc(generation.ctx, cancelLease)

	var once sync.Once
	release := func() {
		once.Do(func() {
			stopGenerationCancel()
			cancelLease()
			c.releaseGenerationLease(generation)
		})
	}
	return generation.service, leaseCtx, generation.id, release, nil
}

func (c *aiReadinessController) releaseGenerationLease(generation *aiServiceGeneration) {
	if c == nil || generation == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if generation.leases <= 0 {
		return
	}
	generation.leases--
	if generation.draining && generation.leases == 0 {
		close(generation.drained)
	}
}

func aiReadinessSnapshotForIssueCount(issueCount int) appserver.AIReadinessSnapshot {
	if issueCount <= 0 {
		return appserver.AIReadinessSnapshot{State: appserver.AIReadinessReady}
	}
	return appserver.AIReadinessSnapshot{
		State: appserver.AIReadinessDegraded, ReasonCode: appserver.AIHostThreadSettingsMissingReasonCode, IssueCount: issueCount,
	}
}

func (c *aiReadinessController) AIReadiness() appserver.AIReadinessSnapshot {
	if c == nil {
		return appserver.AIReadinessSnapshot{State: appserver.AIReadinessUnavailable}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.snapshot
}

func (c *aiReadinessController) Close() error {
	if c == nil {
		return nil
	}
	c.closeOnce.Do(func() {
		c.closeResult = c.shutdown()
		close(c.closeDone)
	})
	<-c.closeDone
	return c.closeResult
}

func (c *aiReadinessController) shutdown() error {
	c.mu.Lock()
	c.closed = true
	c.cancel()
	current := c.current
	c.current = nil
	c.snapshot = appserver.AIReadinessSnapshot{State: appserver.AIReadinessUnavailable}
	if current != nil {
		current.draining = true
		current.cancel()
		if current.leases == 0 {
			close(current.drained)
		}
	}
	c.mu.Unlock()

	if current != nil {
		<-current.drained
		if err := c.close(current.service); err != nil {
			c.finishCloseFailure(err)
		}
	}
	c.workers.Wait()
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.terminalErr
}
