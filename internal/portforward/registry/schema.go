package registry

import (
	"database/sql"
	"fmt"
	"slices"
	"strings"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	registrySchemaKind           = "portforward_registry"
	registryCurrentSchemaVersion = 4
)

func registrySchemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           registrySchemaKind,
		CurrentVersion: registryCurrentSchemaVersion,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA foreign_keys=ON;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: migrateRegistryToV1},
			{FromVersion: 1, ToVersion: 2, Apply: migrateRegistryToV2},
			{FromVersion: 2, ToVersion: 3, Apply: migrateRegistryToV3},
			{FromVersion: 3, ToVersion: 4, Apply: migrateRegistryToV4},
		},
		Verify: verifyRegistrySchema,
	}
}

func migrateRegistryToV4(tx *sql.Tx) error {
	if err := verifyRegistryShape(tx, []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms"}, "v3"); err != nil {
		return err
	}
	_, err := tx.Exec(`
ALTER TABLE port_forwards ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'unified_proxy'
  CHECK(access_mode IN ('unified_proxy','desktop_loopback'));
UPDATE port_forwards
SET access_mode='desktop_loopback'
WHERE forward_id IN (
  SELECT forward_id FROM managed_web_services WHERE service_family_id='deepseek-harness'
);
`)
	return err
}

func migrateRegistryToV3(tx *sql.Tx) error {
	if err := verifyRegistryV2Source(tx); err != nil {
		return err
	}
	_, err := tx.Exec(`
CREATE TABLE managed_web_service_templates (
  template_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  deployment TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL,
  spec_json TEXT NOT NULL,
  spec_sha256 TEXT NOT NULL,
  derived_from_template_id TEXT NOT NULL DEFAULT '',
  derived_from_revision INTEGER NOT NULL DEFAULT 0,
  service_family_id TEXT NOT NULL UNIQUE,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
CREATE TABLE managed_web_service_template_requests (
  request_id TEXT PRIMARY KEY,
  request_fingerprint TEXT NOT NULL,
  template_id TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL
);
CREATE TABLE managed_web_services_v3 (
  service_id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL UNIQUE,
  template_source TEXT NOT NULL,
  template_revision INTEGER NOT NULL,
  template_snapshot_json TEXT NOT NULL,
  template_snapshot_sha256 TEXT NOT NULL,
  service_family_id TEXT NOT NULL UNIQUE,
  deployment TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  configuration_json TEXT NOT NULL DEFAULT '{}',
  version TEXT NOT NULL,
  desired_state TEXT NOT NULL,
  observed_state TEXT NOT NULL,
  forward_id TEXT NOT NULL UNIQUE REFERENCES port_forwards(forward_id) ON DELETE RESTRICT,
  runtime_identity TEXT NOT NULL DEFAULT '',
  runtime_manifest_json TEXT NOT NULL DEFAULT '{}',
  runtime_port INTEGER NOT NULL DEFAULT 0,
  artifact_reference TEXT NOT NULL DEFAULT '',
  last_error_code TEXT NOT NULL DEFAULT '',
  last_error_message TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
INSERT INTO managed_web_services_v3(
  service_id,template_id,template_source,template_revision,template_snapshot_json,template_snapshot_sha256,service_family_id,
  deployment,workspace_path,configuration_json,version,desired_state,observed_state,forward_id,runtime_identity,runtime_manifest_json,
  runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms
)
SELECT
  service_id,
  CASE WHEN template_id='deepseek-harness' AND deployment='docker' THEN 'deepseek-harness-container'
       WHEN template_id='deepseek-harness' THEN 'deepseek-harness-host'
       ELSE template_id END,
  'builtin',1,'{}','',
  CASE WHEN template_id='deepseek-harness' THEN 'deepseek-harness' ELSE template_id END,
  deployment,workspace_path,'{}',version,desired_state,observed_state,forward_id,runtime_identity,'{}',
  runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms
FROM managed_web_services;
DROP TABLE managed_web_services;
ALTER TABLE managed_web_services_v3 RENAME TO managed_web_services;
`)
	return err
}

