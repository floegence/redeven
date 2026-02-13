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
	normalized, err := normalizeTodoItems(todos)
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
			return nil, fmt.Errorf("todo version conflict: refresh and retry")
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
