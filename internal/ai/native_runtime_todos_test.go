package ai

import (
	"context"
	"testing"

	contextmodel "github.com/floegence/redeven-agent/internal/ai/context/model"
)

func TestExtractWriteTodosState(t *testing.T) {
	t.Parallel()

	open, inProgress, version, ok := extractWriteTodosState(map[string]any{
		"version": 3,
		"summary": map[string]any{
			"total":       3,
			"pending":     1,
			"in_progress": 1,
			"completed":   1,
			"cancelled":   0,
		},
	})
	if !ok {
		t.Fatalf("expected valid write_todos payload")
	}
	if open != 2 || inProgress != 1 || version != 3 {
		t.Fatalf("unexpected todos state open=%d in_progress=%d version=%d", open, inProgress, version)
	}
}

func TestExtractWriteTodosState_EmptyTodosSnapshot(t *testing.T) {
	t.Parallel()

	open, inProgress, version, ok := extractWriteTodosState(map[string]any{
		"version": 4,
		"summary": map[string]any{
			"total":       0,
			"pending":     0,
			"in_progress": 0,
			"completed":   0,
			"cancelled":   0,
		},
	})
	if !ok {
		t.Fatalf("expected empty todos snapshot to be valid")
	}
	if open != 0 || inProgress != 0 || version != 4 {
		t.Fatalf("unexpected empty todos state open=%d in_progress=%d version=%d", open, inProgress, version)
	}
}

func TestUpdateTodoRuntimeState(t *testing.T) {
	t.Parallel()

	state := newRuntimeState("test objective")
	calls := []ToolCall{
		{ID: "call_1", Name: "write_todos"},
	}
	results := []ToolResult{
		{
			ToolID:   "call_1",
			ToolName: "write_todos",
			Status:   toolResultStatusSuccess,
			Data: map[string]any{
				"version": 7,
				"summary": map[string]any{
					"total":       2,
					"pending":     0,
					"in_progress": 1,
					"completed":   1,
					"cancelled":   0,
				},
			},
		},
	}

	updateTodoRuntimeState(&state, calls, results, 5)

	if !state.TodoTrackingEnabled {
		t.Fatalf("todo tracking should be enabled")
	}
	if state.TodoOpenCount != 1 {
		t.Fatalf("todo open count=%d, want 1", state.TodoOpenCount)
	}
	if state.TodoInProgressCount != 1 {
		t.Fatalf("todo in progress count=%d, want 1", state.TodoInProgressCount)
	}
	if state.TodoSnapshotVersion != 7 {
		t.Fatalf("todo snapshot version=%d, want 7", state.TodoSnapshotVersion)
	}
	if state.TodoLastUpdatedRound != 5 {
		t.Fatalf("todo last updated round=%d, want 5", state.TodoLastUpdatedRound)
	}
}

func TestDeriveTodoRuntimeStateFromPromptPack(t *testing.T) {
	t.Parallel()

	openCount, inProgressCount, ok := deriveTodoRuntimeStateFromPromptPack(contextmodel.PromptPack{
		PendingTodos: []contextmodel.MemoryItem{
			{MemoryID: "thread_todo::todo_1", Content: "[in_progress] Inspect workspace"},
			{MemoryID: "thread_todo::todo_2", Content: "Run tests"},
		},
	})
	if !ok {
		t.Fatalf("expected prompt-pack todo state to be available")
	}
	if openCount != 2 || inProgressCount != 1 {
		t.Fatalf("unexpected prompt-pack todo state open=%d in_progress=%d", openCount, inProgressCount)
	}
}

func TestHydrateTodoRuntimeState_FromPromptPackFallback(t *testing.T) {
	t.Parallel()

	r := &run{}
	state := newRuntimeState("objective")
	source, hydrated := r.hydrateTodoRuntimeState(context.Background(), &state, contextmodel.PromptPack{
		PendingTodos: []contextmodel.MemoryItem{
			{MemoryID: "thread_todo::todo_1", Content: "Inspect workspace"},
		},
	})
	if !hydrated {
		t.Fatalf("expected todo hydration from prompt pack")
	}
	if source != "prompt_pack" {
		t.Fatalf("source=%q, want prompt_pack", source)
	}
	if !state.TodoTrackingEnabled || state.TodoOpenCount != 1 {
		t.Fatalf("unexpected hydrated state tracking=%v open=%d", state.TodoTrackingEnabled, state.TodoOpenCount)
	}
}
