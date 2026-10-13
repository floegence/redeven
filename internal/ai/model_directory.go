package ai

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/chatgpt"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

type ModelDirectoryModel struct {
	Model
	State        string `json:"state"`
	Reason       string `json:"reason,omitempty"`
	ProviderID   string `json:"provider_id,omitempty"`
	ProviderName string `json:"provider_name,omitempty"`
	ProviderType string `json:"provider_type,omitempty"`
	ModelName    string `json:"model_name,omitempty"`
}

type ModelDirectorySource struct {
	ID                    string   `json:"id"`
	Kind                  string   `json:"kind"`
	State                 string   `json:"state"`
	Reason                string   `json:"reason,omitempty"`
	MissingKeyProviderIDs []string `json:"missing_key_provider_ids,omitempty"`
}

type ModelDirectory struct {
	ProviderCatalogs map[string][]ModelCatalogModel `json:"provider_catalogs"`
	Models           []ModelDirectoryModel          `json:"models"`
	Sources          []ModelDirectorySource         `json:"sources"`
}

// RuntimeStatusSnapshot reads local observation only. Settings and baseline
// directory reads must not call an optional model-source process.
func (s *Service) RuntimeStatusSnapshot() *AIRuntimeStatus {
	if s == nil {
		return &AIRuntimeStatus{}
	}
	s.mu.Lock()
	cfg, source := s.cfg, s.desktopModelSource
	s.mu.Unlock()
	out := &AIRuntimeStatus{RemoteConfigured: cfg.HasModelProfile()}
	if source != nil {
		source.mu.Lock()
		out.DesktopModelSource = source.statusLocked(time.Now())
		source.mu.Unlock()
	}
	return out
}

func (s *Service) readModelDirectory(ctx context.Context, meta *session.Meta, _ bool) (*ModelsResponse, error) {
	if s == nil {
		return nil, ErrNotConfigured
	}
	s.mu.Lock()
	cfg, desktop := s.cfg, s.desktopModelSource
	s.mu.Unlock()
	local, err := localModelConfig(cfg)
	if err != nil {
		return nil, err
	}
	resolved := s.modelCatalogs.resolve(local)
	var snapshot *DesktopModelSourceModelSnapshot
	if platformSessionAvailable(meta) {
		platform, err := s.sessionModelConfig(ctx, meta, resolved)
		if err != nil {
			return nil, err
		}
		if platform != nil {
			resolved = platform
		}
	}
	if desktop != nil {
		snapshot = desktop.Snapshot()
	}

	status := s.RuntimeStatusSnapshot()
	status.PlatformAvailable = platformSessionAvailable(meta)
	out, err := s.listModels(resolved, snapshot, status)
	selected := s.sessionSelectedModel(meta, cfg)
	if errors.Is(err, ErrNotConfigured) {
		out, err = NewModelsResponse(status), nil
	}
	if err != nil {
		return nil, err
	}
	if strings.HasPrefix(selected, "platform/") {
		out.CurrentModel = selected
	}
	if !strings.HasPrefix(selected, "platform/") && desktop != nil && desktop.CurrentModelID() != "" {
		out.CurrentModel = desktop.CurrentModelID()
	}

	out.Directory = s.projectModelDirectory(resolved, out, snapshot)
	ready := make(map[string]bool, len(out.Directory.Models))
	for _, model := range out.Directory.Models {
		ready[model.ID] = model.State == "ready"
	}
	out.Models = slices.DeleteFunc(out.Models, func(model Model) bool { return !ready[model.ID] })
	return out, nil
}

