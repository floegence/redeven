package agent

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base32"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	livev1 "github.com/floegence/floeterm/terminal-go/livev1"
	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/accessproxy"
	"github.com/floegence/redeven/internal/accessrpc"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/auditlog"
	"github.com/floegence/redeven/internal/codeapp"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/diagnostics"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/fs"
	"github.com/floegence/redeven/internal/gitrepo"
	"github.com/floegence/redeven/internal/gitruntime"
	"github.com/floegence/redeven/internal/monitor"
	"github.com/floegence/redeven/internal/portforward"
	"github.com/floegence/redeven/internal/redevpluginintegration"
	"github.com/floegence/redeven/internal/rpcutil"
	"github.com/floegence/redeven/internal/runtimeidentity"
	"github.com/floegence/redeven/internal/runtimeproxy"
	"github.com/floegence/redeven/internal/runtimeservice"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
	syssvc "github.com/floegence/redeven/internal/sys"
	"github.com/floegence/redeven/internal/terminal"
)

const (
	controlRPCTypeRegister          uint32 = 41001
	controlRPCTypeHeartbeat         uint32 = 41002
	controlRPCTypeGrantServer       uint32 = 41003 // notify
	controlRPCTypeRuntimeDisconnect uint32 = 41005
	controlRPCTypeRuntimeEnrollment uint32 = 41008
)

// Floe app ids.
const (
	FloeAppRedevenAgent = "com.floegence.redeven.agent"
	FloeAppRedevenCode  = "com.floegence.redeven.code"
	// FloeAppRedevenPortForward proxies an arbitrary HTTP service reachable from the agent.
	FloeAppRedevenPortForward = "com.floegence.redeven.portforward"
)

func isSupportedFloeApp(floeApp string) bool {
	switch strings.TrimSpace(floeApp) {
	case FloeAppRedevenAgent, FloeAppRedevenCode, FloeAppRedevenPortForward:
		return true
	default:
		return false
	}
}

const (
	maintenanceOpNone    int32 = 0
	maintenanceOpUpgrade int32 = 1
	maintenanceOpRestart int32 = 2
)

type Options struct {
	Config *config.Config
	// ConfigPath is the path used to load the config file (used to derive state_dir).
	ConfigPath string
	StateRoot  string
	// InstanceID is a per-process runtime identity used by desktop lifecycle diagnostics.
	InstanceID string
	// LocalUIBind is the requested Local UI bind address before dynamic port resolution.
	LocalUIBind string
	// LocalUIEnabled indicates Local UI is enabled (e.g. `redeven run --mode hybrid|local`).
	//
	// When enabled, the agent is allowed to start even without a full bootstrap config.
	LocalUIEnabled bool
	// ControlChannelEnabled indicates whether the agent should connect to the control-plane control channel.
	//
	// In Local mode, this should be false even when the config is fully bootstrapped.
	ControlChannelEnabled bool
	// DisableSelfUpgrade keeps packaged shells on their signed installer path.
	DisableSelfUpgrade bool
	// EffectiveRunMode reports the current runtime mode exposed to the UI/control plane.
	EffectiveRunMode string
	// RemoteEnabled reports whether the current process has the remote control channel enabled.
	RemoteEnabled bool
	// LogOutput overrides the default runtime log sink.
	//
	// IMPORTANT: callers that reserve stdout for a machine protocol must pass
	// a non-stdout sink so agent services cannot corrupt the protocol stream.
	LogOutput io.Writer

	Version   string
	Commit    string
	BuildTime string

	// OnControlConnected is called once after the agent successfully connects to the
	// remote control channel and completes the initial register call.
	//
	// This hook is intended for CLI UX (e.g., printing the environment access URL)
	// and must not be used for authorization decisions.
	OnControlConnected func()
	// OnControlConnecting is called before a control-channel connection attempt.
	OnControlConnecting func()
	// OnControlRetry is called after a failed control-channel attempt with the retry delay.
	OnControlRetry func(error, time.Duration)
	// OnControlDisabled is called when the runtime starts without a control channel.
	OnControlDisabled func()

	AccessGate             *accessgate.Gate
	PluginRuntimeAuthority *redevpluginintegration.RuntimeProcessAuthority
}

type Agent struct {
	cfg *config.Config
	log *slog.Logger

	audit *auditlog.Store
	diag  *diagnostics.Store

	version   string
	commit    string
	buildTime string

	agentHomeAbs            string
	filesystemScope         *filesystemscope.Registry
	shell                   string
	stateDir                string
	configPath              string
	instanceID              string
	binaryPath              string
	localUIBind             string
	processStartedAtMs      int64
	pluginProcessGeneration string

	term                   *terminal.Manager
	mon                    *monitor.Service
	sys                    *syssvc.Service
	code                   *codeapp.Service
	pluginSessionLifecycle pluginSessionLifecycle

	maintenanceOp          atomic.Int32
	maintenanceState       maintenanceSnapshotStore
	maintenanceMarkerStore *runtimeMaintenanceMarkerStore

	providerLinkMu  sync.Mutex
	mu              sync.Mutex
	spendLedgerMu   sync.Mutex
	sessions        map[string]*activeSession // channel_id -> session
	sessionStopping bool
	pluginSessions  *authenticatedPluginSessionRegistry
	sessionWG       sync.WaitGroup
	pluginCloseMu   sync.Mutex
	pluginClosing   bool
	pluginCloseWG   sync.WaitGroup

	controlConnectedOnce sync.Once
	controlLifecycleMu   sync.Mutex
	onControlConnected   func()
	onControlConnecting  func()
	onControlRetry       func(error, time.Duration)
	onControlDisabled    func()
	runCtx               context.Context
	controlCancel        context.CancelFunc
	controlLoopDone      chan struct{}
	controlController    *flowersec.ConnectionController
	controlRPC           rpcutil.Caller
	controlRPCSerial     uint64
	controlRPCCallMu     sync.Mutex
	controlArtifact      controlArtifactSessionBinding

	localUIEnabled          bool
	controlChannelEnabled   bool
	selfUpgradeDisabled     bool
	effectiveRunMode        string
	remoteEnabled           bool
	accessGate              *accessgate.Gate
	gitRuntime              *gitruntime.Runtime
	runtimeLifecycle        *runtimeservice.LifecycleManager
	runtimeShutdown         chan struct{}
	runtimeShutdownOnce     sync.Once
	runtimeWorkloadSequence atomic.Uint64
}

// activeSession represents a server-side Flowersec channel session handled by the agent.
//
// NOTE: This is an in-memory registry used for UI/auditing; it must not be used for authorization decisions.
type activeSession struct {
	cancel            context.CancelFunc
	meta              session.Meta
	tunnelURL         string // grant_server.tunnel_url (for UI/auditing only)
	grantDigest       [sha256.Size]byte
	grantExpiresAt    int64
	connectedAtUnixMs int64 // set after ConnectTunnel succeeds
	pluginGeneration  PluginSessionGeneration
	runtimeLease      *runtimeservice.WorkloadLease
}

