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
//   - Field names are snake_case to match the rest of the runtime config surface.
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
	// - "plan": planning-first mode with strict readonly execution (mutating actions are blocked)
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
	// - no dangerous-command hard block
	ExecutionPolicy *AIExecutionPolicy `json:"execution_policy,omitempty"`

	// TerminalExecPolicy controls the bounded execution policy for terminal.exec.
	//
	// The built-in defaults intentionally mimic Claude-style shell behavior:
	// - default timeout: 2 minutes
	// - maximum timeout cap: 10 minutes
	TerminalExecPolicy *AITerminalExecPolicy `json:"terminal_exec_policy,omitempty"`
}

type AIExecutionPolicy struct {
	// RequireUserApproval controls whether mutating tool invocations require user approval.
	RequireUserApproval bool `json:"require_user_approval"`

	// BlockDangerousCommands controls whether dangerous terminal commands are hard-blocked.
	BlockDangerousCommands bool `json:"block_dangerous_commands"`
}

type AITerminalExecPolicy struct {
	// DefaultTimeoutMS is the timeout applied when terminal.exec does not specify timeout_ms.
	DefaultTimeoutMS *int `json:"default_timeout_ms,omitempty"`

	// MaxTimeoutMS is the hard upper cap for any terminal.exec timeout_ms request.
	MaxTimeoutMS *int `json:"max_timeout_ms,omitempty"`
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

	// WebSearch configures optional web search behavior for generic OpenAI-compatible providers.
	//
	// Native providers (OpenAI, Moonshot, ChatGLM/GLM, DeepSeek, and Qwen) derive their web-search
	// behavior from the provider type and explicit model allow-list, so this field is ignored for them.
	WebSearch *AIProviderWebSearch `json:"web_search,omitempty"`

	// Models is the allowed model list for this provider (shown in the Chat UI).
	Models []AIProviderModel `json:"models,omitempty"`
}

type AIProviderWebSearch struct {
	// Mode is only honored for openai_compatible providers.
	//
	// Supported values:
	// - "disabled": do not expose any web-search capability
	// - "openai_builtin": attach OpenAI Responses-style hosted web search
	// - "brave": expose Flower's external Brave-backed web.search tool
	Mode string `json:"mode,omitempty"`
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
	defaultAIBlockDangerousCommand = false

	defaultAITerminalExecDefaultTimeoutMS = 120_000
	defaultAITerminalExecMaxTimeoutMS     = 600_000

	defaultAIEffectiveContextWindowPercent int = 95
)

const (
	AIProviderWebSearchModeDisabled      = "disabled"
	AIProviderWebSearchModeOpenAIBuiltin = "openai_builtin"
	AIProviderWebSearchModeBrave         = "brave"
)

var curatedNativeAIProviderModels = map[string]map[string]struct{}{
	"moonshot": {
		"kimi-k2.6": {},
	},
	"chatglm": {
		"glm-5.1": {},
	},
	"deepseek": {
		"deepseek-v4-pro":   {},
		"deepseek-v4-flash": {},
	},
	"qwen": {
		"qwen3.6-plus":             {},
		"qwen3.6-plus-2026-04-02":  {},
		"qwen3.6-flash":            {},
		"qwen3.6-flash-2026-04-16": {},
	},
}

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

