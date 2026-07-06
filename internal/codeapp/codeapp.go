package codeapp

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/auditlog"
	"github.com/floegence/redeven/internal/capabilities/containers"
	"github.com/floegence/redeven/internal/codeapp/appserver"
	"github.com/floegence/redeven/internal/codeapp/codeserver"
	"github.com/floegence/redeven/internal/codeapp/registry"
	"github.com/floegence/redeven/internal/codeapp/ui"
	"github.com/floegence/redeven/internal/codexbridge"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/diagnostics"
	envui "github.com/floegence/redeven/internal/envapp/ui"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/notes"
	"github.com/floegence/redeven/internal/portforward"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
	"github.com/floegence/redeven/internal/redevpluginintegration"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/settings"
	"github.com/floegence/redeven/internal/terminal"
	"github.com/floegence/redeven/internal/threadreadstate"
	"github.com/floegence/redeven/internal/workbenchlayout"
)

const (
	// FloeAppCode is the floe_app id used for code-server sessions.
	FloeAppCode = "com.floegence.redeven.code"
)

type Options struct {
	Logger    *slog.Logger
	StateDir  string
	StateRoot string
	// ConfigPath is the absolute path to the runtime config file (used to persist settings updates from the Env App UI).
	ConfigPath          string
	ControlplaneBaseURL string

	// CodeServerPortMin/Max configures the dynamic port range used for code-server processes.
	// If unset/invalid, a safe default range is used.
	CodeServerPortMin int
	CodeServerPortMax int

	// Env/App-level context (used by AI tools).
	AgentHomeDir    string
	FilesystemScope *filesystemscope.Registry
	Shell           string

	AIConfig    *config.AIConfig
	Audit       *auditlog.Store
	Diagnostics *diagnostics.Store
	Terminal    *terminal.Manager
	// LocalUIEnabled enables Local UI-specific runtime behavior such as shorter
	// code-server reconnection grace and local app-server routing.
	LocalUIEnabled          bool
	ResolveSessionMeta      func(channelID string) (*session.Meta, bool)
	ResolveSessionTunnelURL func(channelID string) (string, bool)
}

type Service struct {
	log          *slog.Logger
	stateDir     string
	agentHomeDir string
	scope        *filesystemscope.Registry

	// Control plane origin is the environment URL base (scheme + <region>.<base-domain>).
	// Trusted launcher origins are derived from it as:
	//   <sandbox_id>.<region>.<base-sandbox-domain>
	cpOriginMu sync.RWMutex
	cpOrigin   controlplaneOrigin

	codePortMin int
	codePortMax int

	reg     *registry.Registry
	pf      *portforward.Service
	runner  *codeserver.Runner
	runtime *codeserver.RuntimeManager
	notes   *notes.Service
	layouts *workbenchlayout.Service
	ai      *ai.Service
	codex   *codexbridge.Manager
	reads   *threadreadstate.Store
	appSrv  *appserver.Server

	pluginIntegration *redevpluginintegration.Integration

	terminalLayoutCleanup func()
}

