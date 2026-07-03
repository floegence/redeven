package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/ai/threadstore"
	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/okf"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/websearch"
)

type runOptions struct {
	Log             *slog.Logger
	StateDir        string
	AgentHomeDir    string
	WorkingDir      string
	FilesystemScope *filesystemscope.Registry
	Shell           string
	Service         *Service

	AIConfig *config.AIConfig

	SessionMeta         *session.Meta
	ResolveProviderKey  func(providerID string) (string, bool, error)
	ResolveWebSearchKey func(providerID string) (string, bool, error)
	DesktopModelSource  *desktopModelSourceClient

	RunID        string
	ChannelID    string
	EndpointID   string
	ThreadID     string
	UserPublicID string
	MessageID    string

	MaxWallTime         time.Duration
	IdleTimeout         time.Duration
	ToolApprovalTimeout time.Duration
	StreamWriteTimeout  time.Duration

	UploadsDir       string
	ThreadsDB        *threadstore.Store
	PersistOpTimeout time.Duration

	OnStreamEvent func(any)
	Writer        http.ResponseWriter

	SubagentDepth         int
	AllowSubagentDelegate bool
	ToolAllowlist         []string
	NoUserInteraction     bool
	WebSearchToolEnabled  bool
	WebSearchMode         string
	SkillManager          *skillManager
	SubagentRuntime       subagentRuntime
	ToolTargetPolicy      ToolTargetPolicy
	TargetToolExecutor    TargetToolExecutor

	HostManagedContextCompaction bool

	WebFetchHTTPClient *http.Client
	WebFetchResolver   webFetchResolver
}

type run struct {
	log *slog.Logger

	stateDir       string
	agentHomeDir   string
	workingDir     string
	scope          *filesystemscope.Registry
	shell          string
	service        *Service
	cfg            *config.AIConfig
	permissionType FlowerPermissionType

	sessionMeta         *session.Meta
	resolveProviderKey  func(providerID string) (string, bool, error)
	resolveWebSearchKey func(providerID string) (string, bool, error)
	desktopModelSource  *desktopModelSourceClient

	id                 string
	channelID          string
	endpointID         string
	threadID           string
	userPublicID       string
	messageID          string
	settlementThreadID string
	settlementRunID    string
	settlementTurnID   string

	maxWallTime    time.Duration
	idleTimeout    time.Duration
	toolApprovalTO time.Duration
	activityCh     chan struct{}
	doneCh         chan struct{}
	doneOnce       sync.Once

	muCancel           sync.Mutex
	cancelReason       string // "canceled"|"timed_out"|""
	endReason          string // "complete"|"canceled"|"timed_out"|"disconnected"|"error"
	runErrorCode       string
	cancelRequested    bool
	cancelFn           context.CancelFunc
	detached           atomic.Bool // hard-canceled: stop emitting realtime events and skip thread state updates
	busyCount          atomic.Int32
	runtimeToolCalls   atomic.Int64
	runtimeTokens      atomic.Int64
	assistantPersisted atomic.Bool
	terminalSettlement atomic.Bool

	uploadsDir       string
	threadsDB        *threadstore.Store
	persistOpTimeout time.Duration

	onStreamEvent func(any)
	w             http.ResponseWriter
	stream        *ndjsonStream

	mu              sync.Mutex
	toolApprovals   map[string]*toolApprovalRequest
	waitingApproval bool
	floretHost      flruntime.Host

	muLifecycle         sync.Mutex
	lastLifecyclePhase  string
	lastLifecycleAt     time.Time
	lifecycleMinEmitGap time.Duration

	muModelIO         sync.Mutex
	lastModelIOPhase  FlowerModelIOPhase
	lastModelIOStep   int
	modelIOStatusLive bool

	nextBlockIndex            int
	currentTextBlockIndex     int
	needNewTextBlock          bool
	currentThinkingBlockIndex int
	needNewThinkingBlock      bool

	muAssistant              sync.Mutex
	assistantCreatedAtUnixMs int64
	assistantBlocks          []any
	assistantAnswer          assistantAnswerState
	activityFileActions      map[string]FlowerActivityFileAction
	activitySubagentActions  map[string]FlowerActivitySubagentAction
	activityFileActionSeq    int64
	waitingPrompt            *RequestUserInputPrompt
	providerContinuation     threadstore.ThreadProviderContinuation

	finalizationReason string
	currentModelID     string
	currentReasoning   config.AIReasoningSelection

	muManualCompaction                sync.Mutex
	pendingManualCompaction           *flruntime.ManualCompactionRequest
	activeManualCompactionID          string
	activeManualCompactionOperationID string
	completeManualCompactionIDs       map[string]struct{}
	contextCompactionAnchors          map[string]FlowerTimelineAnchor
	completedContextCompaction        observation.CompactionEvent
	hostManagedContextCompaction      bool

	webSearchToolEnabled bool
	webSearchMode        string

	collectedWebSources     map[string]SourceRef // url -> source
	collectedWebSourceOrder []string

	subagentDepth           int
	allowSubagentDelegate   bool
	toolAllowlist           map[string]struct{}
	noUserInteraction       bool
	allowDelegatedApproval  bool
	delegatedApprovalParent *run
	permissionSnapshot      PermissionSnapshot
	dynamicSurfaceConfig    runToolSurfaceConfig
	toolTargetPolicy        ToolTargetPolicy
	targetToolExecutor      TargetToolExecutor

	skillManager    *skillManager
	subagentRuntime subagentRuntime

	webFetchHTTPClient *http.Client
	webFetchResolver   webFetchResolver
}

type activeManualCompaction struct {
	RequestID   string
	OperationID string
}

type assistantAnswerState struct {
	CanonicalMarkdown string
}

type canonicalMarkdownSource string

const (
	canonicalMarkdownSourceNaturalStop canonicalMarkdownSource = "natural_stop"
)

type assistantMarkdownUpdate struct {
	index int
	start bool
	block persistedMarkdownBlock
}

type toolApprovalRequest struct {
	decision      chan bool
	toolName      string
	argsHash      string
	command       string
	cwd           string
	effects       []string
	flags         []string
	targets       []FlowerSafeTarget
	requestedAtMs int64
	expiresAtMs   int64
	resolved      bool
}

func newRun(opts runOptions) *run {
	var runMeta *session.Meta
	if opts.SessionMeta != nil {
		metaCopy := *opts.SessionMeta
		runMeta = &metaCopy
	}

	runID := strings.TrimSpace(opts.RunID)
	if runID == "" {
		if id, err := NewRunID(); err == nil {
			runID = id
		}
	}

	agentHomeDir := strings.TrimSpace(opts.AgentHomeDir)
	workingDir := strings.TrimSpace(opts.WorkingDir)
	if workingDir == "" {
		workingDir = agentHomeDir
	}

	r := &run{
		log:                       opts.Log,
		stateDir:                  strings.TrimSpace(opts.StateDir),
		agentHomeDir:              agentHomeDir,
		workingDir:                workingDir,
		scope:                     opts.FilesystemScope,
		shell:                     strings.TrimSpace(opts.Shell),
		service:                   opts.Service,
		cfg:                       opts.AIConfig,
		permissionType:            FlowerPermissionApprovalRequired,
		sessionMeta:               runMeta,
		resolveProviderKey:        opts.ResolveProviderKey,
		resolveWebSearchKey:       opts.ResolveWebSearchKey,
		desktopModelSource:        opts.DesktopModelSource,
		id:                        runID,
		channelID:                 strings.TrimSpace(opts.ChannelID),
		endpointID:                strings.TrimSpace(opts.EndpointID),
		threadID:                  strings.TrimSpace(opts.ThreadID),
		userPublicID:              strings.TrimSpace(opts.UserPublicID),
		messageID:                 strings.TrimSpace(opts.MessageID),
		settlementThreadID:        strings.TrimSpace(opts.ThreadID),
		settlementRunID:           runID,
		settlementTurnID:          strings.TrimSpace(opts.MessageID),
		uploadsDir:                strings.TrimSpace(opts.UploadsDir),
		threadsDB:                 opts.ThreadsDB,
		persistOpTimeout:          opts.PersistOpTimeout,
		onStreamEvent:             opts.OnStreamEvent,
		w:                         opts.Writer,
		toolApprovals:             make(map[string]*toolApprovalRequest),
		maxWallTime:               opts.MaxWallTime,
		idleTimeout:               opts.IdleTimeout,
		toolApprovalTO:            opts.ToolApprovalTimeout,
		doneCh:                    make(chan struct{}),
		lifecycleMinEmitGap:       600 * time.Millisecond,
		collectedWebSources:       make(map[string]SourceRef),
		collectedWebSourceOrder:   make([]string, 0, 8),
		webSearchToolEnabled:      opts.WebSearchToolEnabled,
		webSearchMode:             strings.TrimSpace(opts.WebSearchMode),
		subagentRuntime:           opts.SubagentRuntime,
		currentThinkingBlockIndex: -1,
		activityFileActions:       make(map[string]FlowerActivityFileAction),
		activitySubagentActions:   make(map[string]FlowerActivitySubagentAction),
		contextCompactionAnchors:  make(map[string]FlowerTimelineAnchor),
		subagentDepth:             opts.SubagentDepth,
		toolTargetPolicy:          normalizeToolTargetPolicy(opts.ToolTargetPolicy),
		targetToolExecutor:        opts.TargetToolExecutor,
		skillManager:              opts.SkillManager,
		noUserInteraction:         opts.NoUserInteraction,
		allowSubagentDelegate: func() bool {
			if opts.AllowSubagentDelegate {
				return true
			}
			return opts.SubagentDepth <= 0
		}(),
		hostManagedContextCompaction: opts.HostManagedContextCompaction,
		webFetchHTTPClient:           opts.WebFetchHTTPClient,
		webFetchResolver:             opts.WebFetchResolver,
	}
	if r.idleTimeout > 0 {
		r.activityCh = make(chan struct{}, 1)
	}
	if len(opts.ToolAllowlist) > 0 {
		r.toolAllowlist = make(map[string]struct{}, len(opts.ToolAllowlist))
		for _, name := range opts.ToolAllowlist {
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			r.toolAllowlist[name] = struct{}{}
		}
	}
	if opts.Writer != nil {
		r.stream = newNDJSONStream(r.w, opts.StreamWriteTimeout)
	}
	return r
}

func (r *run) resolveRunModelCapability(modelID string) contextmodel.ModelCapability {
	modelID = strings.TrimSpace(modelID)
	providerID, modelName, ok := strings.Cut(modelID, "/")
	providerID = strings.TrimSpace(providerID)
	modelName = strings.TrimSpace(modelName)
	if !ok || providerID == "" || modelName == "" {
		if isDesktopModelSourceModelID(modelID) {
			providerID = DesktopModelSourceProviderType
			modelName = modelID
		} else {
			modelName = modelID
		}
	}
	providerType := providerID
	wireModelName := modelName
	if r != nil && r.cfg != nil {
		if provider, providerModel, ok := r.cfg.ProviderModelByID(modelID); ok {
			providerID = strings.TrimSpace(provider.ID)
			providerType = strings.ToLower(strings.TrimSpace(provider.Type))
			modelName = strings.TrimSpace(providerModel.ModelName)
			wireModelName = providerModel.EffectiveWireModelName()
		}
	}
	capability := defaultModelCapability(providerID, modelName, wireModelName)
	if strings.TrimSpace(providerType) != "" {
		capability.ProviderType = strings.ToLower(strings.TrimSpace(providerType))
	}
	if r != nil && r.cfg != nil {
		if provider, providerModel, ok := r.cfg.ProviderModelByID(modelID); ok {
			capability.ReasoningCapability = providerModel.EffectiveReasoningCapability(provider.Type)
		}
	}
	return contextmodel.NormalizeCapability(capability)
}

func (r *run) touchActivity() {
	if r == nil || r.activityCh == nil {
		return
	}
	select {
	case r.activityCh <- struct{}{}:
	default:
	}
}

func (r *run) beginBusy() func() {
	if r == nil {
		return func() {}
	}
	r.busyCount.Add(1)
	return func() {
		r.busyCount.Add(-1)
	}
}

func (r *run) isBusy() bool {
	if r == nil {
		return false
	}
	return r.busyCount.Load() > 0
}

func (r *run) isWaitingApproval() bool {
	if r == nil {
		return false
	}
	r.mu.Lock()
	v := r.waitingApproval
	r.mu.Unlock()
	return v
}

func (r *run) runIdleWatchdog(ctx context.Context) {
	if r == nil || ctx == nil || r.idleTimeout <= 0 || r.activityCh == nil {
		return
	}
	idleTimer := time.NewTimer(r.idleTimeout)
	defer idleTimer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-r.doneCh:
			return
		case <-r.activityCh:
			if !idleTimer.Stop() {
				select {
				case <-idleTimer.C:
				default:
				}
			}
			idleTimer.Reset(r.idleTimeout)
		case <-idleTimer.C:
			// Waiting for the user is not an "idle" run. That lifecycle is bounded by the
			// per-approval timeout (toolApprovalTO), plus the run's max wall time.
			if r.isWaitingApproval() || r.isBusy() {
				idleTimer.Reset(r.idleTimeout)
				continue
			}
			r.requestCancel("timed_out")
			return
		}
	}
}

func (r *run) requestCancel(reason string) {
	if r == nil {
		return
	}
	reason = strings.TrimSpace(reason)
	r.muCancel.Lock()
	if reason != "" && r.cancelReason == "" {
		r.cancelReason = reason
	}
	if reason == "canceled" || reason == "timed_out" {
		if r.endReason == "" {
			r.endReason = reason
		}
		if r.finalizationReason == "" {
			r.finalizationReason = reason
		}
	}
	alreadyRequested := r.cancelRequested
	r.cancelRequested = true
	cancelFn := r.cancelFn
	r.muCancel.Unlock()
	if alreadyRequested || cancelFn == nil {
		return
	}

	// Cancel is a hard instruction:
	// - signal: cancel context immediately to stop new sampling/tool dispatch
	// - grace/force: re-signal after a short delay in case something is stuck
	cancelFn()
	go func() {
		timer := time.NewTimer(500 * time.Millisecond)
		defer timer.Stop()
		select {
		case <-r.doneCh:
			return
		case <-timer.C:
			cancelFn()
		}
	}()
}

func (r *run) getCancelReason() string {
	if r == nil {
		return ""
	}
	r.muCancel.Lock()
	v := strings.TrimSpace(r.cancelReason)
	r.muCancel.Unlock()
	return v
}

func (r *run) setEndReason(reason string) {
	if r == nil {
		return
	}
	r.muCancel.Lock()
	r.endReason = strings.TrimSpace(reason)
	r.muCancel.Unlock()
}

func (r *run) setRunErrorCode(code string) {
	if r == nil {
		return
	}
	r.muCancel.Lock()
	r.runErrorCode = strings.TrimSpace(code)
	r.muCancel.Unlock()
}

func (r *run) getRunErrorCode() string {
	if r == nil {
		return ""
	}
	r.muCancel.Lock()
	v := strings.TrimSpace(r.runErrorCode)
	r.muCancel.Unlock()
	return v
}

func (r *run) getEndReason() string {
	if r == nil {
		return ""
	}
	r.muCancel.Lock()
	v := strings.TrimSpace(r.endReason)
	r.muCancel.Unlock()
	return v
}

func (r *run) setFinalizationReason(reason string) {
	if r == nil {
		return
	}
	r.muCancel.Lock()
	r.finalizationReason = strings.TrimSpace(reason)
	r.muCancel.Unlock()
}

func (r *run) getFinalizationReason() string {
	if r == nil {
		return ""
	}
	r.muCancel.Lock()
	v := strings.TrimSpace(r.finalizationReason)
	r.muCancel.Unlock()
	return v
}

func (r *run) setProviderContinuationCandidate(cont threadstore.ThreadProviderContinuation) {
	if r == nil {
		return
	}
	if !r.acceptsEngineResultProjection() {
		return
	}
	r.muAssistant.Lock()
	r.providerContinuation = cont.Normalized()
	r.muAssistant.Unlock()
}

