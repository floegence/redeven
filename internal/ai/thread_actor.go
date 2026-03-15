package ai

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
	"github.com/floegence/redeven-agent/internal/session"
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

type cmdSubmitStructuredPromptResponse struct {
	ctx  context.Context
	meta *session.Meta
	req  SubmitStructuredPromptResponseRequest
	resp chan submitStructuredPromptResponseResult
}

type submitStructuredPromptResponseResult struct {
	resp SubmitStructuredPromptResponseResponse
	err  error
}

type cmdRewindThread struct {
	ctx  context.Context
	meta *session.Meta
	req  RewindThreadRequest
	resp chan rewindThreadResult
}

type rewindThreadResult struct {
	resp RewindThreadResponse
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

func (a *threadActor) SubmitStructuredPromptResponse(ctx context.Context, meta *session.Meta, req SubmitStructuredPromptResponseRequest) (SubmitStructuredPromptResponseResponse, error) {
	if a == nil {
		return SubmitStructuredPromptResponseResponse{}, errors.New("thread actor not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ch := make(chan submitStructuredPromptResponseResult, 1)
	cmd := cmdSubmitStructuredPromptResponse{ctx: ctx, meta: meta, req: req, resp: ch}

	select {
	case <-a.stopCh:
		return SubmitStructuredPromptResponseResponse{}, errors.New("thread actor closed")
	case <-ctx.Done():
		return SubmitStructuredPromptResponseResponse{}, ctx.Err()
	case a.inbox <- cmd:
	}

	select {
	case <-a.stopCh:
		return SubmitStructuredPromptResponseResponse{}, errors.New("thread actor closed")
	case <-ctx.Done():
		return SubmitStructuredPromptResponseResponse{}, ctx.Err()
	case res := <-ch:
		return res.resp, res.err
	}
}

func (a *threadActor) RewindThread(ctx context.Context, meta *session.Meta, req RewindThreadRequest) (RewindThreadResponse, error) {
	if a == nil {
		return RewindThreadResponse{}, errors.New("thread actor not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ch := make(chan rewindThreadResult, 1)
	cmd := cmdRewindThread{ctx: ctx, meta: meta, req: req, resp: ch}

	select {
	case <-a.stopCh:
		return RewindThreadResponse{}, errors.New("thread actor closed")
	case <-ctx.Done():
		return RewindThreadResponse{}, ctx.Err()
	case a.inbox <- cmd:
	}

	select {
	case <-a.stopCh:
		return RewindThreadResponse{}, errors.New("thread actor closed")
	case <-ctx.Done():
		return RewindThreadResponse{}, ctx.Err()
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
			case cmdSubmitStructuredPromptResponse:
				resp, err := a.handleSubmitStructuredPromptResponse(cmd.ctx, cmd.meta, cmd.req)
				cmd.resp <- submitStructuredPromptResponseResult{resp: resp, err: err}
			case cmdRewindThread:
				resp, err := a.handleRewindThread(cmd.ctx, cmd.meta, cmd.req)
				cmd.resp <- rewindThreadResult{resp: resp, err: err}
			case cmdStopThread:
				resp, err := a.handleStopThread(cmd.ctx, cmd.meta, cmd.req)
				cmd.resp <- stopThreadResult{resp: resp, err: err}
			case cmdMaybeStartQueuedTurn:
				_ = a.handleMaybeStartQueuedTurn(context.Background())
			}
		}
	}
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
	runStatus, _ := normalizeThreadRunState(th.RunStatus, th.RunError)
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
	startReq := queuedTurnRecordToRunStartRequest(rec, th.ExecutionMode)
	if err := a.mgr.svc.StartRunDetached(meta, runID, startReq); err != nil {
		return err
	}
	dctx, dcancel := context.WithTimeout(ctx, persistTO)
	_, delErr := db.DeleteFollowup(dctx, endpointID, threadID, rec.QueueID)
	dcancel()
	if delErr != nil && !errors.Is(delErr, sql.ErrNoRows) {
		return delErr
	}
	a.mgr.svc.broadcastThreadSummary(endpointID, threadID)
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
	consumeSourceFollowup := func() {
		if err := a.mgr.svc.consumeSourceFollowup(context.Background(), meta, threadID, req.SourceFollowupID); err != nil && a.mgr.svc.log != nil {
			a.mgr.svc.log.Warn("failed to consume source followup", "thread_id", threadID, "followup_id", strings.TrimSpace(req.SourceFollowupID), "error", err)
		}
	}
	openPrompt := requestUserInputPromptFromThreadRecord(th, th.RunStatus)
	if openPrompt != nil && req.QueueAfterWaitingUser {
		req.Options.Mode = resolvedExecutionMode
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

	runID, err := NewRunID()
	if err != nil {
		return SendUserTurnResponse{}, err
	}

	checkpointID := checkpointIDForRun(runID)
	if strings.TrimSpace(checkpointID) == "" {
		return SendUserTurnResponse{}, errors.New("missing checkpoint id")
	}
	cctx, cancel := context.WithTimeout(ctx, persistTO)
	_, cpErr := db.CreateThreadCheckpoint(cctx, endpointID, threadID, checkpointID, runID, threadstore.CheckpointKindPreRun)
	cancel()
	if cpErr != nil {
		return SendUserTurnResponse{}, cpErr
	}

	persisted, normalizedInput, err := a.mgr.svc.persistUserMessage(ctx, meta, endpointID, threadID, req.Input)
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	req.Input = normalizedInput

	// Transcript events are thread-scoped; they never go to summary subscribers.
	a.mgr.svc.broadcastTranscriptMessage(endpointID, threadID, "", persisted.RowID, persisted.MessageJSON, persisted.CreatedAtUnixMs)
	a.mgr.svc.broadcastThreadSummary(endpointID, threadID)

	startReq := RunStartRequest{
		ThreadID: threadID,
		Model:    strings.TrimSpace(req.Model),
		Input:    req.Input,
		Options:  req.Options,
	}
	if err := a.mgr.svc.StartRunDetachedWithPersisted(meta, runID, startReq, persisted); err != nil {
		return SendUserTurnResponse{}, err
	}
	consumeSourceFollowup()
	return SendUserTurnResponse{
		RunID:                runID,
		Kind:                 "start",
		AppliedExecutionMode: appliedExecutionMode,
	}, nil
}

func (a *threadActor) handleSubmitStructuredPromptResponse(ctx context.Context, meta *session.Meta, req SubmitStructuredPromptResponseRequest) (SubmitStructuredPromptResponseResponse, error) {
	if a == nil || a.mgr == nil || a.mgr.svc == nil {
		return SubmitStructuredPromptResponseResponse{}, errors.New("service not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return SubmitStructuredPromptResponseResponse{}, err
	}
	if !a.mgr.svc.Enabled() {
		return SubmitStructuredPromptResponseResponse{}, ErrNotConfigured
	}

	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" || endpointID != strings.TrimSpace(a.endpointID) {
		return SubmitStructuredPromptResponseResponse{}, errors.New("invalid request")
	}
	threadID := strings.TrimSpace(req.ThreadID)
	if threadID == "" || threadID != strings.TrimSpace(a.threadID) {
		return SubmitStructuredPromptResponseResponse{}, errors.New("invalid request")
	}
	expected := strings.TrimSpace(req.ExpectedRunID)
	activeRunID, _ := a.lookupActiveRun(endpointID, threadID)
	if activeRunID != "" && expected != "" && expected != activeRunID {
		return SubmitStructuredPromptResponseResponse{}, ErrRunChanged
	}

	a.mgr.svc.mu.Lock()
	db := a.mgr.svc.threadsDB
	persistTO := a.mgr.svc.persistOpTO
	cfg := a.mgr.svc.cfg
	a.mgr.svc.mu.Unlock()
	if db == nil {
		return SubmitStructuredPromptResponseResponse{}, errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	tctx, cancel := context.WithTimeout(ctx, persistTO)
	th, err := db.GetThread(tctx, endpointID, threadID)
	cancel()
	if err != nil {
		return SubmitStructuredPromptResponseResponse{}, err
	}
	if th == nil {
		return SubmitStructuredPromptResponseResponse{}, errors.New("thread not found")
	}
	requestedModel := strings.TrimSpace(req.Model)
	if th.ModelLocked {
		lockedModelID := strings.TrimSpace(th.ModelID)
		if lockedModelID == "" {
			return SubmitStructuredPromptResponseResponse{}, ErrModelLockViolation
		}
		if requestedModel != "" && requestedModel != lockedModelID {
			return SubmitStructuredPromptResponseResponse{}, ErrModelSwitchRequiresExplicitRestart
		}
		req.Model = lockedModelID
	}
	modeFallback := "act"
	if cfg != nil {
		modeFallback = cfg.EffectiveMode()
	}
	resolvedExecutionMode := normalizeRunMode(strings.TrimSpace(th.ExecutionMode), modeFallback)
	consumeSourceFollowup := func() {
		if err := a.mgr.svc.consumeSourceFollowup(context.Background(), meta, threadID, req.SourceFollowupID); err != nil && a.mgr.svc.log != nil {
			a.mgr.svc.log.Warn("failed to consume source followup", "thread_id", threadID, "followup_id", strings.TrimSpace(req.SourceFollowupID), "error", err)
		}
	}
	openPrompt := requestUserInputPromptFromThreadRecord(th, th.RunStatus)
	if openPrompt == nil {
		return SubmitStructuredPromptResponseResponse{}, ErrWaitingPromptChanged
	}
	validatedResponse, err := validateRequestUserInputResponse(openPrompt, &req.Response)
	if err != nil {
		return SubmitStructuredPromptResponseResponse{}, err
	}
	responseRecord, secretAnswers, err := buildRequestUserInputResponseRecord(*openPrompt, *validatedResponse, req.Input.MessageID)
	if err != nil {
		return SubmitStructuredPromptResponseResponse{}, err
	}
	req.Input.StructuredResponse = &responseRecord
	req.Input.SecretAnswers = secretAnswers

	nextExecutionMode := resolvedExecutionMode
	for _, question := range openPrompt.Questions {
		answer := validatedResponse.Answers[question.ID]
		option, ok := requestUserInputOptionByID(&question, answer.SelectedOptionID)
		if !ok || option == nil {
			continue
		}
		for _, action := range option.Actions {
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
			return SubmitStructuredPromptResponseResponse{}, err
		}
		ucancel()
		resolvedExecutionMode = nextExecutionMode
		a.mgr.svc.broadcastThreadSummary(endpointID, threadID)
	}
	req.Options.Mode = resolvedExecutionMode

	if activeRunID != "" {
		return SubmitStructuredPromptResponseResponse{}, ErrRunChanged
	}
	runID, err := NewRunID()
	if err != nil {
		return SubmitStructuredPromptResponseResponse{}, err
	}
	checkpointID := checkpointIDForRun(runID)
	if strings.TrimSpace(checkpointID) == "" {
		return SubmitStructuredPromptResponseResponse{}, errors.New("missing checkpoint id")
	}
	cctx, cancel := context.WithTimeout(ctx, persistTO)
	_, cpErr := db.CreateThreadCheckpoint(cctx, endpointID, threadID, checkpointID, runID, threadstore.CheckpointKindPreRun)
	cancel()
	if cpErr != nil {
		return SubmitStructuredPromptResponseResponse{}, cpErr
	}
	persisted, normalizedInput, err := a.mgr.svc.persistUserMessage(ctx, meta, endpointID, threadID, req.Input)
	if err != nil {
		return SubmitStructuredPromptResponseResponse{}, err
	}
	req.Input = normalizedInput
	a.mgr.svc.broadcastTranscriptMessage(endpointID, threadID, "", persisted.RowID, persisted.MessageJSON, persisted.CreatedAtUnixMs)
	a.mgr.svc.broadcastThreadSummary(endpointID, threadID)

	startReq := RunStartRequest{
		ThreadID: threadID,
		Model:    strings.TrimSpace(req.Model),
		Input:    req.Input,
		Options:  req.Options,
	}
	if err := a.mgr.svc.StartRunDetachedWithPersisted(meta, runID, startReq, persisted); err != nil {
		return SubmitStructuredPromptResponseResponse{}, err
	}
	consumeSourceFollowup()
	return SubmitStructuredPromptResponseResponse{
		RunID:                   runID,
		Kind:                    "start",
		ConsumedWaitingPromptID: strings.TrimSpace(openPrompt.PromptID),
		AppliedExecutionMode:    resolvedExecutionMode,
	}, nil
}

func (a *threadActor) handleRewindThread(ctx context.Context, meta *session.Meta, req RewindThreadRequest) (RewindThreadResponse, error) {
	if a == nil || a.mgr == nil || a.mgr.svc == nil {
		return RewindThreadResponse{}, errors.New("service not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return RewindThreadResponse{}, err
	}

	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" || endpointID != strings.TrimSpace(a.endpointID) {
		return RewindThreadResponse{}, errors.New("invalid request")
	}
	threadID := strings.TrimSpace(req.ThreadID)
	if threadID == "" || threadID != strings.TrimSpace(a.threadID) {
		return RewindThreadResponse{}, errors.New("invalid request")
	}

	// Best-effort: cancel any active run so it cannot keep mutating the workspace while rewinding.
	activeRunID, r := a.lookupActiveRun(endpointID, threadID)
	if activeRunID != "" {
		_ = a.mgr.svc.CancelRun(meta, activeRunID)
		if r != nil && r.doneCh != nil {
			timer := time.NewTimer(3 * time.Second)
			defer timer.Stop()
			select {
			case <-r.doneCh:
			case <-timer.C:
			case <-ctx.Done():
			}
		}
	}

	checkpointID, err := a.mgr.svc.rewindThreadCheckpoint(ctx, meta, endpointID, threadID, "", "rewind")
	if err != nil {
		return RewindThreadResponse{}, err
	}
	return RewindThreadResponse{OK: true, CheckpointID: checkpointID}, nil
}
