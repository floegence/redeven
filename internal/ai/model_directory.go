package ai

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"time"

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
	Models  []ModelDirectoryModel  `json:"models"`
	Sources []ModelDirectorySource `json:"sources"`
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

func (s *Service) readModelDirectory(ctx context.Context, meta *session.Meta, baseline bool) (*ModelsResponse, error) {
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
	resolved := local
	var platform *config.AIConfig
	var platformErr, desktopErr error
	var snapshot *DesktopModelSourceModelSnapshot
	failures := map[string]error{}
	if !baseline {
		// One deadline covers every optional source, including platform renewal.
		checkCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		var workers sync.WaitGroup
		workers.Add(1)
		go func() {
			defer workers.Done()
			resolved, failures, _ = resolveModelCatalogResults(checkCtx, local, s.resolveProviderKey, "")
		}()
		if platformSessionAvailable(meta) {
			workers.Add(1)
			go func() { defer workers.Done(); platform, platformErr = s.sessionModelConfig(checkCtx, meta, local) }()
		}
		if desktop != nil && desktop.hasBinding() {
			workers.Add(1)
			go func() { defer workers.Done(); snapshot, desktopErr = desktop.ListModels(checkCtx) }()
		}
		workers.Wait()
		if platform != nil {
			for _, p := range platform.Providers {
				if p.Type == platformGatewayProviderType {
					resolved.Providers = append(resolved.Providers, p)
				}
			}
			if resolved.CurrentModelID == "" {
				resolved.CurrentModelID = platform.CurrentModelID
			}
		}
	}
	status := s.RuntimeStatusSnapshot()
	status.PlatformAvailable = platformSessionAvailable(meta)
	out, err := s.listModels(resolved, snapshot, status)
	selected := s.sessionSelectedModel(meta, cfg)
	if errors.Is(err, ErrNotConfigured) && (baseline || platformSessionAvailable(meta) || strings.HasPrefix(selected, "platform/")) {
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
	if platformErr != nil {
		out.Runtime.PlatformError = "Redeven AI is currently unavailable. Select another model or try again."
	} else if !baseline && strings.HasPrefix(selected, "platform/") && !slices.ContainsFunc(out.Models, func(m Model) bool { return m.ID == selected }) {
		out.Runtime.PlatformError = "The selected Redeven AI model is no longer available. Select another model or try again."
	}
	out.Directory = s.projectModelDirectory(resolved, out, baseline, failures, platformErr, desktopErr, snapshot)
	ready := make(map[string]bool, len(out.Directory.Models))
	for _, model := range out.Directory.Models {
		ready[model.ID] = model.State == "ready"
	}
	out.Models = slices.DeleteFunc(out.Models, func(model Model) bool { return !ready[model.ID] })
	return out, nil
}

func (s *Service) projectModelDirectory(cfg *config.AIConfig, out *ModelsResponse, baseline bool, failures map[string]error, platformErr, desktopErr error, desktopSnapshot *DesktopModelSourceModelSnapshot) ModelDirectory {
	directory := ModelDirectory{Models: []ModelDirectoryModel{}, Sources: []ModelDirectorySource{}}
	available := map[string]Model{}
	for _, m := range out.Models {
		available[m.ID] = m
	}
	seen := map[string]bool{}
	for _, p := range cfg.Providers {
		if p.Type == platformGatewayProviderType {
			continue
		}
		name := firstNonEmpty(p.Name, defaultProviderDisplayName(p), p.ID)
		source := ModelDirectorySource{ID: p.ID, Kind: modelSourceRuntimeConfig, State: "ready"}
		dynamic := p.Type == "ollama" || p.Type == "openrouter"
		if dynamic && p.ModelSelection != nil && p.ModelSelection.SelectedModels == nil {
			source.State, source.Reason = "unavailable", "selection_review_required"
		} else if dynamic && p.ModelSelection != nil && len(p.ModelSelection.SelectedModels) > 0 {
			if baseline {
				source.State, source.Reason = "pending", "catalog_check"
			} else if failures[p.ID] != nil {
				source.State, source.Reason = "unavailable", "catalog_unavailable"
			}
		}
		if s.resolveProviderKey != nil {
			_, ready, keyErr := resolveModelProviderKey(p.Type, p.ID, s.resolveProviderKey)
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
					models = append(models, config.AIProviderModel{ModelName: id})
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
				view = Model{ID: id, Label: name + " / " + m.ModelName, Source: modelSourceRuntimeConfig, SourceLabel: modelSourceRuntimeConfigLabel, WebSearch: config.AIWebSearchAvailability{Status: "unavailable", Reason: "model_unavailable"}}
			}
			entry := ModelDirectoryModel{Model: view, State: source.State, Reason: source.Reason, ProviderID: p.ID, ProviderName: name, ProviderType: p.Type, ModelName: m.ModelName}
			if !exists && entry.State == "ready" {
				entry.State, entry.Reason = "unavailable", "model_missing"
			}
			if !seen[id] {
				directory.Models = append(directory.Models, entry)
				seen[id] = true
			}
		}
	}
	if out.Runtime.PlatformAvailable || strings.HasPrefix(out.CurrentModel, "platform/") {
		source := ModelDirectorySource{ID: "platform", Kind: "platform", State: "ready"}
		if baseline && out.Runtime.PlatformAvailable {
			source.State, source.Reason = "pending", "catalog_check"
		} else if platformErr != nil || !out.Runtime.PlatformAvailable {
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
			case baseline:
				source.State, source.Reason = "pending", "catalog_check"
			case desktopErr != nil:
				source.Reason = "catalog_unavailable"
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
