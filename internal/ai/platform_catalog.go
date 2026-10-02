package ai

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

type platformModelPreference struct {
	model string
	used  time.Time
}

func platformSessionAvailable(meta *session.Meta) bool {
	return meta != nil && meta.PlatformAIGrant != "" && meta.PlatformAIGatewayURL != ""
}

func platformPreferenceScope(meta *session.Meta) string {
	return meta.NamespacePublicID + "\x00" + meta.EndpointID + "\x00" + meta.UserPublicID
}

func (s *Service) EnabledForSession(meta *session.Meta) bool {
	return s != nil && (s.Enabled() || platformSessionAvailable(meta))
}

// sessionModelConfig projects the live entitlement catalog into a request-local
// profile. It never stores grants, provider credentials, or catalog authority in
// the environment configuration or another user's model list.
func (s *Service) sessionModelConfig(ctx context.Context, meta *session.Meta, cfg *config.AIConfig) (*config.AIConfig, error) {
	if !platformSessionAvailable(meta) {
		return cfg, nil
	}
	gateway, err := newPlatformGatewayProvider(meta.PlatformAIGatewayURL, meta.PlatformAIGrant, "catalog", meta.PlatformAIEntitlementVersion)
	if err != nil {
		return nil, err
	}
	p := gateway.(*platformGatewayProvider)
	if err = p.renew(ctx); err != nil {
		return nil, err
	}
	catalog, err := p.catalog(ctx)
	if err != nil {
		return nil, err
	}
	next := config.AIConfig{}
	if cfg != nil {
		next = *cfg
	}
	next.Providers = nil
	if cfg != nil {
		for _, provider := range cfg.Providers {
			if provider.Type == platformGatewayProviderType {
				continue
			}
			if provider.ID == "platform" {
				return nil, errors.New("platform is reserved for the authorized platform catalog")
			}
			next.Providers = append(next.Providers, provider)
		}
	}
	provider := config.AIProvider{ID: "platform", Name: "Redeven AI", Type: platformGatewayProviderType}
	seen := map[string]bool{}
	for _, entry := range catalog.Models {
		if !entry.Available {
			continue
		}
		if entry.ModelID == "" || len(entry.ModelID) > 128 || seen[entry.ModelID] || entry.ContextWindow <= 0 || entry.ContextWindow > 2_000_000 || entry.MaxOutputTokens <= 0 || entry.MaxOutputTokens > 200_000 || slices.Contains(entry.Capabilities, "chat") == slices.Contains(entry.Capabilities, "responses") {
			return nil, errors.New("invalid authorized model catalog")
		}
		seen[entry.ModelID] = true
		model := config.AIProviderModel{ModelName: config.AIModelLocalName(entry.ModelID), WireModelName: entry.ModelID, DisplayName: entry.DisplayName, ContextWindow: entry.ContextWindow, MaxOutputTokens: entry.MaxOutputTokens, InputModalities: []string{"text"}}
		model.HostedWebSearch = slices.Contains(entry.Capabilities, "web_search") && slices.Contains(entry.Capabilities, "responses")
		if slices.Contains(entry.Capabilities, "image_input") {
			model.InputModalities = append(model.InputModalities, "image")
		}
		if len(entry.ReasoningLevels) > 0 {
			if !slices.Contains(entry.Capabilities, "reasoning") {
				return nil, errors.New("invalid authorized reasoning capability")
			}
			wireShape := "openai_chat_reasoning_effort"
			if slices.Contains(entry.Capabilities, "responses") {
				wireShape = "openai_responses_reasoning_effort"
			}
			model.ReasoningCapability = config.AIReasoningCapability{Kind: "effort", WireShape: wireShape, SupportedLevels: entry.ReasoningLevels, DefaultLevel: entry.ReasoningDefaultLevel, SourceURLs: []string{p.baseURL + "/api/ai/v1/catalog"}, SourceCheckedAt: time.Now().UTC().Format("2006-01-02"), Fixture: "platform_catalog"}
			if err := model.ReasoningCapability.Validate(); err != nil {
				return nil, errors.New("invalid authorized reasoning capability")
			}
		}
		provider.Models = append(provider.Models, model)
	}
	if len(provider.Models) > 0 {
		next.Providers = append(next.Providers, provider)
	}
	s.mu.Lock()
	selected := s.platformModelPreferences[platformPreferenceScope(meta)]
	s.mu.Unlock()
	if time.Since(selected.used) < 24*time.Hour && next.IsAllowedModelID(selected.model) {
		next.CurrentModelID = selected.model
	}
	if !next.IsAllowedModelID(next.CurrentModelID) {
		next.CurrentModelID = ""
		for _, p := range next.Providers {
			if models := p.EffectiveModels(); len(models) > 0 {
				next.CurrentModelID = p.ID + "/" + models[0].ModelName
				break
			}
		}
	}
	return &next, nil
}

func (s *Service) ListModelsForSession(ctx context.Context, meta *session.Meta) (*ModelsResponse, error) {
	if s == nil {
		return nil, ErrNotConfigured
	}
	s.mu.Lock()
	cfg := s.cfg
	s.mu.Unlock()
	cfg, err := s.sessionModelConfig(ctx, meta, cfg)
	if err != nil {
		return nil, err
	}
	models, err := s.listModels(ctx, cfg)
	if err == nil {
		models.Runtime.PlatformAvailable = platformSessionAvailable(meta)
	}
	return models, err
}

func (s *Service) PlatformAvailableForSession(meta *session.Meta) bool {
	return s != nil && platformSessionAvailable(meta)
}

func (s *Service) SetCurrentModelForSession(ctx context.Context, meta *session.Meta, modelID string, persist func(*config.AIConfig) error) error {
	modelID = strings.TrimSpace(modelID)
	if !strings.HasPrefix(modelID, "platform/") || !platformSessionAvailable(meta) {
		return s.SetCurrentModelID(modelID, persist)
	}
	models, err := s.ListModelsForSession(ctx, meta)
	if err != nil {
		return err
	}
	if !slices.ContainsFunc(models.Models, func(m Model) bool { return m.ID == modelID }) {
		return errors.New("platform model is not authorized")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.platformModelPreferences == nil {
		s.platformModelPreferences = map[string]platformModelPreference{}
	}
	// Preferences are bounded conveniences, never cached authorization. Thread
	// selections remain durable in the canonical thread settings.
	for key, preference := range s.platformModelPreferences {
		if time.Since(preference.used) >= 24*time.Hour {
			delete(s.platformModelPreferences, key)
		}
	}
	if len(s.platformModelPreferences) >= 1024 {
		oldestKey := ""
		oldest := time.Now()
		for key, preference := range s.platformModelPreferences {
			if preference.used.Before(oldest) {
				oldestKey, oldest = key, preference.used
			}
		}
		delete(s.platformModelPreferences, oldestKey)
	}
	s.platformModelPreferences[platformPreferenceScope(meta)] = platformModelPreference{model: modelID, used: time.Now()}
	return nil
}
