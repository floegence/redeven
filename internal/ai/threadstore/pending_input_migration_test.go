package threadstore

import (
	"database/sql"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestPendingInputMigrationPreservesStableRequestOrder(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	createReviewedV1DatabaseForTest(t, path)
	store, err := Open(path)
	if err != nil {
		t.Fatalf("open and migrate v1 threadstore: %v", err)
	}
	defer store.Close()
	records, err := store.ListPendingInputImports(t.Context(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 2 || records[0].RequestID != "request_queue_1" || records[1].RequestID != "request_queue_2" || records[0].TextContent != "first" || records[1].TextContent != "second" {
		t.Fatalf("migrated pending input order=%#v", records)
	}
}

func createReviewedV1DatabaseForTest(t *testing.T, path string) {
	t.Helper()
	snapshot, err := reviewedProductSchemaContract(1)
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	for _, objectType := range []string{"table", "trigger"} {
		for _, object := range snapshot.Objects {
			if object.Type != objectType || strings.TrimSpace(object.SQL) == "" || strings.HasPrefix(object.Name, "sqlite_") {
				continue
			}
			if _, err := tx.Exec(object.SQL); err != nil {
				t.Fatalf("create v1 %s %s: %v", object.Type, object.Name, err)
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
			t.Fatalf("create v1 index %s: %v", object.Name, err)
		}
	}
	if _, err := tx.Exec(`INSERT INTO __redeven_db_meta(singleton, db_kind, created_at_unix_ms, last_migrated_at_unix_ms, last_migrated_from_version, last_migrated_to_version) VALUES(1, 'ai_threadstore_product_v1', 1, 0, 0, 0)`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`PRAGMA user_version = 1`); err != nil {
		t.Fatal(err)
	}
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
