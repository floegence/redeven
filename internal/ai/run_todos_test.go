package ai

import (
	"context"
	"strings"
	"testing"

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
)

func TestRunToolWriteTodos_PersistsSnapshotAndEvent(t *testing.T) {
	t.Parallel()

	dbPath := t.TempDir() + "/threads.sqlite"
	s, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, threadstore.Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	r := &run{
		id:         "run_1",
		endpointID: "env_1",
		threadID:   "th_1",
		threadsDB:  s,
	}

	result, err := r.toolWriteTodos(ctx, "tool_1", []TodoItem{
		{ID: "todo_1", Content: "Inspect workspace", Status: TodoStatusInProgress},
	}, nil, "set initial todo")
	if err != nil {
		t.Fatalf("toolWriteTodos: %v", err)
	}
	resultMap, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("result type=%T, want map[string]any", result)
	}
	if int64(resultMap["version"].(int64)) != 1 {
		t.Fatalf("result version=%v, want 1", resultMap["version"])
	}
	todosResult, ok := resultMap["todos"].([]TodoItem)
	if !ok {
		t.Fatalf("result todos type=%T, want []TodoItem", resultMap["todos"])
	}
	if len(todosResult) != 1 {
		t.Fatalf("result todos len=%d, want 1", len(todosResult))
	}
	if todosResult[0].Content != "Inspect workspace" || todosResult[0].Status != TodoStatusInProgress {
		t.Fatalf("unexpected todo payload: %+v", todosResult[0])
	}

	snapshot, err := s.GetThreadTodosSnapshot(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThreadTodosSnapshot: %v", err)
	}
	if snapshot.Version != 1 {
		t.Fatalf("snapshot version=%d, want 1", snapshot.Version)
	}
	if !strings.Contains(snapshot.TodosJSON, "Inspect workspace") {
		t.Fatalf("snapshot todos_json=%q, want todo content", snapshot.TodosJSON)
	}

	events, err := s.ListRunEvents(ctx, "env_1", "run_1", 20)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	found := false
	for _, event := range events {
		if strings.TrimSpace(event.EventType) == "todos.updated" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("missing todos.updated run event")
	}
}

func TestRunToolWriteTodos_ExpectedVersionConflict(t *testing.T) {
	t.Parallel()

	dbPath := t.TempDir() + "/threads.sqlite"
	s, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, threadstore.Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	r := &run{
		id:         "run_1",
		endpointID: "env_1",
		threadID:   "th_1",
		threadsDB:  s,
	}

	if _, err := r.toolWriteTodos(ctx, "tool_1", []TodoItem{
		{ID: "todo_1", Content: "Inspect workspace", Status: TodoStatusInProgress},
	}, nil, "initial"); err != nil {
		t.Fatalf("toolWriteTodos initial: %v", err)
	}

	expected := int64(0)
	_, err = r.toolWriteTodos(ctx, "tool_2", []TodoItem{
		{ID: "todo_1", Content: "Inspect workspace", Status: TodoStatusCompleted},
	}, &expected, "stale update")
	if err == nil {
		t.Fatalf("expected version conflict error")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "version conflict") {
		t.Fatalf("err=%q, want version conflict", err.Error())
	}
}

func TestRunToolWriteTodos_HydratesMissingContentFromSnapshot(t *testing.T) {
	t.Parallel()

	dbPath := t.TempDir() + "/threads.sqlite"
	s, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, threadstore.Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	r := &run{
		id:         "run_1",
		endpointID: "env_1",
		threadID:   "th_1",
		threadsDB:  s,
	}

	if _, err := r.toolWriteTodos(ctx, "tool_1", []TodoItem{
		{ID: "todo_1", Content: "Inspect workspace", Status: TodoStatusInProgress},
		{ID: "todo_2", Content: "Run tests", Status: TodoStatusPending},
	}, nil, "initial"); err != nil {
		t.Fatalf("toolWriteTodos initial: %v", err)
	}

	expected := int64(1)
	result, err := r.toolWriteTodos(ctx, "tool_2", []TodoItem{
		{ID: "todo_1", Status: TodoStatusCompleted},
		{ID: "todo_2", Status: TodoStatusInProgress},
	}, &expected, "status-only update")
	if err != nil {
		t.Fatalf("toolWriteTodos hydrated update: %v", err)
	}

	resultMap, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("result type=%T, want map[string]any", result)
	}
	todosResult, ok := resultMap["todos"].([]TodoItem)
	if !ok {
		t.Fatalf("result todos type=%T, want []TodoItem", resultMap["todos"])
	}
	if len(todosResult) != 2 {
		t.Fatalf("result todos len=%d, want 2", len(todosResult))
	}
	if todosResult[0].Content != "Inspect workspace" || todosResult[0].Status != TodoStatusCompleted {
		t.Fatalf("todo_1=%+v, want hydrated content and completed status", todosResult[0])
	}
	if todosResult[1].Content != "Run tests" || todosResult[1].Status != TodoStatusInProgress {
		t.Fatalf("todo_2=%+v, want hydrated content and in_progress status", todosResult[1])
	}

	snapshot, err := s.GetThreadTodosSnapshot(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThreadTodosSnapshot: %v", err)
	}
	if snapshot.Version != 2 {
		t.Fatalf("snapshot version=%d, want 2", snapshot.Version)
	}

	events, err := s.ListRunEvents(ctx, "env_1", "run_1", 50)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	foundHydrated := false
	for _, event := range events {
		if strings.TrimSpace(event.EventType) == "todos.args_hydrated" {
			foundHydrated = true
			break
		}
	}
	if !foundHydrated {
		t.Fatalf("missing todos.args_hydrated run event")
	}
}

func TestRunToolWriteTodos_MissingContentWithoutMatchingIDStillFails(t *testing.T) {
	t.Parallel()

	dbPath := t.TempDir() + "/threads.sqlite"
	s, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, threadstore.Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	r := &run{
		id:         "run_1",
		endpointID: "env_1",
		threadID:   "th_1",
		threadsDB:  s,
	}

	if _, err := r.toolWriteTodos(ctx, "tool_1", []TodoItem{
		{ID: "todo_1", Content: "Inspect workspace", Status: TodoStatusInProgress},
	}, nil, "initial"); err != nil {
		t.Fatalf("toolWriteTodos initial: %v", err)
	}

	expected := int64(1)
	_, err = r.toolWriteTodos(ctx, "tool_2", []TodoItem{
		{ID: "todo_2", Status: TodoStatusCompleted},
	}, &expected, "missing content for unknown id")
	if err == nil {
		t.Fatalf("expected missing content error")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "missing content") {
		t.Fatalf("err=%q, want missing content", err.Error())
	}
}
