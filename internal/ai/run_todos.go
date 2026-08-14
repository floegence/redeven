package ai

import (
	"context"
	"errors"
	"strings"
	"time"
)

func (r *run) toolWriteTodos(_ context.Context, toolID string, todos []TodoItem, expectedVersion *int64, explanation string) (any, error) {
	if r == nil {
		return nil, errors.New("run is not ready")
	}
	state := r.toolRuntimeState
	if state == nil {
		return nil, errors.New("todo runtime state is not ready")
	}
	toolID = strings.TrimSpace(toolID)
	if toolID == "" {
		return nil, errors.New("todo tool identity is incomplete")
	}
	current, _ := state.todos()
	hydratedTodos, hydratedCount, missingCount := hydrateTodoContent(todos, current)
	if hydratedCount > 0 {
		r.recordRunDiagnostic("todos.args_hydrated", RealtimeStreamKindLifecycle, map[string]any{
			"hydrated_count": hydratedCount, "missing_content_count": missingCount,
			"remaining_missing_count": max(0, missingCount-hydratedCount),
		})
	}
	if err := validateActionableTodoItems(hydratedTodos); err != nil {
		return nil, err
	}
	snapshot, err := state.replaceTodos(hydratedTodos, expectedVersion)
	if err != nil {
		return nil, err
	}
	summary := summarizeTodos(hydratedTodos)
	updatedAt := time.Now().UnixMilli()
	r.recordRunDiagnostic("todos.updated", RealtimeStreamKindTool, map[string]any{
		"version": snapshot.TodoSnapshotVersion, "summary": summary, "updated_at_unix_ms": updatedAt,
		"updated_by_tool": toolID, "explanation_hint": strings.TrimSpace(explanation),
	})
	result := map[string]any{"version": snapshot.TodoSnapshotVersion, "updated_at_unix_ms": updatedAt, "summary": summary, "todos": hydratedTodos}
	if text := strings.TrimSpace(explanation); text != "" {
		result["explanation"] = text
	}
	return result, nil
}

func hydrateTodoContent(todos []TodoItem, existing []TodoItem) ([]TodoItem, int, int) {
	out := append([]TodoItem(nil), todos...)
	contentByID := make(map[string]string, len(existing))
	for _, item := range existing {
		contentByID[strings.TrimSpace(item.ID)] = strings.TrimSpace(item.Content)
	}
	hydrated, missing := 0, 0
	for index := range out {
		if strings.TrimSpace(out[index].Content) != "" {
			continue
		}
		missing++
		if content := contentByID[strings.TrimSpace(out[index].ID)]; content != "" {
			out[index].Content = content
			hydrated++
		}
	}
	return out, hydrated, missing
}