func migrateRegistryToV2(tx *sql.Tx) error {
	if err := verifyRegistryV1Source(tx); err != nil {
		return err
	}
	_, err := tx.Exec(`
CREATE TABLE managed_web_services (
  service_id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL UNIQUE,
  deployment TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  version TEXT NOT NULL,
  desired_state TEXT NOT NULL,
  observed_state TEXT NOT NULL,
  forward_id TEXT NOT NULL UNIQUE REFERENCES port_forwards(forward_id) ON DELETE RESTRICT,
  runtime_identity TEXT NOT NULL DEFAULT '',
  runtime_port INTEGER NOT NULL DEFAULT 0,
  artifact_reference TEXT NOT NULL DEFAULT '',
  last_error_code TEXT NOT NULL DEFAULT '',
  last_error_message TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
CREATE TABLE managed_web_service_operations (
  operation_id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  action TEXT NOT NULL,
  delete_data INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  stage TEXT NOT NULL,
  progress_current INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  finished_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
`)
	return err
}

func verifyRegistryV1Source(tx *sql.Tx) error {
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	if !slices.Equal(tables, []string{"port_forwards"}) {
		return fmt.Errorf("port forward registry v1 table set mismatch: got %v", tables)
	}
	columns, err := sqliteutil.TableColumnNamesTx(tx, "port_forwards")
	if err != nil {
		return err
	}
	want := []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms"}
	if !slices.Equal(columns, want) {
		return fmt.Errorf("port forward registry v1 column mismatch: got %v, want %v", columns, want)
	}
	return verifyNoRegistryIndexes(tx, "v1")
}

func verifyRegistryV2Source(tx *sql.Tx) error {
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	if !slices.Equal(tables, []string{"managed_web_service_operations", "managed_web_services", "port_forwards"}) {
		return fmt.Errorf("port forward registry v2 table set mismatch: got %v", tables)
	}
	expected := map[string][]string{
		"port_forwards":                  {"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms"},
		"managed_web_services":           {"service_id", "template_id", "deployment", "workspace_path", "version", "desired_state", "observed_state", "forward_id", "runtime_identity", "runtime_port", "artifact_reference", "last_error_code", "last_error_message", "created_at_unix_ms", "updated_at_unix_ms"},
		"managed_web_service_operations": {"operation_id", "service_id", "request_id", "request_fingerprint", "action", "delete_data", "state", "stage", "progress_current", "progress_total", "cancel_requested", "error_code", "error_message", "created_at_unix_ms", "updated_at_unix_ms", "finished_at_unix_ms"},
	}
	for table, want := range expected {
		columns, err := sqliteutil.TableColumnNamesTx(tx, table)
		if err != nil {
			return err
		}
		if !slices.Equal(columns, want) {
			return fmt.Errorf("port forward registry v2 %s column mismatch: got %v, want %v", table, columns, want)
		}
	}
	return verifyNoRegistryIndexes(tx, "v2")
}

func verifyNoRegistryIndexes(tx *sql.Tx, version string) error {
	indexes, err := sqliteutil.ListUserIndexesTx(tx)
	if err != nil {
		return err
	}
	if len(indexes) != 0 {
		return fmt.Errorf("port forward registry %s has unexpected indexes %v", version, indexes)
	}
	return nil
}

func migrateRegistryToV1(tx *sql.Tx) error {
	_, err := tx.Exec(`
	CREATE TABLE port_forwards (
  forward_id TEXT PRIMARY KEY,
  target_url TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  health_path TEXT NOT NULL DEFAULT '',
  insecure_skip_verify INTEGER NOT NULL DEFAULT 0,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  last_opened_at_unix_ms INTEGER NOT NULL
);
`)
	return err
}

func verifyRegistrySchema(tx *sql.Tx) error {
	if err := verifyRegistryShape(tx, []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms", "access_mode"}, "v4"); err != nil {
		return err
	}
	if err := verifyRegistryAccessModeColumn(tx); err != nil {
		return err
	}
	var invalid int
	if err := tx.QueryRow(`SELECT COUNT(1) FROM port_forwards WHERE access_mode NOT IN ('unified_proxy','desktop_loopback')`).Scan(&invalid); err != nil {
		return err
	}
	if invalid != 0 {
		return fmt.Errorf("port forward registry has %d invalid access modes", invalid)
	}
	return nil
}

