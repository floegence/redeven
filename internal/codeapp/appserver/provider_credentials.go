package appserver

import (
	"fmt"
	"strings"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/settings"
)

// Validate the resulting credential state before persisting any part of a bundle.
func validateAIProviderBundleCredentials(profile config.AIModelProfile, store *settings.SecretsStore, keys []settings.AIProviderAPIKeyPatch, webKeys []settings.WebSearchProviderAPIKeyPatch) error {
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
		if !config.AIProviderAPIKeyOptional(provider.Type) {
			configured, err := hasKey(id, keyUpdates, store.HasAIProviderAPIKey)
			if err != nil {
				return fmt.Errorf("read provider %q credential: %w", id, err)
			}
			if !configured {
				return fmt.Errorf("provider %q requires an api key", id)
			}
		}
		if provider.WebSearch != nil && strings.EqualFold(strings.TrimSpace(provider.WebSearch.Mode), "brave") {
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
