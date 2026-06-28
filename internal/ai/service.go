package ai

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	flconfig "github.com/floegence/floret/config"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/flowersec/flowersec-go/rpc"
	contextadapter "github.com/floegence/redeven/internal/ai/context/adapter"
	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	contextstore "github.com/floegence/redeven/internal/ai/context/store"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/pathutil"
	"github.com/floegence/redeven/internal/runtimeservice"
	"github.com/floegence/redeven/internal/session"
)

var (
	ErrNotConfigured                      = errors.New("ai not configured")
	ErrRunActive                          = errors.New("run already active")
	ErrThreadBusy                         = errors.New("thread already active")
	ErrThreadForkUnavailable              = errors.New("thread cannot be forked while active or waiting")
	ErrModelLockViolation                 = errors.New("model lock violation")
	ErrModelSwitchRequiresExplicitRestart = errors.New("model switch requires explicit restart")
)

const (
	modelSourceRuntimeConfig           = "runtime_config"
	modelSourceRuntimeConfigLabel      = "Runtime config"
	modelSourceDesktopModelSource      = "desktop_model_source"
	modelSourceDesktopModelSourceLabel = "Desktop"
)

type Options struct {
	Logger   *slog.Logger
	StateDir string

	AgentHomeDir    string
	Shell           string
	FilesystemScope *filesystemscope.Registry

	Config *config.AIConfig

	ToolTargetPolicy       ToolTargetPolicy
	TargetToolExecutor     TargetToolExecutor
	ToolTargetPolicyForRun func(meta *session.Meta, thread threadstore.Thread, flowerMeta *threadstore.FlowerThreadMetadata) ToolTargetPolicy

	// PersistOpTimeout is the per-operation timeout for threadstore persistence
	// (SQLite reads/writes). It must NOT be tied to a run's overall lifetime, since
	// runs can take much longer than persistence should ever be allowed to block.
	//
	// When zero, it defaults to 10 seconds.
	PersistOpTimeout time.Duration

	// RunMaxWallTime is the hard cap for a single run's lifetime.
	//
	// When zero, it defaults to 15 minutes.
	RunMaxWallTime time.Duration
	// RunIdleTimeout cancels a run if no runtime stream activity is observed for the duration.
	//
	// When zero, it defaults to 2 minutes.
	RunIdleTimeout time.Duration
	// ToolApprovalTimeout is the max time a run waits for user approval for high-risk tools.
	//
	// When zero, it defaults to 10 minutes.
	ToolApprovalTimeout time.Duration
	// StreamWriteTimeout is the best-effort per-frame write deadline for the NDJSON stream.
	//
	// When zero, it defaults to 5 seconds.
	StreamWriteTimeout time.Duration

	// ResolveProviderAPIKey returns the API key for the given provider id.
	//
	// It should read from a local secrets store, not from config.json.
	ResolveProviderAPIKey func(providerID string) (string, bool, error)

	// ResolveWebSearchProviderAPIKey returns the API key for a provider-scoped web search backend.
	//
	// It should read from a local secrets store, not from config.json.
	ResolveWebSearchProviderAPIKey func(providerID string) (string, bool, error)
}

type Service struct {
	log *slog.Logger

	stateDir     string
	agentHomeDir string
	scope        *filesystemscope.Registry
	shell        string

	cfg                *config.AIConfig
	desktopModelSource *desktopModelSourceClient

	persistOpTO time.Duration

	runMaxWallTime  time.Duration
	runIdleTimeout  time.Duration
	approvalTimeout time.Duration
	streamWriteTO   time.Duration

	resolveProviderKey  func(providerID string) (string, bool, error)
	resolveWebSearchKey func(providerID string) (string, bool, error)

	toolTargetPolicy       ToolTargetPolicy
	targetToolExecutor     TargetToolExecutor
	toolTargetPolicyForRun func(meta *session.Meta, thread threadstore.Thread, flowerMeta *threadstore.FlowerThreadMetadata) ToolTargetPolicy

	mu                      sync.Mutex
	activeRunByTh           map[string]string // <endpoint_id>:<thread_id> -> run_id
	suppressQueuedDrainByTh map[string]bool
	idleCompactionByTh      map[string]*idleThreadCompaction
	runs                    map[string]*run
	subagentRuntimes        map[string]*floretSubagentRuntime

	threadMgr *threadManager

	realtimeWriters map[*rpc.Server]*aiSinkWriter

	realtimeSummaryByEndpoint    map[string]map[*rpc.Server]struct{}
	realtimeSummaryEndpointBySRV map[*rpc.Server]string

	realtimeByThread     map[string]map[*rpc.Server]struct{} // <endpoint_id>:<thread_id> -> set(stream)
	realtimeThreadBySRV  map[*rpc.Server]string
	flowerLiveByThread   map[string]*flowerLiveThreadStream
	flowerLiveGeneration int64

	delegatedApprovals map[string]*delegatedApprovalHandle

	uploadsDir string
	threadsDB  *threadstore.Store

	contextRepo        *contextstore.Repository
	capabilityResolver *contextadapter.Resolver
	skillManager       *skillManager

	threadTitleCoordinator *autoThreadTitleCoordinator
	maintenanceStopCh      chan struct{}
	maintenanceDoneCh      chan struct{}
	compactionScheduled    bool
}

var flowerLiveGenerationSeed atomic.Int64

func newFlowerLiveGeneration() int64 {
	now := time.Now().UnixMicro()
	for {
		current := flowerLiveGenerationSeed.Load()
		next := now
		if next <= current {
			next = current + 1
		}
		if flowerLiveGenerationSeed.CompareAndSwap(current, next) {
			return next
		}
	}
}

func (s *Service) flowerLiveStreamGenerationValue() int64 {
	if s == nil || s.flowerLiveGeneration <= 0 {
		return flowerLiveFallbackStreamGeneration
	}
	return s.flowerLiveGeneration
}

type resolvedRunModel struct {
	ID                        string
	ProviderID                string
	ModelName                 string
	WireModelName             string
	Provider                  config.AIProvider
	Capability                contextmodel.ModelCapability
	DesktopModelSourceModelID string
}

const (
	defaultPersistOpTimeout = 10 * time.Second
	defaultRunMaxWallTime   = 15 * time.Minute
	defaultRunIdleTimeout   = 2 * time.Minute
	defaultToolApprovalTO   = 10 * time.Minute
	defaultStreamWriteTO    = 5 * time.Second
)

func runThreadKey(endpointID string, threadID string) string {
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return ""
	}
	// endpoint_id is an env public id; ":" is safe as a delimiter.
	return endpointID + ":" + threadID
}

func NewService(opts Options) (*Service, error) {
	if strings.TrimSpace(opts.StateDir) == "" {
		return nil, errors.New("missing StateDir")
	}
	if strings.TrimSpace(opts.AgentHomeDir) == "" {
		return nil, errors.New("missing AgentHomeDir")
	}
	agentHomeDir, err := pathutil.CanonicalizeExistingDirAbs(opts.AgentHomeDir)
	if err != nil {
		return nil, err
	}
	scope := opts.FilesystemScope
	if scope == nil {
		scope, err = filesystemscope.NewDefaultRegistry(agentHomeDir)
		if err != nil {
			return nil, err
		}
	}
	agentHomeDir = scope.HomePathAbs()

	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}

	uploadsDir := filepath.Join(strings.TrimSpace(opts.StateDir), "ai", "uploads")
	if err := os.MkdirAll(uploadsDir, 0o700); err != nil {
		return nil, err
	}

	threadsPath := filepath.Join(strings.TrimSpace(opts.StateDir), "ai", "threads.sqlite")
	ts, err := threadstore.OpenResettingInvalidSchema(threadsPath)
	if err != nil {
		return nil, err
	}

	resolveProviderKey := opts.ResolveProviderAPIKey
	if resolveProviderKey == nil {
		resolveProviderKey = func(string) (string, bool, error) { return "", false, nil }
	}
	resolveWebSearchKey := opts.ResolveWebSearchProviderAPIKey
	if resolveWebSearchKey == nil {
		resolveWebSearchKey = func(string) (string, bool, error) { return "", false, nil }
	}
	toolTargetPolicy := normalizeToolTargetPolicy(opts.ToolTargetPolicy)
	if toolTargetPolicy.requiresExplicitTarget() && opts.TargetToolExecutor == nil {
		return nil, errors.New("explicit target tool policy requires TargetToolExecutor")
	}
	maxWall := opts.RunMaxWallTime
	if maxWall <= 0 {
		maxWall = defaultRunMaxWallTime
	}
	idleTO := opts.RunIdleTimeout
	if idleTO <= 0 {
		idleTO = defaultRunIdleTimeout
	}
	approvalTO := opts.ToolApprovalTimeout
	if approvalTO <= 0 {
		approvalTO = defaultToolApprovalTO
	}
	streamWTO := opts.StreamWriteTimeout
	if streamWTO <= 0 {
		streamWTO = defaultStreamWriteTO
	}

	persistTO := opts.PersistOpTimeout
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	resetCtx, cancelReset := context.WithTimeout(context.Background(), persistTO)
	resetCount, resetErr := ts.ResetStaleActiveThreadRunStates(resetCtx)
	cancelReset()
	if resetErr != nil {
		_ = ts.Close()
		return nil, resetErr
	}
	if resetCount > 0 {
		logger.Info("ai: reset stale active thread run states after restart", "count", resetCount)
	}
	delegatedCtx, cancelDelegated := context.WithTimeout(context.Background(), persistTO)
	delegatedUnavailableCount, delegatedUnavailableErr := ts.MarkPendingDelegatedApprovalsUnavailable(delegatedCtx, "runtime restarted before the delegated approval could be delivered", time.Now().UnixMilli())
	cancelDelegated()
	if delegatedUnavailableErr != nil {
		_ = ts.Close()
		return nil, delegatedUnavailableErr
	}
	if delegatedUnavailableCount > 0 {
		logger.Info("ai: marked pending delegated approvals unavailable after restart", "count", delegatedUnavailableCount)
	}

	contextRepo := contextstore.NewRepository(ts)
	capabilityResolver := contextadapter.NewResolver(contextRepo)

	svc := &Service{
		log:                          logger,
		stateDir:                     strings.TrimSpace(opts.StateDir),
		agentHomeDir:                 agentHomeDir,
		scope:                        scope,
		shell:                        strings.TrimSpace(opts.Shell),
		cfg:                          opts.Config,
		desktopModelSource:           newDesktopModelSourceClient(logger),
		persistOpTO:                  persistTO,
		runMaxWallTime:               maxWall,
		runIdleTimeout:               idleTO,
		approvalTimeout:              approvalTO,
		streamWriteTO:                streamWTO,
		resolveProviderKey:           resolveProviderKey,
		resolveWebSearchKey:          resolveWebSearchKey,
		toolTargetPolicy:             toolTargetPolicy,
		targetToolExecutor:           opts.TargetToolExecutor,
		toolTargetPolicyForRun:       opts.ToolTargetPolicyForRun,
		activeRunByTh:                make(map[string]string),
		idleCompactionByTh:           make(map[string]*idleThreadCompaction),
		runs:                         make(map[string]*run),
		subagentRuntimes:             make(map[string]*floretSubagentRuntime),
		realtimeWriters:              make(map[*rpc.Server]*aiSinkWriter),
		realtimeSummaryByEndpoint:    make(map[string]map[*rpc.Server]struct{}),
		realtimeSummaryEndpointBySRV: make(map[*rpc.Server]string),
		realtimeByThread:             make(map[string]map[*rpc.Server]struct{}),
		realtimeThreadBySRV:          make(map[*rpc.Server]string),
		flowerLiveByThread:           make(map[string]*flowerLiveThreadStream),
		flowerLiveGeneration:         newFlowerLiveGeneration(),
		delegatedApprovals:           make(map[string]*delegatedApprovalHandle),
		suppressQueuedDrainByTh:      make(map[string]bool),
		uploadsDir:                   uploadsDir,
		threadsDB:                    ts,
		contextRepo:                  contextRepo,
		capabilityResolver:           capabilityResolver,
		skillManager:                 newSkillManager(agentHomeDir, strings.TrimSpace(opts.StateDir)),
		maintenanceStopCh:            make(chan struct{}),
		maintenanceDoneCh:            make(chan struct{}),
	}
	if svc.skillManager != nil {
		svc.skillManager.Discover()
	}
	svc.threadMgr = newThreadManager(svc)
	svc.threadTitleCoordinator = newAutoThreadTitleCoordinator(svc)
	if svc.threadTitleCoordinator != nil {
		svc.threadTitleCoordinator.ScheduleRecovery()
	}
	svc.scheduleQueuedTurnRecovery()
	svc.startBackgroundMaintenance()
	return svc, nil
}

