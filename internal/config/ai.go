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
	// DefaultModel is the default model reference used by the UI when starting a run.
	DefaultModel AIModelRef `json:"default_model"`

	// Models is the explicit selectable model list shown by the UI.
	// It must contain default_model.
	Models []AIModel `json:"models,omitempty"`

	// Providers is the provider registry available to the sidecar.
	Providers []AIProvider `json:"providers,omitempty"`
}

// AIModelRef is a structured model reference (avoids stringly-typed "<provider>/<model>" editing mistakes).
type AIModelRef struct {
	ProviderID string `json:"provider_id"`
	ModelName  string `json:"model_name"`
}

type AIModel struct {
	ProviderID string `json:"provider_id"`
	ModelName  string `json:"model_name"`
	Label      string `json:"label,omitempty"`
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
}

// AIProviderAPIKeyEnvFixed is the fixed environment variable name injected into the AI sidecar process.
//
// It is intentionally Redeven-specific to avoid collisions with other local tools.
const AIProviderAPIKeyEnvFixed = "REDEVEN_API_KEY"

func (c *AIConfig) Validate() error {
	if c == nil {
		return errors.New("nil config")
	}

	defaultProviderID := strings.TrimSpace(c.DefaultModel.ProviderID)
	defaultModelName := strings.TrimSpace(c.DefaultModel.ModelName)
	if defaultProviderID == "" || defaultModelName == "" {
		return errors.New("missing default_model")
	}
	if strings.Contains(defaultProviderID, "/") || strings.Contains(defaultModelName, "/") {
		return errors.New("invalid default_model (provider_id/model_name must not contain '/')")
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
			return fmt.Errorf("providers[%d]: invalid id %q (must not contain '/')", i, id)
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
	}

	// Validate models list.
	if len(c.Models) == 0 {
		return errors.New("missing models")
	}
	modelIDs := make(map[string]struct{}, len(c.Models))
	for i := range c.Models {
		m := c.Models[i]
		providerID := strings.TrimSpace(m.ProviderID)
		modelName := strings.TrimSpace(m.ModelName)
		if providerID == "" || modelName == "" {
			return fmt.Errorf("models[%d]: missing provider_id/model_name", i)
		}
		if strings.Contains(providerID, "/") || strings.Contains(modelName, "/") {
			return fmt.Errorf("models[%d]: invalid provider_id/model_name (must not contain '/')", i)
		}

		if _, ok := seen[providerID]; !ok {
			return fmt.Errorf("models[%d]: unknown provider %q", i, providerID)
		}

		id := providerID + "/" + modelName
		if _, ok := modelIDs[id]; ok {
			return fmt.Errorf("models[%d]: duplicate model %q", i, id)
		}
		modelIDs[id] = struct{}{}
	}

	defaultID := defaultProviderID + "/" + defaultModelName
	if _, ok := modelIDs[defaultID]; !ok {
		return fmt.Errorf("default_model %q must be listed in models", defaultID)
	}

	return nil
}
