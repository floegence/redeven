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
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	contextadapter "github.com/floegence/redeven/internal/ai/context/adapter"
	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/chatgpt"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/logsafe"
	"github.com/floegence/redeven/internal/pathutil"
	"github.com/floegence/redeven/internal/runtimeservice"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/tessiven"
	"github.com/floegence/redeven/internal/threadreadstate"
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
	ChatGPT                *chatgpt.Client
	PlatformHTTPTransport  func() (http.RoundTripper, error)
	Tessiven               *tessiven.Service
	TessivenResources      *tessiven.ResourceBackend
	Logger                 *slog.Logger
	StateDir               string
	ModelCatalogDir        string
	BuildVersion           string
	DeferExecution         bool
	skipStorageMaintenance bool

	AgentHomeDir    string
	Shell           string
	FilesystemScope *filesystemscope.Registry

	Config *config.AIConfig

	ToolTargetPolicy      ToolTargetPolicy
	TargetToolExecutor    TargetToolExecutor
	TargetResolver        TargetResolver
	InteractionSafetyGate InteractionSafetyGate
	WorkloadAdmission     WorkloadAdmission

	// PersistOpTimeout is the per-operation timeout for threadstore persistence
	// (SQLite reads/writes). It must NOT be tied to a run's overall lifetime, since
	// runs can take much longer than persistence should ever be allowed to block.
	//
	// When zero, it defaults to 10 seconds.
	PersistOpTimeout time.Duration

	// ProviderRequestTimeoutPolicy is enforced by Floret for physical model
	// requests only. Zero fields use the upstream defaults.
	ProviderRequestTimeoutPolicy flruntime.ProviderRequestTimeoutPolicy
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

	FlowerReadStateCleaner   FlowerReadStateCleaner
	StoreStartupProgress     func(FloretStoreStartupPhase)
	StoreStartupWorkProgress func(flruntime.StartupWork)
}