func (s *Service) scheduleQueuedTurnRecovery() {
	if s == nil {
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
	ctx, cancel := context.WithTimeout(context.Background(), persistTO)
	queuedThreads, err := db.ListThreadsWithQueuedTurns(ctx, 5000)
	cancel()
	if err != nil {
		if s.log != nil {
			s.log.Warn("ai: queued turn recovery scan failed", "error", err)
		}
		return
	}
	for _, queued := range queuedThreads {
		endpointID := strings.TrimSpace(queued.EndpointID)
		threadID := strings.TrimSpace(queued.ThreadID)
		if endpointID == "" || threadID == "" {
			continue
		}
		runStatus, _, _ := normalizeThreadRunState(queued.RunStatus, queued.RunErrorCode, queued.RunError)
		if NormalizeRunState(runStatus) == RunStateWaitingUser || strings.TrimSpace(queued.WaitingUserInputJSON) != "" {
			continue
		}
		if s.threadMgr != nil {
			s.threadMgr.Wake(endpointID, threadID)
		}
	}
}

func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	if s.threadMgr != nil {
		s.threadMgr.Close()
	}
	s.mu.Lock()
	coordinator := s.threadTitleCoordinator
	s.threadTitleCoordinator = nil
	ts := s.threadsDB
	writers := make([]*aiSinkWriter, 0, len(s.realtimeWriters))
	for srv, w := range s.realtimeWriters {
		if w == nil {
			continue
		}
		writers = append(writers, w)
		delete(s.realtimeWriters, srv)
	}
	s.realtimeSummaryByEndpoint = make(map[string]map[*rpc.Server]struct{})
	s.realtimeSummaryEndpointBySRV = make(map[*rpc.Server]string)
	s.realtimeByThread = make(map[string]map[*rpc.Server]struct{})
	s.realtimeThreadBySRV = make(map[*rpc.Server]string)
	s.flowerLiveByThread = make(map[string]*flowerLiveThreadStream)
	s.delegatedApprovals = make(map[string]*delegatedApprovalHandle)
	maintenanceStopCh := s.maintenanceStopCh
	maintenanceDoneCh := s.maintenanceDoneCh
	s.maintenanceStopCh = nil
	s.maintenanceDoneCh = nil
	runs := make([]*run, 0, len(s.runs))
	for _, r := range s.runs {
		if r != nil {
			runs = append(runs, r)
		}
	}
	idleCompactions := make([]*idleThreadCompaction, 0, len(s.idleCompactionByTh))
	for _, compaction := range s.idleCompactionByTh {
		if compaction != nil {
			idleCompactions = append(idleCompactions, compaction)
		}
	}
	runtimes := make([]*floretSubagentRuntime, 0, len(s.subagentRuntimes))
	for _, runtime := range s.subagentRuntimes {
		if runtime != nil {
			runtimes = append(runtimes, runtime)
		}
	}
	s.runs = make(map[string]*run)
	s.activeRunByTh = make(map[string]string)
	s.subagentRuntimes = make(map[string]*floretSubagentRuntime)
	s.mu.Unlock()

	if coordinator != nil {
		coordinator.Close()
	}
	if maintenanceStopCh != nil {
		close(maintenanceStopCh)
	}
	if maintenanceDoneCh != nil {
		<-maintenanceDoneCh
	}
	for _, w := range writers {
		w.Close()
	}
	for _, r := range runs {
		r.requestCancel("canceled")
	}
	for _, compaction := range idleCompactions {
		s.cancelIdleThreadCompactionWithBroadcast(compaction.endpointID, compaction.threadID)
	}
	waitTO := s.persistOpTO
	if waitTO <= 0 {
		waitTO = defaultPersistOpTimeout
	}
	for _, compaction := range idleCompactions {
		waitCtx, waitCancel := context.WithTimeout(context.Background(), waitTO)
		waitOK := s.waitIdleThreadCompaction(waitCtx, compaction)
		waitCancel()
		if !waitOK && s.log != nil {
			s.log.Warn("idle context compaction did not finish before service close", "thread_id", compaction.threadID, "operation_id", compaction.operationID)
		}
		if waitOK && compaction.isCancelled() {
			s.publishIdleContextCompactionCancellation(compaction)
		}
	}
	s.mu.Lock()
	if s.threadsDB == ts {
		s.threadsDB = nil
	}
	s.idleCompactionByTh = make(map[string]*idleThreadCompaction)
	s.mu.Unlock()
	for _, runtime := range runtimes {
		runtime.release()
	}
	if ts != nil {
		return ts.Close()
	}
	return nil
}

func (s *Service) ensureThreadSubagentRuntimeLocked(thKey string, r *run) subagentRuntime {
	if s == nil || r == nil {
		return nil
	}
	thKey = strings.TrimSpace(thKey)
	if thKey == "" {
		thKey = runThreadKey(r.endpointID, r.threadID)
	}
	if thKey == "" {
		return nil
	}
	if s.subagentRuntimes == nil {
		s.subagentRuntimes = make(map[string]*floretSubagentRuntime)
	}
	runtime := s.subagentRuntimes[thKey]
	if runtime == nil {
		runtime = newFloretSubagentRuntime(r)
		s.subagentRuntimes[thKey] = runtime
	} else {
		runtime.attachParentRun(r)
	}
	return runtime
}

func (s *Service) removeThreadSubagentRuntime(thKey string) *floretSubagentRuntime {
	if s == nil {
		return nil
	}
	thKey = strings.TrimSpace(thKey)
	if thKey == "" {
		return nil
	}
	s.mu.Lock()
	runtime := s.subagentRuntimes[thKey]
	delete(s.subagentRuntimes, thKey)
	s.mu.Unlock()
	return runtime
}

func (s *Service) closeThreadSubagents(ctx context.Context, endpointID string, threadID string, timeout time.Duration) {
	if s == nil {
		return
	}
	thKey := runThreadKey(endpointID, threadID)
	if thKey == "" {
		return
	}
	s.mu.Lock()
	runtime := s.subagentRuntimes[thKey]
	s.mu.Unlock()
	if runtime != nil {
		if timeout <= 0 {
			timeout = defaultPersistOpTimeout
		}
		closeCtx, cancel := context.WithTimeout(ctxOrBackground(ctx), timeout)
		defer cancel()
		if runtime.currentHost() != nil {
			runtime.closeAllExisting(closeCtx)
			return
		}
		s.closeThreadSubagentsWithLifecycleHost(closeCtx, threadID)
		return
	}
	if timeout <= 0 {
		timeout = defaultPersistOpTimeout
	}
	closeCtx, cancel := context.WithTimeout(ctxOrBackground(ctx), timeout)
	defer cancel()
	s.closeThreadSubagentsWithLifecycleHost(closeCtx, threadID)
}

func (s *Service) closeThreadSubagentsWithLifecycleHost(ctx context.Context, threadID string) {
	if s == nil {
		return
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return
	}
	host, err := s.openFloretLifecycleHost()
	if err != nil {
		return
	}
	defer host.Close()
	_, _ = host.CloseSubAgents(ctx, flruntime.CloseSubAgentsRequest{
		ParentThreadID: flruntime.ThreadID(threadID),
		Reason:         "parent_stop",
	})
}

func (s *Service) deleteFloretThreadTree(ctx context.Context, meta *session.Meta, th threadstore.Thread, timeout time.Duration) error {
	if s == nil {
		return nil
	}
	threadID := strings.TrimSpace(th.ThreadID)
	endpointID := ""
	if meta != nil {
		endpointID = strings.TrimSpace(meta.EndpointID)
	}
	if endpointID == "" || threadID == "" {
		return nil
	}
	if timeout <= 0 {
		timeout = defaultPersistOpTimeout
	}
	thKey := runThreadKey(endpointID, threadID)
	runtime := s.removeThreadSubagentRuntime(thKey)
	opCtx, cancel := context.WithTimeout(ctxOrBackground(ctx), timeout)
	defer cancel()
	if runtime != nil {
		defer runtime.release()
		host := runtime.currentHost()
		if host != nil {
			runtime.closeAllExisting(opCtx)
			return host.DeleteThread(opCtx, flruntime.ThreadID(threadID))
		}
	}
	return s.deleteFloretThreadTreeWithLifecycleHost(opCtx, threadID)
}

