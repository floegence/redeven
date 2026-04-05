package notes

import (
	"database/sql"
	"fmt"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	schemaKind           = "notes_runtime"
	currentSchemaVersion = 1
)

func schemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           schemaKind,
		CurrentVersion: currentSchemaVersion,
		LegacyMarkers:  []string{"notes_topics", "notes_items", "notes_events"},
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: migrateToV1},
		},
		Verify: verifySchema,
	}
}

func migrateToV1(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS notes_topics (
  topic_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon_key TEXT NOT NULL,
  icon_accent TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  deleted_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notes_topics_sort
  ON notes_topics(deleted_at_unix_ms, sort_order ASC, topic_id ASC);

CREATE TABLE IF NOT EXISTS notes_items (
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
CREATE INDEX IF NOT EXISTS idx_notes_items_active
  ON notes_items(topic_id, deleted_at_unix_ms, z_index ASC, note_id ASC);
CREATE INDEX IF NOT EXISTS idx_notes_items_trash
  ON notes_items(topic_id, deleted_at_unix_ms DESC, note_id DESC);

CREATE TABLE IF NOT EXISTS notes_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  topic_id TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_events_seq
  ON notes_events(seq ASC);
`)
	return err
}

func verifySchema(tx *sql.Tx) error {
	requiredTables := map[string][]string{
		"notes_topics": {"topic_id", "name", "icon_key", "icon_accent", "sort_order", "created_at_unix_ms", "updated_at_unix_ms", "deleted_at_unix_ms"},
		"notes_items":  {"note_id", "topic_id", "body", "preview_text", "character_count", "size_bucket", "style_version", "color_token", "x", "y", "z_index", "created_at_unix_ms", "updated_at_unix_ms", "deleted_at_unix_ms", "deleted_snapshot_json"},
		"notes_events": {"seq", "event_type", "entity_kind", "entity_id", "topic_id", "payload_json", "created_at_unix_ms"},
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
	return nil
}
