package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/redeven-agent/internal/session"
)

type StopThreadRequest struct {
	ThreadID string `json:"thread_id"`
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
	if s == nil {
		return StopThreadResponse{}, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return StopThreadResponse{}, err
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return StopThreadResponse{}, errors.New("invalid request")
	}
	if s.threadMgr == nil {
		return StopThreadResponse{}, errors.New("thread manager not ready")
	}
	actor := s.threadMgr.Get(endpointID, threadID)
	if actor == nil {
		return StopThreadResponse{}, errors.New("thread actor not ready")
	}
	return actor.StopThread(ctx, meta, StopThreadRequest{ThreadID: threadID})
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
		return StopThreadResponse{}, ctx.Err()
	case a.inbox <- cmd:
	}
	select {
	case <-a.stopCh:
		return StopThreadResponse{}, errors.New("thread actor closed")
	case <-ctx.Done():
		return StopThreadResponse{}, ctx.Err()
	case res := <-ch:
		return res.resp, res.err
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
	defer a.mgr.svc.clearQueuedDrainSuppression(endpointID, threadID)

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

	rctx, cancel := context.WithTimeout(ctx, persistTO)
	recovered, _, err := db.RecoverQueuedTurnsToDrafts(rctx, endpointID, threadID)
	cancel()
	if err != nil {
		return StopThreadResponse{}, err
	}
	activeRunID, _ := a.lookupActiveRun(endpointID, threadID)
	if activeRunID != "" {
		if err := a.mgr.svc.CancelRun(meta, activeRunID); err != nil {
			return StopThreadResponse{}, err
		}
	} else {
		uctx, ucancel := context.WithTimeout(ctx, persistTO)
		_ = db.UpdateThreadRunState(uctx, endpointID, threadID, "canceled", "", "", meta.UserPublicID, meta.UserEmail)
		ucancel()
		a.mgr.svc.broadcastThreadSummary(endpointID, threadID)
	}
	resp := StopThreadResponse{OK: true, RecoveredFollowups: make([]FollowupItemView, 0, len(recovered))}
	for i, rec := range recovered {
		resp.RecoveredFollowups = append(resp.RecoveredFollowups, followupRecordToView(rec, i+1))
	}
	return resp, nil
}
