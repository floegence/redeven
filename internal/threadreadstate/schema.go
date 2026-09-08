package threadreadstate

import (
	"database/sql"
	"fmt"
	"slices"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	schemaKind           = "thread_read_state"
	currentSchemaVersion = 4
)

func schemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:             schemaKind,
		ValidateExisting: validateExisting,
		CurrentVersion:   currentSchemaVersion,
		Pragmas:          []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: migrateToV1},
			{FromVersion: 1, ToVersion: 2, Apply: migrateToV2},
			{FromVersion: 2, ToVersion: 3, Apply: migrateToV3},
			{FromVersion: 3, ToVersion: 4, Apply: migrateToV4},
		},
		Verify: verifySchema,
	}
}

func migrateToV4(tx *sql.Tx) error {
	_, err := tx.Exec(`
DROP INDEX idx_thread_read_state_scope;
ALTER TABLE thread_read_state RENAME TO thread_read_state_v3;
CREATE TABLE thread_read_state (
  endpoint_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  surface TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  last_seen_activity_revision INTEGER NOT NULL DEFAULT 0,
  updated_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY (endpoint_id, scope_id, surface, thread_id)
);
INSERT INTO thread_read_state (
  endpoint_id,
  scope_id,
  surface,
  thread_id,
  last_seen_activity_revision,
  updated_at_unix_ms
)
SELECT
  endpoint_id,
  scope_id,
  surface,
  thread_id,
  last_seen_activity_revision,
  updated_at_unix_ms
FROM thread_read_state_v3;
DROP TABLE thread_read_state_v3;
CREATE INDEX idx_thread_read_state_scope
  ON thread_read_state(endpoint_id, scope_id, surface, updated_at_unix_ms DESC, thread_id DESC);
`)
	return err
}

func migrateToV3(tx *sql.Tx) error {
	if _, err := tx.Exec(`
DELETE FROM thread_read_state
WHERE surface = 'codex';
DELETE FROM thread_read_state_retirements
WHERE surface = 'codex';
`); err != nil {
		return err
	}
	return nil
}

func migrateToV2(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE thread_read_state_retirements (
  endpoint_id TEXT NOT NULL,
  surface TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  retired_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY (endpoint_id, surface, thread_id)
);
`)
	return err
}

func migrateToV1(tx *sql.Tx) error {
	_, err := tx.Exec(`
	CREATE TABLE thread_read_state (
  endpoint_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  surface TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  last_seen_activity_revision INTEGER NOT NULL DEFAULT 0,
  last_read_message_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_seen_waiting_prompt_id TEXT NOT NULL DEFAULT '',
  last_read_updated_at_unix_s INTEGER NOT NULL DEFAULT 0,
  last_seen_activity_signature TEXT NOT NULL DEFAULT '',
  updated_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY (endpoint_id, scope_id, surface, thread_id)
);
	CREATE INDEX idx_thread_read_state_scope
  ON thread_read_state(endpoint_id, scope_id, surface, updated_at_unix_ms DESC, thread_id DESC);
`)
	return err
}

func verifySchema(tx *sql.Tx) error {
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	if !slices.Equal(tables, []string{"thread_read_state", "thread_read_state_retirements"}) {
		return fmt.Errorf("thread read state table set mismatch: got %v", tables)
	}
	expectedColumns := []string{
		"endpoint_id",
		"scope_id",
		"surface",
		"thread_id",
		"last_seen_activity_revision",
		"updated_at_unix_ms",
	}
	columns, err := sqliteutil.TableColumnNamesTx(tx, "thread_read_state")
	if err != nil {
		return err
	}
	if !slices.Equal(columns, expectedColumns) {
		return fmt.Errorf("thread read state column mismatch: got %v, want %v", columns, expectedColumns)
	}
	retirementColumns, err := sqliteutil.TableColumnNamesTx(tx, "thread_read_state_retirements")
	if err != nil {
		return err
	}
	if !slices.Equal(retirementColumns, []string{"endpoint_id", "surface", "thread_id", "retired_at_unix_ms"}) {
		return fmt.Errorf("thread read state retirement column mismatch: got %v", retirementColumns)
	}
	indexes, err := sqliteutil.ListUserIndexesTx(tx)
	if err != nil {
		return err
	}
	if !slices.Equal(indexes, []string{"idx_thread_read_state_scope"}) {
		return fmt.Errorf("thread read state index mismatch: got %v", indexes)
	}
	return nil
}
