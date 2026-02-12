package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	directv1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/direct/v1"
)

// Config is the on-disk configuration for the Redeven agent.
//
// NOTE: This file contains secrets (PSK). Always keep it chmod 0600.
type Config struct {
	ControlplaneBaseURL string                      `json:"controlplane_base_url"`
	EnvironmentID       string                      `json:"environment_id"`
	AgentInstanceID     string                      `json:"agent_instance_id"`
	Direct              *directv1.DirectConnectInfo `json:"direct"`

	// AI config controls optional native AI agent features.
	AI *AIConfig `json:"ai,omitempty"`

	// PermissionPolicy is the local permission cap applied on the endpoint.
	// It is designed to limit the effective permissions even if the control-plane grants more.
	PermissionPolicy *PermissionPolicy `json:"permission_policy,omitempty"`

	// RootDir is the filesystem root for FS/terminal operations.
	// If empty, the agent picks a safe default (user home dir).
	RootDir string `json:"root_dir,omitempty"`

	// Shell is the shell command used for terminal sessions.
	// If empty, the agent picks a default (SHELL or /bin/bash).
	Shell string `json:"shell,omitempty"`

	// LogFormat is "json" or "text".
	LogFormat string `json:"log_format,omitempty"`
	// LogLevel is "debug|info|warn|error".
	LogLevel string `json:"log_level,omitempty"`

	// CodeServerPortMin/Max configures the dynamic port range used for code-server processes.
	// If unset/invalid, the agent uses a safe default range.
	CodeServerPortMin int `json:"code_server_port_min,omitempty"`
	CodeServerPortMax int `json:"code_server_port_max,omitempty"`
}

// ValidateLocalMinimal validates config fields required to start the agent in local-only mode.
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
	if c.AI != nil {
		if err := c.AI.Validate(); err != nil {
			return fmt.Errorf("invalid ai: %w", err)
		}
	}
	return nil
}

// ValidateRemoteStrict validates the fields required to connect to a control plane control channel.
//
// This is the standard mode requirements: the agent must be fully bootstrapped.
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
	if strings.TrimSpace(c.EnvironmentID) == "" {
		return errors.New("missing environment_id")
	}
	if strings.TrimSpace(c.AgentInstanceID) == "" {
		return errors.New("missing agent_instance_id")
	}
	if c.Direct == nil ||
		strings.TrimSpace(c.Direct.WsUrl) == "" ||
		strings.TrimSpace(c.Direct.ChannelId) == "" ||
		strings.TrimSpace(c.Direct.E2eePskB64u) == "" ||
		c.Direct.ChannelInitExpireAtUnixS <= 0 {
		return errors.New("missing direct connect info")
	}
	return nil
}

// DefaultConfigPath returns the default config path:
//
//	~/.redeven/config.json
func DefaultConfigPath() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return "redeven.config.json"
	}
	return filepath.Join(home, ".redeven", "config.json")
}

// EnvConfigPath returns a per-environment config path:
//
//	~/.redeven/envs/<env_public_id>/config.json
//
// This is intended for running multiple agent instances on a single machine without sharing
// local state (lock file, logs, secrets, and app state).
func EnvConfigPath(envID string) string {
	id := strings.TrimSpace(envID)
	if id == "" {
		return DefaultConfigPath()
	}

	// Keep the directory name safe even if the input is malformed.
	// env ids are expected to look like "env_...", but the CLI should not trust inputs.
	var b strings.Builder
	b.Grow(len(id))
	for i := 0; i < len(id); i++ {
		c := id[i]
		switch {
		case c >= 'a' && c <= 'z':
			b.WriteByte(c)
		case c >= 'A' && c <= 'Z':
			b.WriteByte(c)
		case c >= '0' && c <= '9':
			b.WriteByte(c)
		case c == '_' || c == '-' || c == '.':
			b.WriteByte(c)
		default:
			b.WriteByte('_')
		}
	}
	safeID := b.String()

	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return filepath.Join("redeven.envs", safeID, "config.json")
	}
	return filepath.Join(home, ".redeven", "envs", safeID, "config.json")
}

func Load(path string) (*Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(b, &cfg); err != nil {
		return nil, err
	}
	if err := cfg.ValidateLocalMinimal(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}
	return &cfg, nil
}

func Save(path string, cfg *Config) error {
	if cfg == nil {
		return errors.New("nil config")
	}
	if err := cfg.ValidateLocalMinimal(); err != nil {
		return err
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}

	// Write atomically.
	tmp := path + ".tmp"
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')

	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
