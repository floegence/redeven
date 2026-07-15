package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	flconfig "github.com/floegence/floret/config"
	flruntime "github.com/floegence/floret/runtime"
	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func idleManualCompactionOperationID(runID string, requestID string) string {
	return flruntime.ManualCompactionOperationID(flruntime.RunID(strings.TrimSpace(runID)), 1, strings.TrimSpace(requestID))
}

func idleCompactThreadResultStatus(result flruntime.CompactThreadResult) string {
	status := strings.TrimSpace(result.Status)
	switch {
	case status == "compacted":
		return "compacted"
	case status == "completed" && result.Metrics.Compactions > 0:
		return "compacted"
	case status == "noop" || status == "completed" && result.Metrics.Compactions == 0:
		return "noop"
	default:
		return ""
	}
}

var errIdleCompactionNotCurrent = errors.New("context compaction operation is no longer current")

const idleCompactionGateRunEventType = "context.compaction.gate"

func idleThreadCompactionExpired(err error) bool {
	return errors.Is(err, context.Canceled) ||
		errors.Is(err, context.DeadlineExceeded) ||
		errors.Is(err, errIdleCompactionNotCurrent) ||
		errors.Is(err, threadstore.ErrThreadContextBoundaryChanged) ||
		errors.Is(err, sql.ErrNoRows)
}

type idleThreadCompaction struct {
	mu              sync.Mutex
	endpointID      string
	threadID        string
	operationID     string
	runID           string
	anchor          FlowerTimelineAnchor
	contextBoundary threadstore.ThreadContextBoundary
	cancelled       bool
	finalizing      bool
	cancel          context.CancelFunc
	done            chan struct{}
}

type idleThreadCompactionBeginResult struct {
	OperationID string
	RunID       string
	Started     bool
}

type idleThreadCompactionCancelResult struct {
	Compaction *idleThreadCompaction
	Found      bool
	Cancelled  bool
	Finalizing bool
}

func (c *idleThreadCompaction) cancelRun() {
	if c == nil || c.cancel == nil {
		return
	}
	c.cancel()
}

func (c *idleThreadCompaction) doneCh() <-chan struct{} {
	if c == nil || c.done == nil {
		closed := make(chan struct{})
		close(closed)
		return closed
	}
	return c.done
}

