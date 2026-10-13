package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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

type platformCatalogSnapshot struct {
	meta       session.Meta
	provider   config.AIProvider
	used, next time.Time
	syncing    bool
	failures   int
}

func platformCatalogScope(meta *session.Meta) string {
	raw, _ := json.Marshal([]any{platformPreferenceScope(meta), meta.PlatformAIGatewayURL, meta.PlatformAIEntitlementVersion, meta.PlatformAIGrant})
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

func (s *Service) ensurePlatformCatalog(meta *session.Meta, touch bool) {
	if !platformSessionAvailable(meta) {
		return
	}
	scope := platformCatalogScope(meta)
	s.mu.Lock()
	if s.platformCatalogs == nil {
		s.platformCatalogs = map[string]*platformCatalogSnapshot{}
	}
	cached := s.platformCatalogs[scope]
	if cached == nil {
		for key, value := range s.platformCatalogs {
			if time.Since(value.used) >= 24*time.Hour && !value.syncing {
				delete(s.platformCatalogs, key)
			}
		}
		if len(s.platformCatalogs) >= 1024 {
			s.mu.Unlock()
			return
		}
		cached = &platformCatalogSnapshot{meta: *meta}
		s.platformCatalogs[scope] = cached
	}
	if touch {
		cached.used = time.Now()
	}
	if cached.syncing || cached.next.After(time.Now()) || s.serviceClosing {
		s.mu.Unlock()
		return
	}
	cached.syncing = true
	s.serviceWorkers.Add(1)
	s.mu.Unlock()
	copyMeta := *meta
	go func() {
		defer s.serviceWorkers.Done()
		ctx := s.lifecycleCtx
		if ctx == nil {
			ctx = context.Background()
		}
		_, _ = s.refreshPlatformCatalog(ctx, &copyMeta)
	}()
}

func (s *Service) refreshPlatformCatalog(ctx context.Context, meta *session.Meta) (config.AIProvider, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var err error
	if s.modelCatalogs != nil {
		select {
		case s.modelCatalogs.slots <- struct{}{}:
			defer func() { <-s.modelCatalogs.slots }()
		case <-ctx.Done():
			err = ctx.Err()
		}
	}
	var gateway ModelGateway
	if err == nil {
		gateway, err = platformGatewayWithTransport(s.platformHTTPTransport, meta.PlatformAIGatewayURL, meta.PlatformAIGrant, "catalog", meta.PlatformAIEntitlementVersion)
	}
	var provider config.AIProvider
	if err == nil {
		p := gateway.(*platformGatewayProvider)
		if err = p.renew(ctx); err == nil {
			var catalog platformModelCatalog
			catalog, err = p.catalog(ctx)
			if err == nil {
				provider, err = projectPlatformModelCatalog(catalog, p.baseURL)
			}
		}
	}
	scope := platformCatalogScope(meta)
	s.mu.Lock()
	if s.platformCatalogs == nil {
		s.platformCatalogs = map[string]*platformCatalogSnapshot{}
	}
	cached := s.platformCatalogs[scope]
	if cached == nil {
		cached = &platformCatalogSnapshot{meta: *meta, used: time.Now()}
		s.platformCatalogs[scope] = cached
	}
	changed := false
	if err == nil {
		before, _ := json.Marshal(cached.provider)
		after, _ := json.Marshal(provider)
		changed = string(before) != string(after)
		cached.provider, cached.failures, cached.next = provider, 0, time.Now().Add(15*time.Minute)
	} else {
		delays := []time.Duration{time.Minute, 5 * time.Minute, 15 * time.Minute}
		cached.next = time.Now().Add(delays[min(cached.failures, len(delays)-1)])
		cached.failures++
	}
	cached.syncing = false
	s.mu.Unlock()
	if changed {
		s.publishModelDirectoryChanged()
	}
	return provider, err
}

func (s *Service) runPlatformModelCatalogs(ctx context.Context) {
	timer := time.NewTicker(time.Minute)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		s.mu.Lock()
		scopes := []session.Meta{}
		for _, cached := range s.platformCatalogs {
			if time.Since(cached.used) < 24*time.Hour {
				scopes = append(scopes, cached.meta)
			}
		}
		s.mu.Unlock()
		for _, meta := range scopes {
			s.ensurePlatformCatalog(&meta, false)
		}
	}
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

// localModelConfig cannot retain a previously projected platform catalog.
func localModelConfig(cfg *config.AIConfig) (*config.AIConfig, error) {
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
	return &next, nil
}

func (s *Service) sessionSelectedModel(meta *session.Meta, cfg *config.AIConfig) string {
	if meta != nil {
		s.mu.Lock()
		selected := s.platformModelPreferences[platformPreferenceScope(meta)]
		s.mu.Unlock()
		if time.Since(selected.used) < 24*time.Hour {
			return selected.model
		}
	}
	if cfg != nil {
		return cfg.CurrentModelID
	}
	return ""
}

// Resolve the chosen source before making any platform network request. Platform
// failures must never block explicit local/Desktop work or silently change sources.
func (s *Service) sessionConfigForModel(ctx context.Context, meta *session.Meta, cfg *config.AIConfig, model string) (*config.AIConfig, error) {
	if model == "" {
		model = s.sessionSelectedModel(meta, cfg)
	}
	if model != "" && !strings.HasPrefix(model, "platform/") {
		return localModelConfig(cfg)
	}
	projected, err := s.sessionModelConfig(ctx, meta, cfg)
	if err != nil {
		return nil, err
	}
	// A preference is not authorization. Its removal must block implicit work
	// until the user explicitly selects an available replacement.
	if strings.HasPrefix(model, "platform/") && !projected.IsAllowedModelID(model) {
		return nil, errors.New("selected Redeven AI model is no longer available; select another model or try again")
	}
	return projected, nil
}

// Cloud metadata is scoped to trusted session identity and entitlement version.
// It is never persisted and never substitutes for invocation lease renewal.
func (s *Service) sessionModelConfig(ctx context.Context, meta *session.Meta, cfg *config.AIConfig) (*config.AIConfig, error) {
	next, err := localModelConfig(cfg)
	if err != nil || !platformSessionAvailable(meta) {
		return next, err
	}
	scope := platformCatalogScope(meta)
	s.ensurePlatformCatalog(meta, true)
	s.mu.Lock()
	cached := s.platformCatalogs[scope]
	var provider config.AIProvider
	if cached != nil {
		provider = cached.provider
	}
	selected := s.platformModelPreferences[platformPreferenceScope(meta)]
	s.mu.Unlock()
	if provider.ID != "" {
		next.Providers = append(next.Providers, provider)
	}
	if time.Since(selected.used) < 24*time.Hour && selected.model != "" {
		next.CurrentModelID = selected.model
	}
	if next.CurrentModelID == "" && len(provider.Models) > 0 {
		next.CurrentModelID = "platform/" + provider.Models[0].ModelName
	}
	return next, nil
}

func projectPlatformModelCatalog(catalog platformModelCatalog, baseURL string) (config.AIProvider, error) {
	if catalog.Models == nil {
		return config.AIProvider{}, errors.New("incomplete authorized model catalog")
	}
	provider := config.AIProvider{ID: "platform", Name: "Redeven AI", Type: platformGatewayProviderType}
	seen := map[string]bool{}
	for _, entry := range catalog.Models {
		if !validPlatformModelAlias(entry.ModelID) || seen[entry.ModelID] {
			return config.AIProvider{}, errors.New("invalid authorized model catalog identity")
		}
		seen[entry.ModelID] = true
		if !entry.Available {
			continue
		}
		if entry.ContextWindow <= 0 || entry.ContextWindow > 2_000_000 || entry.MaxOutputTokens <= 0 || entry.MaxOutputTokens > 200_000 || slices.Contains(entry.Capabilities, "chat") == slices.Contains(entry.Capabilities, "responses") {
			return config.AIProvider{}, errors.New("invalid authorized model catalog")
		}
		model := config.AIProviderModel{ModelName: config.AIModelLocalName(entry.ModelID), WireModelName: entry.ModelID, DisplayName: entry.DisplayName, ContextWindow: entry.ContextWindow, MaxOutputTokens: entry.MaxOutputTokens, InputModalities: []string{"text"}}
		if slices.Contains(entry.Capabilities, "responses") {
			model.PlatformProtocol = "openai-responses"
		} else {
			model.PlatformProtocol = "openai-chat-completions"
		}
		model.HostedWebSearch = slices.Contains(entry.Capabilities, "web_search") && slices.Contains(entry.Capabilities, "responses")
		if slices.Contains(entry.Capabilities, "image_input") {
			model.InputModalities = append(model.InputModalities, "image")
		}
		if len(entry.ReasoningLevels) > 0 {
			if !slices.Contains(entry.Capabilities, "reasoning") {
				return config.AIProvider{}, errors.New("invalid authorized reasoning capability")
			}
			wireShape := "openai_chat_reasoning_effort"
			if slices.Contains(entry.Capabilities, "responses") {
				wireShape = "openai_responses_reasoning_effort"
			}
			model.ReasoningCapability = config.AIReasoningCapability{Kind: "effort", WireShape: wireShape, SupportedLevels: entry.ReasoningLevels, DefaultLevel: entry.ReasoningDefaultLevel, SourceURLs: []string{baseURL + "/api/ai/v1/catalog"}, SourceCheckedAt: time.Now().UTC().Format("2006-01-02"), Fixture: "platform_catalog"}
			if err := model.ReasoningCapability.Validate(); err != nil {
				return config.AIProvider{}, errors.New("invalid authorized reasoning capability")
			}
		}
		provider.Models = append(provider.Models, model)
	}

	return provider, nil
}

func (s *Service) ListModelsForSession(ctx context.Context, meta *session.Meta) (*ModelsResponse, error) {
	return s.readModelDirectory(ctx, meta, false)
}

func (s *Service) ListModelsBaselineForSession(ctx context.Context, meta *session.Meta) (*ModelsResponse, error) {
	return s.readModelDirectory(ctx, meta, true)
}

// Version 1 uses 1–255 ASCII alias characters. The external Edge wire test
// checks this boundary against the independently released control plane.
func validPlatformModelAlias(alias string) bool {
	if len(alias) == 0 || len(alias) > 255 {
		return false
	}
	for _, c := range alias {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '_', c == '-', c == '.', c == '/':
			continue
		default:
			return false
		}
	}
	return true
}

func (s *Service) PlatformAvailableForSession(meta *session.Meta) bool {
	return s != nil && platformSessionAvailable(meta)
}

func (s *Service) SetCurrentModelForSession(ctx context.Context, meta *session.Meta, modelID string, persist func(*config.AIConfig) error) error {
	modelID = strings.TrimSpace(modelID)
	if !strings.HasPrefix(modelID, "platform/") || !platformSessionAvailable(meta) {
		if err := s.SetCurrentModelID(modelID, persist); err != nil {
			return err
		}
		if meta != nil {
			s.mu.Lock()
			delete(s.platformModelPreferences, platformPreferenceScope(meta))
			s.mu.Unlock()
		}
		return nil
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
