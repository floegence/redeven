package ai

import (
	"context"
	"database/sql"
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

	mu     sync.Mutex
	actors map[string]*threadActor // thread_key -> actor
	closed bool
}

func newThreadManager(svc *Service) *threadManager {
	return &threadManager{
		svc:    svc,
		actors: make(map[string]*threadActor),
	}
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

func queuedTurnStartErrorIsPermanent(err error) bool {
	return errors.Is(err, threadstore.ErrDuplicateUserTurnMessage) ||
		errors.Is(err, sql.ErrNoRows) ||
		errors.Is(err, ErrReadOnlyThread) ||
		errors.Is(err, ErrModelLockViolation) ||
		errors.Is(err, ErrModelSwitchRequiresExplicitRestart) ||
		errors.Is(err, ErrWaitingPromptChanged) ||
		errors.Is(err, ErrWaitingUserQueueConflict)
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
	if a.mgr.svc.idleThreadCompactionOperation(endpointID, threadID) != "" {
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
	th, err := db.GetThread(tctx, endpointID, threadID)
	cancel()
	if err != nil {
		return err
	}
	if th == nil {
		return nil
	}
	tctx, cancel = context.WithTimeout(ctx, persistTO)
	flowerMeta, err := db.GetFlowerThreadMetadata(tctx, endpointID, threadID)
	cancel()
	if err != nil {
		return err
	}
	if isFlowerSubagentProjection(flowerMeta) {
		return nil
	}
	runStatus, _, _ := normalizeThreadRunState(th.RunStatus, th.RunErrorCode, th.RunError)
	if NormalizeRunState(runStatus) == RunStateWaitingUser || requestUserInputPromptFromThreadRecord(th, runStatus) != nil {
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
	runID, err := NewRunID()
	if err != nil {
		return err
	}
	meta := queuedTurnRecordToSessionMeta(rec, th.NamespacePublicID)
	startReq, err := queuedTurnRecordToRunStartRequest(rec, th.ExecutionMode)
	if err != nil {
		if consumeErr := a.mgr.svc.consumeSourceFollowup(context.Background(), meta, threadID, rec.QueueID); consumeErr != nil && !errors.Is(consumeErr, sql.ErrNoRows) {
			err = errors.Join(err, consumeErr)
		}
		return &queuedTurnStartError{
			endpointID:         endpointID,
			threadID:           threadID,
			queueID:            rec.QueueID,
			messageID:          rec.MessageID,
			runID:              runID,
			requireSourceQueue: true,
			err:                err,
		}
	}
	if _, _, err := a.mgr.svc.startUserTurnDetached(ctx, meta, runID, startReq, rec.QueueID, true); err != nil {
		if queuedTurnStartErrorIsPermanent(err) {
			if consumeErr := a.mgr.svc.consumeSourceFollowup(context.Background(), meta, threadID, rec.QueueID); consumeErr != nil && !errors.Is(consumeErr, sql.ErrNoRows) {
				err = errors.Join(err, consumeErr)
			}
			if a.mgr != nil {
				a.mgr.Wake(endpointID, threadID)
			}
		}
		return &queuedTurnStartError{
			endpointID:         endpointID,
			threadID:           threadID,
			queueID:            rec.QueueID,
			messageID:          rec.MessageID,
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

	appliedExecutionMode := ""
	a.mgr.svc.mu.Lock()
	db := a.mgr.svc.threadsDB
	persistTO := a.mgr.svc.persistOpTO
	cfg := a.mgr.svc.cfg
	a.mgr.svc.mu.Unlock()
	if db == nil {
		return SendUserTurnResponse{}, errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	tctx, cancel := context.WithTimeout(ctx, persistTO)
	th, err := db.GetThread(tctx, endpointID, threadID)
	cancel()
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	if th == nil {
		return SendUserTurnResponse{}, errors.New("thread not found")
	}
	tctx, cancel = context.WithTimeout(ctx, persistTO)
	flowerMeta, err := db.GetFlowerThreadMetadata(tctx, endpointID, threadID)
	cancel()
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	if isFlowerSubagentProjection(flowerMeta) {
		return SendUserTurnResponse{}, ErrReadOnlyThread
	}
	requestedModel := strings.TrimSpace(req.Model)
	if th.ModelLocked {
		lockedModelID := strings.TrimSpace(th.ModelID)
		if lockedModelID == "" {
			return SendUserTurnResponse{}, ErrModelLockViolation
		}
		if requestedModel != "" && requestedModel != lockedModelID {
			return SendUserTurnResponse{}, ErrModelSwitchRequiresExplicitRestart
		}
		req.Model = lockedModelID
	}
	modeFallback := "act"
	if cfg != nil {
		modeFallback = cfg.EffectiveMode()
	}
	resolvedExecutionMode := normalizeRunMode(strings.TrimSpace(th.ExecutionMode), modeFallback)
	runStatus, _, _ := normalizeThreadRunState(th.RunStatus, th.RunErrorCode, th.RunError)
	consumeSourceFollowup := func() {
		if err := a.mgr.svc.consumeSourceFollowup(context.Background(), meta, threadID, req.SourceFollowupID); err != nil && a.mgr.svc.log != nil {
			a.mgr.svc.log.Warn("failed to consume source followup", "thread_id", threadID, "followup_id", strings.TrimSpace(req.SourceFollowupID), "error", err)
		}
	}
	openPrompt := a.mgr.svc.threadWaitingPrompt(ctx, th, runStatus)
	normalizeTurnReasoning := func(options *RunOptions) error {
		if options == nil {
			return nil
		}
		modelID := strings.TrimSpace(req.Model)
		if modelID == "" {
			modelID = strings.TrimSpace(th.ModelID)
		}
		capability, modelDefault, _ := a.mgr.svc.threadReasoningDefaults(ctx, modelID)
		threadDefault := unmarshalReasoningSelection(th.ReasoningSelectionJSON)
		resolved, err := resolveEffectiveReasoning(capability, options.ReasoningSelection, threadDefault, modelDefault)
		if err != nil {
			return reasoningSelectionError(modelID, err)
		}
		options.ReasoningSelection = resolved.Effective
		return nil
	}
	if openPrompt != nil && req.QueueAfterWaitingUser {
		req.Options.Mode = resolvedExecutionMode
		if err := normalizeTurnReasoning(&req.Options); err != nil {
			return SendUserTurnResponse{}, err
		}
		appliedExecutionMode = resolvedExecutionMode
		queued, position, err := a.mgr.svc.enqueueQueuedTurn(ctx, meta, req)
		if err != nil {
			return SendUserTurnResponse{}, err
		}
		consumeSourceFollowup()
		return SendUserTurnResponse{
			Kind:                 "queued",
			QueueID:              strings.TrimSpace(queued.QueueID),
			QueuePosition:        position,
			AppliedExecutionMode: appliedExecutionMode,
		}, nil
	}
	if openPrompt != nil {
		return SendUserTurnResponse{}, ErrWaitingUserQueueConflict
	}
	req.Options.Mode = resolvedExecutionMode
	if err := normalizeTurnReasoning(&req.Options); err != nil {
		return SendUserTurnResponse{}, err
	}
	appliedExecutionMode = resolvedExecutionMode

	if activeRunID != "" {
		queued, position, err := a.mgr.svc.enqueueQueuedTurn(ctx, meta, req)
		if err != nil {
			return SendUserTurnResponse{}, err
		}
		consumeSourceFollowup()
		return SendUserTurnResponse{
			Kind:                 "queued",
			QueueID:              strings.TrimSpace(queued.QueueID),
			QueuePosition:        position,
			AppliedExecutionMode: appliedExecutionMode,
		}, nil
	}
	if a.mgr.svc.idleThreadCompactionOperation(endpointID, threadID) != "" {
		queued, position, err := a.mgr.svc.enqueueQueuedTurn(ctx, meta, req)
		if err != nil {
			return SendUserTurnResponse{}, err
		}
		consumeSourceFollowup()
		return SendUserTurnResponse{
			Kind:                 "queued",
			QueueID:              strings.TrimSpace(queued.QueueID),
			QueuePosition:        position,
			AppliedExecutionMode: appliedExecutionMode,
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
		consumeSourceFollowup()
		return SendUserTurnResponse{
			Kind:                 "queued",
			QueueID:              strings.TrimSpace(queued.QueueID),
			QueuePosition:        position,
			AppliedExecutionMode: appliedExecutionMode,
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
	if _, _, err := a.mgr.svc.startUserTurnDetached(ctx, meta, runID, startReq, req.SourceFollowupID, false); err != nil {
		return SendUserTurnResponse{}, err
	}
	return SendUserTurnResponse{
		RunID:                runID,
		Kind:                 "start",
		AppliedExecutionMode: appliedExecutionMode,
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
	persistTO := a.mgr.svc.persistOpTO
	cfg := a.mgr.svc.cfg
	a.mgr.svc.mu.Unlock()
	if db == nil {
		return SubmitRequestUserInputResponseResponse{}, errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	tctx, cancel := context.WithTimeout(ctx, persistTO)
	th, err := db.GetThread(tctx, endpointID, threadID)
	cancel()
	if err != nil {
		return SubmitRequestUserInputResponseResponse{}, err
	}
	if th == nil {
		return SubmitRequestUserInputResponseResponse{}, errors.New("thread not found")
	}
	tctx, cancel = context.WithTimeout(ctx, persistTO)
	flowerMeta, err := db.GetFlowerThreadMetadata(tctx, endpointID, threadID)
	cancel()
	if err != nil {
		return SubmitRequestUserInputResponseResponse{}, err
	}
	if isFlowerSubagentProjection(flowerMeta) {
		return SubmitRequestUserInputResponseResponse{}, ErrReadOnlyThread
	}
	requestedModel := strings.TrimSpace(req.Model)
	if th.ModelLocked {
		lockedModelID := strings.TrimSpace(th.ModelID)
		if lockedModelID == "" {
			return SubmitRequestUserInputResponseResponse{}, ErrModelLockViolation
		}
		if requestedModel != "" && requestedModel != lockedModelID {
			return SubmitRequestUserInputResponseResponse{}, ErrModelSwitchRequiresExplicitRestart
		}
		req.Model = lockedModelID
	}
	modeFallback := "act"
	if cfg != nil {
		modeFallback = cfg.EffectiveMode()
	}
	resolvedExecutionMode := normalizeRunMode(strings.TrimSpace(th.ExecutionMode), modeFallback)
	runStatus, _, _ := normalizeThreadRunState(th.RunStatus, th.RunErrorCode, th.RunError)
	openPrompt := a.mgr.svc.threadWaitingPrompt(ctx, th, runStatus)
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

	nextExecutionMode := resolvedExecutionMode
	for _, question := range openPrompt.Questions {
		answer := validatedResponse.Answers[question.ID]
		choice, ok := requestUserInputChoiceByID(&question, answer.ChoiceID)
		if !ok || choice == nil {
			continue
		}
		for _, action := range choice.Actions {
			normalizedAction, ok := normalizeRequestUserInputAction(action)
			if !ok {
				continue
			}
			if normalizedAction.Type == requestUserInputActionSetMode {
				nextExecutionMode = normalizeRunMode(normalizedAction.Mode, resolvedExecutionMode)
			}
		}
	}
	if nextExecutionMode != resolvedExecutionMode {
		uctx, ucancel := context.WithTimeout(ctx, persistTO)
		if err := db.UpdateThreadExecutionMode(uctx, endpointID, threadID, nextExecutionMode); err != nil {
			ucancel()
			return SubmitRequestUserInputResponseResponse{}, err
		}
		ucancel()
		resolvedExecutionMode = nextExecutionMode
		a.mgr.svc.broadcastThreadSummary(endpointID, threadID)
	}
	req.Options.Mode = resolvedExecutionMode
	if req.Options.ReasoningSelection.IsZero() {
		req.Options.ReasoningSelection = config.NormalizeAIReasoningSelection(openPrompt.ReasoningSelection)
	} else {
		modelID := strings.TrimSpace(req.Model)
		if modelID == "" {
			modelID = strings.TrimSpace(th.ModelID)
		}
		capability, modelDefault, _ := a.mgr.svc.threadReasoningDefaults(ctx, modelID)
		threadDefault := unmarshalReasoningSelection(th.ReasoningSelectionJSON)
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
	if _, _, err := a.mgr.svc.startUserTurnDetached(ctx, meta, runID, startReq, req.SourceFollowupID, false); err != nil {
		return SubmitRequestUserInputResponseResponse{}, err
	}
	return SubmitRequestUserInputResponseResponse{
		RunID:                   runID,
		Kind:                    "start",
		ConsumedWaitingPromptID: strings.TrimSpace(openPrompt.PromptID),
		AppliedExecutionMode:    resolvedExecutionMode,
	}, nil
}
