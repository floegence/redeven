package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	flconfig "github.com/floegence/floret/config"
	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

const idleCompactionGateRunEventType = "context.compaction.gate"

func idleThreadCompactionExpired(err error) bool {
	return errors.Is(err, context.Canceled) ||
		errors.Is(err, context.DeadlineExceeded) ||
		errors.Is(err, sql.ErrNoRows)
}

type idleThreadCompaction struct {
	mu         sync.Mutex
	endpointID string
	threadID   string
	requestID  string
	runID      string
	anchor     FlowerTimelineAnchor
	cancelled  bool
	cancel     context.CancelFunc
	done       chan struct{}
}

type idleThreadCompactionBeginResult struct {
	RequestID string
	RunID     string
	Started   bool
}

type idleThreadCompactionCancelResult struct {
	Compaction *idleThreadCompaction
	Found      bool
	Cancelled  bool
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

func (c *idleThreadCompaction) busy() bool {
	if c == nil {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return !c.cancelled && strings.TrimSpace(c.requestID) != ""
}

func (s *Service) persistIdleThreadCompactionGateEvent(endpointID string, threadID string, runID string, requestID string, phase string, attrs map[string]any) {
	if s == nil {
		return
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	runID = strings.TrimSpace(runID)
	requestID = strings.TrimSpace(requestID)
	phase = strings.TrimSpace(phase)
	if endpointID == "" || threadID == "" || runID == "" || requestID == "" || phase == "" {
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
	payload["request_id"] = requestID
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
		s.log.Warn("persist idle compaction gate event failed", "thread_id", threadID, "run_id", runID, "request_id", requestID, "phase", phase, "error", err)
	}
}

func (s *Service) beginIdleThreadCompaction(endpointID string, threadID string, requestID string, runID string, anchor FlowerTimelineAnchor, cancel context.CancelFunc) (idleThreadCompactionBeginResult, error) {
	if s == nil {
		return idleThreadCompactionBeginResult{}, errors.New("service not ready")
	}
	thKey := runThreadKey(endpointID, threadID)
	requestID = strings.TrimSpace(requestID)
	runID = strings.TrimSpace(runID)
	if thKey == "" || requestID == "" || runID == "" || !validFlowerTimelineAnchor(anchor) || cancel == nil {
		return idleThreadCompactionBeginResult{}, errors.New("invalid request")
	}
	s.mu.Lock()
	if s.idleCompactionByTh == nil {
		s.idleCompactionByTh = make(map[string]*idleThreadCompaction)
	}
	if activeRunID := strings.TrimSpace(s.activeRunByTh[thKey]); activeRunID != "" {
		s.mu.Unlock()
		cancel()
		return idleThreadCompactionBeginResult{RunID: activeRunID}, ErrThreadBusy
	}
	if existing := s.idleCompactionByTh[thKey]; existing != nil && strings.TrimSpace(existing.requestID) != "" {
		existing.mu.Lock()
		existingRequestID := strings.TrimSpace(existing.requestID)
		existingRunID := strings.TrimSpace(existing.runID)
		existingCancelled := existing.cancelled
		existing.mu.Unlock()
		if existingCancelled {
			delete(s.idleCompactionByTh, thKey)
			s.mu.Unlock()
			s.persistIdleThreadCompactionGateEvent(endpointID, threadID, existingRunID, existingRequestID, "superseded_after_cancel", map[string]any{
				"next_request_id": requestID,
			})
		} else {
			s.mu.Unlock()
			cancel()
			return idleThreadCompactionBeginResult{RequestID: existingRequestID, RunID: existingRunID}, nil
		}
	} else {
		s.mu.Unlock()
	}
	s.mu.Lock()
	if s.idleCompactionByTh == nil {
		s.idleCompactionByTh = make(map[string]*idleThreadCompaction)
	}
	if existing := s.idleCompactionByTh[thKey]; existing != nil && strings.TrimSpace(existing.requestID) != "" {
		existing.mu.Lock()
		existingRequestID := strings.TrimSpace(existing.requestID)
		existingRunID := strings.TrimSpace(existing.runID)
		existing.mu.Unlock()
		s.mu.Unlock()
		cancel()
		return idleThreadCompactionBeginResult{RequestID: existingRequestID, RunID: existingRunID}, nil
	}
	s.idleCompactionByTh[thKey] = &idleThreadCompaction{
		endpointID: endpointID,
		threadID:   threadID,
		requestID:  requestID,
		runID:      runID,
		anchor:     anchor,
		cancel:     cancel,
		done:       make(chan struct{}),
	}
	s.mu.Unlock()
	s.persistIdleThreadCompactionGateEvent(endpointID, threadID, runID, requestID, "registered", nil)
	return idleThreadCompactionBeginResult{RequestID: requestID, RunID: runID, Started: true}, nil
}

func (s *Service) finishIdleThreadCompaction(endpointID string, threadID string, requestID string) {
	if s == nil {
		return
	}
	thKey := runThreadKey(endpointID, threadID)
	requestID = strings.TrimSpace(requestID)
	if thKey == "" || requestID == "" {
		return
	}
	s.mu.Lock()
	var done chan struct{}
	if existing := s.idleCompactionByTh[thKey]; existing != nil && strings.TrimSpace(existing.requestID) == requestID {
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

func (s *Service) idleThreadCompactionRequestID(endpointID string, threadID string) string {
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
	return strings.TrimSpace(existing.requestID)
}

func (s *Service) isIdleThreadCompactionCurrent(endpointID string, threadID string, requestID string) bool {
	if s == nil {
		return false
	}
	thKey := runThreadKey(endpointID, threadID)
	requestID = strings.TrimSpace(requestID)
	if thKey == "" || requestID == "" {
		return false
	}
	s.mu.Lock()
	existing := s.idleCompactionByTh[thKey]
	s.mu.Unlock()
	if existing == nil || strings.TrimSpace(existing.requestID) != requestID {
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
	requestID := strings.TrimSpace(compaction.requestID)
	if !compaction.cancelled {
		compaction.cancelled = true
	}
	compaction.mu.Unlock()
	s.persistIdleThreadCompactionGateEvent(endpointID, threadID, runID, requestID, "cancel_requested", nil)
	compaction.cancelRun()
	return idleThreadCompactionCancelResult{Compaction: compaction, Found: true, Cancelled: true}
}

func (s *Service) cancelIdleThreadCompactionWithBroadcast(endpointID string, threadID string) (*idleThreadCompaction, bool) {
	result := s.cancelIdleThreadCompaction(endpointID, threadID)
	return result.Compaction, result.Found
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
			RequestID: strings.TrimSpace(manual.RequestID),
			Kind:      kind,
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
	anchor, err := a.mgr.svc.lastVisibleFlowerTimelineAnchor(ctx, endpointID, threadID)
	if err != nil {
		return CompactThreadContextResponse{}, err
	}
	if !validFlowerTimelineAnchor(anchor) {
		return CompactThreadContextResponse{}, ErrNoCompactableContext
	}
	startedAt := time.Now()
	bgCtx, cancelBg := context.WithCancel(context.Background())
	if begin, gateErr := a.mgr.svc.beginIdleThreadCompaction(endpointID, threadID, requestID, runID, anchor, cancelBg); gateErr != nil {
		return CompactThreadContextResponse{}, gateErr
	} else if !begin.Started {
		return CompactThreadContextResponse{RequestID: begin.RequestID, Kind: "already_pending"}, nil
	}
	manual := flruntime.ManualCompactionRequest{
		RequestID:   requestID,
		Source:      source,
		RequestedAt: startedAt,
	}
	metaCopy := *meta
	threadCopy := *th
	go func() {
		defer a.mgr.svc.finishIdleThreadCompaction(endpointID, threadID, requestID)
		if err := a.mgr.svc.runIdleThreadCompaction(bgCtx, &metaCopy, &threadCopy, runID, manual, anchor); err != nil {
			if !a.mgr.svc.isIdleThreadCompactionCurrent(endpointID, threadID, requestID) {
				if a.mgr.svc.log != nil {
					a.mgr.svc.log.Debug("idle thread compaction request stopped", "thread_id", threadID, "request_id", requestID, "error", err)
				}
				return
			}
			if !idleThreadCompactionExpired(err) && a.mgr.svc.log != nil {
				a.mgr.svc.log.Warn("idle thread compaction failed", "thread_id", threadID, "request_id", requestID, "error", err)
			}
			if a.mgr.svc.log != nil {
				a.mgr.svc.log.Debug("idle thread compaction reached terminal state", "thread_id", threadID, "request_id", requestID, "error", err)
			}
		}
	}()
	return CompactThreadContextResponse{RequestID: requestID, Kind: "started"}, nil
}

func (s *Service) runIdleThreadCompaction(ctx context.Context, meta *session.Meta, th *threadstore.Thread, runID string, manual flruntime.ManualCompactionRequest, anchor FlowerTimelineAnchor) error {
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
	if !cfg.HasModelProfile() && (desktopModelSource == nil || !desktopModelSource.hasBinding()) {
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
		Log:                 s.log,
		StateDir:            s.stateDir,
		AgentHomeDir:        s.agentHomeDir,
		WorkingDir:          runWorkingDir,
		FilesystemScope:     s.scope,
		Shell:               s.shell,
		Service:             s,
		AIConfig:            cfg,
		SessionMeta:         &metaCopy,
		ResolveProviderKey:  s.resolveProviderKey,
		ResolveWebSearchKey: s.resolveWebSearchKey,
		DesktopModelSource:  desktopModelSource,
		RunID:               runID,
		ChannelID:           strings.TrimSpace(meta.ChannelID),
		EndpointID:          endpointID,
		ThreadID:            threadID,
		UserPublicID:        strings.TrimSpace(meta.UserPublicID),
		MessageID:           messageID,
		UploadsDir:          uploadsDir,
		ThreadsDB:           db,
		FloretStore:         s.floretStore,
		PersistOpTimeout:    persistTO,
		MaxWallTime:         runMaxWallTime,
		IdleTimeout:         runIdleTimeout,
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
	contextWindow := modelGatewayDefaultContextWindowTokens
	if modelCapability.MaxContextTokens > 0 {
		contextWindow = modelCapability.MaxContextTokens
	}
	systemPrompt := r.buildLayeredSystemPrompt("", permissionTypeString(permissionType), TaskComplexityStandard, 0, true, nil, runtimeState{}, "", runCapabilityContract{})
	store := r.floretStore
	if store == nil {
		return errors.New("floret store not ready")
	}
	gatewayIdentity, err := redevenFloretGatewayIdentity(providerCfg.ID, providerType, providerCfg.BaseURL, modelCapability.WireModelName, flProvider.stateCompatibilityRoute())
	if err != nil {
		return err
	}
	host, err := flruntime.NewHost(flruntime.HostOptions{
		Config:               flconfig.Config{SystemPrompt: systemPrompt, ContextPolicy: floretModelContextPolicy(contextWindow, 0), Reasoning: reasoning},
		ModelGateway:         flProvider,
		ModelGatewayIdentity: gatewayIdentity,
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
	r.expectFloretRuntimeEventIdentity("", threadID, "", false)
	result, err := host.CompactThread(execCtx, flruntime.CompactThreadRequest{
		ThreadID:  flruntime.ThreadID(threadID),
		RequestID: strings.TrimSpace(manual.RequestID),
		Source:    strings.TrimSpace(manual.Source),
		Labels:    labels,
		Limits: flruntime.TurnLimits{
			MaxToolCalls:           modelGatewayHardMaxToolCalls,
			MaxLengthContinuations: 2,
		},
		Reasoning: reasoning,
	})
	if result.ThreadID != "" {
		if validationErr := result.Validate(); validationErr != nil {
			return validationErr
		}
		if result.ThreadID != flruntime.ThreadID(threadID) || strings.TrimSpace(result.RequestID) != strings.TrimSpace(manual.RequestID) {
			return errors.New("Floret compact thread result identity mismatch")
		}
	}
	if err != nil {
		return err
	}
	if result.Compaction.Status != observation.CompactionStatusCompacted && result.Compaction.Status != observation.CompactionStatusNoop {
		return fmt.Errorf("Floret compaction completed with status %q", result.Compaction.Status)
	}
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
