package threadstore

import (
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func createProductV6DatabaseForTest(t *testing.T, path string) *sql.DB {
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
INSERT INTO __redeven_db_meta(singleton, db_kind, created_at_unix_ms, last_migrated_at_unix_ms, last_migrated_from_version, last_migrated_to_version)
VALUES(1, 'ai_threadstore_product_v2', 101, 102, 6, 6);
`); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := createThreadstoreSchemaV6(tx); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if _, err := tx.Exec(`PRAGMA user_version=6`); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return db
}

func insertProductV6ComposerDraftForTest(t *testing.T, db *sql.DB, scopeID, valueJSON string) {
	t.Helper()
	if _, err := db.Exec(`
INSERT INTO ai_composer_drafts(
  endpoint_id, owner_user_hash, scope_id, revision, value_json,
  lease_id, lease_holder_id, lease_expires_at_unix_ms,
  created_at_unix_ms, updated_at_unix_ms, expires_at_unix_ms
) VALUES('env_v6', ?, ?, 17, ?, 'lease_v6', 'holder_v6', 203, 201, 202, 204)
`, strings.Repeat("a", 64), scopeID, valueJSON); err != nil {
		t.Fatal(err)
	}
}

func TestThreadstoreMigratesV6OrdinaryComposerDraftsThroughV8(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV6DatabaseForTest(t, path)
	withoutReferences := `{"text":"legacy","attachments":[],"mode":"ordinary"}`
	secondOrdinaryValue := ` {"text":"keep","attachments":[],"mode":"ordinary"} `
	insertProductV6ComposerDraftForTest(t, raw, "scope_without_references", withoutReferences)
	insertProductV6ComposerDraftForTest(t, raw, "scope_second", secondOrdinaryValue)
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	var version int
	if err := store.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 8 {
		t.Fatalf("user_version=%d, want 8", version)
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'ai_composer_drafts'`) != 0 {
		t.Fatal("v8 migration retained composer draft storage")
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM sqlite_master WHERE name = 'product_v6_ai_composer_drafts'`) != 0 {
		t.Fatal("v8 migration retained the v6 composer draft table")
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM __redeven_db_meta WHERE singleton = 1 AND created_at_unix_ms = 101 AND last_migrated_from_version = 6 AND last_migrated_to_version = 8`) != 1 {
		t.Fatal("v6 through v8 migration metadata was not committed")
	}
}

func TestThreadstoreV6ToV7RejectsInvalidDraftValuesWithoutMutation(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		value string
	}{
		{name: "malformed json", value: `{"text":`},
		{name: "non object", value: `[]`},
		{name: "unknown top level field", value: `{"text":"","attachments":[],"mode":"ordinary","custom_counter":1}`},
		{name: "preexisting references", value: `{"text":"","attachments":[],"references":[],"mode":"ordinary"}`},
		{name: "invalid references shape", value: `{"text":"","attachments":[],"references":null,"mode":"ordinary"}`},
		{name: "invalid reference", value: `{"text":"","attachments":[],"references":[{"local_id":"ref_1","kind":"file","label":"wrong","path":"/workspace/file.txt"}],"mode":"ordinary"}`},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			path := filepath.Join(t.TempDir(), "threads.sqlite")
			raw := createProductV6DatabaseForTest(t, path)
			insertProductV6ComposerDraftForTest(t, raw, "scope_invalid", test.value)
			if err := raw.Close(); err != nil {
				t.Fatal(err)
			}
			if _, err := Open(path); err == nil || !strings.Contains(err.Error(), "composer draft") {
				t.Fatalf("Open error=%v, want invalid composer draft rejection", err)
			}
			raw, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			defer raw.Close()
			var version int
			var valueJSON string
			if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
				t.Fatal(err)
			}
			if err := raw.QueryRow(`SELECT value_json FROM ai_composer_drafts WHERE scope_id = 'scope_invalid'`).Scan(&valueJSON); err != nil {
				t.Fatal(err)
			}
			if version != 6 || valueJSON != test.value {
				t.Fatalf("invalid migration mutated database: version=%d value=%q", version, valueJSON)
			}
			if countRowsForTest(t, raw, `SELECT COUNT(1) FROM sqlite_master WHERE name = 'product_v6_ai_composer_drafts'`) != 0 {
				t.Fatal("invalid migration left a rebuilt table behind")
			}
			if countRowsForTest(t, raw, `SELECT COUNT(1) FROM __redeven_db_meta WHERE singleton = 1 AND created_at_unix_ms = 101 AND last_migrated_at_unix_ms = 102 AND last_migrated_from_version = 6 AND last_migrated_to_version = 6`) != 1 {
				t.Fatal("invalid migration changed metadata")
			}
		})
	}
}

func TestThreadstoreRejectsDriftedV6WithoutMutation(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV6DatabaseForTest(t, path)
	insertProductV6ComposerDraftForTest(t, raw, "scope_drift", `{"text":"legacy","attachments":[],"mode":"ordinary"}`)
	if _, err := raw.Exec(`ALTER TABLE ai_composer_drafts ADD COLUMN unexpected_reference_state TEXT NOT NULL DEFAULT ''`); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(path); err == nil || !strings.Contains(err.Error(), "contract mismatch") {
		t.Fatalf("Open error=%v, want v6 schema drift rejection", err)
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
	if version != 6 || countRowsForTest(t, raw, `SELECT COUNT(1) FROM pragma_table_info('ai_composer_drafts') WHERE name = 'unexpected_reference_state'`) != 1 {
		t.Fatalf("drift rejection mutated v6 schema: version=%d", version)
	}
}

func TestThreadstoreV6ToV7MigrationFailureRollsBackAtomically(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV6DatabaseForTest(t, path)
	legacyValue := `{"text":"legacy","attachments":[],"mode":"ordinary"}`
	insertProductV6ComposerDraftForTest(t, raw, "scope_atomic", legacyValue)
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	injected := errors.New("injected post-migration verification failure")
	spec := threadstoreSchemaSpec()
	for index := range spec.Migrations {
		if spec.Migrations[index].FromVersion != 6 {
			continue
		}
		spec.Migrations[index].Apply = func(tx *sql.Tx) error {
			if err := migrateProductV6ToV7(tx); err != nil {
				return err
			}
			return injected
		}
	}
	if db, err := sqliteutil.Open(path, spec); !errors.Is(err, injected) {
		if db != nil {
			_ = db.Close()
		}
		t.Fatalf("Open error=%v, want injected failure", err)
	}

	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var version int
	var valueJSON string
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := raw.QueryRow(`SELECT value_json FROM ai_composer_drafts WHERE scope_id = 'scope_atomic'`).Scan(&valueJSON); err != nil {
		t.Fatal(err)
	}
	if version != 6 || valueJSON != legacyValue {
		t.Fatalf("failed migration mutated v6 data: version=%d value=%q", version, valueJSON)
	}
	if countRowsForTest(t, raw, `SELECT COUNT(1) FROM sqlite_master WHERE name = 'product_v6_ai_composer_drafts'`) != 0 {
		t.Fatal("failed migration left a rebuilt table behind")
	}
	if countRowsForTest(t, raw, `SELECT COUNT(1) FROM __redeven_db_meta WHERE singleton = 1 AND created_at_unix_ms = 101 AND last_migrated_at_unix_ms = 102 AND last_migrated_from_version = 6 AND last_migrated_to_version = 6`) != 1 {
		t.Fatal("failed migration changed metadata")
	}
}