func New(opts Options) (*Agent, error) {
	if opts.Config == nil {
		return nil, errors.New("missing config")
	}
	if err := opts.Config.ValidateLocalMinimal(); err != nil {
		return nil, err
	}

	filesystemScope, err := filesystemscope.NewRegistry(opts.Config)
	if err != nil {
		return nil, err
	}
	agentHomeAbs := filesystemScope.HomePathAbs()

	logger, err := newLogger(strings.TrimSpace(opts.Config.LogFormat), strings.TrimSpace(opts.Config.LogLevel), opts.LogOutput)
	if err != nil {
		return nil, err
	}

	shell := strings.TrimSpace(opts.Config.Shell)
	if shell == "" {
		shell = strings.TrimSpace(os.Getenv("SHELL"))
	}
	if shell == "" {
		shell = "/bin/bash"
	}

	cfgPath := strings.TrimSpace(opts.ConfigPath)
	if cfgPath == "" {
		layout, err := config.DefaultStateLayout()
		if err != nil {
			return nil, err
		}
		cfgPath = layout.ConfigPath
	}
	cfgPathAbs := cfgPath
	stateDir := filepath.Dir(cfgPathAbs)
	stateRoot := strings.TrimSpace(opts.StateRoot)
	if stateRoot == "" {
		resolvedStateRoot, err := config.ResolveStateRoot("")
		if err != nil {
			return nil, err
		}
		stateRoot = resolvedStateRoot
	}
	binaryPath, err := runtimeidentity.CurrentExecutablePath()
	if err != nil {
		return nil, fmt.Errorf("resolve Redeven executable identity: %w", err)
	}
	pluginProcessGeneration := strings.TrimSpace(opts.InstanceID)
	if opts.PluginRuntimeAuthority != nil {
		authorityGeneration := strings.TrimSpace(opts.PluginRuntimeAuthority.ProcessGeneration())
		if pluginProcessGeneration == "" || authorityGeneration != pluginProcessGeneration {
			return nil, errors.New("plugin runtime authority does not match runtime instance")
		}
	} else if pluginProcessGeneration == "" {
		pluginProcessGeneration, err = randomOpaqueID(20)
		if err != nil {
			return nil, fmt.Errorf("create plugin process generation: %w", err)
		}
	}
	runtimeLifecycle := runtimeservice.NewLifecycleManager()
	a := &Agent{
		cfg:                     opts.Config,
		log:                     logger,
		version:                 strings.TrimSpace(opts.Version),
		commit:                  strings.TrimSpace(opts.Commit),
		buildTime:               strings.TrimSpace(opts.BuildTime),
		agentHomeAbs:            agentHomeAbs,
		filesystemScope:         filesystemScope,
		shell:                   shell,
		stateDir:                stateDir,
		configPath:              cfgPathAbs,
		instanceID:              strings.TrimSpace(opts.InstanceID),
		binaryPath:              binaryPath,
		localUIBind:             strings.TrimSpace(opts.LocalUIBind),
		processStartedAtMs:      time.Now().UnixMilli(),
		pluginProcessGeneration: pluginProcessGeneration,
		term:                    terminal.NewManagerWithScope(shell, filesystemScope, logger),
		mon:                     monitor.NewService(logger),
		sessions:                make(map[string]*activeSession),
		pluginSessions:          newAuthenticatedPluginSessionRegistry(),
		maintenanceMarkerStore:  newRuntimeMaintenanceMarkerStore(config.RuntimeMaintenancePathFromConfigPath(cfgPathAbs)),
		onControlConnected:      opts.OnControlConnected,
		onControlConnecting:     opts.OnControlConnecting,
		onControlRetry:          opts.OnControlRetry,
		onControlDisabled:       opts.OnControlDisabled,
		localUIEnabled:          opts.LocalUIEnabled,
		controlChannelEnabled:   opts.ControlChannelEnabled,
		selfUpgradeDisabled:     opts.DisableSelfUpgrade,
		effectiveRunMode:        strings.TrimSpace(opts.EffectiveRunMode),
		remoteEnabled:           opts.RemoteEnabled,
		accessGate:              opts.AccessGate,
		gitRuntime:              gitruntime.New(),
		runtimeLifecycle:        runtimeLifecycle,
		runtimeShutdown:         make(chan struct{}),
	}
	runtimeLifecycle.SetShutdown(func() error {
		a.runtimeShutdownOnce.Do(func() { close(a.runtimeShutdown) })
		return nil
	})
	a.term.SetWorkloadAdmission(func() (func(), error) {
		sequence := a.runtimeWorkloadSequence.Add(1)
		lease, err := a.admitRuntimeWorkload(runtimeservice.ManagedWorkload{
			Identity: fmt.Sprintf("terminal:%d", sequence), Kind: "terminal", Protected: true,
		})
		if err != nil {
			return nil, err
		}
		return lease.Release, nil
	})
	a.reconcileRuntimeMaintenanceMarker()

	auditStore, err := auditlog.New(auditlog.Options{Logger: logger, StateDir: stateDir})
	if err != nil {
		// Best-effort: agent must keep running even if audit logging is unavailable.
		logger.Warn("audit log init failed", "error", err)
	} else {
		a.audit = auditStore
	}
	diagnosticsStore, err := diagnostics.New(diagnostics.Options{
		Logger:   logger,
		StateDir: stateDir,
		Source:   diagnostics.SourceAgent,
	})
	if err != nil {
		logger.Warn("diagnostics init failed", "error", err)
	} else {
		a.diag = diagnosticsStore
	}
	var upgrader syssvc.Upgrader
	if !a.selfUpgradeDisabled {
		upgrader = &sysUpgrader{a: a}
	}
	a.sys = syssvc.NewService(syssvc.Options{
		AgentInstanceID:    opts.Config.AgentInstanceID,
		ProcessStartedAtMs: a.processStartedAtMs,
		Version:            opts.Version,
		Commit:             opts.Commit,
		BuildTime:          opts.BuildTime,
		Upgrader:           upgrader,
		Restarter:          &sysRestarter{a: a},
		Maintenance:        a,
		RuntimeService:     a,
	})

	redevpluginRuntimePath, err := bundledReDevPluginRuntimePath(a.binaryPath)
	if err != nil {
		return nil, err
	}
	codeSvc, err := codeapp.New(context.Background(), codeapp.Options{
		Logger:                 logger,
		StateDir:               stateDir,
		StateRoot:              stateRoot,
		ConfigPath:             cfgPathAbs,
		PermissionPolicy:       opts.Config.PermissionPolicy,
		ReDevPluginRuntimePath: redevpluginRuntimePath,
		ControlplaneBaseURL:    strings.TrimSpace(opts.Config.ControlplaneBaseURL),
		CodeServerPortMin:      opts.Config.CodeServerPortMin,
		CodeServerPortMax:      opts.Config.CodeServerPortMax,
		AgentHomeDir:           agentHomeAbs,
		FilesystemScope:        filesystemScope,
		Shell:                  shell,
		AIConfig:               opts.Config.AI,
		Audit:                  auditStore,
		Diagnostics:            a.diag,
		Terminal:               a.term,
		LocalUIEnabled:         a.localUIEnabled,
		ResolveSessionMeta: func(channelID string) (*session.Meta, bool) {
			if a == nil {
				return nil, false
			}
			channelID = strings.TrimSpace(channelID)
			if channelID == "" {
				return nil, false
			}
			a.mu.Lock()
			s := a.sessions[channelID]
			var meta session.Meta
			if s != nil {
				meta = s.meta
			}
			a.mu.Unlock()
			if s == nil {
				return nil, false
			}
			return &meta, true
		},
		ResolveSessionTunnelURL: func(channelID string) (string, bool) {
			if a == nil {
				return "", false
			}
			channelID = strings.TrimSpace(channelID)
			if channelID == "" {
				return "", false
			}
			a.mu.Lock()
			s := a.sessions[channelID]
			var tunnelURL string
			if s != nil {
				tunnelURL = s.tunnelURL
			}
			a.mu.Unlock()
			if s == nil {
				return "", false
			}
			return strings.TrimSpace(tunnelURL), true
		},
		ResolvePluginSessionMeta: a.ResolvePluginSession,
		AcquirePluginSession:     a.AcquirePluginSession,
		EndPluginSession:         a.EndPluginSession,
		PluginRuntimeAuthority:   opts.PluginRuntimeAuthority,
	})
	if err != nil {
		return nil, fmt.Errorf("init codeapp: %w", err)
	}
	a.code = codeSvc
	a.pluginSessionLifecycle = codeSvc

	return a, nil
}

func bundledReDevPluginRuntimePath(redevenBinaryPath string) (string, error) {
	redevenBinaryPath = strings.TrimSpace(redevenBinaryPath)
	if redevenBinaryPath == "" || !filepath.IsAbs(redevenBinaryPath) || filepath.Clean(redevenBinaryPath) != redevenBinaryPath {
		return "", errors.New("Redeven executable path is unavailable for ReDevPlugin runtime resolution")
	}
	return filepath.Join(filepath.Dir(redevenBinaryPath), "redevplugin-runtime"), nil
}

