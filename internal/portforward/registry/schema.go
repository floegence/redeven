package registry

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	registrySchemaKind           = "portforward_registry"
	registryCurrentSchemaVersion = 7
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
			{FromVersion: 4, ToVersion: 5, Apply: migrateRegistryToV5},
			{FromVersion: 5, ToVersion: 6, Apply: migrateRegistryToV6},
			{FromVersion: 6, ToVersion: 7, Apply: migrateRegistryToV7},
		},
		Verify: verifyRegistrySchema,
	}
}

func migrateRegistryToV7(tx *sql.Tx) error {
	if err := verifyRegistryShape(tx, []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms", "access_mode"}, "v6"); err != nil {
		return err
	}
	_, err := tx.Exec(`
UPDATE managed_web_services
SET service_family_id='deepseek-harness-host'
WHERE template_source='builtin'
  AND template_id='deepseek-harness-host'
  AND service_family_id='deepseek-harness';
UPDATE managed_web_services
SET service_family_id='deepseek-harness-container'
WHERE template_source='builtin'
  AND template_id='deepseek-harness-container'
  AND service_family_id='deepseek-harness';
`)
	return err
}

func migrateRegistryToV6(tx *sql.Tx) error {
	if err := verifyRegistryShape(tx, []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms", "access_mode"}, "v5"); err != nil {
		return err
	}
	_, err := tx.Exec(`
ALTER TABLE managed_web_service_operations
ADD COLUMN progress_detail_json TEXT NOT NULL DEFAULT '{"schema_version":1}';
`)
	return err
}

type legacyManagedServiceConfiguration struct {
	Parameters              map[string]string `json:"parameters,omitempty"`
	AcceptedNoticeRevisions map[string]int64  `json:"accepted_notice_revisions,omitempty"`
}

type managedServiceConfigurationV2 struct {
	SchemaVersion           int               `json:"schema_version"`
	Parameters              map[string]string `json:"parameters,omitempty"`
	AcceptedNoticeRevisions map[string]int64  `json:"accepted_notice_revisions,omitempty"`
}

func migrateRegistryToV5(tx *sql.Tx) error {
	if err := verifyRegistryShape(tx, []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms", "access_mode"}, "v4"); err != nil {
		return err
	}
	rows, err := tx.Query(`SELECT service_id, configuration_json FROM managed_web_services ORDER BY service_id`)
	if err != nil {
		return err
	}
	type migratedConfiguration struct{ serviceID, encoded, digest string }
	var migrated []migratedConfiguration
	for rows.Next() {
		var serviceID, raw string
		if err := rows.Scan(&serviceID, &raw); err != nil {
			_ = rows.Close()
			return err
		}
		legacy := legacyManagedServiceConfiguration{}
		if strings.TrimSpace(raw) != "" && strings.TrimSpace(raw) != "{}" {
			decoder := json.NewDecoder(strings.NewReader(raw))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&legacy); err != nil {
				_ = rows.Close()
				return fmt.Errorf("managed Web Service %s configuration migration: %w", serviceID, err)
			}
		}
		current := managedServiceConfigurationV2{SchemaVersion: 2, Parameters: legacy.Parameters, AcceptedNoticeRevisions: legacy.AcceptedNoticeRevisions}
		encoded, err := json.Marshal(current)
		if err != nil {
			_ = rows.Close()
			return err
		}
		sum := sha256.Sum256(encoded)
		migrated = append(migrated, migratedConfiguration{serviceID: serviceID, encoded: string(encoded), digest: hex.EncodeToString(sum[:])})
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if err := rows.Err(); err != nil {
		return err
	}
	serviceSpecs, err := migrateRegistryRuntimeSpecs(tx, `SELECT service_id, template_snapshot_json FROM managed_web_services ORDER BY service_id`)
	if err != nil {
		return err
	}
	templateSpecs, err := migrateRegistryRuntimeSpecs(tx, `SELECT template_id, spec_json FROM managed_web_service_templates ORDER BY template_id`)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`
ALTER TABLE managed_web_services ADD COLUMN configuration_revision INTEGER NOT NULL DEFAULT 1 CHECK(configuration_revision > 0);
ALTER TABLE managed_web_services ADD COLUMN configuration_sha256 TEXT NOT NULL DEFAULT '';
CREATE TABLE managed_web_service_resources (
  service_id TEXT NOT NULL REFERENCES managed_web_services(service_id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  engine_identity TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY(service_id, resource_id)
);
`); err != nil {
		return err
	}
	for _, item := range migrated {
		if _, err := tx.Exec(`UPDATE managed_web_services SET configuration_json=?, configuration_sha256=? WHERE service_id=?`, item.encoded, item.digest, item.serviceID); err != nil {
			return err
		}
	}
	for _, item := range serviceSpecs {
		if _, err := tx.Exec(`UPDATE managed_web_services SET template_snapshot_json=?, template_snapshot_sha256=? WHERE service_id=?`, item.encoded, item.digest, item.owner); err != nil {
			return err
		}
	}
	for _, item := range templateSpecs {
		if _, err := tx.Exec(`UPDATE managed_web_service_templates SET spec_json=?, spec_sha256=? WHERE template_id=?`, item.encoded, item.digest, item.owner); err != nil {
			return err
		}
	}
	return nil
}

