package config

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
)

type BootstrapArgs struct {
	ProviderOrigin         string
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
	// HTTPClient optionally supplies custom TLS trust roots while HTTPS and redirect policy remain enforced.
	HTTPClient *http.Client

	// PermissionPolicyPreset is an optional preset used to write permission_policy into the config.
	// If empty, bootstrap preserves the existing permission_policy when possible, otherwise uses defaults.
	PermissionPolicyPreset string
}

type ProviderLinkBootstrapArgs struct {
	ConfigPath string

	ProviderOrigin         string
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
	// HTTPClient optionally supplies custom TLS trust roots while HTTPS and redirect policy remain enforced.
	HTTPClient *http.Client

	RuntimeHostname string
	RuntimeGOOS     string
	RuntimeGOARCH   string

	PreservePermissionPolicy bool
}

// ProviderRuntimeLinkArgs is the explicit RCPP v3 Runtime-link input used by
// Desktop-managed linking. It is intentionally separate from the frozen v2
// bootstrap contract.
type ProviderRuntimeLinkArgs struct {
	ConfigPath string

	ProviderOrigin         string
	ControlplaneBaseURL    string
	ControlplaneProviderID string
	EnvironmentID          string
	RuntimeLinkTicket      string
	RuntimeVersion         string
	PermissionPolicyPreset string
	AgentHomeDir           string
	Shell                  string
	LogFormat              string
	LogLevel               string
	HTTPClient             *http.Client

	RuntimeHostname string
	RuntimeGOOS     string
	RuntimeGOARCH   string

	PreservePermissionPolicy bool
}

type providerLinkResolveArgs struct {
	ConfigPath string

	ProviderOrigin         string
	ControlplaneBaseURL    string
	ControlplaneProviderID string
	EnvironmentID          string
	Credential             string
	RuntimeVersion         string
	PermissionPolicyPreset string
	AgentHomeDir           string
	Shell                  string
	LogFormat              string
	LogLevel               string
	HTTPClient             *http.Client

	RuntimeHostname string
	RuntimeGOOS     string
	RuntimeGOARCH   string

	PreservePermissionPolicy bool
}

type bootstrapResponse struct {
	ProviderID              string                        `json:"provider_id"`
	ProviderOrigin          string                        `json:"provider_origin"`
	AccessPointID           string                        `json:"access_point_id"`
	AccessPointOrigin       string                        `json:"access_point_origin"`
	EnvPublicID             string                        `json:"env_public_id"`
	ControlArtifactPool     *bootstrapControlArtifactPool `json:"control_artifact_pool"`
	LocalEnvironmentBinding *LocalEnvironmentBinding      `json:"local_environment_binding"`
}

type bootstrapControlArtifactPoolEntry struct {
	ArtifactJSON      json.RawMessage `json:"artifact_json"`
	ArtifactChannelID string          `json:"artifact_channel_id"`
	BindingGeneration int64           `json:"binding_generation"`
	ArtifactSequence  uint64          `json:"artifact_sequence"`
	ExpiresAtUnixS    int64           `json:"expires_at_unix_s"`
}

