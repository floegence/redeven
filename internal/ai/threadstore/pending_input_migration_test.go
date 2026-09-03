package threadstore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestPendingInputMigrationPreservesStableRequestOrder(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	createReviewedV1DatabaseForTest(t, path)
	var migrated []PendingInputMigrationRecord
	store, err := OpenWithPendingInputMigration(t.Context(), path, func(_ context.Context, _ PendingInputMigrationSource, records []PendingInputMigrationRecord) ([]ExecutionAuthority, error) {
		migrated = append(migrated, records...)
		authorities := make([]ExecutionAuthority, 0, len(records))
		for _, record := range records {
			authorities = append(authorities, ExecutionAuthority{
				RequestKey: record.RequestID, ThreadID: record.ThreadID, EndpointID: record.EndpointID,
				NamespacePublicID: "ns_queue_migration", ChannelID: "ch_queue_migration", UserPublicID: "user_queue_migration",
			})
		}
		return authorities, nil
	})
	if err != nil {
		t.Fatalf("open and migrate v1 threadstore: %v", err)
	}
	defer store.Close()
	if len(migrated) != 2 || migrated[0].RequestID != "request_queue_1" || migrated[1].RequestID != "request_queue_2" || migrated[0].TextContent != "first" || migrated[1].TextContent != "second" {
		t.Fatalf("migrated pending input order=%#v", migrated)
	}
	assertCurrentSchemaHasNoRetiredPendingStorage(t, store.db)
}

func TestPendingInputMigrationFailureRollsBackWithoutStaging(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	createReviewedV1DatabaseForTest(t, path)
	wantErr := errors.New("canonical import unavailable")
	store, err := OpenWithPendingInputMigration(t.Context(), path, func(context.Context, PendingInputMigrationSource, []PendingInputMigrationRecord) ([]ExecutionAuthority, error) {
		return nil, wantErr
	})
	if store != nil {
		_ = store.Close()
		t.Fatal("failed migration returned a store")
	}
	if !errors.Is(err, wantErr) {
		t.Fatalf("migration error=%v, want %v", err, wantErr)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var version int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 1 {
		t.Fatalf("version after rollback=%d, want 1", version)
	}
	var sourceRows, stagingTables int
	if err := db.QueryRow(`SELECT COUNT(*) FROM ai_queued_turns`).Scan(&sourceRows); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='ai_pending_input_imports'`).Scan(&stagingTables); err != nil {
		t.Fatal(err)
	}
	if sourceRows != 2 || stagingTables != 0 {
		t.Fatalf("rollback source rows=%d staging tables=%d, want 2 and 0", sourceRows, stagingTables)
	}
}

func TestThreadstoreV4ToV6PreservesUploadRefsAndReopensCleanly(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	createReviewedVersionDatabaseForTest(t, path, 4)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO ai_upload_refs(id, endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms) VALUES(41, 'env_ref_migration', 'upload_ref_migration', 'thread_ref_migration', 'thread', 'message_ref_migration', 1234)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO ai_pending_input_imports(request_id, endpoint_id, thread_id, model_id, text_content, attachments_json, context_action_json, options_json, session_meta_json, created_at_unix_ms, imported_at_unix_ms) VALUES('request_already_imported', 'env_old', 'thread_old', 'openai/gpt-5-mini', 'already canonical', '[]', '', '{}', '{}', 1, 2)`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(path)
	if err != nil {
		t.Fatalf("migrate v4 threadstore: %v", err)
	}
	assertMigratedUploadRefForTest(t, store.db)
	assertCurrentSchemaHasNoRetiredPendingStorage(t, store.db)
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatalf("reopen current threadstore: %v", err)
	}
	defer reopened.Close()
	assertMigratedUploadRefForTest(t, reopened.db)
	assertCurrentSchemaHasNoRetiredPendingStorage(t, reopened.db)
}

func TestPendingInputMigrationAuthorityConflictRollsBackRetiredSource(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	createReviewedVersionDatabaseForTest(t, path, 4)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO ai_pending_input_imports(request_id, endpoint_id, thread_id, model_id, text_content, attachments_json, context_action_json, options_json, session_meta_json, created_at_unix_ms) VALUES('request_conflict', 'env_source', 'thread_source', 'openai/gpt-5-mini', 'source input', '[]', '', '{}', '{}', 10)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO ai_flower_execution_authority(request_key, thread_id, turn_id, endpoint_id, namespace_public_id, channel_id, user_public_id, user_email, created_at_unix_ms) VALUES('request_conflict', 'thread_other', '', 'env_other', 'ns', 'ch', 'user', '', 1)`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := OpenWithPendingInputMigration(t.Context(), path, func(_ context.Context, _ PendingInputMigrationSource, records []PendingInputMigrationRecord) ([]ExecutionAuthority, error) {
		if len(records) != 1 || records[0].RequestID != "request_conflict" {
			t.Fatalf("migration records=%#v", records)
		}
		return []ExecutionAuthority{{
			RequestKey: "request_conflict", ThreadID: "thread_source", EndpointID: "env_source",
			NamespacePublicID: "ns", ChannelID: "ch", UserPublicID: "user",
		}}, nil
	})
	if store != nil {
		_ = store.Close()
		t.Fatal("conflicting migration returned a store")
	}
	if !errors.Is(err, ErrExecutionAuthorityConflict) {
		t.Fatalf("migration error=%v, want %v", err, ErrExecutionAuthorityConflict)
	}
	db, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var version, sourceRows int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM ai_pending_input_imports WHERE request_id = 'request_conflict'`).Scan(&sourceRows); err != nil {
		t.Fatal(err)
	}
	if version != 4 || sourceRows != 1 {
		t.Fatalf("rolled back version=%d source rows=%d, want 4 and 1", version, sourceRows)
	}
}

