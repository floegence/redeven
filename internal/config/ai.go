package config

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// AIConfig configures the optional Flower (AI assistant) feature (Go Native runtime).
//
// Notes:
//   - Secrets (api keys) must never be stored in this config. Keys are managed via a separate local secrets file.
//   - Field names are snake_case to match the rest of the agent config surface.
type AIConfig struct {
	// Providers is the provider registry available to the runtime and UI.
	//
	// Notes:
	// - Providers own their allowed model list (provider + model are always configured together).
	Providers []AIProvider `json:"providers,omitempty"`

	// CurrentModelID points to the model used by default for new chats.
	//
	// Format: <provider_id>/<model_name>
	CurrentModelID string `json:"current_model_id"`

	// Mode controls the AI runtime behavior.
	//
	// Supported values:
	// - "act": full tool execution flow (default)
	// - "plan": planning-first mode (soft guidance by prompt)
	Mode string `json:"mode,omitempty"`

	// ToolRecoveryEnabled controls runtime-level recovery orchestration.
	//
	// When enabled, the Go runtime can continue attempts after recoverable tool failures
	// instead of ending the turn immediately.
	ToolRecoveryEnabled *bool `json:"tool_recovery_enabled,omitempty"`

	// ToolRecoveryMaxSteps limits how many recovery continuations can happen in one run.
	//
	// Defaults to 3.
	ToolRecoveryMaxSteps *int `json:"tool_recovery_max_steps,omitempty"`

	// ToolRecoveryAllowPathRewrite controls deterministic path normalization/rewrite strategies.
	ToolRecoveryAllowPathRewrite *bool `json:"tool_recovery_allow_path_rewrite,omitempty"`

	// ToolRecoveryAllowProbeTools is reserved for strategy diversification retries in runtime recovery.
	ToolRecoveryAllowProbeTools *bool `json:"tool_recovery_allow_probe_tools,omitempty"`

	// ToolRecoveryFailOnRepeatedSignature controls fail-fast behavior when the same failure signature
	// repeats across recovery attempts.
	ToolRecoveryFailOnRepeatedSignature *bool `json:"tool_recovery_fail_on_repeated_signature,omitempty"`

	// ExecutionPolicy controls runtime execution guardrails.
	//
	// Defaults are intentionally permissive:
	// - no user approval requirement
	// - no plan-mode hard guard
	// - no dangerous-command hard block
	ExecutionPolicy *AIExecutionPolicy `json:"execution_policy,omitempty"`

	// WebSearchProvider controls which web search backend is enabled for AI runs.
	//
	// Supported values:
	// - "prefer_openai": prefer OpenAI built-in web search when using official OpenAI endpoints; otherwise use Brave (default)
	// - "brave": use Brave web search (requires a Brave Search API key)
	// - "disabled": disable all web search tools
	//
	// Notes:
	// - Secrets (API keys) must never be stored in config.json. Web search keys must live in secrets.json.
	WebSearchProvider string `json:"web_search_provider,omitempty"`
}

type AIExecutionPolicy struct {
	// RequireUserApproval controls whether mutating tool invocations require user approval.
	RequireUserApproval bool `json:"require_user_approval"`

	// EnforcePlanModeGuard controls whether mutating actions are hard-blocked in plan mode.
	EnforcePlanModeGuard bool `json:"enforce_plan_mode_guard"`

	// BlockDangerousCommands controls whether dangerous terminal commands are hard-blocked.
	BlockDangerousCommands bool `json:"block_dangerous_commands"`
}

type AIProvider struct {
	// ID is a stable internal id (primary key). It must not change once used for secrets/model routing.
	ID string `json:"id"`

	// Name is a human-friendly display name (safe to rename at any time).
	Name string `json:"name,omitempty"`

	// Type is one of:
	// - "openai"
	// - "anthropic"
	// - "moonshot"
	// - "chatglm"
	// - "deepseek"
	// - "qwen"
	// - "openai_compatible"
	Type string `json:"type"`

	// BaseURL overrides the provider endpoint (example: "https://api.openai.com/v1").
	// When empty, provider defaults apply.
	//
	// Required provider types:
	// - moonshot
	// - chatglm
	// - deepseek
	// - qwen
	// - openai_compatible
	BaseURL string `json:"base_url,omitempty"`

	// StrictToolSchema overrides provider tool schema strictness.
	//
	// When unset, runtime falls back to built-in policy:
	// - openai official endpoints: strict
	// - openai custom gateways: non-strict
	// - openai_compatible: non-strict
	// - moonshot/chatglm/deepseek/qwen: non-strict
	StrictToolSchema *bool `json:"strict_tool_schema,omitempty"`

	// Models is the allowed model list for this provider (shown in the Chat UI).
	Models []AIProviderModel `json:"models,omitempty"`
}

