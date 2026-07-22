package ai

import (
	"context"
	"crypto/rand"
	"database/sql"
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
	ErrNotConfigured                   = errors.New("ai not configured")
	ErrRunActive                       = errors.New("run already active")
	ErrThreadBusy                      = errors.New("thread already active")
	ErrThreadForkUnavailable           = errors.New("thread cannot be forked while active or waiting")
	ErrCanonicalTimelineResyncRequired = errors.New("canonical timeline resync required")
	ErrUserTurnNotAdmitted             = errors.New("user turn was not admitted by Floret")
)

const CanonicalTimelineResyncErrorCode = "AI_TIMELINE_RESYNC_REQUIRED"

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
	ToolTargetPolicyForRun func(meta *session.Meta, thread threadstore.ThreadSettings, routing *threadstore.FlowerThreadRouting) ToolTargetPolicy

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

	FlowerReadStateCleaner FlowerReadStateCleaner
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
	toolTargetPolicyForRun func(meta *session.Meta, thread threadstore.ThreadSettings, routing *threadstore.FlowerThreadRouting) ToolTargetPolicy

	mu                      sync.Mutex
	activeRunByTh           map[string]string // <endpoint_id>:<thread_id> -> run_id
	stopFinalizingByTh      map[string]string // <endpoint_id>:<thread_id> -> detached run_id still finalizing
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
	flowerLiveRetired    map[string]struct{}
	flowerLiveGeneration int64

	uploadsDir string
	threadsDB  *threadstore.Store

	closeFloret         func() error
	floretReads         *floretReadCapabilities
	floretRuntime       *floretRuntimeCapabilityIssuer
	pendingToolRecovery floretPendingToolRecoveryCoordinator
	threadCreateFloret  *threadCreateFloretCoordinator
	threadTitleFloret   *threadTitleFloretCoordinator
	threadForkFloret    *threadForkFloretCoordinator
	threadDeleteFloret  *threadDeleteFloretCoordinator

	capabilityResolver *contextadapter.Resolver
	skillManager       *skillManager
	terminalProcesses  *terminalProcessManager

	flowerReadStateCleaner FlowerReadStateCleaner
	threadForkBroadcastMu  sync.Mutex
	maintenanceStopCh      chan struct{}
	maintenanceDoneCh      chan struct{}
	compactionScheduled    bool
	recoveryMu             sync.RWMutex
	recoveryPending        bool
	recoveryErr            error
	recoveryStopCh         chan struct{}
	recoveryWG             sync.WaitGroup
	lifecycleCtx           context.Context
	lifecycleCancel        context.CancelFunc
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
	persistTO := opts.PersistOpTimeout
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}

	floretStorePath, err := floretThreadStorePath(opts.StateDir)
	if err != nil {
		return nil, err
	}
	floretBootstrap, floretRecovery, err := openFloretRuntime(floretStorePath)
	if err != nil {
		return nil, err
	}
	threadsPath := filepath.Join(strings.TrimSpace(opts.StateDir), "ai", "threads.sqlite")
	ts, err := threadstore.Open(threadsPath, threadstore.WithLegacyThreadTitleMigrator(func(_ context.Context, legacy threadstore.LegacyThreadTitle) error {
		ctx, cancel := context.WithTimeout(context.Background(), persistTO)
		defer cancel()
		threadID := flruntime.ThreadID(strings.TrimSpace(legacy.ThreadID))
		readHost, err := floretBootstrap.newThreadRead(ctx, threadID)
		if err != nil {
			return fmt.Errorf("bind canonical Floret title read: %w", err)
		}
		overview, err := readHost.ReadThreadOverview(ctx, threadID)
		if err != nil {
			return fmt.Errorf("read canonical Floret title: %w", err)
		}
		canonicalTitle := strings.TrimSpace(overview.Thread.Title)
		switch {
		case canonicalTitle == "":
			titleHost, bindErr := floretBootstrap.newThreadTitle(ctx, threadID, nil)
			if bindErr != nil {
				return fmt.Errorf("bind canonical Floret title write: %w", bindErr)
			}
			_, err = titleHost.SetThreadTitle(ctx, flruntime.SetThreadTitleRequest{ThreadID: threadID, Title: legacy.Title})
			return err
		case canonicalTitle == strings.TrimSpace(legacy.Title):
			return nil
		default:
			return fmt.Errorf("canonical Floret title %q conflicts with Redeven title %q", canonicalTitle, strings.TrimSpace(legacy.Title))
		}
	}))
	if err != nil {
		_ = floretBootstrap.close()
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
		_ = ts.Close()
		_ = floretBootstrap.close()
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

	contextRepo := contextstore.NewRepository(ts)
	capabilityResolver := contextadapter.NewResolver(contextRepo)

	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
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
		stopFinalizingByTh:           make(map[string]string),
		idleCompactionByTh:           make(map[string]*idleThreadCompaction),
		runs:                         make(map[string]*run),
		subagentRuntimes:             make(map[string]*floretSubagentRuntime),
		realtimeWriters:              make(map[*rpc.Server]*aiSinkWriter),
		realtimeSummaryByEndpoint:    make(map[string]map[*rpc.Server]struct{}),
		realtimeSummaryEndpointBySRV: make(map[*rpc.Server]string),
		realtimeByThread:             make(map[string]map[*rpc.Server]struct{}),
		realtimeThreadBySRV:          make(map[*rpc.Server]string),
		flowerLiveByThread:           make(map[string]*flowerLiveThreadStream),
		flowerLiveRetired:            make(map[string]struct{}),
		flowerLiveGeneration:         newFlowerLiveGeneration(),
		suppressQueuedDrainByTh:      make(map[string]bool),
		uploadsDir:                   uploadsDir,
		threadsDB:                    ts,
		closeFloret:                  floretBootstrap.close,
		floretReads: &floretReadCapabilities{
			thread:   floretBootstrap.newThreadRead,
			subagent: floretBootstrap.newSubagentRead,
		},
		floretRuntime:          &floretRuntimeCapabilityIssuer{bind: floretBootstrap.bindThreadRuntime},
		pendingToolRecovery:    floretBootstrap.pendingToolRecovery,
		threadCreateFloret:     &threadCreateFloretCoordinator{authority: floretBootstrap.threadCreate},
		threadTitleFloret:      &threadTitleFloretCoordinator{authority: floretBootstrap.threadTitle},
		threadForkFloret:       &threadForkFloretCoordinator{authority: floretBootstrap.threadFork},
		threadDeleteFloret:     &threadDeleteFloretCoordinator{authority: floretBootstrap.threadDelete},
		capabilityResolver:     capabilityResolver,
		skillManager:           newSkillManager(agentHomeDir, strings.TrimSpace(opts.StateDir)),
		flowerReadStateCleaner: opts.FlowerReadStateCleaner,
		maintenanceStopCh:      make(chan struct{}),
		maintenanceDoneCh:      make(chan struct{}),
		recoveryStopCh:         make(chan struct{}),
		lifecycleCtx:           lifecycleCtx,
		lifecycleCancel:        lifecycleCancel,
	}
	svc.terminalProcesses = newTerminalProcessManager()
	if svc.skillManager != nil {
		svc.skillManager.Discover()
	}
	svc.threadMgr = newThreadManager(svc)
	deleteReplayCtx, cancelDeleteReplay := context.WithTimeout(context.Background(), persistTO)
	deleteReplayCount, deleteReplayErr := svc.replayAllPendingThreadDeletesForStartup(deleteReplayCtx, threadDeleteReplayBatchSize)
	cancelDeleteReplay()
	if deleteReplayErr != nil {
		closeServiceBeforeMaintenance(svc)
		return nil, fmt.Errorf("recover pending thread deletes: %w", deleteReplayErr)
	} else if deleteReplayCount > 0 {
		logger.Info("ai: pending thread delete recovery completed", "count", deleteReplayCount)
	}
	createReplayCtx, cancelCreateReplay := context.WithTimeout(context.Background(), persistTO)
	createReplayErr := svc.recoverPreTurnStartupOperations(createReplayCtx)
	cancelCreateReplay()
	if createReplayErr != nil {
		closeServiceBeforeMaintenance(svc)
		return nil, createReplayErr
	}
	recoveryTargetsCtx, recoveryTargetsCancel := context.WithTimeout(context.Background(), persistTO)
	recoveryTargets, recoveryTargetsErr := buildFloretStartupRecoveryTargets(recoveryTargetsCtx, ts, floretRecovery)
	recoveryTargetsCancel()
	if recoveryTargetsErr != nil {
		closeServiceBeforeMaintenance(svc)
		return nil, fmt.Errorf("bind exact Floret startup recovery targets: %w", recoveryTargetsErr)
	}
	if err := svc.startFloretStartupRecovery(recoveryTargets); err != nil {
		closeServiceBeforeMaintenance(svc)
		return nil, err
	}
	svc.startBackgroundMaintenance()
	return svc, nil
}

