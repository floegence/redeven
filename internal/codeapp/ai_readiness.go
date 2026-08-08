package codeapp

import (
	"context"
	"errors"
	"reflect"
	"sync"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/codeapp/appserver"
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

	snapshot    appserver.AIReadinessSnapshot
	current     *aiServiceGeneration
	nextID      uint64
	running     bool
	closed      bool
	terminalErr error

	workers     sync.WaitGroup
	closeOnce   sync.Once
	closeDone   chan struct{}
	closeResult error
}

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
		snapshot:  appserver.AIReadinessSnapshot{State: appserver.AIReadinessUnavailable},
		closeDone: make(chan struct{}),
	}
	controller.reconcile = func(ctx context.Context, service *ai.Service) (int, error) {
		return service.ReconcileCanonicalRootOwnership(ctx)
	}
	controller.opts.StoreStartupProgress = controller.observeStoreStartupPhase
	go func() {
		<-ctx.Done()
		_ = controller.Close()
	}()
	return controller
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
	previous := c.current
	c.current = nil
	if previous != nil {
		previous.draining = true
		previous.cancel()
		if previous.leases == 0 {
			close(previous.drained)
		}
	}
	c.snapshot = appserver.AIReadinessSnapshot{State: appserver.AIReadinessUnavailable}
	c.workers.Add(1)
	c.mu.Unlock()

	go c.runAttempt(previous)
	return nil
}

func (c *aiReadinessController) runAttempt(previous *aiServiceGeneration) {
	defer c.workers.Done()
	if previous != nil {
		select {
		case <-previous.drained:
		case <-c.ctx.Done():
			<-previous.drained
		}
		if err := c.close(previous.service); err != nil {
			c.finishCloseFailure(err)
			return
		}
	}

	for {
		c.setTransientState(appserver.AIReadinessInspecting)
		c.mu.Lock()
		opts := c.opts
		revision := c.optsRevision
		c.mu.Unlock()

		service, err := c.create(c.ctx, opts)
		if err != nil {
			c.finishFailure(err)
			return
		}
		if service == nil {
			c.finishFailure(errors.New("AI service factory returned no service"))
			return
		}

		c.mu.Lock()
		closed := c.closed || c.ctx.Err() != nil
		stale := revision != c.optsRevision
		if !closed && !stale {
			c.nextID++
			generationCtx, generationCancel := context.WithCancel(c.ctx)
			c.current = &aiServiceGeneration{
				id: c.nextID, service: service, ctx: generationCtx, cancel: generationCancel,
				drained: make(chan struct{}),
			}
			c.snapshot = aiReadinessSnapshotForIssueCount(service.OrphanCanonicalRootIssueCount())
			c.running = false
			c.mu.Unlock()
			return
		}
		if closed {
			c.running = false
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

func (c *aiReadinessController) observeStoreStartupPhase(phase ai.FloretStoreStartupPhase) {
	var state appserver.AIReadinessState
	switch phase {
	case ai.FloretStoreStartupVerifying:
		state = appserver.AIReadinessVerifying
	case ai.FloretStoreStartupInspecting:
		state = appserver.AIReadinessInspecting
	default:
		return
	}
	c.setTransientState(state)
}

func (c *aiReadinessController) setTransientState(state appserver.AIReadinessState) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || !c.running {
		return
	}
	c.snapshot = appserver.AIReadinessSnapshot{State: state}
}

func (c *aiReadinessController) finishFailure(err error) {
	if c != nil && c.opts.Logger != nil && err != nil {
		c.opts.Logger.Error("ai: service startup failed", "error", err)
	}
	snapshot := appserver.AIReadinessSnapshot{
		State:      appserver.AIReadinessBlocked,
		ReasonCode: appserver.AIServiceStartupErrorReasonCode,
	}
	var startupErr *ai.FloretStoreStartupError
	if errors.As(err, &startupErr) {
		snapshot.ReasonCode = string(startupErr.Class)
		snapshot.Retryable = startupErr.Retryable
		snapshot.SafeToRetry = startupErr.SafeToRetry
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		c.running = false
		return
	}
	c.snapshot = snapshot
	c.running = false
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
			State:      appserver.AIReadinessBlocked,
			ReasonCode: appserver.AIServiceStartupErrorReasonCode,
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
