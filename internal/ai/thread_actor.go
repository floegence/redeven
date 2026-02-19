package ai

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

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
	replyToWaitingPromptID := strings.TrimSpace(req.ReplyToWaitingPromptID)
	activeRunID, _ := a.lookupActiveRun(endpointID, threadID)
	if activeRunID != "" && expected != "" && expected != activeRunID {
		return SendUserTurnResponse{}, ErrRunChanged
	}

	consumedWaitingPromptID := ""
	a.mgr.svc.mu.Lock()
	db := a.mgr.svc.threadsDB
	persistTO := a.mgr.svc.persistOpTO
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
	openWaitingPrompt := waitingPromptFromThreadRecord(th, th.RunStatus)
	if openWaitingPrompt != nil {
		if replyToWaitingPromptID == "" || strings.TrimSpace(openWaitingPrompt.PromptID) != replyToWaitingPromptID {
			return SendUserTurnResponse{}, ErrWaitingPromptChanged
		}
		consumedWaitingPromptID = strings.TrimSpace(openWaitingPrompt.PromptID)
	} else if replyToWaitingPromptID != "" {
		return SendUserTurnResponse{}, ErrWaitingPromptChanged
	}

	persisted, normalizedInput, err := a.mgr.svc.persistUserMessage(ctx, meta, endpointID, threadID, req.Input)
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	req.Input = normalizedInput

	// Transcript events are thread-scoped; they never go to summary subscribers.
	a.mgr.svc.broadcastTranscriptMessage(endpointID, threadID, "", persisted.RowID, persisted.MessageJSON, persisted.CreatedAtUnixMs)
	a.mgr.svc.broadcastThreadSummary(endpointID, threadID)

	if activeRunID, _ = a.lookupActiveRun(endpointID, threadID); activeRunID != "" {
		if err := a.mgr.svc.CancelRun(meta, activeRunID); err != nil {
			return SendUserTurnResponse{}, err
		}
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
	if err := a.mgr.svc.StartRunDetachedWithPersisted(meta, runID, startReq, persisted); err != nil {
		return SendUserTurnResponse{}, err
	}
	return SendUserTurnResponse{RunID: runID, Kind: "start", ConsumedWaitingPromptID: consumedWaitingPromptID}, nil
}
