package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/runtime"
)

func (r *run) toolWriteTodos(ctx context.Context, toolID string, todos []TodoItem, expectedVersion *int64, explanation string) (any, error) {
	if r == nil {
		return nil, errors.New("run is not ready")
	}
	host := r.activeFloretHost()
	if host == nil {
		return nil, errors.New("Floret host is not ready")
	}
	threadID := strings.TrimSpace(r.threadID)
	turnID := strings.TrimSpace(r.turnID)
	runID := strings.TrimSpace(r.id)
	toolID = strings.TrimSpace(toolID)
	if threadID == "" || turnID == "" || runID == "" || toolID == "" {
		return nil, errors.New("canonical todo update identity is incomplete")
	}
	current, err := host.ReadThreadAgentTodos(ctx, flruntime.ThreadID(threadID))
	if err != nil {
		return nil, err
	}
	hydratedTodos, hydratedCount, missingCount := hydrateTodoContent(todos, current.Items)
	if hydratedCount > 0 {
		r.recordRunDiagnostic("todos.args_hydrated", RealtimeStreamKindLifecycle, map[string]any{
			"hydrated_count": hydratedCount, "missing_content_count": missingCount,
			"remaining_missing_count": max(0, missingCount-hydratedCount),
		})
	}
	normalized, err := normalizeTodoItems(hydratedTodos)
	if err != nil {
		return nil, err
	}
	if err := validateActionableTodoItems(normalized); err != nil {
		return nil, err
	}
	expected := current.Version
	if expectedVersion != nil {
		expected = *expectedVersion
	}
	items := make([]flruntime.AgentTodo, 0, len(normalized))
	for _, item := range normalized {
		items = append(items, flruntime.AgentTodo{ID: item.ID, Content: item.Content, Status: flruntime.AgentTodoStatus(item.Status)})
	}
	snapshot, err := host.UpdateThreadAgentTodos(ctx, flruntime.UpdateThreadAgentTodosRequest{
		ThreadID: flruntime.ThreadID(threadID), ExpectedVersion: expected, Items: items,
		TurnID: flruntime.TurnID(turnID), RunID: flruntime.RunID(runID), ToolCallID: toolID,
	})
	if err != nil {
		if errors.Is(err, flruntime.ErrAgentTodoVersionConflict) {
			return nil, fmt.Errorf("todo version conflict: refresh and retry: %w", err)
		}
		return nil, err
	}
	summary := summarizeTodos(normalized)
	updatedAt := snapshot.UpdatedAt.UnixMilli()
	r.recordRunDiagnostic("todos.updated", RealtimeStreamKindTool, map[string]any{
		"version": snapshot.Version, "summary": summary, "updated_at_unix_ms": updatedAt,
		"updated_by_tool": toolID, "updated_by_run": runID, "explanation_hint": strings.TrimSpace(explanation),
	})
	result := map[string]any{"version": snapshot.Version, "updated_at_unix_ms": updatedAt, "summary": summary, "todos": normalized}
	if text := strings.TrimSpace(explanation); text != "" {
		result["explanation"] = text
	}
	return result, nil
}

func hydrateTodoContent(todos []TodoItem, existing []flruntime.AgentTodo) ([]TodoItem, int, int) {
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
