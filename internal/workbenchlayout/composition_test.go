package workbenchlayout

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func TestServiceCompositionRoundTrip(t *testing.T) {
	svc := openTestService(t)
	var request PutLayoutRequest
	if err := json.Unmarshal([]byte(`{"base_revision":0,"widgets":[],"sticky_notes":[{"id":"note","kind":"sticky_note","body":"","color":"graphite","material":"ruled","x":20,"y":40,"width":260,"height":190}],"background_layers":[{"id":"region","name":"","material":"frame","fill":"#8fa1aa","opacity":0.8,"x":0,"y":0,"width":400,"height":300}]}`), &request); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Replace(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	snapshot, err := svc.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.StickyNotes[0].Body != "" || snapshot.StickyNotes[0].Color != "graphite" {
		t.Fatalf("note changed after save: %#v", snapshot.StickyNotes[0])
	}
	if snapshot.BackgroundLayers[0].Name != "" || snapshot.BackgroundLayers[0].Material != "frame" {
		t.Fatalf("region changed after save: %#v", snapshot.BackgroundLayers[0])
	}
	raw, err := json.Marshal(snapshot.StickyNotes[0])
	if err != nil {
		t.Fatal(err)
	}
	var note map[string]any
	if err := json.Unmarshal(raw, &note); err != nil {
		t.Fatal(err)
	}
	if note["material"] != "ruled" {
		t.Fatalf("material did not persist: %s", raw)
	}
}

// Build the historical v4 shape without invoking the current initializer.
func createCompositionV4Database(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "composition-v4.sqlite")
	createWorkbenchLayoutV3DatabaseWithLegacyCodex(t, path)
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
	if err := migrateToV4(tx); err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`
INSERT INTO workbench_layout_sticky_notes VALUES ('old-note', 'sticky_note', 'Keep my note', 'sage', 20, 40, 260, 190, 3, 1700000000000, 1700000000010);
INSERT INTO workbench_layout_annotations VALUES ('old-text', 'text', 'Keep my text', 'sans-serif', 45, 800, '#6b7280', 'left', 0, 0, 300, 100, 1, 1700000000000, 1700000000010);
INSERT INTO workbench_layout_background_layers VALUES ('old-region', 'Keep my region', '#9da8a1', 0.72, 'dotted', 0, 0, 800, 500, 1, 1700000000000, 1700000000010);
UPDATE __redeven_db_meta SET last_migrated_from_version = 3, last_migrated_to_version = 4;
PRAGMA user_version = 4;`)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestCompositionV5MigrationPreservesLayoutAndEvents(t *testing.T) {
	path := createCompositionV4Database(t)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	var beforeEvents string
	if err := db.QueryRow(`SELECT json_group_array(json_object('seq',seq,'type',event_type,'payload',payload_json,'time',created_at_unix_ms)) FROM workbench_layout_events`).Scan(&beforeEvents); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	svc, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := svc.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.StickyNotes) != 1 || snapshot.StickyNotes[0].Body != "Keep my note" || snapshot.StickyNotes[0].Material != "tint" || snapshot.StickyNotes[0].X != 20 || snapshot.StickyNotes[0].UpdatedAtUnixMs != 1700000000010 {
		t.Fatalf("historical note changed: %#v", snapshot.StickyNotes)
	}
	if len(snapshot.Annotations) != 1 || snapshot.Annotations[0].Text != "Keep my text" || len(snapshot.BackgroundLayers) != 1 || snapshot.BackgroundLayers[0].Material != "dotted" || snapshot.BackgroundLayers[0].Name != "Keep my region" {
		t.Fatalf("historical composition changed: %#v", snapshot)
	}
	if len(snapshot.Widgets) != 2 || len(snapshot.WidgetStates) != 1 || snapshot.WidgetStates[0].State.CurrentPath != "/workspace/src" || snapshot.Revision != 2 {
		t.Fatalf("historical widget state changed: %#v", snapshot)
	}
	var afterEvents string
	if err := svc.store.db.QueryRow(`SELECT json_group_array(json_object('seq',seq,'type',event_type,'payload',payload_json,'time',created_at_unix_ms)) FROM workbench_layout_events`).Scan(&afterEvents); err != nil {
		t.Fatal(err)
	}
	if beforeEvents != afterEvents {
		t.Fatal("v5 migration rewrote existing events")
	}
	assertCompositionVersion(t, svc.store.db, 5, 5)
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	// Reopening is idempotent and still reads the same persisted data.
	svc, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	after, err := svc.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(snapshot, after) {
		t.Fatal("reopening changed the layout")
	}
}

func TestCompositionV5MigrationRollsBackOnVerificationFailure(t *testing.T) {
	path := createCompositionV4Database(t)
	spec := schemaSpec()
	failure := errors.New("injected final verification failure")
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
	assertCompositionVersion(t, db, 4, 4)
	var materialColumns int
	if err := db.QueryRow(`SELECT count(*) FROM pragma_table_info('workbench_layout_sticky_notes') WHERE name = 'material'`).Scan(&materialColumns); err != nil {
		t.Fatal(err)
	}
	if materialColumns != 0 {
		t.Fatal("failed migration retained the new column")
	}
	var body string
	if err := db.QueryRow(`SELECT body FROM workbench_layout_sticky_notes WHERE id = 'old-note'`).Scan(&body); err != nil {
		t.Fatal(err)
	}
	if body != "Keep my note" {
		t.Fatal("failed migration changed user content")
	}
}

func TestCompositionV5MigrationRejectsV4Drift(t *testing.T) {
	path := createCompositionV4Database(t)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE workbench_layout_sticky_notes ADD COLUMN unexpected TEXT`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(path); err == nil {
		t.Fatal("accepted a drifted v4 schema")
	}
	db, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	assertCompositionVersion(t, db, 4, 4)
}

func assertCompositionVersion(t *testing.T, db *sql.DB, wantVersion, wantMeta int) {
	t.Helper()
	var version, meta int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT last_migrated_to_version FROM __redeven_db_meta`).Scan(&meta); err != nil {
		t.Fatal(err)
	}
	if version != wantVersion || meta != wantMeta {
		t.Fatalf("version=%d metadata=%d, want %d/%d", version, meta, wantVersion, wantMeta)
	}
}

func TestCompositionRejectsMaterialColumnDrift(t *testing.T) {
	path := filepath.Join(t.TempDir(), "composition-v5.sqlite")
	svc, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE workbench_layout_sticky_notes DROP COLUMN material;
ALTER TABLE workbench_layout_sticky_notes ADD COLUMN material INTEGER;`); err != nil {
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
		t.Fatal("accepted wrong material column type and constraints")
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("rejection changed the incompatible database")
	}
}
