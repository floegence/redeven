package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

// ConversationPreferences are personal defaults for new root threads, not thread settings.
type ConversationPreferences struct {
	ModelID          string                                 `json:"model_id,omitempty"`
	WorkingDir       string                                 `json:"working_dir,omitempty"`
	ReasoningByModel map[string]config.AIReasoningSelection `json:"reasoning_by_model"`
	Revision         int64                                  `json:"revision"`
}

type ConversationPreferencePatch struct {
	ExpectedRevision *int64                           `json:"expected_revision"`
	ModelID          *string                          `json:"model_id,omitempty"`
	WorkingDir       *string                          `json:"working_dir,omitempty"`
	Reasoning        *ConversationReasoningPreference `json:"reasoning,omitempty"`
}

type ConversationReasoningPreference struct {
	ModelID   string                      `json:"model_id"`
	Selection config.AIReasoningSelection `json:"selection"`
}

func conversationPreferenceScope(meta *session.Meta) threadstore.ConversationPreferenceScope {
	if meta == nil {
		return threadstore.ConversationPreferenceScope{}
	}
	return threadstore.ConversationPreferenceScope{NamespacePublicID: strings.TrimSpace(meta.NamespacePublicID), EndpointID: strings.TrimSpace(meta.EndpointID), UserPublicID: strings.TrimSpace(meta.UserPublicID)}
}

func conversationPreferencesView(stored threadstore.ConversationPreferences) (ConversationPreferences, error) {
	view := ConversationPreferences{ModelID: stored.ModelID, WorkingDir: stored.WorkingDir, Revision: stored.Revision, ReasoningByModel: map[string]config.AIReasoningSelection{}}
	for modelID, body := range stored.ReasoningByModel {
		var selection config.AIReasoningSelection
		if err := json.Unmarshal([]byte(body), &selection); err != nil {
			return view, fmt.Errorf("decode reasoning preference: %w", err)
		}
		view.ReasoningByModel[modelID] = selection
	}
	return view, nil
}

func (s *Service) GetConversationPreferences(ctx context.Context, meta *session.Meta) (ConversationPreferences, error) {
	if err := requireRead(meta); err != nil {
		return ConversationPreferences{}, err
	}
	db := s.snapshotThreadStore()
	if db == nil {
		return ConversationPreferences{}, errors.New("threads store not ready")
	}
	stored, err := db.GetConversationPreferences(ctx, conversationPreferenceScope(meta))
	if err != nil {
		return ConversationPreferences{}, err
	}
	return conversationPreferencesView(stored)
}

func (s *Service) validateConversationPreferenceModel(ctx context.Context, meta *session.Meta, modelID string) error {
	if modelID == "" {
		return errors.New("missing model_id")
	}
	s.mu.Lock()
	cfg := s.cfg
	s.mu.Unlock()
	cfg, err := s.sessionConfigForModel(ctx, meta, cfg, modelID)
	if err != nil {
		return err
	}
	cfg = s.modelCatalogs.resolve(cfg)
	if cfg != nil && cfg.IsAllowedModelID(modelID) {
		return nil
	}
	allowed, err := s.desktopModelSourceModelAllowed(ctx, modelID)
	if err != nil {
		return err
	}
	if !allowed {
		return fmt.Errorf("model not allowed: %s", modelID)
	}
	return nil
}

func (s *Service) PatchConversationPreferences(ctx context.Context, meta *session.Meta, patch ConversationPreferencePatch) (ConversationPreferences, error) {
	if err := requireRWX(meta); err != nil {
		return ConversationPreferences{}, err
	}
	if patch.ExpectedRevision == nil {
		return ConversationPreferences{}, errors.New("missing expected_revision")
	}
	db := s.snapshotThreadStore()
	if db == nil {
		return ConversationPreferences{}, errors.New("threads store not ready")
	}
	update := threadstore.ConversationPreferencePatch{ExpectedRevision: *patch.ExpectedRevision}
	if patch.ModelID != nil {
		modelID := strings.TrimSpace(*patch.ModelID)
		if err := s.validateConversationPreferenceModel(ctx, meta, modelID); err != nil {
			return ConversationPreferences{}, err
		}
		update.ModelID = &modelID
	}
	if patch.WorkingDir != nil {
		if strings.TrimSpace(*patch.WorkingDir) == "" {
			return ConversationPreferences{}, errors.New("missing working_dir")
		}
		directory, err := s.ValidateWorkingDir(*patch.WorkingDir)
		if err != nil {
			return ConversationPreferences{}, err
		}
		update.WorkingDir = &directory
	}
	if patch.Reasoning != nil {
		modelID := strings.TrimSpace(patch.Reasoning.ModelID)
		if err := s.validateConversationPreferenceModel(ctx, meta, modelID); err != nil {
			return ConversationPreferences{}, err
		}
		capability, _, _, err := s.threadReasoningDefaults(ctx, meta, modelID)
		if err != nil {
			return ConversationPreferences{}, err
		}
		selection, err := normalizeRequestedReasoningOrReject(capability, patch.Reasoning.Selection)
		if err != nil {
			return ConversationPreferences{}, reasoningSelectionError(modelID, err)
		}
		if selection.IsZero() {
			selection.Level = config.AIReasoningLevelDefault
		}
		if err := config.ValidateAIReasoningSelection(capability, selection); err != nil {
			return ConversationPreferences{}, reasoningSelectionError(modelID, err)
		}
		body, err := json.Marshal(selection)
		if err != nil {
			return ConversationPreferences{}, err
		}
		update.Reasoning = &threadstore.ModelReasoningPreference{ModelID: modelID, SelectionJSON: string(body)}
	}
	stored, err := db.PatchConversationPreferences(ctx, conversationPreferenceScope(meta), update)
	if err != nil {
		return ConversationPreferences{}, err
	}
	return conversationPreferencesView(stored)
}

// Only authenticated, stable scopes have personal defaults. Callers without a
// stable product identity cannot read another user's preferences.
func (s *Service) conversationPreferencesForCreate(ctx context.Context, meta *session.Meta) (ConversationPreferences, error) {
	scope := conversationPreferenceScope(meta)
	if scope.NamespacePublicID == "" || scope.EndpointID == "" || scope.UserPublicID == "" {
		return ConversationPreferences{}, nil
	}
	return s.GetConversationPreferences(ctx, meta)
}
