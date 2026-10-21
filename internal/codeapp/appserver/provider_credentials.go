package appserver

import (
	"fmt"
	"strings"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/settings"
)

// Admit changed credential requirements before persisting any part of a bundle.
// Retained connection intent is independent of its current runtime readiness.
func validateAIProviderBundleCredentials(profile config.AIModelProfile, previous *config.AIConfig, store *settings.SecretsStore, keys []settings.AIProviderAPIKeyPatch, webKeys []settings.WebSearchProviderAPIKeyPatch) error {
	previousProviders := make(map[string]config.AIProvider)
	if previous != nil {
		for _, provider := range previous.Providers {
			previousProviders[provider.ID] = provider
		}
	}
	keyUpdates := make(map[string]bool, len(keys))
	for _, patch := range keys {
		keyUpdates[strings.TrimSpace(patch.ProviderID)] = patch.APIKey != nil && strings.TrimSpace(*patch.APIKey) != ""
	}
	webUpdates := make(map[string]bool, len(webKeys))
	for _, patch := range webKeys {
		webUpdates[strings.TrimSpace(patch.ProviderID)] = patch.APIKey != nil && strings.TrimSpace(*patch.APIKey) != ""
	}
	hasKey := func(id string, updates map[string]bool, stored func(string) (bool, error)) (bool, error) {
		if configured, updated := updates[id]; updated {
			return configured, nil
		}
		return stored(id)
	}
	for _, provider := range profile.Providers {
		id := strings.TrimSpace(provider.ID)
		if provider.ModelSelection != nil && provider.ModelSelection.SelectedModels == nil {
			return fmt.Errorf("provider %q requires explicit selected_models", id)
		}
		if !provider.IsEnabled() {
			continue
		}
		prior, exists := previousProviders[id]
		connectionChanged := !exists || !prior.IsEnabled() || prior.Type != provider.Type || prior.EffectiveAuthMethod() != provider.EffectiveAuthMethod() || prior.AccountID != provider.AccountID || strings.TrimSpace(prior.BaseURL) != strings.TrimSpace(provider.BaseURL)
		_, keyChanged := keyUpdates[id]
		_, webKeyChanged := webUpdates[id]
		checkProvider := connectionChanged || keyChanged
		if checkProvider && provider.EffectiveAuthMethod() == config.AIAuthChatGPT {
			account, ok, err := store.ChatGPTAccount(provider.AccountID)
			if err != nil {
				return fmt.Errorf("read ChatGPT credential: %w", err)
			}
			if !ok || !account.PlanEnabled() {
				return fmt.Errorf("provider %q requires ChatGPT plan permission", id)
			}
		} else if checkProvider && !config.AIProviderAPIKeyOptional(provider.Type) {
			configured, err := hasKey(id, keyUpdates, store.HasAIProviderAPIKey)
			if err != nil {
				return fmt.Errorf("read provider %q credential: %w", id, err)
			}
			if !configured {
				return fmt.Errorf("provider %q requires an api key", id)
			}
		}
		if provider.WebSearch != nil && provider.WebSearch.Enabled && provider.WebSearch.Source == config.AIWebSearchSourceBrave && (connectionChanged || webKeyChanged || prior.WebSearch == nil || !prior.WebSearch.Enabled || prior.WebSearch.Source != config.AIWebSearchSourceBrave) {
			configured, err := hasKey(id, webUpdates, store.HasWebSearchProviderAPIKey)
			if err != nil {
				return fmt.Errorf("read provider %q web search credential: %w", id, err)
			}
			if !configured {
				return fmt.Errorf("provider %q requires a web search api key for Brave", id)
			}
		}
	}
	return nil
}
