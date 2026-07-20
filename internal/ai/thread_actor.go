package ai

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

// threadManager provides per-thread serialization without blocking unrelated threads.
//
// It intentionally does not cap the number of concurrent threads. Actors are created on demand and
// are garbage-collected after an idle timeout.
type threadManager struct {
	svc *Service

	mu             sync.Mutex
	actors         map[string]*threadActor // thread_key -> actor
	lifecycleGates map[string]*threadLifecycleGate
	closed         bool
}

type threadLifecycleGate struct {
	mu              sync.Mutex
	cond            *sync.Cond
	readers         int
	writer          bool
	waitingWriters  int
	joinAllChildren int
	joinChildren    map[string]int
	refs            int
}

type threadEffectJoin struct {
	childThreadID string
	allChildren   bool
}

type threadEffectGateRequest struct {
	authorityThreadID string
	executionThreadID string
	join              threadEffectJoin
}

func newThreadLifecycleGate() *threadLifecycleGate {
	gate := &threadLifecycleGate{joinChildren: make(map[string]int)}
	gate.cond = sync.NewCond(&gate.mu)
	return gate
}

func (g *threadLifecycleGate) lock(shared bool, request threadEffectGateRequest) {
	g.mu.Lock()
	if shared {
		for g.writer || (g.waitingWriters > 0 && !g.canJoinActiveCohort(request)) {
			g.cond.Wait()
		}
		g.readers++
		g.addJoinScope(request.join)
	} else {
		g.waitingWriters++
		for g.writer || g.readers > 0 {
			g.cond.Wait()
		}
		g.waitingWriters--
		g.writer = true
	}
	g.mu.Unlock()
}

func (g *threadLifecycleGate) unlock(shared bool, request threadEffectGateRequest) {
	g.mu.Lock()
	if shared {
		g.readers--
		g.removeJoinScope(request.join)
	} else {
		g.writer = false
	}
	g.cond.Broadcast()
	g.mu.Unlock()
}

func (g *threadLifecycleGate) canJoinActiveCohort(request threadEffectGateRequest) bool {
	if g.readers <= 0 || request.executionThreadID == "" || request.executionThreadID == request.authorityThreadID {
		return false
	}
	return g.joinAllChildren > 0 || g.joinChildren[request.executionThreadID] > 0
}

func (g *threadLifecycleGate) addJoinScope(join threadEffectJoin) {
	if join.allChildren {
		g.joinAllChildren++
	}
	if join.childThreadID != "" {
		g.joinChildren[join.childThreadID]++
	}
}

func (g *threadLifecycleGate) removeJoinScope(join threadEffectJoin) {
	if join.allChildren {
		g.joinAllChildren--
	}
	if join.childThreadID != "" {
		g.joinChildren[join.childThreadID]--
		if g.joinChildren[join.childThreadID] <= 0 {
			delete(g.joinChildren, join.childThreadID)
		}
	}
}

func newThreadManager(svc *Service) *threadManager {
	return &threadManager{
		svc:            svc,
		actors:         make(map[string]*threadActor),
		lifecycleGates: make(map[string]*threadLifecycleGate),
	}
}

func (m *threadManager) lockThreadLifecycle(endpointID string, threadID string) (func(), error) {
	return m.lockThreadGate(endpointID, threadID, false, threadEffectGateRequest{})
}

// lockThreadEffect shares one authority gate across concurrent effects while
// lifecycle mutations remain exclusive. This lets parent and child effects make
// progress together without allowing delete, fork, or permission changes to
// cross an in-flight effect boundary.
func (m *threadManager) lockThreadEffect(endpointID string, authorityThreadID string, executionThreadID string, join threadEffectJoin) (func(), error) {
	authorityThreadID = strings.TrimSpace(authorityThreadID)
	executionThreadID = strings.TrimSpace(executionThreadID)
	join.childThreadID = strings.TrimSpace(join.childThreadID)
	if authorityThreadID == "" || executionThreadID == "" {
		return nil, errors.New("invalid thread effect authority")
	}
	if join.allChildren && join.childThreadID != "" {
		return nil, errors.New("invalid thread effect join scope")
	}
	if join.childThreadID == authorityThreadID {
		return nil, errors.New("invalid thread effect child scope")
	}
	return m.lockThreadGate(endpointID, authorityThreadID, true, threadEffectGateRequest{
		authorityThreadID: authorityThreadID,
		executionThreadID: executionThreadID,
		join:              join,
	})
}