type AIProviderModel struct {
	ModelName                     string `json:"model_name"`
	ContextWindow                 int    `json:"context_window,omitempty"`
	MaxOutputTokens               int    `json:"max_output_tokens,omitempty"`
	EffectiveContextWindowPercent int    `json:"effective_context_window_percent,omitempty"`
}

const (
	AIModeAct  = "act"
	AIModePlan = "plan"
)

const (
	defaultAIToolRecoveryEnabled                 = true
	defaultAIToolRecoveryMaxSteps                = 3
	defaultAIToolRecoveryAllowPathRewrite        = true
	defaultAIToolRecoveryAllowProbeTools         = true
	defaultAIToolRecoveryFailOnRepeatedSignature = true

	defaultAIRequireUserApproval   = false
	defaultAIEnforcePlanModeGuard  = false
	defaultAIBlockDangerousCommand = false

	defaultAIWebSearchProvider                 = "prefer_openai"
	defaultAIEffectiveContextWindowPercent int = 95
)

func (m AIProviderModel) EffectiveContextWindowPercentValue() int {
	if m.EffectiveContextWindowPercent <= 0 {
		return defaultAIEffectiveContextWindowPercent
	}
	return m.EffectiveContextWindowPercent
}

func (m AIProviderModel) EffectiveInputWindowTokens() int {
	contextWindow := m.ContextWindow
	if contextWindow <= 0 {
		return 0
	}
	percent := m.EffectiveContextWindowPercentValue()
	if percent <= 0 {
		return 0
	}
	effective := (contextWindow * percent) / 100
	if effective <= 0 {
		return 1
	}
	return effective
}

func requiresExplicitAIProviderBaseURL(providerType string) bool {
	switch strings.ToLower(strings.TrimSpace(providerType)) {
	case "moonshot", "chatglm", "deepseek", "qwen", "openai_compatible":
		return true
	default:
		return false
	}
}

