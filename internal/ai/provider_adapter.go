package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/redeven/internal/chatgpt"
	"github.com/floegence/redeven/internal/config"
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

	apiKey, available, err := resolveProviderCredential(context.Background(), resolved.Provider, s.resolveProviderKey, s.chatGPT)
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
	configureChatGPTAdapter(adapter, resolved.Provider, s.chatGPT)
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

// Optional endpoint authentication still uses a configured key for discovery
// and execution. Every execution route uses the same decision.
func resolveModelProviderKey(providerType, providerID string, resolve func(string) (string, bool, error)) (string, bool, error) {
	optional := config.AIProviderAPIKeyOptional(providerType)
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

// One authentication decision serves Runtime, Desktop, discovery and execution.
func resolveProviderCredential(ctx context.Context, p config.AIProvider, resolve func(string) (string, bool, error), accountClient *chatgpt.Client) (string, bool, error) {
	if p.EffectiveAuthMethod() == config.AIAuthChatGPT {
		if err := p.ValidateAuthentication(); err != nil {
			return "", false, err
		}
		if accountClient == nil {
			return "", false, chatgpt.Failure("authorization_required")
		}
		token, err := accountClient.AccessToken(ctx, p.AccountID)
		return token, token != "" && err == nil, err
	}
	return resolveModelProviderKey(p.Type, p.ID, resolve)
}
func configureChatGPTAdapter(adapter ModelGateway, p config.AIProvider, client *chatgpt.Client) {
	if p.EffectiveAuthMethod() != config.AIAuthChatGPT {
		return
	}
	if gateway, ok := adapter.(*openAIProvider); ok {
		gateway.chatGPT = true
		gateway.requireTerminal = true
		gateway.chatGPTToken = func(ctx context.Context) (string, error) { return client.AccessToken(ctx, p.AccountID) }
		gateway.chatGPTFailure = func(ctx context.Context, token string, err error) {
			client.ObserveRequestFailure(ctx, p.AccountID, token, err)
		}
		gateway.chatGPTWatch = func(ctx context.Context, stop func(error)) (func(), error) {
			return client.WatchSession(ctx, p.AccountID, stop)
		}
	}
}