func New(ctx context.Context, opts Options) (*Service, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	stateDir := strings.TrimSpace(opts.StateDir)
	if stateDir == "" {
		return nil, errors.New("missing StateDir")
	}
	stateRoot := strings.TrimSpace(opts.StateRoot)
	if stateRoot == "" {
		return nil, errors.New("missing StateRoot")
	}
	stateAbs, err := filepath.Abs(stateDir)
	if err != nil {
		return nil, err
	}
	stateRootAbs, err := filepath.Abs(stateRoot)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(stateAbs, 0o700); err != nil {
		return nil, err
	}
	scope := opts.FilesystemScope
	if scope == nil {
		scope, err = filesystemscope.NewDefaultRegistry(opts.AgentHomeDir)
		if err != nil {
			return nil, err
		}
	}
	agentHomeDir := scope.HomePathAbs()

	cpOrigin, err := parseControlplaneBase(strings.TrimSpace(opts.ControlplaneBaseURL))
	if err != nil {
		return nil, err
	}

	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}

	codeRoot := filepath.Join(stateAbs, "apps", "code")
	if err := os.MkdirAll(codeRoot, 0o700); err != nil {
		return nil, err
	}

	regPath := filepath.Join(codeRoot, "registry.sqlite")
	reg, err := registry.Open(regPath)
	if err != nil {
		return nil, err
	}

	pfRoot := filepath.Join(stateAbs, "apps", "portforward")
	if err := os.MkdirAll(pfRoot, 0o700); err != nil {
		_ = reg.Close()
		return nil, err
	}
	pfRegPath := filepath.Join(pfRoot, "registry.sqlite")
	pfReg, err := pfregistry.Open(pfRegPath)
	if err != nil {
		_ = reg.Close()
		return nil, err
	}
	pfSvc, err := portforward.New(pfReg)
	if err != nil {
		_ = reg.Close()
		_ = pfReg.Close()
		return nil, err
	}

	portMin, portMax := normalizePortRange(opts.CodeServerPortMin, opts.CodeServerPortMax)
	reconnectionGrace := time.Duration(0)
	if opts.LocalUIEnabled {
		// Local UI keeps code-server on the same host, so keeping extension-host reconnect
		// grace in hours only accumulates stale hosts and lock contention after refreshes.
		reconnectionGrace = 30 * time.Second
	}
	runner := codeserver.NewRunner(codeserver.RunnerOptions{
		Logger:            logger,
		StateDir:          stateAbs,
		StateRoot:         stateRootAbs,
		PortMin:           portMin,
		PortMax:           portMax,
		ReconnectionGrace: reconnectionGrace,
	})
	runtimeMgr := codeserver.NewRuntimeManager(codeserver.RuntimeManagerOptions{
		Logger:    logger,
		StateDir:  stateAbs,
		StateRoot: stateRootAbs,
	})

	svc := &Service{
		log:          logger,
		stateDir:     stateAbs,
		agentHomeDir: agentHomeDir,
		scope:        scope,
		cpOrigin:     cpOrigin,
		codePortMin:  portMin,
		codePortMax:  portMax,
		reg:          reg,
		pf:           pfSvc,
		runner:       runner,
		runtime:      runtimeMgr,
	}

	secrets := settings.NewSecretsStore(filepath.Join(stateAbs, "secrets.json"))

	aiSvc, err := ai.NewService(ai.Options{
		Logger:          logger,
		StateDir:        stateAbs,
		AgentHomeDir:    agentHomeDir,
		FilesystemScope: scope,
		Shell:           strings.TrimSpace(opts.Shell),
		Config:          opts.AIConfig,
		ResolveProviderAPIKey: func(providerID string) (string, bool, error) {
			return secrets.GetAIProviderAPIKey(providerID)
		},
		ResolveWebSearchProviderAPIKey: func(providerID string) (string, bool, error) {
			return secrets.GetWebSearchProviderAPIKey(providerID)
		},
	})
	if err != nil {
		_ = reg.Close()
		_ = pfSvc.Close()
		return nil, err
	}

	codexSvc, err := codexbridge.NewManager(codexbridge.Options{
		Logger:       logger,
		AgentHomeDir: agentHomeDir,
		Shell:        strings.TrimSpace(opts.Shell),
		Diagnostics:  opts.Diagnostics,
	})
	if err != nil {
		_ = reg.Close()
		_ = pfSvc.Close()
		_ = aiSvc.Close()
		return nil, err
	}

	threadReadStatePath, err := appServerThreadReadStatePath(stateAbs)
	if err != nil {
		_ = reg.Close()
		_ = pfSvc.Close()
		_ = aiSvc.Close()
		_ = codexSvc.Close()
		return nil, err
	}
	threadReadStateStore, err := threadreadstate.OpenResettingInvalidSchema(threadReadStatePath)
	if err != nil {
		_ = reg.Close()
		_ = pfSvc.Close()
		_ = aiSvc.Close()
		_ = codexSvc.Close()
		return nil, err
	}

	notesPath := filepath.Join(stateAbs, "apps", "notes", "notes.sqlite")
	notesSvc, err := notes.Open(notesPath)
	if err != nil {
		_ = reg.Close()
		_ = pfSvc.Close()
		_ = aiSvc.Close()
		_ = codexSvc.Close()
		_ = threadReadStateStore.Close()
		return nil, err
	}
	workbenchLayoutPath := filepath.Join(stateAbs, "apps", "workbench", "layout.sqlite")
	workbenchLayoutSvc, err := workbenchlayout.Open(workbenchLayoutPath)
	if err != nil {
		_ = reg.Close()
		_ = pfSvc.Close()
		_ = notesSvc.Close()
		_ = aiSvc.Close()
		_ = codexSvc.Close()
		_ = threadReadStateStore.Close()
		return nil, err
	}
	if err := reconcileWorkbenchTerminalSessions(ctx, logger, workbenchLayoutSvc, opts.Terminal); err != nil {
		_ = reg.Close()
		_ = pfSvc.Close()
		_ = notesSvc.Close()
		_ = workbenchLayoutSvc.Close()
		_ = aiSvc.Close()
		_ = codexSvc.Close()
		_ = threadReadStateStore.Close()
		return nil, err
	}
	terminalLayoutCleanup := registerWorkbenchTerminalSessionCleanup(logger, workbenchLayoutSvc, opts.Terminal)

	pluginIntegration, err := redevpluginintegration.New(ctx, redevpluginintegration.Options{
		Logger:             logger,
		StateDir:           stateAbs,
		StateRoot:          stateRootAbs,
		ConfigPath:         strings.TrimSpace(opts.ConfigPath),
		ResolveSessionMeta: resolvePluginPlatformSessionMeta(opts),
		Audit:              opts.Audit,
		Diagnostics:        opts.Diagnostics,
		Containers:         containers.NewAdapter(containers.NewCLIClient()),
	})
	if err != nil {
		terminalLayoutCleanup()
		_ = reg.Close()
		_ = pfSvc.Close()
		_ = notesSvc.Close()
		_ = workbenchLayoutSvc.Close()
		_ = aiSvc.Close()
		_ = codexSvc.Close()
		_ = threadReadStateStore.Close()
		return nil, err
	}

	appSrv, err := appserver.New(appserver.Options{
		Logger:                  logger,
		DistFS:                  mergedFS{primary: ui.DistFS(), secondary: envui.DistFS()},
		Backend:                 svc,
		PortForward:             pfSvc,
		AI:                      aiSvc,
		Notes:                   notesSvc,
		WorkbenchLayout:         workbenchLayoutSvc,
		Terminal:                opts.Terminal,
		Codex:                   codexSvc,
		Audit:                   opts.Audit,
		Diagnostics:             opts.Diagnostics,
		ResolveSessionMeta:      opts.ResolveSessionMeta,
		ResolveSessionTunnelURL: opts.ResolveSessionTunnelURL,
		ConfigPath:              strings.TrimSpace(opts.ConfigPath),
		SecretsStore:            secrets,
		ThreadReadStateStore:    threadReadStateStore,
		PluginPlatform:          pluginIntegration.Handler(),
		AgentHomeDir:            agentHomeDir,
		FilesystemScope:         scope,
		ListenAddr:              "127.0.0.1:0",
	})
	if err != nil {
		_ = pluginIntegration.Close()
		terminalLayoutCleanup()
		_ = reg.Close()
		_ = pfSvc.Close()
		_ = notesSvc.Close()
		_ = workbenchLayoutSvc.Close()
		_ = aiSvc.Close()
		_ = codexSvc.Close()
		_ = threadReadStateStore.Close()
		return nil, err
	}
	if err := appSrv.Start(ctx); err != nil {
		_ = pluginIntegration.Close()
		terminalLayoutCleanup()
		_ = reg.Close()
		_ = pfSvc.Close()
		_ = notesSvc.Close()
		_ = workbenchLayoutSvc.Close()
		_ = aiSvc.Close()
		_ = codexSvc.Close()
		_ = threadReadStateStore.Close()
		return nil, err
	}
	svc.appSrv = appSrv
	svc.notes = notesSvc
	svc.layouts = workbenchLayoutSvc
	svc.ai = aiSvc
	svc.codex = codexSvc
	svc.reads = threadReadStateStore
	svc.pluginIntegration = pluginIntegration
	svc.terminalLayoutCleanup = terminalLayoutCleanup

	return svc, nil
}

