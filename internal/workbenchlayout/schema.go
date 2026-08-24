package workbenchlayout

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"slices"
	"time"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	schemaKind           = "workbench_layout_runtime"
	currentSchemaVersion = 4
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
			{FromVersion: 3, ToVersion: 4, Apply: migrateToV4},
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

const legacyCodexWidgetType = "redeven.codex"

func migrateToV4(tx *sql.Tx) error {
	if err := verifyWorkbenchSchema(tx, 3); err != nil {
		return fmt.Errorf("verify workbench layout v3 schema: %w", err)
	}
	changed := false
	for _, query := range []string{
		`DELETE FROM workbench_layout_widgets WHERE widget_type = ?`,
		`DELETE FROM workbench_widget_states WHERE widget_type = ?`,
	} {
		result, err := tx.Exec(query, legacyCodexWidgetType)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return err
		}
		changed = changed || count > 0
	}

	rows, err := tx.Query(`SELECT seq, event_type, payload_json FROM workbench_layout_events ORDER BY seq ASC`)
	if err != nil {
		return err
	}
	type eventRow struct {
		seq       int64
		eventType string
		payload   string
	}
	events := make([]eventRow, 0)
	for rows.Next() {
		var event eventRow
		if err := rows.Scan(&event.seq, &event.eventType, &event.payload); err != nil {
			_ = rows.Close()
			return err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}

	for _, event := range events {
		switch event.eventType {
		case EventTypeLayoutReplaced:
			payload, removed, err := scrubLayoutEventPayload([]byte(event.payload))
			if err != nil {
				return fmt.Errorf("scrub workbench layout event %d: %w", event.seq, err)
			}
			if !removed {
				continue
			}
			if _, err := tx.Exec(`UPDATE workbench_layout_events SET payload_json = ? WHERE seq = ?`, string(payload), event.seq); err != nil {
				return err
			}
			changed = true
		case EventTypeWidgetStateUpserted:
			var state struct {
				WidgetType string `json:"widget_type"`
			}
			if err := json.Unmarshal([]byte(event.payload), &state); err != nil {
				return fmt.Errorf("decode workbench widget event %d: %w", event.seq, err)
			}
			if state.WidgetType != legacyCodexWidgetType {
				continue
			}
			if _, err := tx.Exec(`DELETE FROM workbench_layout_events WHERE seq = ?`, event.seq); err != nil {
				return err
			}
			changed = true
		}
	}

	if !changed {
		return nil
	}
	current, err := snapshotTx(context.Background(), tx)
	if err != nil {
		return err
	}
	nowUnixMs := time.Now().UnixMilli()
	result, err := tx.Exec(`INSERT INTO workbench_layout_events(event_type, payload_json, created_at_unix_ms) VALUES (?, ?, ?)`, EventTypeLayoutReplaced, "", nowUnixMs)
	if err != nil {
		return err
	}
	seq, err := result.LastInsertId()
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE workbench_layout_snapshot SET revision = ?, seq = ?, updated_at_unix_ms = ? WHERE singleton = 1`, current.Revision+1, seq, nowUnixMs); err != nil {
		return err
	}
	current.Revision++
	current.Seq = seq
	current.UpdatedAtUnixMs = nowUnixMs
	payload, err := json.Marshal(current)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE workbench_layout_events SET payload_json = ? WHERE seq = ?`, string(payload), seq)
	return err
}

func scrubLayoutEventPayload(raw []byte) ([]byte, bool, error) {
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, false, err
	}
	removed := false
	for _, field := range []string{"widgets", "widget_states"} {
		value, ok := payload[field]
		if !ok {
			continue
		}
		var items []map[string]json.RawMessage
		if err := json.Unmarshal(value, &items); err != nil {
			return nil, false, err
		}
		filtered := items[:0]
		fieldRemoved := false
		for _, item := range items {
			typeValue, ok := item["widget_type"]
			if !ok {
				filtered = append(filtered, item)
				continue
			}
			var widgetType string
			if err := json.Unmarshal(typeValue, &widgetType); err != nil {
				return nil, false, err
			}
			if widgetType == legacyCodexWidgetType {
				removed = true
				fieldRemoved = true
				continue
			}
			filtered = append(filtered, item)
		}
		if fieldRemoved {
			encoded, err := json.Marshal(filtered)
			if err != nil {
				return nil, false, err
			}
			payload[field] = encoded
		}
	}
	if !removed {
		return raw, false, nil
	}
	encoded, err := json.Marshal(payload)
	return encoded, true, err
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
