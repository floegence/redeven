package workbenchlayout

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"os"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func createCompositionV5Database(t *testing.T) string {
	t.Helper()
	path := createCompositionV4Database(t)
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
	if err := migrateToV5(tx); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`UPDATE workbench_layout_sticky_notes SET material = 'ruled';
UPDATE __redeven_db_meta SET last_migrated_from_version = 4, last_migrated_to_version = 5;
PRAGMA user_version = 5;`); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestStickyTitleMigrationAndEdits(t *testing.T) {
	path := createCompositionV5Database(t)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	var beforeEvents string
	query := `SELECT json_group_array(json_object('seq',seq,'type',event_type,'payload',payload_json,'time',created_at_unix_ms)) FROM workbench_layout_events`
	if err := db.QueryRow(query).Scan(&beforeEvents); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	svc, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = svc.Close() }()
	assertCompositionVersion(t, svc.store.db, 6, 6)
	snapshot, err := svc.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	note := snapshot.StickyNotes[0]
	if note.Title != "" || note.Body != "Keep my note" || note.Material != "ruled" || note.Color != "sage" || snapshot.Revision != 2 {
		t.Fatalf("migration changed existing content: %#v", snapshot)
	}
	var afterEvents string
	if err := svc.store.db.QueryRow(query).Scan(&afterEvents); err != nil {
		t.Fatal(err)
	}
	if beforeEvents != afterEvents {
		t.Fatal("title migration changed existing events")
	}

	for _, title := range []string{"Launch 🚀", ""} {
		snapshot.StickyNotes[0].Title = title
		request := PutLayoutRequest{BaseRevision: snapshot.Revision, Widgets: snapshot.Widgets, StickyNotes: snapshot.StickyNotes, Annotations: snapshot.Annotations, BackgroundLayers: snapshot.BackgroundLayers}
		if _, err := svc.Replace(context.Background(), request); err != nil {
			t.Fatal(err)
		}
		previousRevision := snapshot.Revision
		if err := svc.Close(); err != nil {
			t.Fatal(err)
		}
		svc, err = Open(path)
		if err != nil {
			t.Fatal(err)
		}
		snapshot, err = svc.Snapshot(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if snapshot.StickyNotes[0].Title != title || snapshot.StickyNotes[0].Body != note.Body || snapshot.StickyNotes[0].Material != note.Material || snapshot.Revision != previousRevision+1 {
			t.Fatalf("title-only edit did not survive reopening: %#v", snapshot)
		}
	}
}

func TestStickyTitleMigrationRollsBack(t *testing.T) {
	path := createCompositionV5Database(t)
	spec := schemaSpec()
	failure := errors.New("injected title verification failure")
	spec.Verify = func(tx *sql.Tx) error {
		if err := verifySchema(tx); err != nil {
			return err
		}
		return failure
	}
	if _, err := sqliteutil.Open(path, spec); !errors.Is(err, failure) {
		t.Fatalf("error = %v", err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	assertCompositionVersion(t, db, 5, 5)
	var columns int
	if err := db.QueryRow(`SELECT count(*) FROM pragma_table_xinfo('workbench_layout_sticky_notes') WHERE name = 'title'`).Scan(&columns); err != nil {
		t.Fatal(err)
	}
	var body, material string
	if err := db.QueryRow(`SELECT body, material FROM workbench_layout_sticky_notes WHERE id = 'old-note'`).Scan(&body, &material); err != nil {
		t.Fatal(err)
	}
	if columns != 0 || body != "Keep my note" || material != "ruled" {
		t.Fatal("failed title migration changed the previous layout")
	}
}

func TestStickyTitleSchemaDriftIsReadOnly(t *testing.T) {
	for _, current := range []bool{false, true} {
		t.Run(map[bool]string{false: "v5 source", true: "v6 target"}[current], func(t *testing.T) {
			path := createCompositionV5Database(t)
			if current {
				svc, err := Open(path)
				if err != nil {
					t.Fatal(err)
				}
				if err := svc.Close(); err != nil {
					t.Fatal(err)
				}
			}
			db, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			mutation := `ALTER TABLE workbench_layout_sticky_notes ADD COLUMN unexpected TEXT;`
			if current {
				mutation = `ALTER TABLE workbench_layout_sticky_notes DROP COLUMN title; ALTER TABLE workbench_layout_sticky_notes ADD COLUMN title TEXT;`
			}
			if _, err := db.Exec(mutation); err != nil {
				t.Fatal(err)
			}
			if err := db.Close(); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if opened, err := Open(path); err == nil {
				opened.Close()
				t.Fatal("accepted a drifted title schema")
			}
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(before, after) {
				t.Fatal("schema rejection changed the database")
			}
		})
	}
}