func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	if s.appSrv != nil {
		_ = s.appSrv.Close()
	}
	if s.runner != nil {
		_ = s.runner.StopAll()
	}
	if s.reg != nil {
		_ = s.reg.Close()
	}
	if s.pf != nil {
		_ = s.pf.Close()
	}
	if s.notes != nil {
		_ = s.notes.Close()
	}
	if s.terminalLayoutCleanup != nil {
		s.terminalLayoutCleanup()
	}
	if s.layouts != nil {
		_ = s.layouts.Close()
	}
	if s.ai != nil {
		_ = s.ai.Close()
	}
	if s.reads != nil {
		_ = s.reads.Close()
	}
	if s.pluginIntegration != nil {
		_ = s.pluginIntegration.Close()
	}
	if s.codex != nil {
		_ = s.codex.Close()
	}
	return nil
}

func resolvePluginPlatformSessionMeta(opts Options) func(channelID string) (*session.Meta, bool) {
	base := opts.ResolveSessionMeta
	return func(channelID string) (*session.Meta, bool) {
		channelID = strings.TrimSpace(channelID)
		if base != nil {
			if meta, ok := base(channelID); ok && meta != nil {
				return meta, true
			}
		}
		if opts.LocalUIEnabled && channelID == appserver.LocalUIChannelID {
			return appserver.LocalEnvSessionMeta(strings.TrimSpace(opts.ConfigPath)), true
		}
		return nil, false
	}
}