func (s *Service) deleteFloretThreadTreeWithLifecycleHost(ctx context.Context, threadID string) error {
	if s == nil {
		return nil
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil
	}
	host, err := s.openFloretLifecycleHost()
	if err != nil {
		return err
	}
	defer host.Close()
	_, _ = host.CloseSubAgents(ctx, flruntime.CloseSubAgentsRequest{
		ParentThreadID: flruntime.ThreadID(threadID),
		Reason:         "parent_delete",
	})
	if err := host.DeleteThread(ctx, flruntime.ThreadID(threadID)); err != nil {
		if isFloretThreadNotFoundError(err) {
			return nil
		}
		return err
	}
	return nil
}

func isFloretThreadNotFoundError(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(strings.ToLower(err.Error()), "thread not found")
}

func (s *Service) openFloretLifecycleHost() (flruntime.Host, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	storePath, err := floretThreadStorePath(s.stateDir)
	if err != nil {
		return nil, err
	}
	store, err := flruntime.OpenSQLiteStore(storePath)
	if err != nil {
		return nil, err
	}
	host, err := flruntime.NewHost(flruntime.HostOptions{
		Config: flconfig.Config{
			Provider:     flconfig.ProviderFake,
			Model:        "fake-model",
			FakeResponse: "ok",
		},
		Store: store,
	})
	if err != nil {
		_ = store.Close()
		return nil, err
	}
	return host, nil
}

func (s *Service) Enabled() bool {
	if s == nil {
		return false
	}
	s.mu.Lock()
	enabled := s.cfg != nil || (s.desktopModelSource != nil && s.desktopModelSource.hasBinding())
	s.mu.Unlock()
	return enabled
}

