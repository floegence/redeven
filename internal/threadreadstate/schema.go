package threadreadstate

import (
	"database/sql"
	"fmt"
	"slices"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	schemaKind           = "thread_read_state"
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
		"last_read_message_at_unix_ms",
		"last_seen_waiting_prompt_id",
		"last_read_updated_at_unix_s",
		"last_seen_activity_signature",
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