func (s *Service) AppServerURL() string {
	if s == nil || s.appSrv == nil {
		return ""
	}
	return s.appSrv.URL()
}

func (s *Service) AppServer() *appserver.Server {
	if s == nil {
		return nil
	}
	return s.appSrv
}

func appServerThreadReadStatePath(stateAbs string) (string, error) {
	currentDir := filepath.Join(stateAbs, "apps", "appserver")
	if err := os.MkdirAll(currentDir, 0o700); err != nil {
		return "", err
	}
	currentPath := filepath.Join(currentDir, "thread_read_state.sqlite")
	legacyPath := filepath.Join(stateAbs, "gateway", "thread_read_state.sqlite")
	if err := migrateSQLiteStoreIfCurrentMissing(legacyPath, currentPath); err != nil {
		return "", err
	}
	return currentPath, nil
}

func migrateSQLiteStoreIfCurrentMissing(legacyPath string, currentPath string) error {
	if _, err := os.Stat(currentPath); err == nil {
		return nil
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}

	info, err := os.Stat(legacyPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("legacy app server store path is a directory: %s", legacyPath)
	}

	if err := os.MkdirAll(filepath.Dir(currentPath), 0o700); err != nil {
		return err
	}
	var suffixesToMove []string
	for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
		from := legacyPath + suffix
		to := currentPath + suffix
		if _, err := os.Stat(from); errors.Is(err, os.ErrNotExist) {
			continue
		} else if err != nil {
			return err
		}
		if _, err := os.Stat(to); err == nil {
			return fmt.Errorf("cannot migrate legacy app server store because destination exists: %s", to)
		} else if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		suffixesToMove = append(suffixesToMove, suffix)
	}
	for _, suffix := range suffixesToMove {
		from := legacyPath + suffix
		to := currentPath + suffix
		if err := os.Rename(from, to); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) AI() *ai.Service {
	if s == nil {
		return nil
	}
	return s.ai
}