type Service struct {
	openAIConnections      *openAIResponsesPool
	deepSeekImageFiles     *deepSeekImageFileOwners
	chatGPT                *chatgpt.Client
	accountMu              sync.Mutex
	accountTasks           map[string]accountTaskWatch
	accountUnsubscribe     func()
	platformHTTPTransport  func() (http.RoundTripper, error)
	tessiven               *tessiven.Service
	tessivenResources      *tessiven.ResourceBackend
	buildVersion           string
	serviceClosing         bool // guarded by mu; fences background worker admission
	storageGeneration      string
	log                    *slog.Logger
	activationMu           sync.Mutex
	activated              bool
	serviceClosed          bool
	closeOnce              sync.Once
	closeResult            error
	serviceWorkers         sync.WaitGroup
	activateFloret         func(context.Context) error
	floretThreadReadiness  func(context.Context, identity.ThreadID) (flruntime.ThreadReadiness, error)
	prepareFloretThread    func(context.Context, identity.ThreadID) error
	prepareFloretRestore   func(context.Context) (flruntime.RestorePreparation, error)
	readState              *threadreadstate.Store
	skipStorageMaintenance bool

	taskFiles    taskFileManager
	stateDir     string
	agentHomeDir string
	scope        *filesystemscope.Registry
	shell        string

	modelCatalogs            *modelCatalogManager
	cfg                      *config.AIConfig
	desktopModelSource       *desktopModelSourceClient
	platformModelPreferences map[string]platformModelPreference
	platformCatalogs         map[string]*platformCatalogSnapshot

	persistOpTO time.Duration

	providerRequestTimeoutPolicy flruntime.ProviderRequestTimeoutPolicy
	approvalTimeout              time.Duration
	streamWriteTO                time.Duration

	resolveProviderKey  func(providerID string) (string, bool, error)
	resolveWebSearchKey func(providerID string) (string, bool, error)

	toolTargetPolicy      ToolTargetPolicy
	targetToolExecutor    TargetToolExecutor
	targetResolver        TargetResolver
	interactionSafetyGate InteractionSafetyGate

	mu sync.Mutex
	// Each thread serializes settings changes with its own admission boundary.
	threadSettingsLocksMu sync.Mutex
	threadSettingsLocks   map[threadSettingsLockKey]*threadSettingsLock

	typedSendMu  sync.Mutex
	typedSendOps map[string]*typedSendOperation

	workloadMu        sync.Mutex
	workloadAdmission WorkloadAdmission
	workloadLeases    map[string]*aiWorkloadLease

	flowerLiveSubscriberSeq         uint64
	flowerLiveSubscribersByEndpoint map[string]int
	flowerLiveSubscribers           map[uint64]*flowerLiveSubscriber
	flowerRuntimeUpdatesUnavailable bool
	flowerRuntimePumpRunning        bool
	flowerSubagentRefreshPending    map[string]string
	flowerSubagentRefreshWake       chan struct{}
	flowerLiveQueuedBytes           int
	flowerLiveMetrics               flowerLiveMetrics
	flowerThreadSummaryPublisher    *flowerThreadSummaryPublisher
	flowerRuntimeEndpointByThread   map[string]string
	flowerRuntimeParentByThread     map[string]string
	flowerRuntimeRouteKnown         map[string]bool
	flowerSubagentBoundaryByThread  map[string]string

	toolMedia  toolMediaStore
	uploadsDir string
	threadsDB  *threadstore.Store

	closeFloret                func() error
	floretMediaInventory       func(context.Context) (flruntime.MediaInventory, error)
	floretThreadMediaInventory func(context.Context, identity.ThreadID) (flruntime.MediaInventory, error)
	storeStartupProgress       func(FloretStoreStartupPhase)
	threadRuntime              flruntime.ThreadService
	floretEffects              *floretEffectAdapter
	orphanMu                   sync.Mutex
	orphanCanonicalRootIDs     map[string]struct{}

	capabilityResolver *contextadapter.Resolver
	skillManager       *skillManager
	mcpManager         *mcpManager
	terminalProcesses  *terminalProcessManager

	flowerReadStateCleaner    FlowerReadStateCleaner
	maintenanceStopCh         chan struct{}
	maintenanceDoneCh         chan struct{}
	startupPreparationMu      sync.Mutex
	startupPreparationAttempt *serviceRecoveryAttempt
	startupPreparationRun     bool
	startupPreparationReady   bool
	uploadRecoveryMu          sync.Mutex
	uploadRecoveryRunning     bool
	uploadRecoveryReady       bool
	uploadRecoveryAttempt     *serviceRecoveryAttempt
	compactionScheduled       bool
	uploadAttemptPruneCursor  threadstore.UploadAttemptPruneCursor
	executionAuthorityCursor  threadstore.ExecutionAuthorityCursor
	deletedFilesCursor        threadstore.ThreadSettingsRecoveryCursor
	lifecycleCtx              context.Context
	lifecycleCancel           context.CancelFunc
}

// ConnectComputerBrowser exposes the explicit user-authorized browser bridge
// without creating a second executor owner in the HTTP layer.
func (s *Service) ConnectComputerBrowser(ctx context.Context, meta *session.Meta, connection ComputerBrowserConnection) (TargetDescriptor, error) {
	if err := requireRWX(meta); err != nil {
		return TargetDescriptor{}, err
	}
	resolver, ok := s.targetResolver.(interface {
		ConnectBrowser(context.Context, ComputerBrowserConnection) (TargetDescriptor, error)
	})
	if !ok {
		return TargetDescriptor{}, &TargetStartupError{Code: "TARGET_CONNECTION_REQUIRED", Reason: "browser_connection_unavailable"}
	}
	target, err := resolver.ConnectBrowser(ctx, connection)
	if err == nil {
		s.refreshPendingComputerStatus(ctx, meta, target.ID)
	}
	return target, err
}

// ResolveTargetToolAttachment exposes a short-lived target screenshot to the
// authenticated Flower media boundary. The executor remains the sole owner
// of the bytes; Service only provides the runtime access boundary.
func (s *Service) ResolveTargetToolAttachment(ctx context.Context, resourceRef string) ([]byte, error) {
	s.mu.Lock()
	executor := s.targetToolExecutor
	s.mu.Unlock()
	if executor == nil {
		return nil, errors.New("target attachment resolver is unavailable")
	}
	resolver, ok := executor.(TargetToolAttachmentResolver)
	if !ok {
		return nil, errors.New("target attachment resolver is unavailable")
	}
	return resolver.ResolveTargetToolAttachment(ctx, strings.TrimSpace(resourceRef))
}

