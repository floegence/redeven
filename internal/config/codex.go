package config

import (
	"errors"
	"fmt"
	"strings"
)

const (
	defaultCodexApprovalPolicy = "on_request"
	defaultCodexSandboxMode    = "workspace_write"
)

// CodexConfig configures the optional Codex app-server integration.
//
// Notes:
//   - Secrets are managed by Codex itself and must never be stored in config.json.
//   - Field names are snake_case to match the rest of the agent config surface.
type CodexConfig struct {
	Enabled bool `json:"enabled"`

	// BinaryPath overrides how the agent locates the `codex` executable.
	// When empty, the agent resolves `codex` from PATH at runtime.
	BinaryPath string `json:"binary_path,omitempty"`

	// DefaultModel is applied when the Codex UI starts a new thread without an explicit model override.
	DefaultModel string `json:"default_model,omitempty"`

	// ApprovalPolicy controls how Codex asks the user before mutating actions proceed.
	//
	// Supported values:
	// - "untrusted"
	// - "on_failure"
	// - "on_request" (default)
	// - "never"
	ApprovalPolicy string `json:"approval_policy,omitempty"`

	// SandboxMode controls the default Codex sandbox for new threads.
	//
	// Supported values:
	// - "read_only"
	// - "workspace_write" (default)
	// - "danger_full_access"
	SandboxMode string `json:"sandbox_mode,omitempty"`
}

func (c *CodexConfig) Normalize() {
	if c == nil {
		return
	}
	c.BinaryPath = strings.TrimSpace(c.BinaryPath)
	c.DefaultModel = strings.TrimSpace(c.DefaultModel)
	c.ApprovalPolicy = strings.ToLower(strings.TrimSpace(c.ApprovalPolicy))
	c.SandboxMode = strings.ToLower(strings.TrimSpace(c.SandboxMode))
}

func (c *CodexConfig) ApprovalPolicyValue() string {
	if c == nil {
		return defaultCodexApprovalPolicy
	}
	v := strings.ToLower(strings.TrimSpace(c.ApprovalPolicy))
	if v == "" {
		return defaultCodexApprovalPolicy
	}
	return v
}

func (c *CodexConfig) SandboxModeValue() string {
	if c == nil {
		return defaultCodexSandboxMode
	}
	v := strings.ToLower(strings.TrimSpace(c.SandboxMode))
	if v == "" {
		return defaultCodexSandboxMode
	}
	return v
}

func (c *CodexConfig) Validate() error {
	if c == nil {
		return errors.New("nil config")
	}

	switch c.ApprovalPolicyValue() {
	case "untrusted", "on_failure", "on_request", "never":
	default:
		return fmt.Errorf("invalid approval_policy %q", c.ApprovalPolicy)
	}

	switch c.SandboxModeValue() {
	case "read_only", "workspace_write", "danger_full_access":
	default:
		return fmt.Errorf("invalid sandbox_mode %q", c.SandboxMode)
	}

	return nil
}