func ValidateControlplaneBaseURL(raw string) error {
	_, err := parseControlplaneBase(strings.TrimSpace(raw))
	return err
}

func (s *Service) SetControlplaneBaseURL(raw string) error {
	if s == nil {
		return errors.New("nil service")
	}
	cpOrigin, err := parseControlplaneBase(strings.TrimSpace(raw))
	if err != nil {
		return err
	}
	s.cpOriginMu.Lock()
	s.cpOrigin = cpOrigin
	s.cpOriginMu.Unlock()
	return nil
}

func (s *Service) controlplaneOrigin() controlplaneOrigin {
	if s == nil {
		return controlplaneOrigin{}
	}
	s.cpOriginMu.RLock()
	defer s.cpOriginMu.RUnlock()
	return s.cpOrigin
}

func (s *Service) ExternalOriginForCodeSpace(codeSpaceID string) (string, error) {
	if s == nil {
		return "", errors.New("nil service")
	}
	id := strings.TrimSpace(codeSpaceID)
	if id == "" {
		return "", errors.New("missing codeSpaceID")
	}
	if !IsValidCodeSpaceID(id) {
		return "", fmt.Errorf("invalid codeSpaceID: %q", id)
	}
	return s.controlplaneOrigin().trustedLauncherOrigin("cs-" + id)
}

func (s *Service) ExternalOriginForPortForward(forwardID string) (string, error) {
	if s == nil {
		return "", errors.New("nil service")
	}
	id := strings.TrimSpace(forwardID)
	if id == "" {
		return "", errors.New("missing forwardID")
	}
	if !portforward.IsValidForwardID(id) {
		return "", fmt.Errorf("invalid forwardID: %q", id)
	}
	return s.controlplaneOrigin().trustedLauncherOrigin("pf-" + id)
}

func (s *Service) ExternalOriginForEnvApp(envPublicID string) (string, error) {
	if s == nil {
		return "", errors.New("nil service")
	}
	sandboxID, err := envSandboxIDFromEnvPublicID(envPublicID)
	if err != nil {
		return "", err
	}
	return s.controlplaneOrigin().trustedLauncherOrigin(sandboxID)
}

func envSandboxIDFromEnvPublicID(envPublicID string) (string, error) {
	id := strings.ToLower(strings.TrimSpace(envPublicID))
	if id == "" {
		return "", errors.New("missing envPublicID")
	}
	if !strings.HasPrefix(id, "env_") {
		return "", fmt.Errorf("invalid envPublicID: %q", envPublicID)
	}
	suffix := strings.TrimPrefix(id, "env_")
	if suffix == "" {
		return "", fmt.Errorf("invalid envPublicID: %q", envPublicID)
	}
	// DNS label limit: 63 chars. "env-"(4) + suffix(<=59) = 63.
	if len(suffix) > 59 {
		return "", fmt.Errorf("invalid envPublicID: %q", envPublicID)
	}
	for i := 0; i < len(suffix); i++ {
		c := suffix[i]
		isLower := c >= 'a' && c <= 'z'
		isDigit := c >= '0' && c <= '9'
		if isLower || isDigit || c == '-' {
			continue
		}
		return "", fmt.Errorf("invalid envPublicID: %q", envPublicID)
	}
	return "env-" + suffix, nil
}

func normalizePortRange(min int, max int) (int, int) {
	// Keep a safe high-port range by default.
	const defaultMin = 20000
	const defaultMax = 21000

	if min <= 0 || max <= 0 || max > 65535 {
		return defaultMin, defaultMax
	}
	if min < 1024 {
		min = 1024
	}
	if max < 1024 {
		max = 1024
	}
	if min >= max {
		return defaultMin, defaultMax
	}
	return min, max
}