func summarizeFilesystemRoots(scope *filesystemscope.Registry) []map[string]any {
	if scope == nil {
		return nil
	}
	ctx := scope.PathContext()
	out := make([]map[string]any, 0, len(ctx.Roots))
	for _, root := range ctx.Roots {
		out = append(out, map[string]any{
			"id":    root.ID,
			"label": root.Label,
			"path":  root.PathAbs,
			"read":  root.Permissions.Read,
			"write": root.Permissions.Write,
		})
	}
	return out
}

func (a *Agent) Run(ctx context.Context) error {
	a.StartBackgroundServices(ctx)

	closeCodeApp := true
	defer func() {
		a.stopControlChannel()
		if closeCodeApp && a != nil && a.code != nil {
			_ = a.code.Close()
		}
	}()

	a.log.Info("agent starting",
		"version", a.version,
		"commit", a.commit,
		"build_time", a.buildTime,
		"environment_id", a.cfg.EnvironmentID,
		"controlplane", a.cfg.ControlplaneBaseURL,
		"agent_home_abs", a.agentHomeAbs,
		"filesystem_roots", summarizeFilesystemRoots(a.filesystemScope),
		"goos", runtime.GOOS,
		"goarch", runtime.GOARCH,
	)

	a.mu.Lock()
	a.runCtx = ctx
	a.mu.Unlock()
	if a.controlChannelEnabled {
		a.startControlChannel(ctx)
	} else {
		a.log.Info("control channel disabled; running without remote connection")
		if a.onControlDisabled != nil {
			a.onControlDisabled()
		}
	}

	requestedShutdown := false
	select {
	case <-ctx.Done():
	case <-a.runtimeShutdown:
		requestedShutdown = true
	}
	a.beginSessionShutdown()
	a.stopControlChannel()
	a.pluginSessions.stopAdmission()
	a.stopAllSessions()
	if !a.waitForSessions(30 * time.Second) {
		closeCodeApp = false
		return errors.New("session drain timed out; plugin host left open for process termination")
	}
	if !a.waitForPluginSessionCloses(30 * time.Second) {
		closeCodeApp = false
		return errors.New("plugin session maintenance timed out; plugin host left open for process termination")
	}
	if requestedShutdown {
		return nil
	}
	return ctx.Err()
}

func (a *Agent) StartBackgroundServices(ctx context.Context) {
	if a == nil {
		return
	}
	if a.mon != nil {
		a.mon.Start(ctx)
	}
}

func (a *Agent) startOrRestartControlChannel() {
	if a == nil {
		return
	}
	a.mu.Lock()
	ctx := a.runCtx
	a.mu.Unlock()
	if ctx == nil {
		ctx = context.Background()
	}
	a.startControlChannel(ctx)
}

func (a *Agent) startControlChannel(ctx context.Context) {
	if a == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	a.controlLifecycleMu.Lock()
	defer a.controlLifecycleMu.Unlock()
	a.mu.Lock()
	previousCancel := a.controlCancel
	previousDone := a.controlLoopDone
	a.controlCancel = nil
	a.controlLoopDone = nil
	a.mu.Unlock()
	if previousCancel != nil {
		previousCancel()
	}
	if previousDone != nil {
		<-previousDone
	}
	a.mu.Lock()
	a.controlController = nil
	a.controlRPCSerial++
	a.controlRPC = nil
	controlCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	a.controlCancel = cancel
	a.controlLoopDone = done
	a.mu.Unlock()
	go func() {
		defer close(done)
		a.runControlLoop(controlCtx)
	}()
}

func (a *Agent) stopControlChannel() {
	if a == nil {
		return
	}
	a.controlLifecycleMu.Lock()
	defer a.controlLifecycleMu.Unlock()
	a.mu.Lock()
	cancel := a.controlCancel
	done := a.controlLoopDone
	a.controlCancel = nil
	a.controlLoopDone = nil
	a.controlController = nil
	a.controlRPCSerial++
	a.controlRPC = nil
	a.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
}

func (a *Agent) runControlLoop(ctx context.Context) {
	if a == nil {
		return
	}
	cfg := a.remoteConfigSnapshot()
	if cfg == nil {
		a.log.Warn("control channel not started: missing config")
		return
	}
	if err := cfg.ValidateRemoteStrict(); err != nil {
		a.log.Warn("control channel not started: invalid remote config", "error", err)
		return
	}
	trustRoots, err := x509.SystemCertPool()
	if err != nil || trustRoots == nil {
		a.log.Error("control channel not started: system trust roots are unavailable")
		return
	}
	handlers := flowersec.NewRPCHandlers()
	if err := handlers.HandleRPC(controlRPCTypeRuntimeEnrollment, func(handlerCtx context.Context, payload json.RawMessage) (any, *flowersec.RPCError) {
		return a.handleRuntimeEnrollmentProof(handlerCtx, payload)
	}); err != nil {
		a.log.Error("control channel not started: register Runtime enrollment proof handler", "error", err)
		return
	}
	if err := handlers.HandleNotification(controlRPCTypeGrantServer, func(handlerCtx context.Context, payload json.RawMessage) error {
		a.handleGrantNotify(handlerCtx, payload)
		return nil
	}); err != nil {
		a.log.Error("control channel not started: register grant handler", "error", err)
		return
	}
	controller, err := flowersec.NewConnectionController(&controlArtifactSource{agent: a}, flowersec.ConnectionControllerOptions{
		Connector: flowersec.ConnectorOptions{
			TrustRoots:     trustRoots,
			Origin:         strings.TrimSuffix(cfg.ControlplaneBaseURL, "/"),
			ConnectTimeout: 15 * time.Second,
			RPCHandlers:    handlers,
		},
	})
	if err != nil {
		a.log.Error("control channel not started: create Flowersec controller", "error", err)
		return
	}
	a.mu.Lock()
	if a.controlCancel == nil || ctx.Err() != nil {
		a.mu.Unlock()
		return
	}
	a.controlController = controller
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		if a.controlController == controller {
			a.controlController = nil
		}
		a.mu.Unlock()
	}()

	if a.onControlConnecting != nil {
		a.onControlConnecting()
	}
	controller.Start(ctx)
	snapshot := controller.Snapshot()
	var sessionCancel context.CancelFunc
	for snapshot.State != flowersec.ConnectionClosed && snapshot.State != flowersec.ConnectionFailed {
		next, waitErr := controller.WaitForSnapshotChange(ctx, snapshot)
		if waitErr != nil {
			break
		}
		if next.State == flowersec.ConnectionConnecting && a.onControlConnecting != nil {
			a.onControlConnecting()
		}
		if next.State == flowersec.ConnectionWaiting && next.Failure != nil {
			a.log.Warn("control channel disconnected; Flowersec is retrying", "error", next.Failure.Error)
			if a.onControlRetry != nil {
				delay := time.Duration(0)
				if !next.Failure.Disposition.RetryAt.IsZero() {
					delay = time.Until(next.Failure.Disposition.RetryAt)
					if delay < 0 {
						delay = 0
					}
				}
				a.onControlRetry(next.Failure.Error, delay)
			}
		}
		if next.State == flowersec.ConnectionConnected && next.CurrentSession != nil && next.CurrentSession != snapshot.CurrentSession {
			if sessionCancel != nil {
				sessionCancel()
			}
			var sessionCtx context.Context
			sessionCtx, sessionCancel = context.WithCancel(ctx)
			go func(current flowersec.Session) {
				if sessionErr := a.runControlSession(sessionCtx, current); sessionErr != nil && sessionCtx.Err() == nil {
					a.log.Warn("control channel business session ended", "error", sessionErr)
					_ = current.Close()
				}
			}(next.CurrentSession)
		}
		snapshot = next
	}
	if sessionCancel != nil {
		sessionCancel()
	}
	if snapshot.State == flowersec.ConnectionFailed && snapshot.Failure != nil {
		a.log.Error("control channel failed", "error", snapshot.Failure.Error)
	}
	closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = controller.Close(closeCtx)
}

