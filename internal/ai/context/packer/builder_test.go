package packer

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/ai/context/compactor"
	"github.com/floegence/redeven-agent/internal/ai/context/model"
	"github.com/floegence/redeven-agent/internal/ai/context/retriever"
	contextstore "github.com/floegence/redeven-agent/internal/ai/context/store"
	"github.com/floegence/redeven-agent/internal/ai/threadstore"
)

func TestBuilder_BuildPromptPack(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	db, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = db.Close() }()

	ctx := context.Background()
	if err := db.CreateThread(ctx, threadstore.Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "test"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	now := time.Now().UnixMilli()
	if _, err := db.AppendMessage(ctx, "env_1", "th_1", threadstore.Message{
		ThreadID:        "th_1",
		EndpointID:      "env_1",
		MessageID:       "msg_user_1",
		Role:            "user",
		Status:          "complete",
		CreatedAtUnixMs: now,
		UpdatedAtUnixMs: now,
		TextContent:     "Please check failing tests and summarize status.",
		MessageJSON:     `{"id":"msg_user_1","role":"user","blocks":[{"type":"markdown","content":"Please check failing tests and summarize status."}],"status":"complete","timestamp":1}`,
	}, "u", "u@example.com"); err != nil {
		t.Fatalf("Append user: %v", err)
	}
	if _, err := db.AppendMessage(ctx, "env_1", "th_1", threadstore.Message{
		ThreadID:        "th_1",
		EndpointID:      "env_1",
		MessageID:       "msg_assistant_1",
		Role:            "assistant",
		Status:          "complete",
		CreatedAtUnixMs: now + 1,
		UpdatedAtUnixMs: now + 1,
		TextContent:     "I ran tests and found two failures.",
		MessageJSON:     `{"id":"msg_assistant_1","role":"assistant","blocks":[{"type":"markdown","content":"I ran tests and found two failures."}],"status":"complete","timestamp":2}`,
	}, "u", "u@example.com"); err != nil {
		t.Fatalf("Append assistant: %v", err)
	}
	if err := db.AppendConversationTurn(ctx, threadstore.ConversationTurn{
		TurnID:             "turn_1",
		EndpointID:         "env_1",
		ThreadID:           "th_1",
		RunID:              "run_1",
		UserMessageID:      "msg_user_1",
		AssistantMessageID: "msg_assistant_1",
		CreatedAtUnixMs:    now + 1,
	}); err != nil {
		t.Fatalf("AppendConversationTurn: %v", err)
	}
	if err := db.UpsertExecutionSpan(ctx, threadstore.ExecutionSpanRecord{
		SpanID:          "span_1",
		EndpointID:      "env_1",
		ThreadID:        "th_1",
		RunID:           "run_1",
		Kind:            "tool",
		Name:            "terminal.exec",
		Status:          "failed",
		PayloadJSON:     `{"summary":"go test failed"}`,
		StartedAtUnixMs: now,
		EndedAtUnixMs:   now + 1,
		UpdatedAtUnixMs: now + 1,
	}); err != nil {
		t.Fatalf("UpsertExecutionSpan: %v", err)
	}
	if err := db.UpsertMemoryItem(ctx, threadstore.MemoryItemRecord{
		MemoryID:        "mem_constraint_1",
		EndpointID:      "env_1",
		ThreadID:        "th_1",
		Scope:           "working",
		Kind:            "constraint",
		Content:         "Do not skip tests.",
		SourceRefsJSON:  "[]",
		Importance:      0.9,
		Freshness:       1,
		Confidence:      0.9,
		CreatedAtUnixMs: now,
		UpdatedAtUnixMs: now,
	}); err != nil {
		t.Fatalf("UpsertMemoryItem constraint: %v", err)
	}
	if err := db.UpsertMemoryItem(ctx, threadstore.MemoryItemRecord{
		MemoryID:        "mem_todo_1",
		EndpointID:      "env_1",
		ThreadID:        "th_1",
		Scope:           "working",
		Kind:            "todo",
		Content:         "Fix the two failing tests.",
		SourceRefsJSON:  "[]",
		Importance:      0.8,
		Freshness:       1,
		Confidence:      0.8,
		CreatedAtUnixMs: now,
		UpdatedAtUnixMs: now,
	}); err != nil {
		t.Fatalf("UpsertMemoryItem todo: %v", err)
	}
	if err := db.UpsertMemoryItem(ctx, threadstore.MemoryItemRecord{
		MemoryID:        "mem_long_1",
		EndpointID:      "env_1",
		ThreadID:        "th_1",
		Scope:           "long_term",
		Kind:            "decision",
		Content:         "Always run go test ./... before final response.",
		SourceRefsJSON:  "[]",
		Importance:      0.9,
		Freshness:       0.8,
		Confidence:      0.9,
		CreatedAtUnixMs: now,
		UpdatedAtUnixMs: now,
	}); err != nil {
		t.Fatalf("UpsertMemoryItem long_term: %v", err)
	}
	if _, err := db.ReplaceThreadTodosSnapshot(ctx, threadstore.ThreadTodosSnapshot{
		EndpointID:      "env_1",
		ThreadID:        "th_1",
		TodosJSON:       `[{"id":"todo_runtime_1","content":"Inspect failing tests output","status":"in_progress","note":"collect the exact assertion failure"}]`,
		UpdatedAtUnixMs: now + 2,
		UpdatedByRunID:  "run_1",
		UpdatedByToolID: "tool_1",
	}, nil); err != nil {
		t.Fatalf("ReplaceThreadTodosSnapshot: %v", err)
	}

	repo := contextstore.NewRepository(db)
	r := retriever.New(repo)
	c := compactor.New(repo)
	builder := New(repo, r, c)

	pack, err := builder.BuildPromptPack(ctx, BuildInput{
		EndpointID:     "env_1",
		ThreadID:       "th_1",
		RunID:          "run_2",
		Objective:      "Fix tests",
		UserInput:      "continue",
		Capability:     model.ModelCapability{MaxContextTokens: 2048},
		MaxInputTokens: 512,
	})
	if err != nil {
		t.Fatalf("BuildPromptPack: %v", err)
	}
	if pack.Objective == "" {
		t.Fatalf("expected objective")
	}
	if len(pack.ActiveConstraints) == 0 {
		t.Fatalf("expected active constraints")
	}
	if len(pack.RecentDialogue) == 0 {
		t.Fatalf("expected recent dialogue")
	}
	if len(pack.PendingTodos) == 0 {
		t.Fatalf("expected pending todos")
	}
	foundThreadTodo := false
	for _, item := range pack.PendingTodos {
		if item.MemoryID == "thread_todo::todo_runtime_1" {
			foundThreadTodo = true
			break
		}
	}
	if !foundThreadTodo {
		t.Fatalf("expected thread todo to be injected into pending_todos")
	}
	if pack.EstimatedInputTokens <= 0 {
		t.Fatalf("expected EstimatedInputTokens > 0")
	}
}