type bootstrapControlArtifactPool struct {
	Version                       string                              `json:"version"`
	LogicalProviderBindingID      string                              `json:"logical_provider_binding_id"`
	BindingGeneration             int64                               `json:"binding_generation"`
	TargetWaterline               int                                 `json:"target_waterline"`
	RefreshHorizonSeconds         int64                               `json:"refresh_horizon_seconds"`
	ServerHighestArtifactSequence uint64                              `json:"server_highest_artifact_sequence"`
	Entries                       []bootstrapControlArtifactPoolEntry `json:"entries"`
	ResponseDigestB64u            string                              `json:"response_digest_b64u"`
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

type bootstrapTicketExchangeRequest struct {
	EnvPublicID                    string `json:"env_public_id"`
	ProviderOrigin                 string `json:"provider_origin"`
	LocalEnvironmentPublicID       string `json:"local_environment_public_id"`
	AgentInstanceID                string `json:"agent_instance_id"`
	BootstrapDeliveryRequestIDB64u string `json:"bootstrap_delivery_request_id_b64u"`
	Hostname                       string `json:"hostname,omitempty"`
	OS                             string `json:"os,omitempty"`
	Arch                           string `json:"arch,omitempty"`
	RuntimeVersion                 string `json:"runtime_version,omitempty"`
}

type runtimeLinkExchangeRequest struct {
	ProtocolVersion          string `json:"protocol_version"`
	EnvPublicID              string `json:"env_public_id"`
	ProviderOrigin           string `json:"provider_origin"`
	LocalEnvironmentPublicID string `json:"local_environment_public_id"`
	AgentInstanceID          string `json:"agent_instance_id"`
	DeliveryRequestIDB64u    string `json:"delivery_request_id_b64u"`
	Hostname                 string `json:"hostname,omitempty"`
	OS                       string `json:"os,omitempty"`
	Arch                     string `json:"arch,omitempty"`
	RuntimeVersion           string `json:"runtime_version,omitempty"`
}

type runtimeLinkExchangeResponse struct {
	ProtocolVersion         string                        `json:"protocol_version"`
	ProviderID              string                        `json:"provider_id"`
	ProviderOrigin          string                        `json:"provider_origin"`
	AccessPointID           string                        `json:"access_point_id"`
	AccessPointOrigin       string                        `json:"access_point_origin"`
	EnvPublicID             string                        `json:"env_public_id"`
	ControlArtifactPool     *bootstrapControlArtifactPool `json:"control_artifact_pool"`
	LocalEnvironmentBinding *LocalEnvironmentBinding      `json:"local_environment_binding"`
}

const bootstrapDeliveryAttemptVersion = 1

var errBootstrapDeliveryExpired = errors.New("bootstrap delivery expired")

type bootstrapDeliveryAttempt struct {
	Version                        int    `json:"version"`
	ProviderOrigin                 string `json:"provider_origin"`
	AccessPointOrigin              string `json:"access_point_origin"`
	EnvPublicID                    string `json:"env_public_id"`
	LocalEnvironmentPublicID       string `json:"local_environment_public_id"`
	AgentInstanceID                string `json:"agent_instance_id"`
	BootstrapDeliveryRequestIDB64u string `json:"bootstrap_delivery_request_id_b64u"`
}

type bootstrapExchangeErrorResponse struct {
	Success bool                    `json:"success"`
	Error   *bootstrapExchangeError `json:"error"`
}

type bootstrapExchangeError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
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
	if err := SaveProviderLinkConfig(layout.ConfigPath, cfg); err != nil {
		return "", err
	}
	return filepath.Clean(layout.ConfigPath), nil
}