func (a *Agent) runControlSession(ctx context.Context, current flowersec.Session) error {
	if current == nil {
		return errors.New("missing control session")
	}
	cfg := a.remoteConfigSnapshot()
	if cfg == nil {
		return errors.New("missing config")
	}
	rpcC := current.RPC()
	if rpcC == nil {
		return errors.New("missing rpc client")
	}
	controlRPCSerial := a.setCurrentControlRPC(rpcC)
	defer a.clearCurrentControlRPC(controlRPCSerial)
	artifactBinding := a.currentControlArtifactSessionBinding()
	if artifactBinding.BindingGeneration != cfg.BindingGeneration || artifactBinding.Sequence == 0 || strings.TrimSpace(artifactBinding.ChannelID) == "" {
		return errors.New("control session artifact binding is unavailable")
	}

	// Register is the Portal-side active-owner fence for this exact artifact.
	_, err := callControlJSON[registerReq, registerResp](ctx, a, rpcC, controlRPCTypeRegister, &registerReq{
		EnvPublicID:              cfg.EnvironmentID,
		LocalEnvironmentPublicID: cfg.LocalEnvironmentPublicID,
		BindingGeneration:        cfg.BindingGeneration,
		ControlArtifactSequence:  artifactBinding.Sequence,
		ControlArtifactChannelID: artifactBinding.ChannelID,
		AgentInstanceID:          cfg.AgentInstanceID,
		Version:                  a.version,
		OS:                       runtime.GOOS,
		Arch:                     runtime.GOARCH,
		Hostname:                 hostnameBestEffort(),
		EffectiveRunMode:         normalizeEffectiveRunMode(a.effectiveRunMode),
		RemoteEnabled:            a.remoteEnabled,
	})
	if err != nil {
		return err
	}
	if err := a.maintainControlArtifactPool(ctx, rpcC); err != nil {
		a.log.Warn("control recovery reserve is degraded", "error", err)
	}
	cfg = a.remoteConfigSnapshot()
	if cfg == nil {
		return errors.New("control config unavailable after pool maintenance")
	}

	a.controlConnectedOnce.Do(func() {
		if a.onControlConnected != nil {
			a.onControlConnected()
		}
	})

	// Heartbeat loop.
	t := time.NewTicker(10 * time.Second)
	defer t.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
			_, err := callControlJSON[heartbeatReq, heartbeatResp](ctx, a, rpcC, controlRPCTypeHeartbeat, &heartbeatReq{
				NowUnixMs: time.Now().UnixMilli(),
			})
			if err != nil {
				return err
			}
			if err := a.maintainControlArtifactPool(ctx, rpcC); err != nil {
				a.log.Warn("control recovery reserve remains degraded", "error", err)
			}
		}
	}
}