func (s *Service) ToolTargetPolicy() ToolTargetPolicy {
	if s == nil {
		return normalizeToolTargetPolicy(ToolTargetPolicy{})
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return normalizeToolTargetPolicy(s.toolTargetPolicy)
}

func (s *Service) UpsertFlowerThreadMetadata(ctx context.Context, rec threadstore.FlowerThreadMetadata) error {
	if s == nil {
		return errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	pctx, cancel := context.WithTimeout(ctx, persistTO)
	defer cancel()
	return db.UpsertFlowerThreadMetadata(pctx, rec)
}

func (s *Service) GetFlowerThreadMetadata(ctx context.Context, endpointID string, threadID string) (*threadstore.FlowerThreadMetadata, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	pctx, cancel := context.WithTimeout(ctx, persistTO)
	defer cancel()
	return db.GetFlowerThreadMetadata(pctx, endpointID, threadID)
}

func (s *Service) RuntimeStatus(ctx context.Context) *AIRuntimeStatus {
	if s == nil {
		return &AIRuntimeStatus{}
	}
	s.mu.Lock()
	cfg := s.cfg
	modelSource := s.desktopModelSource
	s.mu.Unlock()
	out := &AIRuntimeStatus{RemoteConfigured: cfg != nil}
	if modelSource != nil {
		statusCtx := ctx
		cancel := func() {}
		if statusCtx == nil {
			statusCtx = context.Background()
		}
		if _, ok := statusCtx.Deadline(); !ok {
			statusCtx, cancel = context.WithTimeout(statusCtx, 1500*time.Millisecond)
		}
		defer cancel()
		out.DesktopModelSource = modelSource.Status(statusCtx)
	}
	return out
}

func (s *Service) DesktopModelSourceBindingStatus(ctx context.Context) runtimeservice.Binding {
	if s == nil {
		return runtimeservice.Binding{State: runtimeservice.BindingStateUnsupported}
	}

	s.mu.Lock()
	modelSource := s.desktopModelSource
	s.mu.Unlock()
	if modelSource == nil {
		return runtimeservice.Binding{State: runtimeservice.BindingStateUnsupported}
	}
	return modelSource.BindingStatus(ctx)
}

func (s *Service) DesktopModelSourceBindingSnapshot() runtimeservice.Binding {
	return s.DesktopModelSourceBindingStatus(context.Background())
}

// UpdateConfig updates the in-memory AI config after persisting it via the provided callback.
//
// Active runs keep their existing run-local config snapshot. The updated config applies to
// runs created after this method returns.
func (s *Service) UpdateConfig(next *config.AIConfig, persist func() error) error {
	if s == nil {
		return errors.New("nil service")
	}
	if persist == nil {
		return errors.New("missing persist function")
	}
	if next != nil {
		if err := next.Validate(); err != nil {
			return err
		}
	}

	s.mu.Lock()
	if err := persist(); err != nil {
		s.mu.Unlock()
		return err
	}

	s.cfg = next
	coordinator := s.threadTitleCoordinator
	s.mu.Unlock()
	if coordinator != nil {
		coordinator.Wake()
	}
	return nil
}

// UpdateFilesystemScope refreshes the in-memory filesystem roots for future runs.
func (s *Service) UpdateFilesystemScope(scope *filesystemscope.Registry) error {
	if s == nil {
		return errors.New("nil service")
	}
	if scope == nil {
		return errors.New("nil filesystem scope")
	}
	s.mu.Lock()
	s.scope = scope
	s.agentHomeDir = scope.HomePathAbs()
	s.mu.Unlock()
	return nil
}

// ActiveRunCount returns the number of active runs for the given endpoint.
//
// When endpointID is empty, it returns the global active run count.
func (s *Service) ActiveRunCount(endpointID string) int {
	if s == nil {
		return 0
	}
	endpointID = strings.TrimSpace(endpointID)
	prefix := endpointID + ":"

	s.mu.Lock()
	defer s.mu.Unlock()

	count := 0
	for key, runID := range s.activeRunByTh {
		if strings.TrimSpace(runID) == "" {
			continue
		}
		if endpointID != "" && !strings.HasPrefix(key, prefix) {
			continue
		}
		count++
	}
	return count
}

// SetCurrentModelID updates current_model_id while keeping the provider/model registry unchanged.
//
// Unlike UpdateConfig, this method is lightweight and allowed while runs are active because it only
// changes the current model for future chats.
func (s *Service) SetCurrentModelID(modelID string, persist func(next *config.AIConfig) error) error {
	if s == nil {
		return errors.New("nil service")
	}
	if persist == nil {
		return errors.New("missing persist function")
	}

	modelID = strings.TrimSpace(modelID)
	if modelID == "" {
		return errors.New("missing model_id")
	}

	s.mu.Lock()
	cfg := s.cfg
	modelSource := s.desktopModelSource
	if cfg == nil && (modelSource == nil || !modelSource.hasBinding()) {
		s.mu.Unlock()
		return ErrNotConfigured
	}
	if cfg != nil && cfg.IsAllowedModelID(modelID) {
		next := *cfg
		next.CurrentModelID = modelID
		if err := next.Validate(); err != nil {
			s.mu.Unlock()
			return err
		}
		if err := persist(&next); err != nil {
			s.mu.Unlock()
			return err
		}

		s.cfg = &next
		if s.desktopModelSource != nil {
			s.desktopModelSource.SetCurrentModelID("")
		}
		coordinator := s.threadTitleCoordinator
		s.mu.Unlock()
		if coordinator != nil {
			coordinator.Wake()
		}
		return nil
	}
	if modelSource == nil || !isDesktopModelSourceModelID(modelID) {
		s.mu.Unlock()
		return fmt.Errorf("model not allowed: %s", modelID)
	}
	s.mu.Unlock()

	if ok, err := s.desktopModelSourceModelAllowed(context.Background(), modelID); err != nil {
		return err
	} else if !ok {
		return fmt.Errorf("model not allowed: %s", modelID)
	}

	s.mu.Lock()
	if s.desktopModelSource == nil {
		s.mu.Unlock()
		return ErrNotConfigured
	}
	s.desktopModelSource.SetCurrentModelID(modelID)
	coordinator := s.threadTitleCoordinator
	s.mu.Unlock()
	if coordinator != nil {
		coordinator.Wake()
	}
	return nil
}

func (s *Service) HasActiveThread(threadID string) bool {
	if s == nil {
		return false
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Deprecated: callers should use HasActiveThreadForEndpoint for correctness.
	for k := range s.activeRunByTh {
		if strings.HasSuffix(k, ":"+threadID) {
			return true
		}
	}
	return false
}

func (s *Service) HasActiveThreadForEndpoint(endpointID string, threadID string) bool {
	if s == nil {
		return false
	}
	k := runThreadKey(endpointID, threadID)
	if k == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return strings.TrimSpace(s.activeRunByTh[k]) != ""
}

func (s *Service) ListModels() (*ModelsResponse, error) {
	if s == nil {
		return nil, ErrNotConfigured
	}
	s.mu.Lock()
	cfg := s.cfg
	modelSource := s.desktopModelSource
	modelSourceCurrent := ""
	if modelSource != nil {
		modelSourceCurrent = modelSource.CurrentModelID()
	}
	s.mu.Unlock()
	if cfg == nil && (modelSource == nil || !modelSource.hasBinding()) {
		return nil, ErrNotConfigured
	}

	out := NewModelsResponse(s.RuntimeStatus(context.Background()))
	configModels, currentModelID, err := configModelViews(cfg)
	if err != nil && cfg != nil {
		return nil, err
	}
	seen := make(map[string]struct{}, len(configModels))
	if currentModelID != "" {
		out.CurrentModel = currentModelID
	}
	for _, m := range configModels {
		if strings.TrimSpace(m.ID) == currentModelID {
			out.Models = append(out.Models, m)
			seen[m.ID] = struct{}{}
			break
		}
	}
	for _, m := range configModels {
		id := strings.TrimSpace(m.ID)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		out.Models = append(out.Models, m)
		seen[id] = struct{}{}
	}

	if modelSource != nil && modelSource.hasBinding() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		snapshot, sourceErr := modelSource.ListModels(ctx)
		cancel()
		if sourceErr != nil && cfg == nil {
			return nil, sourceErr
		}
		if sourceErr == nil && snapshot != nil {
			sourceCurrent := ""
			if modelSourceCurrent != "" && desktopModelSourceSnapshotHasModel(snapshot, modelSourceCurrent) {
				sourceCurrent = modelSourceCurrent
			} else if desktopModelSourceSnapshotHasModel(snapshot, snapshot.CurrentModel) {
				sourceCurrent = strings.TrimSpace(snapshot.CurrentModel)
			}
			if sourceCurrent != "" && modelSourceCurrent != "" {
				out.CurrentModel = sourceCurrent
			} else if out.CurrentModel == "" {
				out.CurrentModel = sourceCurrent
			}
			for _, m := range snapshot.Models {
				modelID := strings.TrimSpace(m.ID)
				if !isDesktopModelSourceModelID(modelID) {
					continue
				}
				if _, exists := seen[modelID]; exists {
					continue
				}
				label := strings.TrimSpace(m.Label)
				if label == "" {
					label = strings.TrimSpace(m.ID)
				}
				if label != "" {
					label = "Desktop / " + label
				}
				model := Model{
					ID:                 modelID,
					Label:              label,
					Source:             modelSourceDesktopModelSource,
					SourceLabel:        modelSourceDesktopModelSourceLabel,
					ContextWindow:      m.ContextWindow,
					MaxOutputTokens:    m.MaxOutputTokens,
					InputModalities:    append([]string(nil), m.InputModalities...),
					SupportsImageInput: m.SupportsImageInput,
				}
				if modelID == sourceCurrent && out.CurrentModel == sourceCurrent {
					out.Models = append([]Model{model}, out.Models...)
				} else {
					out.Models = append(out.Models, model)
				}
				seen[modelID] = struct{}{}
			}
		}
	}

	if len(out.Models) == 0 && cfg != nil {
		return nil, errors.New("invalid ai config: missing models")
	}

	return out, nil
}

func configModelViews(cfg *config.AIConfig) ([]Model, string, error) {
	if cfg == nil {
		return nil, "", nil
	}
	providerNameByID := make(map[string]string, len(cfg.Providers))
	for _, p := range cfg.Providers {
		id := strings.TrimSpace(p.ID)
		if id == "" {
			continue
		}
		name := strings.TrimSpace(p.Name)
		if name == "" {
			name = defaultProviderDisplayName(p)
		}
		if name == "" {
			name = id
		}
		providerNameByID[id] = name
	}

	models := make([]Model, 0, 16)
	seenModel := make(map[string]struct{}, 16)
	for _, p := range cfg.Providers {
		providerID := strings.TrimSpace(p.ID)
		if providerID == "" {
			continue
		}
		pn := strings.TrimSpace(providerNameByID[providerID])
		if pn == "" {
			pn = providerID
		}
		for _, m := range p.Models {
			modelName := strings.TrimSpace(m.ModelName)
			if modelName == "" {
				continue
			}
			id := providerID + "/" + modelName
			if _, ok := seenModel[id]; ok {
				continue
			}
			seenModel[id] = struct{}{}
			models = append(models, configModelView(id, pn+" / "+modelName, p.Type, m))
		}
	}
	if len(models) == 0 {
		return models, "", errors.New("invalid ai config: missing models")
	}
	currentModelID := strings.TrimSpace(cfg.CurrentModelID)
	if currentModelID == "" {
		return models, "", errors.New("invalid ai config: missing current model")
	}
	if !cfg.IsAllowedModelID(currentModelID) {
		return models, "", fmt.Errorf("invalid ai config: current_model_id is not in providers[].models[]: %s", currentModelID)
	}
	return models, currentModelID, nil
}

func configModelView(id string, label string, providerType string, m config.AIProviderModel) Model {
	return Model{
		ID:                  strings.TrimSpace(id),
		Label:               strings.TrimSpace(label),
		Source:              modelSourceRuntimeConfig,
		SourceLabel:         modelSourceRuntimeConfigLabel,
		ContextWindow:       m.EffectiveInputWindowTokens(),
		MaxOutputTokens:     m.MaxOutputTokens,
		InputModalities:     m.NormalizedInputModalities(),
		SupportsImageInput:  m.SupportsImageInput(),
		ReasoningCapability: m.EffectiveReasoningCapability(providerType),
	}
}

func (s *Service) desktopModelSourceModelAllowed(ctx context.Context, modelID string) (bool, error) {
	if s == nil {
		return false, ErrNotConfigured
	}
	if !isDesktopModelSourceModelID(modelID) {
		return false, nil
	}
	s.mu.Lock()
	modelSource := s.desktopModelSource
	s.mu.Unlock()
	if modelSource == nil {
		return false, nil
	}
	checkCtx := ctx
	cancel := func() {}
	if checkCtx == nil {
		checkCtx = context.Background()
	}
	if _, ok := checkCtx.Deadline(); !ok {
		checkCtx, cancel = context.WithTimeout(checkCtx, 3*time.Second)
	}
	defer cancel()
	snapshot, err := modelSource.ListModels(checkCtx)
	if err != nil {
		return false, err
	}
	return desktopModelSourceSnapshotHasModel(snapshot, modelID), nil
}

func (s *Service) skills() (*skillManager, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	s.mu.Lock()
	mgr := s.skillManager
	s.mu.Unlock()
	if mgr == nil {
		return nil, errors.New("skill manager not ready")
	}
	return mgr, nil
}

func (s *Service) ListSkillsCatalog() (*SkillCatalog, error) {
	mgr, err := s.skills()
	if err != nil {
		return nil, err
	}
	catalog := mgr.Catalog()
	if catalog.CatalogVersion == 0 {
		catalog = mgr.Reload()
	}
	return &catalog, nil
}

func (s *Service) ReloadSkillsCatalog() (*SkillCatalog, error) {
	mgr, err := s.skills()
	if err != nil {
		return nil, err
	}
	catalog := mgr.Reload()
	return &catalog, nil
}

func (s *Service) PatchSkillToggles(patches []SkillTogglePatch) (*SkillCatalog, error) {
	mgr, err := s.skills()
	if err != nil {
		return nil, err
	}
	catalog, err := mgr.PatchToggles(patches)
	if err != nil {
		return nil, err
	}
	return &catalog, nil
}

func (s *Service) CreateSkill(scope string, name string, description string, body string) (*SkillCatalog, error) {
	mgr, err := s.skills()
	if err != nil {
		return nil, err
	}
	catalog, err := mgr.Create(scope, name, description, body)
	if err != nil {
		return nil, err
	}
	return &catalog, nil
}

func (s *Service) DeleteSkill(scope string, name string) (*SkillCatalog, error) {
	mgr, err := s.skills()
	if err != nil {
		return nil, err
	}
	catalog, err := mgr.Delete(scope, name)
	if err != nil {
		return nil, err
	}
	return &catalog, nil
}

func (s *Service) ListGitHubSkillCatalog(req SkillGitHubCatalogRequest) (*SkillGitHubCatalog, error) {
	mgr, err := s.skills()
	if err != nil {
		return nil, err
	}
	out, err := mgr.ListGitHubCatalog(req)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *Service) ValidateGitHubSkillImport(req SkillGitHubImportRequest) (*SkillGitHubValidateResult, error) {
	mgr, err := s.skills()
	if err != nil {
		return nil, err
	}
	out, err := mgr.ValidateGitHubImport(req)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *Service) ImportGitHubSkills(req SkillGitHubImportRequest) (*SkillGitHubImportResult, error) {
	mgr, err := s.skills()
	if err != nil {
		return nil, err
	}
	out, err := mgr.ImportFromGitHub(req)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *Service) ListSkillSources() (*SkillSourcesView, error) {
	mgr, err := s.skills()
	if err != nil {
		return nil, err
	}
	out, err := mgr.ListSources()
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *Service) ReinstallSkills(paths []string, overwrite bool) (*SkillReinstallResult, error) {
	mgr, err := s.skills()
	if err != nil {
		return nil, err
	}
	out, err := mgr.Reinstall(paths, overwrite)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *Service) BrowseSkillTree(skillPath string, dir string) (*SkillBrowseTreeResult, error) {
	mgr, err := s.skills()
	if err != nil {
		return nil, err
	}
	out, err := mgr.BrowseTree(skillPath, dir)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *Service) BrowseSkillFile(skillPath string, file string, encoding string, maxBytes int) (*SkillBrowseFileResult, error) {
	mgr, err := s.skills()
	if err != nil {
		return nil, err
	}
	out, err := mgr.BrowseFile(skillPath, file, encoding, maxBytes)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// NewRunID generates a cryptographically random run id.
func NewRunID() (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "run_" + base64.RawURLEncoding.EncodeToString(b), nil
}

func newMessageID() (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "m_ai_" + base64.RawURLEncoding.EncodeToString(b), nil
}

func newToolID() (string, error) {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "tool_" + base64.RawURLEncoding.EncodeToString(b), nil
}

func newManualCompactionRequestID() (string, error) {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "cmpreq_" + base64.RawURLEncoding.EncodeToString(b), nil
}

type preparedRun struct {
	meta                         *session.Meta
	req                          RunStartRequest
	persistedUser                *persistedUserMessage
	runID                        string
	startedAtUnixMs              int64
	channelID                    string
	endpointID                   string
	threadID                     string
	thKey                        string
	threadModelID                string
	threadModelLocked            bool
	threadReasoningSelectionJSON string
	cfg                          *config.AIConfig
	uploadsDir                   string
	persistTO                    time.Duration
	db                           *threadstore.Store
	messageID                    string
	r                            *run
	updateThreadRunState         func(status string, runErrorCode string, runErr string, waitingPrompt *RequestUserInputPrompt)
}

func (s *Service) StartRun(ctx context.Context, meta *session.Meta, runID string, req RunStartRequest, w http.ResponseWriter) error {
	if ctx == nil {
		ctx = context.Background()
	}
	prepared, err := s.prepareRun(meta, runID, req, w, nil)
	if err != nil {
		return err
	}
	return s.executePreparedRun(ctx, prepared)
}

func (s *Service) StartRunDetached(meta *session.Meta, runID string, req RunStartRequest) error {
	prepared, err := s.prepareRun(meta, runID, req, nil, nil)
	if err != nil {
		return err
	}
	go func() {
		if err := s.executePreparedRun(context.Background(), prepared); err != nil {
			if s.log != nil {
				s.log.Warn("ai detached run failed", "run_id", runID, "thread_id", strings.TrimSpace(req.ThreadID), "error", err)
			}
		}
	}()
	return nil
}

func (s *Service) startUserTurnDetached(ctx context.Context, meta *session.Meta, runID string, req RunStartRequest, sourceFollowupID string, requireSourceFollowup bool) (persistedUserMessage, RunInput, error) {
	if s == nil {
		return persistedUserMessage{}, req.Input, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return persistedUserMessage{}, req.Input, err
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID := strings.TrimSpace(req.ThreadID)
	if endpointID == "" || threadID == "" {
		return persistedUserMessage{}, req.Input, errors.New("invalid request")
	}

	preparedUser, normalizedInput, err := s.prepareUserMessage(ctx, meta, endpointID, threadID, req.Input)
	if err != nil {
		return persistedUserMessage{}, req.Input, err
	}
	req.Input = normalizedInput
	persistedSeed := persistedUserMessage{
		MessageID:       preparedUser.Message.MessageID,
		MessageJSON:     preparedUser.Message.MessageJSON,
		CreatedAtUnixMs: preparedUser.Message.CreatedAtUnixMs,
	}
	prepared, err := s.prepareRun(meta, runID, req, nil, &persistedSeed)
	if err != nil {
		return persistedUserMessage{}, normalizedInput, err
	}

	startedAt := time.Now().UnixMilli()
	prepared.startedAtUnixMs = startedAt
	pctx, cancel := context.WithTimeout(ctx, prepared.persistTO)
	result, err := prepared.db.StartUserTurn(pctx, threadstore.StartUserTurn{
		EndpointID:  endpointID,
		ThreadID:    threadID,
		UserMessage: preparedUser.Message,
		UploadIDs:   preparedUser.UploadIDs,
		Run: threadstore.RunRecord{
			RunID:           runID,
			EndpointID:      endpointID,
			ThreadID:        threadID,
			MessageID:       prepared.messageID,
			State:           string(RunStateRunning),
			AttemptCount:    1,
			StartedAtUnixMs: startedAt,
			UpdatedAtUnixMs: startedAt,
		},
		Turn: threadstore.ConversationTurn{
			TurnID:             prepared.messageID,
			EndpointID:         endpointID,
			ThreadID:           threadID,
			RunID:              runID,
			UserMessageID:      preparedUser.Message.MessageID,
			AssistantMessageID: prepared.messageID,
			CreatedAtUnixMs:    preparedUser.Message.CreatedAtUnixMs,
		},
		RunState: threadstore.ThreadRunStateWrite{
			Status:                string(RunStateRunning),
			UpdatedByUserPublicID: strings.TrimSpace(meta.UserPublicID),
			UpdatedByUserEmail:    strings.TrimSpace(meta.UserEmail),
			UpdatedAtUnixMs:       startedAt,
		},
		SourceQueueID:           strings.TrimSpace(sourceFollowupID),
		RequireSourceQueue:      requireSourceFollowup,
		StructuredUserInputs:    preparedUser.StructuredInputs,
		RequestUserInputSecrets: preparedUser.SecretAnswers,
		UploadClaimedAtUnixMs:   preparedUser.Message.CreatedAtUnixMs,
	})
	cancel()
	if err != nil {
		s.releasePreparedRun(prepared)
		return persistedUserMessage{}, normalizedInput, err
	}

	persisted := persistedUserMessage{
		MessageID:       result.UserMessageID,
		RowID:           result.UserMessageRowID,
		MessageJSON:     result.UserMessageJSON,
		CreatedAtUnixMs: result.UserMessageCreatedAtUnixMs,
	}
	prepared.persistedUser = &persisted
	prepared.req.Input = normalizedInput

	s.broadcastTranscriptMessage(endpointID, threadID, "", persisted.RowID, persisted.MessageJSON, persisted.CreatedAtUnixMs)
	s.broadcastThreadState(endpointID, threadID, runID, string(RunStateRunning), "", "")
	s.broadcastThreadSummary(endpointID, threadID)
	effectiveCurrentInput := deriveEffectiveCurrentUserInput(normalizedInput)
	effectiveCurrentInput.MessageID = persisted.MessageID
	effectiveCurrentInput.MessageRowID = persisted.RowID
	effectiveCurrentInput.MessageCreatedAtUnixMs = persisted.CreatedAtUnixMs
	s.scheduleAutoThreadTitle(meta, threadID, effectiveCurrentInput)
	prepared.r.ensureAssistantMessageStarted()
	prepared.r.updateModelIOStatus(FlowerModelIOPhasePreparing, 0)
	if _, cleanupErr := s.processUploadCleanupCandidates(context.Background(), result.UploadsToDelete); cleanupErr != nil && s.log != nil {
		s.log.Warn("ai followup upload cleanup failed after turn start", "thread_id", threadID, "followup_id", strings.TrimSpace(sourceFollowupID), "error", cleanupErr)
	}

	go func() {
		if err := s.executePreparedRun(context.Background(), prepared); err != nil {
			if s.log != nil {
				s.log.Warn("ai detached run failed", "run_id", runID, "thread_id", threadID, "error", err)
			}
		}
	}()
	return persisted, normalizedInput, nil
}

func (s *Service) releasePreparedRun(prepared *preparedRun) {
	if s == nil || prepared == nil {
		return
	}
	runID := strings.TrimSpace(prepared.runID)
	thKey := strings.TrimSpace(prepared.thKey)
	s.mu.Lock()
	if runID != "" {
		delete(s.runs, runID)
	}
	if thKey != "" && strings.TrimSpace(s.activeRunByTh[thKey]) == runID {
		delete(s.activeRunByTh, thKey)
	}
	s.mu.Unlock()
	if prepared.r != nil {
		prepared.r.markDone()
		if prepared.r.stream != nil {
			prepared.r.stream.close()
			prepared.r.stream.wait()
		}
	}
}

func (s *Service) prepareRun(meta *session.Meta, runID string, req RunStartRequest, w http.ResponseWriter, persisted *persistedUserMessage) (*preparedRun, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return nil, errors.New("missing run_id")
	}
	threadID := strings.TrimSpace(req.ThreadID)
	if threadID == "" {
		return nil, errors.New("missing thread_id")
	}
	contextAction, err := normalizeAskFlowerContextActionEnvelope(req.Input.ContextAction)
	if err != nil {
		return nil, err
	}
	req.Input.ContextAction = contextAction
	channelID := strings.TrimSpace(meta.ChannelID)
	if channelID == "" {
		return nil, errors.New("missing channel_id")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" {
		return nil, errors.New("missing endpoint_id")
	}

	metaCopy := *meta
	metaRef := &metaCopy

	persistTO := s.persistOpTO
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}

	s.mu.Lock()
	db := s.threadsDB
	toolTargetPolicyForRun := s.toolTargetPolicyForRun
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}

	pctx, cancelPersist := context.WithTimeout(context.Background(), persistTO)
	th, err := db.GetThread(pctx, endpointID, threadID)
	cancelPersist()
	if err != nil {
		return nil, err
	}
	if th == nil {
		return nil, errors.New("thread not found")
	}
	var flowerMeta *threadstore.FlowerThreadMetadata
	pctx, cancelPersist = context.WithTimeout(context.Background(), persistTO)
	flowerMeta, err = db.GetFlowerThreadMetadata(pctx, endpointID, threadID)
	cancelPersist()
	if err != nil {
		return nil, err
	}
	if isFlowerSubagentProjection(flowerMeta) {
		return nil, ErrReadOnlyThread
	}

	runWorkingDir := strings.TrimSpace(th.WorkingDir)
	if runWorkingDir == "" {
		runWorkingDir = strings.TrimSpace(s.agentHomeDir)
	}

	s.mu.Lock()
	if s.cfg == nil && (s.desktopModelSource == nil || !s.desktopModelSource.hasBinding()) {
		s.mu.Unlock()
		return nil, ErrNotConfigured
	}
	thKey := runThreadKey(endpointID, threadID)
	if thKey == "" {
		s.mu.Unlock()
		return nil, errors.New("invalid request")
	}
	if existing := strings.TrimSpace(s.activeRunByTh[thKey]); existing != "" {
		s.mu.Unlock()
		return nil, ErrThreadBusy
	}
	if existing := s.idleCompactionByTh[thKey]; existing != nil && existing.busy() {
		s.mu.Unlock()
		return nil, ErrThreadBusy
	}
	cfg := s.cfg
	desktopModelSource := s.desktopModelSource
	req.Options.PermissionType = threadPermissionTypeString(th, "")
	uploadsDir := s.uploadsDir
	db = s.threadsDB
	messageID, err := newMessageID()
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}
	finalizingThreadStatePublished := false
	toolTargetPolicy := s.toolTargetPolicy
	if toolTargetPolicyForRun != nil {
		toolTargetPolicy = normalizeToolTargetPolicy(toolTargetPolicyForRun(metaRef, *th, flowerMeta))
	}
	r := newRun(runOptions{
		Log:                 s.log,
		StateDir:            s.stateDir,
		AgentHomeDir:        s.agentHomeDir,
		WorkingDir:          runWorkingDir,
		FilesystemScope:     s.scope,
		Shell:               s.shell,
		Service:             s,
		AIConfig:            cfg,
		SessionMeta:         metaRef,
		ResolveProviderKey:  s.resolveProviderKey,
		ResolveWebSearchKey: s.resolveWebSearchKey,
		DesktopModelSource:  desktopModelSource,
		RunID:               runID,
		ChannelID:           channelID,
		EndpointID:          endpointID,
		ThreadID:            threadID,
		MaxWallTime:         s.runMaxWallTime,
		IdleTimeout:         s.runIdleTimeout,
		ToolApprovalTimeout: s.approvalTimeout,
		StreamWriteTimeout:  s.streamWriteTO,
		UserPublicID:        strings.TrimSpace(metaRef.UserPublicID),
		MessageID:           messageID,
		UploadsDir:          uploadsDir,
		ThreadsDB:           db,
		PersistOpTimeout:    persistTO,
		SkillManager:        s.skillManager,
		ToolAllowlist:       append([]string(nil), req.Options.ToolAllowlist...),
		NoUserInteraction:   req.Options.NoUserInteraction,
		ToolTargetPolicy:    toolTargetPolicy,
		TargetToolExecutor:  s.targetToolExecutor,
		OnStreamEvent: func(ev any) {
			if !finalizingThreadStatePublished && isFinalizingLifecycleStreamEvent(ev) {
				finalizingThreadStatePublished = true
				uctx, cancel := context.WithTimeout(context.Background(), persistTO)
				if err := db.UpdateThreadRunState(
					uctx,
					endpointID,
					threadID,
					string(RunStateFinalizing),
					"",
					"",
					"",
					metaRef.UserPublicID,
					metaRef.UserEmail,
				); err != nil && s.log != nil {
					s.log.Warn("update thread finalizing state failed", "thread_id", threadID, "run_id", runID, "error", err)
				}
				cancel()
				s.broadcastThreadState(endpointID, threadID, runID, string(RunStateFinalizing), "", "")
				s.broadcastThreadSummary(endpointID, threadID)
			}
			s.broadcastStreamEvent(endpointID, threadID, runID, ev)
		},
		Writer: w,
	})
	r.subagentRuntime = s.ensureThreadSubagentRuntimeLocked(thKey, r)
	s.activeRunByTh[thKey] = runID
	s.runs[runID] = r
	s.mu.Unlock()

	updateThreadRunState := func(status string, runErrorCode string, runErr string, waitingPrompt *RequestUserInputPrompt) {
		if db == nil {
			return
		}
		status = strings.TrimSpace(status)
		if status == "" {
			status = "failed"
		}
		waitingUserInputJSON := marshalRequestUserInputPrompt(waitingPrompt)
		uctx, cancel := context.WithTimeout(context.Background(), persistTO)
		defer cancel()
		if err := db.UpdateThreadRunState(
			uctx,
			endpointID,
			threadID,
			status,
			runErrorCode,
			runErr,
			waitingUserInputJSON,
			metaRef.UserPublicID,
			metaRef.UserEmail,
		); err != nil && s.log != nil {
			s.log.Warn("update thread run state failed", "thread_id", threadID, "run_id", runID, "status", status, "error", err)
		}
	}

	if persisted == nil {
		updateThreadRunState("running", "", "", nil)
		s.broadcastThreadState(endpointID, threadID, runID, "running", "", "")
		s.broadcastThreadSummary(endpointID, threadID)
		r.ensureAssistantMessageStarted()
		r.updateModelIOStatus(FlowerModelIOPhasePreparing, 0)
	}

	var persistedCopy *persistedUserMessage
	if persisted != nil {
		cp := *persisted
		persistedCopy = &cp
	}

	return &preparedRun{
		meta:                         metaRef,
		req:                          req,
		persistedUser:                persistedCopy,
		runID:                        runID,
		startedAtUnixMs:              time.Now().UnixMilli(),
		channelID:                    channelID,
		endpointID:                   endpointID,
		threadID:                     threadID,
		thKey:                        thKey,
		threadModelID:                strings.TrimSpace(th.ModelID),
		threadModelLocked:            th.ModelLocked,
		threadReasoningSelectionJSON: strings.TrimSpace(th.ReasoningSelectionJSON),
		cfg:                          cfg,
		uploadsDir:                   uploadsDir,
		persistTO:                    persistTO,
		db:                           db,
		messageID:                    messageID,
		r:                            r,
		updateThreadRunState:         updateThreadRunState,
	}, nil
}