func assertMigratedUploadRefForTest(t *testing.T, db *sql.DB) {
	t.Helper()
	var endpointID, uploadID, targetID, refKind, refID string
	if err := db.QueryRow(`SELECT endpoint_id, upload_id, target_id, ref_kind, ref_id FROM ai_upload_refs`).Scan(
		&endpointID, &uploadID, &targetID, &refKind, &refID,
	); err != nil {
		t.Fatal(err)
	}
	if endpointID != "env_ref_migration" || uploadID != "upload_ref_migration" || targetID != "thread_ref_migration" || refKind != "thread" || refID != "message_ref_migration" {
		t.Fatalf("migrated upload ref=(%q, %q, %q, %q, %q)", endpointID, uploadID, targetID, refKind, refID)
	}
}

func assertCurrentSchemaHasNoRetiredPendingStorage(t *testing.T, db *sql.DB) {
	t.Helper()
	for _, name := range []string{"ai_pending_input_imports", "sqlite_sequence"} {
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, name).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("retired table %s remains", name)
		}
	}
	rows, err := db.Query(`PRAGMA table_xinfo(ai_upload_refs)`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notNull, primaryKey, hidden int
		var name, columnType string
		var defaultValue sql.NullString
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey, &hidden); err != nil {
			t.Fatal(err)
		}
		if name == "id" {
			t.Fatal("retired ai_upload_refs.id remains")
		}
	}
}

func createReviewedV1DatabaseForTest(t *testing.T, path string) {
	t.Helper()
	createReviewedVersionDatabaseForTest(t, path, 1)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`INSERT INTO ai_thread_settings(thread_id, endpoint_id, namespace_public_id, model_id, permission_type, queue_revision, settings_created_at_unix_ms, settings_updated_at_unix_ms) VALUES('thread_queue_migration', 'env_queue_migration', 'ns_queue_migration', 'openai/gpt-5-mini', 'approval_required', 2, 1, 1)`); err != nil {
		t.Fatal(err)
	}
	metaJSON := `{"channel_id":"ch_queue_migration","endpoint_id":"env_queue_migration","namespace_public_id":"ns_queue_migration","user_public_id":"user_queue_migration","can_read":true,"can_write":true,"can_execute":true}`
	for _, input := range []struct {
		requestID string
		text      string
		createdAt int64
	}{
		{requestID: "request_queue_1", text: "first", createdAt: 10},
		{requestID: "request_queue_2", text: "second", createdAt: 20},
	} {
		if _, err := tx.Exec(`INSERT INTO ai_queued_turns(queue_id, endpoint_id, thread_id, channel_id, lane, sort_index, model_id, text_content, attachments_json, context_action_json, options_json, session_meta_json, created_at_unix_ms, updated_at_unix_ms) VALUES(?, 'env_queue_migration', 'thread_queue_migration', 'ch_queue_migration', 'queued', ?, 'openai/gpt-5-mini', ?, '[]', '', '{}', ?, ?, ?)`, input.requestID, input.createdAt, input.text, metaJSON, input.createdAt, input.createdAt); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func createReviewedVersionDatabaseForTest(t *testing.T, path string, version int) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	createReviewedVersionOnConnectionForTest(t, db, version)
}

func createReviewedVersionOnConnectionForTest(t *testing.T, db *sql.DB, version int) {
	t.Helper()
	snapshot, err := reviewedProductSchemaContract(version)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	for _, objectType := range []string{"table", "trigger"} {
		for _, object := range snapshot.Objects {
			if object.Type != objectType || strings.TrimSpace(object.SQL) == "" || strings.HasPrefix(object.Name, "sqlite_") {
				continue
			}
			if _, err := tx.Exec(object.SQL); err != nil {
				t.Fatalf("create reviewed v%d %s %s: %v", version, object.Type, object.Name, err)
			}
		}
	}
	indexSequence := make(map[string]int)
	for _, table := range snapshot.Tables {
		for _, index := range table.Indexes {
			indexSequence[index.Name] = index.Sequence
		}
	}
	indexes := append([]reviewedSchemaObject(nil), snapshot.Objects...)
	sort.SliceStable(indexes, func(left, right int) bool {
		if indexes[left].TableName != indexes[right].TableName {
			return indexes[left].TableName < indexes[right].TableName
		}
		return indexSequence[indexes[left].Name] > indexSequence[indexes[right].Name]
	})
	for _, object := range indexes {
		if object.Type != "index" || strings.TrimSpace(object.SQL) == "" || strings.HasPrefix(object.Name, "sqlite_") {
			continue
		}
		if _, err := tx.Exec(object.SQL); err != nil {
			t.Fatalf("create reviewed v%d index %s: %v", version, object.Name, err)
		}
	}
	if _, err := tx.Exec(`INSERT INTO __redeven_db_meta(singleton, db_kind, created_at_unix_ms, last_migrated_at_unix_ms, last_migrated_from_version, last_migrated_to_version) VALUES(1, 'ai_threadstore_product_v1', 1, 0, 0, 0)`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, version)); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}