func (c *AIConfig) Validate() error {
	if c == nil {
		return errors.New("nil config")
	}

	mode := strings.TrimSpace(strings.ToLower(c.Mode))
	if mode == "" {
		mode = AIModeAct
	}
	switch mode {
	case AIModeAct, AIModePlan:
	default:
		return fmt.Errorf("invalid ai mode %q", c.Mode)
	}

	webSearchProvider := strings.TrimSpace(strings.ToLower(c.WebSearchProvider))
	if webSearchProvider == "" {
		webSearchProvider = defaultAIWebSearchProvider
	}
	switch webSearchProvider {
	case "prefer_openai", "brave", "disabled":
	default:
		return fmt.Errorf("invalid web_search_provider %q", c.WebSearchProvider)
	}

	if c.ToolRecoveryMaxSteps != nil {
		if *c.ToolRecoveryMaxSteps < 0 || *c.ToolRecoveryMaxSteps > 8 {
			return fmt.Errorf("invalid tool_recovery_max_steps %d (must be in [0,8])", *c.ToolRecoveryMaxSteps)
		}
	}
	// Validate providers.
	if len(c.Providers) == 0 {
		return errors.New("missing providers")
	}
	seen := make(map[string]struct{}, len(c.Providers))
	for i := range c.Providers {
		p := c.Providers[i]
		id := strings.TrimSpace(p.ID)
		if id == "" {
			return fmt.Errorf("providers[%d]: missing id", i)
		}
		if strings.Contains(id, "/") {
			return fmt.Errorf("providers[%d]: invalid id %q (must not contain /)", i, id)
		}
		if _, ok := seen[id]; ok {
			return fmt.Errorf("providers[%d]: duplicate id %q", i, id)
		}
		seen[id] = struct{}{}

		t := strings.ToLower(strings.TrimSpace(p.Type))
		switch t {
		case "openai", "anthropic", "moonshot", "chatglm", "deepseek", "qwen", "openai_compatible":
		default:
			return fmt.Errorf("providers[%d]: invalid type %q", i, t)
		}

		baseURL := strings.TrimSpace(p.BaseURL)
		if requiresExplicitAIProviderBaseURL(t) && baseURL == "" {
			return fmt.Errorf("providers[%d]: base_url is required for %s", i, t)
		}
		if baseURL != "" {
			u, err := url.Parse(baseURL)
			if err != nil || u == nil {
				return fmt.Errorf("providers[%d]: invalid base_url: %w", i, err)
			}
			scheme := strings.ToLower(strings.TrimSpace(u.Scheme))
			if scheme != "http" && scheme != "https" {
				return fmt.Errorf("providers[%d]: invalid base_url scheme %q", i, u.Scheme)
			}
			if strings.TrimSpace(u.Host) == "" {
				return fmt.Errorf("providers[%d]: invalid base_url host", i)
			}
		}

		// Validate models (provider-owned list).
		if len(p.Models) == 0 {
			return fmt.Errorf("providers[%d]: missing models", i)
		}
		modelNames := make(map[string]struct{}, len(p.Models))
		for j := range p.Models {
			m := p.Models[j]
			name := strings.TrimSpace(m.ModelName)
			if name == "" {
				return fmt.Errorf("providers[%d].models[%d]: missing model_name", i, j)
			}
			if strings.Contains(name, "/") {
				return fmt.Errorf("providers[%d].models[%d]: invalid model_name %q (must not contain /)", i, j, name)
			}
			if _, ok := modelNames[name]; ok {
				return fmt.Errorf("providers[%d].models[%d]: duplicate model_name %q", i, j, name)
			}
			modelNames[name] = struct{}{}

			contextWindow := m.ContextWindow
			if t == "openai_compatible" {
				if contextWindow <= 0 {
					return fmt.Errorf("providers[%d].models[%d]: context_window is required for %s", i, j, t)
				}
			}
			if contextWindow < 0 {
				return fmt.Errorf("providers[%d].models[%d]: invalid context_window %d", i, j, contextWindow)
			}

			if m.MaxOutputTokens < 0 {
				return fmt.Errorf("providers[%d].models[%d]: invalid max_output_tokens %d", i, j, m.MaxOutputTokens)
			}
			if contextWindow > 0 && m.MaxOutputTokens > contextWindow {
				return fmt.Errorf("providers[%d].models[%d]: max_output_tokens %d exceeds context_window %d", i, j, m.MaxOutputTokens, contextWindow)
			}

			if m.EffectiveContextWindowPercent != 0 {
				if m.EffectiveContextWindowPercent < 1 || m.EffectiveContextWindowPercent > 100 {
					return fmt.Errorf("providers[%d].models[%d]: invalid effective_context_window_percent %d (must be in [1,100])", i, j, m.EffectiveContextWindowPercent)
				}
			}
			if contextWindow > 0 && m.EffectiveInputWindowTokens() <= 0 {
				return fmt.Errorf("providers[%d].models[%d]: effective input window is invalid", i, j)
			}
		}
	}

	currentModelID := strings.TrimSpace(c.CurrentModelID)
	if currentModelID == "" {
		return errors.New("missing current model (current_model_id)")
	}
	if !c.IsAllowedModelID(currentModelID) {
		return fmt.Errorf("current_model_id %q is not in providers[].models[]", c.CurrentModelID)
	}

	return nil
}

// FirstModelID returns the first available model wire id (<provider_id>/<model_name>) from providers[].models[] order.
func (c *AIConfig) FirstModelID() (string, bool) {
	if c == nil {
		return "", false
	}
	for _, p := range c.Providers {
		pid := strings.TrimSpace(p.ID)
		if pid == "" {
			continue
		}
		for _, m := range p.Models {
			mn := strings.TrimSpace(m.ModelName)
			if mn == "" {
				continue
			}
			return pid + "/" + mn, true
		}
	}
	return "", false
}

// ResolvedCurrentModelID returns the current model when valid; otherwise it falls back to the first available model.
func (c *AIConfig) ResolvedCurrentModelID() (string, bool) {
	if c == nil {
		return "", false
	}
	current := strings.TrimSpace(c.CurrentModelID)
	if current != "" && c.IsAllowedModelID(current) {
		return current, true
	}
	return c.FirstModelID()
}