func (r *run) getProviderContinuationCandidate() threadstore.ThreadProviderContinuation {
	if r == nil {
		return threadstore.ThreadProviderContinuation{}
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	return r.providerContinuation.Normalized()
}

func (r *run) EnqueueManualCompaction(ctx context.Context, request flruntime.ManualCompactionRequest) (flruntime.ManualCompactionRequest, error) {
	if r == nil {
		return flruntime.ManualCompactionRequest{}, errors.New("nil run")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if strings.TrimSpace(request.RequestID) == "" {
		return flruntime.ManualCompactionRequest{}, errors.New("missing manual compaction request id")
	}
	if strings.TrimSpace(request.Source) == "" {
		request.Source = "slash_command"
	}
	if request.RequestedAt.IsZero() {
		request.RequestedAt = time.Now()
	}
	select {
	case <-ctx.Done():
		return flruntime.ManualCompactionRequest{}, ctx.Err()
	case <-r.doneCh:
		return flruntime.ManualCompactionRequest{}, ErrRunChanged
	default:
	}
	if r.isDetached() {
		return flruntime.ManualCompactionRequest{}, ErrRunChanged
	}
	r.muManualCompaction.Lock()
	if r.pendingManualCompaction != nil {
		r.muManualCompaction.Unlock()
		return *r.pendingManualCompaction, ErrCompactAlreadyPending
	}
	if strings.TrimSpace(r.activeManualCompactionID) != "" {
		r.muManualCompaction.Unlock()
		return flruntime.ManualCompactionRequest{}, ErrCompactAlreadyPending
	}
	r.muManualCompaction.Unlock()

	anchor := r.captureFlowerTimelineAnchor()
	if !validFlowerTimelineAnchor(anchor) {
		return flruntime.ManualCompactionRequest{}, ErrNoCompactableContext
	}

	r.muManualCompaction.Lock()
	defer r.muManualCompaction.Unlock()
	if r.pendingManualCompaction != nil {
		return *r.pendingManualCompaction, ErrCompactAlreadyPending
	}
	if strings.TrimSpace(r.activeManualCompactionID) != "" {
		return flruntime.ManualCompactionRequest{}, ErrCompactAlreadyPending
	}
	pending := request
	requestID := strings.TrimSpace(pending.RequestID)
	if r.contextCompactionAnchors == nil {
		r.contextCompactionAnchors = make(map[string]FlowerTimelineAnchor)
	}
	r.contextCompactionAnchors[requestID] = anchor
	r.pendingManualCompaction = &pending
	r.touchActivity()
	return pending, nil
}

func (r *run) PollManualCompaction(ctx context.Context, req flruntime.ManualCompactionPollRequest) (flruntime.ManualCompactionRequest, bool, error) {
	if r == nil {
		return flruntime.ManualCompactionRequest{}, false, nil
	}
	if ctx != nil {
		select {
		case <-ctx.Done():
			return flruntime.ManualCompactionRequest{}, false, ctx.Err()
		default:
		}
	}
	r.muManualCompaction.Lock()
	defer r.muManualCompaction.Unlock()
	if r.pendingManualCompaction == nil || strings.TrimSpace(r.activeManualCompactionID) != "" {
		return flruntime.ManualCompactionRequest{}, false, nil
	}
	manual := *r.pendingManualCompaction
	r.pendingManualCompaction = nil
	requestID := strings.TrimSpace(manual.RequestID)
	r.activeManualCompactionID = requestID
	r.activeManualCompactionOperationID = strings.TrimSpace(flruntime.ManualCompactionOperationID(req.RunID, req.Step, requestID))
	return manual, true, nil
}

func (r *run) finishManualCompaction(requestID string) {
	if r == nil {
		return
	}
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return
	}
	r.muManualCompaction.Lock()
	defer r.muManualCompaction.Unlock()
	if strings.TrimSpace(r.activeManualCompactionID) == requestID {
		r.activeManualCompactionID = ""
		r.activeManualCompactionOperationID = ""
	}
	if r.completeManualCompactionIDs == nil {
		r.completeManualCompactionIDs = map[string]struct{}{}
	}
	r.completeManualCompactionIDs[requestID] = struct{}{}
}

func (r *run) unfinishedManualCompactions() []activeManualCompaction {
	if r == nil {
		return nil
	}
	r.muManualCompaction.Lock()
	defer r.muManualCompaction.Unlock()
	seen := make(map[string]struct{}, 2)
	out := make([]activeManualCompaction, 0, 2)
	if r.pendingManualCompaction != nil {
		if requestID := strings.TrimSpace(r.pendingManualCompaction.RequestID); requestID != "" {
			if _, ok := r.completeManualCompactionIDs[requestID]; !ok {
				seen[requestID] = struct{}{}
				out = append(out, activeManualCompaction{RequestID: requestID, OperationID: requestID})
			}
		}
		r.pendingManualCompaction = nil
	}
	if requestID := strings.TrimSpace(r.activeManualCompactionID); requestID != "" {
		if _, complete := r.completeManualCompactionIDs[requestID]; !complete {
			if _, duplicate := seen[requestID]; !duplicate {
				operationID := strings.TrimSpace(r.activeManualCompactionOperationID)
				if operationID == "" {
					operationID = requestID
				}
				out = append(out, activeManualCompaction{RequestID: requestID, OperationID: operationID})
			}
		}
		r.activeManualCompactionID = ""
		r.activeManualCompactionOperationID = ""
	}
	return out
}

func (r *run) cancelUnfinishedManualCompactions(reason string) {
	if r == nil {
		return
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "run_finished"
	}
	for _, compaction := range r.unfinishedManualCompactions() {
		r.applyFloretCompaction(&observation.CompactionEvent{
			OperationID: compaction.OperationID,
			RequestID:   compaction.RequestID,
			RunID:       strings.TrimSpace(r.id),
			ThreadID:    strings.TrimSpace(r.threadID),
			TurnID:      strings.TrimSpace(r.messageID),
			Phase:       observation.CompactionPhaseCancelled,
			Status:      observation.CompactionStatusCancelled,
			Trigger:     "manual",
			Reason:      reason,
			ObservedAt:  time.Now(),
		})
	}
}

func (r *run) noteManualCompactionOperation(requestID string, operationID string) {
	if r == nil {
		return
	}
	requestID = strings.TrimSpace(requestID)
	operationID = strings.TrimSpace(operationID)
	if requestID == "" || operationID == "" {
		return
	}
	r.muManualCompaction.Lock()
	defer r.muManualCompaction.Unlock()
	if strings.TrimSpace(r.activeManualCompactionID) == requestID {
		r.activeManualCompactionOperationID = operationID
	}
}

func (r *run) setCompletedContextCompaction(compaction observation.CompactionEvent) {
	if r == nil {
		return
	}
	if strings.TrimSpace(compaction.OperationID) == "" {
		return
	}
	r.muManualCompaction.Lock()
	r.completedContextCompaction = compaction
	r.muManualCompaction.Unlock()
}

func (r *run) getCompletedContextCompaction() observation.CompactionEvent {
	if r == nil {
		return observation.CompactionEvent{}
	}
	r.muManualCompaction.Lock()
	defer r.muManualCompaction.Unlock()
	return r.completedContextCompaction
}

func (r *run) recordRuntimeToolCall() {
	if r == nil {
		return
	}
	r.runtimeToolCalls.Add(1)
}

func (r *run) recordRuntimeTurnUsage(usage TurnUsage, estimateTokens int) {
	if r == nil {
		return
	}
	total := usage.InputTokens + usage.OutputTokens + usage.ReasoningTokens
	if total <= 0 && estimateTokens > 0 {
		total = int64(estimateTokens)
	}
	if total <= 0 {
		return
	}
	r.runtimeTokens.Add(total)
}

func (r *run) cancel() {
	if r == nil {
		return
	}

	r.muCancel.Lock()
	r.cancelRequested = true
	cancelFn := r.cancelFn
	r.muCancel.Unlock()

	if cancelFn != nil {
		cancelFn()
	}

}

func (r *run) markDetached() {
	if r == nil {
		return
	}
	r.detached.Store(true)
}

func (r *run) isDetached() bool {
	if r == nil {
		return true
	}
	return r.detached.Load()
}

func (r *run) acceptsPresentationUpdates() bool {
	return r != nil && !r.isDetached()
}

func (r *run) acceptsEngineResultProjection() bool {
	return r != nil && !r.isDetached()
}

func (r *run) sendStreamEvent(ev any) {
	if r == nil || ev == nil {
		return
	}

	r.touchActivity()
	if r.detached.Load() {
		return
	}
	if r.onStreamEvent != nil {
		r.onStreamEvent(ev)
	}
	if r.stream == nil {
		return
	}
	publicEvent, ok := sanitizePublicStreamEvent(ev)
	if !ok {
		return
	}
	if err := r.stream.send(publicEvent); err != nil {
		if r.log != nil {
			r.log.Debug("ai stream sink write failed", "run_id", r.id, "error", err)
		}
	}
}

func sanitizePublicStreamEvent(ev any) (any, bool) {
	blockSet, ok := ev.(streamEventBlockSet)
	if !ok || !isActivityTimelineBlockValue(blockSet.Block) {
		return ev, true
	}
	block, err := SanitizeActivityTimelineBlockValue(blockSet.Block)
	if err != nil {
		return nil, false
	}
	blockSet.Block = block
	return blockSet, true
}

func (r *run) updateModelIOStatus(phase FlowerModelIOPhase, stepIndex int) {
	if r == nil || phase == "" {
		return
	}
	if !r.acceptsPresentationUpdates() {
		return
	}
	r.muModelIO.Lock()
	if r.modelIOStatusLive && r.lastModelIOPhase == phase && r.lastModelIOStep == stepIndex {
		r.muModelIO.Unlock()
		return
	}
	r.lastModelIOPhase = phase
	r.lastModelIOStep = stepIndex
	r.modelIOStatusLive = true
	r.muModelIO.Unlock()
	r.sendStreamEvent(streamEventModelIOStatus{
		Type:        "model-io-status",
		Phase:       string(phase),
		RunID:       strings.TrimSpace(r.id),
		StepIndex:   stepIndex,
		UpdatedAtMs: time.Now().UnixMilli(),
	})
}

func (r *run) clearModelIOStatus() {
	if r == nil {
		return
	}
	if !r.acceptsPresentationUpdates() {
		return
	}
	r.muModelIO.Lock()
	if !r.modelIOStatusLive {
		r.muModelIO.Unlock()
		return
	}
	r.lastModelIOPhase = ""
	r.lastModelIOStep = 0
	r.modelIOStatusLive = false
	r.muModelIO.Unlock()
	r.sendStreamEvent(streamEventModelIOStatus{
		Type:        "model-io-status",
		RunID:       strings.TrimSpace(r.id),
		UpdatedAtMs: time.Now().UnixMilli(),
	})
}

func isActivityTimelineBlockValue(value any) bool {
	switch v := value.(type) {
	case ActivityTimelineBlock:
		return true
	case *ActivityTimelineBlock:
		return v != nil
	case map[string]any:
		return strings.TrimSpace(anyToString(v["type"])) == activityTimelineBlockType
	default:
		return false
	}
}

func (r *run) markDone() {
	if r == nil || r.doneCh == nil {
		return
	}
	r.doneOnce.Do(func() {
		close(r.doneCh)
	})
}

func (r *run) markAssistantPersisted() {
	if r == nil {
		return
	}
	r.assistantPersisted.Store(true)
}

func (r *run) assistantAlreadyPersisted() bool {
	return r != nil && r.assistantPersisted.Load()
}

func (r *run) debug(event string, attrs ...any) {
	if r == nil || r.log == nil {
		return
	}
	event = strings.TrimSpace(event)
	if event == "" {
		event = "ai.run"
	}
	base := []any{
		"event", event,
		"run_id", strings.TrimSpace(r.id),
		"thread_id", strings.TrimSpace(r.threadID),
		"endpoint_id", strings.TrimSpace(r.endpointID),
		"channel_id", strings.TrimSpace(r.channelID),
	}
	base = append(base, attrs...)
	r.log.Debug("ai run", base...)
}

func normalizeLifecyclePhase(raw string) string {
	phase := strings.TrimSpace(strings.ToLower(raw))
	switch phase {
	case "start", "planning":
		return "planning"
	case "tool_call", "tool", "executing_tools":
		return "executing_tools"
	case "synthesis", "synthesizing":
		return "synthesizing"
	case "end", "finalizing", "finish":
		return "finalizing"
	default:
		if phase == "" {
			return ""
		}
		return phase
	}
}

func (r *run) emitLifecyclePhase(raw string, diag map[string]any) {
	if r == nil {
		return
	}
	phase := normalizeLifecyclePhase(raw)
	if phase == "" {
		return
	}
	now := time.Now()
	r.muLifecycle.Lock()
	if strings.EqualFold(strings.TrimSpace(r.lastLifecyclePhase), phase) && r.lifecycleMinEmitGap > 0 && !r.lastLifecycleAt.IsZero() {
		if now.Sub(r.lastLifecycleAt) < r.lifecycleMinEmitGap {
			r.muLifecycle.Unlock()
			return
		}
	}
	r.lastLifecyclePhase = phase
	r.lastLifecycleAt = now
	r.muLifecycle.Unlock()

	eventDiag := map[string]any{"phase": phase}
	for k, v := range diag {
		eventDiag[k] = v
	}
	r.sendStreamEvent(streamEventLifecyclePhase{
		Type:      "lifecycle-phase",
		MessageID: strings.TrimSpace(r.messageID),
		Phase:     phase,
		Diag:      eventDiag,
	})
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return strings.TrimSpace(err.Error())
}

func (r *run) persistTimeout() time.Duration {
	if r == nil {
		return 0
	}
	if r.persistOpTimeout > 0 {
		return r.persistOpTimeout
	}
	return 10 * time.Second
}

func (r *run) persistRunRecord(state RunState, errCode string, errMessage string, startedAt int64, endedAt int64) {
	if r == nil || r.threadsDB == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), r.persistTimeout())
	defer cancel()
	now := time.Now().UnixMilli()
	state = NormalizeRunState(string(state))
	rec := threadstore.RunRecord{
		RunID:           strings.TrimSpace(r.id),
		EndpointID:      strings.TrimSpace(r.endpointID),
		ThreadID:        strings.TrimSpace(r.threadID),
		MessageID:       strings.TrimSpace(r.messageID),
		State:           string(state),
		ErrorCode:       strings.TrimSpace(errCode),
		ErrorMessage:    strings.TrimSpace(errMessage),
		AttemptCount:    1,
		StartedAtUnixMs: startedAt,
		EndedAtUnixMs:   endedAt,
		UpdatedAtUnixMs: now,
	}
	if err := r.threadsDB.UpsertRun(ctx, rec); err != nil && r.log != nil {
		r.log.Warn("persist run record failed", "run_id", rec.RunID, "thread_id", rec.ThreadID, "state", rec.State, "error", err)
	}
}

func (r *run) persistRunEvent(eventType string, streamKind RealtimeStreamKind, payload map[string]any) {
	if r == nil || r.threadsDB == nil {
		return
	}
	eventType = strings.TrimSpace(eventType)
	if eventType == "" {
		return
	}
	if payload == nil {
		payload = map[string]any{}
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), r.persistTimeout())
	defer cancel()
	if err := r.threadsDB.AppendRunEvent(ctx, threadstore.RunEventRecord{
		EndpointID:  strings.TrimSpace(r.endpointID),
		ThreadID:    strings.TrimSpace(r.threadID),
		RunID:       strings.TrimSpace(r.id),
		StreamKind:  string(streamKind),
		EventType:   eventType,
		PayloadJSON: truncateRunes(string(b), 6000),
		AtUnixMs:    time.Now().UnixMilli(),
	}); err != nil && r.log != nil {
		r.log.Warn("persist run event failed", "thread_id", strings.TrimSpace(r.threadID), "run_id", strings.TrimSpace(r.id), "event_type", eventType, "stream_kind", streamKind, "error", err)
	}
}

func (r *run) persistToolCall(rec threadstore.ToolCallRecord) {
	if r == nil || r.threadsDB == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), r.persistTimeout())
	defer cancel()
	_ = r.threadsDB.UpsertToolCall(ctx, rec)
}

func executionSpanID(runID string, name string, token string) string {
	runID = strings.TrimSpace(runID)
	name = strings.TrimSpace(name)
	token = strings.TrimSpace(token)
	sum := sha256.Sum256([]byte(runID + "|" + name + "|" + token))
	return "span_" + hex.EncodeToString(sum[:12])
}

func (r *run) persistExecutionSpan(rec threadstore.ExecutionSpanRecord) {
	if r == nil || r.threadsDB == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), r.persistTimeout())
	defer cancel()
	_ = r.threadsDB.UpsertExecutionSpan(ctx, rec)
}

func sanitizeLogText(raw string, maxRunes int) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	cleaned := strings.Map(func(r rune) rune {
		switch {
		case r == '\n', r == '\r', r == '\t':
			return ' '
		case r < 0x20 || r == 0x7f:
			return ' '
		default:
			return r
		}
	}, raw)
	cleaned = strings.Join(strings.Fields(cleaned), " ")
	if maxRunes > 0 {
		rs := []rune(cleaned)
		if len(rs) > maxRunes {
			return string(rs[:maxRunes]) + "... (truncated)"
		}
	}
	return cleaned
}

func isSensitiveLogKey(key string) bool {
	k := strings.ToLower(strings.TrimSpace(key))
	if k == "" {
		return false
	}
	direct := map[string]struct{}{
		"content_utf8":   {},
		"content_base64": {},
		"stdin":          {},
		"api_key":        {},
		"apikey":         {},
		"authorization":  {},
		"cookie":         {},
		"set_cookie":     {},
		"password":       {},
		"secret":         {},
		"token":          {},
	}
	if _, ok := direct[k]; ok {
		return true
	}
	return strings.Contains(k, "token") || strings.Contains(k, "secret") || strings.Contains(k, "password") || strings.Contains(k, "api_key")
}

func redactAnyForLog(key string, in any, depth int) any {
	if depth > 4 {
		return "[omitted]"
	}
	if isSensitiveLogKey(key) {
		switch v := in.(type) {
		case string:
			return fmt.Sprintf("[redacted:%d chars]", utf8.RuneCountInString(v))
		case []byte:
			return fmt.Sprintf("[redacted:%d bytes]", len(v))
		default:
			return "[redacted]"
		}
	}
	switch v := in.(type) {
	case string:
		return sanitizeLogText(v, 200)
	case []byte:
		return fmt.Sprintf("[bytes:%d]", len(v))
	case map[string]any:
		out := make(map[string]any, len(v))
		for k, vv := range v {
			out[k] = redactAnyForLog(k, vv, depth+1)
		}
		return out
	case []any:
		limit := len(v)
		if limit > 8 {
			limit = 8
		}
		out := make([]any, 0, limit+1)
		for i := 0; i < limit; i++ {
			out = append(out, redactAnyForLog("", v[i], depth+1))
		}
		if len(v) > limit {
			out = append(out, fmt.Sprintf("[... %d more items]", len(v)-limit))
		}
		return out
	default:
		return in
	}
}

func redactToolArgsForLog(toolName string, args map[string]any) map[string]any {
	_ = toolName
	if args == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(args))
	for k, v := range args {
		out[k] = redactAnyForLog(k, v, 0)
	}
	return out
}

