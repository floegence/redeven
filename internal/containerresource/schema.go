package containerresource

import (
	"database/sql"
	"fmt"
	"slices"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	schemaKind           = "container_resources_product_v1"
	currentSchemaVersion = 5
)

func schemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           schemaKind,
		CurrentVersion: currentSchemaVersion,
		MinimumVersion: 1,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`},
		Initialize:     createSchema,
		Migrations: []sqliteutil.Migration{
			{FromVersion: 1, ToVersion: 2, Apply: migrateToV2},
			{FromVersion: 2, ToVersion: 3, Apply: migrateToV3},
			{FromVersion: 3, ToVersion: 4, Apply: migrateToV4},
			{FromVersion: 4, ToVersion: 5, Apply: migrateToV5},
		},
		Verify: verifySchema,
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

CREATE TABLE container_compose_projects (
  project_id TEXT PRIMARY KEY,
  engine TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  name TEXT NOT NULL,
  config_paths_json TEXT NOT NULL,
  env_file_path TEXT NOT NULL DEFAULT '',
  profiles_json TEXT NOT NULL DEFAULT '[]',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_container_compose_projects_target_name
  ON container_compose_projects(engine, endpoint_id, name);

CREATE TABLE container_service_configuration_state (
  service_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  configuration_revision TEXT NOT NULL DEFAULT '',
  restart_required INTEGER NOT NULL DEFAULT 0 CHECK(restart_required IN (0, 1)),
  service_generation TEXT NOT NULL DEFAULT '',
  updated_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY(service_id, source_id)
);
`)
	return err
}

func migrateToV2(tx *sql.Tx) error {
	if err := verifyContainerResourceSchema(tx, false, false, false); err != nil {
		return fmt.Errorf("verify container resources v1 schema: %w", err)
	}
	_, err := tx.Exec(`
CREATE TABLE container_compose_projects (
  project_id TEXT PRIMARY KEY,
  engine TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  name TEXT NOT NULL,
  config_paths_json TEXT NOT NULL,
  env_file_path TEXT NOT NULL DEFAULT '',
  profiles_json TEXT NOT NULL DEFAULT '[]',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_container_compose_projects_target_name
  ON container_compose_projects(engine, endpoint_id, name);
`)
	return err
}

func migrateToV3(tx *sql.Tx) error {
	if err := verifyContainerResourceSchema(tx, true, false, false); err != nil {
		return fmt.Errorf("verify container resources v2 schema: %w", err)
	}
	_, err := tx.Exec(`
CREATE TABLE container_service_configuration_state (
  service_id TEXT PRIMARY KEY,
  configuration_revision TEXT NOT NULL DEFAULT '',
  restart_required INTEGER NOT NULL DEFAULT 0 CHECK(restart_required IN (0, 1)),
  service_generation TEXT NOT NULL DEFAULT '',
  updated_at_unix_ms INTEGER NOT NULL
);
`)
	return err
}

func migrateToV4(tx *sql.Tx) error {
	if err := verifyContainerResourceSchema(tx, true, true, false); err != nil {
		return fmt.Errorf("verify container resources v3 schema: %w", err)
	}
	_, err := tx.Exec(`
ALTER TABLE container_service_configuration_state RENAME TO container_service_configuration_state_v3;
CREATE TABLE container_service_configuration_state (
  service_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  configuration_revision TEXT NOT NULL DEFAULT '',
  restart_required INTEGER NOT NULL DEFAULT 0 CHECK(restart_required IN (0, 1)),
  service_generation TEXT NOT NULL DEFAULT '',
  updated_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY(service_id, source_id)
);
INSERT INTO container_service_configuration_state(
  service_id, source_id, configuration_revision, restart_required, service_generation, updated_at_unix_ms
)
SELECT service_id, 'engine', configuration_revision, restart_required, service_generation, updated_at_unix_ms
FROM container_service_configuration_state_v3;
DROP TABLE container_service_configuration_state_v3;
`)
	return err
}

func migrateToV5(tx *sql.Tx) error {
	if err := verifyContainerResourceSchema(tx, true, true, true); err != nil {
		return fmt.Errorf("verify container resources v4 schema: %w", err)
	}
	if err := verifyContainerServiceConfigurationSourceIDs(tx, "engine", "client_proxy"); err != nil {
		return fmt.Errorf("verify container resources v4 configuration sources: %w", err)
	}
	_, err := tx.Exec(`
UPDATE container_service_configuration_state
SET source_id = 'docker_cli'
WHERE source_id = 'client_proxy';
`)
	return err
}

func verifySchema(tx *sql.Tx) error {
	if err := verifyContainerResourceSchema(tx, true, true, true); err != nil {
		return err
	}
	return verifyContainerServiceConfigurationSourceIDs(tx, "engine", "docker_cli")
}

func verifyContainerServiceConfigurationSourceIDs(tx *sql.Tx, allowed ...string) error {
	rows, err := tx.Query(`SELECT DISTINCT source_id FROM container_service_configuration_state ORDER BY source_id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var sourceID string
		if err := rows.Scan(&sourceID); err != nil {
			return err
		}
		if !slices.Contains(allowed, sourceID) {
			return fmt.Errorf("unsupported container service configuration source %q", sourceID)
		}
	}
	return rows.Err()
}

func verifyContainerResourceSchema(tx *sql.Tx, includeComposeProjects, includeContainerServices, multiSourceContainerServices bool) error {
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	wantTables := []string{"container_resource_operation_events", "container_resource_operations"}
	if includeComposeProjects {
		wantTables = []string{"container_compose_projects", "container_resource_operation_events", "container_resource_operations"}
	}
	if includeContainerServices {
		wantTables = []string{"container_compose_projects", "container_resource_operation_events", "container_resource_operations", "container_service_configuration_state"}
	}
	if !slices.Equal(tables, wantTables) {
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
	if includeComposeProjects {
		expected["container_compose_projects"] = []string{"project_id", "engine", "endpoint_id", "name", "config_paths_json", "env_file_path", "profiles_json", "created_at_unix_ms", "updated_at_unix_ms"}
	}
	if includeContainerServices {
		expected["container_service_configuration_state"] = []string{"service_id", "configuration_revision", "restart_required", "service_generation", "updated_at_unix_ms"}
		if multiSourceContainerServices {
			expected["container_service_configuration_state"] = []string{"service_id", "source_id", "configuration_revision", "restart_required", "service_generation", "updated_at_unix_ms"}
		}
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
	if includeComposeProjects {
		wantIndexes = []string{"idx_container_compose_projects_target_name", "idx_container_resource_operation_events_operation_sequence", "idx_container_resource_operations_state_created"}
	}
	if !slices.Equal(indexes, wantIndexes) {
		return fmt.Errorf("container resource index set mismatch: got %v, want %v", indexes, wantIndexes)
	}
	return nil
}
