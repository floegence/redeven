package config

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// AIConfig configures the optional Flower (AI assistant) feature (model gateway).
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

	// PermissionType controls the Flower tool surface and approval behavior.
	//
	// Supported values:
	// - "readonly": safe readonly tools only
	// - "approval_required": standard tools with shell/mutation approval
	// - "full_access": standard tools without per-tool approval
	PermissionType string `json:"permission_type,omitempty"`

	// ToolRecoveryEnabled controls runtime-level recovery orchestration.
	//
	// When enabled, the Go runtime can continue attempts after recoverable tool failures
	// instead of ending the turn immediately.
	ToolRecoveryEnabled *bool `json:"tool_recovery_enabled,omitempty"`

	// ToolRecoveryAllowPathRewrite controls deterministic path normalization/rewrite strategies.
	ToolRecoveryAllowPathRewrite *bool `json:"tool_recovery_allow_path_rewrite,omitempty"`

	// ToolRecoveryAllowProbeTools is reserved for strategy diversification retries in runtime recovery.
	ToolRecoveryAllowProbeTools *bool `json:"tool_recovery_allow_probe_tools,omitempty"`

	// ToolRecoveryFailOnRepeatedSignature controls fail-fast behavior when the same failure signature
	// repeats across recovery attempts.
	ToolRecoveryFailOnRepeatedSignature *bool `json:"tool_recovery_fail_on_repeated_signature,omitempty"`
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
	// - "openrouter"
	// - "xai"
	// - "groq"
	// - "ollama"
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
	// - openrouter
	// - xai
	// - groq
	// - ollama
	// - openai_compatible
	BaseURL string `json:"base_url,omitempty"`

	// StrictToolSchema overrides provider tool schema strictness.
	//
	// When unset, runtime falls back to built-in policy:
	// - openai official endpoints: strict
	// - openai custom endpoints: non-strict
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
	ModelName                     string                `json:"model_name"`
	WireModelName                 string                `json:"wire_model_name,omitempty"`
	ContextWindow                 int                   `json:"context_window,omitempty"`
	MaxOutputTokens               int                   `json:"max_output_tokens,omitempty"`
	EffectiveContextWindowPercent int                   `json:"effective_context_window_percent,omitempty"`
	InputModalities               []string              `json:"input_modalities,omitempty"`
	ReasoningCapability           AIReasoningCapability `json:"reasoning_capability,omitempty"`
	DefaultReasoningSelection     AIReasoningSelection  `json:"default_reasoning_selection,omitempty"`
}

const (
	AIPermissionReadonly         = "readonly"
	AIPermissionApprovalRequired = "approval_required"
	AIPermissionFullAccess       = "full_access"
)

const (
	defaultAIToolRecoveryEnabled                 = true
	defaultAIToolRecoveryAllowPathRewrite        = true
	defaultAIToolRecoveryAllowProbeTools         = true
	defaultAIToolRecoveryFailOnRepeatedSignature = true

	defaultAIEffectiveContextWindowPercent int = 95
)

const (
	AIProviderWebSearchModeDisabled      = "disabled"
	AIProviderWebSearchModeOpenAIBuiltin = "openai_builtin"
	AIProviderWebSearchModeBrave         = "brave"
)

const (
	AIInputModalityText  = "text"
	AIInputModalityImage = "image"
)