// ResolveTargetToolAttachmentForThread enforces that a frame was emitted by the
// requested thread and target before expanding its opaque bytes.
func (s *Service) ResolveTargetToolAttachmentForThread(ctx context.Context, meta *session.Meta, threadID, targetID, resourceRef string) ([]byte, error) {
	threadID, targetID, resourceRef = strings.TrimSpace(threadID), strings.TrimSpace(targetID), strings.TrimSpace(resourceRef)
	if threadID == "" || targetID == "" || resourceRef == "" {
		return nil, errors.New("computer frame ownership is invalid")
	}
	current, err := s.authorizeToolMediaThread(ctx, meta, threadID)
	if err != nil {
		return nil, err
	}
	owned := false
	for _, item := range current.Items {
		if item.Activity == nil || item.Activity.Presentation == nil {
			continue
		}
		for _, ref := range item.Activity.Presentation.TargetRefs {
			if ref.Kind == "computer_frame" && ref.ResourceRef == resourceRef && strings.HasPrefix(resourceRef, "computer://"+targetID+"/") {
				owned = true
				break
			}
		}
	}
	// A live sample may have identical bytes to a durable keyframe. Resolve the
	// active sample first so reading it also releases the sampler's backpressure.
	s.mu.Lock()
	resolver, ok := s.targetToolExecutor.(interface {
		ResolveComputerLiveFrame(context.Context, string, string, string) ([]byte, error)
	})
	s.mu.Unlock()
	if ok {
		if body, err := resolver.ResolveComputerLiveFrame(ctx, threadID, targetID, resourceRef); err == nil {
			return body, nil
		}
	}
	if !owned {
		return nil, errors.New("computer frame does not belong to thread target")
	}
	return s.ResolveTargetToolAttachment(ctx, resourceRef)
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

	defaultToolApprovalTO = 10 * time.Minute
	defaultStreamWriteTO  = 5 * time.Second
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
	if err := opts.ProviderRequestTimeoutPolicy.Validate(); err != nil {
		return nil, fmt.Errorf("provider request timeout policy: %w", err)
	}
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
	mcpManager, err := openMCPManager(opts.StateDir)
	if err != nil {
		return nil, err
	}

	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}

	uploadsDir := filepath.Join(strings.TrimSpace(opts.StateDir), "ai", "uploads")
	if !opts.skipStorageMaintenance {
		if err := prepareFlowerStorage(ctx, opts); err != nil {
			return nil, err
		}
	}
	storageGeneration, err := readFlowerStorageGeneration(opts.StateDir)
	if err != nil {
		return nil, flowerStorageError("recovery", "verifying", err)
	}
	if err := os.MkdirAll(uploadsDir, 0o700); err != nil {
		return nil, flowerStorageError("uploads", "opening", err)
	}
	persistTO := opts.PersistOpTimeout
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}

	floretStorePath, err := floretThreadStorePath(opts.StateDir)
	if err != nil {
		return nil, err
	}
	floretBootstrap, err := openFloretRuntime(ctx, floretStorePath, opts.StoreStartupProgress, logger, opts.StoreStartupWorkProgress)
	if err != nil {
		return nil, err
	}
	threadsPath := filepath.Join(strings.TrimSpace(opts.StateDir), "ai", "threads.sqlite")
	ts, err := threadstore.OpenWithPendingInputMigration(
		ctx,
		threadsPath,
		newPendingInputMigrationHandler(floretBootstrap.threadRuntime, floretBootstrap.effects),
	)
	if err != nil {
		return nil, errors.Join(flowerStorageError("product", "migrating", err), flowerGenerationCloseError(floretBootstrap.close()))
	}
	readPath, err := threadreadstate.PreparePath(ctx, opts.StateDir)
	if err != nil {
		return nil, errors.Join(flowerStorageError("read_state", "migrating", err), flowerGenerationCloseError(errors.Join(ts.Close(), floretBootstrap.close())))
	}
	reads, err := threadreadstate.Open(readPath)
	if err != nil {
		return nil, errors.Join(flowerStorageError("read_state", "migrating", err), flowerGenerationCloseError(errors.Join(ts.Close(), floretBootstrap.close())))
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
		return nil, errors.Join(errors.New("explicit target tool policy requires TargetToolExecutor"), flowerGenerationCloseError(errors.Join(reads.Close(), ts.Close(), floretBootstrap.close())))
	}
	approvalTO := opts.ToolApprovalTimeout
	if approvalTO <= 0 {
		approvalTO = defaultToolApprovalTO
	}
	streamWTO := opts.StreamWriteTimeout
	if streamWTO <= 0 {
		streamWTO = defaultStreamWriteTO
	}

	capabilityResolver := contextadapter.NewResolver()

	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	svc := &Service{
		platformHTTPTransport: opts.PlatformHTTPTransport,
		buildVersion:          strings.TrimSpace(opts.BuildVersion),
		tessiven:              opts.Tessiven, tessivenResources: opts.TessivenResources,
		activateFloret:                  floretBootstrap.activate,
		floretThreadReadiness:           floretBootstrap.threadReadiness,
		prepareFloretThread:             floretBootstrap.prepareThread,
		prepareFloretRestore:            floretBootstrap.prepareRestore,
		readState:                       reads,
		storageGeneration:               storageGeneration,
		skipStorageMaintenance:          opts.skipStorageMaintenance,
		log:                             logger,
		stateDir:                        strings.TrimSpace(opts.StateDir),
		agentHomeDir:                    agentHomeDir,
		scope:                           scope,
		shell:                           strings.TrimSpace(opts.Shell),
		cfg:                             opts.Config,
		desktopModelSource:              newDesktopModelSourceClient(logger),
		persistOpTO:                     persistTO,
		providerRequestTimeoutPolicy:    opts.ProviderRequestTimeoutPolicy,
		approvalTimeout:                 approvalTO,
		streamWriteTO:                   streamWTO,
		resolveProviderKey:              resolveProviderKey,
		chatGPT:                         opts.ChatGPT,
		resolveWebSearchKey:             resolveWebSearchKey,
		toolTargetPolicy:                toolTargetPolicy,
		targetToolExecutor:              opts.TargetToolExecutor,
		targetResolver:                  opts.TargetResolver,
		interactionSafetyGate:           opts.InteractionSafetyGate,
		workloadAdmission:               opts.WorkloadAdmission,
		workloadLeases:                  make(map[string]*aiWorkloadLease),
		flowerLiveSubscribersByEndpoint: make(map[string]int),
		flowerLiveSubscribers:           make(map[uint64]*flowerLiveSubscriber),
		flowerRuntimeEndpointByThread:   make(map[string]string),
		flowerRuntimeParentByThread:     make(map[string]string),
		flowerRuntimeRouteKnown:         make(map[string]bool),
		flowerSubagentBoundaryByThread:  make(map[string]string),
		toolMedia:                       newToolMediaStore(filepath.Join(opts.StateDir, "computer", "keyframes")),
		uploadsDir:                      uploadsDir,
		threadsDB:                       ts,
		closeFloret:                     floretBootstrap.close,
		floretMediaInventory:            floretBootstrap.mediaInventory,
		floretThreadMediaInventory:      floretBootstrap.threadMediaInventory,
		storeStartupProgress:            opts.StoreStartupProgress,
		threadRuntime:                   floretBootstrap.threadRuntime,
		floretEffects:                   floretBootstrap.effects,
		orphanCanonicalRootIDs:          make(map[string]struct{}),
		capabilityResolver:              capabilityResolver,
		skillManager:                    newSkillManager(agentHomeDir, strings.TrimSpace(opts.StateDir)),
		mcpManager:                      mcpManager,
		flowerReadStateCleaner:          opts.FlowerReadStateCleaner,
		lifecycleCtx:                    lifecycleCtx,
		lifecycleCancel:                 lifecycleCancel,
	}
	catalogRoot := strings.TrimSpace(opts.ModelCatalogDir)
	if catalogRoot == "" {
		catalogRoot = filepath.Join(opts.StateDir, "runtime", "model-catalog")
	}
	svc.modelCatalogs = newModelCatalogManager(catalogRoot, resolveProviderKey, svc.discoverProviderCatalog, svc.publishModelDirectoryChanged)
	svc.modelCatalogs.configure(opts.Config)
	if svc.chatGPT != nil {
		svc.accountUnsubscribe = svc.chatGPT.Subscribe(func(string) { svc.publishModelDirectoryChanged() })
	}
	// Keep the scheduler alive for the service lifetime. It remains idle while
	// automatic updates are disabled, and a later settings change can therefore
	// take effect without restarting the service.
	svc.serviceWorkers.Add(1)
	go func() { defer svc.serviceWorkers.Done(); svc.modelCatalogs.run(lifecycleCtx) }()
	if opts.ModelCatalogDir != "" {
		svc.serviceWorkers.Add(1)
		go func() { defer svc.serviceWorkers.Done(); svc.runPlatformModelCatalogs(lifecycleCtx) }()
	}
	svc.skillManager.mcpManager = mcpManager
	if computer, ok := opts.TargetToolExecutor.(*ComputerUseRuntime); ok {
		svc.toolMedia = computer.media
		computer.mu.Lock()
		computer.bindings = ts
		computer.mu.Unlock()
		computer.setComputerStatusPublisher(func(status FlowerComputerStatus) {
			lookupCtx, cancel := context.WithTimeout(context.Background(), persistTO)
			defer cancel()
			endpointID, _, err := svc.resolveFlowerRuntimeRoute(lookupCtx, status.ThreadID)
			if err == nil {
				svc.publishFlowerComputerStatus(endpointID, status)
			}
		})
	}
	if svc.flowerReadStateCleaner == nil {
		svc.flowerReadStateCleaner = reads
	}
	svc.flowerThreadSummaryPublisher = newFlowerThreadSummaryPublisher(
		lifecycleCtx,
		persistTO,
		svc.publishCanonicalThreadSummary,
		svc.handleCanonicalThreadSummaryFailure,
	)
	svc.terminalProcesses = newTerminalProcessManager()
	svc.terminalProcesses.SetWorkloadAdmission(opts.WorkloadAdmission)
	if svc.skillManager != nil {
		svc.skillManager.Discover()
	}
	svc.typedSendOps = make(map[string]*typedSendOperation)
	svc.floretEffects.bind(svc)
	if svc.flowerReadStateCleaner == nil {
		svc.flowerReadStateCleaner = reads
	}
	if err := ctx.Err(); err != nil {
		return nil, errors.Join(err, svc.Close())
	}
	if !opts.DeferExecution {
		if err := svc.Activate(ctx); err != nil {
			return nil, errors.Join(err, svc.Close())
		}
	}
	return svc, nil
}

