package notes

import (
	"database/sql"
	"fmt"
	"slices"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	schemaKind           = "notes_runtime"
	currentSchemaVersion = 2
)

func schemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           schemaKind,
		CurrentVersion: currentSchemaVersion,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: migrateToV1},
			{FromVersion: 1, ToVersion: 2, Apply: migrateToV2},
		},
		Verify: verifySchema,
	}
}

func migrateToV1(tx *sql.Tx) error {
	_, err := tx.Exec(`
	CREATE TABLE notes_topics (
  topic_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon_key TEXT NOT NULL,
  icon_accent TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  deleted_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
	CREATE INDEX idx_notes_topics_sort
  ON notes_topics(deleted_at_unix_ms, sort_order ASC, topic_id ASC);

	CREATE TABLE notes_items (
	  note_id TEXT PRIMARY KEY,
	  topic_id TEXT NOT NULL,
	  body TEXT NOT NULL,
  preview_text TEXT NOT NULL,
  character_count INTEGER NOT NULL,
  size_bucket INTEGER NOT NULL,
  style_version TEXT NOT NULL,
  color_token TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  z_index INTEGER NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  deleted_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  deleted_snapshot_json TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(topic_id) REFERENCES notes_topics(topic_id)
);
	CREATE INDEX idx_notes_items_active
  ON notes_items(topic_id, deleted_at_unix_ms, z_index ASC, note_id ASC);
	CREATE INDEX idx_notes_items_trash
  ON notes_items(topic_id, deleted_at_unix_ms DESC, note_id DESC);

	CREATE TABLE notes_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  topic_id TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL
);
	CREATE INDEX idx_notes_events_seq
  ON notes_events(seq ASC);
`)
	return err
}

func migrateToV2(tx *sql.Tx) error {
	if err := verifyNotesSchema(tx, false); err != nil {
		return fmt.Errorf("verify notes v1 schema: %w", err)
	}
	_, err := tx.Exec(`
DROP INDEX idx_notes_items_active;
DROP INDEX idx_notes_items_trash;
ALTER TABLE notes_items RENAME TO notes_items_v1;
CREATE TABLE notes_items (
  note_id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  preview_text TEXT NOT NULL,
  character_count INTEGER NOT NULL,
  size_bucket INTEGER NOT NULL,
  style_version TEXT NOT NULL,
  color_token TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  z_index INTEGER NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  deleted_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  deleted_snapshot_json TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(topic_id) REFERENCES notes_topics(topic_id)
);
CREATE INDEX idx_notes_items_active
  ON notes_items(topic_id, deleted_at_unix_ms, z_index ASC, note_id ASC);
CREATE INDEX idx_notes_items_trash
  ON notes_items(topic_id, deleted_at_unix_ms DESC, note_id DESC);
INSERT INTO notes_items(
  note_id, topic_id, title, body, preview_text, character_count, size_bucket,
  style_version, color_token, x, y, z_index, created_at_unix_ms,
  updated_at_unix_ms, deleted_at_unix_ms, deleted_snapshot_json
)
SELECT
  note_id, topic_id, '', body, preview_text, character_count, size_bucket,
  style_version, color_token, x, y, z_index, created_at_unix_ms,
  updated_at_unix_ms, deleted_at_unix_ms, deleted_snapshot_json
FROM notes_items_v1;
DROP TABLE notes_items_v1;
`)
	return err
}

func verifySchema(tx *sql.Tx) error {
	return verifyNotesSchema(tx, true)
}

func verifyNotesSchema(tx *sql.Tx, includeTitle bool) error {
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	if !slices.Equal(tables, []string{"notes_events", "notes_items", "notes_topics"}) {
		return fmt.Errorf("notes table set mismatch: got %v", tables)
	}
	expectedColumns := map[string][]string{
		"notes_topics": {"topic_id", "name", "icon_key", "icon_accent", "sort_order", "created_at_unix_ms", "updated_at_unix_ms", "deleted_at_unix_ms"},
		"notes_items":  {"note_id", "topic_id", "body", "preview_text", "character_count", "size_bucket", "style_version", "color_token", "x", "y", "z_index", "created_at_unix_ms", "updated_at_unix_ms", "deleted_at_unix_ms", "deleted_snapshot_json"},
		"notes_events": {"seq", "event_type", "entity_kind", "entity_id", "topic_id", "payload_json", "created_at_unix_ms"},
	}
	if includeTitle {
		expectedColumns["notes_items"] = []string{"note_id", "topic_id", "title", "body", "preview_text", "character_count", "size_bucket", "style_version", "color_token", "x", "y", "z_index", "created_at_unix_ms", "updated_at_unix_ms", "deleted_at_unix_ms", "deleted_snapshot_json"}
	}
	for tableName, expected := range expectedColumns {
		columns, err := sqliteutil.TableColumnNamesTx(tx, tableName)
		if err != nil {
			return err
		}
		if !slices.Equal(columns, expected) {
			return fmt.Errorf("notes column mismatch for %s: got %v, want %v", tableName, columns, expected)
		}
	}
	indexes, err := sqliteutil.ListUserIndexesTx(tx)
	if err != nil {
		return err
	}
	expectedIndexes := []string{"idx_notes_events_seq", "idx_notes_items_active", "idx_notes_items_trash", "idx_notes_topics_sort"}
	if !slices.Equal(indexes, expectedIndexes) {
		return fmt.Errorf("notes index mismatch: got %v, want %v", indexes, expectedIndexes)
	}
	return nil
}