func verifyRegistryAccessModeColumn(tx *sql.Tx) error {
	rows, err := tx.Query(`PRAGMA table_info(port_forwards)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	found := false
	for rows.Next() {
		var (
			cid          int
			name         string
			columnType   string
			notNull      int
			defaultValue any
			primaryKey   int
		)
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		if name != "access_mode" {
			continue
		}
		defaultText, ok := defaultValue.(string)
		if !ok || strings.ToUpper(strings.TrimSpace(columnType)) != "TEXT" || notNull != 1 || primaryKey != 0 || defaultText != "'unified_proxy'" {
			return fmt.Errorf("port forward registry v4 access_mode definition mismatch")
		}
		found = true
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("port forward registry v4 access_mode definition is missing")
	}
	var createSQL string
	if err := tx.QueryRow(`SELECT sql FROM sqlite_master WHERE type='table' AND name='port_forwards'`).Scan(&createSQL); err != nil {
		return err
	}
	normalized := strings.ToLower(strings.Join(strings.Fields(createSQL), ""))
	if !strings.Contains(normalized, "check(access_modein('unified_proxy','desktop_loopback'))") {
		return fmt.Errorf("port forward registry v4 access_mode constraint mismatch")
	}
	return nil
}

func verifyRegistryShape(tx *sql.Tx, expectedColumns []string, version string) error {
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	if !slices.Equal(tables, []string{"managed_web_service_operations", "managed_web_service_template_requests", "managed_web_service_templates", "managed_web_services", "port_forwards"}) {
		return fmt.Errorf("port forward registry table set mismatch: got %v", tables)
	}
	columns, err := sqliteutil.TableColumnNamesTx(tx, "port_forwards")
	if err != nil {
		return err
	}
	if !slices.Equal(columns, expectedColumns) {
		return fmt.Errorf("port forward registry %s column mismatch: got %v, want %v", version, columns, expectedColumns)
	}
	templateColumns := []string{"template_id", "name", "description", "source", "deployment", "version", "revision", "spec_json", "spec_sha256", "derived_from_template_id", "derived_from_revision", "service_family_id", "created_at_unix_ms", "updated_at_unix_ms"}
	columns, err = sqliteutil.TableColumnNamesTx(tx, "managed_web_service_templates")
	if err != nil {
		return err
	}
	if !slices.Equal(columns, templateColumns) {
		return fmt.Errorf("managed Web Service template column mismatch: got %v, want %v", columns, templateColumns)
	}
	templateRequestColumns := []string{"request_id", "request_fingerprint", "template_id", "action", "created_at_unix_ms"}
	columns, err = sqliteutil.TableColumnNamesTx(tx, "managed_web_service_template_requests")
	if err != nil {
		return err
	}
	if !slices.Equal(columns, templateRequestColumns) {
		return fmt.Errorf("managed Web Service template request column mismatch: got %v, want %v", columns, templateRequestColumns)
	}
	managedServiceColumns := []string{"service_id", "template_id", "template_source", "template_revision", "template_snapshot_json", "template_snapshot_sha256", "service_family_id", "deployment", "workspace_path", "configuration_json", "version", "desired_state", "observed_state", "forward_id", "runtime_identity", "runtime_manifest_json", "runtime_port", "artifact_reference", "last_error_code", "last_error_message", "created_at_unix_ms", "updated_at_unix_ms"}
	columns, err = sqliteutil.TableColumnNamesTx(tx, "managed_web_services")
	if err != nil {
		return err
	}
	if !slices.Equal(columns, managedServiceColumns) {
		return fmt.Errorf("managed web service column mismatch: got %v, want %v", columns, managedServiceColumns)
	}
	operationColumns := []string{"operation_id", "service_id", "request_id", "request_fingerprint", "action", "delete_data", "state", "stage", "progress_current", "progress_total", "cancel_requested", "error_code", "error_message", "created_at_unix_ms", "updated_at_unix_ms", "finished_at_unix_ms"}
	columns, err = sqliteutil.TableColumnNamesTx(tx, "managed_web_service_operations")
	if err != nil {
		return err
	}
	if !slices.Equal(columns, operationColumns) {
		return fmt.Errorf("managed web service operation column mismatch: got %v, want %v", columns, operationColumns)
	}
	indexes, err := sqliteutil.ListUserIndexesTx(tx)
	if err != nil {
		return err
	}
	if len(indexes) != 0 {
		return fmt.Errorf("port forward registry %s has unexpected indexes %v", version, indexes)
	}
	return nil
}