func (a *Agent) currentControlArtifactSessionBinding() controlArtifactSessionBinding {
	if a == nil {
		return controlArtifactSessionBinding{}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.controlArtifact
}

func (a *Agent) remoteConfigSnapshot() *config.Config {
	if a == nil {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg == nil {
		return nil
	}
	cfg := *a.cfg
	if a.cfg.Direct != nil {
		direct := *a.cfg.Direct
		direct.ArtifactJSON = append([]byte(nil), a.cfg.Direct.ArtifactJSON...)
		cfg.Direct = &direct
	}
	if a.cfg.ControlArtifactPool != nil {
		pool := *a.cfg.ControlArtifactPool
		if a.cfg.ControlArtifactPool.PendingTopUp != nil {
			pending := *a.cfg.ControlArtifactPool.PendingTopUp
			pool.PendingTopUp = &pending
		}
		pool.Entries = make([]config.ControlArtifactEntry, len(a.cfg.ControlArtifactPool.Entries))
		copy(pool.Entries, a.cfg.ControlArtifactPool.Entries)
		for index := range pool.Entries {
			pool.Entries[index].ArtifactJSON = append([]byte(nil), pool.Entries[index].ArtifactJSON...)
		}
		cfg.ControlArtifactPool = &pool
	}
	return &cfg
}

func (a *Agent) setCurrentControlRPC(caller rpcutil.Caller) uint64 {
	if a == nil {
		return 0
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.controlRPCSerial++
	a.controlRPC = caller
	return a.controlRPCSerial
}

func (a *Agent) clearCurrentControlRPC(serial uint64) {
	if a == nil || serial == 0 {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.controlRPCSerial == serial {
		a.controlRPC = nil
	}
}

func (a *Agent) currentControlRPC() rpcutil.Caller {
	if a == nil {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.controlRPC
}

func callControlJSON[TReq any, TResp any](ctx context.Context, a *Agent, caller rpcutil.Caller, typeID uint32, req *TReq) (*TResp, error) {
	if caller == nil {
		return nil, errors.New("missing control rpc client")
	}
	if a != nil {
		a.controlRPCCallMu.Lock()
		defer a.controlRPCCallMu.Unlock()
	}
	return rpcutil.CallJSON[TReq, TResp](ctx, caller, typeID, req)
}

func (a *Agent) sendRuntimeDisconnect(ctx context.Context, snapshot providerDisconnectSnapshot, reasonCode string) error {
	if a == nil {
		return errors.New("nil agent")
	}
	caller := a.currentControlRPC()
	if caller == nil {
		return errProviderControlChannelNotConnected
	}
	a.controlRPCCallMu.Lock()
	defer a.controlRPCCallMu.Unlock()
	return sendRuntimeDisconnectWithCaller(ctx, caller, snapshot, reasonCode)
}

func sendRuntimeDisconnectWithCaller(ctx context.Context, caller rpcutil.Caller, snapshot providerDisconnectSnapshot, reasonCode string) error {
	if caller == nil {
		return errProviderControlChannelNotConnected
	}
	resp, err := rpcutil.CallJSON[runtimeDisconnectReq, runtimeDisconnectResp](ctx, caller, controlRPCTypeRuntimeDisconnect, &runtimeDisconnectReq{
		EnvPublicID:              snapshot.EnvPublicID,
		ProviderOrigin:           snapshot.ProviderOrigin,
		ProviderID:               snapshot.ProviderID,
		AccessPointOrigin:        snapshot.AccessPointOrigin,
		LocalEnvironmentPublicID: snapshot.LocalEnvironmentPublicID,
		BindingGeneration:        snapshot.BindingGeneration,
		AgentInstanceID:          snapshot.AgentInstanceID,
		ReasonCode:               strings.TrimSpace(reasonCode),
		NowUnixMs:                time.Now().UnixMilli(),
	})
	if err != nil {
		return fmt.Errorf("runtime disconnect rpc: %w", err)
	}
	if resp == nil {
		return errors.New("runtime disconnect rpc: empty response")
	}
	if !resp.OK || !resp.Cleared || strings.TrimSpace(resp.State) != "disconnected" {
		return fmt.Errorf("runtime disconnect rpc: rejected state=%q cleared=%t", resp.State, resp.Cleared)
	}
	return nil
}

func requireJSONEOF(decoder *json.Decoder) error {
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("unexpected trailing JSON value")
		}
		return err
	}
	return nil
}

func (a *Agent) handleGrantNotify(ctx context.Context, payload json.RawMessage) {
	if a != nil && a.maintenanceOp.Load() != maintenanceOpNone {
		a.log.Debug("maintenance in progress; ignoring grant_server notify", "op", a.maintenanceOp.Load())
		return
	}

	var n session.GrantServerNotify
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&n); err != nil {
		a.log.Warn("invalid grant_server notify json", "error", err)
		return
	}
	if err := requireJSONEOF(decoder); err != nil {
		a.log.Warn("invalid grant_server notify json", "error", err)
		return
	}
	if err := session.ValidateGrantServerNotifyRemote(&n, a.cfg.EnvironmentID); err != nil {
		a.log.Warn("invalid remote grant_server notify", "error", err)
		return
	}

	meta := n.SessionMeta
	channelID := strings.TrimSpace(meta.ChannelID)
	endpointID := strings.TrimSpace(meta.EndpointID)
	floeApp := strings.TrimSpace(meta.FloeApp)

	if !isSupportedFloeApp(floeApp) {
		a.log.Warn("unsupported floe_app; ignoring session", "floe_app", floeApp, "channel_id", channelID)
		return
	}
	meta.ChannelID = channelID
	meta.EndpointID = endpointID
	meta.FloeApp = floeApp
	meta.UserPublicID = strings.TrimSpace(meta.UserPublicID)
	meta.NamespacePublicID = strings.TrimSpace(meta.NamespacePublicID)
	n.GrantServer.ChannelID = channelID

	// Clamp control-plane granted permissions using the local endpoint cap.
	declared := config.PermissionSet{
		Read:    meta.CanRead,
		Write:   meta.CanWrite,
		Execute: meta.CanExecute,
	}
	localCap := a.cfg.PermissionPolicy.ResolveCap(meta.UserPublicID, meta.FloeApp)
	effective := declared.Intersect(localCap)
	if effective != declared {
		a.log.Info("session permissions clamped by local policy",
			"channel_id", channelID,
			"user_public_id", meta.UserPublicID,
			"floe_app", meta.FloeApp,
			"declared_read", declared.Read,
			"declared_write", declared.Write,
			"declared_execute", declared.Execute,
			"cap_read", localCap.Read,
			"cap_write", localCap.Write,
			"cap_execute", localCap.Execute,
			"effective_read", effective.Read,
			"effective_write", effective.Write,
			"effective_execute", effective.Execute,
		)
	}
	meta.CanRead = effective.Read
	meta.CanWrite = effective.Write
	meta.CanExecute = effective.Execute

	// Code App security: code-server is a "full environment" capability.
	// We currently require read+write+execute to avoid misleading permission splits.
	if meta.FloeApp == FloeAppRedevenCode {
		csID := strings.TrimSpace(meta.CodeSpaceID)
		if csID == "" {
			a.log.Warn("missing code_space_id for code app session", "channel_id", channelID)
			return
		}
		if !codeapp.IsValidCodeSpaceID(csID) {
			a.log.Warn("invalid code_space_id for code app session", "code_space_id", csID, "channel_id", channelID)
			return
		}
		if !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			a.log.Warn("insufficient permissions for code app session; ignoring",
				"channel_id", channelID,
				"user_public_id", meta.UserPublicID,
				"code_space_id", csID,
				"can_read", meta.CanRead,
				"can_write", meta.CanWrite,
				"can_execute", meta.CanExecute,
			)
			return
		}
	}

	// Port Forward security: forwarding arbitrary HTTP traffic is an execute-like capability.
	if meta.FloeApp == FloeAppRedevenPortForward {
		forwardID := strings.TrimSpace(meta.CodeSpaceID)
		if forwardID == "" {
			a.log.Warn("missing forward_id for port forward session", "channel_id", channelID)
			return
		}
		if !portforward.IsValidForwardID(forwardID) {
			a.log.Warn("invalid forward_id for port forward session", "forward_id", forwardID, "channel_id", channelID)
			return
		}
		if !meta.CanExecute {
			a.log.Warn("insufficient permissions for port forward session; ignoring",
				"channel_id", channelID,
				"user_public_id", meta.UserPublicID,
				"forward_id", forwardID,
				"can_execute", meta.CanExecute,
			)
			return
		}
	}

	// Freeze the metadata snapshot used for auditing/UI and for the session runtime.
	metaCopy := *meta

	runtimeLease, err := a.admitRuntimeWorkload(runtimeservice.ManagedWorkload{Identity: "session:" + channelID, Kind: "session", Protected: true})
	if err != nil {
		a.log.Info("data session rejected by Runtime lifecycle fence", "channel_id", channelID)
		return
	}
	grantDigest := sha256.Sum256(n.GrantServer.ArtifactJSON)
	a.mu.Lock()
	if a.sessionStopping {
		a.mu.Unlock()
		runtimeLease.Release()
		return
	}
	if existing, ok := a.sessions[channelID]; ok {
		a.mu.Unlock()
		runtimeLease.Release()
		if existing.grantDigest != grantDigest || existing.grantExpiresAt != n.GrantServer.ArtifactExpiresAtUnixS {
			a.log.Warn("conflicting grant_server notify ignored", "channel_id", channelID)
		}
		// Exact duplicate notifications are idempotent. Conflicting grants do
		// not replace the already-authorized owner for this channel.
		return
	}
	sessCtx, cancel := context.WithCancel(ctx)
	a.sessions[channelID] = &activeSession{
		cancel:         cancel,
		meta:           metaCopy,
		tunnelURL:      "",
		grantDigest:    grantDigest,
		grantExpiresAt: n.GrantServer.ArtifactExpiresAtUnixS,
		runtimeLease:   runtimeLease,
	}
	a.sessionWG.Add(1)
	a.mu.Unlock()

	if a.accessGate != nil && a.accessGate.Enabled() {
		a.accessGate.RegisterChannel(metaCopy)
	}

	go func(meta *session.Meta) {
		defer func() {
			defer a.sessionWG.Done()
			if a.accessGate != nil && a.accessGate.Enabled() {
				a.accessGate.UnregisterChannel(channelID)
			}
			generation := a.removeActiveSession(channelID)
			a.closePluginSessionGeneration(channelID, generation)
		}()
		_ = a.runDataSession(sessCtx, n.GrantServer, meta)
	}(&metaCopy)
}

func (a *Agent) runDataSession(ctx context.Context, grant *session.ChannelInitGrant, meta *session.Meta) (err error) {
	if grant == nil || meta == nil {
		return errors.New("missing grant/meta")
	}

	opened := false
	startedAt := time.Now()
	connectedAtUnixMs := int64(0)
	channelID := strings.TrimSpace(meta.ChannelID)
	endpointID := strings.TrimSpace(meta.EndpointID)
	floeApp := strings.TrimSpace(meta.FloeApp)
	codeSpaceID := strings.TrimSpace(meta.CodeSpaceID)
	userPublicID := strings.TrimSpace(meta.UserPublicID)
	userEmail := strings.TrimSpace(meta.UserEmail)
	tunnelURL := ""
	defer func() {
		reason := "eof"
		if !opened {
			reason = "connect_failed"
		}
		if errors.Is(err, context.Canceled) {
			reason = "canceled"
		} else if err != nil {
			reason = "error"
		}

		attrs := []any{
			"channel_id", channelID,
			"env_public_id", endpointID,
			"floe_app", floeApp,
			"code_space_id", codeSpaceID,
			"user_public_id", userPublicID,
			"user_email", userEmail,
			"opened", opened,
			"reason", reason,
			"duration_ms", time.Since(startedAt).Milliseconds(),
		}
		if reason == "error" {
			a.log.Warn("data session closed", append(attrs, "error", err)...)
		} else {
			a.log.Info("data session closed", attrs...)
		}

		if a != nil && a.audit != nil {
			status := "success"
			if reason == "error" || reason == "connect_failed" {
				status = "failure"
			}
			action := "session_closed"
			if !opened {
				if reason == "canceled" {
					action = "session_open_canceled"
				} else {
					action = "session_open_failed"
				}
			}
			errText := ""
			if status == "failure" && err != nil {
				errText = strings.TrimSpace(err.Error())
				errText = strings.ReplaceAll(errText, "\r", " ")
				errText = strings.ReplaceAll(errText, "\n", " ")
				if len(errText) > 240 {
					errText = errText[:240] + "..."
				}
			}

			detail := map[string]any{
				"reason":      reason,
				"duration_ms": time.Since(startedAt).Milliseconds(),
			}
			if connectedAtUnixMs > 0 {
				detail["connected_at_unix_ms"] = connectedAtUnixMs
			}

			a.audit.Append(auditlog.Entry{
				Action:            action,
				Status:            status,
				Error:             errText,
				ChannelID:         channelID,
				EnvPublicID:       endpointID,
				NamespacePublicID: strings.TrimSpace(meta.NamespacePublicID),
				UserPublicID:      userPublicID,
				UserEmail:         userEmail,
				FloeApp:           floeApp,
				SessionKind:       strings.TrimSpace(meta.SessionKind),
				CodeSpaceID:       codeSpaceID,
				TunnelURL:         tunnelURL,
				CanRead:           meta.CanRead,
				CanWrite:          meta.CanWrite,
				CanExecute:        meta.CanExecute,
				CanAdmin:          meta.CanAdmin,
				Detail:            detail,
			})
		}
	}()

	if len(grant.ArtifactJSON) == 0 {
		return errors.New("missing Flowersec v2 data artifact")
	}
	artifact, err := flowersec.ParseArtifact(grant.ArtifactJSON)
	if err != nil {
		return err
	}
	artifactDigest := sha256.Sum256(grant.ArtifactJSON)
	lease, err := flowersec.NewArtifactLease(artifact, func(spendCtx context.Context) error {
		return a.commitDataArtifactSpend(spendCtx, artifactDigest, grant.ArtifactExpiresAtUnixS)
	})
	if err != nil {
		return err
	}
	var remotePlan *remoteSessionPlan
	if strings.TrimSpace(meta.FloeApp) == FloeAppRedevenAgent {
		remotePlan, err = a.prepareRemoteSessionPlan(meta)
		if err != nil {
			return err
		}
		defer remotePlan.cleanup()
	}
	trustRoots, err := x509.SystemCertPool()
	if err != nil || trustRoots == nil {
		return errors.New("system trust roots are unavailable")
	}
	connectorOptions := flowersec.ConnectorOptions{
		TrustRoots:     trustRoots,
		Origin:         strings.TrimSuffix(a.cfg.ControlplaneBaseURL, "/"),
		ConnectTimeout: 15 * time.Second,
		RPCHandlers:    flowersec.NewRPCHandlers(),
	}
	if remotePlan != nil {
		connectorOptions.RPCHandlers = remotePlan.rpc
	}
	sess, err := flowersec.Connect(ctx, lease, connectorOptions)
	if err != nil {
		return err
	}
	defer sess.Close()
	if remotePlan != nil && a.term != nil {
		detachTerminalSink := a.term.AttachSink(meta, sess.RPC(), a.accessGate)
		defer detachTerminalSink()
	}
	opened = true

	connectedAtUnixMs = time.Now().UnixMilli()
	if err := a.markSessionConnected(channelID, connectedAtUnixMs); err != nil {
		return err
	}

	a.log.Info("data session opened",
		"channel_id", channelID,
		"env_public_id", endpointID,
		"floe_app", floeApp,
		"code_space_id", codeSpaceID,
		"user_public_id", userPublicID,
		"user_email", userEmail,
		"connected_at_unix_ms", connectedAtUnixMs,
	)

	if a != nil && a.audit != nil {
		a.audit.Append(auditlog.Entry{
			Action:            "session_opened",
			Status:            "success",
			ChannelID:         channelID,
			EnvPublicID:       endpointID,
			NamespacePublicID: strings.TrimSpace(meta.NamespacePublicID),
			UserPublicID:      userPublicID,
			UserEmail:         userEmail,
			FloeApp:           floeApp,
			SessionKind:       strings.TrimSpace(meta.SessionKind),
			CodeSpaceID:       codeSpaceID,
			TunnelURL:         tunnelURL,
			CanRead:           meta.CanRead,
			CanWrite:          meta.CanWrite,
			CanExecute:        meta.CanExecute,
			CanAdmin:          meta.CanAdmin,
			Detail: map[string]any{
				"connected_at_unix_ms": connectedAtUnixMs,
			},
		})
	}
	switch strings.TrimSpace(meta.FloeApp) {
	case FloeAppRedevenCode:
		return a.serveCodeAppSession(ctx, sess, meta)
	case FloeAppRedevenPortForward:
		return a.servePortForwardSession(ctx, sess, meta)
	default:
		return a.serveRedevenAgentSession(ctx, sess, meta, remotePlan)
	}
}

func (a *Agent) serveCodeAppSession(ctx context.Context, sess flowersec.Session, meta *session.Meta) error {
	if a == nil || meta == nil {
		return errors.New("invalid args")
	}
	if sess == nil {
		return errors.New("missing session")
	}
	if a.code == nil {
		return errors.New("codeapp not initialized")
	}

	codeSpaceID := strings.TrimSpace(meta.CodeSpaceID)
	if codeSpaceID == "" {
		return errors.New("missing code_space_id")
	}

	origin, err := a.code.ExternalOriginForCodeSpace(codeSpaceID)
	if err != nil {
		return err
	}

	// Ensure the code-server instance is running before accepting proxy streams.
	if _, err := a.code.ResolveCodeServerPort(ctx, codeSpaceID); err != nil {
		return err
	}

	up := strings.TrimSpace(a.code.AppServerURL())
	if up == "" {
		return errors.New("code app server not ready")
	}

	up, cleanupUpstream, err := a.prepareAccessProxyUpstream(ctx, meta, up)
	if err != nil {
		return err
	}
	defer cleanupUpstream()

	handlers, err := flowersec.NewStreamHandlers(flowersec.StreamHandlerOptions{OnError: func(err error) {
		if err == nil {
			return
		}
		a.log.Warn("codeapp stream error", "channel_id", meta.ChannelID, "code_space_id", codeSpaceID, "error", err)
	}})
	if err != nil {
		return err
	}

	proxyOpts := runtimeproxy.Options{
		Upstream:               up,
		UpstreamOrigin:         origin,
		BlockedResponseHeaders: runtimeproxy.ProductBlockedResponseHeaders(),
	}
	proxy, err := runtimeproxy.RegisterStreamHandlers(handlers, proxyOpts)
	if err != nil {
		return err
	}
	defer func() { _ = proxy.Close() }()
	return handlers.Serve(ctx, sess)
}

func (a *Agent) servePortForwardSession(ctx context.Context, sess flowersec.Session, meta *session.Meta) error {
	if a == nil || meta == nil {
		return errors.New("invalid args")
	}
	if sess == nil {
		return errors.New("missing session")
	}
	if a.code == nil {
		return errors.New("codeapp not initialized")
	}
	if !meta.CanExecute {
		return errors.New("execute permission required")
	}

	forwardID := strings.TrimSpace(meta.CodeSpaceID)
	if forwardID == "" {
		return errors.New("missing forward_id")
	}

	origin, err := a.code.ExternalOriginForPortForward(forwardID)
	if err != nil {
		return err
	}

	up := strings.TrimSpace(a.code.AppServerURL())
	if up == "" {
		return errors.New("code app server not ready")
	}

	up, cleanupUpstream, err := a.prepareAccessProxyUpstream(ctx, meta, up)
	if err != nil {
		return err
	}
	defer cleanupUpstream()

	handlers, err := flowersec.NewStreamHandlers(flowersec.StreamHandlerOptions{OnError: func(err error) {
		if err == nil {
			return
		}
		a.log.Warn("portforward stream error", "channel_id", meta.ChannelID, "forward_id", forwardID, "error", err)
	}})
	if err != nil {
		return err
	}

	proxyOpts := runtimeproxy.Options{
		Upstream:               up,
		UpstreamOrigin:         origin,
		BlockedResponseHeaders: runtimeproxy.ProductBlockedResponseHeaders(),
	}
	proxy, err := runtimeproxy.RegisterStreamHandlers(handlers, proxyOpts)
	if err != nil {
		return err
	}
	defer func() { _ = proxy.Close() }()
	return handlers.Serve(ctx, sess)
}

func (a *Agent) serveRedevenAgentSession(ctx context.Context, sess flowersec.Session, meta *session.Meta, plan *remoteSessionPlan) error {
	if a == nil || meta == nil {
		return errors.New("invalid args")
	}
	if sess == nil {
		return errors.New("missing session")
	}

	if plan == nil {
		return errors.New("missing pre-connect remote session plan")
	}
	handlers := plan.streams

	// Env App UI static assets are delivered over flowersec-proxy (Standard Mode only).
	// Only enable the proxy handler for the reserved Env App code_space_id, and only when the
	// session targets the bootstrapped Region environment.
	//
	// Local UI uses a fixed env_public_id (env_local) and serves assets over the local HTTP server.
	envID := ""
	if a.cfg != nil {
		envID = strings.TrimSpace(a.cfg.EnvironmentID)
	}
	if strings.TrimSpace(meta.CodeSpaceID) == "env-ui" && envID != "" && strings.TrimSpace(meta.EndpointID) == envID {
		up := strings.TrimSpace(a.code.AppServerURL())
		if up == "" {
			return errors.New("code app server not ready")
		}
		up, cleanupUpstream, err := a.prepareAccessProxyUpstream(ctx, meta, up)
		if err != nil {
			return err
		}
		defer cleanupUpstream()
		baseOrigin, err := a.code.ExternalOriginForEnvApp(meta.EndpointID)
		if err != nil {
			return err
		}
		origin, err := originWithChannelLabel(baseOrigin, meta.ChannelID)
		if err != nil {
			return err
		}
		proxyOpts := runtimeproxy.Options{
			Upstream:               up,
			UpstreamOrigin:         origin,
			BlockedResponseHeaders: runtimeproxy.ProductBlockedResponseHeaders(),
		}
		proxy, err := runtimeproxy.RegisterStreamHandlers(handlers, proxyOpts)
		if err != nil {
			return err
		}
		defer func() { _ = proxy.Close() }()
	}
	return handlers.Serve(ctx, sess)
}

// NewLocalSessionHandlers builds the Redeven application router used by a
// Flowersec Acceptor. Flowersec owns admission, session establishment, RPC
// framing, stream dispatch, and session lifetime; the returned cleanup only
// releases Redeven service state captured by the handlers.
func (a *Agent) NewLocalSessionHandlers(meta *session.Meta) (*flowersec.SessionHandlers, func(), error) {
	if a == nil || meta == nil {
		return nil, nil, errors.New("invalid args")
	}
	fsSvc := fs.NewServiceWithCoordinator(a.filesystemScope, a.gitRuntime)
	gitRepoSvc := gitrepo.NewServiceWithScopeAndRuntime(a.filesystemScope, a.gitRuntime)
	cleanups := []func(){gitRepoSvc.Close}
	cleanup := func() {
		for index := len(cleanups) - 1; index >= 0; index-- {
			cleanups[index]()
		}
	}

	handlers, err := flowersec.NewSessionHandlers(flowersec.SessionHandlerOptions{OnError: func(err error) {
		if err != nil && a.log != nil {
			a.log.Warn("local agent stream error", "channel_id", meta.ChannelID, "error", err)
		}
	}})
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	router := sessionrpc.NewRouter()
	accessrpc.New(a.accessGate).Register(router, meta)
	a.sys.RegisterWithAccessGate(router, meta, a.accessGate)
	fsSvc.RegisterWithAccessGate(router, meta, a.accessGate)
	gitRepoSvc.RegisterWithAccessGate(router, meta, a.accessGate)
	a.mon.RegisterWithAccessGate(router, meta, a.accessGate)
	a.registerSessionsRPCWithAccessGate(router, meta, a.accessGate)
	cleanups = append(cleanups, a.registerAISessionRPC(router, meta, nil))
	if a.term != nil {
		cleanups = append(cleanups, a.term.RegisterWithAccessGate(router, meta, nil, a.accessGate))
	}
	if err := router.Bind(handlers); err != nil {
		cleanup()
		return nil, nil, err
	}
	if err := handlers.HandleStream("fs/read_file", func(ctx context.Context, incoming flowersec.IncomingStream) error {
		fsSvc.ServeReadFileStreamWithAccessGate(ctx, incoming.Stream, meta, a.accessGate)
		return nil
	}); err != nil {
		cleanup()
		return nil, nil, err
	}
	if a.term != nil {
		if err := handlers.HandleStream(livev1.StreamKind, a.terminalLiveStreamHandler(meta)); err != nil {
			cleanup()
			return nil, nil, err
		}
	}
	return handlers, cleanup, nil
}

func (a *Agent) registerAISessionRPC(router *sessionrpc.Router, meta *session.Meta, peer flowersec.RPCPeer) func() {
	acquire := func(ctx context.Context) (*ai.Service, context.Context, uint64, func(), error) {
		if a == nil || a.code == nil {
			return nil, nil, 0, nil, errors.New("AI service is unavailable")
		}
		return a.code.AcquireAIService(ctx)
	}
	return ai.RegisterRPCServiceProviderWithAccessGate(router, meta, peer, a.accessGate, acquire)
}

func (a *Agent) terminalLiveStreamHandler(meta *session.Meta) flowersec.StreamHandler {
	return func(ctx context.Context, incoming flowersec.IncomingStream) error {
		if a == nil || a.term == nil || incoming.Stream == nil {
			return errors.New("terminal live stream unavailable")
		}
		return a.term.ServeLiveStream(ctx, incoming.Stream, meta, a.accessGate)
	}
}

func (a *Agent) prepareAccessProxyUpstream(ctx context.Context, meta *session.Meta, upstream string) (string, func(), error) {
	if a == nil {
		return upstream, func() {}, nil
	}
	proxy, err := accessproxy.New(accessproxy.Options{
		Logger:   a.log,
		Gate:     a.accessGate,
		Meta:     *meta,
		Upstream: upstream,
	})
	if err != nil {
		return "", nil, err
	}
	if err := proxy.Start(ctx); err != nil {
		return "", nil, err
	}
	return strings.TrimSpace(proxy.URL()), func() { _ = proxy.Close() }, nil
}

func (a *Agent) markSessionConnected(channelID string, connectedAtUnixMs int64) error {
	if a == nil {
		return errors.New("agent is unavailable")
	}
	channelID = strings.TrimSpace(channelID)
	if channelID == "" {
		return errors.New("missing channel_id")
	}

	a.mu.Lock()
	s := a.sessions[channelID]
	if s == nil {
		a.mu.Unlock()
		return errors.New("session is unavailable")
	}
	meta := s.meta
	a.mu.Unlock()

	generation, err := a.activatePluginSession(meta, [32]byte{}, false, "")
	if err != nil {
		return err
	}

	a.mu.Lock()
	if a.sessions[channelID] != s {
		a.mu.Unlock()
		a.startPluginSessionClose(channelID, generation)
		return errors.New("session was replaced during activation")
	}
	s.pluginGeneration = generation
	if connectedAtUnixMs > 0 {
		s.connectedAtUnixMs = connectedAtUnixMs
	}
	a.mu.Unlock()
	return nil
}

func (a *Agent) removeActiveSession(channelID string) PluginSessionGeneration {
	if a == nil {
		return 0
	}
	channelID = strings.TrimSpace(channelID)
	a.mu.Lock()
	s := a.sessions[channelID]
	if s != nil {
		delete(a.sessions, channelID)
	}
	a.mu.Unlock()
	if s == nil {
		return 0
	}
	s.runtimeLease.Release()
	return s.pluginGeneration
}

func (a *Agent) closePluginSessionGeneration(channelID string, generation PluginSessionGeneration) {
	if a == nil || generation == 0 {
		return
	}
	meta, ok := a.pluginSessions.beginClose(generation)
	if !ok {
		return
	}
	a.maintainPluginSessionGeneration(channelID, generation, meta)
}

func (a *Agent) startPluginSessionClose(channelID string, generation PluginSessionGeneration) {
	if a == nil || generation == 0 {
		return
	}
	meta, ok := a.pluginSessions.beginClose(generation)
	if !ok {
		return
	}
	a.pluginCloseMu.Lock()
	if a.pluginClosing {
		a.pluginCloseMu.Unlock()
		a.maintainPluginSessionGeneration(channelID, generation, meta)
		return
	}
	a.pluginCloseWG.Add(1)
	a.pluginCloseMu.Unlock()
	go func() {
		defer a.pluginCloseWG.Done()
		a.maintainPluginSessionGeneration(channelID, generation, meta)
	}()
}

func (a *Agent) maintainPluginSessionGeneration(channelID string, generation PluginSessionGeneration, meta *session.Meta) {
	if a == nil || generation == 0 || meta == nil {
		return
	}
	if a.code != nil && a.code.AppServer() != nil {
		a.code.AppServer().ClosePluginSessionConnections(channelID)
	}
	if a.pluginSessionLifecycle == nil {
		return
	}
	for attempt := 0; ; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		err := a.WaitPluginSessionDrained(ctx, generation)
		if err == nil {
			err = a.pluginSessionLifecycle.RecordPluginSessionTerminalIntent(ctx, meta, a.pluginProcessGeneration, pluginSessionGenerationID(generation))
		}
		if err == nil && !a.TerminalizePluginSession(generation) {
			err = errors.New("plugin session terminalization rejected")
		}
		if err == nil {
			err = a.pluginSessionLifecycle.MaintainTerminalPluginSession(ctx, meta, a.pluginProcessGeneration, pluginSessionGenerationID(generation))
		}
		cancel()
		if err == nil {
			if !a.pluginSessions.discardTerminal(generation) {
				a.log.Warn("plugin session terminal record could not be discarded", "channel_id", strings.TrimSpace(channelID))
			}
			return
		}
		a.log.Warn("plugin session maintenance incomplete", "channel_id", strings.TrimSpace(channelID), "attempt", attempt+1, "error", err)
		delay := time.Second << min(attempt, 5)
		timer := time.NewTimer(delay)
		a.mu.Lock()
		runCtx := a.runCtx
		a.mu.Unlock()
		if runCtx == nil {
			runCtx = context.Background()
		}
		select {
		case <-timer.C:
		case <-runCtx.Done():
			timer.Stop()
			return
		}
	}
}