func (s *Service) executePreparedRun(ctx context.Context, prepared *preparedRun) (retErr error) {
	if s == nil {
		return errors.New("nil service")
	}
	if prepared == nil || prepared.r == nil || prepared.meta == nil {
		return errors.New("invalid prepared run")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	r := prepared.r
	runID := strings.TrimSpace(prepared.runID)
	endpointID := strings.TrimSpace(prepared.endpointID)
	threadID := strings.TrimSpace(prepared.threadID)
	thKey := strings.TrimSpace(prepared.thKey)
	db := prepared.db
	persistTO := prepared.persistTO
	cfg := prepared.cfg
	meta := prepared.meta
	messageID := strings.TrimSpace(prepared.messageID)
	req := prepared.req

	// Always close the run stream to avoid goroutine leaks on early returns.
	// Also wait for the writer goroutine to finish so we never write to the ResponseWriter after handler return.
	defer func() {
		if r.stream != nil {
			r.stream.close()
			r.stream.wait()
		}
	}()

	streamEarlyError := func(err error) error {
		if err == nil {
			return nil
		}
		msg := strings.TrimSpace(err.Error())
		if msg == "" {
			msg = "AI failed."
		}
		r.ensureAssistantMessageStarted()
		_ = r.appendTextDelta(msg)
		r.sendStreamEvent(streamEventError{Type: "error", MessageID: messageID, Error: msg})
		r.setEndReason("error")
		return err
	}

	assistantJSON := ""
	var assistantAt int64
	engineRunStarted := false
	persistAssistantSnapshot := func(status string) (int64, error) {
		if db == nil || r.assistantAlreadyPersisted() {
			return 0, nil
		}
		status = normalizeSnapshotMessageStatus(status)
		if status == "" {
			status = "complete"
		}
		rawJSON, text, at, snapshotErr := r.snapshotAssistantMessageJSONWithStatus(status)
		if snapshotErr != nil {
			return 0, snapshotErr
		}
		if strings.TrimSpace(rawJSON) == "" {
			return 0, errors.New("missing assistant message")
		}
		pctx, cancel := context.WithTimeout(context.Background(), persistTO)
		rowID, appendErr := db.AppendMessage(pctx, endpointID, threadID, threadstore.Message{
			ThreadID:        threadID,
			EndpointID:      endpointID,
			MessageID:       messageID,
			Role:            "assistant",
			Status:          status,
			CreatedAtUnixMs: at,
			UpdatedAtUnixMs: at,
			TextContent:     text,
			MessageJSON:     rawJSON,
		}, meta.UserPublicID, meta.UserEmail)
		cancel()
		if appendErr != nil {
			return 0, appendErr
		}
		r.markAssistantPersisted()
		assistantJSON = rawJSON
		assistantAt = at
		return rowID, nil
	}

	defer func() {
		s.mu.Lock()
		delete(s.runs, runID)
		if strings.TrimSpace(s.activeRunByTh[thKey]) == runID {
			delete(s.activeRunByTh, thKey)
		}
		s.mu.Unlock()
		r.markDone()

		if r.isDetached() {
			return
		}
		runStatus, runStatusErrCode, runStatusErr := deriveThreadRunState(r.getEndReason(), r.getFinalizationReason(), r.getRunErrorCode(), retErr)
		waitingPrompt := waitingPromptForRunState(runStatus, r.snapshotWaitingPrompt())
		if !engineRunStarted {
			startedAt := prepared.startedAtUnixMs
			if startedAt <= 0 {
				startedAt = time.Now().UnixMilli()
			}
			r.persistRunRecord(NormalizeRunState(runStatus), runStatusErrCode, runStatusErr, startedAt, time.Now().UnixMilli())
			eventType := "run.error"
			switch NormalizeRunState(runStatus) {
			case RunStateSuccess, RunStateWaitingUser, RunStateCanceled:
				eventType = "run.end"
			}
			r.persistRunEvent(eventType, RealtimeStreamKindLifecycle, map[string]any{
				"state":      runStatus,
				"error_code": runStatusErrCode,
				"error":      runStatusErr,
			})
			if strings.TrimSpace(messageID) != "" && !r.assistantAlreadyPersisted() {
				assistantStatus := "error"
				if NormalizeRunState(runStatus) == RunStateCanceled {
					assistantStatus = "canceled"
				}
				if assistantRowID, persistErr := persistAssistantSnapshot(assistantStatus); persistErr != nil {
					if r.log != nil {
						r.log.Warn("persist early assistant message failed", "thread_id", threadID, "run_id", runID, "error", persistErr)
					}
				} else if assistantRowID > 0 {
					s.broadcastTranscriptMessage(endpointID, threadID, runID, assistantRowID, assistantJSON, assistantAt)
					s.broadcastThreadSummary(endpointID, threadID)
				}
			}
		}
		if prepared.updateThreadRunState != nil {
			prepared.updateThreadRunState(runStatus, runStatusErrCode, runStatusErr, waitingPrompt)
		}
		s.broadcastThreadState(endpointID, threadID, runID, runStatus, runStatusErrCode, runStatusErr)
		s.broadcastThreadSummary(endpointID, threadID)
		if s.threadMgr != nil {
			s.threadMgr.Wake(endpointID, threadID)
		}
	}()

	effectiveCurrentInput := deriveEffectiveCurrentUserInput(req.Input)
	pctx, cancelPersist := context.WithTimeout(context.Background(), persistTO)
	existingOpenGoal := ""
	if s.contextRepo != nil && s.contextRepo.Ready() {
		goal, goalErr := s.contextRepo.GetOpenGoal(pctx, endpointID, threadID)
		if goalErr != nil && r.log != nil {
			r.log.Warn("load open goal failed", "thread_id", threadID, "error", goalErr)
		}
		existingOpenGoal = strings.TrimSpace(goal)
	}
	cancelPersist()

	resolvedModel, err := s.resolveRunModel(ctx, cfg, req.Model, prepared.threadModelID, prepared.threadModelLocked, r)
	if err != nil {
		if errors.Is(err, ErrModelLockViolation) || errors.Is(err, ErrModelSwitchRequiresExplicitRestart) {
			r.persistRunEvent("task.model_lock.rejected", RealtimeStreamKindLifecycle, map[string]any{
				"reason_code":     "model_lock_conflict",
				"policy_source":   "thread_model_lock",
				"requested_model": strings.TrimSpace(req.Model),
				"locked_model_id": strings.TrimSpace(prepared.threadModelID),
				"thread_locked":   prepared.threadModelLocked,
				"error":           strings.TrimSpace(err.Error()),
			})
		}
		return streamEarlyError(err)
	}
	model := resolvedModel.ID
	modelCapability := resolvedModel.Capability
	reasoningCapability, modelDefaultReasoning := modelReasoningDefaultsFromCapability(modelCapability)
	threadDefaultReasoning := unmarshalReasoningSelection(prepared.threadReasoningSelectionJSON)
	reasoning, err := resolveEffectiveReasoning(reasoningCapability, req.Options.ReasoningSelection, threadDefaultReasoning, modelDefaultReasoning)
	if err != nil {
		return streamEarlyError(reasoningSelectionError(model, err))
	}
	req.Options.ReasoningSelection = reasoning.Effective
	r.currentReasoning = reasoning.Effective
	r.persistRunEvent("reasoning.selection.normalized", RealtimeStreamKindLifecycle, map[string]any{
		"requested":      reasoning.Requested,
		"effective":      reasoning.Effective,
		"source":         reasoning.Source,
		"adjusted":       reasoning.Adjusted,
		"model":          model,
		"wire_shape":     reasoningCapability.WireShape,
		"matrix_fixture": reasoningCapability.Fixture,
		"omitted":        reasoning.Effective.IsZero(),
		"disabled":       reasoning.Effective.Level == config.AIReasoningLevelOff,
	})
	lockReasonCode := "thread_model_pending_lock"
	if prepared.threadModelLocked {
		lockReasonCode = "thread_model_locked"
	}
	r.persistRunEvent("task.model_lock.enforced", RealtimeStreamKindLifecycle, map[string]any{
		"reason_code":     lockReasonCode,
		"policy_source":   "thread_model_lock",
		"requested_model": strings.TrimSpace(req.Model),
		"locked_model_id": strings.TrimSpace(prepared.threadModelID),
		"resolved_model":  model,
		"thread_locked":   prepared.threadModelLocked,
	})
	if payload := contextActionRunEventPayload(req.Input.ContextAction); payload != nil {
		r.persistRunEvent("flower.context_action.received", RealtimeStreamKindLifecycle, payload)
	}

	openGoal := strings.TrimSpace(existingOpenGoal)
	effectiveInput := req.Input

	userMsgID := ""
	autoTitleMessageRowID := int64(0)
	autoTitleMessageCreatedAtUnixMs := int64(0)
	if prepared.persistedUser != nil {
		if persistedID := strings.TrimSpace(prepared.persistedUser.MessageID); persistedID != "" {
			userMsgID = persistedID
		}
		autoTitleMessageRowID = prepared.persistedUser.RowID
		autoTitleMessageCreatedAtUnixMs = prepared.persistedUser.CreatedAtUnixMs
	}
	if userMsgID == "" {
		persisted, normalizedInput, persistErr := s.persistUserMessage(context.Background(), meta, endpointID, threadID, req.Input)
		if persistErr != nil {
			return streamEarlyError(persistErr)
		}
		effectiveInput = normalizedInput
		userMsgID = strings.TrimSpace(persisted.MessageID)
		autoTitleMessageRowID = persisted.RowID
		autoTitleMessageCreatedAtUnixMs = persisted.CreatedAtUnixMs
		s.broadcastTranscriptMessage(endpointID, threadID, runID, persisted.RowID, persisted.MessageJSON, persisted.CreatedAtUnixMs)
		s.broadcastThreadSummary(endpointID, threadID)
	}
	effectiveCurrentInput.MessageID = userMsgID
	effectiveCurrentInput.MessageRowID = autoTitleMessageRowID
	effectiveCurrentInput.MessageCreatedAtUnixMs = autoTitleMessageCreatedAtUnixMs
	effectiveInput.MessageID = userMsgID
	s.scheduleAutoThreadTitle(meta, threadID, effectiveCurrentInput)

	select {
	case <-ctx.Done():
		switch strings.TrimSpace(r.getCancelReason()) {
		case "canceled":
			r.setEndReason("canceled")
			r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: messageID})
			return nil
		case "timed_out":
			r.setEndReason("timed_out")
			r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: messageID})
			return nil
		default:
			return ctx.Err()
		}
	default:
	}

	{
		pctx, cancel := context.WithTimeout(context.Background(), persistTO)
		_ = db.UpdateThreadModelID(pctx, endpointID, threadID, model)
		if !prepared.threadModelLocked {
			_ = db.UpdateThreadModelLock(pctx, endpointID, threadID, true)
			prepared.threadModelLocked = true
			prepared.threadModelID = model
			r.persistRunEvent("task.model_lock.enforced", RealtimeStreamKindLifecycle, map[string]any{
				"reason_code":     "thread_model_lock_initialized",
				"policy_source":   "thread_model_lock",
				"locked_model_id": model,
				"resolved_model":  model,
				"thread_locked":   true,
			})
		}
		cancel()
	}

	runReq := RunRequest{
		Model:           model,
		Objective:       strings.TrimSpace(openGoal),
		Input:           effectiveInput,
		Options:         req.Options,
		ModelCapability: modelCapability,
	}
	engineRunStarted = true
	runErr := r.run(ctx, runReq)
	finalErr := runErr
	if runErr != nil {
		handledCancel := false
		reason := strings.TrimSpace(r.getCancelReason())
		if errors.Is(runErr, context.Canceled) {
			switch reason {
			case "canceled":
				r.setEndReason("canceled")
				r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: messageID})
				handledCancel = true
			case "timed_out":
				r.setEndReason("timed_out")
				r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: messageID})
				handledCancel = true
			}
		}
		if handledCancel {
			finalErr = nil
		}
	}

	// Hard-canceled runs are detached from the thread lifecycle to unblock UI actions.
	// Do not persist assistant messages after detachment, or we may race with subsequent runs on the same thread.
	if r.isDetached() {
		return finalErr
	}

	assistantRowID, err := persistAssistantSnapshot("complete")
	if err != nil {
		if finalErr != nil {
			return errors.Join(finalErr, err)
		}
		return err
	}
	if db != nil {
		turnCtx, cancelTurn := context.WithTimeout(context.Background(), persistTO)
		_, err = db.AppendConversationTurn(turnCtx, threadstore.ConversationTurn{
			TurnID:             messageID,
			EndpointID:         endpointID,
			ThreadID:           threadID,
			RunID:              runID,
			UserMessageID:      userMsgID,
			AssistantMessageID: messageID,
			CreatedAtUnixMs:    assistantAt,
		})
		cancelTurn()
		if err != nil {
			if finalErr != nil {
				return errors.Join(finalErr, err)
			}
			return err
		}
	}
	s.broadcastTranscriptMessage(endpointID, threadID, runID, assistantRowID, assistantJSON, assistantAt)
	s.broadcastThreadSummary(endpointID, threadID)

	finalReason := strings.TrimSpace(r.getFinalizationReason())
	if db != nil {
		continuationCtx, cancelContinuation := context.WithTimeout(context.Background(), persistTO)
		continuationCandidate := r.getProviderContinuationCandidate()
		syncErr := persistProviderContinuationCandidate(continuationCtx, db, endpointID, threadID, continuationCandidate)
		if syncErr != nil && finalErr == nil {
			finalErr = syncErr
		} else if syncErr == nil {
			eventType := "provider.continuation.cleared"
			payload := map[string]any{
				"finalization_reason": finalReason,
			}
			if continuationCandidate.IsZero() {
				payload["reason"] = "no_candidate"
			} else {
				eventType = "provider.continuation.persisted"
				payload["reason"] = "provider_state_available"
				payload["provider_state_kind"] = continuationCandidate.State.Kind
				payload["provider_state_id"] = continuationCandidate.State.ID
				payload["provider_id"] = continuationCandidate.ProviderID
				payload["model"] = continuationCandidate.Model
				payload["base_url"] = continuationCandidate.BaseURL
			}
			r.persistRunEvent(eventType, RealtimeStreamKindLifecycle, payload)
		}
		cancelContinuation()
	}
	if s.contextRepo != nil {
		stateCtx, cancelState := context.WithTimeout(context.Background(), persistTO)
		if shouldClearOpenGoalAfterRun(existingOpenGoal, finalReason) {
			_ = s.contextRepo.SetOpenGoal(stateCtx, endpointID, threadID, "")
		} else if shouldPersistOpenGoalAfterRun(finalReason) && strings.TrimSpace(openGoal) != "" {
			_ = s.contextRepo.SetOpenGoal(stateCtx, endpointID, threadID, openGoal)
		}
		cancelState()
	}
	return finalErr
}

