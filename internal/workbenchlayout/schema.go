package workbenchlayout

import (
	"database/sql"
	"fmt"
	"slices"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	schemaKind           = "workbench_layout_runtime"
	currentSchemaVersion = 3
)

func schemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           schemaKind,
		CurrentVersion: currentSchemaVersion,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: migrateToV1},
			{FromVersion: 1, ToVersion: 2, Apply: migrateToV2},
			{FromVersion: 2, ToVersion: 3, Apply: migrateToV3},
		},
		Verify: verifySchema,
	}
}

func migrateToV1(tx *sql.Tx) error {
	_, err := tx.Exec(`
	CREATE TABLE workbench_layout_snapshot (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);

	INSERT INTO workbench_layout_snapshot(singleton, revision, seq, updated_at_unix_ms)
	VALUES (1, 0, 0, 0);

	CREATE TABLE workbench_layout_widgets (
  widget_id TEXT PRIMARY KEY,
  widget_type TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  z_index INTEGER NOT NULL,
  created_at_unix_ms INTEGER NOT NULL
);
	CREATE INDEX idx_workbench_layout_widgets_order
  ON workbench_layout_widgets(z_index ASC, created_at_unix_ms ASC, widget_id ASC);

	CREATE TABLE workbench_layout_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL
);
	CREATE INDEX idx_workbench_layout_events_seq
  ON workbench_layout_events(seq ASC);
`)
	return err
}

func migrateToV2(tx *sql.Tx) error {
	if err := verifyWorkbenchSchema(tx, 1); err != nil {
		return fmt.Errorf("verify workbench layout v1 schema: %w", err)
	}
	_, err := tx.Exec(`
	CREATE TABLE workbench_widget_states (
  widget_id TEXT PRIMARY KEY,
  widget_type TEXT NOT NULL,
  revision INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
	CREATE INDEX idx_workbench_widget_states_type
  ON workbench_widget_states(widget_type ASC, widget_id ASC);
`)
	return err
}

func migrateToV3(tx *sql.Tx) error {
	if err := verifyWorkbenchSchema(tx, 2); err != nil {
		return fmt.Errorf("verify workbench layout v2 schema: %w", err)
	}
	_, err := tx.Exec(`
	CREATE TABLE workbench_layout_sticky_notes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  color TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  z_index INTEGER NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
	CREATE INDEX idx_workbench_layout_sticky_notes_order
  ON workbench_layout_sticky_notes(z_index ASC, created_at_unix_ms ASC, id ASC);

	CREATE TABLE workbench_layout_annotations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  font_family TEXT NOT NULL,
  font_size INTEGER NOT NULL,
  font_weight INTEGER NOT NULL,
  color TEXT NOT NULL,
  align TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  z_index INTEGER NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
	CREATE INDEX idx_workbench_layout_annotations_order
  ON workbench_layout_annotations(z_index ASC, created_at_unix_ms ASC, id ASC);

	CREATE TABLE workbench_layout_background_layers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  fill TEXT NOT NULL,
  opacity REAL NOT NULL,
  material TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  z_index INTEGER NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
	CREATE INDEX idx_workbench_layout_background_layers_order
  ON workbench_layout_background_layers(z_index ASC, created_at_unix_ms ASC, id ASC);
`)
	return err
}

func verifySchema(tx *sql.Tx) error {
	return verifyWorkbenchSchema(tx, currentSchemaVersion)
}

func verifyWorkbenchSchema(tx *sql.Tx, version int) error {
	expectedColumns := map[string][]string{
		"workbench_layout_snapshot": {"singleton", "revision", "seq", "updated_at_unix_ms"},
		"workbench_layout_widgets":  {"widget_id", "widget_type", "x", "y", "width", "height", "z_index", "created_at_unix_ms"},
		"workbench_layout_events":   {"seq", "event_type", "payload_json", "created_at_unix_ms"},
	}
	expectedIndexes := []string{"idx_workbench_layout_events_seq", "idx_workbench_layout_widgets_order"}
	if version >= 2 {
		expectedColumns["workbench_widget_states"] = []string{"widget_id", "widget_type", "revision", "state_json", "updated_at_unix_ms"}
		expectedIndexes = append(expectedIndexes, "idx_workbench_widget_states_type")
	}
	if version >= 3 {
		expectedColumns["workbench_layout_sticky_notes"] = []string{"id", "kind", "body", "color", "x", "y", "width", "height", "z_index", "created_at_unix_ms", "updated_at_unix_ms"}
		expectedColumns["workbench_layout_annotations"] = []string{"id", "kind", "text", "font_family", "font_size", "font_weight", "color", "align", "x", "y", "width", "height", "z_index", "created_at_unix_ms", "updated_at_unix_ms"}
		expectedColumns["workbench_layout_background_layers"] = []string{"id", "name", "fill", "opacity", "material", "x", "y", "width", "height", "z_index", "created_at_unix_ms", "updated_at_unix_ms"}
		expectedIndexes = append(expectedIndexes,
			"idx_workbench_layout_annotations_order",
			"idx_workbench_layout_background_layers_order",
			"idx_workbench_layout_sticky_notes_order",
		)
	}
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	expectedTables := make([]string, 0, len(expectedColumns))
	for tableName := range expectedColumns {
		expectedTables = append(expectedTables, tableName)
	}
	slices.Sort(expectedTables)
	if !slices.Equal(tables, expectedTables) {
		return fmt.Errorf("workbench layout v%d table mismatch: got %v, want %v", version, tables, expectedTables)
	}
	for tableName, expected := range expectedColumns {
		columns, err := sqliteutil.TableColumnNamesTx(tx, tableName)
		if err != nil {
			return err
		}
		if !slices.Equal(columns, expected) {
			return fmt.Errorf("workbench layout v%d column mismatch for %s: got %v, want %v", version, tableName, columns, expected)
		}
	}
	indexes, err := sqliteutil.ListUserIndexesTx(tx)
	if err != nil {
		return err
	}
	slices.Sort(expectedIndexes)
	if !slices.Equal(indexes, expectedIndexes) {
		return fmt.Errorf("workbench layout v%d index mismatch: got %v, want %v", version, indexes, expectedIndexes)
	}

	var snapshotRows int
	if err := tx.QueryRow(`SELECT COUNT(1) FROM workbench_layout_snapshot WHERE singleton = 1`).Scan(&snapshotRows); err != nil {
		return err
	}
	if snapshotRows != 1 {
		return fmt.Errorf("expected exactly one snapshot row, got %d", snapshotRows)
	}

	return nil
}
