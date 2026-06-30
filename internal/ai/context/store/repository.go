package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

// Repository provides context-oriented reads/writes over threadstore.
type Repository struct {
	db *threadstore.Store
}

func NewRepository(db *threadstore.Store) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Ready() bool {
	return r != nil && r.db != nil
}

func (r *Repository) GetOpenGoal(ctx context.Context, endpointID string, threadID string) (string, error) {
	if !r.Ready() {
		return "", errors.New("repository not ready")
	}
	return r.db.GetThreadOpenGoal(ctx, endpointID, threadID)
}

func (r *Repository) SetOpenGoal(ctx context.Context, endpointID string, threadID string, goal string) error {
	if !r.Ready() {
		return errors.New("repository not ready")
	}
	return r.db.SetThreadOpenGoal(ctx, endpointID, threadID, goal)
}

func (r *Repository) AppendTurn(ctx context.Context, endpointID string, threadID string, runID string, turnID string, userMessageID string, assistantMessageID string, createdAtUnixMs int64) (int64, error) {
	if !r.Ready() {
		return 0, errors.New("repository not ready")
	}
	return r.db.AppendConversationTurn(ctx, threadstore.ConversationTurn{
		TurnID:             strings.TrimSpace(turnID),
		EndpointID:         strings.TrimSpace(endpointID),
		ThreadID:           strings.TrimSpace(threadID),
		RunID:              strings.TrimSpace(runID),
		UserMessageID:      strings.TrimSpace(userMessageID),
		AssistantMessageID: strings.TrimSpace(assistantMessageID),
		CreatedAtUnixMs:    createdAtUnixMs,
	})
}

func (r *Repository) ListRecentDialogueTurns(ctx context.Context, endpointID string, threadID string, limit int) ([]model.DialogueTurn, error) {
	if !r.Ready() {
		return nil, errors.New("repository not ready")
	}
	turns, err := r.db.ListConversationTurns(ctx, endpointID, threadID, limit)
	if err != nil {
		return nil, err
	}
	out := make([]model.DialogueTurn, 0, len(turns))
	for _, turn := range turns {
		userText := ""
		assistantText := ""
		userMessageRowID := int64(0)
		assistantRowID := int64(0)
		userMessageFound := false
		if strings.TrimSpace(turn.UserMessageID) != "" {
			if msg, err := r.db.GetTranscriptMessage(ctx, endpointID, threadID, turn.UserMessageID); err == nil && msg != nil {
				userMessageRowID = msg.ID
				userText = strings.TrimSpace(msg.TextContent)
				userMessageFound = true
			}
		}
		if strings.TrimSpace(turn.AssistantMessageID) != "" {
			if msg, err := r.db.GetTranscriptMessage(ctx, endpointID, threadID, turn.AssistantMessageID); err == nil && msg != nil {
				assistantRowID = msg.ID
				assistantText = strings.TrimSpace(msg.TextContent)
			}
		}
		if !userMessageFound {
			continue
		}
		out = append(out, model.DialogueTurn{
			TurnRowID:          turn.ID,
			UserMessageRowID:   userMessageRowID,
			AssistantRowID:     assistantRowID,
			TurnID:             strings.TrimSpace(turn.TurnID),
			RunID:              strings.TrimSpace(turn.RunID),
			UserMessageID:      strings.TrimSpace(turn.UserMessageID),
			AssistantMessageID: strings.TrimSpace(turn.AssistantMessageID),
			UserText:           userText,
			AssistantText:      assistantText,
			CreatedAtUnixMs:    turn.CreatedAtUnixMs,
		})
	}
	return trimDialogueTurns(out, limit), nil
}

func (r *Repository) ListRecentStructuredUserInputs(ctx context.Context, endpointID string, threadID string, limit int) ([]model.StructuredUserInput, error) {
	if !r.Ready() {
		return nil, errors.New("repository not ready")
	}
	records, err := r.db.ListRecentStructuredUserInputs(ctx, endpointID, threadID, limit)
	if err != nil {
		return nil, err
	}
	out := make([]model.StructuredUserInput, 0, len(records))
	for _, rec := range records {
		out = append(out, model.StructuredUserInput{
			ResponseMessageID:   strings.TrimSpace(rec.ResponseMessageID),
			PromptID:            strings.TrimSpace(rec.PromptID),
			ToolID:              strings.TrimSpace(rec.ToolID),
			ReasonCode:          strings.TrimSpace(rec.ReasonCode),
			QuestionID:          strings.TrimSpace(rec.QuestionID),
			Header:              strings.TrimSpace(rec.Header),
			Question:            strings.TrimSpace(rec.QuestionText),
			SelectedChoiceID:    strings.TrimSpace(rec.SelectedChoiceID),
			SelectedChoiceLabel: strings.TrimSpace(rec.SelectedChoiceLabel),
			Text:                strings.TrimSpace(rec.Text),
			PublicSummary:       strings.TrimSpace(rec.PublicSummary),
			ContainsSecret:      rec.ContainsSecret,
			CreatedAtUnixMs:     rec.CreatedAtUnixMs,
		})
	}
	return out, nil
}

func trimDialogueTurns(turns []model.DialogueTurn, limit int) []model.DialogueTurn {
	if limit <= 0 || len(turns) <= limit {
		return turns
	}
	return append([]model.DialogueTurn(nil), turns[len(turns)-limit:]...)
}

func (r *Repository) UpsertCapability(ctx context.Context, capability model.ModelCapability) error {
	if !r.Ready() {
		return errors.New("repository not ready")
	}
	payload, err := json.Marshal(capability)
	if err != nil {
		return err
	}
	return r.db.UpsertProviderCapability(ctx, threadstore.ProviderCapabilityRecord{
		ProviderID:     strings.TrimSpace(capability.ProviderID),
		ModelName:      strings.TrimSpace(capability.ModelName),
		CapabilityJSON: string(payload),
	})
}

func (r *Repository) GetCapability(ctx context.Context, providerID string, modelName string) (model.ModelCapability, bool, error) {
	if !r.Ready() {
		return model.ModelCapability{}, false, errors.New("repository not ready")
	}
	rec, err := r.db.GetProviderCapability(ctx, providerID, modelName)
	if err != nil {
		return model.ModelCapability{}, false, err
	}
	if rec == nil {
		return model.ModelCapability{}, false, nil
	}
	cap := model.ModelCapability{}
	if err := json.Unmarshal([]byte(rec.CapabilityJSON), &cap); err != nil {
		return model.ModelCapability{}, false, err
	}
	cap.ProviderID = strings.TrimSpace(providerID)
	cap.ModelName = strings.TrimSpace(modelName)
	cap = model.NormalizeCapability(cap)
	return cap, true, nil
}