func summarizeStdinForPersist(in string) map[string]any {
	if in == "" {
		return map[string]any{"redacted": true, "bytes": 0, "lines": 0}
	}
	lines := 1 + strings.Count(in, "\n")
	return map[string]any{
		"redacted": true,
		"bytes":    len(in),
		"lines":    lines,
	}
}

func redactAnyForPersist(key string, in any, depth int) any {
	if depth > 4 {
		return "[omitted]"
	}
	if strings.EqualFold(strings.TrimSpace(key), "stdin") {
		switch v := in.(type) {
		case string:
			return summarizeStdinForPersist(v)
		case []byte:
			if len(v) == 0 {
				return map[string]any{"redacted": true, "bytes": 0}
			}
			return map[string]any{"redacted": true, "bytes": len(v)}
		default:
			if in == nil {
				return nil
			}
			return "[redacted]"
		}
	}
	if isSensitiveLogKey(key) {
		switch v := in.(type) {
		case string:
			return fmt.Sprintf("[redacted:%d chars]", utf8.RuneCountInString(v))
		case []byte:
			return fmt.Sprintf("[redacted:%d bytes]", len(v))
		default:
			return "[redacted]"
		}
	}
	switch v := in.(type) {
	case string:
		return v
	case []byte:
		return fmt.Sprintf("[bytes:%d]", len(v))
	case map[string]any:
		out := make(map[string]any, len(v))
		for k, vv := range v {
			out[k] = redactAnyForPersist(k, vv, depth+1)
		}
		return out
	case []any:
		limit := len(v)
		if limit > 8 {
			limit = 8
		}
		out := make([]any, 0, limit+1)
		for i := 0; i < limit; i++ {
			out = append(out, redactAnyForPersist("", v[i], depth+1))
		}
		if len(v) > limit {
			out = append(out, fmt.Sprintf("[... %d more items]", len(v)-limit))
		}
		return out
	default:
		return in
	}
}

func redactToolArgsForPersist(toolName string, args map[string]any) map[string]any {
	_ = toolName
	if args == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(args))
	for k, v := range args {
		out[k] = redactAnyForPersist(k, v, 0)
	}
	return out
}

func previewAnyForLog(v any, maxRunes int) string {
	if maxRunes <= 0 {
		maxRunes = 512
	}
	switch x := v.(type) {
	case string:
		return sanitizeLogText(x, maxRunes)
	case []byte:
		return sanitizeLogText(string(x), maxRunes)
	}
	b, err := json.Marshal(v)
	if err != nil {
		return sanitizeLogText(fmt.Sprintf("<marshal_error:%v>", err), maxRunes)
	}
	return sanitizeLogText(string(b), maxRunes)
}

func (r *run) approveTool(toolID string, approved bool) error {
	if r == nil {
		return errors.New("nil run")
	}
	toolID = strings.TrimSpace(toolID)
	if toolID == "" {
		return errors.New("missing tool_id")
	}

	r.mu.Lock()
	approval := r.toolApprovals[toolID]
	if approval == nil || approval.decision == nil {
		r.mu.Unlock()
		return errors.New("tool not pending approval")
	}
	if approval.resolved {
		r.mu.Unlock()
		return ErrRunChanged
	}
	select {
	case approval.decision <- approved:
		approval.resolved = true
		r.mu.Unlock()
		return nil
	default:
		r.mu.Unlock()
		return ErrRunChanged
	}
}

func (r *run) run(ctx context.Context, req RunRequest) (retErr error) {
	defer r.markDone()
	if r == nil {
		return errors.New("nil run")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	r.setFinalizationReason("")
	startedAt := time.Now()
	r.persistRunRecord(RunStateRunning, "", "", startedAt.UnixMilli(), 0)
	runStartPayload := map[string]any{
		"model": strings.TrimSpace(req.Model),
	}
	r.persistRunEvent("run.start", RealtimeStreamKindLifecycle, runStartPayload)
	defer func() {
		endReason := strings.TrimSpace(r.getEndReason())
		if endReason == "" {
			if retErr != nil {
				endReason = "error"
			} else {
				endReason = "complete"
			}
		}
		state := RunStateFailed
		errCode := strings.TrimSpace(r.getRunErrorCode())
		if errCode == "" {
			errCode = string(aitools.ErrorCodeUnknown)
		}
		errMsg := strings.TrimSpace(errorString(retErr))
		eventType := "run.error"
		finalizationReason := strings.TrimSpace(r.getFinalizationReason())
		finalizationClass := classifyFinalizationReason(finalizationReason)
		switch endReason {
		case "complete":
			switch finalizationClass {
			case finalizationClassSuccess:
				state = RunStateSuccess
				errCode = ""
				errMsg = ""
				eventType = "run.end"
			case finalizationClassWaitingUser:
				state = RunStateWaitingUser
				errCode = ""
				errMsg = ""
				eventType = "run.end"
			default:
				state = RunStateFailed
				if errMsg == "" {
					errMsg = "Run ended without a recognized finalization reason."
				}
				eventType = "run.error"
			}
		case "canceled":
			state = RunStateCanceled
			errCode = ""
			errMsg = ""
			eventType = "run.end"
		case "timed_out":
			state = RunStateTimedOut
			if errCode == string(aitools.ErrorCodeUnknown) {
				errCode = string(aitools.ErrorCodeTimeout)
			}
			if errMsg == "" {
				errMsg = "Timed out"
			}
		case "disconnected":
			state = RunStateFailed
			if errMsg == "" {
				errMsg = "Disconnected"
			}
		case "error":
			state = RunStateFailed
		}
		r.cancelUnfinishedManualCompactions("run_finished")
		r.persistRunRecord(state, errCode, errMsg, startedAt.UnixMilli(), time.Now().UnixMilli())
		r.persistRunEvent(eventType, RealtimeStreamKindLifecycle, map[string]any{
			"state":               string(state),
			"error_code":          errCode,
			"error":               errMsg,
			"finalization_reason": finalizationReason,
			"finalization_class":  finalizationClass,
		})
		r.debug("ai.run.end",
			"end_reason", endReason,
			"finalization_reason", finalizationReason,
			"finalization_class", finalizationClass,
			"cancel_reason", strings.TrimSpace(r.getCancelReason()),
			"duration_ms", time.Since(startedAt).Milliseconds(),
			"state", string(state),
			"error", sanitizeLogText(errMsg, 256),
		)
	}()
	ctx, cancel := context.WithCancel(ctx)
	r.muCancel.Lock()
	r.cancelFn = cancel
	alreadyCanceled := r.cancelRequested
	r.muCancel.Unlock()
	if alreadyCanceled {
		cancel()
	}
	defer r.cancel()
	if r.stream != nil {
		defer r.stream.close()
	}

	execCtx := ctx
	var cancelMaxWall context.CancelFunc
	if r.maxWallTime > 0 {
		execCtx, cancelMaxWall = context.WithTimeout(execCtx, r.maxWallTime)
		defer cancelMaxWall()
	}
	if r.idleTimeout > 0 && r.activityCh != nil {
		r.touchActivity()
		go r.runIdleWatchdog(execCtx)
	}

	r.ensureAssistantMessageStarted()
	r.emitLifecyclePhase("planning", nil)

	modelID := strings.TrimSpace(req.Model)
	r.currentModelID = modelID
	providerID, _, ok := strings.Cut(modelID, "/")
	providerID = strings.TrimSpace(providerID)
	workingDirAbs, rootErr := r.workingDirAbs()
	if rootErr != nil {
		return r.failRun("AI working directory not configured", rootErr)
	}
	taskObjective := strings.TrimSpace(req.Objective)
	if taskObjective == "" {
		taskObjective = strings.TrimSpace(req.Input.Text)
	}
	r.debug("ai.run.start",
		"model", modelID,
		"attachment_count", len(req.Input.Attachments),
		"input_chars", utf8.RuneCountInString(strings.TrimSpace(req.Input.Text)),
		"objective_chars", utf8.RuneCountInString(strings.TrimSpace(taskObjective)),
		"working_dir_abs", sanitizeLogText(workingDirAbs, 200),
	)
	resolved, err := r.resolveModelGatewayForModel(modelID, providerID, ok)
	if err != nil {
		code := runErrorCodeProviderModelUnavailable
		if errors.Is(err, ErrNotConfigured) {
			code = runErrorCodeProviderUnreachable
		}
		if errors.Is(err, errModelGatewayMissingKey) {
			code = runErrorCodeProviderMissingKey
		}
		return r.failRunWithCode(code, "", err)
	}
	if strings.TrimSpace(resolved.userMessage) != "" {
		return r.failRunWithCode(runErrorCodeProviderMissingKey, resolved.userMessage, resolved.err)
	}
	return r.runFloretHostedTurn(execCtx, req, resolved.provider, resolved.apiKey, strings.TrimSpace(taskObjective), resolved.adapterOverride)
}

var errModelGatewayMissingKey = errors.New("missing provider key")

type resolvedRunModelGateway struct {
	provider        config.AIProvider
	apiKey          string
	providerType    string
	modelName       string
	adapterOverride ModelGateway
	userMessage     string
	err             error
}

func (r *run) resolveModelGatewayForModel(modelID string, providerID string, providerIDOK bool) (resolvedRunModelGateway, error) {
	modelID = strings.TrimSpace(modelID)
	providerID = strings.TrimSpace(providerID)
	if isDesktopModelSourceModelID(modelID) {
		if r.desktopModelSource == nil || !r.desktopModelSource.isConnected() {
			return resolvedRunModelGateway{}, ErrNotConfigured
		}
		_, modelName, _ := strings.Cut(modelID, "/")
		providerCfg := config.AIProvider{
			ID:   DesktopModelSourceProviderType,
			Name: "Desktop",
			Type: DesktopModelSourceProviderType,
		}
		return resolvedRunModelGateway{
			provider:        providerCfg,
			providerType:    DesktopModelSourceProviderType,
			modelName:       strings.TrimSpace(modelName),
			adapterOverride: r.desktopModelSource.ModelGateway(modelID),
		}, nil
	}
	if !providerIDOK || providerID == "" {
		return resolvedRunModelGateway{}, fmt.Errorf("invalid model id %q", modelID)
	}
	_, modelName, _ := strings.Cut(modelID, "/")
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return resolvedRunModelGateway{}, fmt.Errorf("invalid model id %q", modelID)
	}
	if r.cfg == nil {
		return resolvedRunModelGateway{}, fmt.Errorf("%w: ai not configured", errModelGatewayMissingKey)
	}
	var providerCfg *config.AIProvider
	for i := range r.cfg.Providers {
		p := &r.cfg.Providers[i]
		if strings.TrimSpace(p.ID) != providerID {
			continue
		}
		providerCfg = p
		break
	}
	if providerCfg == nil {
		return resolvedRunModelGateway{}, fmt.Errorf("unknown provider %q", providerID)
	}

	providerDisplay := providerID
	if n := strings.TrimSpace(providerCfg.Name); n != "" {
		providerDisplay = n + " (" + providerID + ")"
	}

	apiKey := ""
	if strings.ToLower(strings.TrimSpace(providerCfg.Type)) != "ollama" {
		if r.resolveProviderKey == nil {
			return resolvedRunModelGateway{}, fmt.Errorf("%w: missing provider key resolver", errModelGatewayMissingKey)
		}
		var ok bool
		var err error
		apiKey, ok, err = r.resolveProviderKey(providerID)
		if err != nil {
			return resolvedRunModelGateway{}, fmt.Errorf("%w: %v", errModelGatewayMissingKey, err)
		}
		if !ok || strings.TrimSpace(apiKey) == "" {
			err := fmt.Errorf("missing api key for provider %q", providerID)
			return resolvedRunModelGateway{userMessage: fmt.Sprintf("AI provider %q is missing API key. Open Settings to configure it.", providerDisplay), err: err}, nil
		}
	}

	if !r.supportsModelGatewayProvider(providerCfg) {
		return resolvedRunModelGateway{}, fmt.Errorf("unsupported provider type %q", strings.TrimSpace(providerCfg.Type))
	}
	return resolvedRunModelGateway{
		provider:     *providerCfg,
		apiKey:       strings.TrimSpace(apiKey),
		providerType: strings.ToLower(strings.TrimSpace(providerCfg.Type)),
		modelName:    modelName,
	}, nil
}

func (r *run) appendTextDelta(delta string) error {
	if r == nil || delta == "" {
		return nil
	}
	if !r.acceptsPresentationUpdates() {
		return nil
	}
	if r.needNewTextBlock {
		idx := r.nextBlockIndex
		r.nextBlockIndex++
		r.currentTextBlockIndex = idx
		r.needNewTextBlock = false
		r.persistSetMarkdownBlock(idx)
		r.sendStreamEvent(streamEventBlockStart{Type: "block-start", MessageID: r.messageID, BlockIndex: idx, BlockType: "markdown"})
	}
	r.needNewThinkingBlock = true
	delta = r.normalizeMarkdownDelta(r.currentTextBlockIndex, delta)
	if delta == "" {
		return nil
	}
	r.persistAppendMarkdownDelta(r.currentTextBlockIndex, delta)
	r.sendStreamEvent(streamEventBlockDelta{Type: "block-delta", MessageID: r.messageID, BlockIndex: r.currentTextBlockIndex, Delta: delta})
	return nil
}

func (r *run) appendThinkingDelta(delta string) error {
	if r == nil || delta == "" {
		return nil
	}
	if !r.acceptsPresentationUpdates() {
		return nil
	}
	if r.needNewThinkingBlock || r.currentThinkingBlockIndex < 0 {
		idx := r.nextBlockIndex
		r.nextBlockIndex++
		r.currentThinkingBlockIndex = idx
		r.needNewThinkingBlock = false
		r.needNewTextBlock = true
		r.currentTextBlockIndex = -1
		r.persistSetThinkingBlock(idx)
		r.sendStreamEvent(streamEventBlockStart{Type: "block-start", MessageID: r.messageID, BlockIndex: idx, BlockType: "thinking"})
	}
	delta = r.normalizeThinkingDelta(r.currentThinkingBlockIndex, delta)
	if delta == "" {
		return nil
	}
	r.persistAppendThinkingDelta(r.currentThinkingBlockIndex, delta)
	r.sendStreamEvent(streamEventBlockDelta{Type: "block-delta", MessageID: r.messageID, BlockIndex: r.currentThinkingBlockIndex, Delta: delta})
	return nil
}

