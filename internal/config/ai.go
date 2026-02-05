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
	// DefaultModel is the default model id used by the UI when starting a run.
	// Format: "<provider_id>/<model_name>" (example: "openai/gpt-5-mini").
	DefaultModel string `json:"default_model,omitempty"`

	// Models is an explicit allow-list. If empty, the agent will expose only default_model.
	Models []AIModel `json:"models,omitempty"`

	// Providers is the provider registry available to the sidecar.
	Providers []AIProvider `json:"providers,omitempty"`
}

type AIModel struct {
	ID    string `json:"id"`
	Label string `json:"label,omitempty"`
}

type AIProvider struct {
	ID string `json:"id"`
	// Type is one of: "openai" | "anthropic" | "openai_compatible".
	Type string `json:"type"`

	// BaseURL overrides the provider endpoint (example: "https://api.openai.com/v1").
	// When empty, provider defaults apply (except openai_compatible where base_url is required).
	BaseURL string `json:"base_url,omitempty"`

	// APIKeyEnv is the environment variable name used by the sidecar to read the provider API key.
	//
	// This value is fixed to AIProviderAPIKeyEnvFixed to keep the UI intuitive and avoid conflicts
	// with other local tools.
	APIKeyEnv string `json:"api_key_env"`
}

// AIProviderAPIKeyEnvFixed is the fixed environment variable name injected into the AI sidecar process.
//
// It is intentionally Redeven-specific to avoid collisions with other local tools.
const AIProviderAPIKeyEnvFixed = "REDEVEN_API_KEY"

func (c *AIConfig) Validate() error {
	if c == nil {
		return errors.New("nil config")
	}

	defaultModel := strings.TrimSpace(c.DefaultModel)
	if defaultModel == "" {
		return errors.New("missing default_model")
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

		if strings.TrimSpace(p.APIKeyEnv) == "" {
			return fmt.Errorf("providers[%d]: missing api_key_env", i)
		}
		if strings.TrimSpace(p.APIKeyEnv) != AIProviderAPIKeyEnvFixed {
			return fmt.Errorf("providers[%d]: api_key_env must be %q", i, AIProviderAPIKeyEnvFixed)
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
	}

	// Validate models list.
	if len(c.Models) > 0 {
		modelIDs := make(map[string]struct{}, len(c.Models))
		for i := range c.Models {
			m := c.Models[i]
			id := strings.TrimSpace(m.ID)
			if id == "" {
				return fmt.Errorf("models[%d]: missing id", i)
			}
			if _, ok := modelIDs[id]; ok {
				return fmt.Errorf("models[%d]: duplicate id %q", i, id)
			}
			modelIDs[id] = struct{}{}

			providerID, modelName, ok := strings.Cut(id, "/")
			if !ok || strings.TrimSpace(providerID) == "" || strings.TrimSpace(modelName) == "" {
				return fmt.Errorf("models[%d]: invalid id %q (expected <provider>/<model>)", i, id)
			}
			if _, ok := seen[providerID]; !ok {
				return fmt.Errorf("models[%d]: unknown provider %q", i, providerID)
			}
		}
		if _, ok := modelIDs[defaultModel]; !ok {
			return fmt.Errorf("default_model %q must be listed in models when models is set", defaultModel)
		}
	} else {
		providerID, modelName, ok := strings.Cut(defaultModel, "/")
		if !ok || strings.TrimSpace(providerID) == "" || strings.TrimSpace(modelName) == "" {
			return fmt.Errorf("invalid default_model %q (expected <provider>/<model>)", defaultModel)
		}
		if _, ok := seen[providerID]; !ok {
			return fmt.Errorf("default_model references unknown provider %q", providerID)
		}
	}

	return nil
}
