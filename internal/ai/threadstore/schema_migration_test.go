package threadstore

import (
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
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

	var ensured []string
	store, err := Open(dbPath, WithThreadIdentityEnsurer(func(threadID string) error {
		ensured = append(ensured, threadID)
		return nil
	}))
	if err != nil {
		t.Fatalf("Open migrated threadstore: %v", err)
	}
	if !slices.Equal(ensured, []string{"thread_product"}) {
		t.Fatalf("ensured Floret thread identities = %v", ensured)
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

func TestOpenMigratesProductV1ToV2(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := raw.Begin()
	if err != nil {
		_ = raw.Close()
		t.Fatal(err)
	}
	if err := createThreadstoreSchemaV1(tx); err != nil {
		_ = tx.Rollback()
		_ = raw.Close()
		t.Fatal(err)
	}
	if _, err := tx.Exec(`
CREATE TABLE __redeven_db_meta (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  db_kind TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_migrated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_migrated_from_version INTEGER NOT NULL DEFAULT 0,
  last_migrated_to_version INTEGER NOT NULL DEFAULT 0
);
INSERT INTO __redeven_db_meta(singleton, db_kind, last_migrated_from_version, last_migrated_to_version)
VALUES(1, 'ai_threadstore_product_v2', 1, 1);
PRAGMA user_version=1;
INSERT INTO ai_threads(thread_id, endpoint_id, permission_type, created_at_unix_ms, updated_at_unix_ms)
VALUES('thread_product_v1', 'env_1', 'approval_required', 100, 100);
INSERT INTO ai_thread_fork_operations(
  operation_id, endpoint_id, source_thread_id, destination_thread_id,
  request_fingerprint, status, snapshot_schema_version, snapshot_json,
  floret_result_json, created_at_unix_ms, updated_at_unix_ms
)
VALUES('fork_v1', 'env_1', 'thread_product_v1', 'thread_product_v1_fork',
  'fingerprint', 'pending', 1, '{}', '{"shadow":true}', 100, 100);
`); err != nil {
		_ = tx.Rollback()
		_ = raw.Close()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		_ = raw.Close()
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	raw, err = sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var version int
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != threadstoreCurrentSchemaVersion {
		t.Fatalf("user_version = %d, want %d", version, threadstoreCurrentSchemaVersion)
	}
	if count := countRowsForTest(t, raw, `SELECT COUNT(1) FROM pragma_table_info('ai_thread_fork_operations') WHERE name = 'floret_result_json'`); count != 0 {
		t.Fatal("product v1 Floret result shadow column remains")
	}
	if count := countRowsForTest(t, raw, `SELECT COUNT(1) FROM ai_thread_fork_operations WHERE operation_id = 'fork_v1'`); count != 1 {
		t.Fatalf("preserved fork operation count = %d, want 1", count)
	}
}

func TestOpenMigratesEverySupportedCanonicalVersion(t *testing.T) {
	for version := canonicalMinimumVersion; version <= canonicalCurrentVersion; version++ {
		version := version
		t.Run(fmt.Sprintf("v%d", version), func(t *testing.T) {
			dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
			seedCanonicalThreadstoreVersion(t, dbPath, version)
			var ensured []string
			store, err := Open(dbPath, WithThreadIdentityEnsurer(func(threadID string) error {
				ensured = append(ensured, threadID)
				return nil
			}))
			if err != nil {
				t.Fatalf("Open canonical v%d: %v", version, err)
			}
			if err := store.Close(); err != nil {
				t.Fatal(err)
			}
			if !slices.Equal(ensured, []string{"thread_product"}) {
				t.Fatalf("ensured thread identities = %v", ensured)
			}
			raw, err := sql.Open("sqlite", dbPath)
			if err != nil {
				t.Fatal(err)
			}
			defer raw.Close()
			var title, turnID, runID string
			if err := raw.QueryRow(`SELECT title FROM ai_threads WHERE thread_id = 'thread_product'`).Scan(&title); err != nil {
				t.Fatal(err)
			}
			if err := raw.QueryRow(`SELECT turn_id, run_id FROM ai_queued_turns WHERE queue_id = 'queue_1'`).Scan(&turnID, &runID); err != nil {
				t.Fatal(err)
			}
			if title != "Keep this thread" || turnID != "message_1" || runID != "run_migrated_queue_1" {
				t.Fatalf("migrated data = title %q turn %q run %q", title, turnID, runID)
			}
		})
	}
}

func TestOpenRejectsCanonicalVersionsOutsideSupportedRange(t *testing.T) {
	for _, version := range []int{canonicalMinimumVersion - 1, canonicalCurrentVersion + 1} {
		version := version
		t.Run(fmt.Sprintf("v%d", version), func(t *testing.T) {
			dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
			seedCanonicalThreadstoreVersion(t, dbPath, canonicalMinimumVersion)
			raw, err := sql.Open("sqlite", dbPath)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := raw.Exec(fmt.Sprintf(`UPDATE __redeven_db_meta SET last_migrated_from_version = %d, last_migrated_to_version = %d; PRAGMA user_version=%d;`, version, version, version)); err != nil {
				_ = raw.Close()
				t.Fatal(err)
			}
			if err := raw.Close(); err != nil {
				t.Fatal(err)
			}
			if _, err := Open(dbPath, WithThreadIdentityEnsurer(func(string) error { return nil })); err == nil {
				t.Fatal("Open succeeded, want unsupported canonical version error")
			}
		})
	}
}

func TestCanonicalMigrationRejectsSchemaDriftBeforeEnsuringOrDeleting(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	seedCanonicalThreadstoreVersion(t, dbPath, canonicalMinimumVersion)
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`ALTER TABLE ai_threads ADD COLUMN unexpected_patch TEXT NOT NULL DEFAULT ''`); err != nil {
		_ = raw.Close()
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	ensureCalls := 0
	_, err = Open(dbPath, WithThreadIdentityEnsurer(func(string) error {
		ensureCalls++
		return nil
	}))
	if err == nil || !strings.Contains(err.Error(), "contract mismatch") {
		t.Fatalf("Open schema drift err = %v", err)
	}
	if ensureCalls != 0 {
		t.Fatalf("ensure calls = %d, want 0", ensureCalls)
	}
	assertCanonicalDatabaseUnchanged(t, dbPath, canonicalMinimumVersion)
}

func TestCanonicalMigrationRejectsInvalidQueuedIdentityBeforeEnsuringThreads(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	seedCanonicalThreadstoreVersion(t, dbPath, canonicalMinimumVersion)
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`UPDATE ai_queued_turns SET message_id = '' WHERE queue_id = 'queue_1'`); err != nil {
		_ = raw.Close()
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	ensureCalls := 0
	_, err = Open(dbPath, WithThreadIdentityEnsurer(func(string) error {
		ensureCalls++
		return nil
	}))
	if err == nil || !strings.Contains(err.Error(), "incomplete identity") {
		t.Fatalf("Open invalid queued identity err = %v", err)
	}
	if ensureCalls != 0 {
		t.Fatalf("ensure calls = %d, want 0", ensureCalls)
	}
	assertCanonicalDatabaseUnchanged(t, dbPath, canonicalMinimumVersion)
}

func TestCanonicalMigrationRejectsInvalidPermissionBeforeEnsuringThreads(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	seedCanonicalThreadstoreVersion(t, dbPath, canonicalCurrentVersion)
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`UPDATE ai_threads SET permission_type = 'unknown' WHERE thread_id = 'thread_product'`); err != nil {
		_ = raw.Close()
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	ensureCalls := 0
	_, err = Open(dbPath, WithThreadIdentityEnsurer(func(string) error {
		ensureCalls++
		return nil
	}))
	if err == nil || !strings.Contains(err.Error(), "invalid product data") {
		t.Fatalf("Open invalid permission err = %v", err)
	}
	if ensureCalls != 0 {
		t.Fatalf("ensure calls = %d, want 0", ensureCalls)
	}
	assertCanonicalDatabaseUnchanged(t, dbPath, canonicalCurrentVersion)
}

func TestCanonicalMigrationRollsBackWhenFloretThreadEnsureFails(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	seedCanonicalThreadstoreVersion(t, dbPath, canonicalMinimumVersion)
	_, err := Open(dbPath, WithThreadIdentityEnsurer(func(threadID string) error {
		return fmt.Errorf("ensure %s: %w", threadID, errors.New("deliberate failure"))
	}))
	if err == nil || !strings.Contains(err.Error(), "deliberate failure") {
		t.Fatalf("Open ensure failure err = %v", err)
	}
	assertCanonicalDatabaseUnchanged(t, dbPath, canonicalMinimumVersion)
}

func seedCanonicalThreadstoreVersion(t *testing.T, dbPath string, version int) {
	t.Helper()
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	if _, err := raw.Exec(canonicalV15SchemaSQL); err != nil {
		t.Fatal(err)
	}
	for current := canonicalMinimumVersion; current < version; current++ {
		migration := canonicalMigrationFrom(current)
		if migration == nil {
			t.Fatalf("missing fixture migration from v%d", current)
		}
		tx, err := raw.Begin()
		if err != nil {
			t.Fatal(err)
		}
		if err := migration.apply(tx); err != nil {
			_ = tx.Rollback()
			t.Fatalf("seed canonical v%d: %v", migration.to, err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := raw.Exec(fmt.Sprintf(`
CREATE TABLE __redeven_db_meta (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  db_kind TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_migrated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_migrated_from_version INTEGER NOT NULL DEFAULT 0,
  last_migrated_to_version INTEGER NOT NULL DEFAULT 0
);
INSERT INTO __redeven_db_meta(singleton, db_kind, last_migrated_from_version, last_migrated_to_version)
VALUES(1, '%s', %d, %d);
PRAGMA user_version=%d;
INSERT INTO ai_threads(thread_id, endpoint_id, title, created_at_unix_ms, updated_at_unix_ms)
VALUES('thread_product', 'env_1', 'Keep this thread', 100, 200);
INSERT INTO ai_queued_turns(queue_id, endpoint_id, thread_id, message_id, text_content, created_at_unix_ms)
VALUES('queue_1', 'env_1', 'thread_product', 'message_1', 'pending prompt', 300);
`, threadstoreLegacySchemaKind, version, version, version)); err != nil {
		t.Fatal(err)
	}
}

func assertCanonicalDatabaseUnchanged(t *testing.T, dbPath string, version int) {
	t.Helper()
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var actualVersion int
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&actualVersion); err != nil {
		t.Fatal(err)
	}
	if actualVersion != version {
		t.Fatalf("user_version = %d, want %d", actualVersion, version)
	}
	var shadowTables int
	if err := raw.QueryRow(`SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'ai_messages'`).Scan(&shadowTables); err != nil {
		t.Fatal(err)
	}
	if shadowTables != 1 {
		t.Fatalf("ai_messages table count = %d, want 1", shadowTables)
	}
}
