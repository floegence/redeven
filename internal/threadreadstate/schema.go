package threadreadstate

import (
	"database/sql"
	"fmt"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	schemaKind           = "thread_read_state"
	currentSchemaVersion = 1
)

func schemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           schemaKind,
		CurrentVersion: currentSchemaVersion,
		LegacyMarkers:  []string{"thread_read_state"},
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: migrateToV1},
		},
		Verify: verifySchema,
	}
}

func migrateToV1(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS thread_read_state (
  endpoint_id TEXT NOT NULL,
  user_public_id TEXT NOT NULL,
  surface TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  last_read_message_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_seen_waiting_prompt_id TEXT NOT NULL DEFAULT '',
  last_read_updated_at_unix_s INTEGER NOT NULL DEFAULT 0,
  last_seen_activity_signature TEXT NOT NULL DEFAULT '',
  updated_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY (endpoint_id, user_public_id, surface, thread_id)
);
CREATE INDEX IF NOT EXISTS idx_thread_read_state_scope
  ON thread_read_state(endpoint_id, user_public_id, surface, updated_at_unix_ms DESC, thread_id DESC);
`)
	return err
}

func verifySchema(tx *sql.Tx) error {
	exists, err := sqliteutil.TableExistsTx(tx, "thread_read_state")
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("missing table %q", "thread_read_state")
	}
	for _, columnName := range []string{
		"endpoint_id",
		"user_public_id",
		"surface",
		"thread_id",
		"last_read_message_at_unix_ms",
		"last_seen_waiting_prompt_id",
		"last_read_updated_at_unix_s",
		"last_seen_activity_signature",
		"updated_at_unix_ms",
	} {
		has, err := sqliteutil.ColumnExistsTx(tx, "thread_read_state", columnName)
		if err != nil {
			return err
		}
		if !has {
			return fmt.Errorf("missing column %q on %q", columnName, "thread_read_state")
		}
	}
	return nil
}