func (s *Service) projectModelDirectory(cfg *config.AIConfig, out *ModelsResponse, desktopSnapshot *DesktopModelSourceModelSnapshot) ModelDirectory {
	directory := ModelDirectory{ProviderCatalogs: map[string][]ModelCatalogModel{}, Models: []ModelDirectoryModel{}, Sources: []ModelDirectorySource{}}
	available := map[string]Model{}
	for _, m := range out.Models {
		available[m.ID] = m
	}
	seen := map[string]bool{}
	for _, p := range cfg.Providers {
		if p.Type == platformGatewayProviderType {
			continue
		}
		directory.ProviderCatalogs[p.ID] = []ModelCatalogModel{}
		for _, m := range p.CatalogModels() {
			directory.ProviderCatalogs[p.ID] = append(directory.ProviderCatalogs[p.ID], ModelCatalogModel{AIProviderModel: m, WebSearch: config.ResolveAIWebSearch(p, m.EffectiveWireModelName(), false).AIWebSearchAvailability})
		}
		name := firstNonEmpty(p.Name, defaultProviderDisplayName(p), p.ID)
		source := ModelDirectorySource{ID: p.ID, Kind: modelSourceRuntimeConfig, State: "ready"}
		dynamic := p.Type == "ollama" || p.Type == "openrouter" || p.EffectiveAuthMethod() == config.AIAuthChatGPT
		if !p.IsEnabled() {
			source.State, source.Reason = "unavailable", "provider_disabled"
		} else if dynamic && p.ModelSelection != nil && p.ModelSelection.SelectedModels == nil {
			source.State, source.Reason = "unavailable", "selection_review_required"

		}

		if p.IsEnabled() && (s.resolveProviderKey != nil || p.EffectiveAuthMethod() == config.AIAuthChatGPT) {
			var ready bool
			var keyErr error
			if p.EffectiveAuthMethod() == config.AIAuthChatGPT {
				if s.chatGPT != nil {
					var status chatgpt.AccountStatus
					status, keyErr = s.chatGPT.Status(p.AccountID)
					ready = status.State == "ready"
				}
			} else {
				_, ready, keyErr = resolveModelProviderKey(p.Type, p.ID, s.resolveProviderKey)
			}
			if keyErr != nil {
				source.State, source.Reason = "unavailable", "credentials_unavailable"
			} else if !ready {
				source.State, source.Reason = "unavailable", "missing_keys"
			}
		}
		models := p.EffectiveModels()
		if p.ModelSelection != nil {
			for _, id := range p.ModelSelection.SelectedModels {
				if !slices.ContainsFunc(models, func(m config.AIProviderModel) bool { return m.ModelName == id }) {
					models = append(models, p.ModelMetadata(id))
				}
			}
		}
		if len(models) == 0 && source.State == "ready" {
			source.State, source.Reason = "unavailable", "empty"
		}
		directory.Sources = append(directory.Sources, source)
		for _, m := range models {
			id := p.ID + "/" + m.ModelName
			view, exists := available[id]
			if !exists {
				view = configModelView(id, name+" / "+firstNonEmpty(m.DisplayName, m.WireModelName, m.ModelName), p, m)
			}
			entry := ModelDirectoryModel{Model: view, State: source.State, Reason: source.Reason, ProviderID: p.ID, ProviderName: name, ProviderType: p.Type, ModelName: m.ModelName}
			if !exists && entry.State == "ready" {
				entry.State, entry.Reason = "unavailable", "model_missing"
				for _, metadata := range p.CatalogModels() {
					if metadata.ModelName == m.ModelName && metadata.Status == "needs_configuration" {
						entry.Reason = "needs_configuration"
						break
					}
				}
			}
			if !seen[id] {
				directory.Models = append(directory.Models, entry)
				seen[id] = true
			}
		}
	}
	if out.Runtime.PlatformAvailable || strings.HasPrefix(out.CurrentModel, "platform/") {
		source := ModelDirectorySource{ID: "platform", Kind: "platform", State: "ready"}
		if !out.Runtime.PlatformAvailable {
			source.State, source.Reason = "unavailable", "catalog_unavailable"
		}
		count := 0
		for _, m := range out.Models {
			if strings.HasPrefix(m.ID, "platform/") {
				m.Source, m.SourceLabel = "platform", "Redeven AI"
				directory.Models = append(directory.Models, ModelDirectoryModel{Model: m, State: source.State, Reason: source.Reason})
				seen[m.ID] = true
				count++
			}
		}
		if count == 0 && source.State == "ready" {
			source.State, source.Reason = "unavailable", "empty"
		}
		directory.Sources = append(directory.Sources, source)
	}
	if status := out.Runtime.DesktopModelSource; status != nil {
		source := ModelDirectorySource{ID: "desktop", Kind: modelSourceDesktopModelSource, State: "unavailable", Reason: firstNonEmpty(status.BindingState, "unbound"), MissingKeyProviderIDs: append([]string(nil), status.MissingKeyProviderIDs...)}
		if status.BindingState == "bound" {
			switch {
			case !status.Connected:
				source.Reason = "disconnected"
			case desktopSnapshot != nil && len(desktopSnapshot.Models) > 0:
				source.State, source.Reason = "ready", ""
			case len(status.MissingKeyProviderIDs) > 0:
				source.Reason = "missing_keys"
			case !status.Configured:
				source.Reason = "not_configured"
			default:
				source.Reason = "empty"
			}
		}
		for _, m := range out.Models {
			if m.Source == modelSourceDesktopModelSource {
				directory.Models = append(directory.Models, ModelDirectoryModel{Model: m, State: source.State, Reason: source.Reason})
				seen[m.ID] = true
			}
		}
		directory.Sources = append(directory.Sources, source)
	}
	if id := out.CurrentModel; id != "" && !seen[id] {
		entry := ModelDirectoryModel{Model: Model{ID: id, Label: id}, State: "unavailable", Reason: "model_missing"}
		for _, source := range directory.Sources {
			if (source.Kind == "platform" && strings.HasPrefix(id, "platform/")) || (source.Kind == modelSourceDesktopModelSource && isDesktopModelSourceModelID(id)) {
				entry.Source, entry.SourceLabel = source.Kind, map[string]string{"platform": "Redeven AI", modelSourceDesktopModelSource: "Desktop"}[source.Kind]
				if source.State != "ready" {
					entry.State, entry.Reason = source.State, source.Reason
				}
			}
		}
		directory.Models = append(directory.Models, entry)
	}
	return directory
}
