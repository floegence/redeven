package config

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// AIConfig configures the optional AI Agent feature (TS sidecar + Go executor).
//
// Notes:
//   - Secrets (api keys) must never be stored in this config. Keys are managed via a separate local secrets file
//     and injected into the AI sidecar process env at run start.
//   - Field names are snake_case to match the rest of the agent config surface.
type AIConfig struct {
	// Providers is the provider registry available to the sidecar and UI.
	//
	// Notes:
	// - Providers own their allowed model list (provider + model are always configured together).
	// - Exactly one provider model must be marked as default via models[].is_default.
	Providers []AIProvider `json:"providers,omitempty"`

	// Mode controls the AI runtime behavior.
	//
	// Supported values:
	// - "build": full tool execution flow (default)
	// - "plan": non-mutating analysis mode
	Mode string `json:"mode,omitempty"`

	// GuardEnabled controls the turn commitment guard.
	//
	// When enabled, the runtime prevents turns from ending with pure preamble text when
	// the user intent requires real tool execution.
	//
	// Defaults to true.
	GuardEnabled *bool `json:"guard_enabled,omitempty"`

	// GuardAutoContinueMax controls how many automatic continuation attempts are allowed
	// when the commitment guard is triggered.
	//
	// Defaults to 1.
	GuardAutoContinueMax *int `json:"guard_auto_continue_max,omitempty"`

	// ToolRequiredIntents is an optional list of intent hint substrings.
	//
	// When the user input contains one of these substrings, the runtime treats the turn as
	// requiring at least one tool call before completion.
	//
	// When empty, built-in defaults are used.
	ToolRequiredIntents []string `json:"tool_required_intents,omitempty"`
}

type AIProvider struct {
	// ID is a stable internal id (primary key). It must not change once used for secrets/model routing.
	ID string `json:"id"`

	// Name is a human-friendly display name (safe to rename at any time).
	Name string `json:"name,omitempty"`

	// Type is one of: "openai" | "anthropic" | "openai_compatible".
	Type string `json:"type"`

	// BaseURL overrides the provider endpoint (example: "https://api.openai.com/v1").
	// When empty, provider defaults apply (except openai_compatible where base_url is required).
	BaseURL string `json:"base_url,omitempty"`

	// Models is the allowed model list for this provider (shown in the Chat UI).
	Models []AIProviderModel `json:"models,omitempty"`
}

type AIProviderModel struct {
	ModelName string `json:"model_name"`
	Label     string `json:"label,omitempty"`

	// IsDefault marks the single default model across all providers.
	// Exactly one providers[].models[].is_default must be true.
	IsDefault bool `json:"is_default,omitempty"`
}

// AIProviderAPIKeyEnvFixed is the fixed environment variable name injected into the AI sidecar process.
//
// It is intentionally Redeven-specific to avoid collisions with other local tools.
const AIProviderAPIKeyEnvFixed = "REDEVEN_API_KEY"

const (
	AIModeBuild = "build"
	AIModePlan  = "plan"
)

const (
	defaultAIGuardEnabled         = true
	defaultAIGuardAutoContinueMax = 1
)

var defaultToolRequiredIntents = []string{
	"analy",
	"scan",
	"inspect",
	"read file",
	"list dir",
	"check config",
	"run command",
	"execute",
	"pwd",
	"ls",
	"cat",
	"grep",
	"rg",
	"分析",
	"扫描",
	"读取",
	"查看目录",
	"执行命令",
	"检查配置",
}

func (c *AIConfig) Validate() error {
	if c == nil {
		return errors.New("nil config")
	}

	mode := strings.TrimSpace(strings.ToLower(c.Mode))
	if mode == "" {
		mode = AIModeBuild
	}
	switch mode {
	case AIModeBuild, AIModePlan:
	default:
		return fmt.Errorf("invalid ai mode %q", c.Mode)
	}

	if c.GuardAutoContinueMax != nil {
		if *c.GuardAutoContinueMax < 0 || *c.GuardAutoContinueMax > 5 {
			return fmt.Errorf("invalid guard_auto_continue_max %d (must be in [0,5])", *c.GuardAutoContinueMax)
		}
	}

	for i, it := range c.ToolRequiredIntents {
		v := strings.TrimSpace(it)
		if v == "" {
			return fmt.Errorf("tool_required_intents[%d]: empty value", i)
		}
	}

	// Validate providers.
	if len(c.Providers) == 0 {
		return errors.New("missing providers")
	}
	seen := make(map[string]struct{}, len(c.Providers))
	defaultCount := 0
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

		t := strings.TrimSpace(p.Type)
		switch t {
		case "openai", "anthropic", "openai_compatible":
		default:
			return fmt.Errorf("providers[%d]: invalid type %q", i, t)
		}

		baseURL := strings.TrimSpace(p.BaseURL)
		if t == "openai_compatible" && baseURL == "" {
			return fmt.Errorf("providers[%d]: base_url is required for openai_compatible", i)
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
			if m.IsDefault {
				defaultCount++
			}
		}
	}

	if defaultCount == 0 {
		return errors.New("missing default model (providers[].models[].is_default)")
	}
	if defaultCount > 1 {
		return errors.New("multiple default models (providers[].models[].is_default)")
	}

	return nil
}

// DefaultModelID returns the default model wire id (<provider_id>/<model_name>).
//
// It assumes Validate() has passed. When config is invalid/incomplete, it returns ("", false).
func (c *AIConfig) DefaultModelID() (string, bool) {
	if c == nil {
		return "", false
	}
	for _, p := range c.Providers {
		pid := strings.TrimSpace(p.ID)
		if pid == "" {
			continue
		}
		for _, m := range p.Models {
			if !m.IsDefault {
				continue
			}
			mn := strings.TrimSpace(m.ModelName)
			if mn == "" {
				continue
			}
			return pid + "/" + mn, true
		}
	}
	return "", false
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
		return AIModeBuild
	}
	mode := strings.TrimSpace(strings.ToLower(c.Mode))
	switch mode {
	case AIModePlan:
		return AIModePlan
	default:
		return AIModeBuild
	}
}

func (c *AIConfig) EffectiveGuardEnabled() bool {
	if c == nil || c.GuardEnabled == nil {
		return defaultAIGuardEnabled
	}
	return *c.GuardEnabled
}

func (c *AIConfig) EffectiveGuardAutoContinueMax() int {
	if c == nil || c.GuardAutoContinueMax == nil {
		return defaultAIGuardAutoContinueMax
	}
	v := *c.GuardAutoContinueMax
	if v < 0 {
		return defaultAIGuardAutoContinueMax
	}
	if v > 5 {
		return 5
	}
	return v
}

func (c *AIConfig) EffectiveToolRequiredIntents() []string {
	if c == nil || len(c.ToolRequiredIntents) == 0 {
		return append([]string(nil), defaultToolRequiredIntents...)
	}
	out := make([]string, 0, len(c.ToolRequiredIntents))
	seen := make(map[string]struct{}, len(c.ToolRequiredIntents))
	for _, it := range c.ToolRequiredIntents {
		v := strings.ToLower(strings.TrimSpace(it))
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	if len(out) == 0 {
		return append([]string(nil), defaultToolRequiredIntents...)
	}
	return out
}
