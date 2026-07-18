package threadstore

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func createProductV2DatabaseForTest(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
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
VALUES(1, 'ai_threadstore_product_v2', 2, 2);
`); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := createThreadstoreSchemaV2(tx); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if _, err := tx.Exec(`PRAGMA user_version=2`); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestThreadstoreSchemaV3ContainsOnlyHostThreadSettings(t *testing.T) {
	store := openStoreForTest(t)
	for _, table := range []string{"ai_threads"} {
		if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = ?`, table) != 0 {
			t.Fatalf("legacy table %s exists", table)
		}
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'ai_thread_settings'`) != 1 {
		t.Fatal("ai_thread_settings is missing")
	}
	for _, column := range []string{"title", "title_source", "title_generated_at_unix_ms", "title_input_message_id", "title_model_id", "title_prompt_version"} {
		if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM pragma_table_info('ai_thread_settings') WHERE name = ?`, column) != 0 {
			t.Fatalf("canonical title column %s exists in host settings", column)
		}
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM pragma_table_info('ai_child_permission_snapshots') WHERE name = 'subagent_id'`) != 0 {
		t.Fatal("subagent_id compatibility column exists")
	}
}

func TestThreadstoreMigratesV2TitlesAndOwnershipBeforeSchemaCommit(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV2DatabaseForTest(t, path)
	if _, err := raw.Exec(`
INSERT INTO ai_threads(thread_id, endpoint_id, title, title_source, followups_revision, created_at_unix_ms, updated_at_unix_ms)
VALUES('thread_product', 'env_product', 'Canonical title', 'user', 7, 100, 120);
INSERT INTO ai_uploads(upload_id, endpoint_id, storage_relpath, created_at_unix_ms) VALUES('upload_1', 'env_product', 'upload_1.data', 90);
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
VALUES
  ('env_product', 'upload_1', 'thread_product', 'turn', 'turn_1', 100),
  ('env_product', 'upload_1', 'thread_product', 'turn', 'turn_2', 110);
INSERT INTO ai_permission_snapshots(snapshot_id, endpoint_id, owner_thread_id, snapshot_json)
VALUES('v1', 'env_product', 'thread_product', '{"version":1}'), ('v2', 'env_product', 'thread_product', '{"version":2}');
`); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	var migrated []LegacyThreadTitle
	store, err := Open(path, WithLegacyThreadTitleMigrator(func(_ context.Context, title LegacyThreadTitle) error {
		migrated = append(migrated, title)
		return nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if len(migrated) != 1 || migrated[0].ThreadID != "thread_product" || migrated[0].Title != "Canonical title" {
		t.Fatalf("migrated titles=%#v", migrated)
	}
	settings, err := store.GetThread(context.Background(), "env_product", "thread_product")
	if err != nil || settings == nil || settings.QueueRevision != 7 {
		t.Fatalf("settings=%#v err=%v", settings, err)
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE upload_id = 'upload_1' AND ref_kind = 'thread' AND ref_id = 'thread_product'`) != 1 {
		t.Fatal("admitted upload ownership was not deduplicated to the thread")
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_permission_snapshots WHERE snapshot_id = 'v1'`) != 0 || countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_permission_snapshots WHERE snapshot_id = 'v2'`) != 1 {
		t.Fatal("permission snapshot version filtering is incorrect")
	}
}

func TestThreadstoreV2TitleMigrationFailureLeavesSchemaAtV2(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV2DatabaseForTest(t, path)
	if _, err := raw.Exec(`INSERT INTO ai_threads(thread_id, endpoint_id, title, created_at_unix_ms, updated_at_unix_ms) VALUES('thread_1', 'env_1', 'Title', 1, 1)`); err != nil {
		t.Fatal(err)
	}
	_ = raw.Close()
	want := errors.New("canonical title conflict")
	if _, err := Open(path, WithLegacyThreadTitleMigrator(func(context.Context, LegacyThreadTitle) error { return want })); !errors.Is(err, want) {
		t.Fatalf("Open error=%v", err)
	}
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var version int
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 2 || countRowsForTest(t, raw, `SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'ai_threads'`) != 1 {
		t.Fatalf("failed migration changed schema version=%d", version)
	}
}

func TestThreadstoreRejectsUnsupportedLegacyKindWithoutMutation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
CREATE TABLE __redeven_db_meta(singleton INTEGER PRIMARY KEY, db_kind TEXT NOT NULL, created_at_unix_ms INTEGER NOT NULL DEFAULT 0, last_migrated_at_unix_ms INTEGER NOT NULL DEFAULT 0, last_migrated_from_version INTEGER NOT NULL, last_migrated_to_version INTEGER NOT NULL);
INSERT INTO __redeven_db_meta VALUES(1, 'ai_threadstore_canonical', 0, 0, 40, 40);
CREATE TABLE sentinel(value TEXT);
PRAGMA user_version=40;
`); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()
	_, err = Open(path)
	if err == nil || !strings.Contains(err.Error(), "only") || !strings.Contains(err.Error(), "v2 and v3") {
		t.Fatalf("Open error=%v", err)
	}
	db, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if countRowsForTest(t, db, `SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'sentinel'`) != 1 {
		t.Fatal("unsupported database was modified")
	}
}