func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	s.closeOnce.Do(func() { s.closeResult = s.closeService() })
	return s.closeResult
}

func (s *Service) closeService() error {
	s.activationMu.Lock()
	defer s.activationMu.Unlock()
	s.serviceClosed = true
	if s.accountUnsubscribe != nil {
		s.accountUnsubscribe()
	}
	s.mu.Lock()
	s.serviceClosing = true
	responsesPool := s.openAIConnections
	terminalProcesses := s.terminalProcesses
	targetExecutor := s.targetToolExecutor
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
	summaryPublisher := s.flowerThreadSummaryPublisher
	s.maintenanceStopCh = nil
	s.maintenanceDoneCh = nil
	s.mu.Unlock()
	responsesPool.Close()
	if lifecycleCancel != nil {
		lifecycleCancel()
	}
	if summaryPublisher != nil {
		summaryPublisher.Close()
	}
	s.releaseAllAIWorkloadLeases()

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
	var targetCloseErr error
	if closer, ok := targetExecutor.(interface{ Close() error }); ok {
		targetCloseErr = closer.Close()
	}
	if maintenanceStopCh != nil {
		close(maintenanceStopCh)
	}
	if maintenanceDoneCh != nil {
		<-maintenanceDoneCh
	}
	s.serviceWorkers.Wait()
	var floretCloseErr error
	if closeFloret != nil {
		floretCloseErr = closeFloret()
	}
	s.mu.Lock()
	if s.threadsDB == ts {
		s.threadsDB = nil
	}
	s.mu.Unlock()
	var threadCloseErr error
	if ts != nil {
		threadCloseErr = ts.Close()
	}
	var readCloseErr error
	if s.readState != nil {
		readCloseErr = s.readState.Close()
	}
	return flowerGenerationCloseError(errors.Join(terminalCloseErr, targetCloseErr, floretCloseErr, threadCloseErr, readCloseErr))
}