func closeServiceBeforeMaintenance(s *Service) {
	if s == nil {
		return
	}
	if s.threadMgr != nil {
		s.threadMgr.Close()
	}
	if s.recoveryStopCh != nil {
		close(s.recoveryStopCh)
		s.recoveryStopCh = nil
	}
	s.recoveryWG.Wait()
	if s.terminalProcesses != nil {
		ctx, cancel := context.WithTimeout(context.Background(), s.persistTimeout())
		_ = s.terminalProcesses.Close(ctx)
		cancel()
	}
	if s.threadsDB != nil {
		_ = s.threadsDB.Close()
	}
	if s.closeFloret != nil {
		_ = s.closeFloret()
	}
}

type queuedTurnRecoveryTarget struct {
	endpointID string
	threadID   string
}

func (s *Service) recoverQueuedTurnCommandsForStartup(ctx context.Context) ([]queuedTurnRecoveryTarget, error) {
	if s == nil {
		return nil, errors.New("queued turn recovery coordinator is unavailable")
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
	recoveryCtx, cancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
	defer cancel()
	queuedThreads, err := db.ListAllThreadsWithQueuedTurnsForRecovery(recoveryCtx)
	if err != nil {
		return nil, fmt.Errorf("scan queued turns for startup recovery: %w", err)
	}
	targets := make([]queuedTurnRecoveryTarget, 0, len(queuedThreads))
	for _, queued := range queuedThreads {
		endpointID := strings.TrimSpace(queued.EndpointID)
		threadID := strings.TrimSpace(queued.ThreadID)
		if endpointID == "" || threadID == "" {
			return nil, errors.New("queued turn recovery target identity is incomplete")
		}
		wake, err := func() (bool, error) {
			if s.threadMgr == nil {
				return false, errors.New("thread lifecycle authority is unavailable")
			}
			unlock, lockErr := s.threadMgr.lockThreadLifecycle(endpointID, threadID)
			if lockErr != nil {
				return false, lockErr
			}
			defer unlock()
			s.mu.Lock()
			threadKey := runThreadKey(endpointID, threadID)
			activeRunID := strings.TrimSpace(s.activeRunByTh[threadKey])
			finalizingRunID := strings.TrimSpace(s.stopFinalizingByTh[threadKey])
			idleCompaction := s.idleCompactionByTh[threadKey]
			s.mu.Unlock()
			if activeRunID != "" || finalizingRunID != "" || (idleCompaction != nil && idleCompaction.busy()) {
				return false, errors.New("queued turn startup recovery encountered an active runtime settlement owner")
			}
			commands, listErr := db.ListAllFollowupsByLaneForRecovery(recoveryCtx, endpointID, threadID, threadstore.FollowupLaneQueued)
			if listErr != nil {
				return false, listErr
			}
			turnIDs, turnErr := s.readCanonicalThreadTurnIDs(recoveryCtx, threadID)
			if turnErr != nil {
				return false, turnErr
			}
			for _, command := range commands {
				if _, accepted := turnIDs[strings.TrimSpace(command.TurnID)]; accepted {
					if err := s.commitPendingTurnCommandAdmission(recoveryCtx, endpointID, threadID, command.QueueID, command.TurnID, nil); err != nil {
						return false, fmt.Errorf("settle admitted command %q turn %q: %w", command.QueueID, command.TurnID, err)
					}
					continue
				}
				if command.AdmissionState == threadstore.PendingTurnAdmissionInFlight {
					releaseErr := s.releasePendingTurnCommandAdmission(
						recoveryCtx,
						endpointID,
						threadID,
						command.QueueID,
						command.TurnID,
						command.RunID,
						threadstore.FollowupLaneQueued,
					)
					if releaseErr != nil {
						return false, fmt.Errorf("release unadmitted command %q turn %q run %q: %w", command.QueueID, command.TurnID, command.RunID, releaseErr)
					}
				}
			}
			host, hostErr := s.openFloretThreadReadHost(recoveryCtx, threadID)
			var snapshot flruntime.ThreadSnapshot
			if hostErr == nil {
				snapshot, hostErr = host.ReadThread(recoveryCtx, flruntime.ThreadID(threadID))
			}
			if hostErr != nil {
				return false, hostErr
			}
			return snapshot.CanAppendMessage, nil
		}()
		if err != nil {
			return nil, fmt.Errorf("recover queued turns for thread %q: %w", threadID, err)
		}
		if wake {
			targets = append(targets, queuedTurnRecoveryTarget{endpointID: endpointID, threadID: threadID})
		}
	}
	return targets, nil
}

func (s *Service) wakeQueuedTurnRecoveryTargets(targets []queuedTurnRecoveryTarget) {
	if s == nil || s.threadMgr == nil {
		return
	}
	for _, target := range targets {
		s.threadMgr.Wake(target.endpointID, target.threadID)
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
	terminalProcesses := s.terminalProcesses
	s.terminalProcesses = nil
	ts := s.threadsDB
	closeFloret := s.closeFloret
	s.closeFloret = nil
	s.floretReads = nil
	s.floretRuntime = nil
	s.threadCreateFloret = nil
	s.threadTitleFloret = nil
	s.threadForkFloret = nil
	s.threadDeleteFloret = nil
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
	s.flowerLiveRetired = make(map[string]struct{})
	maintenanceStopCh := s.maintenanceStopCh
	maintenanceDoneCh := s.maintenanceDoneCh
	recoveryStopCh := s.recoveryStopCh
	lifecycleCancel := s.lifecycleCancel
	s.maintenanceStopCh = nil
	s.maintenanceDoneCh = nil
	s.recoveryStopCh = nil
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
	s.mu.Unlock()
	if lifecycleCancel != nil {
		lifecycleCancel()
	}

	waitTO := s.persistOpTO
	if waitTO <= 0 {
		waitTO = defaultPersistOpTimeout
	}
	var terminalCloseErr error
	if terminalProcesses != nil {
		closeCtx, closeCancel := context.WithTimeout(context.Background(), waitTO)
		terminalCloseErr = terminalProcesses.Close(closeCtx)
		closeCancel()
	}
	if maintenanceStopCh != nil {
		close(maintenanceStopCh)
	}
	if recoveryStopCh != nil {
		close(recoveryStopCh)
	}
	if maintenanceDoneCh != nil {
		<-maintenanceDoneCh
	}
	s.recoveryWG.Wait()
	for _, w := range writers {
		w.Close()
	}
	for _, r := range runs {
		r.requestCancel("canceled")
	}
	for _, compaction := range idleCompactions {
		s.cancelIdleThreadCompactionWithBroadcast(compaction.endpointID, compaction.threadID)
	}
	for _, compaction := range idleCompactions {
		waitCtx, waitCancel := context.WithTimeout(context.Background(), waitTO)
		waitOK := s.waitIdleThreadCompaction(waitCtx, compaction)
		waitCancel()
		if !waitOK && s.log != nil {
			s.log.Warn("idle context compaction did not finish before service close", "thread_id", compaction.threadID, "request_id", compaction.requestID)
		}
	}
	s.mu.Lock()
	if s.threadsDB == ts {
		s.threadsDB = nil
	}
	s.runs = make(map[string]*run)
	s.activeRunByTh = make(map[string]string)
	s.stopFinalizingByTh = make(map[string]string)
	s.subagentRuntimes = make(map[string]*floretSubagentRuntime)
	s.idleCompactionByTh = make(map[string]*idleThreadCompaction)
	s.mu.Unlock()
	for _, runtime := range runtimes {
		runtime.release()
	}
	var floretCloseErr error
	if closeFloret != nil {
		floretCloseErr = closeFloret()
	}
	var threadCloseErr error
	if ts != nil {
		threadCloseErr = ts.Close()
	}
	return errors.Join(terminalCloseErr, floretCloseErr, threadCloseErr)
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
		runtime = newFloretSubagentRuntimeWithExecutionOwner(r, s.bindSubagentExecutionForParent)
		s.subagentRuntimes[thKey] = runtime
	} else {
		runtime.attachParentRun(r)
	}
	return runtime
}

func (s *Service) bindSubagentExecutionForParent(parent *run, childThreadID string, childRunID string) (subagentExecutionCapabilities, error) {
	if s == nil || parent == nil {
		return subagentExecutionCapabilities{}, errors.New("SubAgent execution coordinator is unavailable")
	}
	host, err := s.bindExactRunExecutionCapabilities(parent.endpointID, childThreadID, parent.threadID)
	if err != nil {
		return subagentExecutionCapabilities{}, err
	}
	product, err := bindChildRunProductCapabilities(s.threadsDB, parent.endpointID, parent.threadID, childThreadID, childRunID)
	if err != nil {
		return subagentExecutionCapabilities{}, err
	}
	return subagentExecutionCapabilities{host: host, product: product}, nil
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

func (s *Service) closeThreadSubagents(ctx context.Context, endpointID string, threadID string, timeout time.Duration) error {
	if s == nil {
		return errors.New("nil service")
	}
	thKey := runThreadKey(endpointID, threadID)
	if thKey == "" {
		return errors.New("invalid thread identity")
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
			return runtime.closeAllExisting(closeCtx)
		}
		return s.requireNoUnownedActiveSubagents(closeCtx, threadID)
	}
	if timeout <= 0 {
		timeout = defaultPersistOpTimeout
	}
	closeCtx, cancel := context.WithTimeout(ctxOrBackground(ctx), timeout)
	defer cancel()
	return s.requireNoUnownedActiveSubagents(closeCtx, threadID)
}

func (s *Service) requireNoUnownedActiveSubagents(ctx context.Context, threadID string) error {
	if s == nil {
		return errors.New("nil service")
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return errors.New("missing thread_id")
	}
	host, err := s.openFloretSubagentReadHost(ctx, threadID)
	if err != nil {
		return err
	}
	snapshots, err := host.ListSubAgents(ctx, flruntime.ThreadID(threadID))
	if err != nil {
		return err
	}
	for _, snapshot := range snapshots {
		if snapshot.CanClose && !snapshot.Closed {
			return errors.New("active SubAgent lifecycle owner is unavailable")
		}
	}
	return nil
}

func (s *Service) openFloretThreadReadHost(ctx context.Context, threadID string) (floretThreadReadHost, error) {
	if s == nil || s.floretReads == nil {
		return nil, errors.New("floret read capability not ready")
	}
	return s.floretReads.openThread(ctx, threadID)
}

func (s *Service) openFloretSubagentReadHost(ctx context.Context, parentThreadID string) (floretSubagentReadHost, error) {
	if s == nil || s.floretReads == nil {
		return nil, errors.New("floret SubAgent read capability not ready")
	}
	return s.floretReads.openSubagent(ctx, parentThreadID)
}

func (s *Service) bindFloretThreadRuntime(threadID string) (floretThreadRuntimeCapabilities, error) {
	if s == nil || s.floretRuntime == nil {
		return floretThreadRuntimeCapabilities{}, errors.New("floret thread runtime capability not ready")
	}
	if err := s.requireFloretStartupRecoveryComplete(); err != nil {
		return floretThreadRuntimeCapabilities{}, err
	}
	return s.floretRuntime.bindThread(threadID)
}

func (s *Service) Enabled() bool {
	if s == nil {
		return false
	}
	s.mu.Lock()
	enabled := s.cfg.HasModelProfile() || (s.desktopModelSource != nil && s.desktopModelSource.hasBinding())
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

func (s *Service) UpsertFlowerThreadRouting(ctx context.Context, rec threadstore.FlowerThreadRouting) error {
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
	return db.UpsertFlowerThreadRouting(pctx, rec)
}

func (s *Service) GetFlowerThreadRouting(ctx context.Context, endpointID string, threadID string) (*threadstore.FlowerThreadRouting, error) {
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
	return db.GetFlowerThreadRouting(pctx, endpointID, threadID)
}

func (s *Service) RuntimeStatus(ctx context.Context) *AIRuntimeStatus {
	if s == nil {
		return &AIRuntimeStatus{}
	}
	s.mu.Lock()
	cfg := s.cfg
	modelSource := s.desktopModelSource
	s.mu.Unlock()
	out := &AIRuntimeStatus{RemoteConfigured: cfg.HasModelProfile()}
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
	s.mu.Unlock()
	return nil
}

// SetDefaultPermissionType updates the default permission for future Flower
// threads without changing the environment model profile or active runs.
func (s *Service) SetDefaultPermissionType(permissionType string, persist func(next *config.AIConfig) error) error {
	if s == nil {
		return errors.New("nil service")
	}
	if persist == nil {
		return errors.New("missing persist function")
	}

	permissionType = strings.ToLower(strings.TrimSpace(permissionType))
	switch permissionType {
	case config.AIPermissionReadonly, config.AIPermissionApprovalRequired, config.AIPermissionFullAccess:
	default:
		return fmt.Errorf("invalid ai permission_type %q", permissionType)
	}

	s.mu.Lock()
	next := config.AIConfig{}
	if s.cfg != nil {
		next = *s.cfg
	}
	next.PermissionType = permissionType
	if err := next.Validate(); err != nil {
		s.mu.Unlock()
		return err
	}
	if err := persist(&next); err != nil {
		s.mu.Unlock()
		return err
	}
	s.cfg = &next
	s.mu.Unlock()
	return nil
}

// SetModelProfile replaces the environment model profile while preserving
// Flower defaults and runtime recovery settings. Passing nil clears only the
// model profile.
func (s *Service) SetModelProfile(profile *config.AIModelProfile, persist func(next *config.AIConfig) error) error {
	if s == nil {
		return errors.New("nil service")
	}
	if persist == nil {
		return errors.New("missing persist function")
	}
	if profile != nil {
		if err := profile.Validate(); err != nil {
			return err
		}
	}

	s.mu.Lock()
	next := config.AIConfig{}
	if s.cfg != nil {
		next = *s.cfg
	}
	if profile == nil {
		next.Providers = nil
		next.CurrentModelID = ""
	} else {
		next.Providers = append([]config.AIProvider(nil), profile.Providers...)
		next.CurrentModelID = strings.TrimSpace(profile.CurrentModelID)
	}
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
	s.mu.Unlock()
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
	if !cfg.HasModelProfile() && (modelSource == nil || !modelSource.hasBinding()) {
		s.mu.Unlock()
		return ErrNotConfigured
	}
	if cfg.HasModelProfile() && cfg.IsAllowedModelID(modelID) {
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
		s.mu.Unlock()
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
	s.mu.Unlock()
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

func (s *Service) stopFinalizingRunID(endpointID string, threadID string) string {
	if s == nil {
		return ""
	}
	k := runThreadKey(endpointID, threadID)
	if k == "" {
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return strings.TrimSpace(s.stopFinalizingByTh[k])
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
	if !cfg.HasModelProfile() && (modelSource == nil || !modelSource.hasBinding()) {
		return nil, ErrNotConfigured
	}

	out := NewModelsResponse(s.RuntimeStatus(context.Background()))
	configModels, currentModelID, err := configModelViews(cfg)
	if err != nil && cfg.HasModelProfile() {
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
		if sourceErr != nil && !cfg.HasModelProfile() {
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
				capability := desktopModelSourceModelCapability(m)
				model := Model{
					ID:                  modelID,
					Label:               label,
					Source:              modelSourceDesktopModelSource,
					SourceLabel:         modelSourceDesktopModelSourceLabel,
					ContextWindow:       capability.MaxContextTokens,
					MaxOutputTokens:     capability.MaxOutputTokens,
					InputModalities:     append([]string(nil), m.InputModalities...),
					SupportsImageInput:  capability.SupportsImageInput,
					ReasoningCapability: capability.ReasoningCapability,
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

	if len(out.Models) == 0 && cfg.HasModelProfile() {
		return nil, errors.New("invalid ai config: missing models")
	}

	return out, nil
}

func configModelViews(cfg *config.AIConfig) ([]Model, string, error) {
	if !cfg.HasModelProfile() {
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
	_, ok, err := s.desktopModelSourceModel(ctx, modelID)
	return ok, err
}

func (s *Service) desktopModelSourceModel(ctx context.Context, modelID string) (DesktopModelSourceModel, bool, error) {
	if s == nil {
		return DesktopModelSourceModel{}, false, ErrNotConfigured
	}
	if !isDesktopModelSourceModelID(modelID) {
		return DesktopModelSourceModel{}, false, nil
	}
	s.mu.Lock()
	modelSource := s.desktopModelSource
	s.mu.Unlock()
	if modelSource == nil {
		return DesktopModelSourceModel{}, false, nil
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
		return DesktopModelSourceModel{}, false, err
	}
	model, ok := desktopModelSourceSnapshotModel(snapshot, modelID)
	return model, ok, nil
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

func newTurnID() (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "turn_" + base64.RawURLEncoding.EncodeToString(b), nil
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
	runID                        string
	startedAtUnixMs              int64
	channelID                    string
	endpointID                   string
	threadID                     string
	thKey                        string
	threadModelID                string
	threadReasoningSelectionJSON string
	cfg                          *config.AIConfig
	uploadsDir                   string
	persistTO                    time.Duration
	db                           *threadstore.Store
	turnID                       string
	messageID                    string
	r                            *run
}

func (s *Service) StartRun(ctx context.Context, meta *session.Meta, runID string, req RunStartRequest, w http.ResponseWriter) error {
	if ctx == nil {
		ctx = context.Background()
	}
	prepared, err := s.prepareRun(meta, runID, req, w)
	if err != nil {
		return err
	}
	return s.executePreparedRun(ctx, prepared)
}

func (s *Service) StartRunDetached(meta *session.Meta, runID string, req RunStartRequest) error {
	prepared, err := s.prepareRun(meta, runID, req, nil)
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

func (s *Service) startUserTurnDetached(ctx context.Context, meta *session.Meta, runID string, req RunStartRequest, sourceFollowupID string) (admittedUserTurn, RunInput, error) {
	if s == nil {
		return admittedUserTurn{}, req.Input, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return admittedUserTurn{}, req.Input, err
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID := strings.TrimSpace(req.ThreadID)
	if endpointID == "" || threadID == "" {
		return admittedUserTurn{}, req.Input, errors.New("invalid request")
	}

	preparedUser, normalizedInput, err := s.prepareUserTurn(ctx, meta, endpointID, threadID, req.Input)
	if err != nil {
		return admittedUserTurn{}, req.Input, err
	}
	req.Input = normalizedInput
	prepared, err := s.prepareRun(meta, runID, req, nil)
	if err != nil {
		return admittedUserTurn{}, normalizedInput, err
	}
	sourceID := strings.TrimSpace(sourceFollowupID)
	commandID := ""
	if sourceID != "" {
		pctx, cancel := context.WithTimeout(ctx, prepared.persistTO)
		source, sourceErr := prepared.db.GetQueuedTurn(pctx, endpointID, threadID, sourceID)
		cancel()
		if sourceErr != nil && !errors.Is(sourceErr, sql.ErrNoRows) {
			s.releasePreparedRun(prepared)
			return admittedUserTurn{}, normalizedInput, sourceErr
		}
		if source != nil && strings.TrimSpace(source.TurnID) == prepared.turnID && strings.TrimSpace(source.RunID) == runID {
			if source.AdmissionState != threadstore.PendingTurnAdmissionReady {
				s.releasePreparedRun(prepared)
				return admittedUserTurn{}, normalizedInput, threadstore.ErrPendingTurnAdmissionInProgress
			}
			commandID = sourceID
		}
	}
	if commandID == "" {
		commandID, err = NewQueuedTurnID()
		if err != nil {
			s.releasePreparedRun(prepared)
			return admittedUserTurn{}, normalizedInput, err
		}
		contextActionJSON, marshalErr := marshalQueuedTurnContextAction(normalizedInput.ContextAction)
		if marshalErr != nil {
			s.releasePreparedRun(prepared)
			return admittedUserTurn{}, normalizedInput, marshalErr
		}
		attachmentsJSON, marshalErr := marshalQueuedTurnAttachments(normalizedInput.Attachments)
		if marshalErr != nil {
			s.releasePreparedRun(prepared)
			return admittedUserTurn{}, normalizedInput, marshalErr
		}
		optionsJSON, marshalErr := marshalQueuedTurnOptions(req.Options)
		if marshalErr != nil {
			s.releasePreparedRun(prepared)
			return admittedUserTurn{}, normalizedInput, marshalErr
		}
		sessionMetaJSON, marshalErr := marshalQueuedTurnSessionMeta(meta)
		if marshalErr != nil {
			s.releasePreparedRun(prepared)
			return admittedUserTurn{}, normalizedInput, marshalErr
		}
		record := threadstore.QueuedTurn{
			QueueID: commandID, EndpointID: endpointID, ThreadID: threadID,
			ChannelID: strings.TrimSpace(meta.ChannelID), Lane: threadstore.FollowupLaneQueued,
			TurnID: prepared.turnID, RunID: runID, ModelID: strings.TrimSpace(req.Model),
			TextContent: strings.TrimSpace(normalizedInput.Text), AttachmentsJSON: attachmentsJSON,
			ContextActionJSON: contextActionJSON, OptionsJSON: optionsJSON, SessionMetaJSON: sessionMetaJSON,
			CreatedByUserPublicID: strings.TrimSpace(meta.UserPublicID), CreatedByUserEmail: strings.TrimSpace(meta.UserEmail),
			CreatedAtUnixMs: preparedUser.CreatedAtUnixMs,
		}
		pctx, cancel := context.WithTimeout(ctx, prepared.persistTO)
		if sourceID != "" {
			replacement, replaceErr := prepared.db.ReplaceFollowupWithUploadRefs(pctx, sourceID, record, preparedUser.UploadIDs, preparedUser.CreatedAtUnixMs)
			cancel()
			if replaceErr != nil {
				s.releasePreparedRun(prepared)
				return admittedUserTurn{}, normalizedInput, replaceErr
			}
			if _, cleanupErr := s.processUploadCleanupCandidates(ctx, replacement.UploadsToDelete); cleanupErr != nil && s.log != nil {
				s.log.Warn("pending turn replacement physical cleanup deferred", "thread_id", threadID, "source_followup_id", sourceID, "error", cleanupErr)
			}
		} else {
			_, _, _, err = prepared.db.CreateFollowupWithUploadRefs(pctx, record, preparedUser.UploadIDs, preparedUser.CreatedAtUnixMs)
			cancel()
			if err != nil {
				s.releasePreparedRun(prepared)
				return admittedUserTurn{}, normalizedInput, err
			}
		}
	}

	pctx, cancel := context.WithTimeout(ctx, prepared.persistTO)
	err = prepared.db.BeginPendingTurnAdmission(pctx, endpointID, threadID, commandID, prepared.turnID, runID)
	cancel()
	if err != nil {
		s.releasePreparedRun(prepared)
		return admittedUserTurn{}, normalizedInput, err
	}
	prepared.r.setPendingTurnCommand(commandID)
	s.broadcastThreadState(endpointID, threadID, runID, string(RunStateRunning), "", "")
	s.broadcastThreadSummary(endpointID, threadID)
	go func() {
		runErr := s.executePreparedRun(context.Background(), prepared)
		prepared.r.completeUserTurnAdmissionAfterExecution(runErr)
		if runErr != nil {
			if s.log != nil {
				s.log.Warn("ai detached run failed", "run_id", runID, "thread_id", threadID, "error", runErr)
			}
		}
	}()
	admitted, err := prepared.r.waitForUserTurnAdmission(ctx)
	if err != nil {
		return admittedUserTurn{}, normalizedInput, err
	}
	return admitted, normalizedInput, nil
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

func (s *Service) prepareRun(meta *session.Meta, runID string, req RunStartRequest, w http.ResponseWriter) (*preparedRun, error) {
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
	baseToolTargetPolicy := s.toolTargetPolicy
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	if s.threadMgr == nil {
		return nil, errors.New("thread manager not ready")
	}
	unlockLifecycle, err := s.threadMgr.lockThreadLifecycle(endpointID, threadID)
	if err != nil {
		return nil, err
	}
	defer unlockLifecycle()

	pctx, cancelPersist := context.WithTimeout(context.Background(), persistTO)
	err = db.RequireThreadSettingsWritable(pctx, endpointID, threadID)
	cancelPersist()
	if err != nil {
		return nil, err
	}

	pctx, cancelPersist = context.WithTimeout(context.Background(), persistTO)
	th, err := db.GetThreadSettings(pctx, endpointID, threadID)
	cancelPersist()
	if err != nil {
		return nil, err
	}
	if th == nil {
		return nil, errors.New("thread not found")
	}
	threadPermission, err := threadPermissionType(th)
	if err != nil {
		return nil, err
	}
	var routing *threadstore.FlowerThreadRouting
	pctx, cancelPersist = context.WithTimeout(context.Background(), persistTO)
	routing, err = db.GetFlowerThreadRouting(pctx, endpointID, threadID)
	cancelPersist()
	if err != nil {
		return nil, err
	}
	toolTargetPolicy := normalizeToolTargetPolicy(baseToolTargetPolicy)
	if toolTargetPolicyForRun != nil {
		toolTargetPolicy = normalizeToolTargetPolicy(toolTargetPolicyForRun(metaRef, *th, routing))
	}
	var canonicalReferenceAuthority *flowerCanonicalReferenceTargetAuthority
	if req.Input.ContextAction != nil {
		resolvedAuthority, authorityErr := resolveFlowerCanonicalReferenceTargetAuthority(endpointID, toolTargetPolicy, routing)
		if authorityErr != nil {
			return nil, authorityErr
		}
		canonicalReferenceAuthority = &resolvedAuthority
		if err := authorizeFlowerContextActionTarget(req.Input.ContextAction, resolvedAuthority); err != nil {
			return nil, err
		}
		req.Input.ContextAction = canonicalizeFlowerContextActionTarget(req.Input.ContextAction, resolvedAuthority)
	}

	runWorkingDir, err := threadWorkingDir(th)
	if err != nil {
		return nil, err
	}
	floretRuntime, err := s.bindFloretThreadRuntime(threadID)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	if !s.cfg.HasModelProfile() && (s.desktopModelSource == nil || !s.desktopModelSource.hasBinding()) {
		s.mu.Unlock()
		return nil, ErrNotConfigured
	}
	thKey := runThreadKey(endpointID, threadID)
	if thKey == "" {
		s.mu.Unlock()
		return nil, errors.New("invalid request")
	}
	if existing := strings.TrimSpace(s.activeRunByTh[thKey]); existing != "" {
		if s.runs[existing] == nil {
			s.mu.Unlock()
			reconcileCtx, reconcileCancel := context.WithTimeout(context.Background(), persistTO)
			_, reconcileErr := s.reconcileStaleActiveRun(reconcileCtx, endpointID, threadID, existing)
			reconcileCancel()
			if reconcileErr != nil {
				return nil, reconcileErr
			}
			s.mu.Lock()
			existing = strings.TrimSpace(s.activeRunByTh[thKey])
			if existing == "" {
				// The stale mapping was removed after canonical non-busy proof.
			} else {
				s.mu.Unlock()
				return nil, ErrThreadBusy
			}
		} else {
			s.mu.Unlock()
			return nil, ErrThreadBusy
		}
	}
	if existing := strings.TrimSpace(s.activeRunByTh[thKey]); existing != "" {
		s.mu.Unlock()
		return nil, ErrThreadBusy
	}
	if existing := strings.TrimSpace(s.stopFinalizingByTh[thKey]); existing != "" {
		s.mu.Unlock()
		return nil, ErrThreadBusy
	}
	if existing := s.idleCompactionByTh[thKey]; existing != nil && existing.busy() {
		s.mu.Unlock()
		return nil, ErrThreadBusy
	}
	cfg := s.cfg
	desktopModelSource := s.desktopModelSource
	req.Options.PermissionType = permissionTypeString(threadPermission)
	uploadsDir := s.uploadsDir
	db = s.threadsDB
	turnID, err := normalizeOrCreateTurnID(req.Input.TurnID)
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}
	req.Input.TurnID = turnID
	finalizingThreadStatePublished := false
	runHost, err := s.bindRunHostCapabilities(endpointID, threadID)
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}
	productCapabilities, err := bindRootRunProductCapabilities(db, endpointID, threadID, runID)
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}
	r := newRun(runOptions{
		Log:                         s.log,
		StateDir:                    s.stateDir,
		AgentHomeDir:                s.agentHomeDir,
		WorkingDir:                  runWorkingDir,
		FilesystemScope:             s.scope,
		Shell:                       s.shell,
		HostCapabilities:            runHost,
		AIConfig:                    cfg,
		SessionMeta:                 metaRef,
		ResolveProviderKey:          s.resolveProviderKey,
		ResolveWebSearchKey:         s.resolveWebSearchKey,
		DesktopModelSource:          desktopModelSource,
		RunID:                       runID,
		ChannelID:                   channelID,
		EndpointID:                  endpointID,
		ThreadID:                    threadID,
		TurnID:                      turnID,
		MaxWallTime:                 s.runMaxWallTime,
		IdleTimeout:                 s.runIdleTimeout,
		ToolApprovalTimeout:         s.approvalTimeout,
		StreamWriteTimeout:          s.streamWriteTO,
		UserPublicID:                strings.TrimSpace(metaRef.UserPublicID),
		MessageID:                   turnID,
		UploadsDir:                  uploadsDir,
		ProductCapabilities:         productCapabilities,
		FloretHostFactory:           floretRuntime.Turn,
		FloretCompactionHostFactory: floretRuntime.Compaction,
		FloretSubagentHostFactory:   floretRuntime.SubAgent,
		PersistOpTimeout:            persistTO,
		SkillManager:                s.skillManager,
		ToolAllowlist:               append([]string(nil), req.Options.ToolAllowlist...),
		NoUserInteraction:           req.Options.NoUserInteraction,
		ToolTargetPolicy:            toolTargetPolicy,
		CanonicalReferenceAuthority: canonicalReferenceAuthority,
		TargetToolExecutor:          s.targetToolExecutor,
		OnStreamEvent: func(ev any) {
			if !finalizingThreadStatePublished && isFinalizingLifecycleStreamEvent(ev) {
				finalizingThreadStatePublished = true
				s.broadcastThreadState(endpointID, threadID, runID, string(RunStateFinalizing), "", "")
				s.broadcastThreadSummary(endpointID, threadID)
			}
			s.broadcastStreamEvent(endpointID, threadID, turnID, runID, ev)
		},
		Writer: w,
	})
	r.awaitFloretAdmission.Store(true)
	r.subagentRuntime = s.ensureThreadSubagentRuntimeLocked(thKey, r)
	s.activeRunByTh[thKey] = runID
	s.runs[runID] = r
	s.mu.Unlock()

	s.broadcastThreadState(endpointID, threadID, runID, "running", "", "")
	s.broadcastThreadSummary(endpointID, threadID)
	r.updateModelIOStatus(FlowerModelIOPhasePreparing, 0)

	return &preparedRun{
		meta:                         metaRef,
		req:                          req,
		runID:                        runID,
		startedAtUnixMs:              time.Now().UnixMilli(),
		channelID:                    channelID,
		endpointID:                   endpointID,
		threadID:                     threadID,
		thKey:                        thKey,
		threadModelID:                strings.TrimSpace(th.ModelID),
		threadReasoningSelectionJSON: strings.TrimSpace(th.ReasoningSelectionJSON),
		cfg:                          cfg,
		uploadsDir:                   uploadsDir,
		persistTO:                    persistTO,
		db:                           db,
		turnID:                       turnID,
		messageID:                    turnID,
		r:                            r,
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
		r.sendStreamEvent(streamEventError{Type: "error", MessageID: messageID, Error: msg})
		r.setEndReason("error")
		return err
	}

	engineRunStarted := false

	defer func() {
		r.reconcilePendingTurnCommand()
		s.mu.Lock()
		stopping := strings.TrimSpace(s.stopFinalizingByTh[thKey]) == runID
		if !stopping {
			delete(s.runs, runID)
		}
		if !stopping && strings.TrimSpace(s.activeRunByTh[thKey]) == runID {
			delete(s.activeRunByTh, thKey)
		}
		s.mu.Unlock()
		r.markDone()

		if r.isDetached() {
			return
		}
		runStatus, runStatusErrCode, runStatusErr := deriveThreadRunState(r.getEndReason(), r.getFinalizationReason(), r.getRunErrorCode(), retErr)
		if !engineRunStarted {
			eventType := "run.error"
			switch NormalizeRunState(runStatus) {
			case RunStateSuccess, RunStateWaitingUser, RunStateCanceled:
				eventType = "run.end"
			}
			r.recordRunDiagnostic(eventType, RealtimeStreamKindLifecycle, map[string]any{
				"state":      runStatus,
				"error_code": runStatusErrCode,
				"error":      runStatusErr,
			})
		}
		s.broadcastThreadState(endpointID, threadID, runID, runStatus, runStatusErrCode, runStatusErr)
		s.broadcastThreadSummary(endpointID, threadID)
		if s.threadMgr != nil {
			s.threadMgr.Wake(endpointID, threadID)
		}
	}()

	resolvedModel, err := s.resolveRunModel(ctx, cfg, req.Model, prepared.threadModelID, r)
	if err != nil {
		return streamEarlyError(err)
	}
	model := resolvedModel.ID
	modelCapability := resolvedModel.Capability
	reasoningCapability, modelDefaultReasoning := modelReasoningDefaultsFromCapability(modelCapability)
	threadDefaultReasoning, err := parseStoredReasoningSelection(prepared.threadReasoningSelectionJSON)
	if err != nil {
		return streamEarlyError(err)
	}
	reasoning, err := resolveEffectiveReasoning(reasoningCapability, req.Options.ReasoningSelection, threadDefaultReasoning, modelDefaultReasoning)
	if err != nil {
		return streamEarlyError(reasoningSelectionError(model, err))
	}
	req.Options.ReasoningSelection = reasoning.Effective
	r.currentReasoning = reasoning.Effective
	r.recordRunDiagnostic("reasoning.selection.normalized", RealtimeStreamKindLifecycle, map[string]any{
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
		if strings.TrimSpace(prepared.threadModelID) == "" && strings.TrimSpace(req.Model) == "" {
			_ = db.UpdateThreadModelID(pctx, endpointID, threadID, model)
			prepared.threadModelID = model
		}
		cancel()
	}

	runReq := RunRequest{
		Model:           model,
		Input:           req.Input,
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

	if r.isDetached() {
		return finalErr
	}

	s.broadcastThreadSummary(endpointID, threadID)
	return finalErr
}

func (s *Service) resolveRunModel(ctx context.Context, cfg *config.AIConfig, requestedModel string, threadModelID string, r *run) (resolvedRunModel, error) {
	model := ""
	requestedModel = strings.TrimSpace(requestedModel)
	threadModelID = strings.TrimSpace(threadModelID)
	model = requestedModel
	if model == "" {
		model = threadModelID
	}
	if model == "" && s != nil {
		if id, ok := s.resolvedDesktopModelSourceOverrideModel(ctx); ok {
			model = id
		}
	}
	if model == "" && s != nil {
		if id, ok := s.resolvedDesktopModelSourceDefaultModel(ctx); ok {
			model = id
		}
	}
	if model == "" && cfg.HasModelProfile() {
		if id := strings.TrimSpace(cfg.CurrentModelID); id != "" && cfg.IsAllowedModelID(id) {
			model = id
		}
	}
	if model == "" {
		return resolvedRunModel{}, errors.New("missing model")
	}
	providerID, modelName := "", ""
	desktopModelSourceModelID := ""
	var desktopModelSourceModel *DesktopModelSourceModel
	var providerCfg config.AIProvider
	if isDesktopModelSourceModelID(model) {
		if s == nil {
			return resolvedRunModel{}, ErrNotConfigured
		}
		resolvedDesktopModel, allowed, err := s.desktopModelSourceModel(ctx, model)
		if err != nil {
			return resolvedRunModel{}, err
		}
		if !allowed {
			return resolvedRunModel{}, fmt.Errorf("model not allowed: %s", model)
		}
		providerID = DesktopModelSourceProviderType
		modelName = model
		desktopModelSourceModelID = model
		desktopModelSourceModel = &resolvedDesktopModel
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
		if !cfg.HasModelProfile() {
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
	if desktopModelSourceModel != nil {
		modelCapability = desktopModelSourceModelCapability(*desktopModelSourceModel)
	} else if s != nil && s.capabilityResolver != nil {
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
	threadID := ""
	s.mu.Lock()
	if r := s.runs[runID]; r != nil {
		if strings.TrimSpace(r.endpointID) != endpointID {
			s.mu.Unlock()
			return nil
		}
		threadID = strings.TrimSpace(r.threadID)
	}
	prefix := endpointID + ":"
	if threadID == "" {
		for key, candidate := range s.activeRunByTh {
			if strings.TrimSpace(candidate) == runID && strings.HasPrefix(key, prefix) {
				threadID = strings.TrimPrefix(key, prefix)
				break
			}
		}
	}
	if threadID == "" {
		for key, candidate := range s.stopFinalizingByTh {
			if strings.TrimSpace(candidate) == runID && strings.HasPrefix(key, prefix) {
				threadID = strings.TrimPrefix(key, prefix)
				break
			}
		}
	}
	s.mu.Unlock()
	if threadID == "" {
		return nil
	}
	_, err := s.stopThreadWithExpectedRunID(context.Background(), meta, threadID, runID)
	if errors.Is(err, errStopRunNotActive) || errors.Is(err, ErrThreadStopPending) {
		return nil
	}
	return err
}