func (s *Service) resolveRunModel(ctx context.Context, cfg *config.AIConfig, requestedModel string, threadModelID string, threadModelLocked bool, r *run) (resolvedRunModel, error) {
	model := ""
	requestedModel = strings.TrimSpace(requestedModel)
	threadModelID = strings.TrimSpace(threadModelID)
	if threadModelLocked {
		if threadModelID == "" {
			return resolvedRunModel{}, fmt.Errorf("%w: missing locked model id", ErrModelLockViolation)
		}
		if requestedModel != "" && requestedModel != threadModelID {
			return resolvedRunModel{}, fmt.Errorf("%w: locked=%s requested=%s", ErrModelSwitchRequiresExplicitRestart, threadModelID, requestedModel)
		}
		model = threadModelID
	} else {
		model = requestedModel
		if model == "" {
			model = threadModelID
		}
	}
	if model == "" {
		if id, ok := s.resolvedDesktopModelSourceOverrideModel(ctx); ok {
			model = id
		}
	}
	if model == "" && cfg != nil {
		if id := strings.TrimSpace(cfg.CurrentModelID); id != "" && cfg.IsAllowedModelID(id) {
			model = id
		}
	}
	if model == "" && cfg == nil {
		if id, ok := s.resolvedDesktopModelSourceDefaultModel(ctx); ok {
			model = id
		}
	}
	if model == "" {
		return resolvedRunModel{}, errors.New("missing model")
	}
	providerID, modelName := "", ""
	desktopModelSourceModelID := ""
	var providerCfg config.AIProvider
	if isDesktopModelSourceModelID(model) {
		allowed, err := s.desktopModelSourceModelAllowed(ctx, model)
		if err != nil {
			return resolvedRunModel{}, err
		}
		if !allowed {
			return resolvedRunModel{}, fmt.Errorf("model not allowed: %s", model)
		}
		providerID = DesktopModelSourceProviderType
		modelName = model
		desktopModelSourceModelID = model
		providerCfg = config.AIProvider{ID: providerID, Name: "Desktop", Type: DesktopModelSourceProviderType}
	} else {
		var ok bool
		providerID, modelName, ok = strings.Cut(model, "/")
		if !ok {
			return resolvedRunModel{}, errors.New("invalid model")
		}
		providerID = strings.TrimSpace(providerID)
		modelName = strings.TrimSpace(modelName)
		if providerID == "" || modelName == "" {
			return resolvedRunModel{}, errors.New("invalid model")
		}
		providerCfg = config.AIProvider{ID: providerID, Type: providerID}
		if cfg == nil {
			return resolvedRunModel{}, ErrNotConfigured
		}
		if !cfg.IsAllowedModelID(model) {
			return resolvedRunModel{}, fmt.Errorf("model not allowed: %s", model)
		}
		for i := range cfg.Providers {
			if strings.TrimSpace(cfg.Providers[i].ID) != providerID {
				continue
			}
			providerCfg = cfg.Providers[i]
			break
		}
	}

	modelCapability := r.resolveRunModelCapability(model)
	if s.capabilityResolver != nil {
		if capability, capErr := s.capabilityResolver.Resolve(ctx, providerCfg, model); capErr == nil {
			modelCapability = capability
		} else if r != nil && r.log != nil {
			r.log.Warn("resolve model capability failed", "model", model, "error", capErr)
		}
	}

	return resolvedRunModel{
		ID:                        model,
		ProviderID:                providerID,
		ModelName:                 modelName,
		WireModelName:             strings.TrimSpace(modelCapability.WireModelName),
		Provider:                  providerCfg,
		Capability:                modelCapability,
		DesktopModelSourceModelID: desktopModelSourceModelID,
	}, nil
}

