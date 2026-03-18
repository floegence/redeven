package codeapp

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/redeven-agent/internal/ai"
	"github.com/floegence/redeven-agent/internal/auditlog"
	"github.com/floegence/redeven-agent/internal/codeapp/codeserver"
	"github.com/floegence/redeven-agent/internal/codeapp/gateway"
	"github.com/floegence/redeven-agent/internal/codeapp/registry"
	"github.com/floegence/redeven-agent/internal/codeapp/ui"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/diagnostics"
	envui "github.com/floegence/redeven-agent/internal/envapp/ui"
	"github.com/floegence/redeven-agent/internal/pathutil"
	"github.com/floegence/redeven-agent/internal/portforward"
	pfregistry "github.com/floegence/redeven-agent/internal/portforward/registry"
	"github.com/floegence/redeven-agent/internal/session"
	"github.com/floegence/redeven-agent/internal/settings"
)

const (
	// FloeAppCode is the floe_app id used for code-server sessions.
	FloeAppCode = "com.floegence.redeven.code"
)

type Options struct {
	Logger   *slog.Logger
	StateDir string
	// ConfigPath is the absolute path to the agent config file (used to persist settings updates from the Env App UI).
	ConfigPath          string
	ControlplaneBaseURL string

	// CodeServerPortMin/Max configures the dynamic port range used for code-server processes.
	// If unset/invalid, a safe default range is used.
	CodeServerPortMin int
	CodeServerPortMax int

	// Env/App-level context (used by AI tools).
	AgentHomeDir string
	Shell        string

	AIConfig    *config.AIConfig
	Audit       *auditlog.Store
	Diagnostics *diagnostics.Store
	// LocalUIEnabled enables Local UI-specific runtime behavior such as shorter
	// code-server reconnection grace and local gateway routing.
	LocalUIEnabled          bool
	ResolveSessionMeta      func(channelID string) (*session.Meta, bool)
	ResolveSessionTunnelURL func(channelID string) (string, bool)
}

type Service struct {
	log          *slog.Logger
	stateDir     string
	agentHomeDir string

	// controlplane origin is the Region Portal base (scheme + <region>.<base-domain>).
	// Trusted launcher origins are derived from it as:
	//   <sandbox_id>.<region>.<base-sandbox-domain>
	cpOrigin controlplaneOrigin

	codePortMin int
	codePortMax int

	reg    *registry.Registry
	pf     *portforward.Service
	runner *codeserver.Runner
	ai     *ai.Service
	gw     *gateway.Gateway
}

func New(ctx context.Context, opts Options) (*Service, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	stateDir := strings.TrimSpace(opts.StateDir)
	if stateDir == "" {
		return nil, errors.New("missing StateDir")
	}
	stateAbs, err := filepath.Abs(stateDir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(stateAbs, 0o700); err != nil {
		return nil, err
	}
	agentHomeDir, err := pathutil.CanonicalizeExistingDirAbs(opts.AgentHomeDir)
	if err != nil {
		return nil, err
	}

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
		// Local UI keeps code-server on the same machine, so keeping extension-host reconnect
		// grace in hours only accumulates stale hosts and lock contention after refreshes.
		reconnectionGrace = 30 * time.Second
	}
	runner := codeserver.NewRunner(codeserver.RunnerOptions{
		Logger:            logger,
		StateDir:          stateAbs,
		PortMin:           portMin,
		PortMax:           portMax,
		ReconnectionGrace: reconnectionGrace,
	})

	svc := &Service{
		log:          logger,
		stateDir:     stateAbs,
		agentHomeDir: agentHomeDir,
		cpOrigin:     cpOrigin,
		codePortMin:  portMin,
		codePortMax:  portMax,
		reg:          reg,
		pf:           pfSvc,
		runner:       runner,
	}

	secrets := settings.NewSecretsStore(filepath.Join(stateAbs, "secrets.json"))

	aiSvc, err := ai.NewService(ai.Options{
		Logger:       logger,
		StateDir:     stateAbs,
		AgentHomeDir: agentHomeDir,
		Shell:        strings.TrimSpace(opts.Shell),
		Config:       opts.AIConfig,
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

	gw, err := gateway.New(gateway.Options{
		Logger:                  logger,
		DistFS:                  mergedFS{primary: ui.DistFS(), secondary: envui.DistFS()},
		Backend:                 svc,
		PortForward:             pfSvc,
		AI:                      aiSvc,
		Audit:                   opts.Audit,
		Diagnostics:             opts.Diagnostics,
		ResolveSessionMeta:      opts.ResolveSessionMeta,
		ResolveSessionTunnelURL: opts.ResolveSessionTunnelURL,
		ConfigPath:              strings.TrimSpace(opts.ConfigPath),
		SecretsStore:            secrets,
		ListenAddr:              "127.0.0.1:0",
	})
	if err != nil {
		_ = reg.Close()
		_ = pfSvc.Close()
		_ = aiSvc.Close()
		return nil, err
	}
	if err := gw.Start(ctx); err != nil {
		_ = reg.Close()
		_ = pfSvc.Close()
		_ = aiSvc.Close()
		return nil, err
	}
	svc.gw = gw
	svc.ai = aiSvc

	return svc, nil
}

func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	if s.gw != nil {
		_ = s.gw.Close()
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
	if s.ai != nil {
		_ = s.ai.Close()
	}
	return nil
}

func (s *Service) GatewayURL() string {
	if s == nil || s.gw == nil {
		return ""
	}
	return s.gw.URL()
}

func (s *Service) Gateway() *gateway.Gateway {
	if s == nil {
		return nil
	}
	return s.gw
}

func (s *Service) AI() *ai.Service {
	if s == nil {
		return nil
	}
	return s.ai
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
	return s.cpOrigin.trustedLauncherOrigin("cs-" + id)
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
	return s.cpOrigin.trustedLauncherOrigin("pf-" + id)
}

func (s *Service) ExternalOriginForEnvApp(envPublicID string) (string, error) {
	if s == nil {
		return "", errors.New("nil service")
	}
	sandboxID, err := envSandboxIDFromEnvPublicID(envPublicID)
	if err != nil {
		return "", err
	}
	return s.cpOrigin.trustedLauncherOrigin(sandboxID)
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