func providerLinkArgsFromBootstrapArgs(args BootstrapArgs) ProviderLinkBootstrapArgs {
	return ProviderLinkBootstrapArgs{
		ProviderOrigin:           args.ProviderOrigin,
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
		HTTPClient:               args.HTTPClient,
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
	if err := SaveProviderLinkConfig(cfgPath, cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

func ResolveProviderLinkConfig(ctx context.Context, args ProviderLinkBootstrapArgs) (*Config, error) {
	if normalizeBearerToken(args.BootstrapTicket) == "" {
		return nil, errors.New("missing bootstrap ticket")
	}
	return resolveProviderLinkConfig(ctx, providerLinkResolveArgs{
		ConfigPath: args.ConfigPath, ProviderOrigin: args.ProviderOrigin, ControlplaneBaseURL: args.ControlplaneBaseURL,
		ControlplaneProviderID: args.ControlplaneProviderID, EnvironmentID: args.EnvironmentID,
		Credential: args.BootstrapTicket, RuntimeVersion: args.RuntimeVersion, PermissionPolicyPreset: args.PermissionPolicyPreset,
		AgentHomeDir: args.AgentHomeDir, Shell: args.Shell, LogFormat: args.LogFormat, LogLevel: args.LogLevel,
		HTTPClient: args.HTTPClient, RuntimeHostname: args.RuntimeHostname, RuntimeGOOS: args.RuntimeGOOS, RuntimeGOARCH: args.RuntimeGOARCH,
		PreservePermissionPolicy: args.PreservePermissionPolicy,
	}, exchangeProviderBootstrapCredential)
}

func ResolveProviderRuntimeLinkConfig(ctx context.Context, args ProviderRuntimeLinkArgs) (*Config, error) {
	if normalizeBearerToken(args.RuntimeLinkTicket) == "" {
		return nil, errors.New("missing Runtime link ticket")
	}
	return resolveProviderLinkConfig(ctx, providerLinkResolveArgs{
		ConfigPath: args.ConfigPath, ProviderOrigin: args.ProviderOrigin, ControlplaneBaseURL: args.ControlplaneBaseURL,
		ControlplaneProviderID: args.ControlplaneProviderID, EnvironmentID: args.EnvironmentID,
		Credential: args.RuntimeLinkTicket, RuntimeVersion: args.RuntimeVersion, PermissionPolicyPreset: args.PermissionPolicyPreset,
		AgentHomeDir: args.AgentHomeDir, Shell: args.Shell, LogFormat: args.LogFormat, LogLevel: args.LogLevel,
		HTTPClient: args.HTTPClient, RuntimeHostname: args.RuntimeHostname, RuntimeGOOS: args.RuntimeGOOS, RuntimeGOARCH: args.RuntimeGOARCH,
		PreservePermissionPolicy: args.PreservePermissionPolicy,
	}, exchangeRuntimeLinkTicket)
}

type providerLinkExchangeFunc func(context.Context, providerLinkResolveArgs, string, string, string, bootstrapDeliveryAttempt) (*bootstrapResponse, error)

func resolveProviderLinkConfig(ctx context.Context, args providerLinkResolveArgs, exchangeProviderLink providerLinkExchangeFunc) (*Config, error) {
	baseURL := strings.TrimSpace(args.ControlplaneBaseURL)
	providerOrigin := strings.TrimSpace(args.ProviderOrigin)
	envID := strings.TrimSpace(args.EnvironmentID)
	credential := normalizeBearerToken(args.Credential)
	cfgPath := strings.TrimSpace(args.ConfigPath)
	if cfgPath == "" {
		return nil, errors.New("missing config path")
	}
	if providerOrigin == "" || baseURL == "" || envID == "" {
		return nil, errors.New("missing provider/controlplane/env-id")
	}
	if credential == "" {
		return nil, errors.New("missing provider link credential")
	}
	providerOrigin, err := normalizeControlplaneBaseURL(providerOrigin)
	if err != nil {
		return nil, fmt.Errorf("invalid provider origin: %w", err)
	}
	baseURL, err = normalizeControlplaneBaseURL(baseURL)
	if err != nil {
		return nil, fmt.Errorf("invalid controlplane url: %w", err)
	}

	var prev *Config
	if c, loadErr := Load(cfgPath); loadErr == nil {
		prev = c
	}
	attempt, attemptPath, err := prepareBootstrapDeliveryAttempt(cfgPath, providerOrigin, baseURL, envID, prev)
	if err != nil {
		return nil, err
	}
	bootstrap, err := exchangeProviderLink(ctx, args, baseURL, envID, credential, attempt)
	if errors.Is(err, errBootstrapDeliveryExpired) {
		attempt, err = rotateExpiredBootstrapDeliveryAttempt(attemptPath, attempt)
		if err != nil {
			return nil, fmt.Errorf("retire expired bootstrap delivery attempt: %w", err)
		}
		bootstrap, err = exchangeProviderLink(ctx, args, baseURL, envID, credential, attempt)
	}
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(bootstrap.EnvPublicID) != envID {
		return nil, errors.New("invalid bootstrap exchange response: env_public_id mismatch")
	}
	agentInstanceID := attempt.AgentInstanceID
	localEnvironmentPublicID := attempt.LocalEnvironmentPublicID
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
	if bootstrap.ControlArtifactPool == nil {
		return nil, errors.New("invalid bootstrap response: missing control artifact pool")
	}
	controlPool, err := controlArtifactPoolFromBootstrap(*bootstrap.ControlArtifactPool, binding.Generation, time.Now())
	if err != nil {
		return nil, fmt.Errorf("invalid bootstrap control artifact pool: %w", err)
	}
	if strings.TrimSpace(bootstrap.ProviderOrigin) != providerOrigin {
		return nil, errors.New("invalid bootstrap exchange response: provider_origin mismatch")
	}
	if strings.TrimSpace(bootstrap.AccessPointOrigin) != baseURL {
		return nil, errors.New("invalid bootstrap exchange response: access_point_origin mismatch")
	}

	providerID := strings.TrimSpace(args.ControlplaneProviderID)
	responseProviderID := strings.TrimSpace(bootstrap.ProviderID)
	if providerID == "" {
		providerID = responseProviderID
	}
	if providerID == "" {
		return nil, errors.New("invalid bootstrap exchange response: missing provider_id")
	}
	if responseProviderID != "" && responseProviderID != providerID {
		return nil, errors.New("invalid bootstrap exchange response: provider_id mismatch")
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
		ProviderOrigin:                 providerOrigin,
		ControlplaneBaseURL:            baseURL,
		ControlplaneProviderID:         providerID,
		EnvironmentID:                  envID,
		LocalEnvironmentPublicID:       localEnvironmentPublicID,
		BindingGeneration:              binding.Generation,
		AgentInstanceID:                agentInstanceID,
		Direct:                         nil,
		ControlArtifactPool:            controlPool,
		AI:                             nil,
		PermissionPolicy:               nil,
		AgentHomeDir:                   agentHomeDir,
		Shell:                          shell,
		LogFormat:                      logFormat,
		LogLevel:                       logLevel,
		bootstrapDeliveryAttemptPath:   attemptPath,
		bootstrapDeliveryRequestIDB64u: attempt.BootstrapDeliveryRequestIDB64u,
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

func exchangeProviderBootstrapCredential(ctx context.Context, args providerLinkResolveArgs, baseURL string, envID string, bootstrapTicket string, delivery bootstrapDeliveryAttempt) (*bootstrapResponse, error) {
	return exchangeBootstrapTicket(ctx, args.HTTPClient, baseURL, envID, bootstrapTicket, bootstrapTicketExchangeRequest{
		EnvPublicID: envID, ProviderOrigin: delivery.ProviderOrigin,
		LocalEnvironmentPublicID: delivery.LocalEnvironmentPublicID, AgentInstanceID: delivery.AgentInstanceID,
		BootstrapDeliveryRequestIDB64u: delivery.BootstrapDeliveryRequestIDB64u,
		Hostname:                       firstNonEmpty(args.RuntimeHostname, hostnameBestEffort()), OS: firstNonEmpty(args.RuntimeGOOS, runtime.GOOS),
		Arch: firstNonEmpty(args.RuntimeGOARCH, runtime.GOARCH), RuntimeVersion: strings.TrimSpace(args.RuntimeVersion),
	})
}

func exchangeRuntimeLinkTicket(ctx context.Context, args providerLinkResolveArgs, baseURL string, envID string, runtimeLinkTicket string, delivery bootstrapDeliveryAttempt) (*bootstrapResponse, error) {
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return nil, fmt.Errorf("invalid controlplane url: %w", err)
	}
	if !strings.EqualFold(u.Scheme, "https") || strings.TrimSpace(u.Hostname()) == "" {
		return nil, errors.New("Runtime link exchange requires an HTTPS origin")
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/api/rcpp/v3/runtime-link/exchange"
	u.RawQuery = ""
	if !validCanonicalBase64URL32(delivery.BootstrapDeliveryRequestIDB64u) {
		return nil, errors.New("invalid Runtime link delivery request id")
	}
	payload, err := json.Marshal(runtimeLinkExchangeRequest{
		ProtocolVersion: "rcpp-v3", EnvPublicID: strings.TrimSpace(envID), ProviderOrigin: delivery.ProviderOrigin,
		LocalEnvironmentPublicID: delivery.LocalEnvironmentPublicID, AgentInstanceID: delivery.AgentInstanceID,
		DeliveryRequestIDB64u: delivery.BootstrapDeliveryRequestIDB64u,
		Hostname:              firstNonEmpty(args.RuntimeHostname, hostnameBestEffort()), OS: firstNonEmpty(args.RuntimeGOOS, runtime.GOOS),
		Arch: firstNonEmpty(args.RuntimeGOARCH, runtime.GOARCH), RuntimeVersion: strings.TrimSpace(args.RuntimeVersion),
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+runtimeLinkTicket)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	client := secureBootstrapHTTPClient(args.HTTPClient, u)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, ControlArtifactMaxResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read Runtime link exchange response: %w", err)
	}
	if len(body) > ControlArtifactMaxResponseBytes {
		return nil, errors.New("Runtime link exchange response exceeds exact byte bound")
	}
	if resp.StatusCode != http.StatusOK {
		var failure bootstrapExchangeErrorResponse
		if decodeErr := decodeExactBootstrapExchangeError(body, &failure); decodeErr == nil {
			if resp.StatusCode == http.StatusConflict && failure.Error.Code == "RUNTIME_LINK_DELIVERY_EXPIRED" {
				return nil, errBootstrapDeliveryExpired
			}
			return nil, fmt.Errorf("Runtime link exchange failed with HTTP %d/%s", resp.StatusCode, failure.Error.Code)
		}
		return nil, fmt.Errorf("Runtime link exchange failed with HTTP %d", resp.StatusCode)
	}
	var out runtimeLinkExchangeResponse
	if err := decodeExactRuntimeLinkResponse(body, &out); err != nil {
		return nil, fmt.Errorf("invalid Runtime link exchange json: %w", err)
	}
	if out.ProtocolVersion != "rcpp-v3" || out.ControlArtifactPool == nil {
		return nil, errors.New("invalid Runtime link exchange response contract")
	}
	return &bootstrapResponse{
		ProviderID: out.ProviderID, ProviderOrigin: out.ProviderOrigin, AccessPointID: out.AccessPointID,
		AccessPointOrigin: out.AccessPointOrigin, EnvPublicID: out.EnvPublicID,
		ControlArtifactPool: out.ControlArtifactPool, LocalEnvironmentBinding: out.LocalEnvironmentBinding,
	}, nil
}

func decodeExactRuntimeLinkResponse(raw []byte, response *runtimeLinkExchangeResponse) error {
	if response == nil {
		return errors.New("nil Runtime link response")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(response); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("Runtime link response contains multiple JSON values")
	}
	return nil
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

func exchangeBootstrapTicket(ctx context.Context, baseClient *http.Client, baseURL string, envID string, bootstrapTicket string, exchange bootstrapTicketExchangeRequest) (*bootstrapResponse, error) {
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return nil, fmt.Errorf("invalid controlplane url: %w", err)
	}
	if !strings.EqualFold(u.Scheme, "https") || strings.TrimSpace(u.Hostname()) == "" {
		return nil, errors.New("controlplane bootstrap requires an HTTPS origin")
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/api/rcpp/v2/runtime/bootstrap/exchange"
	u.RawQuery = ""
	if !validCanonicalBase64URL32(exchange.BootstrapDeliveryRequestIDB64u) {
		return nil, errors.New("invalid bootstrap delivery request id")
	}

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

	client := secureBootstrapHTTPClient(baseClient, u)
	// codeql[go/request-forgery]: the provider origin is an explicit product
	// configuration value and is restricted to an HTTPS origin above; redirects
	// are pinned to the same HTTPS origin by secureBootstrapHTTPClient.
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, ControlArtifactMaxResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read bootstrap exchange response: %w", err)
	}
	if len(body) > ControlArtifactMaxResponseBytes {
		return nil, errors.New("bootstrap exchange response exceeds exact byte bound")
	}
	if resp.StatusCode != http.StatusOK {
		var failure bootstrapExchangeErrorResponse
		if decodeErr := decodeExactBootstrapExchangeError(body, &failure); decodeErr == nil {
			if resp.StatusCode == http.StatusConflict && failure.Error.Code == "BOOTSTRAP_DELIVERY_EXPIRED" {
				return nil, errBootstrapDeliveryExpired
			}
			return nil, fmt.Errorf("bootstrap exchange failed with HTTP %d/%s", resp.StatusCode, failure.Error.Code)
		}
		return nil, fmt.Errorf("bootstrap exchange failed with HTTP %d", resp.StatusCode)
	}

	var out bootstrapResponse
	if err := decodeExactBootstrapResponse(body, &out); err != nil {
		return nil, fmt.Errorf("invalid bootstrap exchange json: %w", err)
	}
	if out.ControlArtifactPool == nil {
		return nil, errors.New("invalid bootstrap exchange response: missing control artifact pool")
	}
	return &out, nil
}

func decodeExactBootstrapResponse(raw []byte, response *bootstrapResponse) error {
	if response == nil {
		return errors.New("nil bootstrap response")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(response); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("bootstrap response contains multiple JSON values")
	}
	return nil
}

func decodeExactBootstrapExchangeError(raw []byte, response *bootstrapExchangeErrorResponse) error {
	if response == nil {
		return errors.New("nil bootstrap error response")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(response); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("bootstrap error response contains multiple JSON values")
	}
	if response.Success || response.Error == nil || strings.TrimSpace(response.Error.Code) == "" || strings.TrimSpace(response.Error.Message) == "" {
		return errors.New("invalid bootstrap error response")
	}
	return nil
}

// SaveProviderLinkConfig commits the resolved configuration before retiring the
// persisted bootstrap delivery attempt. A failed unlink preserves the attempt;
// an unlink directory-sync failure is completion-safe because a crash can only
// restore the same idempotent request ID after the configuration is committed.
func SaveProviderLinkConfig(path string, cfg *Config) error {
	if err := Save(path, cfg); err != nil {
		return err
	}
	return completeBootstrapDeliveryAttempt(cfg)
}

func prepareBootstrapDeliveryAttempt(configPath, providerOrigin, accessPointOrigin, envPublicID string, prev *Config) (bootstrapDeliveryAttempt, string, error) {
	path := filepath.Clean(configPath) + ".bootstrap-delivery-v1.json"
	wanted := bootstrapDeliveryAttempt{
		Version:           bootstrapDeliveryAttemptVersion,
		ProviderOrigin:    strings.TrimSpace(providerOrigin),
		AccessPointOrigin: strings.TrimSpace(accessPointOrigin),
		EnvPublicID:       strings.TrimSpace(envPublicID),
	}
	if prev != nil {
		wanted.AgentInstanceID = strings.TrimSpace(prev.AgentInstanceID)
		wanted.LocalEnvironmentPublicID = strings.TrimSpace(prev.LocalEnvironmentPublicID)
	}
	if raw, err := os.ReadFile(path); err == nil {
		var persisted bootstrapDeliveryAttempt
		if decodeErr := decodeExactBootstrapDeliveryAttempt(raw, &persisted); decodeErr != nil {
			return bootstrapDeliveryAttempt{}, "", fmt.Errorf("invalid pending bootstrap delivery attempt: %w", decodeErr)
		}
		if persisted.ProviderOrigin == wanted.ProviderOrigin && persisted.AccessPointOrigin == wanted.AccessPointOrigin && persisted.EnvPublicID == wanted.EnvPublicID &&
			(wanted.AgentInstanceID == "" || persisted.AgentInstanceID == wanted.AgentInstanceID) &&
			(wanted.LocalEnvironmentPublicID == "" || persisted.LocalEnvironmentPublicID == wanted.LocalEnvironmentPublicID) {
			return persisted, path, nil
		}
		return bootstrapDeliveryAttempt{}, "", errors.New("pending bootstrap delivery attempt belongs to a different provider or environment")
	} else if !errors.Is(err, os.ErrNotExist) {
		return bootstrapDeliveryAttempt{}, "", err
	}
	var err error
	if wanted.AgentInstanceID == "" {
		wanted.AgentInstanceID, err = newAgentInstanceID()
		if err != nil {
			return bootstrapDeliveryAttempt{}, "", err
		}
	}
	if wanted.LocalEnvironmentPublicID == "" {
		wanted.LocalEnvironmentPublicID, err = newLocalEnvironmentPublicID()
		if err != nil {
			return bootstrapDeliveryAttempt{}, "", err
		}
	}
	wanted.BootstrapDeliveryRequestIDB64u, err = newBootstrapDeliveryRequestID()
	if err != nil {
		return bootstrapDeliveryAttempt{}, "", err
	}
	if err := writeBootstrapDeliveryAttemptAtomic(path, wanted); err != nil {
		return bootstrapDeliveryAttempt{}, "", err
	}
	return wanted, path, nil
}

func rotateExpiredBootstrapDeliveryAttempt(path string, expected bootstrapDeliveryAttempt) (bootstrapDeliveryAttempt, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return bootstrapDeliveryAttempt{}, err
	}
	var persisted bootstrapDeliveryAttempt
	if err := decodeExactBootstrapDeliveryAttempt(raw, &persisted); err != nil {
		return bootstrapDeliveryAttempt{}, err
	}
	if persisted != expected {
		return bootstrapDeliveryAttempt{}, errors.New("bootstrap delivery attempt changed before expiry retirement")
	}
	next := persisted
	next.BootstrapDeliveryRequestIDB64u, err = newBootstrapDeliveryRequestID()
	if err != nil {
		return bootstrapDeliveryAttempt{}, err
	}
	if next.BootstrapDeliveryRequestIDB64u == persisted.BootstrapDeliveryRequestIDB64u {
		return bootstrapDeliveryAttempt{}, errors.New("bootstrap delivery request id did not advance")
	}
	if err := writeBootstrapDeliveryAttemptAtomic(path, next); err != nil {
		return bootstrapDeliveryAttempt{}, err
	}
	return next, nil
}

func decodeExactBootstrapDeliveryAttempt(raw []byte, attempt *bootstrapDeliveryAttempt) error {
	if attempt == nil {
		return errors.New("nil bootstrap delivery attempt")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(attempt); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("bootstrap delivery attempt contains multiple JSON values")
	}
	if attempt.Version != bootstrapDeliveryAttemptVersion || strings.TrimSpace(attempt.ProviderOrigin) == "" ||
		strings.TrimSpace(attempt.AccessPointOrigin) == "" || strings.TrimSpace(attempt.EnvPublicID) == "" ||
		strings.TrimSpace(attempt.LocalEnvironmentPublicID) == "" || strings.TrimSpace(attempt.AgentInstanceID) == "" ||
		!validCanonicalBase64URL32(attempt.BootstrapDeliveryRequestIDB64u) {
		return errors.New("invalid bootstrap delivery attempt fields")
	}
	return nil
}

func writeBootstrapDeliveryAttemptAtomic(path string, attempt bootstrapDeliveryAttempt) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	raw, err := json.Marshal(attempt)
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	tmp, err := os.CreateTemp(dir, ".bootstrap-delivery-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer func() { _ = os.Remove(tmpPath) }()
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(raw); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return err
	}
	return syncDirectory(dir)
}

func completeBootstrapDeliveryAttempt(cfg *Config) error {
	if cfg == nil || strings.TrimSpace(cfg.bootstrapDeliveryAttemptPath) == "" {
		return nil
	}
	raw, err := os.ReadFile(cfg.bootstrapDeliveryAttemptPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var attempt bootstrapDeliveryAttempt
	if err := decodeExactBootstrapDeliveryAttempt(raw, &attempt); err != nil {
		return err
	}
	if attempt.BootstrapDeliveryRequestIDB64u != cfg.bootstrapDeliveryRequestIDB64u {
		return errors.New("bootstrap delivery attempt changed before completion")
	}
	path := cfg.bootstrapDeliveryAttemptPath
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	// The config is already durable. If this sync fails, either the unlink is
	// retained or a crash restores the same sidecar and therefore the same
	// Portal idempotency key; neither outcome can create a second delivery.
	_ = syncDirectory(filepath.Dir(path))
	cfg.bootstrapDeliveryAttemptPath = ""
	cfg.bootstrapDeliveryRequestIDB64u = ""
	return nil
}

func syncDirectory(path string) error {
	dir, err := os.Open(path)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func newBootstrapDeliveryRequestID() (string, error) {
	bytes := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func validCanonicalBase64URL32(value string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(value))
	return err == nil && len(decoded) == 32 && base64.RawURLEncoding.EncodeToString(decoded) == value
}

func controlArtifactPoolFromBootstrap(delivery bootstrapControlArtifactPool, generation int64, now time.Time) (*ControlArtifactPool, error) {
	if delivery.Version != ControlArtifactPoolContractVersion || delivery.BindingGeneration != generation ||
		strings.TrimSpace(delivery.LogicalProviderBindingID) == "" ||
		delivery.TargetWaterline != ControlArtifactTargetWaterline ||
		delivery.RefreshHorizonSeconds != ControlArtifactRefreshHorizonS ||
		delivery.ServerHighestArtifactSequence == 0 || delivery.ServerHighestArtifactSequence > math.MaxInt64 ||
		len(delivery.Entries) < delivery.TargetWaterline || len(delivery.Entries) > ControlArtifactMaxOutstanding {
		return nil, errors.New("control artifact pool contract mismatch")
	}
	digestBytes, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(delivery.ResponseDigestB64u))
	if err != nil || len(digestBytes) != sha256.Size {
		return nil, errors.New("invalid control artifact pool response digest")
	}
	unsigned := delivery
	unsigned.ResponseDigestB64u = ""
	encoded, err := json.Marshal(unsigned)
	if err != nil {
		return nil, err
	}
	computedResponseDigest := sha256.Sum256(encoded)
	if !bytes.Equal(computedResponseDigest[:], digestBytes) {
		return nil, errors.New("control artifact pool response digest mismatch")
	}
	pool := NewControlArtifactPool(generation)
	pool.LogicalBindingID = strings.TrimSpace(delivery.LogicalProviderBindingID)
	pool.TargetWaterline = delivery.TargetWaterline
	pool.RefreshHorizonSeconds = delivery.RefreshHorizonSeconds
	pool.RecoveryState = ControlArtifactRecoveryReady
	var previous uint64
	for index, delivered := range delivery.Entries {
		if delivered.BindingGeneration != generation || delivered.ArtifactSequence == 0 ||
			(index == 0 && delivered.ArtifactSequence != 1) ||
			(previous != 0 && delivered.ArtifactSequence != previous+1) ||
			strings.TrimSpace(delivered.ArtifactChannelID) == "" || len(delivered.ArtifactJSON) == 0 ||
			len(delivered.ArtifactJSON) > ControlArtifactMaxJSONBytes ||
			delivered.ExpiresAtUnixS <= now.Unix()+ControlArtifactRefreshHorizonS ||
			delivered.ExpiresAtUnixS > now.Add(5*time.Minute).Unix() {
			return nil, errors.New("invalid control artifact pool entry")
		}
		normalizedArtifact, err := NormalizeControlArtifactJSON(delivered.ArtifactJSON)
		if err != nil {
			return nil, errors.New("invalid control artifact pool artifact JSON")
		}
		if _, err := flowersec.ParseArtifact(normalizedArtifact); err != nil {
			return nil, fmt.Errorf("invalid control artifact pool artifact: %w", err)
		}
		digest := sha256.Sum256(normalizedArtifact)
		pool.Entries = append(pool.Entries, ControlArtifactEntry{
			Sequence:       delivered.ArtifactSequence,
			ArtifactJSON:   normalizedArtifact,
			ArtifactDigest: base64.RawURLEncoding.EncodeToString(digest[:]),
			ChannelID:      strings.TrimSpace(delivered.ArtifactChannelID),
			ExpiresAtUnixS: delivered.ExpiresAtUnixS,
		})
		previous = delivered.ArtifactSequence
	}
	if previous != delivery.ServerHighestArtifactSequence {
		return nil, errors.New("control artifact pool server waterline mismatch")
	}
	if err := pool.Validate(now.Unix()); err != nil {
		return nil, err
	}
	return pool, nil
}

func secureBootstrapHTTPClient(base *http.Client, origin *url.URL) *http.Client {
	client := &http.Client{}
	if base != nil {
		*client = *base
	}
	client.Timeout = 20 * time.Second
	previousRedirect := client.CheckRedirect
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if req == nil || req.URL == nil || origin == nil || !sameHTTPSOrigin(req.URL, origin) {
			return errors.New("bootstrap redirect changed origin")
		}
		if previousRedirect != nil {
			return previousRedirect(req, via)
		}
		if len(via) >= 10 {
			return errors.New("stopped after 10 redirects")
		}
		return nil
	}
	return client
}

func sameHTTPSOrigin(a, b *url.URL) bool {
	if a == nil || b == nil || !strings.EqualFold(a.Scheme, "https") || !strings.EqualFold(b.Scheme, "https") {
		return false
	}
	return strings.EqualFold(a.Hostname(), b.Hostname()) && effectiveHTTPSPort(a) == effectiveHTTPSPort(b)
}

func effectiveHTTPSPort(u *url.URL) string {
	if u == nil {
		return ""
	}
	if port := u.Port(); port != "" {
		return port
	}
	return "443"
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