func (m *threadManager) lockThreadGate(endpointID string, threadID string, shared bool, request threadEffectGateRequest) (func(), error) {
	if m == nil {
		return nil, errors.New("thread manager not ready")
	}
	key := runThreadKey(endpointID, threadID)
	if key == "" {
		return nil, errors.New("invalid thread identity")
	}
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return nil, errors.New("thread manager closed")
	}
	gate := m.lifecycleGates[key]
	if gate == nil {
		gate = newThreadLifecycleGate()
		m.lifecycleGates[key] = gate
	}
	gate.refs++
	m.mu.Unlock()

	gate.lock(shared, request)
	var once sync.Once
	return func() {
		once.Do(func() {
			gate.unlock(shared, request)
			m.mu.Lock()
			gate.refs--
			if gate.refs == 0 && m.lifecycleGates[key] == gate {
				delete(m.lifecycleGates, key)
			}
			m.mu.Unlock()
		})
	}, nil
}

func (m *threadManager) Get(endpointID string, threadID string) *threadActor {
	if m == nil {
		return nil
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	key := runThreadKey(endpointID, threadID)
	if key == "" {
		return nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil
	}

	if a := m.actors[key]; a != nil && a.alive() {
		return a
	}

	a := newThreadActor(m, key, endpointID, threadID)
	m.actors[key] = a
	a.start()
	return a
}

func (m *threadManager) Wake(endpointID string, threadID string) {
	if m == nil {
		return
	}
	actor := m.Get(endpointID, threadID)
	if actor == nil {
		return
	}
	actor.wakeMaybeStartQueuedTurn()
}

func (m *threadManager) remove(key string, actor *threadActor) {
	if m == nil || strings.TrimSpace(key) == "" || actor == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if existing := m.actors[key]; existing == actor {
		delete(m.actors, key)
	}
}

func (m *threadManager) Close() {
	if m == nil {
		return
	}
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return
	}
	m.closed = true

	actors := make([]*threadActor, 0, len(m.actors))
	for _, a := range m.actors {
		if a != nil {
			actors = append(actors, a)
		}
	}
	m.actors = make(map[string]*threadActor)
	m.mu.Unlock()

	for _, a := range actors {
		a.stop()
	}
}

type cmdSendUserTurn struct {
	ctx  context.Context
	meta *session.Meta
	req  SendUserTurnRequest
	resp chan sendUserTurnResult
}

type sendUserTurnResult struct {
	resp SendUserTurnResponse
	err  error
}

type cmdCompactThreadContext struct {
	ctx  context.Context
	meta *session.Meta
	req  CompactThreadContextRequest
	resp chan compactThreadContextResult
}

type compactThreadContextResult struct {
	resp CompactThreadContextResponse
	err  error
}

type cmdSubmitRequestUserInputResponse struct {
	ctx  context.Context
	meta *session.Meta
	req  SubmitRequestUserInputResponseRequest
	resp chan submitRequestUserInputResponseResult
}

type submitRequestUserInputResponseResult struct {
	resp SubmitRequestUserInputResponseResponse
	err  error
}

type cmdMaybeStartQueuedTurn struct{}

type threadActor struct {
	mgr *threadManager
	key string

	endpointID string
	threadID   string

	inbox  chan any
	stopCh chan struct{}
	doneCh chan struct{}

	once sync.Once
}

