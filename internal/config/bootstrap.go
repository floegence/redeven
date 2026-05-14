package config

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	directv1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/direct/v1"
)

type BootstrapArgs struct {
	ControlplaneBaseURL    string
	ControlplaneProviderID string
	EnvironmentID          string
	BootstrapTicket        string
	RuntimeVersion         string

	StateRoot string

	AgentHomeDir string
	Shell        string
	LogFormat    string
	LogLevel     string

	// PermissionPolicyPreset is an optional preset used to write permission_policy into the config.
	// If empty, bootstrap preserves the existing permission_policy when possible, otherwise uses defaults.
	PermissionPolicyPreset string
}

type ProviderLinkBootstrapArgs struct {
	ConfigPath string

	ControlplaneBaseURL    string
	ControlplaneProviderID string
	EnvironmentID          string
	BootstrapTicket        string
	RuntimeVersion         string
	PermissionPolicyPreset string
	AgentHomeDir           string
	Shell                  string
	LogFormat              string
	LogLevel               string

	RuntimeHostname string
	RuntimeGOOS     string
	RuntimeGOARCH   string

	PreservePermissionPolicy bool
}

type bootstrapResponse struct {
	Direct                  *directv1.DirectConnectInfo `json:"direct"`
	LocalEnvironmentBinding *LocalEnvironmentBinding    `json:"local_environment_binding"`
}

type LocalEnvironmentBinding struct {
	LocalEnvironmentPublicID string `json:"local_environment_public_id"`
	UserPublicID             string `json:"user_public_id,omitempty"`
	EnvPublicID              string `json:"env_public_id"`
	Generation               int64  `json:"generation"`
	Hostname                 string `json:"hostname,omitempty"`
	OS                       string `json:"os,omitempty"`
	Arch                     string `json:"arch,omitempty"`
	RuntimeVersion           string `json:"runtime_version,omitempty"`
	LastSeenAtUnixMS         int64  `json:"last_seen_at_unix_ms,omitempty"`
}

type providerDiscoveryResponse struct {
	ProviderID string `json:"provider_id"`
}

type bootstrapTicketExchangeRequest struct {
	EnvPublicID              string `json:"env_public_id"`
	LocalEnvironmentPublicID string `json:"local_environment_public_id"`
	AgentInstanceID          string `json:"agent_instance_id"`
	Hostname                 string `json:"hostname,omitempty"`
	OS                       string `json:"os,omitempty"`
	Arch                     string `json:"arch,omitempty"`
	RuntimeVersion           string `json:"runtime_version,omitempty"`
}

func BootstrapConfig(ctx context.Context, args BootstrapArgs) (writtenPath string, err error) {
	layout, err := resolveBootstrapStateLayout(args)
	if err != nil {
		return "", err
	}
	linkArgs := providerLinkArgsFromBootstrapArgs(args)
	linkArgs.ConfigPath = layout.ConfigPath
	cfg, err := ResolveProviderLinkConfig(ctx, linkArgs)
	if err != nil {
		return "", err
	}
	if err := Save(layout.ConfigPath, cfg); err != nil {
		return "", err
	}
	return filepath.Clean(layout.ConfigPath), nil
}

func providerLinkArgsFromBootstrapArgs(args BootstrapArgs) ProviderLinkBootstrapArgs {
	return ProviderLinkBootstrapArgs{
		ControlplaneBaseURL:      args.ControlplaneBaseURL,
		ControlplaneProviderID:   args.ControlplaneProviderID,
		EnvironmentID:            args.EnvironmentID,
		BootstrapTicket:          args.BootstrapTicket,
		RuntimeVersion:           args.RuntimeVersion,
		PermissionPolicyPreset:   args.PermissionPolicyPreset,
		AgentHomeDir:             args.AgentHomeDir,
		Shell:                    args.Shell,
		LogFormat:                args.LogFormat,
		LogLevel:                 args.LogLevel,
		RuntimeHostname:          hostnameBestEffort(),
		RuntimeGOOS:              runtime.GOOS,
		RuntimeGOARCH:            runtime.GOARCH,
		PreservePermissionPolicy: strings.TrimSpace(args.PermissionPolicyPreset) == "",
	}
}

