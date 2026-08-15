package ai

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/floegence/floret/v4/identity"
	flruntime "github.com/floegence/floret/v4/runtime"
	contextadapter "github.com/floegence/redeven/internal/ai/context/adapter"
	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	contextstore "github.com/floegence/redeven/internal/ai/context/store"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/logsafe"
	"github.com/floegence/redeven/internal/pathutil"
	"github.com/floegence/redeven/internal/runtimeservice"
	"github.com/floegence/redeven/internal/session"
)

var (
	ErrNotConfigured         = errors.New("ai not configured")
	ErrRunActive             = errors.New("run already active")
	ErrThreadBusy            = errors.New("thread already active")
	ErrThreadForkUnavailable = errors.New("thread cannot be forked while active or waiting")
	ErrUserTurnNotAdmitted   = errors.New("user turn was not admitted by Floret")
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
	StoreStartupProgress   func(FloretStoreStartupPhase)
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

	mu sync.Mutex

	typedSendMu  sync.Mutex
	typedSendOps map[string]*typedSendOperation

	flowerLiveSubscriberSeq         uint64
	flowerLiveSubscribersByEndpoint map[string]int
	flowerLiveSubscribers           map[uint64]*flowerLiveSubscriber
	flowerLiveQueuedBytes           int
	flowerLiveMetrics               flowerLiveMetrics

	uploadsDir string
	threadsDB  *threadstore.Store

	closeFloret            func() error
	threadRuntime          flruntime.ThreadService
	floretEffects          *floretEffectAdapter
	orphanMu               sync.Mutex
	orphanCanonicalRootIDs map[string]struct{}

	capabilityResolver *contextadapter.Resolver
	skillManager       *skillManager
	terminalProcesses  *terminalProcessManager

	flowerReadStateCleaner FlowerReadStateCleaner
	maintenanceStopCh      chan struct{}
	maintenanceDoneCh      chan struct{}
	compactionScheduled    bool
	lifecycleCtx           context.Context
	lifecycleCancel        context.CancelFunc
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
	return NewServiceContext(context.Background(), opts)
}

func NewServiceContext(ctx context.Context, opts Options) (*Service, error) {
	if ctx == nil {
		return nil, errors.New("AI service startup context is required")
	}
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
	floretBootstrap, err := openFloretRuntime(ctx, floretStorePath, opts.StoreStartupProgress)
	if err != nil {
		return nil, err
	}
	threadsPath := filepath.Join(strings.TrimSpace(opts.StateDir), "ai", "threads.sqlite")
	ts, err := threadstore.Open(threadsPath)
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
		log:                             logger,
		stateDir:                        strings.TrimSpace(opts.StateDir),
		agentHomeDir:                    agentHomeDir,
		scope:                           scope,
		shell:                           strings.TrimSpace(opts.Shell),
		cfg:                             opts.Config,
		desktopModelSource:              newDesktopModelSourceClient(logger),
		persistOpTO:                     persistTO,
		runMaxWallTime:                  maxWall,
		runIdleTimeout:                  idleTO,
		approvalTimeout:                 approvalTO,
		streamWriteTO:                   streamWTO,
		resolveProviderKey:              resolveProviderKey,
		resolveWebSearchKey:             resolveWebSearchKey,
		toolTargetPolicy:                toolTargetPolicy,
		targetToolExecutor:              opts.TargetToolExecutor,
		toolTargetPolicyForRun:          opts.ToolTargetPolicyForRun,
		flowerLiveSubscribersByEndpoint: make(map[string]int),
		flowerLiveSubscribers:           make(map[uint64]*flowerLiveSubscriber),
		uploadsDir:                      uploadsDir,
		threadsDB:                       ts,
		closeFloret:                     floretBootstrap.close,
		threadRuntime:                   floretBootstrap.threadRuntime,
		floretEffects:                   floretBootstrap.effects,
		orphanCanonicalRootIDs:          make(map[string]struct{}),
		capabilityResolver:              capabilityResolver,
		skillManager:                    newSkillManager(agentHomeDir, strings.TrimSpace(opts.StateDir)),
		flowerReadStateCleaner:          opts.FlowerReadStateCleaner,
		maintenanceStopCh:               make(chan struct{}),
		maintenanceDoneCh:               make(chan struct{}),
		lifecycleCtx:                    lifecycleCtx,
		lifecycleCancel:                 lifecycleCancel,
	}
	svc.terminalProcesses = newTerminalProcessManager()
	if svc.skillManager != nil {
		svc.skillManager.Discover()
	}
	svc.typedSendOps = make(map[string]*typedSendOperation)
	svc.floretEffects.bind(svc)
	if err := svc.importPendingInputs(ctx); err != nil {
		closeServiceBeforeMaintenance(svc)
		return nil, fmt.Errorf("import pending inputs: %w", err)
	}
	svc.startFlowerRuntimeViewPump()
	uploadRecoveryCtx, cancelUploadRecovery := context.WithTimeout(ctx, persistTO)
	interruptedUploads, uploadRecoveryErr := svc.interruptUploadAttemptsFromPreviousProcess(uploadRecoveryCtx)
	cancelUploadRecovery()
	if uploadRecoveryErr != nil {
		closeServiceBeforeMaintenance(svc)
		return nil, fmt.Errorf("recover interrupted uploads: %w", uploadRecoveryErr)
	}
	if interruptedUploads > 0 {
		logger.Info("ai: interrupted upload recovery completed", "count", interruptedUploads)
	}
	svc.startBackgroundMaintenance()
	return svc, nil
}

