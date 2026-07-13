package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"

	directv1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/direct/v1"
)

// Config is the runtime configuration for Redeven. Secret material is loaded
// from secrets.json and is never serialized back into config.json.
type Config struct {
	ProviderOrigin           string                      `json:"provider_origin"`
	ControlplaneBaseURL      string                      `json:"controlplane_base_url"`
	ControlplaneProviderID   string                      `json:"controlplane_provider_id,omitempty"`
	EnvironmentID            string                      `json:"environment_id"`
	LocalEnvironmentPublicID string                      `json:"local_environment_public_id"`
	BindingGeneration        int64                       `json:"binding_generation,omitempty"`
	AgentInstanceID          string                      `json:"agent_instance_id"`
	Direct                   *directv1.DirectConnectInfo `json:"direct"`

	// AI config controls optional Flower AI assistant features.
	AI *AIConfig `json:"ai,omitempty"`

	// PermissionPolicy is the local permission cap applied on the endpoint.
	// It is designed to limit the effective permissions even if the control-plane grants more.
	PermissionPolicy *PermissionPolicy `json:"permission_policy,omitempty"`

	// AgentHomeDir is the default home/working directory and the target of "~".
	// If empty, the runtime picks a safe default (the current user home dir).
	// Filesystem access boundaries are defined by FilesystemScope.
	AgentHomeDir string `json:"agent_home_dir,omitempty"`

	// FilesystemScope defines the endpoint-local filesystem roots exposed to
	// runtime capabilities. When omitted, the runtime derives a Home root from
	// AgentHomeDir and a read-only Computer root at the OS filesystem root.
	FilesystemScope *FilesystemScope `json:"filesystem_scope,omitempty"`

	// Shell is the shell command used for terminal sessions.
	// If empty, the runtime picks a default (SHELL or /bin/bash).
	Shell string `json:"shell,omitempty"`

	// LogFormat is "json" or "text".
	LogFormat string `json:"log_format,omitempty"`
	// LogLevel is "debug|info|warn|error".
	LogLevel string `json:"log_level,omitempty"`

	// CodeServerPortMin/Max configures the dynamic port range used for code-server processes.
	// If unset/invalid, the runtime uses a safe default range.
	CodeServerPortMin int `json:"code_server_port_min,omitempty"`
	CodeServerPortMax int `json:"code_server_port_max,omitempty"`

	directPSKSet bool
	directPSKErr error
	extra        map[string]json.RawMessage
}

// ValidateLocalMinimal validates config fields required to start the runtime in local-only mode.
//
// Local-only mode is enabled by `redeven run --mode local` and must work even when the
// controlplane credentials are missing (no bootstrap yet).
func (c *Config) ValidateLocalMinimal() error {
	if c == nil {
		return errors.New("nil config")
	}
	if c.PermissionPolicy != nil {
		if err := c.PermissionPolicy.Validate(); err != nil {
			return fmt.Errorf("invalid permission_policy: %w", err)
		}
	}
	if c.FilesystemScope != nil {
		if err := c.FilesystemScope.Validate(); err != nil {
			return fmt.Errorf("invalid filesystem_scope: %w", err)
		}
	}
	if c.AI != nil {
		if err := c.AI.Validate(); err != nil {
			return fmt.Errorf("invalid ai: %w", err)
		}
	}
	return nil
}

// ValidateRemoteStrict validates the fields required to connect to the remote control channel.
//
// This is the standard mode requirements: the runtime must be fully bootstrapped.
func (c *Config) ValidateRemoteStrict() error {
	if c == nil {
		return errors.New("nil config")
	}
	if err := c.ValidateLocalMinimal(); err != nil {
		return err
	}
	if strings.TrimSpace(c.ControlplaneBaseURL) == "" {
		return errors.New("missing controlplane_base_url")
	}
	if strings.TrimSpace(c.ProviderOrigin) == "" {
		return errors.New("missing provider_origin")
	}
	if _, err := normalizeControlplaneBaseURL(c.ProviderOrigin); err != nil {
		return fmt.Errorf("invalid provider_origin: %w", err)
	}
	if _, err := normalizeControlplaneBaseURL(c.ControlplaneBaseURL); err != nil {
		return fmt.Errorf("invalid controlplane_base_url: %w", err)
	}
	if strings.TrimSpace(c.EnvironmentID) == "" {
		return errors.New("missing environment_id")
	}
	if strings.TrimSpace(c.LocalEnvironmentPublicID) == "" {
		return errors.New("missing local_environment_public_id")
	}
	if c.BindingGeneration <= 0 {
		return errors.New("missing binding_generation")
	}
	if strings.TrimSpace(c.AgentInstanceID) == "" {
		return errors.New("missing agent_instance_id")
	}
	if c.directPSKErr != nil {
		return fmt.Errorf("load direct psk: %w", c.directPSKErr)
	}
	if c.Direct == nil ||
		strings.TrimSpace(c.Direct.WsUrl) == "" ||
		strings.TrimSpace(c.Direct.ChannelId) == "" ||
		strings.TrimSpace(c.Direct.E2eePskB64u) == "" ||
		c.Direct.ChannelInitExpireAtUnixS <= 0 {
		return errors.New("missing direct connect info")
	}
	directURL, err := url.Parse(strings.TrimSpace(c.Direct.WsUrl))
	if err != nil || directURL == nil || !strings.EqualFold(directURL.Scheme, "wss") || strings.TrimSpace(directURL.Host) == "" || directURL.User != nil {
		return errors.New("invalid direct connect info: remote WebSocket URL must use wss")
	}
	return nil
}

func Load(path string) (*Config, error) {
	return loadConfig(path, defaultConfigPersistence())
}

func Save(path string, cfg *Config) error {
	return saveConfig(path, cfg, defaultConfigPersistence())
}
