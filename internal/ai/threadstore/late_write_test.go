package threadstore

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
)

func TestStore_RejectsLateThreadScopedWritesAfterDelete(t *testing.T) {
	t.Parallel()

	store, err := Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	const (
		endpointID = "env_late_writes"
		threadID   = "thread_late_writes"
		runID      = "run_late_writes"
	)
	if err := store.CreateThread(ctx, Thread{ThreadID: threadID, EndpointID: endpointID, Title: "late writes"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := store.UpsertRun(ctx, RunRecord{RunID: runID, EndpointID: endpointID, ThreadID: threadID, State: "running"}); err != nil {
		t.Fatalf("UpsertRun: %v", err)
	}
	if err := store.UpsertToolCall(ctx, ToolCallRecord{RunID: runID, ToolID: "tool_before_delete", ToolName: "terminal.exec", Status: "running"}); err != nil {
		t.Fatalf("UpsertToolCall: %v", err)
	}
	if err := store.AppendRunEvent(ctx, RunEventRecord{EndpointID: endpointID, ThreadID: threadID, RunID: runID, EventType: "run.start"}); err != nil {
		t.Fatalf("AppendRunEvent: %v", err)
	}
	if err := store.UpsertExecutionSpan(ctx, ExecutionSpanRecord{SpanID: "span_before_delete", EndpointID: endpointID, ThreadID: threadID, RunID: runID, Kind: "run", Name: "run", Status: "running"}); err != nil {
		t.Fatalf("UpsertExecutionSpan: %v", err)
	}
	if _, err := store.AppendMessage(ctx, endpointID, threadID, Message{
		MessageID:   "message_before_delete",
		Role:        "user",
		Status:      "complete",
		MessageJSON: `{"id":"message_before_delete","role":"user","status":"complete","blocks":[]}`,
	}, "user", "user@example.com"); err != nil {
		t.Fatalf("AppendMessage: %v", err)
	}
	if err := store.InsertPermissionSnapshot(ctx, lateWritePermissionSnapshot(endpointID, threadID, runID, "permission_before_delete")); err != nil {
		t.Fatalf("InsertPermissionSnapshot: %v", err)
	}
	if err := store.InsertChildPermissionSnapshot(ctx, lateWriteChildPermissionSnapshot(endpointID, threadID, runID, "child_permission_before_delete")); err != nil {
		t.Fatalf("InsertChildPermissionSnapshot: %v", err)
	}
	if err := store.UpsertDelegatedApprovalRequest(ctx, lateWriteDelegatedApproval(endpointID, threadID, runID, "approval_before_delete")); err != nil {
		t.Fatalf("UpsertDelegatedApprovalRequest: %v", err)
	}

	if _, err := store.DeleteThreadResources(ctx, endpointID, threadID); err != nil {
		t.Fatalf("DeleteThreadResources: %v", err)
	}

	assertLateWriteRejected(t, "run", store.UpsertRun(ctx, RunRecord{RunID: runID, EndpointID: endpointID, ThreadID: threadID, State: "success"}))
	assertLateWriteRejected(t, "tool call", store.UpsertToolCall(ctx, ToolCallRecord{RunID: runID, ToolID: "tool_after_delete", ToolName: "terminal.exec", Status: "success"}))
	assertLateWriteRejected(t, "run event", store.AppendRunEvent(ctx, RunEventRecord{EndpointID: endpointID, ThreadID: threadID, RunID: runID, EventType: "run.end"}))
	assertLateWriteRejected(t, "execution span", store.UpsertExecutionSpan(ctx, ExecutionSpanRecord{SpanID: "span_after_delete", EndpointID: endpointID, ThreadID: threadID, RunID: runID, Kind: "run", Name: "run", Status: "success"}))
	assertLateWriteRejected(t, "thread state", store.UpsertThreadState(ctx, ThreadState{EndpointID: endpointID, ThreadID: threadID, OpenGoal: "late goal"}))
	assertLateWriteRejected(t, "provider continuation", store.SetThreadProviderContinuation(ctx, endpointID, threadID, ThreadProviderContinuation{
		State:      ProviderContinuationState{Kind: "openai_responses", ID: "resp_late"},
		ProviderID: "openai",
		Model:      "gpt-5-mini",
	}))
	_, err = store.ReplaceThreadTodosSnapshot(ctx, ThreadTodosSnapshot{EndpointID: endpointID, ThreadID: threadID, TodosJSON: `[]`, UpdatedByRunID: runID}, nil)
	assertLateWriteRejected(t, "todos", err)
	assertLateWriteRejected(t, "memory", store.UpsertMemoryItem(ctx, MemoryItemRecord{MemoryID: "memory_after_delete", EndpointID: endpointID, ThreadID: threadID, Scope: "working", Kind: "fact", Content: "late memory"}))
	_, err = store.AppendMessage(ctx, endpointID, threadID, Message{
		MessageID:   "message_after_delete",
		Role:        "assistant",
		Status:      "complete",
		MessageJSON: `{"id":"message_after_delete","role":"assistant","status":"complete","blocks":[]}`,
	}, "user", "user@example.com")
	assertLateWriteRejected(t, "transcript", err)

	counts := map[string]int{
		"threads":              countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_threads WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"runs":                 countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_runs WHERE run_id = ?`, runID),
		"tool calls":           countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_tool_calls WHERE run_id = ?`, runID),
		"run events":           countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_run_events WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"execution spans":      countRowsForTest(t, store.db, `SELECT COUNT(1) FROM execution_spans WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"transcript messages":  countRowsForTest(t, store.db, `SELECT COUNT(1) FROM transcript_messages WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"thread state":         countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_thread_state WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"thread todos":         countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_thread_todos WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"memory items":         countRowsForTest(t, store.db, `SELECT COUNT(1) FROM memory_items WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"permission snapshots": countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_permission_snapshots WHERE endpoint_id = ? AND owner_thread_id = ?`, endpointID, threadID),
		"child snapshots":      countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_child_permission_snapshots WHERE endpoint_id = ? AND parent_thread_id = ?`, endpointID, threadID),
		"approval requests":    countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_delegated_approval_requests WHERE endpoint_id = ? AND parent_thread_id = ?`, endpointID, threadID),
		"approval events":      countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_delegated_approval_events WHERE endpoint_id = ? AND parent_thread_id = ?`, endpointID, threadID),
	}
	for name, count := range counts {
		if count != 0 {
			t.Fatalf("%s rows=%d, want 0", name, count)
		}
	}
}

func assertLateWriteRejected(t *testing.T, name string, err error) {
	t.Helper()
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("%s err=%v, want %v", name, err, sql.ErrNoRows)
	}
}

func lateWritePermissionSnapshot(endpointID string, threadID string, runID string, snapshotID string) PermissionSnapshotRecord {
	return PermissionSnapshotRecord{
		SnapshotID:     snapshotID,
		EndpointID:     endpointID,
		OwnerThreadID:  threadID,
		OwnerRunID:     runID,
		PermissionType: "approval_required",
		SnapshotJSON:   `{"permission_type":"approval_required"}`,
	}
}

func lateWriteChildPermissionSnapshot(endpointID string, threadID string, runID string, snapshotID string) ChildPermissionSnapshotRecord {
	return ChildPermissionSnapshotRecord{
		ChildSnapshotID:  snapshotID,
		EndpointID:       endpointID,
		ParentSnapshotID: "permission_before_delete",
		SpawnToolCallID:  "spawn_" + snapshotID,
		ParentThreadID:   threadID,
		ParentRunID:      runID,
		SubagentID:       "child_thread",
		ChildThreadID:    "child_thread",
		ChildRunID:       "child_run",
		State:            "finalized",
		SnapshotJSON:     `{"permission_type":"approval_required"}`,
	}
}

func lateWriteDelegatedApproval(endpointID string, threadID string, runID string, actionID string) DelegatedApprovalRecord {
	return DelegatedApprovalRecord{
		ActionID:       actionID,
		EndpointID:     endpointID,
		ParentThreadID: threadID,
		ParentRunID:    runID,
		ChildThreadID:  "child_thread",
		ChildRunID:     "child_run",
		RefHash:        "ref_" + actionID,
		State:          "requested",
		Status:         "pending",
		ActionJSON:     `{"state":"requested","status":"pending"}`,
	}
}
