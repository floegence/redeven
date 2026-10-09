package tessiven

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func createV1Library(t *testing.T) (string, SaveRequest, SaveResult) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "canvases.sqlite")
	ddl, err := os.ReadFile("testdata/schema_v1.sql")
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(string(ddl)); err != nil {
		t.Fatal(err)
	}
	request := SaveRequest{RequestID: "historical-save", CanvasID: "canvas-user", ExpectedVersion: 1, DocumentYAML: exampleDocument, Summary: "User revision"}
	result := SaveResult{
		Canvas:  Canvas{ID: "canvas-user", Title: "User canvas", Description: "Preserved description", LatestVersion: 2, CreatedAt: 100, UpdatedAt: 200},
		Version: Version{CanvasID: "canvas-user", Number: 2, DocumentYAML: exampleDocument, Digest: digest(exampleDocument), CreatedAt: 200, Source: "flower", Summary: request.Summary},
	}
	if _, err := db.Exec(`INSERT INTO canvases VALUES(?,?,?,?,?,?,?), ('canvas-archived','Archived canvas','Archived description',1,1,50,75)`, result.Canvas.ID, result.Canvas.Title, result.Canvas.Description, 2, 0, 100, 200); err != nil {
		t.Fatal(err)
	}
	for _, version := range []Version{
		{CanvasID: "canvas-user", Number: 1, DocumentYAML: exampleDocument, Digest: digest(exampleDocument), CreatedAt: 100, Source: "manual", Summary: "Initial user version"},
		result.Version,
		{CanvasID: "canvas-archived", Number: 1, DocumentYAML: exampleDocument, Digest: digest(exampleDocument), CreatedAt: 50, Source: "import", Summary: "Archived version"},
	} {
		if _, err := db.Exec(`INSERT INTO versions VALUES(?,?,?,?,?,?,?)`, version.CanvasID, version.Number, version.DocumentYAML, version.Digest, version.CreatedAt, version.Source, version.Summary); err != nil {
			t.Fatal(err)
		}
	}
	input, err := json.Marshal(struct {
		SaveRequest
		Source string
	}{request, "flower"})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO requests VALUES(?,?,?)`, request.RequestID, digest(string(input)), string(encoded)); err != nil {
		t.Fatal(err)
	}
	return path, request, result
}

func TestV1LibraryMigratesBeforeOpeningAndPreservesRecords(t *testing.T) {
	path, request, original := createV1Library(t)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	inspection, err := sqliteutil.Inspect(path, schemaSpec())
	if err != nil {
		t.Fatalf("inspect supported v1 library: %v", err)
	}
	if inspection.Version != 1 || !inspection.MigrationRequired {
		t.Fatalf("inspection = %+v, want a pending v1 migration", inspection)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("read-only inspection changed the database: %v", err)
	}
	s, err := Open(path)
	if err != nil {
		t.Fatalf("open supported v1 library: %v", err)
	}
	defer func() { _ = s.Close() }()
	var version, from, to int
	var kind string
	if err := s.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow(`SELECT db_kind,last_migrated_from_version,last_migrated_to_version FROM __redeven_db_meta`).Scan(&kind, &from, &to); err != nil {
		t.Fatal(err)
	}
	if version != 2 || kind != schemaKind || from != 1 || to != 2 {
		t.Fatalf("migration metadata: version=%d kind=%q edge=%d->%d", version, kind, from, to)
	}
	canvas, err := s.Canvas(t.Context(), original.Canvas.ID)
	if err != nil || canvas != original.Canvas {
		t.Fatalf("user canvas changed: %+v, %v", canvas, err)
	}
	archived, err := s.Canvas(t.Context(), "canvas-archived")
	if err != nil || !archived.Archived || archived.CreatedAt != 50 || archived.UpdatedAt != 75 || archived.FlowerThreadID != "" {
		t.Fatalf("archived canvas changed: %+v, %v", archived, err)
	}
	for number := int64(1); number <= 2; number++ {
		v, err := s.Version(t.Context(), original.Canvas.ID, number)
		if err != nil || v.DocumentYAML != exampleDocument || v.Digest != digest(exampleDocument) || v.CreatedAt != number*100 {
			t.Fatalf("version %d changed: %+v, %v", number, v, err)
		}
	}
	retry, err := s.Save(t.Context(), request, "flower")
	if err != nil || !reflect.DeepEqual(retry, original) {
		t.Fatalf("historical idempotent result changed: %+v, %v", retry, err)
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM canvases`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("migration created or removed canvases: count=%d, %v", count, err)
	}
	if err := s.BindFlowerThread(t.Context(), original.Canvas.ID, "thread-after-upgrade"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE versions SET summary='overwrite'`); err == nil {
		t.Fatal("migration removed version immutability")
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatalf("restart migrated library: %v", err)
	}
	canvas, err = s.Canvas(t.Context(), original.Canvas.ID)
	if err != nil || canvas.FlowerThreadID != "thread-after-upgrade" {
		t.Fatalf("binding did not survive restart: %+v, %v", canvas, err)
	}
}

func TestV1LibraryRejectsUnsupportedShapesReadOnly(t *testing.T) {
	for _, tc := range []struct{ name, statement string }{
		{"extra column", `ALTER TABLE canvases ADD COLUMN unexpected TEXT`},
		{"premature v2 column", `ALTER TABLE canvases ADD COLUMN flower_thread_id TEXT NOT NULL DEFAULT ''`},
		{"missing immutability trigger", `DROP TRIGGER versions_immutable_update`},
		{"extra table", `CREATE TABLE unexpected(value TEXT)`},
		{"extra index", `CREATE INDEX unexpected ON canvases(title)`},
		{"wrong kind", `UPDATE __redeven_db_meta SET db_kind='other'`},
		{"metadata drift", `ALTER TABLE __redeven_db_meta ADD COLUMN unexpected TEXT`},
		{"mislabeled v2", `PRAGMA user_version=2`},
		{"future version", `PRAGMA user_version=3`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path, _, _ := createV1Library(t)
			db, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(tc.statement); err != nil {
				t.Fatal(err)
			}
			if err := db.Close(); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if s, err := Open(path); err == nil {
				s.Close()
				t.Fatal("unsupported historical database accepted")
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatalf("rejected database changed: %v", err)
			}
		})
	}
}

func TestV1LibraryMigrationRollsBackOnFailure(t *testing.T) {
	for _, stage := range []string{"migration", "verification"} {
		t.Run(stage, func(t *testing.T) {
			path, _, original := createV1Library(t)
			spec := schemaSpec()
			failure := errors.New("injected migration failure")
			if stage == "migration" {
				spec.Migrations[0].Apply = func(tx *sql.Tx) error {
					if err := migrateToV2(tx); err != nil {
						return err
					}
					return failure
				}
			} else {
				spec.Verify = func(tx *sql.Tx) error {
					if err := verifySchema(tx); err != nil {
						return err
					}
					return failure
				}
			}
			if db, err := sqliteutil.Open(path, spec); !errors.Is(err, failure) {
				if db != nil {
					db.Close()
				}
				t.Fatalf("migration error = %v, want injected failure", err)
			}
			inspection, err := sqliteutil.Inspect(path, schemaSpec())
			if err != nil || inspection.Version != 1 || !inspection.MigrationRequired {
				t.Fatalf("rollback did not retain the supported v1 shape: %+v, %v", inspection, err)
			}
			db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
			if err != nil {
				t.Fatal(err)
			}
			var from, to int
			if err := db.QueryRow(`SELECT last_migrated_from_version,last_migrated_to_version FROM __redeven_db_meta`).Scan(&from, &to); err != nil {
				t.Fatal(err)
			}
			db.Close()
			if from != 0 || to != 1 {
				t.Fatalf("failed migration changed metadata: %d -> %d", from, to)
			}
			s, err := Open(path)
			if err != nil {
				t.Fatalf("retry migration after rollback: %v", err)
			}
			defer s.Close()
			canvas, err := s.Canvas(t.Context(), original.Canvas.ID)
			if err != nil || canvas != original.Canvas {
				t.Fatalf("rollback changed user data: %+v, %v", canvas, err)
			}
		})
	}
}