func (r *run) normalizeMarkdownDelta(idx int, delta string) string {
	if r == nil || idx < 0 || delta == "" {
		return delta
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	if idx >= len(r.assistantBlocks) {
		return delta
	}
	b, ok := r.assistantBlocks[idx].(*persistedMarkdownBlock)
	if !ok || b == nil || b.Content == "" {
		return delta
	}
	return trimMarkdownDeltaOverlap(b.Content, delta)
}

func (r *run) normalizeThinkingDelta(idx int, delta string) string {
	if r == nil || idx < 0 || delta == "" {
		return delta
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	if idx >= len(r.assistantBlocks) {
		return delta
	}
	b, ok := r.assistantBlocks[idx].(*persistedThinkingBlock)
	if !ok || b == nil || b.Content == "" {
		return delta
	}
	return trimMarkdownDeltaOverlap(b.Content, delta)
}

func trimMarkdownDeltaOverlap(existing string, delta string) string {
	if existing == "" || delta == "" {
		return delta
	}
	existingRunes := []rune(existing)
	deltaRunes := []rune(delta)
	if len(existingRunes) == 0 || len(deltaRunes) == 0 {
		return delta
	}

	maxOverlap := len(deltaRunes)
	if len(existingRunes) < maxOverlap {
		maxOverlap = len(existingRunes)
	}
	if maxOverlap > 400 {
		maxOverlap = 400
	}
	for overlap := maxOverlap; overlap >= 24; overlap-- {
		if string(existingRunes[len(existingRunes)-overlap:]) == string(deltaRunes[:overlap]) {
			if overlap == len(deltaRunes) {
				return ""
			}
			return string(deltaRunes[overlap:])
		}
	}
	// Keep tiny chunks untouched unless they are exact suffix duplicates.
	if len(deltaRunes) <= 24 && strings.HasSuffix(existing, delta) {
		return ""
	}
	return delta
}

func (r *run) hasNonEmptyAssistantText() bool {
	if r == nil {
		return false
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	for _, blk := range r.assistantBlocks {
		if assistantVisibleTextFromBlock(blk) != "" {
			return true
		}
	}
	return false
}

func normalizeCanonicalMarkdownText(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	return strings.TrimSpace(text)
}

func (r *run) setCanonicalMarkdownCandidate(text string) {
	if r == nil {
		return
	}
	if !r.acceptsEngineResultProjection() {
		return
	}
	text = normalizeCanonicalMarkdownText(text)
	if text == "" {
		return
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	if strings.TrimSpace(r.assistantAnswer.CanonicalMarkdown) == text {
		return
	}
	r.assistantAnswer.CanonicalMarkdown = text
}

func (r *run) canonicalMarkdownTextSnapshot(fallback string) string {
	if r == nil {
		return ""
	}
	r.muAssistant.Lock()
	canonical := strings.TrimSpace(r.assistantAnswer.CanonicalMarkdown)
	r.muAssistant.Unlock()
	if canonical == "" {
		return normalizeCanonicalMarkdownText(fallback)
	}
	return canonical
}

func (r *run) markdownBlockIndicesLocked() []int {
	if r == nil {
		return nil
	}
	idxs := make([]int, 0, len(r.assistantBlocks))
	for i, blk := range r.assistantBlocks {
		if _, ok := blk.(*persistedMarkdownBlock); ok {
			idxs = append(idxs, i)
		}
	}
	return idxs
}

func (r *run) nonEmptyMarkdownBlockIndicesLocked() []int {
	if r == nil {
		return nil
	}
	idxs := make([]int, 0, len(r.assistantBlocks))
	for i, blk := range r.assistantBlocks {
		block, ok := blk.(*persistedMarkdownBlock)
		if !ok || block == nil || strings.TrimSpace(block.Content) == "" {
			continue
		}
		idxs = append(idxs, i)
	}
	return idxs
}

func (r *run) trailingConcreteBlockIndexLocked() int {
	if r == nil {
		return -1
	}
	for i := len(r.assistantBlocks) - 1; i >= 0; i-- {
		if r.assistantBlocks[i] == nil {
			continue
		}
		return i
	}
	return -1
}

func (r *run) trailingEmptyMarkdownBlockIndexLocked() int {
	idx := r.trailingConcreteBlockIndexLocked()
	if idx < 0 {
		return -1
	}
	block, ok := r.assistantBlocks[idx].(*persistedMarkdownBlock)
	if !ok || block == nil || strings.TrimSpace(block.Content) != "" {
		return -1
	}
	return idx
}

func (r *run) appendCanonicalMarkdownBlockLocked(canonical string) assistantMarkdownUpdate {
	target := len(r.assistantBlocks)
	r.persistEnsureIndex(target)
	r.assistantBlocks[target] = &persistedMarkdownBlock{Type: "markdown", Content: canonical}
	if r.nextBlockIndex <= target {
		r.nextBlockIndex = target + 1
	}
	return assistantMarkdownUpdate{
		index: target,
		start: true,
		block: persistedMarkdownBlock{Type: "markdown", Content: canonical},
	}
}

func (r *run) reconcileCanonicalMarkdownMessage(source canonicalMarkdownSource, fallback string) bool {
	if r == nil {
		return false
	}
	if !r.acceptsEngineResultProjection() {
		return false
	}
	canonical := r.canonicalMarkdownTextSnapshot(fallback)
	if canonical == "" {
		return false
	}

	r.muAssistant.Lock()
	var update assistantMarkdownUpdate
	hasUpdate := false
	visible := r.nonEmptyMarkdownBlockIndicesLocked()
	switch len(visible) {
	case 0:
		if idx := r.trailingEmptyMarkdownBlockIndexLocked(); idx >= 0 {
			block := r.assistantBlocks[idx].(*persistedMarkdownBlock)
			block.Content = canonical
			update = assistantMarkdownUpdate{
				index: idx,
				block: persistedMarkdownBlock{Type: "markdown", Content: canonical},
			}
			hasUpdate = true
			break
		}
		update = r.appendCanonicalMarkdownBlockLocked(canonical)
		hasUpdate = true
	case 1:
		idx := visible[0]
		if r.trailingConcreteBlockIndexLocked() != idx {
			break
		}
		block, ok := r.assistantBlocks[idx].(*persistedMarkdownBlock)
		if !ok || block == nil {
			r.muAssistant.Unlock()
			return false
		}
		if strings.TrimSpace(block.Content) != canonical {
			block.Content = canonical
			update = assistantMarkdownUpdate{
				index: idx,
				block: persistedMarkdownBlock{Type: "markdown", Content: canonical},
			}
			hasUpdate = true
		}
	}
	r.muAssistant.Unlock()

	if !hasUpdate {
		return false
	}
	if update.start {
		r.sendStreamEvent(streamEventBlockStart{
			Type:       "block-start",
			MessageID:  r.messageID,
			BlockIndex: update.index,
			BlockType:  "markdown",
		})
	}
	r.sendStreamEvent(streamEventBlockSet{
		Type:       "block-set",
		MessageID:  r.messageID,
		BlockIndex: update.index,
		Block:      update.block,
	})
	return true
}

func (r *run) reconcileCanonicalWaitingUserMessage() bool {
	if r == nil {
		return false
	}
	if !r.acceptsEngineResultProjection() {
		return false
	}

	type markdownUpdate struct {
		index int
		block persistedMarkdownBlock
	}

	r.muAssistant.Lock()
	if r.waitingPrompt == nil {
		r.muAssistant.Unlock()
		return false
	}

	updates := make([]markdownUpdate, 0, 4)
	for _, idx := range r.markdownBlockIndicesLocked() {
		block, ok := r.assistantBlocks[idx].(*persistedMarkdownBlock)
		if !ok || block == nil || strings.TrimSpace(block.Content) == "" {
			continue
		}
		block.Content = ""
		updates = append(updates, markdownUpdate{
			index: idx,
			block: persistedMarkdownBlock{Type: "markdown", Content: ""},
		})
	}
	r.muAssistant.Unlock()

	if len(updates) == 0 {
		return false
	}
	for _, update := range updates {
		r.sendStreamEvent(streamEventBlockSet{
			Type:       "block-set",
			MessageID:  r.messageID,
			BlockIndex: update.index,
			Block:      update.block,
		})
	}
	return true
}

func (r *run) sessionMetaForTool() (*session.Meta, error) {
	if r == nil {
		return nil, errors.New("nil run")
	}
	if r.sessionMeta == nil {
		return nil, errors.New("missing run session metadata")
	}
	metaCopy := *r.sessionMeta
	return &metaCopy, nil
}

func (r *run) ensureAssistantErrorMessage(errMsg string) {
	if r == nil {
		return
	}
	if r.hasNonEmptyAssistantText() {
		return
	}
	msg := strings.TrimSpace(errMsg)
	if msg == "" {
		msg = "AI run failed."
	}
	_ = r.appendTextDelta("Run failed: " + msg)
}

func (r *run) failRun(errMsg string, cause error) error {
	return r.failRunWithCode("", errMsg, cause)
}

func (r *run) failRunWithCode(code string, errMsg string, cause error) error {
	if r == nil {
		if cause != nil {
			return cause
		}
		msg := strings.TrimSpace(errMsg)
		if msg == "" {
			msg = "AI error"
		}
		return errors.New(msg)
	}

	code = strings.TrimSpace(code)
	if code == "" {
		code = classifyRunFailureCode(cause, "")
	}
	if code != "" {
		r.setRunErrorCode(code)
	}
	msg := strings.TrimSpace(errMsg)
	if msg == "" && cause != nil {
		msg = strings.TrimSpace(cause.Error())
	}
	msg = userFacingRunError(code, msg)
	if msg == "" {
		msg = "AI error"
	}

	r.ensureAssistantErrorMessage(msg)
	if strings.TrimSpace(r.getFinalizationReason()) == "" {
		r.setFinalizationReason("error")
	}
	r.sendStreamEvent(streamEventError{Type: "error", MessageID: r.messageID, Error: msg})
	r.setEndReason("error")
	r.emitLifecyclePhase("ended", map[string]any{"reason": "error"})
	r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})

	if cause != nil {
		return cause
	}
	return errors.New(msg)
}

func (r *run) finalizeIfContextCanceled(ctx context.Context) bool {
	if r == nil || ctx == nil {
		return false
	}
	ctxErr := ctx.Err()
	if ctxErr == nil {
		return false
	}
	reason := "disconnected"
	switch r.getCancelReason() {
	case "canceled":
		reason = "canceled"
		r.setFinalizationReason("canceled")
		r.setEndReason("canceled")
	case "timed_out":
		reason = "timed_out"
		r.setFinalizationReason("timed_out")
		r.setEndReason("timed_out")
	default:
		if errors.Is(ctxErr, context.DeadlineExceeded) {
			reason = "timed_out"
			r.setFinalizationReason("timed_out")
			r.setEndReason("timed_out")
		} else {
			r.setFinalizationReason("disconnected")
			r.setEndReason("disconnected")
		}
	}
	r.debug("ai.run.context_canceled_before_send", "reason", reason)
	r.emitLifecyclePhase("ended", map[string]any{"reason": reason})
	r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
	return true
}

func isMutatingInvocation(toolName string, args map[string]any) bool {
	return aitools.IsMutatingForInvocation(toolName, args)
}

func marshalPersistJSON(v any, maxRunes int) string {
	b, err := json.Marshal(v)
	if err != nil || len(b) == 0 {
		return "{}"
	}
	out := strings.TrimSpace(string(b))
	if out == "" {
		return "{}"
	}
	if maxRunes > 0 {
		out = truncateRunes(out, maxRunes)
	}
	return out
}

type toolCallOutcome struct {
	Success        bool
	ToolName       string
	Args           map[string]any
	Result         any
	Pending        *PendingToolResult
	ToolError      *aitools.ToolError
	RecoveryAction string
}

type toolActivityUpdater func(activity *observation.ActivityPresentation, metadata map[string]any)

const (
	toolCallStatusPending = "pending"
	toolCallStatusRunning = "running"
	toolCallStatusSuccess = "success"
	toolCallStatusError   = "error"
)

func (r *run) persistToolCallSnapshot(toolID string, toolName string, status string, args map[string]any, result any, toolErr *aitools.ToolError, recoveryAction string, startedAt time.Time, endedAt time.Time) {
	if r == nil {
		return
	}
	argsPersistLimit := 4000
	resultPersistLimit := 4000
	argsRedacted := any(redactAnyForLog("args", args, 0))
	if strings.TrimSpace(toolName) == "terminal.exec" {
		argsRedacted = redactAnyForPersist("args", args, 0)
		// Terminal output is fetched lazily from persistence; keep complete payload.
		argsPersistLimit = 0
		resultPersistLimit = 0
	}
	argsPersist := marshalPersistJSON(argsRedacted, argsPersistLimit)
	resultPersist := ""
	if result != nil {
		resultRedacted := any(redactAnyForLog("result", result, 0))
		if strings.TrimSpace(toolName) == "terminal.exec" {
			resultRedacted = redactAnyForPersist("result", result, 0)
		}
		resultPersist = marshalPersistJSON(resultRedacted, resultPersistLimit)
	}
	errCode := ""
	errMsg := ""
	retryable := false
	if toolErr != nil {
		toolErr.Normalize()
		errCode = string(toolErr.Code)
		errMsg = toolErr.Message
		retryable = toolErr.Retryable
	}
	rec := threadstore.ToolCallRecord{
		RunID:           strings.TrimSpace(r.id),
		ToolID:          strings.TrimSpace(toolID),
		ToolName:        strings.TrimSpace(toolName),
		Status:          strings.TrimSpace(status),
		ArgsJSON:        argsPersist,
		ResultJSON:      resultPersist,
		ErrorCode:       errCode,
		ErrorMessage:    errMsg,
		Retryable:       retryable,
		RecoveryAction:  strings.TrimSpace(recoveryAction),
		StartedAtUnixMs: startedAt.UnixMilli(),
		EndedAtUnixMs:   endedAt.UnixMilli(),
		LatencyMS:       endedAt.Sub(startedAt).Milliseconds(),
	}
	r.persistToolCall(rec)
}

func toolStartActivityPresentation(toolName string, args map[string]any) *observation.ActivityPresentation {
	toolName = strings.TrimSpace(toolName)
	activity := floretActivityForToolCall(toolName, args)
	if activity == nil {
		label := toolName
		if label == "" {
			label = "tool"
		}
		activity = &observation.ActivityPresentation{
			Label:    label,
			Renderer: observation.ActivityRendererStructured,
			Payload:  map[string]any{},
		}
	}
	activity = cloneActivityPresentation(activity)
	if toolName == "terminal.exec" && strings.TrimSpace(anyToString(args["command"])) == "" {
		activity.Label = toolName
	}
	if activity.Payload == nil {
		activity.Payload = map[string]any{}
	}
	activity.Payload["status"] = toolCallStatusRunning
	return contractSafeActivityPresentation(activity)
}

func cloneActivityPresentation(in *observation.ActivityPresentation) *observation.ActivityPresentation {
	if in == nil {
		return nil
	}
	out := *in
	out.Chips = append([]observation.ActivityChip(nil), in.Chips...)
	out.TargetRefs = append([]observation.ActivityTargetRef(nil), in.TargetRefs...)
	out.Payload = cloneAnyMap(in.Payload)
	return &out
}

func (r *run) recordToolResultActivity(toolID string, toolName string, status string, result any, toolErr *aitools.ToolError, observedAt time.Time) {
	if r == nil {
		return
	}
	if observedAt.IsZero() {
		observedAt = time.Now()
	}
	toolResult := ToolResult{
		ToolID:   strings.TrimSpace(toolID),
		ToolName: strings.TrimSpace(toolName),
		Status:   strings.TrimSpace(status),
		Data:     result,
		Error:    toolErr,
	}
	if _, err := validateToolResultStatus(toolResult.Status); err != nil {
		r.persistRunEvent("activity.tool_result.invalid", RealtimeStreamKindTool, map[string]any{
			"tool_id":   toolResult.ToolID,
			"tool_name": toolResult.ToolName,
			"error":     sanitizeLogText(err.Error(), 240),
		})
		return
	}
	if toolErr != nil {
		toolErr.Normalize()
		toolResult.Summary = string(toolErr.Code)
		toolResult.Details = toolErr.Message
	}
	activity, err := floretActivityForToolResult(r, toolResult)
	if err != nil {
		r.persistRunEvent("activity.tool_result.invalid", RealtimeStreamKindTool, map[string]any{
			"tool_id":   toolResult.ToolID,
			"tool_name": toolResult.ToolName,
			"error":     sanitizeLogText(err.Error(), 240),
		})
		return
	}
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolResult,
		ToolID:     toolResult.ToolID,
		ToolName:   toolResult.ToolName,
		ToolKind:   "local",
		Error:      strings.TrimSpace(toolResult.Details),
		Activity:   activity,
		ObservedAt: observedAt,
	})
}

func cloneAnyMap(in map[string]any) map[string]any {
	if in == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

type floretToolExecutionAuthorization struct {
	toolID   string
	toolName string
}

type floretToolExecutionAuthorizationContextKey struct{}

func contextWithFloretToolExecutionAuthorization(ctx context.Context, toolID string, toolName string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, floretToolExecutionAuthorizationContextKey{}, floretToolExecutionAuthorization{
		toolID:   strings.TrimSpace(toolID),
		toolName: strings.TrimSpace(toolName),
	})
}

func contextHasFloretToolExecutionAuthorization(ctx context.Context, toolID string, toolName string) bool {
	if ctx == nil {
		return false
	}
	auth, ok := ctx.Value(floretToolExecutionAuthorizationContextKey{}).(floretToolExecutionAuthorization)
	if !ok {
		return false
	}
	return strings.TrimSpace(auth.toolID) == strings.TrimSpace(toolID) &&
		strings.TrimSpace(auth.toolName) == strings.TrimSpace(toolName)
}

