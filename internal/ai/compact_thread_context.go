package ai

import (
	"context"
	"errors"
	"strings"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	contextpacker "github.com/floegence/redeven/internal/ai/context/packer"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

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
	source := strings.TrimSpace(req.Source)
	if source == "" {
		source = compactThreadContextSourceSlashCommand
	}
	if source != compactThreadContextSourceSlashCommand {
		return CompactThreadContextResponse{}, errors.New("invalid compact source")
	}

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
	expectedRunID := strings.TrimSpace(req.ExpectedRunID)
	if activeRunID != "" {
		if expectedRunID != "" && expectedRunID != activeRunID {
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
			RunID:       activeRunID,
		}, nil
	}
	if expectedRunID != "" {
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
	if err := a.mgr.svc.runIdleThreadCompaction(ctx, meta, th, runID, flruntime.ManualCompactionRequest{
		RequestID:   requestID,
		Source:      source,
		RequestedAt: time.Now(),
	}); err != nil {
		return CompactThreadContextResponse{}, err
	}
	return CompactThreadContextResponse{OperationID: requestID, Kind: "started", RunID: runID}, nil
}

func (s *Service) runIdleThreadCompaction(ctx context.Context, meta *session.Meta, th *threadstore.Thread, runID string, manual flruntime.ManualCompactionRequest) error {
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
	modeFallback := "act"
	if cfg != nil {
		modeFallback = cfg.EffectiveMode()
	}
	runWorkingDir := strings.TrimSpace(th.WorkingDir)
	if runWorkingDir == "" {
		runWorkingDir = strings.TrimSpace(s.agentHomeDir)
	}
	messageID, err := newMessageID()
	if err != nil {
		return err
	}
	anchor, err := s.lastVisibleFlowerTimelineAnchor(ctx, endpointID, threadID)
	if err != nil {
		return err
	}
	if !validFlowerTimelineAnchor(anchor) {
		return ErrNoCompactableContext
	}
	boundaryCtx, cancelBoundary := context.WithTimeout(context.Background(), persistTO)
	contextBoundary, err := db.CurrentThreadContextBoundary(boundaryCtx, endpointID, threadID)
	cancelBoundary()
	if err != nil {
		return err
	}
	metaCopy := *meta
	r := newRun(runOptions{
		Log:                 s.log,
		StateDir:            s.stateDir,
		AgentHomeDir:        s.agentHomeDir,
		WorkingDir:          runWorkingDir,
		FilesystemScope:     s.scope,
		Shell:               s.shell,
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
		PersistOpTimeout:    persistTO,
	})
	r.setContextCompactionAnchor(strings.TrimSpace(manual.RequestID), anchor)
	_, modelCapability, reasoning, providerCfg, apiKey, adapterOverride, err := s.resolveIdleCompactionModel(ctx, cfg, th, r)
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
		normalizeRunMode(strings.TrimSpace(th.ExecutionMode), modeFallback),
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
	previousState, err := providerContinuation.PreviousState(ctx)
	if err != nil {
		return err
	}
	promptPack := contextmodel.PromptPack{
		ThreadID:                  threadID,
		RunID:                     runID,
		ContextSectionsTokenUsage: map[string]int{},
	}
	if s.contextPacker != nil {
		pack, packErr := s.contextPacker.BuildPromptPack(ctx, contextpacker.BuildInput{
			EndpointID:     endpointID,
			ThreadID:       threadID,
			RunID:          runID,
			Capability:     modelCapability,
			MaxInputTokens: 0,
		})
		if packErr == nil {
			promptPack = pack
		}
	}
	promptPack = s.applyThreadCompactedContextToPromptPack(ctx, endpointID, threadID, promptPack)
	history, err := flowerMessagesToFloret(buildMessagesFromPromptPack(promptPack, ""))
	if err != nil {
		return err
	}
	if len(history) == 0 {
		return ErrNoCompactableContext
	}
	contextWindow := modelGatewayDefaultContextLimit
	if modelCapability.MaxContextTokens > 0 {
		contextWindow = modelCapability.MaxContextTokens
	}
	inputContextLimit := resolveInputContextLimit(contextWindow, 0)
	systemPrompt := r.buildLayeredSystemPrompt(strings.TrimSpace(promptPack.Objective), normalizeRunMode(strings.TrimSpace(th.ExecutionMode), modeFallback), TaskComplexityStandard, 0, true, nil, runtimeState{}, "", runCapabilityContract{})
	result, err := flruntime.CompactProjectedContext(ctx, flruntime.ProjectedTurnOptions{
		Config:       redevenFloretAdapterConfig(systemPrompt, floretContextPolicy(contextWindow, inputContextLimit, 0), reasoning),
		ModelGateway: flProvider,
		Sink:         floretEventSink{run: r},
		CompactionSummarizer: floretProjectedCompactionSummarizer{
			gateway:  flProvider,
			provider: providerType,
			model:    strings.TrimSpace(modelCapability.WireModelName),
			labels:   labels,
		},
	}, flruntime.ProjectedContextCompactionRequest{
		RunID:                 flruntime.RunID(strings.TrimSpace(runID)),
		ThreadID:              flruntime.ThreadID(threadID),
		TurnID:                flruntime.TurnID(messageID),
		TraceID:               flruntime.TraceID(strings.TrimSpace(runID)),
		PromptScopeID:         flruntime.PromptScopeID(threadID),
		History:               history,
		Labels:                labels,
		PreviousProviderState: previousState,
		Reasoning:             reasoning,
		ManualCompaction:      manual,
	})
	if err != nil {
		return err
	}
	compacted := floretProjectedCompactionToThreadCompactedContext(result)
	if compacted.IsZero() {
		return ErrNoCompactableContext
	}
	compacted.CoveredThroughTurnRowID = contextBoundary.TurnRowID
	compacted.CoveredThroughMessageID = contextBoundary.MessageID
	pctx, cancel := context.WithTimeout(context.Background(), persistTO)
	continuation := providerContinuation.Candidate(floretProviderStateToFlower(result.ProviderState))
	if err := db.SetThreadProviderContinuationAndCompactedContext(pctx, endpointID, threadID, continuation, compacted); err != nil {
		cancel()
		return err
	}
	cancel()
	s.broadcastThreadSummary(endpointID, threadID)
	return nil
}

func (s *Service) resolveIdleCompactionModel(ctx context.Context, cfg *config.AIConfig, th *threadstore.Thread, r *run) (string, contextmodel.ModelCapability, config.AIReasoningSelection, config.AIProvider, string, ModelGateway, error) {
	if th == nil || r == nil {
		return "", contextmodel.ModelCapability{}, config.AIReasoningSelection{}, config.AIProvider{}, "", nil, errors.New("invalid request")
	}
	modelCfg, err := s.resolveRunModel(ctx, cfg, "", strings.TrimSpace(th.ModelID), th.ModelLocked, r)
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
