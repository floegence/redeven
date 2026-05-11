package workbenchlayout

import (
	"database/sql"
	"fmt"

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
		LegacyMarkers:  []string{"workbench_layout_snapshot", "workbench_layout_widgets", "workbench_layout_events"},
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
CREATE TABLE IF NOT EXISTS workbench_layout_snapshot (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);

INSERT INTO workbench_layout_snapshot(singleton, revision, seq, updated_at_unix_ms)
VALUES (1, 0, 0, 0)
ON CONFLICT(singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS workbench_layout_widgets (
  widget_id TEXT PRIMARY KEY,
  widget_type TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  z_index INTEGER NOT NULL,
  created_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workbench_layout_widgets_order
  ON workbench_layout_widgets(z_index ASC, created_at_unix_ms ASC, widget_id ASC);

CREATE TABLE IF NOT EXISTS workbench_layout_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workbench_layout_events_seq
  ON workbench_layout_events(seq ASC);
`)
	return err
}

func migrateToV2(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS workbench_widget_states (
  widget_id TEXT PRIMARY KEY,
  widget_type TEXT NOT NULL,
  revision INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workbench_widget_states_type
  ON workbench_widget_states(widget_type ASC, widget_id ASC);
`)
	return err
}

func migrateToV3(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS workbench_layout_sticky_notes (
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
CREATE INDEX IF NOT EXISTS idx_workbench_layout_sticky_notes_order
  ON workbench_layout_sticky_notes(z_index ASC, created_at_unix_ms ASC, id ASC);

CREATE TABLE IF NOT EXISTS workbench_layout_annotations (
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
CREATE INDEX IF NOT EXISTS idx_workbench_layout_annotations_order
  ON workbench_layout_annotations(z_index ASC, created_at_unix_ms ASC, id ASC);

CREATE TABLE IF NOT EXISTS workbench_layout_background_layers (
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
CREATE INDEX IF NOT EXISTS idx_workbench_layout_background_layers_order
  ON workbench_layout_background_layers(z_index ASC, created_at_unix_ms ASC, id ASC);
`)
	return err
}

func verifySchema(tx *sql.Tx) error {
	requiredTables := map[string][]string{
		"workbench_layout_snapshot":          {"singleton", "revision", "seq", "updated_at_unix_ms"},
		"workbench_layout_widgets":           {"widget_id", "widget_type", "x", "y", "width", "height", "z_index", "created_at_unix_ms"},
		"workbench_layout_sticky_notes":      {"id", "kind", "body", "color", "x", "y", "width", "height", "z_index", "created_at_unix_ms", "updated_at_unix_ms"},
		"workbench_layout_annotations":       {"id", "kind", "text", "font_family", "font_size", "font_weight", "color", "align", "x", "y", "width", "height", "z_index", "created_at_unix_ms", "updated_at_unix_ms"},
		"workbench_layout_background_layers": {"id", "name", "fill", "opacity", "material", "x", "y", "width", "height", "z_index", "created_at_unix_ms", "updated_at_unix_ms"},
		"workbench_layout_events":            {"seq", "event_type", "payload_json", "created_at_unix_ms"},
		"workbench_widget_states":            {"widget_id", "widget_type", "revision", "state_json", "updated_at_unix_ms"},
	}
	for tableName, columns := range requiredTables {
		exists, err := sqliteutil.TableExistsTx(tx, tableName)
		if err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("missing table %q", tableName)
		}
		for _, columnName := range columns {
			has, err := sqliteutil.ColumnExistsTx(tx, tableName, columnName)
			if err != nil {
				return err
			}
			if !has {
				return fmt.Errorf("missing column %q on %q", columnName, tableName)
			}
		}
	}

	requiredIndexes := []string{
		"idx_workbench_layout_widgets_order",
		"idx_workbench_layout_sticky_notes_order",
		"idx_workbench_layout_annotations_order",
		"idx_workbench_layout_background_layers_order",
		"idx_workbench_layout_events_seq",
		"idx_workbench_widget_states_type",
	}
	for _, indexName := range requiredIndexes {
		exists, err := sqliteutil.IndexExistsTx(tx, indexName)
		if err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("missing index %q", indexName)
		}
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