func (a *Agent) stopAllSessions() {
	a.mu.Lock()
	cancels := make([]context.CancelFunc, 0, len(a.sessions))
	for _, s := range a.sessions {
		if s == nil || s.cancel == nil {
			continue
		}
		cancels = append(cancels, s.cancel)
	}
	a.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
}

func (a *Agent) beginSessionShutdown() {
	if a == nil {
		return
	}
	a.mu.Lock()
	a.sessionStopping = true
	a.mu.Unlock()
}

func (a *Agent) waitForSessions(timeout time.Duration) bool {
	if a == nil {
		return true
	}
	done := make(chan struct{})
	go func() {
		a.sessionWG.Wait()
		close(done)
	}()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-done:
		return true
	case <-timer.C:
		a.log.Warn("session drain timed out")
		return false
	}
}

func (a *Agent) waitForPluginSessionCloses(timeout time.Duration) bool {
	if a == nil {
		return true
	}
	a.pluginCloseMu.Lock()
	a.pluginClosing = true
	a.pluginCloseMu.Unlock()
	done := make(chan struct{})
	go func() {
		a.pluginCloseWG.Wait()
		close(done)
	}()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-done:
		return true
	case <-timer.C:
		a.log.Warn("plugin session maintenance drain timed out")
		return false
	}
}

