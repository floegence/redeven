package threadstore

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

func TestStoreSchemaContainsOnlyProductThreadState(t *testing.T) {
	store := openStoreForTest(t)
	forbiddenTables := []string{
		"conversation_turns", "transcript_messages", "ai_messages", "ai_runs", "ai_tool_calls", "ai_run_events",
		"execution_spans", "ai_thread_todos", "ai_thread_state", "ai_thread_checkpoints", "memory_items", "memory_embeddings",
		"structured_user_inputs", "request_user_input_secret_answers",
		"ai_delegated_approval_requests", "ai_delegated_approval_events",
		"ai_delegated_approval_outbox", "ai_delegated_approval_idempotency",
	}
	for _, table := range forbiddenTables {
		var count int
		if err := store.db.QueryRow(`SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count); err != nil {
			t.Fatalf("inspect table %s: %v", table, err)
		}
		if count != 0 {
			t.Fatalf("forbidden Agent shadow table %s exists", table)
		}
	}
	forbiddenColumns := map[string]struct{}{
		"run_status": {}, "run_error": {}, "run_error_code": {}, "waiting_user_input_json": {},
		"last_message_at_unix_ms": {}, "last_message_preview": {}, "activity_revision": {}, "activity_signature": {},
		"title": {}, "title_source": {}, "title_generated_at_unix_ms": {}, "title_input_message_id": {},
		"title_model_id": {}, "title_prompt_version": {},
	}
	rows, err := store.db.Query(`PRAGMA table_info(ai_thread_settings)`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull, primaryKey int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			t.Fatal(err)
		}
		if _, forbidden := forbiddenColumns[name]; forbidden {
			t.Fatalf("forbidden Agent shadow column ai_thread_settings.%s exists", name)
		}
	}
	if count := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM pragma_table_info('ai_thread_fork_operations') WHERE name = 'floret_result_json'`); count != 0 {
		t.Fatal("fork operation persists a Floret result shadow")
	}
}

func TestStoreThreadMetadataAndPendingCommandRoundTrip(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	thread := ThreadSettings{
		ThreadID: "th_1", EndpointID: "env_1", NamespacePublicID: "ns_1",
		ModelID: "openai/gpt-5", ReasoningSelectionJSON: `{"effort":"high"}`,
		PermissionType: "approval_required", WorkingDir: "/workspace",
		CreatedByUserPublicID: "user_1", UpdatedByUserPublicID: "user_1",
		CreatedAtUnixMs: 10, UpdatedAtUnixMs: 10,
	}
	if err := store.CreateThread(ctx, thread); err != nil {
		t.Fatal(err)
	}
	record, position, revision, err := store.CreateFollowup(ctx, QueuedTurn{
		QueueID: "cmd_1", EndpointID: "env_1", ThreadID: "th_1", ChannelID: "ch_1",
		Lane: FollowupLaneQueued, TurnID: "turn_1", RunID: "run_1", ModelID: "openai/gpt-5",
		TextContent: "not admitted yet", AttachmentsJSON: "[]", OptionsJSON: "{}", SessionMetaJSON: "{}",
	})
	if err != nil {
		t.Fatal(err)
	}
	if position != 1 || revision != 1 || record.TurnID != "turn_1" || record.RunID != "run_1" {
		t.Fatalf("unexpected pending command: %#v position=%d revision=%d", record, position, revision)
	}
	loaded, err := store.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatal(err)
	}
	if loaded == nil || loaded.ModelID != "openai/gpt-5" || loaded.QueueRevision != 1 {
		t.Fatalf("unexpected thread metadata: %#v", loaded)
	}
	commands, err := store.ListFollowupsByLane(ctx, "env_1", "th_1", FollowupLaneQueued, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(commands) != 1 || commands[0].TextContent != "not admitted yet" || commands[0].TurnID != "turn_1" || commands[0].RunID != "run_1" {
		t.Fatalf("unexpected pending commands: %#v", commands)
	}
}

func TestStoreThreadMetadataUpdatesDoNotCreateConversationState(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	if err := store.CreateThread(ctx, ThreadSettings{ThreadID: "th_1", EndpointID: "env_1", ModelID: "openai/gpt-5", PermissionType: "approval_required", CreatedAtUnixMs: 10, UpdatedAtUnixMs: 10}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateThreadModelAndReasoningSelection(ctx, "env_1", "th_1", "openai/gpt-5.1", `{"effort":"medium"}`); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateThreadPermissionType(ctx, "env_1", "th_1", "full_access"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetThreadPinned(ctx, "env_1", "th_1", true, "user_1", "user@example.com"); err != nil {
		t.Fatal(err)
	}
	thread, err := store.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatal(err)
	}
	if thread == nil || thread.ModelID != "openai/gpt-5.1" || thread.PermissionType != "full_access" || thread.PinnedAtUnixMs <= 0 {
		t.Fatalf("unexpected updated metadata: %#v", thread)
	}
}

func TestStoreRejectsInvalidThreadPermissionContracts(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	if err := store.CreateThread(ctx, ThreadSettings{ThreadID: "invalid_create", EndpointID: "env_1", PermissionType: "unknown"}); err == nil {
		t.Fatal("CreateThread succeeded with invalid permission")
	}
	if err := store.CreateThread(ctx, ThreadSettings{ThreadID: "valid", EndpointID: "env_1", PermissionType: "approval_required"}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateThreadPermissionType(ctx, "env_1", "valid", "unknown"); err == nil {
		t.Fatal("UpdateThreadPermissionType succeeded with invalid permission")
	}
	if _, err := store.db.Exec(`UPDATE ai_thread_settings SET permission_type = 'unknown' WHERE thread_id = 'valid'`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetThread(ctx, "env_1", "valid"); err == nil {
		t.Fatal("GetThread accepted invalid persisted permission")
	}
}

func openStoreForTest(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "threads.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func countRowsForTest(t *testing.T, db *sql.DB, query string, args ...any) int {
	t.Helper()
	var count int
	if err := db.QueryRow(query, args...).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}