func newThreadActor(mgr *threadManager, key string, endpointID string, threadID string) *threadActor {
	return &threadActor{
		mgr:        mgr,
		key:        strings.TrimSpace(key),
		endpointID: strings.TrimSpace(endpointID),
		threadID:   strings.TrimSpace(threadID),
		inbox:      make(chan any, 128),
		stopCh:     make(chan struct{}),
		doneCh:     make(chan struct{}),
	}
}

func (a *threadActor) alive() bool {
	if a == nil {
		return false
	}
	select {
	case <-a.doneCh:
		return false
	default:
		return true
	}
}

func (a *threadActor) start() {
	if a == nil {
		return
	}
	go a.loop()
}

func (a *threadActor) stop() {
	if a == nil {
		return
	}
	a.once.Do(func() {
		close(a.stopCh)
	})
	<-a.doneCh
}

func (a *threadActor) wakeMaybeStartQueuedTurn() {
	if a == nil {
		return
	}
	cmd := cmdMaybeStartQueuedTurn{}
	select {
	case <-a.stopCh:
		return
	case a.inbox <- cmd:
		return
	default:
	}
	go func() {
		select {
		case <-a.stopCh:
		case a.inbox <- cmd:
		}
	}()
}

func (a *threadActor) SendUserTurn(ctx context.Context, meta *session.Meta, req SendUserTurnRequest) (SendUserTurnResponse, error) {
	if a == nil {
		return SendUserTurnResponse{}, errors.New("thread actor not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ch := make(chan sendUserTurnResult, 1)
	cmd := cmdSendUserTurn{ctx: ctx, meta: meta, req: req, resp: ch}

	select {
	case <-a.stopCh:
		return SendUserTurnResponse{}, errors.New("thread actor closed")
	case <-ctx.Done():
		return SendUserTurnResponse{}, ctx.Err()
	case a.inbox <- cmd:
	}

	select {
	case <-a.stopCh:
		return SendUserTurnResponse{}, errors.New("thread actor closed")
	case <-ctx.Done():
		return SendUserTurnResponse{}, ctx.Err()
	case res := <-ch:
		return res.resp, res.err
	}
}

func (a *threadActor) CompactThreadContext(ctx context.Context, meta *session.Meta, req CompactThreadContextRequest) (CompactThreadContextResponse, error) {
	if a == nil {
		return CompactThreadContextResponse{}, errors.New("thread actor not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ch := make(chan compactThreadContextResult, 1)
	cmd := cmdCompactThreadContext{ctx: ctx, meta: meta, req: req, resp: ch}

	select {
	case <-a.stopCh:
		return CompactThreadContextResponse{}, errors.New("thread actor closed")
	case <-ctx.Done():
		return CompactThreadContextResponse{}, ctx.Err()
	case a.inbox <- cmd:
	}

	select {
	case <-a.stopCh:
		return CompactThreadContextResponse{}, errors.New("thread actor closed")
	case <-ctx.Done():
		return CompactThreadContextResponse{}, ctx.Err()
	case res := <-ch:
		return res.resp, res.err
	}
}

func (a *threadActor) SubmitRequestUserInputResponse(ctx context.Context, meta *session.Meta, req SubmitRequestUserInputResponseRequest) (SubmitRequestUserInputResponseResponse, error) {
	if a == nil {
		return SubmitRequestUserInputResponseResponse{}, errors.New("thread actor not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ch := make(chan submitRequestUserInputResponseResult, 1)
	cmd := cmdSubmitRequestUserInputResponse{ctx: ctx, meta: meta, req: req, resp: ch}

	select {
	case <-a.stopCh:
		return SubmitRequestUserInputResponseResponse{}, errors.New("thread actor closed")
	case <-ctx.Done():
		return SubmitRequestUserInputResponseResponse{}, ctx.Err()
	case a.inbox <- cmd:
	}

	select {
	case <-a.stopCh:
		return SubmitRequestUserInputResponseResponse{}, errors.New("thread actor closed")
	case <-ctx.Done():
		return SubmitRequestUserInputResponseResponse{}, ctx.Err()
	case res := <-ch:
		return res.resp, res.err
	}
}

func (a *threadActor) loop() {
	defer close(a.doneCh)
	defer func() {
		if a.mgr != nil && strings.TrimSpace(a.key) != "" {
			a.mgr.remove(a.key, a)
		}
	}()

	idleTO := 10 * time.Minute
	idleTimer := time.NewTimer(idleTO)
	defer idleTimer.Stop()

	resetIdle := func() {
		if !idleTimer.Stop() {
			select {
			case <-idleTimer.C:
			default:
			}
		}
		idleTimer.Reset(idleTO)
	}

	for {
		select {
		case <-a.stopCh:
			return
		case <-idleTimer.C:
			// Stop idle actors to avoid leaking goroutines when users create many threads.
			if a.mgr != nil && a.mgr.svc != nil {
				if a.mgr.svc.HasActiveThreadForEndpoint(a.endpointID, a.threadID) {
					resetIdle()
					continue
				}
			}
			return
		case raw := <-a.inbox:
			resetIdle()
			switch cmd := raw.(type) {
			case cmdSendUserTurn:
				resp, err := a.handleSendUserTurn(cmd.ctx, cmd.meta, cmd.req)
				cmd.resp <- sendUserTurnResult{resp: resp, err: err}
			case cmdCompactThreadContext:
				resp, err := a.handleCompactThreadContext(cmd.ctx, cmd.meta, cmd.req)
				cmd.resp <- compactThreadContextResult{resp: resp, err: err}
			case cmdSubmitRequestUserInputResponse:
				resp, err := a.handleSubmitRequestUserInputResponse(cmd.ctx, cmd.meta, cmd.req)
				cmd.resp <- submitRequestUserInputResponseResult{resp: resp, err: err}
			case cmdStopThread:
				resp, err := a.handleStopThread(cmd.ctx, cmd.meta, cmd.req)
				cmd.resp <- stopThreadResult{resp: resp, err: err}
			case cmdMaybeStartQueuedTurn:
				if err := a.handleMaybeStartQueuedTurn(context.Background()); err != nil && a.mgr != nil && a.mgr.svc != nil && a.mgr.svc.log != nil {
					a.mgr.svc.log.Warn("failed to start queued turn", queuedTurnStartLogAttrs(err, strings.TrimSpace(a.endpointID), strings.TrimSpace(a.threadID))...)
				}
			}
		}
	}
}

type queuedTurnStartError struct {
	endpointID         string
	threadID           string
	queueID            string
	messageID          string
	runID              string
	requireSourceQueue bool
	err                error
}

func (e *queuedTurnStartError) Error() string {
	if e == nil || e.err == nil {
		return "queued turn start failed"
	}
	return e.err.Error()
}

func (e *queuedTurnStartError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

func queuedTurnStartLogAttrs(err error, endpointID string, threadID string) []any {
	attrs := []any{
		"endpoint_id", strings.TrimSpace(endpointID),
		"thread_id", strings.TrimSpace(threadID),
	}
	var queuedErr *queuedTurnStartError
	if errors.As(err, &queuedErr) && queuedErr != nil {
		if v := strings.TrimSpace(queuedErr.endpointID); v != "" {
			attrs[1] = v
		}
		if v := strings.TrimSpace(queuedErr.threadID); v != "" {
			attrs[3] = v
		}
		attrs = append(attrs,
			"queue_id", strings.TrimSpace(queuedErr.queueID),
			"message_id", strings.TrimSpace(queuedErr.messageID),
			"run_id", strings.TrimSpace(queuedErr.runID),
			"require_source_queue", queuedErr.requireSourceQueue,
		)
	}
	return append(attrs, "error", err)
}

func (a *threadActor) lookupActiveRun(endpointID string, threadID string) (string, *run) {
	if a == nil || a.mgr == nil || a.mgr.svc == nil {
		return "", nil
	}
	thKey := runThreadKey(endpointID, threadID)
	if thKey == "" {
		return "", nil
	}
	a.mgr.svc.mu.Lock()
	activeRunID := strings.TrimSpace(a.mgr.svc.activeRunByTh[thKey])
	r := (*run)(nil)
	if activeRunID != "" {
		r = a.mgr.svc.runs[activeRunID]
	}
	a.mgr.svc.mu.Unlock()
	if activeRunID == "" || r == nil || r.isDetached() {
		return "", nil
	}
	return activeRunID, r
}

func (a *threadActor) handleMaybeStartQueuedTurn(ctx context.Context) error {
	if a == nil || a.mgr == nil || a.mgr.svc == nil {
		return errors.New("service not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID := strings.TrimSpace(a.endpointID)
	threadID := strings.TrimSpace(a.threadID)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid request")
	}
	if a.mgr.svc.isQueuedDrainSuppressed(endpointID, threadID) {
		return nil
	}
	if activeRunID, _ := a.lookupActiveRun(endpointID, threadID); activeRunID != "" {
		return nil
	}
	if a.mgr.svc.stopFinalizingRunID(endpointID, threadID) != "" {
		return nil
	}
	if a.mgr.svc.idleThreadCompactionRequestID(endpointID, threadID) != "" {
		return nil
	}

	a.mgr.svc.mu.Lock()
	db := a.mgr.svc.threadsDB
	persistTO := a.mgr.svc.persistOpTO
	a.mgr.svc.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}

	tctx, cancel := context.WithTimeout(ctx, persistTO)
	th, err := db.GetThreadSettings(tctx, endpointID, threadID)
	cancel()
	if err != nil {
		return err
	}
	if th == nil {
		return nil
	}
	snapshot, latest, canonicalErr := a.mgr.svc.readCanonicalThreadState(ctx, threadID)
	if canonicalErr != nil {
		return canonicalErr
	}
	waitingPrompt, err := requestUserInputPromptFromFloretTurn(latest)
	if err != nil {
		return err
	}
	if !snapshot.CanAppendMessage || waitingPrompt != nil {
		return nil
	}

	tctx, cancel = context.WithTimeout(ctx, persistTO)
	queued, err := db.ListFollowupsByLane(tctx, endpointID, threadID, threadstore.FollowupLaneQueued, 1)
	cancel()
	if err != nil {
		return err
	}
	if len(queued) == 0 {
		return nil
	}
	rec := queued[0]
	runID := strings.TrimSpace(rec.RunID)
	if runID == "" {
		return errors.New("pending turn command is missing run identity")
	}
	meta, err := queuedTurnRecordToSessionMeta(rec, th.NamespacePublicID)
	if err != nil {
		return err
	}
	startReq, err := queuedTurnRecordToRunStartRequest(rec, th.PermissionType)
	if err != nil {
		return &queuedTurnStartError{
			endpointID:         endpointID,
			threadID:           threadID,
			queueID:            rec.QueueID,
			messageID:          rec.TurnID,
			runID:              runID,
			requireSourceQueue: true,
			err:                err,
		}
	}
	if _, _, err := a.mgr.svc.startUserTurnDetached(ctx, meta, runID, startReq, rec.QueueID); err != nil {
		return &queuedTurnStartError{
			endpointID:         endpointID,
			threadID:           threadID,
			queueID:            rec.QueueID,
			messageID:          rec.TurnID,
			runID:              runID,
			requireSourceQueue: true,
			err:                err,
		}
	}
	return nil
}

func (a *threadActor) handleSendUserTurn(ctx context.Context, meta *session.Meta, req SendUserTurnRequest) (SendUserTurnResponse, error) {
	if a == nil || a.mgr == nil || a.mgr.svc == nil {
		return SendUserTurnResponse{}, errors.New("service not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return SendUserTurnResponse{}, err
	}
	if !a.mgr.svc.Enabled() {
		return SendUserTurnResponse{}, ErrNotConfigured
	}

	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" || endpointID != strings.TrimSpace(a.endpointID) {
		return SendUserTurnResponse{}, errors.New("invalid request")
	}
	threadID := strings.TrimSpace(req.ThreadID)
	if threadID == "" || threadID != strings.TrimSpace(a.threadID) {
		return SendUserTurnResponse{}, errors.New("invalid request")
	}
	expected := strings.TrimSpace(req.ExpectedRunID)
	activeRunID, _ := a.lookupActiveRun(endpointID, threadID)
	if activeRunID != "" && expected != "" && expected != activeRunID {
		return SendUserTurnResponse{}, ErrRunChanged
	}
	finalizingRunID := ""
	if activeRunID == "" {
		finalizingRunID = a.mgr.svc.stopFinalizingRunID(endpointID, threadID)
		if finalizingRunID != "" && expected != "" && expected != finalizingRunID {
			return SendUserTurnResponse{}, ErrRunChanged
		}
	}

	appliedPermissionType := ""
	a.mgr.svc.mu.Lock()
	db := a.mgr.svc.threadsDB
	cfg := a.mgr.svc.cfg
	persistTO := a.mgr.svc.persistOpTO
	a.mgr.svc.mu.Unlock()
	if db == nil {
		return SendUserTurnResponse{}, errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	tctx, cancel := context.WithTimeout(ctx, persistTO)
	th, err := db.GetThreadSettings(tctx, endpointID, threadID)
	cancel()
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	if th == nil {
		return SendUserTurnResponse{}, errors.New("thread not found")
	}
	resolvedModel, err := a.mgr.svc.resolveRunModel(ctx, cfg, req.Model, strings.TrimSpace(th.ModelID), nil)
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	req.Model = resolvedModel.ID
	resolvedPermissionType, err := threadPermissionType(th)
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	_, latest, canonicalErr := a.mgr.svc.readCanonicalThreadState(ctx, threadID)
	if canonicalErr != nil {
		return SendUserTurnResponse{}, canonicalErr
	}
	openPrompt, err := requestUserInputPromptFromFloretTurn(latest)
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	normalizeTurnReasoning := func(options *RunOptions) error {
		if options == nil {
			return nil
		}
		modelID := strings.TrimSpace(req.Model)
		if modelID == "" {
			modelID = strings.TrimSpace(th.ModelID)
		}
		capability, modelDefault, _, err := a.mgr.svc.threadReasoningDefaults(ctx, modelID)
		if err != nil {
			return err
		}
		threadDefault, err := parseStoredReasoningSelection(th.ReasoningSelectionJSON)
		if err != nil {
			return err
		}
		resolved, err := resolveEffectiveReasoning(capability, options.ReasoningSelection, threadDefault, modelDefault)
		if err != nil {
			return reasoningSelectionError(modelID, err)
		}
		options.ReasoningSelection = resolved.Effective
		return nil
	}
	if openPrompt != nil && req.QueueAfterWaitingUser {
		req.Options.PermissionType = permissionTypeString(resolvedPermissionType)
		if err := normalizeTurnReasoning(&req.Options); err != nil {
			return SendUserTurnResponse{}, err
		}
		appliedPermissionType = permissionTypeString(resolvedPermissionType)
		queued, position, err := a.mgr.svc.enqueueQueuedTurn(ctx, meta, req)
		if err != nil {
			return SendUserTurnResponse{}, err
		}
		return SendUserTurnResponse{
			Kind:                  "queued",
			QueueID:               strings.TrimSpace(queued.QueueID),
			QueuePosition:         position,
			AppliedPermissionType: appliedPermissionType,
		}, nil
	}
	if openPrompt != nil {
		return SendUserTurnResponse{}, ErrWaitingUserQueueConflict
	}
	req.Options.PermissionType = permissionTypeString(resolvedPermissionType)
	if err := normalizeTurnReasoning(&req.Options); err != nil {
		return SendUserTurnResponse{}, err
	}
	appliedPermissionType = permissionTypeString(resolvedPermissionType)

	if activeRunID != "" || finalizingRunID != "" {
		queued, position, err := a.mgr.svc.enqueueQueuedTurn(ctx, meta, req)
		if err != nil {
			return SendUserTurnResponse{}, err
		}
		return SendUserTurnResponse{
			Kind:                  "queued",
			QueueID:               strings.TrimSpace(queued.QueueID),
			QueuePosition:         position,
			AppliedPermissionType: appliedPermissionType,
		}, nil
	}
	if a.mgr.svc.idleThreadCompactionRequestID(endpointID, threadID) != "" {
		queued, position, err := a.mgr.svc.enqueueQueuedTurn(ctx, meta, req)
		if err != nil {
			return SendUserTurnResponse{}, err
		}
		return SendUserTurnResponse{
			Kind:                  "queued",
			QueueID:               strings.TrimSpace(queued.QueueID),
			QueuePosition:         position,
			AppliedPermissionType: appliedPermissionType,
		}, nil
	}
	tctx, cancel = context.WithTimeout(ctx, persistTO)
	queuedTurnCount, err := db.CountFollowupsByLane(tctx, endpointID, threadID, threadstore.FollowupLaneQueued)
	cancel()
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	if queuedTurnCount > 0 {
		queued, position, err := a.mgr.svc.enqueueQueuedTurn(ctx, meta, req)
		if err != nil {
			return SendUserTurnResponse{}, err
		}
		return SendUserTurnResponse{
			Kind:                  "queued",
			QueueID:               strings.TrimSpace(queued.QueueID),
			QueuePosition:         position,
			AppliedPermissionType: appliedPermissionType,
		}, nil
	}

	runID, err := NewRunID()
	if err != nil {
		return SendUserTurnResponse{}, err
	}

	startReq := RunStartRequest{
		ThreadID: threadID,
		Model:    strings.TrimSpace(req.Model),
		Input:    req.Input,
		Options:  req.Options,
	}
	if _, _, err := a.mgr.svc.startUserTurnDetached(ctx, meta, runID, startReq, req.SourceFollowupID); err != nil {
		return SendUserTurnResponse{}, err
	}
	return SendUserTurnResponse{
		RunID:                 runID,
		Kind:                  "start",
		AppliedPermissionType: appliedPermissionType,
	}, nil
}

func (a *threadActor) handleSubmitRequestUserInputResponse(ctx context.Context, meta *session.Meta, req SubmitRequestUserInputResponseRequest) (SubmitRequestUserInputResponseResponse, error) {
	if a == nil || a.mgr == nil || a.mgr.svc == nil {
		return SubmitRequestUserInputResponseResponse{}, errors.New("service not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return SubmitRequestUserInputResponseResponse{}, err
	}
	if !a.mgr.svc.Enabled() {
		return SubmitRequestUserInputResponseResponse{}, ErrNotConfigured
	}

	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" || endpointID != strings.TrimSpace(a.endpointID) {
		return SubmitRequestUserInputResponseResponse{}, errors.New("invalid request")
	}
	threadID := strings.TrimSpace(req.ThreadID)
	if threadID == "" || threadID != strings.TrimSpace(a.threadID) {
		return SubmitRequestUserInputResponseResponse{}, errors.New("invalid request")
	}
	expected := strings.TrimSpace(req.ExpectedRunID)
	activeRunID, _ := a.lookupActiveRun(endpointID, threadID)
	if activeRunID != "" && expected != "" && expected != activeRunID {
		return SubmitRequestUserInputResponseResponse{}, ErrRunChanged
	}

	a.mgr.svc.mu.Lock()
	db := a.mgr.svc.threadsDB
	cfg := a.mgr.svc.cfg
	persistTO := a.mgr.svc.persistOpTO
	a.mgr.svc.mu.Unlock()
	if db == nil {
		return SubmitRequestUserInputResponseResponse{}, errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	tctx, cancel := context.WithTimeout(ctx, persistTO)
	th, err := db.GetThreadSettings(tctx, endpointID, threadID)
	cancel()
	if err != nil {
		return SubmitRequestUserInputResponseResponse{}, err
	}
	if th == nil {
		return SubmitRequestUserInputResponseResponse{}, errors.New("thread not found")
	}
	resolvedModel, err := a.mgr.svc.resolveRunModel(ctx, cfg, req.Model, strings.TrimSpace(th.ModelID), nil)
	if err != nil {
		return SubmitRequestUserInputResponseResponse{}, err
	}
	req.Model = resolvedModel.ID
	resolvedPermissionType, err := threadPermissionType(th)
	if err != nil {
		return SubmitRequestUserInputResponseResponse{}, err
	}
	_, latest, canonicalErr := a.mgr.svc.readCanonicalThreadState(ctx, threadID)
	if canonicalErr != nil {
		return SubmitRequestUserInputResponseResponse{}, canonicalErr
	}
	openPrompt, err := requestUserInputPromptFromFloretTurn(latest)
	if err != nil {
		return SubmitRequestUserInputResponseResponse{}, err
	}
	if openPrompt == nil {
		return SubmitRequestUserInputResponseResponse{}, ErrWaitingPromptChanged
	}
	validatedResponse, err := validateRequestUserInputResponse(openPrompt, &req.Response)
	if err != nil {
		return SubmitRequestUserInputResponseResponse{}, err
	}
	responseRecord, secretAnswers, err := buildRequestUserInputResponseRecord(*openPrompt, *validatedResponse, req.Input.MessageID)
	if err != nil {
		return SubmitRequestUserInputResponseResponse{}, err
	}
	req.Input.StructuredResponse = &responseRecord
	req.Input.SecretAnswers = secretAnswers

	req.Options.PermissionType = permissionTypeString(resolvedPermissionType)
	if req.Options.ReasoningSelection.IsZero() {
		req.Options.ReasoningSelection = config.NormalizeAIReasoningSelection(openPrompt.ReasoningSelection)
	} else {
		modelID := strings.TrimSpace(req.Model)
		if modelID == "" {
			modelID = strings.TrimSpace(th.ModelID)
		}
		capability, modelDefault, _, err := a.mgr.svc.threadReasoningDefaults(ctx, modelID)
		if err != nil {
			return SubmitRequestUserInputResponseResponse{}, err
		}
		threadDefault, err := parseStoredReasoningSelection(th.ReasoningSelectionJSON)
		if err != nil {
			return SubmitRequestUserInputResponseResponse{}, err
		}
		resolved, err := resolveEffectiveReasoning(capability, req.Options.ReasoningSelection, threadDefault, modelDefault)
		if err != nil {
			return SubmitRequestUserInputResponseResponse{}, reasoningSelectionError(modelID, err)
		}
		req.Options.ReasoningSelection = resolved.Effective
	}

	if activeRunID != "" {
		return SubmitRequestUserInputResponseResponse{}, ErrRunChanged
	}
	runID, err := NewRunID()
	if err != nil {
		return SubmitRequestUserInputResponseResponse{}, err
	}
	startReq := RunStartRequest{
		ThreadID: threadID,
		Model:    strings.TrimSpace(req.Model),
		Input:    req.Input,
		Options:  req.Options,
	}
	if _, _, err := a.mgr.svc.startUserTurnDetached(ctx, meta, runID, startReq, req.SourceFollowupID); err != nil {
		return SubmitRequestUserInputResponseResponse{}, err
	}
	return SubmitRequestUserInputResponseResponse{
		RunID:                   runID,
		Kind:                    "start",
		ConsumedWaitingPromptID: strings.TrimSpace(openPrompt.PromptID),
		AppliedPermissionType:   permissionTypeString(resolvedPermissionType),
	}, nil
}