func (r *run) handleToolCall(ctx context.Context, toolID string, toolName string, args map[string]any, activityUpdaters ...toolActivityUpdater) (*toolCallOutcome, error) {
	toolID = strings.TrimSpace(toolID)
	if toolID == "" {
		var err error
		toolID, err = newToolID()
		if err != nil {
			return nil, err
		}
	}
	toolName = strings.TrimSpace(toolName)
	if toolName == "" {
		return nil, errors.New("missing tool_name")
	}
	if r.isDetached() {
		return &toolCallOutcome{
			Success:  false,
			ToolName: toolName,
			Args:     cloneAnyMap(args),
			ToolError: &aitools.ToolError{
				Code:      aitools.ErrorCodeCanceled,
				Message:   "Run was canceled",
				Retryable: false,
			},
		}, nil
	}
	if args == nil {
		args = map[string]any{}
	}
	r.recordRuntimeToolCall()

	argsForPersist := args
	if toolName == "terminal.exec" {
		argsForPersist = redactToolArgsForPersist(toolName, args)
	}

	outcome := &toolCallOutcome{
		Success:        false,
		ToolName:       toolName,
		Args:           cloneAnyMap(args),
		ToolError:      nil,
		RecoveryAction: "",
	}
	mutating := isMutatingInvocation(toolName, args)
	toolStartedAt := time.Now()
	toolSpanID := executionSpanID(r.id, toolName, toolID)
	r.persistRunEvent("tool.call", RealtimeStreamKindTool, map[string]any{
		"tool_id":   toolID,
		"tool_name": toolName,
		"args":      redactAnyForLog("args", args, 0),
	})
	toolCallPayload := map[string]any{
		"tool_id":   toolID,
		"tool_name": toolName,
		"args":      redactAnyForLog("args", args, 0),
	}
	toolCallPayloadJSON := marshalPersistJSON(toolCallPayload, 6000)
	r.persistExecutionSpan(threadstore.ExecutionSpanRecord{
		SpanID:          toolSpanID,
		EndpointID:      strings.TrimSpace(r.endpointID),
		ThreadID:        strings.TrimSpace(r.threadID),
		RunID:           strings.TrimSpace(r.id),
		Kind:            "tool",
		Name:            toolName,
		Status:          "started",
		PayloadJSON:     toolCallPayloadJSON,
		StartedAtUnixMs: toolStartedAt.UnixMilli(),
		UpdatedAtUnixMs: toolStartedAt.UnixMilli(),
	})

	r.debug("ai.run.tool.call",
		"tool_id", toolID,
		"tool_name", toolName,
		"args_preview", previewAnyForLog(redactToolArgsForLog(toolName, args), 512),
	)

	persistResult := any(nil)
	r.persistToolCallSnapshot(toolID, toolName, toolCallStatusPending, argsForPersist, persistResult, nil, "", toolStartedAt, time.Now())

	setToolError := func(toolErr *aitools.ToolError, recoveryAction string, partialResult any) {
		if toolErr == nil {
			toolErr = &aitools.ToolError{Code: aitools.ErrorCodeUnknown, Message: "Tool failed"}
		}
		toolErr.Normalize()
		outcome.Success = false
		outcome.Result = partialResult
		outcome.ToolError = toolErr
		outcome.RecoveryAction = strings.TrimSpace(recoveryAction)
		r.debug("ai.run.tool.result",
			"tool_id", toolID,
			"tool_name", toolName,
			"status", "error",
			"error_code", string(toolErr.Code),
			"error", sanitizeLogText(toolErr.Message, 256),
		)
		if r.log != nil {
			r.log.Warn("ai tool call failed",
				"run_id", r.id,
				"thread_id", r.threadID,
				"channel_id", r.channelID,
				"endpoint_id", r.endpointID,
				"tool_id", toolID,
				"tool_name", toolName,
				"error_code", string(toolErr.Code),
				"error", toolErr.Message,
			)
		}
		errorResult := partialResult
		errorAt := time.Now()
		r.persistToolCallSnapshot(toolID, toolName, toolCallStatusError, argsForPersist, errorResult, toolErr, recoveryAction, toolStartedAt, errorAt)
		r.persistRunEvent("tool.error", RealtimeStreamKindTool, map[string]any{
			"tool_id":   toolID,
			"tool_name": toolName,
			"error":     toolErr,
		})
		errPayload := map[string]any{
			"tool_id":         toolID,
			"tool_name":       toolName,
			"status":          "failed",
			"error":           toolErr,
			"recovery_action": strings.TrimSpace(recoveryAction),
		}
		if partialResult != nil {
			errPayload["result"] = redactAnyForLog("result", partialResult, 0)
		}
		r.persistExecutionSpan(threadstore.ExecutionSpanRecord{
			SpanID:          toolSpanID,
			EndpointID:      strings.TrimSpace(r.endpointID),
			ThreadID:        strings.TrimSpace(r.threadID),
			RunID:           strings.TrimSpace(r.id),
			Kind:            "tool",
			Name:            toolName,
			Status:          "failed",
			PayloadJSON:     marshalPersistJSON(errPayload, 6000),
			StartedAtUnixMs: toolStartedAt.UnixMilli(),
			EndedAtUnixMs:   time.Now().UnixMilli(),
			UpdatedAtUnixMs: time.Now().UnixMilli(),
		})
	}

	// Detached runs are hard-canceled (e.g. replaced by a new user turn). Prevent them from
	// mutating the workspace even if some tool calls were already queued.
	if r.isDetached() && mutating {
		setToolError(&aitools.ToolError{Code: aitools.ErrorCodeCanceled, Message: "Run was canceled", Retryable: false}, "", nil)
		return outcome, nil
	}

	meta, err := r.sessionMetaForTool()
	if err != nil {
		toolErr := aitools.ClassifyError(aitools.Invocation{ToolName: toolName, Args: args, WorkingDir: r.workingDir, AgentHomeDir: r.agentHomeDir}, err)
		setToolError(toolErr, "", nil)
		return outcome, nil
	}

	var activityUpdater toolActivityUpdater
	if len(activityUpdaters) > 0 {
		activityUpdater = activityUpdaters[0]
	}

	if toolName == "terminal.exec" {
		terminalOutcome, terminalErr := r.handleTerminalExecProcessTool(ctx, meta, toolID, args, argsForPersist, toolStartedAt, toolSpanID, activityUpdater)
		if terminalErr != nil {
			setToolError(terminalErr, "", terminalOutcome.Result)
			return outcome, nil
		}
		return terminalOutcome, nil
	}

	r.debug("ai.run.tool.exec.start", "tool_id", toolID, "tool_name", toolName)
	endBusy := r.beginBusy()
	defer endBusy()
	persistResult = nil
	r.persistToolCallSnapshot(toolID, toolName, toolCallStatusRunning, argsForPersist, persistResult, nil, "", toolStartedAt, time.Now())
	result, toolErrRaw := r.execTool(ctx, meta, toolID, toolName, args)
	if toolErrRaw != nil {
		if errors.Is(toolErrRaw, context.Canceled) {
			setToolError(&aitools.ToolError{Code: aitools.ErrorCodeCanceled, Message: "Canceled", Retryable: false}, "", nil)
			return outcome, nil
		}
		if errors.Is(toolErrRaw, context.DeadlineExceeded) {
			setToolError(&aitools.ToolError{Code: aitools.ErrorCodeTimeout, Message: "Tool execution timed out", Retryable: true}, "", nil)
			return outcome, nil
		}
		toolErr := aitools.ClassifyError(aitools.Invocation{ToolName: toolName, Args: args, WorkingDir: r.workingDir, AgentHomeDir: r.agentHomeDir}, toolErrRaw)
		recoveryAction := ""
		if aitools.ShouldRetryWithNormalizedArgs(toolErr) {
			recoveryAction = "retry_with_normalized_args"
		}
		setToolError(toolErr, recoveryAction, nil)
		return outcome, nil
	}

	if toolName == "web.search" {
		if parsed, ok := parseWebSearchResult(result); ok {
			r.recordWebSearchSources(parsed)
		}
	}
	resultAt := time.Now()
	r.persistToolCallSnapshot(toolID, toolName, toolCallStatusSuccess, argsForPersist, result, nil, "", toolStartedAt, resultAt)
	r.persistRunEvent("tool.result", RealtimeStreamKindTool, map[string]any{
		"tool_id":   toolID,
		"tool_name": toolName,
		"status":    "success",
	})
	successPayload := map[string]any{
		"tool_id":   toolID,
		"tool_name": toolName,
		"status":    "success",
		"result":    redactAnyForLog("result", result, 0),
	}
	r.persistExecutionSpan(threadstore.ExecutionSpanRecord{
		SpanID:          toolSpanID,
		EndpointID:      strings.TrimSpace(r.endpointID),
		ThreadID:        strings.TrimSpace(r.threadID),
		RunID:           strings.TrimSpace(r.id),
		Kind:            "tool",
		Name:            toolName,
		Status:          "success",
		PayloadJSON:     marshalPersistJSON(successPayload, 6000),
		StartedAtUnixMs: toolStartedAt.UnixMilli(),
		EndedAtUnixMs:   time.Now().UnixMilli(),
		UpdatedAtUnixMs: time.Now().UnixMilli(),
	})
	r.debug("ai.run.tool.result",
		"tool_id", toolID,
		"tool_name", toolName,
		"status", "success",
		"result_preview", previewAnyForLog(redactAnyForLog("", result, 0), 512),
	)

	outcome.Success = true
	outcome.Result = result
	outcome.ToolError = nil
	outcome.RecoveryAction = ""
	return outcome, nil
}

func (r *run) persistEnsureIndex(idx int) {
	if r == nil || idx < 0 {
		return
	}
	for len(r.assistantBlocks) <= idx {
		r.assistantBlocks = append(r.assistantBlocks, nil)
	}
}

func (r *run) ensureAssistantMessageStarted() bool {
	if r == nil || strings.TrimSpace(r.messageID) == "" {
		return false
	}

	started := false
	r.muAssistant.Lock()
	if len(r.assistantBlocks) == 0 {
		r.assistantCreatedAtUnixMs = time.Now().UnixMilli()
		r.assistantBlocks = []any{&persistedMarkdownBlock{Type: "markdown", Content: ""}}
		started = true
	}
	r.muAssistant.Unlock()

	if !started {
		return false
	}

	r.nextBlockIndex = 1
	r.currentTextBlockIndex = 0
	r.needNewTextBlock = false
	r.currentThinkingBlockIndex = -1
	r.needNewThinkingBlock = false
	r.sendStreamEvent(streamEventMessageStart{Type: "message-start", MessageID: r.messageID})
	r.sendStreamEvent(streamEventBlockStart{Type: "block-start", MessageID: r.messageID, BlockIndex: 0, BlockType: "markdown"})
	return true
}

