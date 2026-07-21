package ai

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/runtime"
)

type todoTestHost struct {
	mu    sync.Mutex
	state flruntime.ThreadAgentTodoState
}

func (h *todoTestHost) RunTurn(context.Context, flruntime.RunTurnRequest) (flruntime.TurnResult, error) {
	return flruntime.TurnResult{}, nil
}

func (h *todoTestHost) ReadApprovalQueue(_ context.Context, req flruntime.ReadApprovalQueueRequest) (flruntime.ApprovalQueue, error) {
	return flruntime.ApprovalQueue{RootThreadID: req.ThreadID, GeneratedAt: time.Now()}, nil
}

func (h *todoTestHost) ResolveApproval(context.Context, flruntime.ResolveApprovalRequest) (flruntime.ResolveApprovalResult, error) {
	return flruntime.ResolveApprovalResult{}, errors.New("unexpected approval resolution")
}

func (h *todoTestHost) SettlePendingTool(context.Context, flruntime.PendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error) {
	return flruntime.PendingToolSettlementResult{}, nil
}

func (h *todoTestHost) ReadThreadAgentTodos(_ context.Context, threadID flruntime.ThreadID) (flruntime.ThreadAgentTodoState, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	state := h.state
	state.ThreadID = threadID
	state.Items = append([]flruntime.AgentTodo(nil), state.Items...)
	return state, nil
}

func (h *todoTestHost) UpdateThreadAgentTodos(_ context.Context, req flruntime.UpdateThreadAgentTodosRequest) (flruntime.ThreadAgentTodoState, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if req.ExpectedVersion != h.state.Version {
		return flruntime.ThreadAgentTodoState{}, flruntime.ErrAgentTodoVersionConflict
	}
	h.state = flruntime.ThreadAgentTodoState{
		ThreadID:          req.ThreadID,
		Version:           h.state.Version + 1,
		Items:             append([]flruntime.AgentTodo(nil), req.Items...),
		UpdatedAt:         time.Now(),
		UpdatedByTurnID:   req.TurnID,
		UpdatedByRunID:    req.RunID,
		UpdatedByToolCall: req.ToolCallID,
	}
	return h.state, nil
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
	if snapshot.Version != 1 || len(snapshot.Items) != 1 || snapshot.Items[0].Content != "Inspect workspace" || snapshot.UpdatedByTurnID != flruntime.TurnID(r.turnID) || snapshot.UpdatedByRunID != flruntime.RunID(r.id) || snapshot.UpdatedByToolCall != "tool_1" {
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

func newTodoTestRun(t *testing.T) (*run, floretTurnHost) {
	t.Helper()
	host := &todoTestHost{}
	r := &run{id: "run_1", threadID: "thread_1", turnID: "turn_1", messageID: "turn_1"}
	r.setActiveFloretHost(host)
	return r, host
}