var curatedNativeAIProviderModels = map[string]map[string]struct{}{
	"moonshot": {
		"kimi-k2.6": {},
	},
	"chatglm": {
		"glm-5.1": {},
		"glm-5.2": {},
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

func (m AIProviderModel) NormalizedInputModalities() []string {
	if len(m.InputModalities) == 0 {
		return []string{AIInputModalityText}
	}
	out := make([]string, 0, len(m.InputModalities))
	seen := make(map[string]struct{}, len(m.InputModalities))
	for _, item := range m.InputModalities {
		modality := strings.ToLower(strings.TrimSpace(item))
		if modality == "" {
			continue
		}
		if _, ok := seen[modality]; ok {
			continue
		}
		seen[modality] = struct{}{}
		out = append(out, modality)
	}
	if len(out) == 0 {
		return []string{AIInputModalityText}
	}
	return out
}

func (m AIProviderModel) SupportsImageInput() bool {
	for _, modality := range m.NormalizedInputModalities() {
		if modality == AIInputModalityImage {
			return true
		}
	}
	return false
}

func (m AIProviderModel) EffectiveWireModelName() string {
	if wireModelName := strings.TrimSpace(m.WireModelName); wireModelName != "" {
		return wireModelName
	}
	return strings.TrimSpace(m.ModelName)
}

func validateAIInputModalities(modalities []string) error {
	if len(modalities) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(modalities))
	hasText := false
	for _, raw := range modalities {
		modality := strings.ToLower(strings.TrimSpace(raw))
		if modality == "" {
			return errors.New("empty input modality")
		}
		if _, ok := seen[modality]; ok {
			return fmt.Errorf("duplicate input modality %q", modality)
		}
		seen[modality] = struct{}{}
		switch modality {
		case AIInputModalityText:
			hasText = true
		case AIInputModalityImage:
		default:
			return fmt.Errorf("unsupported input modality %q", modality)
		}
	}
	if !hasText {
		return fmt.Errorf("input_modalities must include %q", AIInputModalityText)
	}
	return nil
}

func requiresExplicitAIProviderBaseURL(providerType string) bool {
	switch strings.ToLower(strings.TrimSpace(providerType)) {
	case "moonshot", "chatglm", "deepseek", "qwen", "openrouter", "xai", "groq", "ollama", "openai_compatible":
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

func (m AIProviderModel) EffectiveReasoningCapability(providerType string) AIReasoningCapability {
	if !m.ReasoningCapability.IsZero() {
		return m.ReasoningCapability.Normalize()
	}
	return AIReasoningCapabilityForModel(providerType, m.EffectiveWireModelName())
}

func (m AIProviderModel) EffectiveDefaultReasoningSelection(providerType string) AIReasoningSelection {
	capability := m.EffectiveReasoningCapability(providerType)
	selection := NormalizeAIReasoningSelection(m.DefaultReasoningSelection)
	if !selection.IsZero() {
		return selection
	}
	if capability.IsZero() {
		return AIReasoningSelection{}
	}
	if strings.TrimSpace(capability.DefaultLevel) != "" {
		return AIReasoningSelection{Level: AIReasoningLevel(capability.DefaultLevel)}
	}
	return AIReasoningSelection{}
}

func (c *AIConfig) Validate() error {
	if c == nil {
		return errors.New("nil config")
	}

	if strings.TrimSpace(c.PermissionType) != "" {
		switch strings.ToLower(strings.TrimSpace(c.PermissionType)) {
		case AIPermissionReadonly, AIPermissionApprovalRequired, AIPermissionFullAccess:
		default:
			return fmt.Errorf("invalid ai permission_type %q", c.PermissionType)
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
		case "openai", "anthropic", "moonshot", "chatglm", "deepseek", "qwen", "openrouter", "xai", "groq", "ollama", "openai_compatible":
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
			if strings.Contains(strings.TrimSpace(m.WireModelName), "\x00") {
				return fmt.Errorf("providers[%d].models[%d]: invalid wire_model_name", i, j)
			}
			if _, ok := modelNames[name]; ok {
				return fmt.Errorf("providers[%d].models[%d]: duplicate model_name %q", i, j, name)
			}
			modelNames[name] = struct{}{}
			if _, curatedProvider := curatedNativeAIProviderModels[t]; curatedProvider && !IsCuratedNativeAIProviderModel(t, name) {
				return fmt.Errorf("providers[%d].models[%d]: unsupported %s model %q", i, j, t, name)
			}

			contextWindow := m.ContextWindow
			if t == "openai_compatible" || t == "openrouter" || t == "xai" || t == "groq" || t == "ollama" {
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
			if err := validateAIInputModalities(m.InputModalities); err != nil {
				return fmt.Errorf("providers[%d].models[%d]: invalid input_modalities: %w", i, j, err)
			}
			reasoningCapability := m.EffectiveReasoningCapability(t)
			if err := reasoningCapability.Validate(); err != nil {
				return fmt.Errorf("providers[%d].models[%d]: invalid reasoning_capability: %w", i, j, err)
			}
			if err := ValidateAIReasoningSelection(reasoningCapability, m.EffectiveDefaultReasoningSelection(t)); err != nil {
				return fmt.Errorf("providers[%d].models[%d]: invalid default_reasoning_selection: %w", i, j, err)
			}
		}
	}

	currentModelID := strings.TrimSpace(c.CurrentModelID)
	if currentModelID == "" {
		return errors.New("missing current model (current_model_id)")
	}
	if !c.IsAllowedModelID(currentModelID) {
		return fmt.Errorf("current_model_id is not in providers[].models[]: %s", currentModelID)
	}

	return nil
}

func (c *AIConfig) ProviderModelByID(modelID string) (AIProvider, AIProviderModel, bool) {
	if c == nil {
		return AIProvider{}, AIProviderModel{}, false
	}
	raw := strings.TrimSpace(modelID)
	pid, mn, ok := strings.Cut(raw, "/")
	pid = strings.TrimSpace(pid)
	mn = strings.TrimSpace(mn)
	if !ok || pid == "" || mn == "" {
		return AIProvider{}, AIProviderModel{}, false
	}
	for _, p := range c.Providers {
		if strings.TrimSpace(p.ID) != pid {
			continue
		}
		for _, m := range p.Models {
			if strings.TrimSpace(m.ModelName) == mn {
				return p, m, true
			}
		}
		return AIProvider{}, AIProviderModel{}, false
	}
	return AIProvider{}, AIProviderModel{}, false
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

func (c *AIConfig) EffectivePermissionType() string {
	if c == nil {
		return AIPermissionApprovalRequired
	}
	switch strings.ToLower(strings.TrimSpace(c.PermissionType)) {
	case AIPermissionReadonly:
		return AIPermissionReadonly
	case AIPermissionFullAccess:
		return AIPermissionFullAccess
	case AIPermissionApprovalRequired:
		return AIPermissionApprovalRequired
	}
	return AIPermissionApprovalRequired
}

func (c *AIConfig) EffectiveToolRecoveryEnabled() bool {
	if c == nil || c.ToolRecoveryEnabled == nil {
		return defaultAIToolRecoveryEnabled
	}
	return *c.ToolRecoveryEnabled
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