func (r *run) persistSetMarkdownBlock(idx int) {
	if r == nil || idx < 0 {
		return
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	r.persistEnsureIndex(idx)
	r.assistantBlocks[idx] = &persistedMarkdownBlock{Type: "markdown", Content: ""}
}

func (r *run) persistSetThinkingBlock(idx int) {
	if r == nil || idx < 0 {
		return
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	r.persistEnsureIndex(idx)
	r.assistantBlocks[idx] = &persistedThinkingBlock{Type: "thinking"}
}

func (r *run) persistAppendMarkdownDelta(idx int, delta string) {
	if r == nil || idx < 0 || delta == "" {
		return
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	if idx >= len(r.assistantBlocks) {
		return
	}
	if b, ok := r.assistantBlocks[idx].(*persistedMarkdownBlock); ok && b != nil {
		b.Content += delta
	}
}

func (r *run) persistAppendThinkingDelta(idx int, delta string) {
	if r == nil || idx < 0 || delta == "" {
		return
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	if idx >= len(r.assistantBlocks) {
		return
	}
	if b, ok := r.assistantBlocks[idx].(*persistedThinkingBlock); ok && b != nil {
		b.Content += delta
	}
}

func normalizeSnapshotMessageStatus(status string) string {
	switch strings.TrimSpace(strings.ToLower(status)) {
	case "sending":
		return "sending"
	case "streaming":
		return "streaming"
	case "error":
		return "error"
	case "canceled":
		return "canceled"
	case "complete":
		return "complete"
	default:
		return ""
	}
}

func (r *run) snapshotAssistantMessageJSONWithStatus(status string) (string, string, int64, error) {
	if r == nil {
		return "", "", 0, errors.New("nil run")
	}
	if strings.TrimSpace(r.messageID) == "" {
		return "", "", 0, errors.New("missing message_id")
	}

	r.muAssistant.Lock()
	if len(r.assistantBlocks) == 0 {
		if strings.TrimSpace(strings.ToLower(status)) != "canceled" {
			r.muAssistant.Unlock()
			return "", "", 0, errors.New("assistant blocks unavailable")
		}
		r.assistantCreatedAtUnixMs = time.Now().UnixMilli()
		r.assistantBlocks = []any{&persistedMarkdownBlock{Type: "markdown", Content: ""}}
	}
	blocks := make([]any, 0, len(r.assistantBlocks))
	lastConcrete := -1
	for _, blk := range r.assistantBlocks {
		block := any(&persistedMarkdownBlock{Type: "markdown", Content: ""})
		switch v := blk.(type) {
		case nil:
		case *persistedMarkdownBlock:
			if v != nil {
				cp := *v
				block = &cp
				if strings.TrimSpace(v.Content) != "" {
					lastConcrete = len(blocks)
				}
			}
		case *persistedThinkingBlock:
			if v != nil {
				cp := *v
				block = &cp
				lastConcrete = len(blocks)
			}
		default:
			block = v
			lastConcrete = len(blocks)
		}
		blocks = append(blocks, block)
	}
	if lastConcrete >= 0 {
		blocks = blocks[:lastConcrete+1]
	} else {
		blocks = nil
	}
	assistantAt := r.assistantCreatedAtUnixMs
	r.muAssistant.Unlock()

	msg := persistedMessage{
		ID:        r.messageID,
		Role:      "assistant",
		Blocks:    blocks,
		Status:    normalizeSnapshotMessageStatus(status),
		Timestamp: assistantAt,
	}
	if msg.Status == "" {
		return "", "", 0, fmt.Errorf("unsupported assistant snapshot status %q", strings.TrimSpace(status))
	}
	b, err := json.Marshal(msg)
	if err != nil {
		return "", "", 0, err
	}

	var sb strings.Builder
	for _, blk := range blocks {
		text := assistantVisibleTextFromBlock(blk)
		if text == "" {
			continue
		}
		if sb.Len() > 0 {
			sb.WriteString("\n\n")
		}
		sb.WriteString(text)
	}

	assistantText := strings.TrimSpace(sb.String())
	if assistantText == "" {
		assistantText = r.canonicalMarkdownTextSnapshot("")
	}
	if assistantText == "" {
		assistantText = r.waitingPromptSummarySnapshot()
	}
	return string(b), assistantText, assistantAt, nil
}

func (r *run) snapshotAssistantMessageJSON() (string, string, int64, error) {
	return r.snapshotAssistantMessageJSONWithStatus("complete")
}

func (r *run) assistantPreviewTextSnapshot() (string, int64) {
	if r == nil {
		return "", 0
	}
	r.muAssistant.Lock()
	blocks := make([]any, 0, len(r.assistantBlocks))
	blocks = append(blocks, r.assistantBlocks...)
	assistantAt := r.assistantCreatedAtUnixMs
	r.muAssistant.Unlock()

	var sb strings.Builder
	for _, blk := range blocks {
		text := assistantVisibleTextFromBlock(blk)
		if text == "" {
			continue
		}
		if sb.Len() > 0 {
			sb.WriteString("\n\n")
		}
		sb.WriteString(text)
	}
	if text := strings.TrimSpace(sb.String()); text != "" {
		return text, assistantAt
	}
	if text := r.canonicalMarkdownTextSnapshot(""); text != "" {
		return text, assistantAt
	}
	if text := r.waitingPromptSummarySnapshot(); text != "" {
		return text, assistantAt
	}
	return "", assistantAt
}

func assistantVisibleTextFromBlock(block any) string {
	switch v := block.(type) {
	case *persistedMarkdownBlock:
		if v == nil {
			return ""
		}
		return strings.TrimSpace(v.Content)
	case persistedMarkdownBlock:
		return strings.TrimSpace(v.Content)
	case map[string]any:
		return firstNonEmptyString(anyToString(v["content"]), anyToString(v["text"]))
	case map[string]string:
		return firstNonEmptyString(v["content"], v["text"])
	default:
		return ""
	}
}

func (r *run) waitingPromptSummarySnapshot() string {
	prompt := r.snapshotWaitingPrompt()
	if prompt == nil {
		return ""
	}
	return formatRequestUserInputAssistantSummary(*prompt)
}

func toAnySlice(value any) []any {
	switch v := value.(type) {
	case []any:
		return v
	case []map[string]any:
		out := make([]any, 0, len(v))
		for _, item := range v {
			out = append(out, item)
		}
		return out
	default:
		return nil
	}
}

func extractStringListFromAny(value any) []string {
	items := toAnySlice(value)
	if len(items) == 0 {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		text, ok := item.(string)
		if !ok {
			continue
		}
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}
		out = append(out, text)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func parseAskUserQuestionsAny(value any) []RequestUserInputQuestion {
	switch v := value.(type) {
	case []RequestUserInputQuestion:
		return normalizeRequestUserInputQuestions(append([]RequestUserInputQuestion(nil), v...))
	}
	items := toAnySlice(value)
	if len(items) == 0 {
		return nil
	}
	questions := make([]RequestUserInputQuestion, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok || record == nil {
			continue
		}
		question, ok := requestUserInputQuestionFromRecord(record)
		if !ok {
			continue
		}
		questions = append(questions, question)
	}
	return normalizeRequestUserInputQuestions(questions)
}

func parseWebSearchResult(result any) (websearch.SearchResult, bool) {
	if result == nil {
		return websearch.SearchResult{}, false
	}
	switch v := result.(type) {
	case websearch.SearchResult:
		return v, true
	case *websearch.SearchResult:
		if v == nil {
			return websearch.SearchResult{}, false
		}
		return *v, true
	default:
		// Best-effort: tool outputs are persisted as JSON-compatible values.
		b, err := json.Marshal(v)
		if err != nil || len(b) == 0 {
			return websearch.SearchResult{}, false
		}
		var out websearch.SearchResult
		if err := json.Unmarshal(b, &out); err != nil {
			return websearch.SearchResult{}, false
		}
		if strings.TrimSpace(out.Provider) == "" && strings.TrimSpace(out.Query) == "" && len(out.Results) == 0 && len(out.Sources) == 0 {
			return websearch.SearchResult{}, false
		}
		return out, true
	}
}

func normalizeWebURL(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}
	// Guard against accidental non-URL "sources" like command output.
	if strings.ContainsAny(raw, " \t\r\n") {
		return "", false
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", false
	}
	scheme := strings.ToLower(strings.TrimSpace(u.Scheme))
	if scheme != "http" && scheme != "https" {
		return "", false
	}
	if strings.TrimSpace(u.Host) == "" {
		return "", false
	}
	return u.String(), true
}

func (r *run) addWebSource(title string, rawURL string) {
	if r == nil {
		return
	}
	url, ok := normalizeWebURL(rawURL)
	if !ok {
		return
	}
	title = strings.TrimSpace(title)
	title = strings.ReplaceAll(title, "\n", " ")
	title = strings.ReplaceAll(title, "\r", " ")
	title = strings.TrimSpace(title)
	if title == "" {
		title = url
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if r.collectedWebSources == nil {
		r.collectedWebSources = make(map[string]SourceRef)
	}
	if existing, ok := r.collectedWebSources[url]; ok {
		if existing.Title == "" || existing.Title == existing.URL {
			if title != url {
				existing.Title = title
				r.collectedWebSources[url] = existing
			}
		}
		return
	}
	r.collectedWebSources[url] = SourceRef{Title: title, URL: url}
	r.collectedWebSourceOrder = append(r.collectedWebSourceOrder, url)
}

func (r *run) recordWebSearchSources(res websearch.SearchResult) {
	if r == nil {
		return
	}
	// Prefer explicit sources, fall back to results.
	items := res.Sources
	if len(items) == 0 {
		items = res.Results
	}
	for _, item := range items {
		r.addWebSource(item.Title, item.URL)
	}
}

func (r *run) execTool(ctx context.Context, meta *session.Meta, toolID string, toolName string, args map[string]any) (any, error) {
	if err := r.authorizeToolExecutionFromSnapshot(ctx, toolID, toolName); err != nil {
		return nil, err
	}
	if r.shouldRouteTargetTool(toolName) {
		return r.execTargetTool(ctx, toolID, toolName, args)
	}
	switch toolName {
	case "read_file":
		if !r.canExecuteReadonlyExclusiveTool() {
			return nil, errors.New("readonly tool unavailable for current permission type")
		}
		if meta == nil || !meta.CanRead {
			return nil, errors.New("read permission denied")
		}
		var p struct {
			Path   string `json:"path"`
			Offset int    `json:"offset"`
			Limit  int    `json:"limit"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolFileRead(ctx, FileReadArgs{FilePath: p.Path, Offset: p.Offset, Limit: p.Limit})

	case "read_files":
		if !r.canExecuteReadonlyExclusiveTool() {
			return nil, errors.New("readonly tool unavailable for current permission type")
		}
		if meta == nil || !meta.CanRead {
			return nil, errors.New("read permission denied")
		}
		var p struct {
			Paths []string `json:"paths"`
			Limit int      `json:"limit"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolReadFiles(ctx, p.Paths, p.Limit)

	case "find":
		if !r.canExecuteReadonlyExclusiveTool() {
			return nil, errors.New("readonly tool unavailable for current permission type")
		}
		if meta == nil || !meta.CanRead {
			return nil, errors.New("read permission denied")
		}
		var p struct {
			Root          string `json:"root"`
			Name          string `json:"name"`
			Type          string `json:"type"`
			MaxResults    int    `json:"max_results"`
			MaxDepth      int    `json:"max_depth"`
			IncludeHidden bool   `json:"include_hidden"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolReadonlyFind(ctx, p.Root, p.Name, p.Type, p.MaxResults, p.MaxDepth, p.IncludeHidden)

	case "rgrep":
		if !r.canExecuteReadonlyExclusiveTool() {
			return nil, errors.New("readonly tool unavailable for current permission type")
		}
		if meta == nil || !meta.CanRead {
			return nil, errors.New("read permission denied")
		}
		var p struct {
			Query         string   `json:"query"`
			Paths         []string `json:"paths"`
			Glob          []string `json:"glob"`
			CaseSensitive bool     `json:"case_sensitive"`
			FixedStrings  bool     `json:"fixed_strings"`
			MaxMatches    int      `json:"max_matches"`
			ContextLines  int      `json:"context_lines"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolReadonlyGrep(ctx, p.Query, p.Paths, p.Glob, p.CaseSensitive, p.FixedStrings, p.MaxMatches, p.ContextLines)

	case "web_fetch":
		if !r.canExecuteReadonlyExclusiveTool() {
			return nil, errors.New("readonly tool unavailable for current permission type")
		}
		if meta == nil || !meta.CanRead {
			return nil, errors.New("read permission denied")
		}
		var p webFetchArgs
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolWebFetch(ctx, p)

	case "file.read":
		if !r.canExecuteReadonlyExclusiveTool() {
			return nil, errors.New("readonly tool unavailable for current permission type")
		}
		if meta == nil || !meta.CanRead {
			return nil, errors.New("read permission denied")
		}
		var p FileReadArgs
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolFileRead(ctx, p)

	case "file.edit":
		if meta == nil || !meta.CanWrite {
			return nil, errors.New("write permission denied")
		}
		var p FileEditArgs
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolFileEdit(ctx, p)

	case "file.write":
		if meta == nil || !meta.CanWrite {
			return nil, errors.New("write permission denied")
		}
		var p FileWriteArgs
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolFileWrite(ctx, p)

	case "apply_patch":
		if meta == nil || !meta.CanWrite {
			return nil, errors.New("write permission denied")
		}
		var p struct {
			Patch string `json:"patch"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolApplyPatch(ctx, p.Patch)

	case "terminal.exec":
		return nil, errors.New("terminal.exec must be executed through the hosted terminal process lifecycle")

	case "terminal.read":
		if meta == nil || !meta.CanExecute {
			return nil, errors.New("execute permission denied")
		}
		var p struct {
			ProcessID string `json:"process_id"`
			AfterSeq  int64  `json:"after_seq"`
			WaitMS    int64  `json:"wait_ms"`
			MaxBytes  int64  `json:"max_bytes"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolTerminalRead(p.ProcessID, p.AfterSeq, p.WaitMS, p.MaxBytes)

	case "terminal.write":
		if meta == nil || !meta.CanExecute {
			return nil, errors.New("execute permission denied")
		}
		var p struct {
			ProcessID string `json:"process_id"`
			Input     string `json:"input"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolTerminalWrite(p.ProcessID, p.Input)

	case "terminal.terminate":
		if meta == nil || !meta.CanExecute {
			return nil, errors.New("execute permission denied")
		}
		var p struct {
			ProcessID string `json:"process_id"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolTerminalTerminate(p.ProcessID)

	case "web.search":
		if meta == nil || !meta.CanRead {
			return nil, errors.New("read permission denied")
		}
		var p struct {
			Query     string `json:"query"`
			Provider  string `json:"provider"`
			Count     int    `json:"count"`
			TimeoutMS int64  `json:"timeout_ms"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		query := strings.TrimSpace(p.Query)
		if query == "" {
			return nil, errors.New("missing query")
		}
		provider := strings.TrimSpace(strings.ToLower(p.Provider))
		if provider == "" {
			provider = websearch.ProviderBrave
		}
		timeoutMS := p.TimeoutMS
		if timeoutMS <= 0 {
			timeoutMS = 15_000
		}
		if timeoutMS > 60_000 {
			timeoutMS = 60_000
		}

		key := ""
		ok := false
		if r.resolveWebSearchKey != nil {
			var err error
			key, ok, err = r.resolveWebSearchKey(provider)
			if err != nil {
				return nil, err
			}
		}
		if !ok || strings.TrimSpace(key) == "" {
			// Env var overrides for quick local setup.
			if provider == websearch.ProviderBrave {
				key = strings.TrimSpace(os.Getenv("REDEVEN_BRAVE_API_KEY"))
				if key == "" {
					key = strings.TrimSpace(os.Getenv("BRAVE_API_KEY"))
				}
				ok = strings.TrimSpace(key) != ""
			}
		}
		if !ok || strings.TrimSpace(key) == "" {
			return nil, fmt.Errorf("missing web search api key for provider %q", provider)
		}

		ctx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMS)*time.Millisecond)
		defer cancel()

		return websearch.Search(ctx, provider, key, websearch.SearchRequest{Query: query, Count: p.Count})

	case "okf.index":
		if meta == nil || !meta.CanRead {
			return nil, errors.New("read permission denied")
		}
		var p struct {
			Section string `json:"section"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return okf.Index(okf.IndexRequest{Section: p.Section})

	case "okf.search":
		if meta == nil || !meta.CanRead {
			return nil, errors.New("read permission denied")
		}
		var p struct {
			Query      string   `json:"query"`
			MaxResults int      `json:"max_results"`
			Type       string   `json:"type"`
			Tags       []string `json:"tags"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		query := strings.TrimSpace(p.Query)
		if query == "" {
			return nil, errors.New("missing query")
		}
		return okf.Search(okf.SearchRequest{
			Query:      query,
			MaxResults: p.MaxResults,
			Type:       p.Type,
			Tags:       p.Tags,
		})

	case "okf.open":
		if meta == nil || !meta.CanRead {
			return nil, errors.New("read permission denied")
		}
		var p struct {
			ConceptID  string `json:"concept_id"`
			Path       string `json:"path"`
			BodyOffset int    `json:"body_offset"`
			BodyLimit  int    `json:"body_limit"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return okf.Open(okf.OpenRequest{
			ConceptID:  p.ConceptID,
			Path:       p.Path,
			BodyOffset: p.BodyOffset,
			BodyLimit:  p.BodyLimit,
		})

	case "write_todos":
		var p struct {
			Todos           []TodoItem `json:"todos"`
			ExpectedVersion *int64     `json:"expected_version"`
			Explanation     string     `json:"explanation"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolWriteTodos(ctx, toolID, p.Todos, p.ExpectedVersion, p.Explanation)

	case "use_skill":
		if meta == nil || !meta.CanExecute {
			return nil, errors.New("execute permission denied")
		}
		var p struct {
			Name   string `json:"name"`
			Reason string `json:"reason"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		name := strings.TrimSpace(p.Name)
		if name == "" {
			return nil, errors.New("missing name")
		}
		reason := strings.TrimSpace(p.Reason)
		activation, alreadyActive, err := r.activateSkill(name)
		if err != nil {
			return nil, err
		}
		out := map[string]any{
			"name":             activation.Name,
			"activation_id":    activation.ActivationID,
			"already_active":   alreadyActive,
			"content":          activation.Content,
			"content_ref":      activation.ContentRef,
			"root_dir":         activation.RootDir,
			"permission_hints": activation.PermissionHints,
		}
		if reason != "" {
			out["reason"] = reason
		}
		if len(activation.Dependencies) > 0 {
			deps := make([]map[string]any, 0, len(activation.Dependencies))
			for _, dep := range activation.Dependencies {
				deps = append(deps, map[string]any{
					"name":      dep.Name,
					"transport": dep.Transport,
					"command":   dep.Command,
					"url":       dep.URL,
				})
			}
			out["dependencies"] = deps
			out["dependency_degraded"] = true
		}
		return out, nil

	case "subagents":
		if meta == nil || !meta.CanExecute {
			return nil, errors.New("execute permission denied")
		}
		return r.manageSubagentsForTool(ctx, toolID, cloneAnyMap(args))

	default:
		return nil, fmt.Errorf("unknown tool: %s", toolName)
	}
}

func (r *run) canExecuteReadonlyExclusiveTool() bool {
	return r != nil && r.permissionType == FlowerPermissionReadonly
}

func (r *run) authorizeToolExecutionFromSnapshot(ctx context.Context, toolID string, toolName string) error {
	if r == nil || !permissionSnapshotActive(r.permissionSnapshot) {
		return nil
	}
	if r.subagentDepth <= 0 && !r.noUserInteraction && r.threadsDB != nil {
		previousEpoch := permissionSurfaceEpoch(r.permissionSnapshot)
		surfaceConfig := r.dynamicSurfaceConfig
		if !surfaceConfig.UseLatestThreadPermission {
			surfaceConfig.UseLatestThreadPermission = true
		}
		surfaceConfig.IncludeControlSignalsInSnapshot = true
		if surface, err := r.buildRunToolSurface(ctx, surfaceConfig, r.permissionType); err == nil {
			if surface.Epoch != "" && surface.Epoch != previousEpoch {
				r.persistRunEvent("tool_surface.updated", RealtimeStreamKindLifecycle, map[string]any{
					"phase":             "local_tool_dispatch",
					"permission_type":   permissionTypeString(surface.PermissionType),
					"snapshot_id":       strings.TrimSpace(surface.PermissionSnapshot.SnapshotID),
					"snapshot_hash":     strings.TrimSpace(surface.PermissionSnapshot.SnapshotHash),
					"registry_hash":     strings.TrimSpace(surface.PermissionSnapshot.RegistryHash),
					"schema_hash":       strings.TrimSpace(surface.PermissionSnapshot.SchemaHash),
					"presentation_hash": strings.TrimSpace(surface.PermissionSnapshot.PresentationHash),
				})
			}
		}
	}
	toolName = strings.TrimSpace(toolName)
	if toolName == "" {
		return errors.New("missing tool_name")
	}
	policy, ok := r.permissionSnapshot.ToolPolicies[toolName]
	if !ok || !stringSliceContains(r.permissionSnapshot.FloretToolNames, toolName) {
		return errors.New("permission denied: tool unavailable for current permission snapshot")
	}
	switch policy.ApprovalDecision {
	case ApprovalDecisionDeny:
		return errors.New("permission denied: tool denied by current permission snapshot")
	case ApprovalDecisionAsk:
		if !contextHasFloretToolExecutionAuthorization(ctx, toolID, toolName) {
			return errors.New("permission denied: tool approval required before execution")
		}
	}
	return nil
}

func permissionSnapshotActive(snapshot PermissionSnapshot) bool {
	return strings.TrimSpace(snapshot.SnapshotID) != "" ||
		len(snapshot.FloretToolNames) > 0 ||
		len(snapshot.ToolPolicies) > 0
}

func stringSliceContains(values []string, target string) bool {
	target = strings.TrimSpace(target)
	if target == "" {
		return false
	}
	for _, value := range values {
		if strings.TrimSpace(value) == target {
			return true
		}
	}
	return false
}

const (
	readonlyReadFilesDefaultLimit   = 120
	readonlyReadFilesMaxFiles       = 20
	readonlyFindDefaultMaxResults   = 200
	readonlyFindMaxResults          = 1000
	readonlyFindDefaultMaxDepth     = 8
	readonlyFindMaxDepth            = 32
	readonlyFindMaxVisitedEntries   = 10000
	readonlyFindMaxElapsed          = 5 * time.Second
	readonlyGrepDefaultMaxMatches   = 200
	readonlyGrepMaxMatches          = 1000
	readonlyGrepDefaultContextLines = 0
	readonlyGrepMaxContextLines     = 5
	readonlyGrepMaxFileBytes        = 2 << 20
	readonlyGrepMaxVisitedEntries   = 10000
	readonlyGrepMaxScannedFiles     = 5000
	readonlyGrepMaxScannedBytes     = 32 << 20
	readonlyGrepMaxElapsed          = 5 * time.Second
	readonlyGrepMaxLineRunes        = 2000
	readonlyGrepMaxContextRunes     = 1000
)

var errReadonlyScanLimit = errors.New("readonly scan limit reached")

type readonlyScanBudget struct {
	startedAt         time.Time
	maxVisitedEntries int
	maxScannedFiles   int
	maxScannedBytes   int64
	maxElapsed        time.Duration
	visitedEntries    int
	scannedFiles      int
	scannedBytes      int64
	limitReason       string
}

func newReadonlyScanBudget(maxVisitedEntries int, maxScannedFiles int, maxScannedBytes int64, maxElapsed time.Duration) *readonlyScanBudget {
	return &readonlyScanBudget{
		startedAt:         time.Now(),
		maxVisitedEntries: maxVisitedEntries,
		maxScannedFiles:   maxScannedFiles,
		maxScannedBytes:   maxScannedBytes,
		maxElapsed:        maxElapsed,
	}
}

func (b *readonlyScanBudget) recordVisitedEntry() error {
	if b == nil {
		return nil
	}
	b.visitedEntries++
	if b.maxVisitedEntries > 0 && b.visitedEntries > b.maxVisitedEntries {
		return b.stop("max_visited_entries")
	}
	return b.checkElapsed()
}

func (b *readonlyScanBudget) recordScannedFile(size int64) error {
	if b == nil {
		return nil
	}
	if size < 0 {
		size = 0
	}
	if b.maxScannedFiles > 0 && b.scannedFiles+1 > b.maxScannedFiles {
		return b.stop("max_scanned_files")
	}
	if b.maxScannedBytes > 0 && b.scannedBytes+size > b.maxScannedBytes {
		return b.stop("max_scanned_bytes")
	}
	b.scannedFiles++
	b.scannedBytes += size
	return b.checkElapsed()
}

func (b *readonlyScanBudget) checkElapsed() error {
	if b == nil || b.maxElapsed <= 0 {
		return nil
	}
	if time.Since(b.startedAt) <= b.maxElapsed {
		return nil
	}
	return b.stop("max_elapsed")
}

func (b *readonlyScanBudget) stop(reason string) error {
	if b != nil && b.limitReason == "" {
		b.limitReason = strings.TrimSpace(reason)
	}
	return errReadonlyScanLimit
}

func (b *readonlyScanBudget) stats() map[string]interface{} {
	if b == nil {
		return nil
	}
	stats := map[string]interface{}{
		"visited_entries": b.visitedEntries,
	}
	if b.scannedFiles > 0 {
		stats["scanned_files"] = b.scannedFiles
	}
	if b.scannedBytes > 0 {
		stats["scanned_bytes"] = b.scannedBytes
	}
	if b.limitReason != "" {
		stats["limit_reason"] = b.limitReason
	}
	return stats
}

type readonlyReadFilesResult struct {
	Files     []readonlyReadFileResult `json:"files"`
	Truncated bool                     `json:"truncated,omitempty"`
}

type readonlyReadFileResult struct {
	Path   string          `json:"path"`
	Result *FileReadResult `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
}

func (r *run) toolReadFiles(ctx context.Context, paths []string, limit int) (readonlyReadFilesResult, error) {
	if len(paths) == 0 {
		return readonlyReadFilesResult{}, errors.New("paths is required")
	}
	truncated := false
	if len(paths) > readonlyReadFilesMaxFiles {
		paths = paths[:readonlyReadFilesMaxFiles]
		truncated = true
	}
	if limit <= 0 {
		limit = readonlyReadFilesDefaultLimit
	}
	if limit > maxFileReadLimit {
		limit = maxFileReadLimit
	}
	out := readonlyReadFilesResult{
		Files:     make([]readonlyReadFileResult, 0, len(paths)),
		Truncated: truncated,
	}
	for _, path := range paths {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		path = strings.TrimSpace(path)
		item := readonlyReadFileResult{Path: path}
		result, err := r.toolFileRead(ctx, FileReadArgs{FilePath: path, Limit: limit})
		if err != nil {
			item.Error = err.Error()
		} else {
			item.Result = &result
		}
		out.Files = append(out.Files, item)
	}
	return out, nil
}

type readonlyFindResult struct {
	Root      string                 `json:"root"`
	Results   []readonlyFindItem     `json:"results"`
	Truncated bool                   `json:"truncated,omitempty"`
	Stats     map[string]interface{} `json:"stats,omitempty"`
}

type readonlyFindItem struct {
	Path        string `json:"path"`
	DisplayName string `json:"display_name"`
	Type        string `json:"type"`
	Size        int64  `json:"size,omitempty"`
}

func (r *run) toolReadonlyFind(ctx context.Context, root string, namePattern string, typeFilter string, maxResults int, maxDepth int, includeHidden bool) (readonlyFindResult, error) {
	scope, err := r.runPathScope()
	if err != nil {
		return readonlyFindResult{}, mapToolCwdError(err)
	}
	root = strings.TrimSpace(root)
	if root == "" {
		root = scope.WorkingDirAbs
	}
	if strings.ContainsRune(root, 0) || strings.ContainsRune(namePattern, 0) {
		return readonlyFindResult{}, errInvalidToolPath
	}
	resolvedRoot, err := scope.ResolveExistingPath(root)
	if err != nil {
		return readonlyFindResult{}, mapToolFilePathError(err)
	}
	info, err := os.Lstat(resolvedRoot)
	if err != nil {
		return readonlyFindResult{}, mapToolFilePathError(err)
	}
	if !info.IsDir() {
		return readonlyFindResult{}, errors.New("root must be a directory")
	}
	typeFilter = strings.ToLower(strings.TrimSpace(typeFilter))
	switch typeFilter {
	case "", "any", "file", "dir", "directory", "symlink":
	default:
		return readonlyFindResult{}, errors.New("invalid type")
	}
	if maxResults <= 0 {
		maxResults = readonlyFindDefaultMaxResults
	}
	if maxResults > readonlyFindMaxResults {
		maxResults = readonlyFindMaxResults
	}
	if maxDepth <= 0 {
		maxDepth = readonlyFindDefaultMaxDepth
	}
	if maxDepth > readonlyFindMaxDepth {
		maxDepth = readonlyFindMaxDepth
	}
	matcher, err := newReadonlyNameMatcher(namePattern)
	if err != nil {
		return readonlyFindResult{}, err
	}
	budget := newReadonlyScanBudget(readonlyFindMaxVisitedEntries, 0, 0, readonlyFindMaxElapsed)
	out := readonlyFindResult{Root: resolvedRoot, Results: make([]readonlyFindItem, 0, min(maxResults, 64))}
	walkErr := filepath.WalkDir(resolvedRoot, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		if err := budget.recordVisitedEntry(); err != nil {
			out.Truncated = true
			return filepath.SkipAll
		}
		if path != resolvedRoot {
			name := entry.Name()
			if !includeHidden && strings.HasPrefix(name, ".") {
				if entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if depthBeyondRoot(resolvedRoot, path) > maxDepth {
				if entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
		}
		if path == resolvedRoot {
			return nil
		}
		if len(out.Results) >= maxResults {
			out.Truncated = true
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		resolved, err := scope.Registry.Resolve(path, filesystemscope.ResolveOptions{RequireExisting: true})
		if err != nil || filepath.Clean(resolved.RealAbs) != filepath.Clean(path) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		itemType, size := readonlyFindEntryType(entry)
		if !readonlyFindTypeMatches(typeFilter, itemType) || !matcher(entry.Name()) {
			return nil
		}
		out.Results = append(out.Results, readonlyFindItem{
			Path:        path,
			DisplayName: displayNameForFilePath(path),
			Type:        itemType,
			Size:        size,
		})
		return nil
	})
	if walkErr != nil {
		return out, walkErr
	}
	out.Stats = budget.stats()
	sort.SliceStable(out.Results, func(i, j int) bool {
		return out.Results[i].Path < out.Results[j].Path
	})
	return out, nil
}

type readonlyGrepResult struct {
	Query     string                 `json:"query"`
	Matches   []readonlyGrepMatch    `json:"matches"`
	Truncated bool                   `json:"truncated,omitempty"`
	Stats     map[string]interface{} `json:"stats,omitempty"`
}

type readonlyGrepMatch struct {
	Path        string                `json:"path"`
	DisplayName string                `json:"display_name"`
	Line        int                   `json:"line"`
	Column      int                   `json:"column,omitempty"`
	Text        string                `json:"text"`
	Context     []readonlyGrepContext `json:"context,omitempty"`
}

type readonlyGrepContext struct {
	Line int    `json:"line"`
	Text string `json:"text"`
}

func (r *run) toolReadonlyGrep(ctx context.Context, query string, paths []string, globs []string, caseSensitive bool, fixedStrings bool, maxMatches int, contextLines int) (readonlyGrepResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return readonlyGrepResult{}, errors.New("query is required")
	}
	if strings.ContainsRune(query, 0) {
		return readonlyGrepResult{}, errors.New("invalid query")
	}
	if maxMatches <= 0 {
		maxMatches = readonlyGrepDefaultMaxMatches
	}
	if maxMatches > readonlyGrepMaxMatches {
		maxMatches = readonlyGrepMaxMatches
	}
	if contextLines < 0 {
		contextLines = readonlyGrepDefaultContextLines
	}
	if contextLines > readonlyGrepMaxContextLines {
		contextLines = readonlyGrepMaxContextLines
	}
	matcher, err := newReadonlyGrepMatcher(query, caseSensitive, fixedStrings)
	if err != nil {
		return readonlyGrepResult{}, err
	}
	globMatcher, err := newReadonlyGlobMatcher(globs)
	if err != nil {
		return readonlyGrepResult{}, err
	}
	scope, err := r.runPathScope()
	if err != nil {
		return readonlyGrepResult{}, mapToolCwdError(err)
	}
	if len(paths) == 0 {
		paths = []string{scope.WorkingDirAbs}
	}
	out := readonlyGrepResult{
		Query:   query,
		Matches: make([]readonlyGrepMatch, 0, min(maxMatches, 64)),
		Stats:   map[string]interface{}{"engine": "go"},
	}
	budget := newReadonlyScanBudget(readonlyGrepMaxVisitedEntries, readonlyGrepMaxScannedFiles, readonlyGrepMaxScannedBytes, readonlyGrepMaxElapsed)
	for _, rawPath := range paths {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		if strings.ContainsRune(rawPath, 0) {
			return out, errInvalidToolPath
		}
		resolvedPath, err := scope.ResolveExistingPath(rawPath)
		if err != nil {
			return out, mapToolFilePathError(err)
		}
		info, err := os.Lstat(resolvedPath)
		if err != nil {
			return out, mapToolFilePathError(err)
		}
		if info.IsDir() {
			err = filepath.WalkDir(resolvedPath, func(path string, entry os.DirEntry, err error) error {
				if err != nil {
					return nil
				}
				if ctxErr := ctx.Err(); ctxErr != nil {
					return ctxErr
				}
				if err := budget.recordVisitedEntry(); err != nil {
					out.Truncated = true
					return filepath.SkipAll
				}
				if path != resolvedPath && strings.HasPrefix(entry.Name(), ".") {
					if entry.IsDir() {
						return filepath.SkipDir
					}
					return nil
				}
				if entry.IsDir() {
					return nil
				}
				if len(out.Matches) >= maxMatches {
					out.Truncated = true
					return filepath.SkipAll
				}
				if err := r.grepReadonlyFile(ctx, scope, path, globMatcher, matcher, contextLines, maxMatches, budget, &out); err != nil {
					if errors.Is(err, errReadonlyScanLimit) {
						out.Truncated = true
						return filepath.SkipAll
					}
					return err
				}
				return nil
			})
			if err != nil {
				return out, err
			}
			continue
		}
		if err := budget.recordVisitedEntry(); err != nil {
			out.Truncated = true
			break
		}
		if err := r.grepReadonlyFile(ctx, scope, resolvedPath, globMatcher, matcher, contextLines, maxMatches, budget, &out); err != nil {
			if errors.Is(err, errReadonlyScanLimit) {
				out.Truncated = true
				break
			}
			return out, err
		}
	}
	sort.SliceStable(out.Matches, func(i, j int) bool {
		if out.Matches[i].Path == out.Matches[j].Path {
			return out.Matches[i].Line < out.Matches[j].Line
		}
		return out.Matches[i].Path < out.Matches[j].Path
	})
	if out.Truncated {
		if budget.limitReason == "" {
			out.Stats["limit_reason"] = "max_matches"
		}
	}
	for key, value := range budget.stats() {
		out.Stats[key] = value
	}
	return out, nil
}

func (r *run) grepReadonlyFile(ctx context.Context, scope runPathScope, path string, globMatcher func(string) bool, matcher readonlyLineMatcher, contextLines int, maxMatches int, budget *readonlyScanBudget, out *readonlyGrepResult) error {
	if len(out.Matches) >= maxMatches {
		out.Truncated = true
		return nil
	}
	resolved, err := scope.Registry.Resolve(path, filesystemscope.ResolveOptions{RequireExisting: true})
	if err != nil || filepath.Clean(resolved.RealAbs) != filepath.Clean(path) {
		return nil
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > readonlyGrepMaxFileBytes {
		return nil
	}
	if !globMatcher(path) {
		return nil
	}
	if err := budget.recordScannedFile(info.Size()); err != nil {
		out.Truncated = true
		return err
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if !utf8.Valid(content) {
		return nil
	}
	lines := splitFileReadLines(string(content))
	for idx, line := range lines {
		if len(out.Matches) >= maxMatches {
			out.Truncated = true
			return nil
		}
		column, ok := matcher(line)
		if !ok {
			continue
		}
		match := readonlyGrepMatch{
			Path:        path,
			DisplayName: displayNameForFilePath(path),
			Line:        idx + 1,
			Column:      column,
			Text:        truncateReadonlySnippet(line, readonlyGrepMaxLineRunes),
		}
		if contextLines > 0 {
			match.Context = readonlyContextWindow(lines, idx, contextLines)
		}
		out.Matches = append(out.Matches, match)
	}
	return nil
}

type readonlyLineMatcher func(line string) (column int, ok bool)

func newReadonlyGrepMatcher(query string, caseSensitive bool, fixedStrings bool) (readonlyLineMatcher, error) {
	if fixedStrings {
		needle := query
		if !caseSensitive {
			needle = strings.ToLower(needle)
		}
		return func(line string) (int, bool) {
			haystack := line
			if !caseSensitive {
				haystack = strings.ToLower(haystack)
			}
			idx := strings.Index(haystack, needle)
			if idx < 0 {
				return 0, false
			}
			return utf8.RuneCountInString(line[:idx]) + 1, true
		}, nil
	}
	pattern := query
	if !caseSensitive {
		pattern = "(?i)" + pattern
	}
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, err
	}
	return func(line string) (int, bool) {
		loc := re.FindStringIndex(line)
		if loc == nil {
			return 0, false
		}
		return utf8.RuneCountInString(line[:loc[0]]) + 1, true
	}, nil
}

func newReadonlyNameMatcher(pattern string) (func(string) bool, error) {
	pattern = strings.TrimSpace(pattern)
	if pattern == "" {
		return func(string) bool { return true }, nil
	}
	if strings.ContainsRune(pattern, 0) {
		return nil, errInvalidToolPath
	}
	return func(name string) bool {
		ok, err := filepath.Match(pattern, name)
		return err == nil && ok
	}, nil
}

func newReadonlyGlobMatcher(globs []string) (func(string) bool, error) {
	cleanGlobs := make([]string, 0, len(globs))
	for _, glob := range globs {
		glob = strings.TrimSpace(glob)
		if glob == "" {
			continue
		}
		if strings.ContainsRune(glob, 0) {
			return nil, errInvalidToolPath
		}
		if _, err := filepath.Match(glob, "sample"); err != nil {
			return nil, err
		}
		cleanGlobs = append(cleanGlobs, filepath.ToSlash(glob))
	}
	if len(cleanGlobs) == 0 {
		return func(string) bool { return true }, nil
	}
	return func(path string) bool {
		slashPath := filepath.ToSlash(path)
		base := filepath.Base(path)
		for _, glob := range cleanGlobs {
			if ok, _ := filepath.Match(glob, base); ok {
				return true
			}
			if ok, _ := filepath.Match(glob, slashPath); ok {
				return true
			}
			if strings.HasPrefix(glob, "**/") {
				if ok, _ := filepath.Match(strings.TrimPrefix(glob, "**/"), base); ok {
					return true
				}
			}
		}
		return false
	}, nil
}

func readonlyContextWindow(lines []string, matchIdx int, contextLines int) []readonlyGrepContext {
	start := matchIdx - contextLines
	if start < 0 {
		start = 0
	}
	end := matchIdx + contextLines + 1
	if end > len(lines) {
		end = len(lines)
	}
	out := make([]readonlyGrepContext, 0, end-start-1)
	for idx := start; idx < end; idx++ {
		if idx == matchIdx {
			continue
		}
		out = append(out, readonlyGrepContext{Line: idx + 1, Text: truncateReadonlySnippet(lines[idx], readonlyGrepMaxContextRunes)})
	}
	return out
}

func truncateReadonlySnippet(text string, maxRunes int) string {
	text = strings.TrimRight(text, "\n")
	if maxRunes <= 0 {
		return text
	}
	runes := []rune(text)
	if len(runes) <= maxRunes {
		return text
	}
	return string(runes[:maxRunes]) + "... (truncated)"
}

func readonlyFindEntryType(entry os.DirEntry) (string, int64) {
	info, err := entry.Info()
	size := int64(0)
	if err == nil {
		size = info.Size()
	}
	mode := entry.Type()
	switch {
	case mode&os.ModeSymlink != 0:
		return "symlink", size
	case entry.IsDir():
		return "dir", size
	default:
		return "file", size
	}
}

func readonlyFindTypeMatches(typeFilter string, itemType string) bool {
	switch strings.ToLower(strings.TrimSpace(typeFilter)) {
	case "", "any":
		return true
	case "directory":
		return itemType == "dir"
	default:
		return itemType == typeFilter
	}
}

func depthBeyondRoot(root string, path string) int {
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "." {
		return 0
	}
	rel = filepath.Clean(rel)
	depth := 1
	for _, r := range rel {
		if r == os.PathSeparator {
			depth++
		}
	}
	return depth
}

func (r *run) shouldRouteTargetTool(toolName string) bool {
	return toolRequiresTarget(toolName) && r.toolTargetPolicy.requiresExplicitTarget()
}

func (r *run) execTargetTool(ctx context.Context, toolID string, toolName string, args map[string]any) (any, error) {
	policy := normalizeToolTargetPolicy(r.toolTargetPolicy)
	targetID := targetIDFromToolArgs(args)
	if strings.TrimSpace(targetID) == "" {
		targetID = strings.TrimSpace(policy.DefaultTargetID)
	}
	if strings.TrimSpace(targetID) == "" {
		return nil, &targetToolPolicyError{
			code:   "missing_target_id",
			tool:   toolName,
			target: "",
		}
	}
	if !targetAllowedByPolicy(policy, targetID) {
		return nil, &targetToolPolicyError{
			code:   "target_not_allowed",
			tool:   toolName,
			target: targetID,
		}
	}
	if r.targetToolExecutor == nil {
		return nil, &targetToolPolicyError{
			code:   "target_executor_unavailable",
			tool:   toolName,
			target: targetID,
		}
	}
	forwardedArgs := StripTargetToolArgs(args)
	rawArgs, err := json.Marshal(forwardedArgs)
	if err != nil {
		return nil, errors.New("invalid args")
	}
	result, err := r.targetToolExecutor.ExecuteTargetTool(ctx, TargetToolCall{
		ToolCallID:           strings.TrimSpace(toolID),
		TargetID:             targetID,
		ToolName:             strings.TrimSpace(toolName),
		Arguments:            rawArgs,
		RequiredCapabilities: requiredTargetCapabilities(toolName),
	})
	if err != nil {
		return nil, err
	}
	return targetToolResultPayload(result, targetID), nil
}

func targetToolResultPayload(result TargetToolResult, requestedTargetID string) any {
	targetID := strings.TrimSpace(result.TargetID)
	if targetID == "" {
		targetID = strings.TrimSpace(requestedTargetID)
	}
	executionLocation := strings.TrimSpace(result.ExecutionLocation)
	if payload, ok := result.Result.(map[string]any); ok && payload != nil {
		out := cloneAnyMap(payload)
		if strings.TrimSpace(anyToString(out["target_id"])) == "" && targetID != "" {
			out["target_id"] = targetID
		}
		if strings.TrimSpace(anyToString(out["execution_location"])) == "" && executionLocation != "" {
			out["execution_location"] = executionLocation
		}
		return out
	}
	out := map[string]any{}
	if targetID != "" {
		out["target_id"] = targetID
	}
	if executionLocation != "" {
		out["execution_location"] = executionLocation
	}
	if result.Result != nil {
		out["result"] = result.Result
	}
	return out
}

type targetToolPolicyError struct {
	code   string
	tool   string
	target string
}

func (e *targetToolPolicyError) Error() string {
	switch strings.TrimSpace(e.code) {
	case "missing_target_id":
		return "target_id is required for target-scoped Flower tools"
	case "target_executor_unavailable":
		return "target tool executor is unavailable"
	case "target_not_allowed":
		return "target_id is not allowed for this Flower thread"
	default:
		return "target tool policy denied the tool call"
	}
}

func (e *targetToolPolicyError) InvalidArgumentsCode() string {
	return e.code
}

func (e *targetToolPolicyError) InvalidArgumentsMeta() map[string]any {
	out := map[string]any{
		"tool_name": strings.TrimSpace(e.tool),
	}
	if strings.TrimSpace(e.target) != "" {
		out["target_id"] = strings.TrimSpace(e.target)
	}
	return out
}

var (
	errEmptyWorkingDir      = errors.New("empty working_dir")
	errInvalidWorkingDir    = errors.New("invalid working_dir")
	errInvalidToolPath      = errors.New("invalid path")
	errToolPathMustAbsolute = errors.New("path must be absolute")
)

func (r *run) workingDirAbs() (string, error) {
	scope, err := r.runPathScope()
	if err != nil {
		return "", err
	}
	return scope.WorkingDirAbs, nil
}

type runPathScope struct {
	Registry      *filesystemscope.Registry
	WorkingDirAbs string
}

func (s runPathScope) resolveInput(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	if path == "~" || strings.HasPrefix(path, "~/") || filepath.IsAbs(path) {
		return path
	}
	if strings.TrimSpace(s.WorkingDirAbs) == "" {
		return path
	}
	return filepath.Join(s.WorkingDirAbs, path)
}

func (s runPathScope) ResolveExistingPath(path string) (string, error) {
	if s.Registry == nil {
		return "", errors.New("nil filesystem scope")
	}
	resolved, err := s.Registry.Resolve(s.resolveInput(path), filesystemscope.ResolveOptions{RequireExisting: true})
	if err != nil {
		return "", err
	}
	return resolved.RealAbs, nil
}

func (s runPathScope) ResolveTargetPath(path string) (string, error) {
	if s.Registry == nil {
		return "", errors.New("nil filesystem scope")
	}
	resolved, err := s.Registry.ResolveTarget(s.resolveInput(path), filesystemscope.ResolveOptions{})
	if err != nil {
		return "", err
	}
	return resolved.RealAbs, nil
}

func (r *run) runPathScope() (runPathScope, error) {
	workingDir := strings.TrimSpace(r.workingDir)
	if workingDir == "" {
		workingDir = strings.TrimSpace(r.agentHomeDir)
	}
	if workingDir == "" {
		return runPathScope{}, errEmptyWorkingDir
	}
	registry := r.scope
	if registry == nil {
		var err error
		registry, err = filesystemscope.NewDefaultRegistry(r.agentHomeDir)
		if err != nil {
			return runPathScope{}, errInvalidWorkingDir
		}
	}
	resolved, err := registry.Resolve(workingDir, filesystemscope.ResolveOptions{RequireExisting: true, RequireDir: true})
	if err != nil {
		return runPathScope{}, errInvalidWorkingDir
	}
	return runPathScope{Registry: registry, WorkingDirAbs: resolved.RealAbs}, nil
}

func (r *run) resolveToolPath(raw string, workingDirAbs string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errInvalidToolPath
	}
	scope, err := r.runPathScope()
	if err != nil {
		return "", errInvalidWorkingDir
	}
	if strings.TrimSpace(workingDirAbs) != "" {
		scope.WorkingDirAbs = strings.TrimSpace(workingDirAbs)
	}
	resolved, err := scope.ResolveTargetPath(raw)
	if err != nil {
		return "", errInvalidToolPath
	}
	return resolved, nil
}

func mapToolCwdError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, errToolPathMustAbsolute):
		return errors.New("cwd must be absolute")
	default:
		return errors.New("invalid cwd")
	}
}

func (r *run) toolApplyPatch(ctx context.Context, patchText string) (any, error) {
	patchText = strings.TrimSpace(patchText)
	if patchText == "" {
		return nil, errors.New("missing patch")
	}

	workingDirAbs, err := r.workingDirAbs()
	if err != nil {
		return nil, mapToolCwdError(err)
	}

	if err := ctx.Err(); err != nil {
		return nil, err
	}
	parsed, err := applyUnifiedDiff(workingDirAbs, patchText)
	if err != nil {
		return nil, err
	}

	filesChanged, hunks, additions, deletions, files := summarizePatchFiles(parsed.files)
	return ApplyPatchResult{
		FilesChanged:     filesChanged,
		Hunks:            hunks,
		Additions:        additions,
		Deletions:        deletions,
		InputFormat:      string(parsed.inputFormat),
		NormalizedFormat: string(parsed.normalizedFormat),
		Files:            files,
		Mutations:        parsed.mutations,
	}, nil
}

func (r *run) normalizeTerminalExecCwd(cwd string, workdir string) (string, error) {
	cwd = strings.TrimSpace(cwd)
	workdir = strings.TrimSpace(workdir)
	if cwd == "" {
		return workdir, nil
	}
	if workdir == "" {
		return cwd, nil
	}
	workingDirAbs, err := r.workingDirAbs()
	if err != nil {
		return "", mapToolCwdError(err)
	}
	resolvedCwd, err := r.resolveToolPath(cwd, workingDirAbs)
	if err != nil {
		return "", errors.New("invalid cwd")
	}
	resolvedWorkdir, err := r.resolveToolPath(workdir, workingDirAbs)
	if err != nil {
		return "", errors.New("invalid cwd")
	}
	if filepath.Clean(resolvedCwd) != filepath.Clean(resolvedWorkdir) {
		return "", errors.New("invalid cwd")
	}
	return resolvedCwd, nil
}

type terminalExecProcessArgs struct {
	Command     string `json:"command"`
	Stdin       string `json:"stdin"`
	Cwd         string `json:"cwd"`
	Workdir     string `json:"workdir"`
	YieldMS     int64  `json:"yield_ms"`
	Description string `json:"description"`
}

func (r *run) handleTerminalExecProcessTool(ctx context.Context, meta *session.Meta, toolID string, args map[string]any, argsForPersist map[string]any, toolStartedAt time.Time, toolSpanID string, activityUpdater toolActivityUpdater) (*toolCallOutcome, *aitools.ToolError) {
	outcome := &toolCallOutcome{
		Success:  false,
		ToolName: "terminal.exec",
		Args:     cloneAnyMap(args),
	}
	if err := r.authorizeToolExecutionFromSnapshot(ctx, toolID, "terminal.exec"); err != nil {
		return outcome, aitools.ClassifyError(aitools.Invocation{ToolName: "terminal.exec", Args: args, WorkingDir: r.workingDir, AgentHomeDir: r.agentHomeDir}, err)
	}
	if meta == nil || !meta.CanExecute {
		return outcome, &aitools.ToolError{Code: aitools.ErrorCodePermissionDenied, Message: "execute permission denied", Retryable: false}
	}
	var parsed terminalExecProcessArgs
	b, _ := json.Marshal(args)
	if err := json.Unmarshal(b, &parsed); err != nil {
		return outcome, &aitools.ToolError{Code: aitools.ErrorCodeInvalidArguments, Message: "invalid args", Retryable: false}
	}
	if strings.TrimSpace(parsed.Command) == "" {
		return outcome, &aitools.ToolError{Code: aitools.ErrorCodeInvalidArguments, Message: "missing command", Retryable: false}
	}
	if len(parsed.Stdin) > 200_000 {
		return outcome, &aitools.ToolError{Code: aitools.ErrorCodeInvalidArguments, Message: "stdin too large", Retryable: false}
	}
	cwd, err := r.normalizeTerminalExecCwd(parsed.Cwd, parsed.Workdir)
	if err != nil {
		return outcome, aitools.ClassifyError(aitools.Invocation{ToolName: "terminal.exec", Args: args, WorkingDir: r.workingDir, AgentHomeDir: r.agentHomeDir}, err)
	}
	workingDirAbs, err := r.workingDirAbs()
	if err != nil {
		return outcome, aitools.ClassifyError(aitools.Invocation{ToolName: "terminal.exec", Args: args, WorkingDir: r.workingDir, AgentHomeDir: r.agentHomeDir}, mapToolCwdError(err))
	}
	if strings.TrimSpace(cwd) == "" {
		cwd = workingDirAbs
	}
	cwdAbs, err := r.resolveToolPath(cwd, workingDirAbs)
	if err != nil {
		return outcome, aitools.ClassifyError(aitools.Invocation{ToolName: "terminal.exec", Args: args, WorkingDir: r.workingDir, AgentHomeDir: r.agentHomeDir}, mapToolCwdError(err))
	}
	manager := (*terminalProcessManager)(nil)
	if r.service != nil {
		manager = r.service.terminalProcessManager()
	}
	if manager == nil {
		return outcome, &aitools.ToolError{Code: aitools.ErrorCodeUnknown, Message: "terminal process manager unavailable", Retryable: true}
	}
	shell := strings.TrimSpace(r.shell)
	if shell == "" {
		shell = "/bin/bash"
	}

	r.debug("ai.run.tool.exec.start", "tool_id", toolID, "tool_name", "terminal.exec")
	endBusy := r.beginBusy()
	defer endBusy()

	proc, err := manager.Start(terminalProcessStartRequest{
		EndpointID:         strings.TrimSpace(r.endpointID),
		ThreadID:           strings.TrimSpace(r.threadID),
		RunID:              strings.TrimSpace(r.id),
		TurnID:             strings.TrimSpace(r.messageID),
		SettlementThreadID: strings.TrimSpace(r.settlementThreadID),
		SettlementRunID:    strings.TrimSpace(r.settlementRunID),
		SettlementTurnID:   strings.TrimSpace(r.settlementTurnID),
		ToolID:             strings.TrimSpace(toolID),
		ToolName:           "terminal.exec",
		Command:            parsed.Command,
		Stdin:              parsed.Stdin,
		CwdAbs:             cwdAbs,
		Shell:              shell,
		Env:                prependRedevenBinToEnv(os.Environ()),
	})
	if err != nil {
		return outcome, aitools.ClassifyError(aitools.Invocation{ToolName: "terminal.exec", Args: args, WorkingDir: r.workingDir, AgentHomeDir: r.agentHomeDir}, err)
	}
	if activityUpdater != nil {
		snapshot := proc.Read(terminalProcessReadRequest{MaxBytes: terminalProcessDefaultReadBytes})
		activityUpdater(terminalProcessActivity(snapshot, terminalProcessResultPayload(snapshot)), nil)
	}
	snapshot := proc.WaitForYieldContext(ctx, parsed.YieldMS)
	result := terminalProcessResultPayload(snapshot)
	outcome.Result = result
	if snapshot.Status == terminalProcessStatusRunning {
		snapshot = proc.MarkPending()
		result = terminalProcessResultPayload(snapshot)
		r.persistToolCallSnapshot(toolID, "terminal.exec", toolCallStatusRunning, argsForPersist, result, nil, "", toolStartedAt, time.Now())
		r.persistExecutionSpan(threadstore.ExecutionSpanRecord{
			SpanID:          toolSpanID,
			EndpointID:      strings.TrimSpace(r.endpointID),
			ThreadID:        strings.TrimSpace(r.threadID),
			RunID:           strings.TrimSpace(r.id),
			Kind:            "tool",
			Name:            "terminal.exec",
			Status:          "running",
			PayloadJSON:     marshalPersistJSON(map[string]any{"tool_id": toolID, "tool_name": "terminal.exec", "status": "running", "result": redactAnyForLog("result", result, 0)}, 6000),
			StartedAtUnixMs: toolStartedAt.UnixMilli(),
			UpdatedAtUnixMs: time.Now().UnixMilli(),
		})
		outcome.Result = result
		outcome.Pending = &PendingToolResult{
			Handle:      snapshot.ProcessID,
			Summary:     "Terminal process is running",
			Instruction: "Use this handle value as process_id for terminal.read, terminal.write, or terminal.terminate.",
			Metadata: map[string]string{
				"process_id": snapshot.ProcessID,
			},
		}
		return outcome, nil
	}
	if snapshot.Status == terminalProcessStatusCanceled {
		return outcome, &aitools.ToolError{Code: aitools.ErrorCodeCanceled, Message: "Terminal process was canceled", Retryable: false, Meta: map[string]any{"process_id": snapshot.ProcessID}}
	}
	if snapshot.Status == terminalProcessStatusError {
		if snapshot.Error != nil {
			outcome.Result = result
			return outcome, snapshot.Error
		}
		outcome.Result = result
		return outcome, &aitools.ToolError{Code: aitools.ErrorCodeUnknown, Message: "Terminal process failed", Retryable: false, Meta: map[string]any{"process_id": snapshot.ProcessID}}
	}

	resultAt := time.Now()
	r.persistToolCallSnapshot(toolID, "terminal.exec", toolCallStatusSuccess, argsForPersist, result, nil, "", toolStartedAt, resultAt)
	r.persistRunEvent("tool.result", RealtimeStreamKindTool, map[string]any{
		"tool_id":    toolID,
		"tool_name":  "terminal.exec",
		"status":     "success",
		"process_id": snapshot.ProcessID,
	})
	r.persistExecutionSpan(threadstore.ExecutionSpanRecord{
		SpanID:          toolSpanID,
		EndpointID:      strings.TrimSpace(r.endpointID),
		ThreadID:        strings.TrimSpace(r.threadID),
		RunID:           strings.TrimSpace(r.id),
		Kind:            "tool",
		Name:            "terminal.exec",
		Status:          "success",
		PayloadJSON:     marshalPersistJSON(map[string]any{"tool_id": toolID, "tool_name": "terminal.exec", "status": "success", "result": redactAnyForLog("result", result, 0)}, 6000),
		StartedAtUnixMs: toolStartedAt.UnixMilli(),
		EndedAtUnixMs:   resultAt.UnixMilli(),
		UpdatedAtUnixMs: resultAt.UnixMilli(),
	})
	outcome.Success = true
	outcome.Result = result
	return outcome, nil
}

func (r *run) terminalProcessForTool(processID string) (*terminalProcess, error) {
	processID = strings.TrimSpace(processID)
	if processID == "" {
		return nil, errors.New("missing process_id")
	}
	if r == nil || r.service == nil {
		return nil, errors.New("terminal process manager unavailable")
	}
	manager := r.service.terminalProcessManager()
	if manager == nil {
		return nil, errors.New("terminal process manager unavailable")
	}
	proc, ok := manager.Get(processID)
	if !ok || proc == nil {
		return nil, errors.New("terminal process not found")
	}
	snapshot := proc.Read(terminalProcessReadRequest{})
	if strings.TrimSpace(snapshot.EndpointID) != strings.TrimSpace(r.endpointID) ||
		strings.TrimSpace(snapshot.ThreadID) != strings.TrimSpace(r.threadID) {
		return nil, errors.New("terminal process not found")
	}
	_ = proc.publishDone()
	return proc, nil
}

func (r *run) toolTerminalRead(processID string, afterSeq int64, waitMS int64, maxBytes int64) (any, error) {
	proc, err := r.terminalProcessForTool(processID)
	if err != nil {
		return nil, err
	}
	snapshot := proc.Read(terminalProcessReadRequest{
		ProcessID: strings.TrimSpace(processID),
		AfterSeq:  afterSeq,
		WaitMS:    waitMS,
		MaxBytes:  maxBytes,
	})
	_ = proc.publishDone()
	return terminalProcessResultPayload(snapshot), nil
}

func (r *run) toolTerminalWrite(processID string, input string) (any, error) {
	if strings.TrimSpace(processID) == "" {
		return nil, errors.New("missing process_id")
	}
	if len(input) > 200_000 {
		return nil, errors.New("input too large")
	}
	proc, err := r.terminalProcessForTool(processID)
	if err != nil {
		return nil, err
	}
	snapshot, err := proc.Write(input)
	if err != nil {
		return terminalProcessResultPayload(snapshot), err
	}
	_ = proc.publishDone()
	payload := terminalProcessResultPayload(snapshot)
	payload["input_bytes"] = len(input)
	return payload, nil
}

func (r *run) toolTerminalTerminate(processID string) (any, error) {
	proc, err := r.terminalProcessForTool(processID)
	if err != nil {
		return nil, err
	}
	snapshot, err := proc.Terminate()
	if err != nil {
		return terminalProcessResultPayload(snapshot), err
	}
	_ = proc.publishDone()
	payload := terminalProcessResultPayload(snapshot)
	payload["terminated"] = true
	return payload, nil
}

func summarizeUnifiedDiff(patchText string) (filesChanged int, hunks int, additions int, deletions int) {
	parsed, err := parsePatchText(patchText)
	if err != nil {
		return 0, 0, 0, 0
	}
	filesChanged, hunks, additions, deletions, _ = summarizePatchFiles(parsed.files)
	return filesChanged, hunks, additions, deletions
}

func prependRedevenBinToEnv(baseEnv []string) []string {
	envMap := make(map[string]string, len(baseEnv))
	order := make([]string, 0, len(baseEnv))
	for _, kv := range baseEnv {
		idx := strings.Index(kv, "=")
		if idx <= 0 {
			continue
		}
		key := kv[:idx]
		val := kv[idx+1:]
		if _, ok := envMap[key]; !ok {
			order = append(order, key)
		}
		envMap[key] = val
	}

	home := strings.TrimSpace(envMap["HOME"])
	if home == "" {
		if h, err := os.UserHomeDir(); err == nil {
			home = strings.TrimSpace(h)
		}
	}
	if home != "" {
		redevenBin := filepath.Join(home, ".redeven", "bin")
		pathVal := strings.TrimSpace(envMap["PATH"])
		parts := strings.Split(pathVal, string(os.PathListSeparator))
		hasRedevenBin := false
		for _, part := range parts {
			if filepath.Clean(strings.TrimSpace(part)) == filepath.Clean(redevenBin) {
				hasRedevenBin = true
				break
			}
		}
		if !hasRedevenBin {
			if pathVal == "" {
				envMap["PATH"] = redevenBin
			} else {
				envMap["PATH"] = redevenBin + string(os.PathListSeparator) + pathVal
			}
			if _, ok := envMap["PATH"]; ok {
				found := false
				for _, key := range order {
					if key == "PATH" {
						found = true
						break
					}
				}
				if !found {
					order = append(order, "PATH")
				}
			}
		}
	}

	out := make([]string, 0, len(order))
	for _, key := range order {
		out = append(out, key+"="+envMap[key])
	}
	if _, ok := envMap["PATH"]; ok {
		pathSeen := false
		for _, key := range order {
			if key == "PATH" {
				pathSeen = true
				break
			}
		}
		if !pathSeen {
			out = append(out, "PATH="+envMap["PATH"])
		}
	}
	return out
}
