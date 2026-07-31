package threadstore

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestReviewedSchemaManifestMatchesFreshDatabase(t *testing.T) {
	manifest := buildReviewedSchemaManifestForTest(t)
	if os.Getenv("UPDATE_REVIEWED_THREADSTORE_SCHEMA") == "1" {
		body, err := json.MarshalIndent(manifest, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		body = append(body, '\n')
		if err := os.WriteFile("reviewed_schema_manifest.json", body, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	var reviewed reviewedSchemaManifest
	if err := json.Unmarshal(reviewedSchemaManifestJSON, &reviewed); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(manifest, reviewed) {
		t.Fatal("reviewed threadstore schema manifest is stale; inspect the schema change and regenerate with UPDATE_REVIEWED_THREADSTORE_SCHEMA=1")
	}
}

func TestReviewedSchemaComparisonRejectsEveryMetadataPlane(t *testing.T) {
	expected, err := reviewedProductSchemaContract(threadstoreCurrentSchemaVersion)
	if err != nil {
		t.Fatal(err)
	}
	clone := func() reviewedSchemaSnapshot {
		body, err := json.Marshal(expected)
		if err != nil {
			t.Fatal(err)
		}
		var copied reviewedSchemaSnapshot
		if err := json.Unmarshal(body, &copied); err != nil {
			t.Fatal(err)
		}
		return copied
	}
	tests := map[string]func(*reviewedSchemaSnapshot){
		"version": func(actual *reviewedSchemaSnapshot) { actual.Version++ },
		"object": func(actual *reviewedSchemaSnapshot) {
			actual.Objects = append(actual.Objects, reviewedSchemaObject{Type: "trigger", Name: "trg_shadow", TableName: "ai_thread_settings", SQL: "CREATE TRIGGER trg_shadow AFTER UPDATE ON ai_thread_settings BEGIN SELECT 1; END"})
		},
		"column": func(actual *reviewedSchemaSnapshot) {
			actual.Tables[0].Columns = append(actual.Tables[0].Columns, reviewedSchemaColumn{CID: 999, Name: "shadow", Type: "TEXT"})
		},
		"nullability": func(actual *reviewedSchemaSnapshot) { actual.Tables[0].Columns[0].NotNull ^= 1 },
		"default": func(actual *reviewedSchemaSnapshot) { actual.Tables[0].Columns[0].DefaultValue += "changed" },
		"hidden": func(actual *reviewedSchemaSnapshot) { actual.Tables[0].Columns[0].Hidden++ },
		"index list": func(actual *reviewedSchemaSnapshot) {
			actual.Tables[0].Indexes = append(actual.Tables[0].Indexes, reviewedTableIndexEntry{Name: "idx_shadow", Unique: 1, Origin: "c", Partial: 1})
		},
		"index xinfo": func(actual *reviewedSchemaSnapshot) { actual.Indexes[0].Columns[0].Desc ^= 1 },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			actual := clone()
			if len(actual.Tables) == 0 || len(actual.Tables[0].Columns) == 0 || len(actual.Indexes) == 0 || len(actual.Indexes[0].Columns) == 0 {
				t.Fatal("reviewed schema lacks metadata required by drift fixture")
			}
			mutate(&actual)
			if err := compareReviewedSchemas(actual, expected); err == nil {
				t.Fatalf("%s drift satisfied the reviewed manifest", name)
			}
		})
	}
}

func TestReviewedSchemaSQLNormalizationPreservesQuotedWhitespace(t *testing.T) {
	first := normalizeReviewedSchemaSQL("CREATE  TABLE sample (value TEXT DEFAULT 'a  b', note TEXT)")
	second := normalizeReviewedSchemaSQL("CREATE\nTABLE sample (value TEXT DEFAULT 'a  b', note TEXT)")
	if first != second {
		t.Fatalf("format-only SQL differs: %q != %q", first, second)
	}
	if first == normalizeReviewedSchemaSQL("CREATE TABLE sample (value TEXT DEFAULT 'a b', note TEXT)") {
		t.Fatal("quoted literal whitespace was normalized away")
	}
}

func buildReviewedSchemaManifestForTest(t *testing.T) reviewedSchemaManifest {
	t.Helper()
	path := filepath.Join(t.TempDir(), "v1.sqlite")
	db := createReviewedSchemaDatabaseForTest(t, path)
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := inspectReviewedSchemaTx(tx)
	_ = tx.Rollback()
	_ = db.Close()
	if err != nil {
		t.Fatalf("inspect schema v1: %v", err)
	}
	return reviewedSchemaManifest{SchemaKind: threadstoreSchemaKind, Versions: []reviewedSchemaSnapshot{snapshot}}
}

func createReviewedSchemaDatabaseForTest(t *testing.T, path string) *sql.DB {
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
INSERT INTO __redeven_db_meta(
  singleton, db_kind, created_at_unix_ms, last_migrated_at_unix_ms,
  last_migrated_from_version, last_migrated_to_version
) VALUES(1, 'ai_threadstore_product_v1', 0, 0, 0, 0);
`); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := createThreadstoreSchema(tx); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if _, err := tx.Exec("PRAGMA user_version = 1"); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return db
}