func closeServiceBeforeMaintenance(s *Service) {
	if s == nil {
		return
	}
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

func (s *Service) startFlowerRuntimeViewPump() {
	if s == nil || s.threadRuntime == nil || s.lifecycleCtx == nil {
		return
	}
	subscription, err := s.threadRuntime.Subscribe(s.lifecycleCtx)
	if err != nil {
		if s.log != nil {
			s.log.Error("ai: subscribe to Floret thread runtime", "error", err)
		}
		return
	}
	go func() {
		defer subscription.Close()
		for {
			current, nextErr := subscription.Next(s.lifecycleCtx)
			if nextErr != nil {
				if !errors.Is(nextErr, context.Canceled) && !errors.Is(nextErr, flruntime.ErrHostClosed) && s.log != nil {
					s.log.Warn("ai: Floret thread runtime subscription stopped", "error", nextErr)
				}
				return
			}
			threadID := strings.TrimSpace(current.ThreadID.String())
			if threadID == "" || s.threadsDB == nil {
				continue
			}
			lookupCtx, cancel := context.WithTimeout(s.lifecycleCtx, s.persistTimeout())
			settings, lookupErr := s.threadsDB.GetThreadSettingsByCanonicalThreadID(lookupCtx, threadID)
			cancel()
			if lookupErr != nil {
				if s.log != nil && !errors.Is(lookupErr, context.Canceled) {
					s.log.Warn("ai: resolve Flower runtime view owner", "thread_id", logsafe.Text(threadID, 256), "error", lookupErr)
				}
				continue
			}
			if settings == nil {
				continue
			}
			s.publishFlowerRuntimeCurrent(strings.TrimSpace(settings.EndpointID), current)
		}
	}()
}

func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	terminalProcesses := s.terminalProcesses
	s.terminalProcesses = nil
	ts := s.threadsDB
	closeFloret := s.closeFloret
	s.closeFloret = nil
	closeFlowerLiveSubscribersLocked(s)
	s.flowerLiveSubscribersByEndpoint = make(map[string]int)
	s.flowerLiveSubscribers = make(map[uint64]*flowerLiveSubscriber)
	maintenanceStopCh := s.maintenanceStopCh
	maintenanceDoneCh := s.maintenanceDoneCh
	lifecycleCancel := s.lifecycleCancel
	s.maintenanceStopCh = nil
	s.maintenanceDoneCh = nil
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
	if maintenanceDoneCh != nil {
		<-maintenanceDoneCh
	}
	s.mu.Lock()
	if s.threadsDB == ts {
		s.threadsDB = nil
	}
	s.mu.Unlock()
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

func (s *Service) closeThreadSubagents(ctx context.Context, endpointID string, threadID string, timeout time.Duration) error {
	if s == nil || s.threadRuntime == nil {
		return errors.New("nil service")
	}
	if runThreadKey(endpointID, threadID) == "" {
		return errors.New("invalid thread identity")
	}
	if timeout <= 0 {
		timeout = defaultPersistOpTimeout
	}
	closeCtx, cancel := context.WithTimeout(ctxOrBackground(ctx), timeout)
	defer cancel()
	parentID := identity.ThreadID(strings.TrimSpace(threadID))
	children, err := s.threadRuntime.List(closeCtx, flruntime.ThreadScope{ParentID: &parentID})
	if err != nil {
		return err
	}
	for _, child := range children {
		if _, err := s.threadRuntime.Cancel(closeCtx, flruntime.CancelInput{
			ThreadID: child.ID, RequestKey: flruntime.RequestKey("parent-close:" + parentID.String() + ":" + child.ID.String()),
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) typedFloretRuntime() (flruntime.ThreadService, error) {
	if s == nil || s.threadRuntime == nil || s.floretEffects == nil {
		return nil, errors.New("floret thread runtime not ready")
	}
	return s.threadRuntime, nil
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
	if s == nil || s.threadRuntime == nil {
		return 0
	}
	endpointID = strings.TrimSpace(endpointID)
	summaries, err := s.threadRuntime.List(context.Background(), flruntime.ThreadScope{})
	if err != nil {
		return 0
	}
	count := 0
	for _, summary := range summaries {
		if summary.Activity != flruntime.ThreadActivityActive {
			continue
		}
		if endpointID != "" {
			if s.threadsDB == nil {
				continue
			}
			settings, settingsErr := s.threadsDB.GetThreadSettings(context.Background(), endpointID, summary.ID.String())
			if settingsErr != nil || settings == nil {
				continue
			}
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

func newToolID() (string, error) {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "tool_" + base64.RawURLEncoding.EncodeToString(b), nil
}

// threadEffect contains only provider/tool preparation inputs for a
// ThreadRuntime-owned command. It cannot register or settle Redeven lifecycle.
type threadEffect struct {
	req                          RunStartRequest
	threadModelID                string
	threadReasoningSelectionJSON string
	cfg                          *config.AIConfig
	builder                      *run
}

func (s *Service) prepareThreadEffect(meta *session.Meta, executionKey string, req RunStartRequest) (*threadEffect, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	executionKey = strings.TrimSpace(executionKey)
	threadID := strings.TrimSpace(req.ThreadID)
	if executionKey == "" || threadID == "" {
		return nil, errors.New("invalid thread effect identity")
	}
	contextAction, err := normalizeAskFlowerContextActionEnvelope(req.Input.ContextAction)
	if err != nil {
		return nil, err
	}
	req.Input.ContextAction = contextAction
	channelID := strings.TrimSpace(meta.ChannelID)
	endpointID := strings.TrimSpace(meta.EndpointID)
	if channelID == "" || endpointID == "" {
		return nil, errors.New("invalid thread effect product scope")
	}
	metaCopy := *meta
	metaRef := &metaCopy

	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	cfg := s.cfg
	desktopModelSource := s.desktopModelSource
	baseToolTargetPolicy := s.toolTargetPolicy
	toolTargetPolicyForRun := s.toolTargetPolicyForRun
	uploadsDir := s.uploadsDir
	targetToolExecutor := s.targetToolExecutor
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	if (cfg == nil || !cfg.HasModelProfile()) && (desktopModelSource == nil || !desktopModelSource.hasBinding()) {
		return nil, ErrNotConfigured
	}
	pctx, cancel := context.WithTimeout(context.Background(), persistTO)
	err = db.RequireThreadSettingsWritable(pctx, endpointID, threadID)
	cancel()
	if err != nil {
		return nil, err
	}
	pctx, cancel = context.WithTimeout(context.Background(), persistTO)
	settings, err := db.GetThreadSettings(pctx, endpointID, threadID)
	cancel()
	if err != nil {
		return nil, err
	}
	if settings == nil {
		return nil, errors.New("thread not found")
	}
	permission, err := threadPermissionType(settings)
	if err != nil {
		return nil, err
	}
	pctx, cancel = context.WithTimeout(context.Background(), persistTO)
	routing, err := db.GetFlowerThreadRouting(pctx, endpointID, threadID)
	cancel()
	if err != nil {
		return nil, err
	}
	toolTargetPolicy := normalizeToolTargetPolicy(baseToolTargetPolicy)
	if toolTargetPolicyForRun != nil {
		toolTargetPolicy = normalizeToolTargetPolicy(toolTargetPolicyForRun(metaRef, *settings, routing))
	}
	var referenceAuthority *flowerCanonicalReferenceTargetAuthority
	if req.Input.ContextAction != nil {
		resolved, resolveErr := resolveFlowerCanonicalReferenceTargetAuthority(endpointID, toolTargetPolicy, routing)
		if resolveErr != nil {
			return nil, resolveErr
		}
		if err := authorizeFlowerContextActionTarget(req.Input.ContextAction, resolved); err != nil {
			return nil, err
		}
		req.Input.ContextAction = canonicalizeFlowerContextActionTarget(req.Input.ContextAction, resolved)
		referenceAuthority = &resolved
	}
	workingDir, err := threadWorkingDir(settings)
	if err != nil {
		return nil, err
	}
	hostCapabilities, err := s.bindRunHostCapabilities(endpointID, threadID)
	if err != nil {
		return nil, err
	}
	productCapabilities, err := bindRootRunProductCapabilities(db, endpointID, threadID)
	if err != nil {
		return nil, err
	}
	req.Options.PermissionType = permissionTypeString(permission)
	builder := newRun(runOptions{
		Log: s.log, StateDir: s.stateDir, AgentHomeDir: s.agentHomeDir,
		WorkingDir: workingDir, FilesystemScope: s.scope, Shell: s.shell,
		HostCapabilities: hostCapabilities, AIConfig: cfg, SessionMeta: metaRef,
		ResolveProviderKey: s.resolveProviderKey, ResolveWebSearchKey: s.resolveWebSearchKey,
		DesktopModelSource: desktopModelSource, ExecutionKey: executionKey,
		ChannelID: channelID, EndpointID: endpointID, ThreadID: threadID,
		UserPublicID: strings.TrimSpace(metaRef.UserPublicID), UploadsDir: uploadsDir,
		ProductCapabilities: productCapabilities,
		FloretThreadRuntime: s.threadRuntime,
		PersistOpTimeout:    persistTO, SkillManager: s.skillManager,
		ToolAllowlist: append([]string(nil), req.Options.ToolAllowlist...), NoUserInteraction: req.Options.NoUserInteraction,
		ToolTargetPolicy: toolTargetPolicy, CanonicalReferenceAuthority: referenceAuthority,
		TargetToolExecutor: targetToolExecutor,
	})
	builder.subagentRuntime = newServiceFloretSubagentRuntime(s, builder)
	return &threadEffect{
		req: req, threadModelID: strings.TrimSpace(settings.ModelID),
		threadReasoningSelectionJSON: strings.TrimSpace(settings.ReasoningSelectionJSON),
		cfg:                          cfg, builder: builder,
	}, nil
}

// buildThreadEffectAgent resolves the provider and product effect surface for
// Floret thread. It resolves product settings and the effect adapter, then
// dispatches directly into ThreadRuntime. It deliberately does not run the
// legacy Redeven lifecycle finalizer, register a run, wait for an admission
// receipt, or wake a legacy thread actor.
func (s *Service) buildThreadEffectAgent(ctx context.Context, effect *threadEffect) (*flruntime.Agent, error) {
	if s == nil || effect == nil || effect.builder == nil {
		return nil, errors.New("invalid typed prepared run")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	r := effect.builder
	resolvedModel, err := s.resolveRunModel(ctx, effect.cfg, effect.req.Model, effect.threadModelID, r)
	if err != nil {
		return nil, err
	}
	model := resolvedModel.ID
	modelCapability := resolvedModel.Capability
	reasoningCapability, modelDefaultReasoning := modelReasoningDefaultsFromCapability(modelCapability)
	threadDefaultReasoning, err := parseStoredReasoningSelection(effect.threadReasoningSelectionJSON)
	if err != nil {
		return nil, err
	}
	reasoning, err := resolveEffectiveReasoning(reasoningCapability, effect.req.Options.ReasoningSelection, threadDefaultReasoning, modelDefaultReasoning)
	if err != nil {
		return nil, reasoningSelectionError(model, err)
	}
	effect.req.Options.ReasoningSelection = reasoning.Effective
	r.currentReasoning = reasoning.Effective
	r.currentModelID = model
	gateway, err := r.resolveModelGatewayForModel(model, strings.TrimSpace(strings.SplitN(model, "/", 2)[0]), true)
	if err != nil {
		return nil, err
	}
	effect.req.Model = model
	preparedAgent, err := r.prepareFloretHostedAgent(ctx, RunRequest{
		Model: model, Input: effect.req.Input, Options: effect.req.Options,
		ModelCapability: modelCapability, Retry: effect.req.Retry,
	}, gateway.provider, gateway.apiKey, strings.TrimSpace(effect.req.Input.Text), gateway.adapterOverride)
	if err != nil {
		return nil, err
	}
	return preparedAgent.agent, nil
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
			r.log.Warn("resolve model capability failed", "model", logsafe.Text(model, 256), "error", logsafe.Error(capErr))
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
