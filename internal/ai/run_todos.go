package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
)

func (r *run) toolWriteTodos(ctx context.Context, toolID string, todos []TodoItem, expectedVersion *int64, explanation string) (any, error) {
	if r == nil || r.threadsDB == nil {
		return nil, errors.New("threads store not ready")
	}
	endpointID := strings.TrimSpace(r.endpointID)
	threadID := strings.TrimSpace(r.threadID)
	if endpointID == "" || threadID == "" {
		return nil, errors.New("invalid thread context")
	}
	hydratedTodos, hydratedCount, missingCount, err := r.hydrateTodoContentFromSnapshot(ctx, endpointID, threadID, todos)
	if err != nil {
		return nil, err
	}
	if hydratedCount > 0 {
		r.persistRunEvent("todos.args_hydrated", RealtimeStreamKindLifecycle, map[string]any{
			"hydrated_count":          hydratedCount,
			"missing_content_count":   missingCount,
			"remaining_missing_count": max(0, missingCount-hydratedCount),
		})
	}
	normalized, err := normalizeTodoItems(hydratedTodos)
	if err != nil {
		return nil, err
	}
	todosJSON, err := encodeTodoItemsJSON(normalized)
	if err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	snapshot, err := r.threadsDB.ReplaceThreadTodosSnapshot(ctx, threadstore.ThreadTodosSnapshot{
		EndpointID:      endpointID,
		ThreadID:        threadID,
		TodosJSON:       todosJSON,
		UpdatedAtUnixMs: now,
		UpdatedByRunID:  strings.TrimSpace(r.id),
		UpdatedByToolID: strings.TrimSpace(toolID),
	}, expectedVersion)
	if err != nil {
		if errors.Is(err, threadstore.ErrThreadTodosVersionConflict) {
			return nil, fmt.Errorf("todo version conflict: refresh and retry: %w", threadstore.ErrThreadTodosVersionConflict)
		}
		return nil, err
	}
	summary := summarizeTodos(normalized)
	payload := map[string]any{
		"version":            snapshot.Version,
		"summary":            summary,
		"updated_at_unix_ms": snapshot.UpdatedAtUnixMs,
		"updated_by_tool":    strings.TrimSpace(toolID),
		"updated_by_run":     strings.TrimSpace(r.id),
		"explanation_hint":   strings.TrimSpace(explanation),
	}
	r.persistRunEvent("todos.updated", RealtimeStreamKindTool, payload)
	result := map[string]any{
		"version":            snapshot.Version,
		"updated_at_unix_ms": snapshot.UpdatedAtUnixMs,
		"summary":            summary,
		"todos":              normalized,
	}
	if txt := strings.TrimSpace(explanation); txt != "" {
		result["explanation"] = txt
	}
	return result, nil
}

func (r *run) hydrateTodoContentFromSnapshot(ctx context.Context, endpointID string, threadID string, todos []TodoItem) ([]TodoItem, int, int, error) {
	if len(todos) == 0 {
		return nil, 0, 0, nil
	}
	out := append([]TodoItem(nil), todos...)
	missingContent := 0
	for i := range out {
		if strings.TrimSpace(out[i].Content) == "" {
			missingContent++
		}
	}
	if missingContent == 0 {
		return out, 0, 0, nil
	}
	snapshot, err := r.threadsDB.GetThreadTodosSnapshot(ctx, endpointID, threadID)
	if err != nil {
		return nil, 0, missingContent, err
	}
	existingTodos, err := decodeTodoItemsJSON(snapshot.TodosJSON)
	if err != nil {
		return out, 0, missingContent, nil
	}
	contentByID := make(map[string]string, len(existingTodos))
	for _, item := range existingTodos {
		id := strings.TrimSpace(item.ID)
		content := strings.TrimSpace(item.Content)
		if id == "" || content == "" {
			continue
		}
		contentByID[id] = content
	}
	hydrated := 0
	for i := range out {
		if strings.TrimSpace(out[i].Content) != "" {
			continue
		}
		id := strings.TrimSpace(out[i].ID)
		if id == "" {
			continue
		}
		content := strings.TrimSpace(contentByID[id])
		if content == "" {
			continue
		}
		out[i].Content = content
		hydrated++
	}
	return out, hydrated, missingContent, nil
}