func (s *Service) resolvedDesktopModelSourceOverrideModel(ctx context.Context) (string, bool) {
	if s == nil {
		return "", false
	}
	s.mu.Lock()
	modelSource := s.desktopModelSource
	current := ""
	if modelSource != nil {
		current = modelSource.CurrentModelID()
	}
	s.mu.Unlock()
	if modelSource == nil {
		return "", false
	}
	if current == "" {
		return "", false
	}
	checkCtx := ctx
	cancel := func() {}
	if checkCtx == nil {
		checkCtx = context.Background()
	}
	if _, ok := checkCtx.Deadline(); !ok {
		checkCtx, cancel = context.WithTimeout(checkCtx, 3*time.Second)
	}
	defer cancel()
	snapshot, err := modelSource.ListModels(checkCtx)
	if err != nil || snapshot == nil {
		return "", false
	}
	if desktopModelSourceSnapshotHasModel(snapshot, current) {
		return current, true
	}
	return "", false
}

func (s *Service) resolvedDesktopModelSourceDefaultModel(ctx context.Context) (string, bool) {
	if s == nil {
		return "", false
	}
	s.mu.Lock()
	modelSource := s.desktopModelSource
	current := ""
	if modelSource != nil {
		current = modelSource.CurrentModelID()
	}
	s.mu.Unlock()
	if modelSource == nil {
		return "", false
	}
	checkCtx := ctx
	cancel := func() {}
	if checkCtx == nil {
		checkCtx = context.Background()
	}
	if _, ok := checkCtx.Deadline(); !ok {
		checkCtx, cancel = context.WithTimeout(checkCtx, 3*time.Second)
	}
	defer cancel()
	snapshot, err := modelSource.ListModels(checkCtx)
	if err != nil || snapshot == nil {
		return "", false
	}
	if current != "" && desktopModelSourceSnapshotHasModel(snapshot, current) {
		return current, true
	}
	if desktopModelSourceSnapshotHasModel(snapshot, snapshot.CurrentModel) {
		return strings.TrimSpace(snapshot.CurrentModel), true
	}
	return "", false
}

