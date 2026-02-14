package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/redeven-agent/internal/ai/context/model"
	"github.com/floegence/redeven-agent/internal/ai/threadstore"
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

func (r *Repository) AppendTurn(ctx context.Context, endpointID string, threadID string, runID string, turnID string, userMessageID string, assistantMessageID string, createdAtUnixMs int64) error {
	if !r.Ready() {
		return errors.New("repository not ready")
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
	if len(turns) == 0 {
		return r.listFallbackDialogue(ctx, endpointID, threadID, limit)
	}

	out := make([]model.DialogueTurn, 0, len(turns))
	for _, turn := range turns {
		userText := ""
		assistantText := ""
		if strings.TrimSpace(turn.UserMessageID) != "" {
			if msg, err := r.db.GetTranscriptMessage(ctx, endpointID, threadID, turn.UserMessageID); err == nil && msg != nil {
				userText = strings.TrimSpace(msg.TextContent)
			}
		}
		if strings.TrimSpace(turn.AssistantMessageID) != "" {
			if msg, err := r.db.GetTranscriptMessage(ctx, endpointID, threadID, turn.AssistantMessageID); err == nil && msg != nil {
				assistantText = strings.TrimSpace(msg.TextContent)
			}
		}
		out = append(out, model.DialogueTurn{
			TurnID:             strings.TrimSpace(turn.TurnID),
			RunID:              strings.TrimSpace(turn.RunID),
			UserMessageID:      strings.TrimSpace(turn.UserMessageID),
			AssistantMessageID: strings.TrimSpace(turn.AssistantMessageID),
			UserText:           userText,
			AssistantText:      assistantText,
			CreatedAtUnixMs:    turn.CreatedAtUnixMs,
		})
	}
	return out, nil
}

func (r *Repository) listFallbackDialogue(ctx context.Context, endpointID string, threadID string, limit int) ([]model.DialogueTurn, error) {
	messages, err := r.db.ListRecentTranscriptMessages(ctx, endpointID, threadID, limit*2)
	if err != nil {
		return nil, err
	}
	out := make([]model.DialogueTurn, 0, len(messages)/2+1)
	var pendingUser *threadstore.Message
	for _, msg := range messages {
		role := strings.ToLower(strings.TrimSpace(msg.Role))
		switch role {
		case "user":
			msgCopy := msg
			pendingUser = &msgCopy
		case "assistant":
			if pendingUser == nil {
				continue
			}
			out = append(out, model.DialogueTurn{
				TurnID:             "fallback::" + strings.TrimSpace(pendingUser.MessageID),
				RunID:              "",
				UserMessageID:      strings.TrimSpace(pendingUser.MessageID),
				AssistantMessageID: strings.TrimSpace(msg.MessageID),
				UserText:           strings.TrimSpace(pendingUser.TextContent),
				AssistantText:      strings.TrimSpace(msg.TextContent),
				CreatedAtUnixMs:    msg.CreatedAtUnixMs,
			})
			pendingUser = nil
		}
	}
	if len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out, nil
}

func (r *Repository) UpsertExecutionEvidence(ctx context.Context, endpointID string, threadID string, runID string, evidence model.ExecutionEvidence) error {
	if !r.Ready() {
		return errors.New("repository not ready")
	}
	payload := strings.TrimSpace(evidence.PayloadJSON)
	if payload == "" {
		payload = "{}"
	}
	return r.db.UpsertExecutionSpan(ctx, threadstore.ExecutionSpanRecord{
		SpanID:          strings.TrimSpace(evidence.SpanID),
		EndpointID:      strings.TrimSpace(endpointID),
		ThreadID:        strings.TrimSpace(threadID),
		RunID:           strings.TrimSpace(runID),
		Kind:            strings.TrimSpace(evidence.Kind),
		Name:            strings.TrimSpace(evidence.Name),
		Status:          strings.TrimSpace(evidence.Status),
		PayloadJSON:     payload,
		StartedAtUnixMs: evidence.StartedAtUnixMs,
		EndedAtUnixMs:   evidence.EndedAtUnixMs,
		UpdatedAtUnixMs: evidence.EndedAtUnixMs,
	})
}

func (r *Repository) ListRecentExecutionEvidence(ctx context.Context, endpointID string, threadID string, limit int) ([]model.ExecutionEvidence, error) {
	if !r.Ready() {
		return nil, errors.New("repository not ready")
	}
	recs, err := r.db.ListRecentExecutionSpansByThread(ctx, endpointID, threadID, limit)
	if err != nil {
		return nil, err
	}
	out := make([]model.ExecutionEvidence, 0, len(recs))
	for _, rec := range recs {
		summary := strings.TrimSpace(rec.Name)
		if summary == "" {
			summary = strings.TrimSpace(rec.Kind)
		}
		if strings.TrimSpace(rec.Status) != "" {
			summary = strings.TrimSpace(summary + " [" + strings.TrimSpace(rec.Status) + "]")
		}
		out = append(out, model.ExecutionEvidence{
			SpanID:          strings.TrimSpace(rec.SpanID),
			RunID:           strings.TrimSpace(rec.RunID),
			Kind:            strings.TrimSpace(rec.Kind),
			Name:            strings.TrimSpace(rec.Name),
			Status:          strings.TrimSpace(rec.Status),
			Summary:         summary,
			PayloadJSON:     strings.TrimSpace(rec.PayloadJSON),
			StartedAtUnixMs: rec.StartedAtUnixMs,
			EndedAtUnixMs:   rec.EndedAtUnixMs,
		})
	}
	return out, nil
}

func (r *Repository) ListRunExecutionEvidence(ctx context.Context, endpointID string, runID string, limit int) ([]model.ExecutionEvidence, error) {
	if !r.Ready() {
		return nil, errors.New("repository not ready")
	}
	recs, err := r.db.ListExecutionSpansByRun(ctx, endpointID, runID, limit)
	if err != nil {
		return nil, err
	}
	out := make([]model.ExecutionEvidence, 0, len(recs))
	for _, rec := range recs {
		summary := strings.TrimSpace(rec.Name)
		if summary == "" {
			summary = strings.TrimSpace(rec.Kind)
		}
		if strings.TrimSpace(rec.Status) != "" {
			summary = strings.TrimSpace(summary + " [" + strings.TrimSpace(rec.Status) + "]")
		}
		out = append(out, model.ExecutionEvidence{
			SpanID:          strings.TrimSpace(rec.SpanID),
			RunID:           strings.TrimSpace(rec.RunID),
			Kind:            strings.TrimSpace(rec.Kind),
			Name:            strings.TrimSpace(rec.Name),
			Status:          strings.TrimSpace(rec.Status),
			Summary:         summary,
			PayloadJSON:     strings.TrimSpace(rec.PayloadJSON),
			StartedAtUnixMs: rec.StartedAtUnixMs,
			EndedAtUnixMs:   rec.EndedAtUnixMs,
		})
	}
	return out, nil
}

func (r *Repository) UpsertMemoryItems(ctx context.Context, endpointID string, threadID string, items []model.MemoryItem) error {
	if !r.Ready() {
		return errors.New("repository not ready")
	}
	for _, item := range items {
		rec := threadstore.MemoryItemRecord{
			MemoryID:        strings.TrimSpace(item.MemoryID),
			EndpointID:      strings.TrimSpace(endpointID),
			ThreadID:        strings.TrimSpace(threadID),
			Scope:           string(item.Scope),
			Kind:            string(item.Kind),
			Content:         strings.TrimSpace(item.Content),
			SourceRefsJSON:  strings.TrimSpace(item.SourceRefsJSON),
			Importance:      item.Importance,
			Freshness:       item.Freshness,
			Confidence:      item.Confidence,
			CreatedAtUnixMs: item.CreatedAtUnix,
			UpdatedAtUnixMs: item.UpdatedAtUnix,
		}
		if err := r.db.UpsertMemoryItem(ctx, rec); err != nil {
			return err
		}
	}
	return nil
}

func (r *Repository) ListRecentMemoryItems(ctx context.Context, endpointID string, threadID string, limit int) ([]model.MemoryItem, error) {
	if !r.Ready() {
		return nil, errors.New("repository not ready")
	}
	recs, err := r.db.ListRecentMemoryItems(ctx, endpointID, threadID, limit)
	if err != nil {
		return nil, err
	}
	out := make([]model.MemoryItem, 0, len(recs))
	for _, rec := range recs {
		out = append(out, model.MemoryItem{
			MemoryID:       strings.TrimSpace(rec.MemoryID),
			ThreadID:       strings.TrimSpace(rec.ThreadID),
			Scope:          model.MemoryScope(strings.TrimSpace(rec.Scope)),
			Kind:           model.MemoryKind(strings.TrimSpace(rec.Kind)),
			Content:        strings.TrimSpace(rec.Content),
			SourceRefsJSON: strings.TrimSpace(rec.SourceRefsJSON),
			Importance:     rec.Importance,
			Freshness:      rec.Freshness,
			Confidence:     rec.Confidence,
			CreatedAtUnix:  rec.CreatedAtUnixMs,
			UpdatedAtUnix:  rec.UpdatedAtUnixMs,
		})
	}
	return out, nil
}

func (r *Repository) ListThreadBlockers(ctx context.Context, endpointID string, threadID string, limit int) ([]model.MemoryItem, error) {
	if !r.Ready() {
		return nil, errors.New("repository not ready")
	}
	recs, err := r.db.ListMemoryItemsByScopeKind(ctx, endpointID, threadID, "working", string(model.MemoryKindBlocker), limit)
	if err != nil {
		return nil, err
	}
	out := make([]model.MemoryItem, 0, len(recs))
	for _, rec := range recs {
		out = append(out, model.MemoryItem{
			MemoryID:       strings.TrimSpace(rec.MemoryID),
			ThreadID:       strings.TrimSpace(rec.ThreadID),
			Scope:          model.MemoryScope(strings.TrimSpace(rec.Scope)),
			Kind:           model.MemoryKind(strings.TrimSpace(rec.Kind)),
			Content:        strings.TrimSpace(rec.Content),
			SourceRefsJSON: strings.TrimSpace(rec.SourceRefsJSON),
			Importance:     rec.Importance,
			Freshness:      rec.Freshness,
			Confidence:     rec.Confidence,
			CreatedAtUnix:  rec.CreatedAtUnixMs,
			UpdatedAtUnix:  rec.UpdatedAtUnixMs,
		})
	}
	return out, nil
}

func (r *Repository) DeleteThreadMemoryItem(ctx context.Context, endpointID string, threadID string, memoryID string) error {
	if !r.Ready() {
		return errors.New("repository not ready")
	}
	return r.db.DeleteThreadMemoryItem(ctx, endpointID, threadID, memoryID)
}

type threadTodoItem struct {
	ID      string `json:"id"`
	Content string `json:"content"`
	Status  string `json:"status"`
	Note    string `json:"note"`
}

func normalizeThreadTodoStatus(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "pending":
		return "pending"
	case "in_progress":
		return "in_progress"
	case "completed":
		return "completed"
	case "cancelled":
		return "cancelled"
	default:
		return ""
	}
}