func BootstrapProviderLink(ctx context.Context, args ProviderLinkBootstrapArgs) (*Config, error) {
	cfgPath := strings.TrimSpace(args.ConfigPath)
	if cfgPath == "" {
		return nil, errors.New("missing config path")
	}
	cfg, err := ResolveProviderLinkConfig(ctx, args)
	if err != nil {
		return nil, err
	}
	if err := Save(cfgPath, cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

func ResolveProviderLinkConfig(ctx context.Context, args ProviderLinkBootstrapArgs) (*Config, error) {
	baseURL := strings.TrimSpace(args.ControlplaneBaseURL)
	envID := strings.TrimSpace(args.EnvironmentID)
	bootstrapTicket := normalizeBearerToken(args.BootstrapTicket)
	cfgPath := strings.TrimSpace(args.ConfigPath)
	if cfgPath == "" {
		return nil, errors.New("missing config path")
	}
	if baseURL == "" || envID == "" {
		return nil, errors.New("missing controlplane/env-id")
	}
	if bootstrapTicket == "" {
		return nil, errors.New("missing bootstrap ticket")
	}

	var prev *Config
	if c, loadErr := Load(cfgPath); loadErr == nil {
		prev = c
	}
	agentInstanceID := ""
	localEnvironmentPublicID := ""
	if prev != nil {
		agentInstanceID = strings.TrimSpace(prev.AgentInstanceID)
		localEnvironmentPublicID = strings.TrimSpace(prev.LocalEnvironmentPublicID)
	}
	if agentInstanceID == "" {
		var err error
		agentInstanceID, err = newAgentInstanceID()
		if err != nil {
			return nil, err
		}
	}
	if localEnvironmentPublicID == "" {
		var err error
		localEnvironmentPublicID, err = newLocalEnvironmentPublicID()
		if err != nil {
			return nil, err
		}
	}

	bootstrap, err := exchangeBootstrapTicket(ctx, baseURL, envID, bootstrapTicket, bootstrapTicketExchangeRequest{
		EnvPublicID:              envID,
		LocalEnvironmentPublicID: localEnvironmentPublicID,
		AgentInstanceID:          agentInstanceID,
		Hostname:                 firstNonEmpty(args.RuntimeHostname, hostnameBestEffort()),
		OS:                       firstNonEmpty(args.RuntimeGOOS, runtime.GOOS),
		Arch:                     firstNonEmpty(args.RuntimeGOARCH, runtime.GOARCH),
		RuntimeVersion:           strings.TrimSpace(args.RuntimeVersion),
	})
	if err != nil {
		return nil, err
	}
	direct := bootstrap.Direct
	binding := bootstrap.LocalEnvironmentBinding
	if binding == nil {
		return nil, errors.New("invalid bootstrap exchange response: missing local_environment_binding")
	}
	if strings.TrimSpace(binding.LocalEnvironmentPublicID) != localEnvironmentPublicID {
		return nil, errors.New("invalid bootstrap exchange response: local_environment_public_id mismatch")
	}
	if strings.TrimSpace(binding.EnvPublicID) != envID {
		return nil, errors.New("invalid bootstrap exchange response: env_public_id mismatch")
	}
	if binding.Generation <= 0 {
		return nil, errors.New("invalid bootstrap exchange response: missing binding generation")
	}
	if direct == nil || strings.TrimSpace(direct.WsUrl) == "" {
		return nil, errors.New("invalid bootstrap response: missing direct.ws_url")
	}

	providerID := strings.TrimSpace(args.ControlplaneProviderID)
	if providerID == "" && prev != nil {
		prevBaseURL, prevErr := normalizeControlplaneBaseURL(prev.ControlplaneBaseURL)
		nextBaseURL, nextErr := normalizeControlplaneBaseURL(baseURL)
		if prevErr == nil && nextErr == nil && prevBaseURL == nextBaseURL && strings.TrimSpace(prev.EnvironmentID) == envID {
			providerID = strings.TrimSpace(prev.ControlplaneProviderID)
		}
	}
	if discoveredProviderID, discoveryErr := fetchProviderDiscoveryID(ctx, baseURL); discoveryErr == nil {
		providerID = discoveredProviderID
	}

	agentHomeDir := strings.TrimSpace(args.AgentHomeDir)
	if agentHomeDir == "" && prev != nil {
		agentHomeDir = strings.TrimSpace(prev.AgentHomeDir)
	}

	shell := strings.TrimSpace(args.Shell)
	if shell == "" && prev != nil {
		shell = strings.TrimSpace(prev.Shell)
	}

	logFormat := strings.TrimSpace(args.LogFormat)
	if logFormat == "" && prev != nil {
		logFormat = strings.TrimSpace(prev.LogFormat)
	}

	logLevel := strings.TrimSpace(args.LogLevel)
	if logLevel == "" && prev != nil {
		logLevel = strings.TrimSpace(prev.LogLevel)
	}

	cfg := &Config{
		ControlplaneBaseURL:      baseURL,
		ControlplaneProviderID:   providerID,
		EnvironmentID:            envID,
		LocalEnvironmentPublicID: localEnvironmentPublicID,
		BindingGeneration:        binding.Generation,
		AgentInstanceID:          agentInstanceID,
		Direct:                   direct,
		AI:                       nil,
		PermissionPolicy:         nil,
		AgentHomeDir:             agentHomeDir,
		Shell:                    shell,
		LogFormat:                logFormat,
		LogLevel:                 logLevel,
	}

	// Write permission_policy explicitly so users can audit what is enabled locally.
	// If the flag is not provided, keep the previous policy when possible.
	if strings.TrimSpace(args.PermissionPolicyPreset) != "" {
		p, err := ParsePermissionPolicyPreset(args.PermissionPolicyPreset)
		if err != nil {
			return nil, err
		}
		cfg.PermissionPolicy = p
	} else if args.PreservePermissionPolicy && prev != nil && prev.PermissionPolicy != nil {
		cfg.PermissionPolicy = prev.PermissionPolicy
	} else {
		cfg.PermissionPolicy = defaultPermissionPolicy()
	}

	// Preserve AI config when bootstrapping, so users don't accidentally lose their local model/provider setup.
	if prev != nil && prev.AI != nil {
		cfg.AI = prev.AI
	}

	// Preserve Code App port range tweaks (Settings UI).
	if prev != nil {
		cfg.CodeServerPortMin = prev.CodeServerPortMin
		cfg.CodeServerPortMax = prev.CodeServerPortMax
	}
	return cfg, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func resolveBootstrapStateLayout(args BootstrapArgs) (StateLayout, error) {
	return LocalEnvironmentStateLayout(args.StateRoot)
}

func exchangeBootstrapTicket(ctx context.Context, baseURL string, envID string, bootstrapTicket string, exchange bootstrapTicketExchangeRequest) (*bootstrapResponse, error) {
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return nil, fmt.Errorf("invalid controlplane url: %w", err)
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/api/rcpp/v1/runtime/bootstrap/exchange"
	u.RawQuery = ""

	exchange.EnvPublicID = strings.TrimSpace(envID)
	payload, err := json.Marshal(exchange)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+bootstrapTicket)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("bootstrap exchange failed: %s", strings.TrimSpace(string(body)))
	}

	var out bootstrapResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("invalid bootstrap exchange json: %w", err)
	}
	if out.Direct == nil || strings.TrimSpace(out.Direct.WsUrl) == "" {
		return nil, errors.New("invalid bootstrap exchange response: missing direct")
	}
	return &out, nil
}

func fetchProviderDiscoveryID(ctx context.Context, baseURL string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return "", fmt.Errorf("invalid controlplane url: %w", err)
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/.well-known/redeven-provider.json"
	u.RawQuery = ""

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("provider discovery failed: status=%d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}

	var discovery providerDiscoveryResponse
	if err := json.Unmarshal(body, &discovery); err != nil {
		return "", fmt.Errorf("invalid provider discovery json: %w", err)
	}
	providerID := strings.TrimSpace(discovery.ProviderID)
	if providerID == "" {
		return "", errors.New("invalid provider discovery: missing provider_id")
	}
	return providerID, nil
}

func newAgentInstanceID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	// Prefix keeps the value self-descriptive in logs and debugging tools.
	return "ai_" + base64.RawURLEncoding.EncodeToString(b), nil
}

func newLocalEnvironmentPublicID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "le_" + base64.RawURLEncoding.EncodeToString(b), nil
}

func hostnameBestEffort() string {
	hostname, err := os.Hostname()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(hostname)
}

func normalizeBearerToken(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	parts := strings.Fields(s)
	if len(parts) == 2 && strings.EqualFold(parts[0], "bearer") {
		return strings.TrimSpace(parts[1])
	}
	return s
}