// NormalizeCurrentModelID rewrites current_model_id to a valid value.
//
// It returns true when a valid model exists and current_model_id was set.
func (c *AIConfig) NormalizeCurrentModelID() bool {
	if c == nil {
		return false
	}
	modelID, ok := c.ResolvedCurrentModelID()
	if !ok {
		return false
	}
	c.CurrentModelID = modelID
	return true
}

// IsAllowedModelID reports whether the given model wire id (<provider_id>/<model_name>) exists in the config allow-list.
func (c *AIConfig) IsAllowedModelID(modelID string) bool {
	if c == nil {
		return false
	}
	raw := strings.TrimSpace(modelID)
	pid, mn, ok := strings.Cut(raw, "/")
	pid = strings.TrimSpace(pid)
	mn = strings.TrimSpace(mn)
	if !ok || pid == "" || mn == "" {
		return false
	}
	for _, p := range c.Providers {
		if strings.TrimSpace(p.ID) != pid {
			continue
		}
		for _, m := range p.Models {
			if strings.TrimSpace(m.ModelName) == mn {
				return true
			}
		}
		return false
	}
	return false
}

func (c *AIConfig) EffectiveMode() string {
	if c == nil {
		return AIModeAct
	}
	mode := strings.TrimSpace(strings.ToLower(c.Mode))
	switch mode {
	case AIModePlan:
		return AIModePlan
	default:
		return AIModeAct
	}
}

func (c *AIConfig) EffectiveWebSearchProvider() string {
	if c == nil {
		return defaultAIWebSearchProvider
	}
	v := strings.TrimSpace(strings.ToLower(c.WebSearchProvider))
	if v == "" {
		return defaultAIWebSearchProvider
	}
	switch v {
	case "prefer_openai", "brave", "disabled":
		return v
	default:
		return defaultAIWebSearchProvider
	}
}

func (c *AIConfig) EffectiveToolRecoveryEnabled() bool {
	if c == nil || c.ToolRecoveryEnabled == nil {
		return defaultAIToolRecoveryEnabled
	}
	return *c.ToolRecoveryEnabled
}

func (c *AIConfig) EffectiveToolRecoveryMaxSteps() int {
	if c == nil || c.ToolRecoveryMaxSteps == nil {
		return defaultAIToolRecoveryMaxSteps
	}
	v := *c.ToolRecoveryMaxSteps
	if v < 0 {
		return defaultAIToolRecoveryMaxSteps
	}
	if v > 8 {
		return 8
	}
	return v
}

func (c *AIConfig) EffectiveToolRecoveryAllowPathRewrite() bool {
	if c == nil || c.ToolRecoveryAllowPathRewrite == nil {
		return defaultAIToolRecoveryAllowPathRewrite
	}
	return *c.ToolRecoveryAllowPathRewrite
}

func (c *AIConfig) EffectiveToolRecoveryAllowProbeTools() bool {
	if c == nil || c.ToolRecoveryAllowProbeTools == nil {
		return defaultAIToolRecoveryAllowProbeTools
	}
	return *c.ToolRecoveryAllowProbeTools
}

func (c *AIConfig) EffectiveToolRecoveryFailOnRepeatedSignature() bool {
	if c == nil || c.ToolRecoveryFailOnRepeatedSignature == nil {
		return defaultAIToolRecoveryFailOnRepeatedSignature
	}
	return *c.ToolRecoveryFailOnRepeatedSignature
}

func (c *AIConfig) EffectiveRequireUserApproval() bool {
	if c == nil || c.ExecutionPolicy == nil {
		return defaultAIRequireUserApproval
	}
	return c.ExecutionPolicy.RequireUserApproval
}

func (c *AIConfig) EffectiveEnforcePlanModeGuard() bool {
	if c == nil || c.ExecutionPolicy == nil {
		return defaultAIEnforcePlanModeGuard
	}
	return c.ExecutionPolicy.EnforcePlanModeGuard
}

func (c *AIConfig) EffectiveBlockDangerousCommands() bool {
	if c == nil || c.ExecutionPolicy == nil {
		return defaultAIBlockDangerousCommand
	}
	return c.ExecutionPolicy.BlockDangerousCommands
}