func (r *Repository) ListThreadPendingTodos(ctx context.Context, endpointID string, threadID string, limit int) ([]model.MemoryItem, error) {
	if !r.Ready() {
		return nil, errors.New("repository not ready")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return nil, errors.New("invalid request")
	}
	if limit <= 0 {
		limit = 8
	}
	if limit > 40 {
		limit = 40
	}

	snapshot, err := r.db.GetThreadTodosSnapshot(ctx, endpointID, threadID)
	if err != nil {
		return nil, err
	}
	raw := strings.TrimSpace(snapshot.TodosJSON)
	if raw == "" {
		raw = "[]"
	}
	var todos []threadTodoItem
	if err := json.Unmarshal([]byte(raw), &todos); err != nil {
		return nil, err
	}

	out := make([]model.MemoryItem, 0, len(todos))
	seen := make(map[string]struct{}, len(todos))
	for i, item := range todos {
		if len(out) >= limit {
			break
		}
		content := strings.TrimSpace(item.Content)
		if content == "" {
			continue
		}
		status := normalizeThreadTodoStatus(item.Status)
		if status != "pending" && status != "in_progress" {
			continue
		}
		id := strings.TrimSpace(item.ID)
		if id == "" {
			id = fmt.Sprintf("todo_%d", i+1)
		}
		memoryID := "thread_todo::" + id
		if _, ok := seen[memoryID]; ok {
			continue
		}
		seen[memoryID] = struct{}{}

		normalizedContent := content
		if status == "in_progress" {
			normalizedContent = "[in_progress] " + normalizedContent
		}
		if note := strings.TrimSpace(item.Note); note != "" {
			normalizedContent = normalizedContent + " (" + note + ")"
		}

		out = append(out, model.MemoryItem{
			MemoryID:       memoryID,
			ThreadID:       threadID,
			Scope:          model.MemoryScopeWorking,
			Kind:           model.MemoryKindTodo,
			Content:        normalizedContent,
			SourceRefsJSON: `["thread_todos"]`,
			Importance:     0.85,
			Freshness:      1,
			Confidence:     0.95,
			CreatedAtUnix:  snapshot.UpdatedAtUnixMs,
			UpdatedAtUnix:  snapshot.UpdatedAtUnixMs,
		})
	}
	return out, nil
}

