package ai

import "testing"

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