type registryMigratedRuntimeSpec struct{ owner, encoded, digest string }

func migrateRegistryRuntimeSpecs(tx *sql.Tx, query string) ([]registryMigratedRuntimeSpec, error) {
	rows, err := tx.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []registryMigratedRuntimeSpec
	for rows.Next() {
		var owner, raw string
		if err := rows.Scan(&owner, &raw); err != nil {
			return nil, err
		}
		var document map[string]any
		if err := json.Unmarshal([]byte(raw), &document); err != nil {
			return nil, fmt.Errorf("managed Web Service %s runtime spec migration: %w", owner, err)
		}
		container, _ := document["container"].(map[string]any)
		for _, kind := range []string{"mounts", "ports", "devices"} {
			items, _ := container[kind].([]any)
			for index, rawItem := range items {
				item, ok := rawItem.(map[string]any)
				resourceID, hasResourceID := item["resource_id"].(string)
				if !ok || hasResourceID && strings.TrimSpace(resourceID) != "" {
					continue
				}
				canonical, err := json.Marshal(item)
				if err != nil {
					return nil, err
				}
				sum := sha256.Sum256([]byte(owner + "\n" + kind + "\n" + fmt.Sprint(index) + "\n" + string(canonical)))
				item["resource_id"] = "legacy-" + strings.TrimSuffix(kind, "s") + "-" + hex.EncodeToString(sum[:6])
			}
		}
		encoded, err := json.Marshal(document)
		if err != nil {
			return nil, err
		}
		sum := sha256.Sum256(encoded)
		result = append(result, registryMigratedRuntimeSpec{owner: owner, encoded: string(encoded), digest: hex.EncodeToString(sum[:])})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
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
	if err := verifyRegistryShape(tx, []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms", "access_mode"}, "v7"); err != nil {
		return err
	}
	if err := verifyRegistryAccessModeColumn(tx); err != nil {
		return err
	}
	if err := verifyRegistryProgressDetailColumn(tx); err != nil {
		return err
	}
	if err := verifyRegistryManagedDocumentDigests(tx); err != nil {
		return err
	}
	if err := verifyRegistryDeepSeekServiceFamilies(tx); err != nil {
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

func verifyRegistryDeepSeekServiceFamilies(tx *sql.Tx) error {
	var invalid int
	err := tx.QueryRow(`
SELECT COUNT(1)
FROM managed_web_services
WHERE template_source='builtin'
  AND ((template_id='deepseek-harness-host' AND service_family_id<>'deepseek-harness-host')
    OR (template_id='deepseek-harness-container' AND service_family_id<>'deepseek-harness-container'))
`).Scan(&invalid)
	if err != nil {
		return err
	}
	if invalid != 0 {
		return fmt.Errorf("managed Web Service registry has %d invalid DeepSeek Harness service families", invalid)
	}
	return nil
}

func verifyRegistryProgressDetailColumn(tx *sql.Tx) error {
	rows, err := tx.Query(`PRAGMA table_info(managed_web_service_operations)`)
	if err != nil {
		return err
	}
	found := false
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			return err
		}
		if name != "progress_detail_json" {
			continue
		}
		defaultText, ok := defaultValue.(string)
		if !ok || strings.ToUpper(strings.TrimSpace(columnType)) != "TEXT" || notNull != 1 || primaryKey != 0 || defaultText != `'{"schema_version":1}'` {
			_ = rows.Close()
			return fmt.Errorf("port forward registry v6 progress_detail_json definition mismatch")
		}
		found = true
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("port forward registry v6 progress_detail_json definition is missing")
	}
	detailRows, err := tx.Query(`SELECT operation_id, progress_detail_json FROM managed_web_service_operations ORDER BY operation_id`)
	if err != nil {
		return err
	}
	defer detailRows.Close()
	for detailRows.Next() {
		var operationID, raw string
		if err := detailRows.Scan(&operationID, &raw); err != nil {
			return err
		}
		if _, _, err := decodeManagedOperationProgressDetail(raw); err != nil {
			return fmt.Errorf("managed Web Service operation %s progress detail: %w", operationID, err)
		}
	}
	return detailRows.Err()
}

func verifyRegistryManagedDocumentDigests(tx *sql.Tx) error {
	templateRows, err := tx.Query(`SELECT template_id, spec_json, spec_sha256 FROM managed_web_service_templates ORDER BY template_id`)
	if err != nil {
		return err
	}
	for templateRows.Next() {
		var owner, raw, digest string
		if err := templateRows.Scan(&owner, &raw, &digest); err != nil {
			_ = templateRows.Close()
			return err
		}
		if err := verifyRegistryDocumentDigest("managed Web Service template", owner, raw, digest); err != nil {
			_ = templateRows.Close()
			return err
		}
	}
	if err := templateRows.Close(); err != nil {
		return err
	}
	if err := templateRows.Err(); err != nil {
		return err
	}

	serviceRows, err := tx.Query(`SELECT service_id, template_snapshot_json, template_snapshot_sha256, configuration_json, configuration_sha256 FROM managed_web_services ORDER BY service_id`)
	if err != nil {
		return err
	}
	defer serviceRows.Close()
	for serviceRows.Next() {
		var owner, snapshot, snapshotDigest, configuration, configurationDigest string
		if err := serviceRows.Scan(&owner, &snapshot, &snapshotDigest, &configuration, &configurationDigest); err != nil {
			return err
		}
		if snapshot != "" || snapshotDigest != "" {
			if err := verifyRegistryDocumentDigest("managed Web Service template snapshot", owner, snapshot, snapshotDigest); err != nil {
				return err
			}
		}
		if err := verifyRegistryDocumentDigest("managed Web Service configuration", owner, configuration, configurationDigest); err != nil {
			return err
		}
	}
	return serviceRows.Err()
}

func verifyRegistryDocumentDigest(kind, owner, raw, expected string) error {
	digest := sha256.Sum256([]byte(raw))
	actual := hex.EncodeToString(digest[:])
	if expected != actual {
		return fmt.Errorf("%s %s SHA-256 mismatch", kind, owner)
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
	expectedTables := []string{"managed_web_service_operations", "managed_web_service_template_requests", "managed_web_service_templates", "managed_web_services", "port_forwards"}
	if version == "v5" || version == "v6" || version == "v7" {
		expectedTables = []string{"managed_web_service_operations", "managed_web_service_resources", "managed_web_service_template_requests", "managed_web_service_templates", "managed_web_services", "port_forwards"}
	}
	if !slices.Equal(tables, expectedTables) {
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
	if version == "v5" || version == "v6" || version == "v7" {
		managedServiceColumns = append(managedServiceColumns, "configuration_revision", "configuration_sha256")
	}
	columns, err = sqliteutil.TableColumnNamesTx(tx, "managed_web_services")
	if err != nil {
		return err
	}
	if !slices.Equal(columns, managedServiceColumns) {
		return fmt.Errorf("managed web service column mismatch: got %v, want %v", columns, managedServiceColumns)
	}
	operationColumns := []string{"operation_id", "service_id", "request_id", "request_fingerprint", "action", "delete_data", "state", "stage", "progress_current", "progress_total", "cancel_requested", "error_code", "error_message", "created_at_unix_ms", "updated_at_unix_ms", "finished_at_unix_ms"}
	if version == "v6" || version == "v7" {
		operationColumns = append(operationColumns, "progress_detail_json")
	}
	columns, err = sqliteutil.TableColumnNamesTx(tx, "managed_web_service_operations")
	if err != nil {
		return err
	}
	if !slices.Equal(columns, operationColumns) {
		return fmt.Errorf("managed web service operation column mismatch: got %v, want %v", columns, operationColumns)
	}
	if version == "v5" || version == "v6" || version == "v7" {
		resourceColumns := []string{"service_id", "resource_id", "kind", "engine_identity", "created_at_unix_ms"}
		columns, err = sqliteutil.TableColumnNamesTx(tx, "managed_web_service_resources")
		if err != nil {
			return err
		}
		if !slices.Equal(columns, resourceColumns) {
			return fmt.Errorf("managed web service resource column mismatch: got %v, want %v", columns, resourceColumns)
		}
		var invalidConfiguration int
		if err := tx.QueryRow(`SELECT COUNT(1) FROM managed_web_services WHERE configuration_revision <= 0 OR length(configuration_sha256) <> 64`).Scan(&invalidConfiguration); err != nil {
			return err
		}
		if invalidConfiguration != 0 {
			return fmt.Errorf("managed Web Service registry has %d invalid configuration identities", invalidConfiguration)
		}
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
