package codeapp

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven-agent/internal/ai"
	"github.com/floegence/redeven-agent/internal/auditlog"
	"github.com/floegence/redeven-agent/internal/codeapp/codeserver"
	"github.com/floegence/redeven-agent/internal/codeapp/gateway"
	"github.com/floegence/redeven-agent/internal/codeapp/registry"
	"github.com/floegence/redeven-agent/internal/codeapp/ui"
	"github.com/floegence/redeven-agent/internal/config"
	envui "github.com/floegence/redeven-agent/internal/envapp/ui"
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
	FSRoot string
	Shell  string

	AIConfig                *config.AIConfig
	Audit                   *auditlog.Store
	ResolveSessionMeta      func(channelID string) (*session.Meta, bool)
	ResolveSessionTunnelURL func(channelID string) (string, bool)
}

type Service struct {
	log      *slog.Logger
	stateDir string

	// controlplane base (scheme + <region>.<base-domain>)
	cpScheme string
	cpHost   string

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

	cpScheme, cpHost, err := parseControlplaneBase(strings.TrimSpace(opts.ControlplaneBaseURL))
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
	runner := codeserver.NewRunner(codeserver.RunnerOptions{
		Logger:   logger,
		StateDir: stateAbs,
		PortMin:  portMin,
		PortMax:  portMax,
	})

	svc := &Service{
		log:         logger,
		stateDir:    stateAbs,
		cpScheme:    cpScheme,
		cpHost:      cpHost,
		codePortMin: portMin,
		codePortMax: portMax,
		reg:         reg,
		pf:          pfSvc,
		runner:      runner,
	}

	secrets := settings.NewSecretsStore(filepath.Join(stateAbs, "secrets.json"))

	aiSvc, err := ai.NewService(ai.Options{
		Logger:             logger,
		StateDir:           stateAbs,
		FSRoot:             strings.TrimSpace(opts.FSRoot),
		Shell:              strings.TrimSpace(opts.Shell),
		Config:             opts.AIConfig,
		ResolveSessionMeta: opts.ResolveSessionMeta,
		ResolveProviderAPIKey: func(providerID string) (string, bool, error) {
			return secrets.GetAIProviderAPIKey(providerID)
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
	return fmt.Sprintf("%s://cs-%s.%s", s.cpScheme, id, s.cpHost), nil
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
	return fmt.Sprintf("%s://pf-%s.%s", s.cpScheme, id, s.cpHost), nil
}

func (s *Service) ExternalOriginForEnvApp(envPublicID string) (string, error) {
	if s == nil {
		return "", errors.New("nil service")
	}
	sandboxID, err := envSandboxIDFromEnvPublicID(envPublicID)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s://%s.%s", s.cpScheme, sandboxID, s.cpHost), nil
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

func parseControlplaneBase(raw string) (scheme string, host string, err error) {
	if raw == "" {
		return "", "", errors.New("missing ControlplaneBaseURL")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", "", err
	}
	scheme = strings.ToLower(strings.TrimSpace(u.Scheme))
	if scheme != "http" && scheme != "https" {
		return "", "", fmt.Errorf("unsupported ControlplaneBaseURL scheme: %q", u.Scheme)
	}
	host = strings.ToLower(strings.TrimSpace(u.Host))
	if host == "" {
		return "", "", errors.New("invalid ControlplaneBaseURL host")
	}
	return scheme, host, nil
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
