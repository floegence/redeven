package ai

import (
	"errors"
	"fmt"
	"strings"
)

type resolvedProviderAdapter struct {
	Adapter      ModelGateway
	ProviderType string
	ModelName    string
}

func (s *Service) initResolvedProviderAdapter(resolved resolvedRunModel) (resolvedProviderAdapter, error) {
	if s == nil {
		return resolvedProviderAdapter{}, errors.New("nil service")
	}
	providerType := strings.ToLower(strings.TrimSpace(resolved.Provider.Type))
	modelName := strings.TrimSpace(resolved.WireModelName)
	if modelName == "" {
		modelName = strings.TrimSpace(resolved.ModelName)
	}
	if modelName == "" {
		modelName = strings.TrimSpace(resolved.ID)
	}

	switch providerType {
	case "openai", "anthropic", "google", "moonshot", "chatglm", "deepseek", "qwen", "openrouter", "xai", "groq", "ollama", "openai_compatible":
	case DesktopModelSourceProviderType:
		s.mu.Lock()
		modelSource := s.desktopModelSource
		s.mu.Unlock()
		if modelSource == nil {
			return resolvedProviderAdapter{}, ErrNotConfigured
		}
		modelID := strings.TrimSpace(resolved.DesktopModelSourceModelID)
		if modelID == "" {
			modelID = strings.TrimSpace(resolved.ID)
		}
		if !isDesktopModelSourceModelID(modelID) {
			return resolvedProviderAdapter{}, fmt.Errorf("invalid desktop model source model %q", resolved.ID)
		}
		return resolvedProviderAdapter{Adapter: modelSource.ModelGateway(modelID), ProviderType: providerType, ModelName: modelID}, nil
	default:
		return resolvedProviderAdapter{}, fmt.Errorf("unsupported provider type %q", strings.TrimSpace(resolved.Provider.Type))
	}

	apiKey, available, err := resolveModelProviderKey(providerType, resolved.ProviderID, s.resolveProviderKey)
	if err != nil {
		return resolvedProviderAdapter{}, fmt.Errorf("resolve provider key failed: %w", err)
	}
	if !available {
		return resolvedProviderAdapter{}, fmt.Errorf("missing api key for provider %q", resolved.ProviderID)
	}
	adapter, err := newProviderAdapter(providerType, strings.TrimSpace(resolved.Provider.BaseURL), strings.TrimSpace(apiKey), resolved.Provider.StrictToolSchema)
	if err != nil {
		return resolvedProviderAdapter{}, fmt.Errorf("init provider adapter failed: %w", err)
	}
	return resolvedProviderAdapter{Adapter: adapter, ProviderType: providerType, ModelName: modelName}, nil
}

func (s *Service) initStructuredOutputProvider(resolved resolvedRunModel) (ModelGateway, string, error) {
	adapter, err := s.initResolvedProviderAdapter(resolved)
	if err != nil {
		return nil, "", err
	}
	responseFormat := "json_object"
	switch adapter.ProviderType {
	case "google", "openai_compatible", "moonshot", "chatglm", "deepseek", "qwen", "openrouter", "xai", "groq", "ollama":
		responseFormat = ""
	}
	return adapter.Adapter, responseFormat, nil
}

// Ollama may run without authentication, but a configured key still applies to
// both discovery and execution. Every execution route uses the same decision.
func resolveModelProviderKey(providerType, providerID string, resolve func(string) (string, bool, error)) (string, bool, error) {
	optional := strings.EqualFold(strings.TrimSpace(providerType), "ollama")
	if resolve == nil {
		if optional {
			return "", true, nil
		}
		return "", false, errors.New("missing provider key resolver")
	}
	key, available, err := resolve(providerID)
	key = strings.TrimSpace(key)
	return key, optional || (available && key != ""), err
}