func IsCuratedNativeAIProviderModel(providerType string, modelName string) bool {
	models, ok := curatedNativeAIProviderModels[strings.ToLower(strings.TrimSpace(providerType))]
	if !ok {
		return false
	}
	_, ok = models[strings.TrimSpace(modelName)]
	return ok
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

	if c.ToolRecoveryMaxSteps != nil {
		if *c.ToolRecoveryMaxSteps < 0 || *c.ToolRecoveryMaxSteps > 8 {
			return fmt.Errorf("invalid tool_recovery_max_steps %d (must be in [0,8])", *c.ToolRecoveryMaxSteps)
		}
	}
	if c.TerminalExecPolicy != nil {
		if c.TerminalExecPolicy.DefaultTimeoutMS != nil {
			v := *c.TerminalExecPolicy.DefaultTimeoutMS
			if v < 1 || v > defaultAITerminalExecMaxTimeoutMS {
				return fmt.Errorf("invalid terminal_exec_policy.default_timeout_ms %d (must be in [1,%d])", v, defaultAITerminalExecMaxTimeoutMS)
			}
		}
		if c.TerminalExecPolicy.MaxTimeoutMS != nil {
			v := *c.TerminalExecPolicy.MaxTimeoutMS
			if v < 1 || v > defaultAITerminalExecMaxTimeoutMS {
				return fmt.Errorf("invalid terminal_exec_policy.max_timeout_ms %d (must be in [1,%d])", v, defaultAITerminalExecMaxTimeoutMS)
			}
		}
		if c.TerminalExecPolicy.DefaultTimeoutMS != nil && c.TerminalExecPolicy.MaxTimeoutMS != nil {
			if *c.TerminalExecPolicy.DefaultTimeoutMS > *c.TerminalExecPolicy.MaxTimeoutMS {
				return fmt.Errorf("invalid terminal_exec_policy: default_timeout_ms %d exceeds max_timeout_ms %d", *c.TerminalExecPolicy.DefaultTimeoutMS, *c.TerminalExecPolicy.MaxTimeoutMS)
			}
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

		if p.WebSearch != nil {
			mode := strings.ToLower(strings.TrimSpace(p.WebSearch.Mode))
			if mode == "" {
				mode = AIProviderWebSearchModeDisabled
			}
			switch mode {
			case AIProviderWebSearchModeDisabled, AIProviderWebSearchModeOpenAIBuiltin, AIProviderWebSearchModeBrave:
			default:
				return fmt.Errorf("providers[%d]: invalid web_search.mode %q", i, p.WebSearch.Mode)
			}
			if t != "openai_compatible" && mode != AIProviderWebSearchModeDisabled {
				return fmt.Errorf("providers[%d]: web_search.mode is only supported for openai_compatible providers", i)
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
			if _, curatedProvider := curatedNativeAIProviderModels[t]; curatedProvider && !IsCuratedNativeAIProviderModel(t, name) {
				return fmt.Errorf("providers[%d].models[%d]: unsupported %s model %q", i, j, t, name)
			}

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

func (c *AIConfig) EffectiveBlockDangerousCommands() bool {
	if c == nil || c.ExecutionPolicy == nil {
		return defaultAIBlockDangerousCommand
	}
	return c.ExecutionPolicy.BlockDangerousCommands
}

func (c *AIConfig) EffectiveTerminalExecMaxTimeoutMS() int64 {
	if c == nil || c.TerminalExecPolicy == nil || c.TerminalExecPolicy.MaxTimeoutMS == nil {
		return defaultAITerminalExecMaxTimeoutMS
	}
	v := *c.TerminalExecPolicy.MaxTimeoutMS
	if v < 1 {
		return defaultAITerminalExecMaxTimeoutMS
	}
	if v > defaultAITerminalExecMaxTimeoutMS {
		return defaultAITerminalExecMaxTimeoutMS
	}
	return int64(v)
}

func (c *AIConfig) EffectiveTerminalExecDefaultTimeoutMS() int64 {
	maxTimeoutMS := c.EffectiveTerminalExecMaxTimeoutMS()
	if c == nil || c.TerminalExecPolicy == nil || c.TerminalExecPolicy.DefaultTimeoutMS == nil {
		if int64(defaultAITerminalExecDefaultTimeoutMS) > maxTimeoutMS {
			return maxTimeoutMS
		}
		return defaultAITerminalExecDefaultTimeoutMS
	}
	v := *c.TerminalExecPolicy.DefaultTimeoutMS
	if v < 1 {
		if int64(defaultAITerminalExecDefaultTimeoutMS) > maxTimeoutMS {
			return maxTimeoutMS
		}
		return defaultAITerminalExecDefaultTimeoutMS
	}
	if int64(v) > maxTimeoutMS {
		return maxTimeoutMS
	}
	return int64(v)
}
