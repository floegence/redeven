package ai

import (
	"context"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
	"github.com/floegence/redeven/internal/config"
)

type todoToolCallGateway struct{ calls int }

func (g *todoToolCallGateway) StreamModel(_ context.Context, _ flruntime.ModelRequest) (<-chan flruntime.ModelEvent, error) {
	g.calls++
	events := make(chan flruntime.ModelEvent, 2)
	if g.calls == 1 {
		events <- flruntime.ModelEvent{Type: flruntime.ModelEventToolCalls, ToolCalls: []fltools.ToolCall{{ID: "tool_1", Name: "write_todos", Args: `{}`}}}
		events <- flruntime.ModelEvent{Type: flruntime.ModelEventDone, Reason: "tool_calls"}
	} else {
		events <- flruntime.ModelEvent{Type: flruntime.ModelEventDelta, Text: "done"}
		events <- flruntime.ModelEvent{Type: flruntime.ModelEventDone, Reason: "stop"}
	}
	close(events)
	return events, nil
}

func TestRunToolWriteTodosUsesCanonicalFloretState(t *testing.T) {
	r, host := newTodoTestRun(t)
	result, err := r.toolWriteTodos(context.Background(), "tool_1", []TodoItem{{ID: "todo_1", Content: "Inspect workspace", Status: TodoStatusInProgress}}, nil, "initial")
	if err != nil {
		t.Fatal(err)
	}
	if result.(map[string]any)["version"] != int64(1) {
		t.Fatalf("unexpected result: %#v", result)
	}
	snapshot, err := host.ReadThreadAgentTodos(context.Background(), flruntime.ThreadID(r.threadID))
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Version != 1 || len(snapshot.Items) != 1 || snapshot.Items[0].Content != "Inspect workspace" || snapshot.UpdatedByTurnID != flruntime.TurnID(r.messageID) || snapshot.UpdatedByRunID != flruntime.RunID(r.id) || snapshot.UpdatedByToolCall != "tool_1" {
		t.Fatalf("unexpected canonical todo state: %#v", snapshot)
	}
}

func TestRunToolWriteTodosRejectsStaleCASVersion(t *testing.T) {
	r, _ := newTodoTestRun(t)
	ctx := context.Background()
	if _, err := r.toolWriteTodos(ctx, "tool_1", []TodoItem{{ID: "todo_1", Content: "Inspect", Status: TodoStatusInProgress}}, nil, ""); err != nil {
		t.Fatal(err)
	}
	stale := int64(0)
	if _, err := r.toolWriteTodos(ctx, "tool_1", []TodoItem{{ID: "todo_1", Content: "Inspect", Status: TodoStatusCompleted}}, &stale, ""); err == nil || !strings.Contains(strings.ToLower(err.Error()), "version conflict") {
		t.Fatalf("stale update error = %v", err)
	}
}

func TestRunToolWriteTodosHydratesExistingContent(t *testing.T) {
	r, host := newTodoTestRun(t)
	ctx := context.Background()
	if _, err := r.toolWriteTodos(ctx, "tool_1", []TodoItem{{ID: "todo_1", Content: "Inspect", Status: TodoStatusInProgress}}, nil, ""); err != nil {
		t.Fatal(err)
	}
	expected := int64(1)
	if _, err := r.toolWriteTodos(ctx, "tool_1", []TodoItem{{ID: "todo_1", Status: TodoStatusCompleted}}, &expected, ""); err != nil {
		t.Fatal(err)
	}
	snapshot, err := host.ReadThreadAgentTodos(ctx, flruntime.ThreadID(r.threadID))
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Version != 2 || len(snapshot.Items) != 1 || snapshot.Items[0].Content != "Inspect" || snapshot.Items[0].Status != flruntime.AgentTodoCompleted {
		t.Fatalf("unexpected hydrated state: %#v", snapshot)
	}
}

func TestRunToolWriteTodosRejectsControlSignalTodo(t *testing.T) {
	r, host := newTodoTestRun(t)
	_, err := r.toolWriteTodos(context.Background(), "tool_1", []TodoItem{
		{ID: "work", Content: "Run tests", Status: TodoStatusCompleted},
		{ID: "finish", Content: "Call task_complete", Status: TodoStatusInProgress},
	}, nil, "")
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "control signal") {
		t.Fatalf("control todo error = %v", err)
	}
	snapshot, readErr := host.ReadThreadAgentTodos(context.Background(), flruntime.ThreadID(r.threadID))
	if readErr != nil {
		t.Fatal(readErr)
	}
	if snapshot.Version != 0 || len(snapshot.Items) != 0 {
		t.Fatalf("invalid todo changed canonical state: %#v", snapshot)
	}
}

func newTodoTestRun(t *testing.T) (*run, *flruntime.Host) {
	t.Helper()
	store := flruntime.NewMemoryStore()
	t.Cleanup(func() { _ = store.Close() })
	registry := fltools.NewRegistry(fltools.Define(
		fltools.Definition{
			Name: "write_todos", Description: "record todos", ReadOnly: true,
			Permission:  fltools.PermissionSpec{Mode: fltools.PermissionAllow},
			InputSchema: map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false},
		},
		func([]byte) (map[string]any, error) { return map[string]any{}, nil }, nil,
		func(_ context.Context, inv fltools.Invocation[map[string]any]) (fltools.Result, error) {
			return fltools.Result{CallID: inv.CallID, Name: inv.Name, Text: "recorded"}, nil
		},
	))
	host, err := flruntime.NewHost(flruntime.HostOptions{
		Config:               redevenFloretAdapterConfig("", floretModelContextPolicy(128000, 4096), config.AIReasoningSelection{}),
		Store:                store,
		ModelGateway:         &todoToolCallGateway{},
		ModelGatewayIdentity: flruntime.ModelGatewayIdentity{Provider: "test", Model: "todo-test", StateCompatibilityKey: "test:todo-test"},
		Tools:                registry,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := host.EnsureThread(context.Background(), flruntime.EnsureThreadRequest{ThreadID: "thread_1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := host.RunTurn(context.Background(), flruntime.RunTurnRequest{ThreadID: "thread_1", TurnID: "turn_1", RunID: "run_1", Input: "track work"}); err != nil {
		t.Fatal(err)
	}
	r := &run{id: "run_1", threadID: "thread_1", messageID: "turn_1"}
	r.setActiveFloretHost(host)
	return r, host
}