func (s *Service) snapshotThreadStore() *threadstore.Store {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.threadsDB
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
	if s == nil {
		return runtimeservice.Binding{State: runtimeservice.BindingStateUnsupported}
	}
	s.mu.Lock()
	modelSource := s.desktopModelSource
	s.mu.Unlock()
	if modelSource == nil {
		return runtimeservice.Binding{State: runtimeservice.BindingStateUnsupported}
	}
	return modelSource.BindingSnapshot()
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
	s.modelCatalogs.configure(next)
	return nil
}

// RefreshModelCatalogConnections follows a committed credential update.
func (s *Service) RefreshModelCatalogConnections() {
	if s == nil {
		return
	}
	s.mu.Lock()
	cfg := s.cfg
	s.mu.Unlock()
	s.modelCatalogs.configure(cfg)
	s.publishModelDirectoryChanged()
}

// SetAutoUpdateModelCatalog persists the user's explicit consent for
// background provider model-catalog requests. Disabling it stops future
// scheduled requests while preserving the last known catalog snapshot.
func (s *Service) SetAutoUpdateModelCatalog(enabled bool, persist func(next *config.AIConfig) error) error {
	if s == nil {
		return errors.New("nil service")
	}
	if persist == nil {
		return errors.New("missing persist function")
	}
	s.mu.Lock()
	next := config.AIConfig{}
	if s.cfg != nil {
		next = *s.cfg
	}
	next.AutoUpdateModelCatalog = &enabled
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
	s.modelCatalogs.configure(&next)
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

// SetComputerUseEnabled updates whether future Flower turns may use browser
// and desktop interaction tools. Existing runs keep their admitted tool
// surface; the setting applies when a new run is prepared.
func (s *Service) SetComputerUseEnabled(enabled bool, persist func(next *config.AIConfig) error) error {
	if s == nil {
		return errors.New("nil service")
	}
	if persist == nil {
		return errors.New("missing persist function")
	}

	s.mu.Lock()
	next := config.AIConfig{}
	if s.cfg != nil {
		next = *s.cfg
	}
	next.ComputerUseEnabled = &enabled
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
	s.modelCatalogs.configure(&next)
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
	s.workloadMu.Lock()
	defer s.workloadMu.Unlock()
	count := 0
	for _, lease := range s.workloadLeases {
		if lease == nil || (endpointID != "" && lease.endpointID != endpointID) {
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
	s.mu.Unlock()
	resolved := s.modelCatalogs.resolve(cfg)
	s.mu.Lock()
	if s.cfg != cfg {
		s.mu.Unlock()
		return errors.New("model configuration changed; select the model again")
	}

	modelSource := s.desktopModelSource
	if !cfg.HasModelProfile() && (modelSource == nil || !modelSource.hasBinding()) {
		s.mu.Unlock()
		return ErrNotConfigured
	}
	if cfg.HasModelProfile() && resolved.IsAllowedModelID(modelID) {
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
	return s.ListModelsForSession(context.Background(), nil)
}

func (s *Service) listModels(cfg *config.AIConfig, sourceSnapshot *DesktopModelSourceModelSnapshot, runtimeStatus *AIRuntimeStatus) (*ModelsResponse, error) {
	if s == nil {
		return nil, ErrNotConfigured
	}
	s.mu.Lock()
	modelSource := s.desktopModelSource
	modelSourceCurrent := ""
	if modelSource != nil {
		modelSourceCurrent = modelSource.CurrentModelID()
	}
	s.mu.Unlock()
	if !cfg.HasModelProfile() && (modelSource == nil || !modelSource.hasBinding()) {
		return nil, ErrNotConfigured
	}
	out := NewModelsResponse(runtimeStatus)
	out.Runtime.RemoteConfigured = cfg.HasModelProfile()
	configModels, currentModelID, err := configModelViews(cfg)
	if err != nil && cfg.HasModelProfile() {
		return nil, err
	}
	if cfg != nil {
		for _, provider := range cfg.Providers {
			if !provider.IsEnabled() || config.ResolveAIWebSearchPolicy(provider).Source != config.AIWebSearchSourceBrave {
				continue
			}
			configured := false
			if s.resolveWebSearchKey != nil {
				key, found, keyErr := s.resolveWebSearchKey(provider.ID)
				if keyErr != nil {
					return nil, fmt.Errorf("resolve web search credential: %w", keyErr)
				}
				configured = found && strings.TrimSpace(key) != ""
			}
			for i := range configModels {
				if strings.HasPrefix(configModels[i].ID, provider.ID+"/") {
					configModels[i].WebSearch = config.ResolveAIWebSearch(provider, strings.TrimPrefix(configModels[i].ID, provider.ID+"/"), configured).AIWebSearchAvailability
				}
			}
		}
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

	if sourceSnapshot != nil {
		snapshot := sourceSnapshot
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
				WebSearch:           config.AIWebSearchAvailability{Status: "unavailable", Reason: "not_integrated"},
				ID:                  modelID,
				Label:               label,
				BillingSource:       m.BillingSource,
				AliasGroup:          m.AliasGroup,
				Quantization:        m.Quantization,
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
		if !p.IsEnabled() || providerID == "" {
			continue
		}
		pn := strings.TrimSpace(providerNameByID[providerID])
		if pn == "" {
			pn = providerID
		}
		for _, m := range p.EffectiveModels() {
			modelName := strings.TrimSpace(m.ModelName)
			if modelName == "" {
				continue
			}
			id := providerID + "/" + modelName
			if _, ok := seenModel[id]; ok {
				continue
			}
			seenModel[id] = struct{}{}
			models = append(models, configModelView(id, pn+" / "+firstNonEmpty(m.DisplayName, m.WireModelName, modelName), p, m))
		}
	}
	currentModelID := strings.TrimSpace(cfg.CurrentModelID)
	if currentModelID == "" {
		return models, "", nil
	}

	if !cfg.IsAllowedModelID(currentModelID) {
		configured := false
		for _, p := range cfg.Providers {
			if strings.HasPrefix(currentModelID, p.ID+"/") && (p.ModelSelection != nil || !p.IsEnabled() || p.Type == platformGatewayProviderType || slices.ContainsFunc(p.Models, func(m config.AIProviderModel) bool { return currentModelID == p.ID+"/"+m.ModelName })) {
				configured = true
				break
			}
		}
		if !configured {
			return models, "", fmt.Errorf("invalid ai config: current_model_id is not in providers[].models[]: %s", currentModelID)
		}
	}

	return models, currentModelID, nil
}

func configModelView(id string, label string, provider config.AIProvider, m config.AIProviderModel) Model {
	return Model{
		AliasGroup:                modelAliasGroup(provider, m),
		Quantization:              m.Quantization,
		WebSearch:                 config.ResolveAIWebSearch(provider, m.ModelName, false).AIWebSearchAvailability,
		ID:                        strings.TrimSpace(id),
		Label:                     strings.TrimSpace(label),
		BillingSource:             chatGPTBillingSource(provider),
		Source:                    modelSourceRuntimeConfig,
		SourceLabel:               modelSourceRuntimeConfigLabel,
		ContextWindow:             m.EffectiveInputWindowTokens(),
		MaxOutputTokens:           m.MaxOutputTokens,
		InputModalities:           m.NormalizedInputModalities(),
		SupportsImageInput:        m.SupportsImageInput(),
		ReasoningCapability:       m.EffectiveReasoningCapability(provider.Type),
		DefaultReasoningSelection: m.EffectiveDefaultReasoningSelection(provider.Type),
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
	snapshot := modelSource.Snapshot()
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
	turnKind                     flruntime.TurnKind
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
	uploadsDir := s.uploadsDir
	targetToolExecutor := s.targetToolExecutor
	targetResolver := s.targetResolver
	interactionSafetyGate := s.interactionSafetyGate
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	if (cfg == nil || !cfg.HasModelProfile()) && (desktopModelSource == nil || !desktopModelSource.hasBinding()) && !platformSessionAvailable(meta) {
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
	toolTargetPolicy := normalizeToolTargetPolicy(baseToolTargetPolicy)
	var referenceAuthority *flowerCanonicalReferenceTargetAuthority
	if flowerContextActionRequiresCanonicalReferenceAuthority(req.Input.ContextAction) {
		resolved, resolveErr := resolveFlowerCanonicalReferenceTargetAuthority(endpointID, toolTargetPolicy)
		if resolveErr != nil {
			return nil, resolveErr
		}
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
	builder := newRun(runOptions{
		PlatformHTTPTransport: s.platformHTTPTransport,
		TaskFiles:             &s.taskFiles,
		Log:                   s.log, StateDir: s.stateDir, AgentHomeDir: s.agentHomeDir,
		WorkingDir: workingDir, FilesystemScope: s.scope, Shell: s.shell,
		HostCapabilities: hostCapabilities, AIConfig: cfg, SessionMeta: metaRef,
		ResolveProviderKey: s.resolveProviderKey, ResolveWebSearchKey: s.resolveWebSearchKey, ChatGPT: s.chatGPT,
		DesktopModelSource: desktopModelSource, ExecutionKey: executionKey,
		ChannelID: channelID, EndpointID: endpointID, ThreadID: threadID,
		UserPublicID: strings.TrimSpace(metaRef.UserPublicID), UploadsDir: uploadsDir,
		ProductCapabilities: productCapabilities,
		FloretThreadRuntime: s.threadRuntime, ProviderRequestTimeoutPolicy: s.providerRequestTimeoutPolicy,
		PersistOpTimeout: persistTO, SkillManager: s.skillManager, MCPManager: s.mcpManager,
		ToolAllowlist: append([]string(nil), req.Options.ToolAllowlist...), NoUserInteraction: req.Options.NoUserInteraction,
		ToolTargetPolicy: toolTargetPolicy, CanonicalReferenceAuthority: referenceAuthority,
		TargetToolExecutor: targetToolExecutor,
		TargetResolver:     targetResolver, InteractionSafetyGate: interactionSafetyGate,
		PublishComputerFrame: func(frame FlowerComputerFrame) { _ = s.PublishFlowerComputerFrame(metaRef, frame) },
	})
	if strings.TrimSpace(settings.ParentThreadID) != "" {
		builder.subagentDepth = 1
		builder.allowSubagentDelegate = false
	}
	builder.setPermissionState(permission, PermissionSnapshot{})
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
	if desktop, ok := gateway.adapterOverride.(*desktopModelSourceProvider); ok {
		desktop.accountStopped = func() { s.cancelAccountTurn(r.threadID, identity.TurnID(r.turnID)) }
	}
	effect.req.Model = model
	agent, err := r.prepareFloretHostedAgent(ctx, RunRequest{
		Model: model, Input: effect.req.Input, Options: effect.req.Options,
		ModelCapability: modelCapability, Retry: effect.req.Retry, TurnKind: effect.turnKind,
	}, gateway.provider, gateway.apiKey, gateway.adapterOverride)
	if err != nil {
		return nil, err
	}
	if resolvedModel.DesktopModelSourceModelID != "" {
		s.bindDesktopAccountTask(r.threadID, identity.TurnID(r.turnID), resolvedModel.DesktopModelSourceModelID)
	}
	if err := s.bindAccountTask(r.threadID, identity.TurnID(r.turnID), gateway.provider); err != nil {
		return nil, err
	}
	return agent, nil
}

func (s *Service) resolveRunModel(ctx context.Context, cfg *config.AIConfig, requestedModel string, threadModelID string, r *run) (resolvedRunModel, error) {
	model := ""
	requestedModel = strings.TrimSpace(requestedModel)
	threadModelID = strings.TrimSpace(threadModelID)
	if threadModelID != "" {
		if requestedModel != "" && requestedModel != threadModelID {
			return resolvedRunModel{}, ErrThreadModelConflict
		}
		model = threadModelID
	} else {
		model = requestedModel
	}
	if model == "" && s != nil && r != nil {
		if selected := s.sessionSelectedModel(r.sessionMeta, cfg); strings.HasPrefix(selected, "platform/") {
			model = selected
		}
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
	if r != nil {
		var err error
		cfg, err = s.sessionConfigForModel(ctx, r.sessionMeta, cfg, model)
		if err != nil {
			return resolvedRunModel{}, err
		}
	}
	if model == "" && cfg.HasModelProfile() {
		if id := strings.TrimSpace(cfg.CurrentModelID); id != "" {
			model = id
		}
	}
	if model == "" {
		return resolvedRunModel{}, errors.New("missing model")
	}
	cfg = s.modelCatalogs.resolve(cfg)
	if r != nil {
		r.cfg = cfg
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
	snapshot := modelSource.Snapshot()
	if snapshot == nil {
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
	snapshot := modelSource.Snapshot()
	if snapshot == nil {
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
			msg = "Run ended without a valid terminal result."
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