func shouldClearThreadState(finalReason string) bool {
	switch strings.TrimSpace(finalReason) {
	case "task_complete", "natural_stop":
		return true
	default:
		return false
	}
}

func shouldPersistOpenGoalAfterRun(finalReason string) bool {
	if shouldClearThreadState(finalReason) {
		return false
	}
	if classifyFinalizationReason(finalReason) == finalizationClassWaitingUser {
		return true
	}
	return false
}

func shouldClearOpenGoalAfterRun(existingOpenGoal string, finalReason string) bool {
	if shouldClearThreadState(finalReason) {
		return true
	}
	if shouldPersistOpenGoalAfterRun(finalReason) {
		return false
	}
	if strings.TrimSpace(existingOpenGoal) == "" {
		return false
	}
	return classifyFinalizationReason(finalReason) == finalizationClassSuccess
}

type effectiveCurrentUserInput struct {
	MessageID              string
	MessageRowID           int64
	MessageCreatedAtUnixMs int64
	PublicText             string
	StructuredResponse     *RequestUserInputResponseRecord
}

func deriveEffectiveCurrentUserInput(input RunInput) effectiveCurrentUserInput {
	out := effectiveCurrentUserInput{
		MessageID:  strings.TrimSpace(input.MessageID),
		PublicText: strings.TrimSpace(input.Text),
	}
	if input.StructuredResponse != nil {
		record := *input.StructuredResponse
		out.StructuredResponse = &record
		summary := strings.TrimSpace(record.PublicSummary)
		switch {
		case summary != "" && out.PublicText != "":
			out.PublicText = summary + "\n\n" + out.PublicText
		case summary != "":
			out.PublicText = summary
		}
	}
	return out
}

func defaultModelCapability(providerID string, modelName string, wireModelName string) contextmodel.ModelCapability {
	providerID = strings.TrimSpace(providerID)
	modelName = strings.TrimSpace(modelName)
	wireModelName = strings.TrimSpace(wireModelName)
	if wireModelName == "" {
		wireModelName = modelName
	}
	cap := contextmodel.ModelCapability{
		ProviderID:                     providerID,
		ModelName:                      modelName,
		WireModelName:                  wireModelName,
		SupportsTools:                  true,
		SupportsParallelTools:          false,
		SupportsStrictJSONSchema:       true,
		SupportsImageInput:             false,
		SupportsFileInput:              false,
		SupportsReasoningTokens:        true,
		SupportsAskUserQuestionBatches: true,
		MaxContextTokens:               128000,
		MaxOutputTokens:                4096,
		PreferredToolSchemaMode:        "json_schema",
	}
	return contextmodel.NormalizeCapability(cap)
}

func deriveThreadRunState(endReason string, finalizationReason string, runErrorCode string, runErr error) (string, string, string) {
	endReason = strings.TrimSpace(endReason)
	runErrorCode = strings.TrimSpace(runErrorCode)
	switch endReason {
	case "complete":
		switch classifyFinalizationReason(finalizationReason) {
		case finalizationClassSuccess:
			return "success", "", ""
		case finalizationClassWaitingUser:
			return "waiting_user", "", ""
		}
		msg := ""
		if runErr != nil {
			if errors.Is(runErr, context.DeadlineExceeded) {
				return "timed_out", runErrorCodeProviderUnreachable, userFacingRunError(runErrorCodeProviderUnreachable, "Timed out.")
			}
			msg = strings.TrimSpace(runErr.Error())
		}
		if msg == "" {
			msg = "Run ended without explicit completion."
		}
		return "failed", runErrorCode, userFacingRunError(runErrorCode, msg)
	case "canceled":
		return "canceled", "", ""
	case "timed_out":
		return "timed_out", runErrorCodeProviderUnreachable, userFacingRunError(runErrorCodeProviderUnreachable, "Timed out.")
	case "disconnected":
		return "failed", runErrorCode, userFacingRunError(runErrorCode, "Disconnected.")
	case "error":
		if runErr != nil {
			msg := strings.TrimSpace(runErr.Error())
			if msg != "" {
				return "failed", runErrorCode, userFacingRunError(runErrorCode, msg)
			}
		}
		return "failed", runErrorCode, userFacingRunError(runErrorCode, "AI failed.")
	default:
		if runErr != nil {
			if errors.Is(runErr, context.DeadlineExceeded) {
				return "timed_out", runErrorCodeProviderUnreachable, userFacingRunError(runErrorCodeProviderUnreachable, "Timed out.")
			}
			if errors.Is(runErr, context.Canceled) {
				return "failed", runErrorCode, userFacingRunError(runErrorCode, "Disconnected.")
			}
			msg := strings.TrimSpace(runErr.Error())
			if msg != "" {
				return "failed", runErrorCode, userFacingRunError(runErrorCode, msg)
			}
		}
		return "failed", runErrorCode, userFacingRunError(runErrorCode, "AI run ended unexpectedly.")
	}
}

func isFinalizingLifecycleStreamEvent(ev any) bool {
	switch e := ev.(type) {
	case streamEventLifecyclePhase:
		return normalizeLifecyclePhase(e.Phase) == "finalizing"
	case *streamEventLifecyclePhase:
		if e == nil {
			return false
		}
		return normalizeLifecyclePhase(e.Phase) == "finalizing"
	case map[string]any:
		eventType := strings.TrimSpace(strings.ToLower(fmt.Sprint(e["type"])))
		if eventType != "lifecycle-phase" {
			return false
		}
		return normalizeLifecyclePhase(fmt.Sprint(e["phase"])) == "finalizing"
	default:
		return false
	}
}

func (s *Service) CancelRun(meta *session.Meta, runID string) error {
	if s == nil {
		return errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return err
	}
	runID = strings.TrimSpace(runID)
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" || runID == "" {
		return errors.New("invalid request")
	}

	var r *run
	threadID := ""

	s.mu.Lock()
	r = s.runs[runID]
	// Cancel is best-effort and idempotent. Do not leak run existence cross-session.
	if r != nil && strings.TrimSpace(r.endpointID) != endpointID {
		s.mu.Unlock()
		return nil
	}
	if r != nil {
		threadID = strings.TrimSpace(r.threadID)
		r.markDetached()
	}
	// Detach any stale active mappings so the thread can be managed even if the run is stuck.
	for k, rid := range s.activeRunByTh {
		if strings.TrimSpace(rid) != runID {
			continue
		}
		delete(s.activeRunByTh, k)
		if threadID == "" && strings.HasPrefix(k, endpointID+":") {
			threadID = strings.TrimSpace(strings.TrimPrefix(k, endpointID+":"))
		}
	}
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()

	if r != nil {
		r.requestCancel("canceled")
		s.publishCanceledAssistantDraft(meta, r, db, persistTO)
	}
	if threadID != "" {
		s.closeThreadSubagents(context.Background(), endpointID, threadID, persistTO)
	}

	if db != nil && threadID != "" {
		uctx, cancel := context.WithTimeout(context.Background(), persistTO)
		_ = db.UpdateThreadRunState(uctx, endpointID, threadID, "canceled", "", "", "", meta.UserPublicID, meta.UserEmail)
		cancel()
		s.broadcastThreadState(endpointID, threadID, runID, "canceled", "", "")
		s.broadcastThreadSummary(endpointID, threadID)
		if s.threadMgr != nil {
			s.threadMgr.Wake(endpointID, threadID)
		}
	}
	return nil
}
