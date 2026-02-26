package threadstore

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestThreadCheckpoint_RestoreReplacesDerivedAndTruncatesTranscript(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	endpointID := "env_cp"
	threadID := "th_cp"
	now := time.Now().UnixMilli()

	if err := s.CreateThread(ctx, Thread{
		ThreadID:              threadID,
		EndpointID:            endpointID,
		NamespacePublicID:     "ns_test",
		ModelID:               "openai/gpt-5-mini",
		ModelLocked:           false,
		WorkingDir:            "/tmp",
		Title:                 "Checkpoint thread",
		RunStatus:             "idle",
		CreatedByUserPublicID: "u1",
		CreatedByUserEmail:    "u1@example.com",
		UpdatedByUserPublicID: "u1",
		UpdatedByUserEmail:    "u1@example.com",
		CreatedAtUnixMs:       now,
		UpdatedAtUnixMs:       now,
		LastMessageAtUnixMs:   0,
		LastMessagePreview:    "",
	}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	// Seed a baseline user message and some derived planes.
	msgAt := now + 1
	if _, err := s.AppendMessage(ctx, endpointID, threadID, Message{
		ThreadID:           threadID,
		EndpointID:         endpointID,
		MessageID:          "m_user_1",
		Role:               "user",
		AuthorUserPublicID: "u1",
		AuthorUserEmail:    "u1@example.com",
		Status:             "complete",
		CreatedAtUnixMs:    msgAt,
		UpdatedAtUnixMs:    msgAt,
		TextContent:        "hello",
		MessageJSON:        `{"id":"m_user_1","role":"user","blocks":[{"type":"text","text":"hello"}]}`,
	}, "u1", "u1@example.com"); err != nil {
		t.Fatalf("AppendMessage baseline: %v", err)
	}

	if err := s.UpsertMemoryItem(ctx, MemoryItemRecord{
		MemoryID:        "mem_1",
		EndpointID:      endpointID,
		ThreadID:        threadID,
		Scope:           "working",
		Kind:            "constraint",
		Content:         "baseline constraint",
		SourceRefsJSON:  "[]",
		Importance:      0.9,
		Freshness:       0.9,
		Confidence:      0.9,
		CreatedAtUnixMs: now,
		UpdatedAtUnixMs: now,
	}); err != nil {
		t.Fatalf("UpsertMemoryItem baseline: %v", err)
	}

	if _, err := s.ReplaceThreadTodosSnapshot(ctx, ThreadTodosSnapshot{
		EndpointID:      endpointID,
		ThreadID:        threadID,
		TodosJSON:       `[{"id":"t1","title":"baseline","status":"pending"}]`,
		UpdatedAtUnixMs: now,
		UpdatedByRunID:  "run_old",
		UpdatedByToolID: "tool_old",
	}, nil); err != nil {
		t.Fatalf("ReplaceThreadTodosSnapshot baseline: %v", err)
	}

	if err := s.InsertContextSnapshot(ctx, ContextSnapshotRecord{
		SnapshotID:      "snap_1",
		EndpointID:      endpointID,
		ThreadID:        threadID,
		Level:           "thread",
		SummaryText:     "baseline summary",
		QualityScore:    0.8,
		CreatedAtUnixMs: now,
	}); err != nil {
		t.Fatalf("InsertContextSnapshot baseline: %v", err)
	}

	if err := s.UpsertExecutionSpan(ctx, ExecutionSpanRecord{
		SpanID:          "span_1",
		EndpointID:      endpointID,
		ThreadID:        threadID,
		RunID:           "run_old",
		Kind:            "tool",
		Name:            "terminal.exec",
		Status:          "success",
		PayloadJSON:     `{"k":"v"}`,
		StartedAtUnixMs: now,
		EndedAtUnixMs:   now,
		UpdatedAtUnixMs: now,
	}); err != nil {
		t.Fatalf("UpsertExecutionSpan baseline: %v", err)
	}

	if err := s.UpsertRun(ctx, RunRecord{
		RunID:           "run_old",
		EndpointID:      endpointID,
		ThreadID:        threadID,
		State:           "success",
		StartedAtUnixMs: now,
		EndedAtUnixMs:   now,
		UpdatedAtUnixMs: now,
	}); err != nil {
		t.Fatalf("UpsertRun baseline: %v", err)
	}

	if err := s.UpsertToolCall(ctx, ToolCallRecord{
		RunID:           "run_old",
		ToolID:          "tool_old",
		ToolName:        "terminal.exec",
		Status:          "success",
		ArgsJSON:        `{"command":"pwd"}`,
		ResultJSON:      `{"exit_code":0}`,
		StartedAtUnixMs: now,
		EndedAtUnixMs:   now,
	}); err != nil {
		t.Fatalf("UpsertToolCall baseline: %v", err)
	}

	if err := s.AppendRunEvent(ctx, RunEventRecord{
		EndpointID:  endpointID,
		ThreadID:    threadID,
		RunID:       "run_old",
		EventType:   "tool.result",
		StreamKind:  "tool",
		PayloadJSON: `{"ok":true}`,
		AtUnixMs:    now,
	}); err != nil {
		t.Fatalf("AppendRunEvent baseline: %v", err)
	}

	// Create checkpoint before a new run.
	cpID := "cp_run_new"
	if _, err := s.CreateThreadCheckpoint(ctx, endpointID, threadID, cpID, "run_new", CheckpointKindPreRun); err != nil {
		t.Fatalf("CreateThreadCheckpoint: %v", err)
	}

	// Mutate planes after checkpoint.
	msg2At := now + 10
	if _, err := s.AppendMessage(ctx, endpointID, threadID, Message{
		ThreadID:           threadID,
		EndpointID:         endpointID,
		MessageID:          "m_user_2",
		Role:               "user",
		AuthorUserPublicID: "u1",
		AuthorUserEmail:    "u1@example.com",
		Status:             "complete",
		CreatedAtUnixMs:    msg2At,
		UpdatedAtUnixMs:    msg2At,
		TextContent:        "bad turn",
		MessageJSON:        `{"id":"m_user_2","role":"user","blocks":[{"type":"text","text":"bad turn"}]}`,
	}, "u1", "u1@example.com"); err != nil {
		t.Fatalf("AppendMessage after: %v", err)
	}

	if err := s.UpsertMemoryItem(ctx, MemoryItemRecord{
		MemoryID:        "mem_1",
		EndpointID:      endpointID,
		ThreadID:        threadID,
		Scope:           "working",
		Kind:            "constraint",
		Content:         "mutated constraint",
		SourceRefsJSON:  "[]",
		Importance:      0.2,
		Freshness:       0.2,
		Confidence:      0.2,
		CreatedAtUnixMs: msg2At,
		UpdatedAtUnixMs: msg2At,
	}); err != nil {
		t.Fatalf("UpsertMemoryItem after: %v", err)
	}

	if _, err := s.ReplaceThreadTodosSnapshot(ctx, ThreadTodosSnapshot{
		EndpointID:      endpointID,
		ThreadID:        threadID,
		TodosJSON:       `[{"id":"t2","title":"mutated","status":"pending"}]`,
		UpdatedAtUnixMs: msg2At,
		UpdatedByRunID:  "run_new",
		UpdatedByToolID: "tool_new",
	}, nil); err != nil {
		t.Fatalf("ReplaceThreadTodosSnapshot after: %v", err)
	}

	if err := s.InsertContextSnapshot(ctx, ContextSnapshotRecord{
		SnapshotID:      "snap_2",
		EndpointID:      endpointID,
		ThreadID:        threadID,
		Level:           "thread",
		SummaryText:     "mutated summary",
		QualityScore:    0.3,
		CreatedAtUnixMs: msg2At,
	}); err != nil {
		t.Fatalf("InsertContextSnapshot after: %v", err)
	}

	if err := s.UpsertExecutionSpan(ctx, ExecutionSpanRecord{
		SpanID:          "span_2",
		EndpointID:      endpointID,
		ThreadID:        threadID,
		RunID:           "run_new",
		Kind:            "tool",
		Name:            "apply_patch",
		Status:          "success",
		PayloadJSON:     `{"changed":true}`,
		StartedAtUnixMs: msg2At,
		EndedAtUnixMs:   msg2At,
		UpdatedAtUnixMs: msg2At,
	}); err != nil {
		t.Fatalf("UpsertExecutionSpan after: %v", err)
	}

	if err := s.UpsertRun(ctx, RunRecord{
		RunID:           "run_new",
		EndpointID:      endpointID,
		ThreadID:        threadID,
		State:           "running",
		StartedAtUnixMs: msg2At,
		UpdatedAtUnixMs: msg2At,
	}); err != nil {
		t.Fatalf("UpsertRun after: %v", err)
	}

	if err := s.UpsertToolCall(ctx, ToolCallRecord{
		RunID:           "run_new",
		ToolID:          "tool_new",
		ToolName:        "apply_patch",
		Status:          "success",
		ArgsJSON:        `{"patch":"x"}`,
		ResultJSON:      `{"ok":true}`,
		StartedAtUnixMs: msg2At,
		EndedAtUnixMs:   msg2At,
	}); err != nil {
		t.Fatalf("UpsertToolCall after: %v", err)
	}

	if err := s.AppendRunEvent(ctx, RunEventRecord{
		EndpointID:  endpointID,
		ThreadID:    threadID,
		RunID:       "run_new",
		EventType:   "tool.call",
		StreamKind:  "tool",
		PayloadJSON: `{"tool":"apply_patch"}`,
		AtUnixMs:    msg2At,
	}); err != nil {
		t.Fatalf("AppendRunEvent after: %v", err)
	}

	// Restore checkpoint and ensure planes are reverted.
	if _, err := s.RestoreThreadCheckpoint(ctx, endpointID, threadID, cpID); err != nil {
		t.Fatalf("RestoreThreadCheckpoint: %v", err)
	}

	msgs, err := s.ListRecentTranscriptMessages(ctx, endpointID, threadID, 10)
	if err != nil {
		t.Fatalf("ListRecentTranscriptMessages: %v", err)
	}
	if len(msgs) != 1 || msgs[0].MessageID != "m_user_1" {
		t.Fatalf("transcript=%v, want only baseline message", msgs)
	}

	mem, err := s.ListRecentMemoryItems(ctx, endpointID, threadID, 10)
	if err != nil {
		t.Fatalf("ListRecentMemoryItems: %v", err)
	}
	if len(mem) != 1 || mem[0].Content != "baseline constraint" {
		t.Fatalf("memory=%v, want baseline constraint", mem)
	}

	todos, err := s.GetThreadTodosSnapshot(ctx, endpointID, threadID)
	if err != nil {
		t.Fatalf("GetThreadTodosSnapshot: %v", err)
	}
	if todos.Version <= 0 || todos.TodosJSON != `[{"id":"t1","title":"baseline","status":"pending"}]` {
		t.Fatalf("todos=%+v, want baseline", todos)
	}

	snaps, err := s.ListContextSnapshots(ctx, endpointID, threadID, "thread", 10)
	if err != nil {
		t.Fatalf("ListContextSnapshots: %v", err)
	}
	if len(snaps) != 1 || snaps[0].SnapshotID != "snap_1" {
		t.Fatalf("snapshots=%v, want only snap_1", snaps)
	}

	spans, err := s.ListRecentExecutionSpansByThread(ctx, endpointID, threadID, 10)
	if err != nil {
		t.Fatalf("ListRecentExecutionSpansByThread: %v", err)
	}
	if len(spans) != 1 || spans[0].SpanID != "span_1" {
		t.Fatalf("spans=%v, want only span_1", spans)
	}

	latest, err := s.GetLatestThreadCheckpoint(ctx, endpointID, threadID)
	if err != nil {
		t.Fatalf("GetLatestThreadCheckpoint: %v", err)
	}
	if latest != nil {
		t.Fatalf("latest checkpoint=%+v, want nil after pop", latest)
	}
}
