package containerresource

import (
	"database/sql"
	"fmt"
	"slices"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	schemaKind           = "container_resources_product_v1"
	currentSchemaVersion = 1
)

func schemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           schemaKind,
		CurrentVersion: currentSchemaVersion,
		MinimumVersion: currentSchemaVersion,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`},
		Initialize:     createSchema,
		Verify:         verifySchema,
	}
}

func createSchema(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE container_resource_operations (
  operation_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  method TEXT NOT NULL,
  engine TEXT NOT NULL,
  endpoint_id TEXT NOT NULL DEFAULT '',
  resource_kind TEXT NOT NULL,
  resource_identity TEXT NOT NULL,
  state TEXT NOT NULL,
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0, 1)),
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  reconciliation_json TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  started_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  finished_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  updated_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX idx_container_resource_operations_state_created
  ON container_resource_operations(state, created_at_unix_ms DESC, operation_id DESC);

CREATE TABLE container_resource_operation_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  state TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  FOREIGN KEY(operation_id) REFERENCES container_resource_operations(operation_id) ON DELETE CASCADE
);
CREATE INDEX idx_container_resource_operation_events_operation_sequence
  ON container_resource_operation_events(operation_id, sequence ASC);
`)
	return err
}

func verifySchema(tx *sql.Tx) error {
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	if !slices.Equal(tables, []string{"container_resource_operation_events", "container_resource_operations"}) {
		return fmt.Errorf("container resource table set mismatch: got %v", tables)
	}
	expected := map[string][]string{
		"container_resource_operations": {
			"operation_id", "request_id", "request_hash", "plan_hash", "method", "engine", "endpoint_id",
			"resource_kind", "resource_identity", "state", "cancel_requested", "error_code", "error_message",
			"reconciliation_json", "created_at_unix_ms", "started_at_unix_ms", "finished_at_unix_ms", "updated_at_unix_ms",
		},
		"container_resource_operation_events": {"sequence", "operation_id", "event_type", "state", "payload_json", "created_at_unix_ms"},
	}
	for table, want := range expected {
		columns, err := sqliteutil.TableColumnNamesTx(tx, table)
		if err != nil {
			return err
		}
		if !slices.Equal(columns, want) {
			return fmt.Errorf("container resource %s column mismatch: got %v, want %v", table, columns, want)
		}
	}
	indexes, err := sqliteutil.ListUserIndexesTx(tx)
	if err != nil {
		return err
	}
	wantIndexes := []string{"idx_container_resource_operation_events_operation_sequence", "idx_container_resource_operations_state_created"}
	if !slices.Equal(indexes, wantIndexes) {
		return fmt.Errorf("container resource index set mismatch: got %v, want %v", indexes, wantIndexes)
	}
	return nil
}
