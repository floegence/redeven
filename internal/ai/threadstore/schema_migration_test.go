package threadstore

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/testutil/legacydb"
	_ "modernc.org/sqlite"
)

func TestOpenMigratesCanonicalV15ToProductV2(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	if err := legacydb.SeedThreadstoreV15(dbPath); err != nil {
		t.Fatalf("seed legacy threadstore: %v", err)
	}
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open legacy threadstore: %v", err)
	}
	if _, err := raw.Exec(`
INSERT INTO ai_threads(thread_id, endpoint_id, namespace_public_id, model_id, title, created_at_unix_ms, updated_at_unix_ms)
VALUES('thread_product', 'env_1', 'ns_1', 'model_1', 'Keep this thread', 100, 200);
INSERT INTO ai_queued_turns(queue_id, endpoint_id, thread_id, message_id, model_id, text_content, created_at_unix_ms)
VALUES('queue_1', 'env_1', 'thread_product', 'message_1', 'model_1', 'pending prompt', 300);
`); err != nil {
		_ = raw.Close()
		t.Fatalf("seed product and queued data: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close legacy threadstore: %v", err)
	}

	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open migrated threadstore: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close migrated threadstore: %v", err)
	}

	raw, err = sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("reopen migrated threadstore: %v", err)
	}
	defer func() { _ = raw.Close() }()

	var version int
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatalf("read schema version: %v", err)
	}
	if version != CurrentSchemaVersion() {
		t.Fatalf("schema version=%d, want %d", version, CurrentSchemaVersion())
	}
	var kind string
	if err := raw.QueryRow(`SELECT db_kind FROM __redeven_db_meta WHERE singleton = 1`).Scan(&kind); err != nil {
		t.Fatalf("read schema kind: %v", err)
	}
	if kind != threadstoreSchemaKind {
		t.Fatalf("schema kind=%q, want %q", kind, threadstoreSchemaKind)
	}

	var title string
	if err := raw.QueryRow(`SELECT title FROM ai_threads WHERE thread_id = 'thread_product'`).Scan(&title); err != nil {
		t.Fatalf("read preserved product thread: %v", err)
	}
	if title != "Keep this thread" {
		t.Fatalf("preserved thread title=%q, want %q", title, "Keep this thread")
	}
	var turnID, runID, text string
	if err := raw.QueryRow(`SELECT turn_id, run_id, text_content FROM ai_queued_turns WHERE queue_id = 'queue_1'`).Scan(&turnID, &runID, &text); err != nil {
		t.Fatalf("read migrated pending command: %v", err)
	}
	if turnID != "message_1" || runID != "run_migrated_queue_1" || text != "pending prompt" {
		t.Fatalf("migrated pending command=(%q, %q, %q), want message identity and deterministic run", turnID, runID, text)
	}

	var shadowTables int
	if err := raw.QueryRow(`SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name IN ('ai_messages', 'ai_runs', 'ai_tool_calls', 'ai_run_events', 'ai_thread_state', 'ai_thread_todos', 'ai_thread_checkpoints', 'transcript_messages', 'conversation_turns', 'memory_items', 'memory_embeddings')`).Scan(&shadowTables); err != nil {
		t.Fatalf("check removed Agent tables: %v", err)
	}
	if shadowTables != 0 {
		t.Fatalf("removed Agent table count=%d, want 0", shadowTables)
	}
	var legacyColumns int
	if err := raw.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('ai_threads') WHERE name IN ('execution_mode', 'run_status', 'run_error', 'last_message_preview')`).Scan(&legacyColumns); err != nil {
		t.Fatalf("check removed Agent columns: %v", err)
	}
	if legacyColumns != 0 {
		t.Fatalf("removed Agent column count=%d, want 0", legacyColumns)
	}
}
