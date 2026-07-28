package threadstore

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"
)

func TestReviewedSchemaManifestMatchesFreshAndHistoricalDatabases(t *testing.T) {
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

func TestEverySupportedHistoricalSchemaMigratesToReviewedCurrentSchema(t *testing.T) {
	expected, err := reviewedProductSchemaContract(threadstoreCurrentSchemaVersion)
	if err != nil {
		t.Fatal(err)
	}
	for version := 2; version < threadstoreCurrentSchemaVersion; version++ {
		version := version
		t.Run(schemaVersionNameForTest(version), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "threads.sqlite")
			db := createReviewedSchemaDatabaseForTest(t, path, version)
			if err := db.Close(); err != nil {
				t.Fatal(err)
			}
			store, err := Open(path)
			if err != nil {
				t.Fatalf("migrate reviewed v%d database: %v", version, err)
			}
			defer store.Close()
			tx, err := store.db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			actual, err := inspectReviewedSchemaTx(tx)
			_ = tx.Rollback()
			if err != nil {
				t.Fatal(err)
			}
			if err := compareReviewedSchemas(actual, expected); err != nil {
				t.Fatalf("migrated v%d schema differs from reviewed current schema: %v", version, err)
			}
		})
	}
}

func TestReviewedSchemaComparisonRejectsConstraintAndIndexDrift(t *testing.T) {
	expected, err := reviewedProductSchemaContract(threadstoreCurrentSchemaVersion)
	if err != nil {
		t.Fatal(err)
	}
	constraintDrift := expected
	constraintDrift.Objects = append([]reviewedSchemaObject(nil), expected.Objects...)
	for index := range constraintDrift.Objects {
		if constraintDrift.Objects[index].Name == "ai_thread_delete_operations" {
			constraintDrift.Objects[index].SQL += " -- removed CHECK would change sqlite_master.sql"
			break
		}
	}
	if err := compareReviewedSchemas(constraintDrift, expected); err == nil {
		t.Fatal("sqlite_master constraint drift satisfied the reviewed manifest")
	}
	indexDrift := expected
	indexDrift.Indexes = append([]reviewedSchemaIndex(nil), expected.Indexes...)
	if len(indexDrift.Indexes) == 0 || len(indexDrift.Indexes[0].Columns) == 0 {
		t.Fatal("reviewed current schema has no index_xinfo rows")
	}
	indexDrift.Indexes[0].Columns = append([]reviewedSchemaIndexColumn(nil), indexDrift.Indexes[0].Columns...)
	indexDrift.Indexes[0].Columns[0].Desc ^= 1
	if err := compareReviewedSchemas(indexDrift, expected); err == nil {
		t.Fatal("index_xinfo drift satisfied the reviewed manifest")
	}
}

func TestReviewedSchemaComparisonRejectsEveryReviewedMetadataPlane(t *testing.T) {
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
		"shadow column": func(actual *reviewedSchemaSnapshot) {
			actual.Tables[0].Columns = append(actual.Tables[0].Columns, reviewedSchemaColumn{CID: 999, Name: "assistant_output", Type: "TEXT"})
		},
		"nullability": func(actual *reviewedSchemaSnapshot) {
			actual.Tables[0].Columns[0].NotNull ^= 1
		},
		"default": func(actual *reviewedSchemaSnapshot) {
			actual.Tables[0].Columns[0].DefaultValue += "changed"
		},
		"hidden": func(actual *reviewedSchemaSnapshot) {
			actual.Tables[0].Columns[0].Hidden++
		},
		"index list": func(actual *reviewedSchemaSnapshot) {
			actual.Tables[0].Indexes = append(actual.Tables[0].Indexes, reviewedTableIndexEntry{Name: "idx_shadow", Unique: 1, Origin: "c", Partial: 1})
		},
		"trigger": func(actual *reviewedSchemaSnapshot) {
			actual.Objects = append(actual.Objects, reviewedSchemaObject{Type: "trigger", Name: "trg_shadow", TableName: "ai_thread_settings", SQL: "CREATE TRIGGER trg_shadow AFTER UPDATE ON ai_thread_settings BEGIN SELECT 1; END"})
		},
		"index collation": func(actual *reviewedSchemaSnapshot) {
			actual.Indexes[0].Columns[0].Coll = "NOCASE"
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			actual := clone()
			if len(actual.Tables) == 0 || len(actual.Tables[0].Columns) == 0 || len(actual.Indexes) == 0 || len(actual.Indexes[0].Columns) == 0 {
				t.Fatal("reviewed schema lacks metadata required by the drift fixture")
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
	changed := normalizeReviewedSchemaSQL("CREATE TABLE sample (value TEXT DEFAULT 'a b', note TEXT)")
	if first == changed {
		t.Fatal("quoted literal whitespace was normalized away")
	}
}

func buildReviewedSchemaManifestForTest(t *testing.T) reviewedSchemaManifest {
	t.Helper()
	manifest := reviewedSchemaManifest{SchemaKind: threadstoreSchemaKind}
	for version := 2; version <= threadstoreCurrentSchemaVersion; version++ {
		path := filepath.Join(t.TempDir(), schemaVersionNameForTest(version)+".sqlite")
		db := createReviewedSchemaDatabaseForTest(t, path, version)
		tx, err := db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		snapshot, err := inspectReviewedSchemaTx(tx)
		_ = tx.Rollback()
		_ = db.Close()
		if err != nil {
			t.Fatalf("inspect schema v%d: %v", version, err)
		}
		manifest.Versions = append(manifest.Versions, snapshot)
	}
	return manifest
}

func createReviewedSchemaDatabaseForTest(t *testing.T, path string, version int) *sql.DB {
	t.Helper()
	builders := map[int]func(*sql.Tx) error{
		2: createThreadstoreSchemaV2,
		3: createThreadstoreSchemaV3,
		4: createThreadstoreSchemaV4,
		5: createThreadstoreSchemaV5,
		6: createThreadstoreSchemaV6,
		7: createThreadstoreSchemaV7,
		8: createThreadstoreSchema,
	}
	build := builders[version]
	if build == nil {
		t.Fatalf("missing test schema builder for v%d", version)
	}
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
) VALUES(1, 'ai_threadstore_product_v2', 0, 0, 0, 0);
`); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := build(tx); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if _, err := tx.Exec("PRAGMA user_version = " + schemaVersionNameForTest(version)); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return db
}

func schemaVersionNameForTest(version int) string {
	return strconv.Itoa(version)
}