func hostnameBestEffort() string {
	h, err := os.Hostname()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(h)
}

func originWithChannelLabel(baseOrigin string, channelID string) (string, error) {
	baseOrigin = strings.TrimSpace(baseOrigin)
	channelID = strings.TrimSpace(channelID)
	if baseOrigin == "" || channelID == "" {
		return "", errors.New("invalid origin args")
	}

	u, err := url.Parse(baseOrigin)
	if err != nil || u == nil {
		return "", errors.New("invalid base origin")
	}
	host := strings.TrimSpace(u.Host)
	if host == "" {
		return "", errors.New("invalid base origin host")
	}

	labels := strings.Split(host, ".")
	if len(labels) < 2 {
		return "", errors.New("invalid base origin host")
	}

	enc := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString([]byte(channelID))
	enc = strings.ToLower(strings.TrimSpace(enc))
	if enc == "" {
		return "", errors.New("invalid channel id")
	}

	// Insert as the second label: env-xxx.ch-<enc>.<rest>.
	out := make([]string, 0, len(labels)+1)
	out = append(out, labels[0], "ch-"+enc)
	out = append(out, labels[1:]...)
	u.Host = strings.Join(out, ".")
	return u.String(), nil
}

// --- control channel types (wire JSON) ---

type registerReq struct {
	EnvPublicID              string `json:"env_public_id,omitempty"`
	LocalEnvironmentPublicID string `json:"local_environment_public_id,omitempty"`
	BindingGeneration        int64  `json:"binding_generation,omitempty"`
	ControlArtifactSequence  uint64 `json:"control_artifact_sequence"`
	ControlArtifactChannelID string `json:"control_artifact_channel_id"`
	AgentInstanceID          string `json:"agent_instance_id,omitempty"`
	Version                  string `json:"version,omitempty"`
	OS                       string `json:"os,omitempty"`
	Arch                     string `json:"arch,omitempty"`
	Hostname                 string `json:"hostname,omitempty"`
	EffectiveRunMode         string `json:"effective_run_mode,omitempty"`
	RemoteEnabled            bool   `json:"remote_enabled,omitempty"`
}