func (r *Repository) InsertSnapshot(ctx context.Context, endpointID string, threadID string, level string, snapshotID string, summary string, fromID int64, toID int64, quality float64, createdAtUnixMs int64) error {
	if !r.Ready() {
		return errors.New("repository not ready")
	}
	return r.db.InsertContextSnapshot(ctx, threadstore.ContextSnapshotRecord{
		SnapshotID:       strings.TrimSpace(snapshotID),
		EndpointID:       strings.TrimSpace(endpointID),
		ThreadID:         strings.TrimSpace(threadID),
		Level:            strings.TrimSpace(level),
		SummaryText:      strings.TrimSpace(summary),
		CoversTurnFromID: fromID,
		CoversTurnToID:   toID,
		QualityScore:     quality,
		CreatedAtUnixMs:  createdAtUnixMs,
	})
}

func (r *Repository) LatestSnapshot(ctx context.Context, endpointID string, threadID string, level string) (string, error) {
	if !r.Ready() {
		return "", errors.New("repository not ready")
	}
	snapshots, err := r.db.ListContextSnapshots(ctx, endpointID, threadID, level, 1)
	if err != nil {
		return "", err
	}
	if len(snapshots) == 0 {
		return "", nil
	}
	return strings.TrimSpace(snapshots[0].SummaryText), nil
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