func (c *idleThreadCompaction) isCancelled() bool {
	if c == nil {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.cancelled
}

func (c *idleThreadCompaction) isFinalizing() bool {
	if c == nil {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.finalizing
}

func (c *idleThreadCompaction) busy() bool {
	if c == nil {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return !c.cancelled && strings.TrimSpace(c.operationID) != ""
}

func (s *Service) persistIdleThreadCompactionGateEvent(endpointID string, threadID string, runID string, operationID string, phase string, attrs map[string]any) {
	if s == nil {
		return
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	runID = strings.TrimSpace(runID)
	operationID = strings.TrimSpace(operationID)
	phase = strings.TrimSpace(phase)
	if endpointID == "" || threadID == "" || runID == "" || operationID == "" || phase == "" {
		return
	}
	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		return
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	payload := make(map[string]any, len(attrs)+2)
	payload["operation_id"] = operationID
	payload["phase"] = phase
	for key, value := range attrs {
		key = strings.TrimSpace(key)
		if key != "" {
			payload[key] = value
		}
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), persistTO)
	defer cancel()
	if err := db.AppendRunEvent(ctx, threadstore.RunEventRecord{
		EndpointID:  endpointID,
		ThreadID:    threadID,
		RunID:       runID,
		StreamKind:  string(RealtimeStreamKindContext),
		EventType:   idleCompactionGateRunEventType,
		PayloadJSON: string(raw),
		AtUnixMs:    time.Now().UnixMilli(),
	}); err != nil && s.log != nil {
		s.log.Warn("persist idle compaction gate event failed", "thread_id", threadID, "run_id", runID, "operation_id", operationID, "phase", phase, "error", err)
	}
}

func (s *Service) beginIdleThreadCompaction(endpointID string, threadID string, operationID string, runID string, anchor FlowerTimelineAnchor, contextBoundary threadstore.ThreadContextBoundary, cancel context.CancelFunc) (idleThreadCompactionBeginResult, error) {
	if s == nil {
		return idleThreadCompactionBeginResult{}, errors.New("service not ready")
	}
	thKey := runThreadKey(endpointID, threadID)
	operationID = strings.TrimSpace(operationID)
	runID = strings.TrimSpace(runID)
	if thKey == "" || operationID == "" || runID == "" || !validFlowerTimelineAnchor(anchor) || cancel == nil {
		return idleThreadCompactionBeginResult{}, errors.New("invalid request")
	}
	s.mu.Lock()
	if s.idleCompactionByTh == nil {
		s.idleCompactionByTh = make(map[string]*idleThreadCompaction)
	}
	if activeRunID := strings.TrimSpace(s.activeRunByTh[thKey]); activeRunID != "" {
		s.mu.Unlock()
		cancel()
		return idleThreadCompactionBeginResult{OperationID: activeRunID, RunID: activeRunID}, ErrThreadBusy
	}
	if existing := s.idleCompactionByTh[thKey]; existing != nil && strings.TrimSpace(existing.operationID) != "" {
		existing.mu.Lock()
		existingOperationID := strings.TrimSpace(existing.operationID)
		existingRunID := strings.TrimSpace(existing.runID)
		existingCancelled := existing.cancelled
		existing.mu.Unlock()
		if existingCancelled {
			delete(s.idleCompactionByTh, thKey)
			s.mu.Unlock()
			s.persistIdleThreadCompactionGateEvent(endpointID, threadID, existingRunID, existingOperationID, "superseded_after_cancel", map[string]any{
				"next_operation_id": operationID,
			})
		} else {
			s.mu.Unlock()
			cancel()
			return idleThreadCompactionBeginResult{OperationID: existingOperationID, RunID: existingRunID}, nil
		}
	} else {
		s.mu.Unlock()
	}
	s.mu.Lock()
	if s.idleCompactionByTh == nil {
		s.idleCompactionByTh = make(map[string]*idleThreadCompaction)
	}
	if existing := s.idleCompactionByTh[thKey]; existing != nil && strings.TrimSpace(existing.operationID) != "" {
		existing.mu.Lock()
		existingOperationID := strings.TrimSpace(existing.operationID)
		existingRunID := strings.TrimSpace(existing.runID)
		existing.mu.Unlock()
		s.mu.Unlock()
		cancel()
		return idleThreadCompactionBeginResult{OperationID: existingOperationID, RunID: existingRunID}, nil
	}
	s.idleCompactionByTh[thKey] = &idleThreadCompaction{
		endpointID:      endpointID,
		threadID:        threadID,
		operationID:     operationID,
		runID:           runID,
		anchor:          anchor,
		contextBoundary: contextBoundary,
		cancel:          cancel,
		done:            make(chan struct{}),
	}
	s.mu.Unlock()
	s.persistIdleThreadCompactionGateEvent(endpointID, threadID, runID, operationID, "registered", nil)
	return idleThreadCompactionBeginResult{OperationID: operationID, RunID: runID, Started: true}, nil
}

func (s *Service) finishIdleThreadCompaction(endpointID string, threadID string, operationID string) {
	if s == nil {
		return
	}
	thKey := runThreadKey(endpointID, threadID)
	operationID = strings.TrimSpace(operationID)
	if thKey == "" || operationID == "" {
		return
	}
	s.mu.Lock()
	var done chan struct{}
	if existing := s.idleCompactionByTh[thKey]; existing != nil && strings.TrimSpace(existing.operationID) == operationID {
		done = existing.done
		delete(s.idleCompactionByTh, thKey)
	}
	s.mu.Unlock()
	if done != nil {
		close(done)
	}
	if s.threadMgr != nil {
		s.threadMgr.Wake(endpointID, threadID)
	}
}

func (s *Service) idleThreadCompactionOperation(endpointID string, threadID string) string {
	if s == nil {
		return ""
	}
	thKey := runThreadKey(endpointID, threadID)
	if thKey == "" {
		return ""
	}
	s.mu.Lock()
	existing := s.idleCompactionByTh[thKey]
	s.mu.Unlock()
	if existing == nil {
		return ""
	}
	existing.mu.Lock()
	defer existing.mu.Unlock()
	if existing.cancelled {
		return ""
	}
	return strings.TrimSpace(existing.operationID)
}

func (s *Service) isIdleThreadCompactionCurrent(endpointID string, threadID string, operationID string) bool {
	if s == nil {
		return false
	}
	thKey := runThreadKey(endpointID, threadID)
	operationID = strings.TrimSpace(operationID)
	if thKey == "" || operationID == "" {
		return false
	}
	s.mu.Lock()
	existing := s.idleCompactionByTh[thKey]
	s.mu.Unlock()
	if existing == nil || strings.TrimSpace(existing.operationID) != operationID {
		return false
	}
	existing.mu.Lock()
	defer existing.mu.Unlock()
	return !existing.cancelled
}

func (s *Service) cancelIdleThreadCompaction(endpointID string, threadID string) idleThreadCompactionCancelResult {
	if s == nil {
		return idleThreadCompactionCancelResult{}
	}
	thKey := runThreadKey(endpointID, threadID)
	if thKey == "" {
		return idleThreadCompactionCancelResult{}
	}
	s.mu.Lock()
	compaction := s.idleCompactionByTh[thKey]
	s.mu.Unlock()
	if compaction == nil {
		return idleThreadCompactionCancelResult{}
	}
	compaction.mu.Lock()
	runID := strings.TrimSpace(compaction.runID)
	operationID := strings.TrimSpace(compaction.operationID)
	if compaction.finalizing {
		compaction.mu.Unlock()
		s.persistIdleThreadCompactionGateEvent(endpointID, threadID, runID, operationID, "cancel_skipped_finalizing", map[string]any{
			"reason": "commit_finalizing",
		})
		return idleThreadCompactionCancelResult{Compaction: compaction, Found: true, Finalizing: true}
	}
	if !compaction.cancelled {
		compaction.cancelled = true
	}
	compaction.mu.Unlock()
	s.persistIdleThreadCompactionGateEvent(endpointID, threadID, runID, operationID, "cancel_requested", nil)
	compaction.cancelRun()
	return idleThreadCompactionCancelResult{Compaction: compaction, Found: true, Cancelled: true}
}

func (s *Service) cancelIdleThreadCompactionWithBroadcast(endpointID string, threadID string) (*idleThreadCompaction, bool) {
	result := s.cancelIdleThreadCompaction(endpointID, threadID)
	if !result.Found || result.Compaction == nil {
		return result.Compaction, result.Found
	}
	if !result.Cancelled {
		return result.Compaction, result.Found
	}
	s.publishIdleContextCompactionCancellation(result.Compaction)
	return result.Compaction, result.Found
}

func (s *Service) publishIdleContextCompactionCancellation(compaction *idleThreadCompaction) {
	if s == nil || compaction == nil {
		return
	}
	s.publishIdleContextCompaction(compaction.endpointID, compaction.threadID, compaction.runID, FlowerContextCompaction{
		OperationID: strings.TrimSpace(compaction.operationID),
		RunID:       strings.TrimSpace(compaction.runID),
		Phase:       "cancelled",
		Status:      "cancelled",
		Trigger:     "manual",
		Reason:      "manual",
		UpdatedAtMs: time.Now().UnixMilli(),
	}, compaction.anchor)
}

func (s *Service) waitIdleThreadCompaction(ctx context.Context, compaction *idleThreadCompaction) bool {
	if compaction == nil {
		return true
	}
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-compaction.doneCh():
		return true
	case <-ctx.Done():
		return false
	}
}

func (s *Service) commitIdleThreadCompaction(ctx context.Context, db *threadstore.Store, endpointID string, threadID string, runID string, operationID string, continuation threadstore.ThreadProviderContinuation) error {
	if s == nil || db == nil {
		return errors.New("threads store not ready")
	}
	thKey := runThreadKey(endpointID, threadID)
	runID = strings.TrimSpace(runID)
	operationID = strings.TrimSpace(operationID)
	if thKey == "" || runID == "" || operationID == "" {
		return errors.New("invalid request")
	}
	s.mu.Lock()
	existing := s.idleCompactionByTh[thKey]
	s.mu.Unlock()
	if existing == nil {
		s.persistIdleThreadCompactionGateEvent(endpointID, threadID, runID, operationID, "commit_rejected", map[string]any{
			"reason":    "not_current",
			"cancelled": false,
		})
		return errIdleCompactionNotCurrent
	}
	existing.mu.Lock()
	if existing.cancelled || strings.TrimSpace(existing.operationID) != operationID {
		cancelled := existing.cancelled
		runID := strings.TrimSpace(existing.runID)
		existing.mu.Unlock()
		if runID == "" {
			runID = operationID
		}
		s.persistIdleThreadCompactionGateEvent(endpointID, threadID, runID, operationID, "commit_rejected", map[string]any{
			"reason":    "not_current",
			"cancelled": cancelled,
		})
		return errIdleCompactionNotCurrent
	}
	contextBoundary := existing.contextBoundary
	currentRunID := strings.TrimSpace(existing.runID)
	existing.finalizing = true
	existing.mu.Unlock()
	if currentRunID != runID {
		s.persistIdleThreadCompactionGateEvent(endpointID, threadID, runID, operationID, "commit_rejected", map[string]any{
			"reason":         "run_changed",
			"current_run_id": currentRunID,
		})
		return errIdleCompactionNotCurrent
	}
	s.persistIdleThreadCompactionGateEvent(endpointID, threadID, runID, operationID, "commit_attempt", nil)
	if err := db.SetThreadProviderContinuationIfBoundaryMatches(ctx, endpointID, threadID, contextBoundary, continuation); err != nil {
		s.persistIdleThreadCompactionGateEvent(endpointID, threadID, runID, operationID, "commit_rejected", map[string]any{
			"reason": strings.TrimSpace(err.Error()),
		})
		return err
	}
	s.persistIdleThreadCompactionGateEvent(endpointID, threadID, runID, operationID, "commit_persisted", nil)
	return nil
}

func (s *Service) publishIdleContextCompaction(endpointID string, threadID string, runID string, compaction FlowerContextCompaction, anchor FlowerTimelineAnchor) {
	if s == nil || !validFlowerTimelineAnchor(anchor) {
		return
	}
	operationID := strings.TrimSpace(compaction.OperationID)
	if operationID == "" {
		return
	}
	compaction.RunID = strings.TrimSpace(runID)
	if compaction.UpdatedAtMs <= 0 {
		compaction.UpdatedAtMs = time.Now().UnixMilli()
	}
	decoration := FlowerTimelineDecoration{
		DecorationID: "context-compaction:" + operationID,
		Kind:         "context_compaction",
		Anchor:       anchor,
		Compaction:   compaction,
	}
	s.persistIdleContextCompaction(endpointID, threadID, runID, compaction, decoration)
	s.broadcastStreamEvent(endpointID, threadID, runID, streamEventContextCompaction{
		Type:               "context-compaction",
		Compaction:         compaction,
		TimelineDecoration: decoration,
	})
}

func (s *Service) persistIdleContextCompaction(endpointID string, threadID string, runID string, compaction FlowerContextCompaction, decoration FlowerTimelineDecoration) {
	if s == nil {
		return
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	runID = strings.TrimSpace(runID)
	if endpointID == "" || threadID == "" || runID == "" {
		return
	}
	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		return
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	raw := mustFlowerPayload(FlowerLiveContextCompactionUpdatedPayload{
		Compaction:         compaction,
		TimelineDecoration: decoration,
	})
	ctx, cancel := context.WithTimeout(context.Background(), persistTO)
	defer cancel()
	if err := db.AppendRunEvent(ctx, threadstore.RunEventRecord{
		EndpointID:  endpointID,
		ThreadID:    threadID,
		RunID:       runID,
		StreamKind:  string(RealtimeStreamKindContext),
		EventType:   string(FlowerLiveContextCompactionUpdated),
		PayloadJSON: string(raw),
		AtUnixMs:    compaction.UpdatedAtMs,
	}); err != nil && s.log != nil {
		s.log.Warn("persist idle compaction event failed", "thread_id", threadID, "run_id", runID, "operation_id", compaction.OperationID, "phase", compaction.Phase, "error", err)
	}
}

func (a *threadActor) handleCompactThreadContext(ctx context.Context, meta *session.Meta, req CompactThreadContextRequest) (CompactThreadContextResponse, error) {
	if a == nil || a.mgr == nil || a.mgr.svc == nil {
		return CompactThreadContextResponse{}, errors.New("service not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return CompactThreadContextResponse{}, err
	}
	if !a.mgr.svc.Enabled() {
		return CompactThreadContextResponse{}, ErrNotConfigured
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID := strings.TrimSpace(req.ThreadID)
	if endpointID == "" || endpointID != strings.TrimSpace(a.endpointID) || threadID == "" || threadID != strings.TrimSpace(a.threadID) {
		return CompactThreadContextResponse{}, errors.New("invalid request")
	}
	source := compactThreadContextSourceSlashCommand

	a.mgr.svc.mu.Lock()
	db := a.mgr.svc.threadsDB
	persistTO := a.mgr.svc.persistOpTO
	a.mgr.svc.mu.Unlock()
	if db == nil {
		return CompactThreadContextResponse{}, errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	tctx, cancel := context.WithTimeout(ctx, persistTO)
	th, err := db.GetThread(tctx, endpointID, threadID)
	cancel()
	if err != nil {
		return CompactThreadContextResponse{}, err
	}
	if th == nil {
		return CompactThreadContextResponse{}, errors.New("thread not found")
	}
	if err := a.mgr.svc.requireThreadMutable(ctx, db, endpointID, threadID); err != nil {
		return CompactThreadContextResponse{}, err
	}
	runStatus, _, _ := normalizeThreadRunState(th.RunStatus, th.RunErrorCode, th.RunError)
	if NormalizeRunState(runStatus) == RunStateWaitingUser || requestUserInputPromptFromThreadRecord(th, runStatus) != nil {
		return CompactThreadContextResponse{}, ErrWaitingUserQueueConflict
	}

	activeRunID, activeRun := a.lookupActiveRun(endpointID, threadID)
	activeRunRequestID := strings.TrimSpace(req.ActiveRunID)
	if activeRunID != "" {
		if activeRunRequestID != "" && activeRunRequestID != activeRunID {
			return CompactThreadContextResponse{}, ErrRunChanged
		}
		requestID, err := newManualCompactionRequestID()
		if err != nil {
			return CompactThreadContextResponse{}, err
		}
		manual, enqueueErr := activeRun.EnqueueManualCompaction(ctx, flruntime.ManualCompactionRequest{
			RequestID:   requestID,
			Source:      source,
			RequestedAt: time.Now(),
		})
		if enqueueErr != nil && !errors.Is(enqueueErr, ErrCompactAlreadyPending) {
			return CompactThreadContextResponse{}, enqueueErr
		}
		kind := "accepted"
		if errors.Is(enqueueErr, ErrCompactAlreadyPending) {
			kind = "already_pending"
		}
		return CompactThreadContextResponse{
			OperationID: strings.TrimSpace(manual.RequestID),
			Kind:        kind,
		}, nil
	}
	if activeRunRequestID != "" {
		return CompactThreadContextResponse{}, ErrRunChanged
	}
	runID, err := NewRunID()
	if err != nil {
		return CompactThreadContextResponse{}, err
	}
	requestID, err := newManualCompactionRequestID()
	if err != nil {
		return CompactThreadContextResponse{}, err
	}
	operationID := idleManualCompactionOperationID(runID, requestID)
	anchor, err := a.mgr.svc.lastVisibleFlowerTimelineAnchor(ctx, endpointID, threadID)
	if err != nil {
		return CompactThreadContextResponse{}, err
	}
	if !validFlowerTimelineAnchor(anchor) {
		return CompactThreadContextResponse{}, ErrNoCompactableContext
	}
	boundaryCtx, cancelBoundary := context.WithTimeout(ctx, persistTO)
	contextBoundary, err := db.CurrentThreadContextBoundary(boundaryCtx, endpointID, threadID)
	cancelBoundary()
	if err != nil {
		return CompactThreadContextResponse{}, err
	}
	startedAt := time.Now()
	bgCtx, cancelBg := context.WithCancel(context.Background())
	if begin, gateErr := a.mgr.svc.beginIdleThreadCompaction(endpointID, threadID, operationID, runID, anchor, contextBoundary, cancelBg); gateErr != nil {
		return CompactThreadContextResponse{}, gateErr
	} else if !begin.Started {
		return CompactThreadContextResponse{OperationID: begin.OperationID, Kind: "already_pending"}, nil
	}
	manual := flruntime.ManualCompactionRequest{
		RequestID:   requestID,
		Source:      source,
		RequestedAt: startedAt,
	}
	a.mgr.svc.publishIdleContextCompaction(endpointID, threadID, runID, FlowerContextCompaction{
		OperationID: operationID,
		RunID:       runID,
		Phase:       "start",
		Status:      "compacting",
		Trigger:     "manual",
		Reason:      "manual",
		UpdatedAtMs: startedAt.UnixMilli(),
	}, anchor)
	metaCopy := *meta
	threadCopy := *th
	go func() {
		defer a.mgr.svc.finishIdleThreadCompaction(endpointID, threadID, operationID)
		if err := a.mgr.svc.runIdleThreadCompaction(bgCtx, &metaCopy, &threadCopy, runID, manual, anchor, contextBoundary); err != nil {
			if !a.mgr.svc.isIdleThreadCompactionCurrent(endpointID, threadID, operationID) {
				if a.mgr.svc.log != nil {
					a.mgr.svc.log.Debug("idle thread compaction stopped before commit", "thread_id", threadID, "operation_id", operationID, "error", err)
				}
				return
			}
			phase := "failed"
			status := "failed"
			if idleThreadCompactionExpired(err) {
				phase = "cancelled"
				status = "cancelled"
			} else if a.mgr.svc.log != nil {
				a.mgr.svc.log.Warn("idle thread compaction failed", "thread_id", threadID, "operation_id", operationID, "error", err)
			}
			if a.mgr.svc.log != nil {
				a.mgr.svc.log.Debug("idle thread compaction reached terminal state", "thread_id", threadID, "operation_id", operationID, "phase", phase, "error", err)
			}
			a.mgr.svc.publishIdleContextCompaction(endpointID, threadID, runID, FlowerContextCompaction{
				OperationID: operationID,
				RunID:       runID,
				Phase:       phase,
				Status:      status,
				Trigger:     "manual",
				Reason:      "manual",
				Error:       strings.TrimSpace(err.Error()),
				UpdatedAtMs: time.Now().UnixMilli(),
			}, anchor)
		}
	}()
	return CompactThreadContextResponse{OperationID: operationID, Kind: "started"}, nil
}

func (s *Service) runIdleThreadCompaction(ctx context.Context, meta *session.Meta, th *threadstore.Thread, runID string, manual flruntime.ManualCompactionRequest, anchor FlowerTimelineAnchor, contextBoundary threadstore.ThreadContextBoundary) error {
	if s == nil {
		return errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if meta == nil || th == nil {
		return errors.New("invalid request")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID := strings.TrimSpace(th.ThreadID)
	if endpointID == "" || threadID == "" || strings.TrimSpace(runID) == "" || strings.TrimSpace(manual.RequestID) == "" {
		return errors.New("invalid request")
	}

	s.mu.Lock()
	cfg := s.cfg
	db := s.threadsDB
	persistTO := s.persistOpTO
	desktopModelSource := s.desktopModelSource
	uploadsDir := s.uploadsDir
	runMaxWallTime := s.runMaxWallTime
	runIdleTimeout := s.runIdleTimeout
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	if cfg == nil && (desktopModelSource == nil || !desktopModelSource.hasBinding()) {
		return ErrNotConfigured
	}
	permissionType, err := normalizePermissionType(threadPermissionTypeString(th, ""), FlowerPermissionApprovalRequired)
	if err != nil {
		permissionType = FlowerPermissionApprovalRequired
	}
	runWorkingDir := strings.TrimSpace(th.WorkingDir)
	if runWorkingDir == "" {
		runWorkingDir = strings.TrimSpace(s.agentHomeDir)
	}
	messageID, err := newMessageID()
	if err != nil {
		return err
	}
	if !validFlowerTimelineAnchor(anchor) {
		return ErrNoCompactableContext
	}
	metaCopy := *meta
	r := newRun(runOptions{
		Log:                          s.log,
		StateDir:                     s.stateDir,
		AgentHomeDir:                 s.agentHomeDir,
		WorkingDir:                   runWorkingDir,
		FilesystemScope:              s.scope,
		Shell:                        s.shell,
		AIConfig:                     cfg,
		SessionMeta:                  &metaCopy,
		ResolveProviderKey:           s.resolveProviderKey,
		ResolveWebSearchKey:          s.resolveWebSearchKey,
		DesktopModelSource:           desktopModelSource,
		RunID:                        runID,
		ChannelID:                    strings.TrimSpace(meta.ChannelID),
		EndpointID:                   endpointID,
		ThreadID:                     threadID,
		UserPublicID:                 strings.TrimSpace(meta.UserPublicID),
		MessageID:                    messageID,
		UploadsDir:                   uploadsDir,
		ThreadsDB:                    db,
		PersistOpTimeout:             persistTO,
		HostManagedContextCompaction: true,
		MaxWallTime:                  runMaxWallTime,
		IdleTimeout:                  runIdleTimeout,
		OnStreamEvent: func(ev any) {
			s.broadcastStreamEvent(endpointID, threadID, runID, ev)
		},
	})
	execCtx, cancelRun := context.WithCancel(ctx)
	var cancelMaxWall context.CancelFunc
	if runMaxWallTime > 0 {
		execCtx, cancelMaxWall = context.WithTimeout(execCtx, runMaxWallTime)
	}
	r.muCancel.Lock()
	r.cancelFn = cancelRun
	alreadyCanceled := r.cancelRequested
	r.muCancel.Unlock()
	if alreadyCanceled {
		cancelRun()
	}
	defer func() {
		cancelRun()
		if cancelMaxWall != nil {
			cancelMaxWall()
		}
		r.markDone()
	}()
	if r.idleTimeout > 0 && r.activityCh != nil {
		r.touchActivity()
		go r.runIdleWatchdog(execCtx)
	}
	r.setContextCompactionAnchor(strings.TrimSpace(manual.RequestID), anchor)
	r.setContextCompactionAnchor(idleManualCompactionOperationID(runID, manual.RequestID), anchor)
	r.permissionType = permissionType
	_, modelCapability, reasoning, providerCfg, apiKey, adapterOverride, err := s.resolveIdleCompactionModel(execCtx, cfg, th, r)
	if err != nil {
		return err
	}
	providerType := strings.ToLower(strings.TrimSpace(providerCfg.Type))
	var adapter ModelGateway
	if adapterOverride != nil {
		adapter = adapterOverride
	} else {
		adapter, err = newProviderAdapter(providerType, strings.TrimSpace(providerCfg.BaseURL), strings.TrimSpace(apiKey), providerCfg.StrictToolSchema)
		if err != nil {
			return err
		}
	}
	flProvider := newFloretProviderAdapter(
		adapter,
		providerType,
		strings.TrimSpace(modelCapability.WireModelName),
		ProviderControls{
			ReasoningSelection:  reasoning,
			ReasoningCapability: modelCapability.ReasoningCapability,
		},
		TurnBudgets{},
		"",
	)
	labels := flruntime.RunLabels{
		Correlation: map[string]string{"thread_id": threadID, "message_id": messageID},
		Host:        floretHostLabelsForRun(r),
	}
	providerContinuation := newProviderContinuationProjector(r, providerCfg.ID, providerType, strings.TrimSpace(modelCapability.WireModelName), providerCfg.BaseURL)
	previousState, err := providerContinuation.PreviousState(execCtx)
	if err != nil {
		return err
	}
	contextWindow := modelGatewayDefaultContextWindowTokens
	if modelCapability.MaxContextTokens > 0 {
		contextWindow = modelCapability.MaxContextTokens
	}
	systemPrompt := r.buildLayeredSystemPrompt("", permissionTypeString(permissionType), TaskComplexityStandard, 0, true, nil, runtimeState{}, "", runCapabilityContract{})
	store, err := r.openFloretThreadStore()
	if err != nil {
		return err
	}
	defer func() { _ = store.Close() }()
	host, err := flruntime.NewHost(flruntime.HostOptions{
		Config:               flconfig.Config{SystemPrompt: systemPrompt, ContextPolicy: floretModelContextPolicy(contextWindow, 0), Reasoning: reasoning},
		ModelGateway:         flProvider,
		ModelGatewayIdentity: redevenFloretGatewayIdentity(providerCfg.ID, modelCapability.WireModelName),
		Store:                store,
		Sink:                 floretEventSink{run: r},
		ThreadTitleMode:      flruntime.ThreadTitleModeHostOwned,
		LoopLimits: flruntime.LoopLimits{
			NoProgressLimit:    2,
			DuplicateToolLimit: 3,
		},
	})
	if err != nil {
		return err
	}
	if err := ensureFloretThread(execCtx, host, flruntime.ThreadID(threadID)); err != nil {
		return err
	}
	result, err := host.CompactThread(execCtx, flruntime.CompactThreadRequest{
		ThreadID:              flruntime.ThreadID(threadID),
		RequestID:             strings.TrimSpace(manual.RequestID),
		Source:                strings.TrimSpace(manual.Source),
		Labels:                labels,
		PreviousProviderState: previousState,
		Limits: flruntime.TurnLimits{
			MaxToolCalls:           modelGatewayHardMaxToolCalls,
			MaxLengthContinuations: 2,
		},
		Reasoning: reasoning,
	})
	if err != nil {
		return err
	}
	operationID := idleManualCompactionOperationID(runID, manual.RequestID)
	switch idleCompactThreadResultStatus(result) {
	case "compacted":
	case "noop":
		s.publishIdleContextCompaction(endpointID, threadID, runID, FlowerContextCompaction{
			OperationID:         operationID,
			RunID:               runID,
			Phase:               "noop",
			Status:              "noop",
			Trigger:             "manual",
			Reason:              "manual",
			TokensBefore:        result.Metrics.ProviderUsage.InputTokens,
			TokensAfterEstimate: result.Metrics.ProviderUsage.WindowInputTokens,
			UpdatedAtMs:         time.Now().UnixMilli(),
		}, anchor)
		return nil
	default:
		return ErrNoCompactableContext
	}
	pctx, cancel := context.WithTimeout(context.Background(), persistTO)
	continuation := providerContinuation.Candidate(floretProviderStateToFlower(result.ProviderState))
	if err := s.commitIdleThreadCompaction(pctx, db, endpointID, threadID, runID, operationID, continuation); err != nil {
		cancel()
		return err
	}
	cancel()
	s.publishIdleContextCompaction(endpointID, threadID, runID, FlowerContextCompaction{
		OperationID:         operationID,
		RunID:               runID,
		Phase:               "complete",
		Status:              "compacted",
		Trigger:             "manual",
		Reason:              "manual",
		TokensBefore:        result.Metrics.ProviderUsage.InputTokens,
		TokensAfterEstimate: result.Metrics.ProviderUsage.WindowInputTokens,
		UpdatedAtMs:         time.Now().UnixMilli(),
	}, anchor)
	s.broadcastThreadSummary(endpointID, threadID)
	return nil
}

func (s *Service) resolveIdleCompactionModel(ctx context.Context, cfg *config.AIConfig, th *threadstore.Thread, r *run) (string, contextmodel.ModelCapability, config.AIReasoningSelection, config.AIProvider, string, ModelGateway, error) {
	if th == nil || r == nil {
		return "", contextmodel.ModelCapability{}, config.AIReasoningSelection{}, config.AIProvider{}, "", nil, errors.New("invalid request")
	}
	modelCfg, err := s.resolveRunModel(ctx, cfg, "", strings.TrimSpace(th.ModelID), r)
	if err != nil {
		return "", contextmodel.ModelCapability{}, config.AIReasoningSelection{}, config.AIProvider{}, "", nil, err
	}
	modelCapability := modelCfg.Capability
	if modelCapability.ModelName == "" {
		modelCapability.ModelName = modelCfg.ModelName
	}
	if modelCapability.WireModelName == "" {
		modelCapability.WireModelName = modelCfg.WireModelName
	}
	if modelCapability.WireModelName == "" {
		modelCapability.WireModelName = modelCfg.ModelName
	}
	reasoningCapability, modelDefaultReasoning := modelReasoningDefaultsFromCapability(modelCapability)
	threadDefaultReasoning := unmarshalReasoningSelection(th.ReasoningSelectionJSON)
	reasoning, err := resolveEffectiveReasoning(reasoningCapability, config.AIReasoningSelection{}, threadDefaultReasoning, modelDefaultReasoning)
	if err != nil {
		return "", contextmodel.ModelCapability{}, config.AIReasoningSelection{}, config.AIProvider{}, "", nil, reasoningSelectionError(modelCfg.ID, err)
	}
	providerID, _, ok := strings.Cut(modelCfg.ID, "/")
	resolved, err := r.resolveModelGatewayForModel(modelCfg.ID, providerID, ok)
	if err != nil {
		return "", contextmodel.ModelCapability{}, config.AIReasoningSelection{}, config.AIProvider{}, "", nil, err
	}
	if strings.TrimSpace(resolved.userMessage) != "" {
		return "", contextmodel.ModelCapability{}, config.AIReasoningSelection{}, config.AIProvider{}, "", nil, resolved.err
	}
	return modelCfg.ID, modelCapability, reasoning.Effective, resolved.provider, resolved.apiKey, resolved.adapterOverride, nil
}

func (s *Service) lastVisibleFlowerTimelineAnchor(ctx context.Context, endpointID string, threadID string) (FlowerTimelineAnchor, error) {
	if s == nil {
		return FlowerTimelineAnchor{}, errors.New("nil service")
	}
	timeline, err := s.buildFlowerTimelineMessages(ctx, endpointID, threadID, FlowerLiveMaterializedState{})
	if err != nil {
		return FlowerTimelineAnchor{}, err
	}
	return lastVisibleFlowerTimelineAnchorFromTimeline(timeline), nil
}