type registerResp struct {
	OK bool `json:"ok"`
}

type heartbeatReq struct {
	NowUnixMs int64 `json:"now_unix_ms,omitempty"`
}

type heartbeatResp struct {
	OK bool `json:"ok"`
}

type runtimeDisconnectReq struct {
	EnvPublicID              string `json:"env_public_id,omitempty"`
	ProviderOrigin           string `json:"provider_origin"`
	ProviderID               string `json:"provider_id"`
	AccessPointOrigin        string `json:"access_point_origin"`
	LocalEnvironmentPublicID string `json:"local_environment_public_id"`
	BindingGeneration        int64  `json:"binding_generation"`
	AgentInstanceID          string `json:"agent_instance_id,omitempty"`
	ReasonCode               string `json:"reason_code"`
	NowUnixMs                int64  `json:"now_unix_ms,omitempty"`
}

type runtimeDisconnectResp struct {
	OK         bool   `json:"ok"`
	Cleared    bool   `json:"cleared"`
	State      string `json:"state"`
	ReasonCode string `json:"reason_code,omitempty"`
}

func normalizeEffectiveRunMode(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "local":
		return "local"
	case "hybrid":
		return "hybrid"
	case "remote":
		return "remote"
	default:
		return ""
	}
}

func randomOpaqueID(size int) (string, error) {
	if size <= 0 {
		return "", errors.New("random identifier size must be positive")
	}
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(data)), nil
}

// --- logger ---

func newLogger(format string, level string, out io.Writer) (*slog.Logger, error) {
	var h slog.Handler
	if out == nil {
		out = os.Stdout
	}

	var lvl slog.Level
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "", "info":
		lvl = slog.LevelInfo
	case "debug":
		lvl = slog.LevelDebug
	case "warn", "warning":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		return nil, fmt.Errorf("unknown log level: %s", level)
	}

	opts := &slog.HandlerOptions{Level: lvl}

	switch strings.ToLower(strings.TrimSpace(format)) {
	case "", "json":
		h = slog.NewJSONHandler(out, opts)
	case "text":
		h = slog.NewTextHandler(out, opts)
	default:
		return nil, fmt.Errorf("unknown log format: %s", format)
	}

	return slog.New(h), nil
}
