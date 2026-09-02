package registry

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	registrySchemaKind           = "portforward_registry_v1"
	registryCurrentSchemaVersion = 1
)

func registrySchemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           registrySchemaKind,
		CurrentVersion: registryCurrentSchemaVersion,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA foreign_keys=ON;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: initializeRegistryV1},
		},
		Verify: verifyRegistryV1,
	}
}

func initializeRegistryV1(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE port_forwards (
  forward_id TEXT PRIMARY KEY
    CHECK(length(forward_id) BETWEEN 1 AND 48
      AND forward_id NOT GLOB '*[^a-z0-9-]*'
      AND substr(forward_id, 1, 1) != '-'
      AND substr(forward_id, -1, 1) != '-'),
  target_url TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  health_path TEXT NOT NULL DEFAULT '',
  insecure_skip_verify INTEGER NOT NULL DEFAULT 0,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  last_opened_at_unix_ms INTEGER NOT NULL,
  access_mode TEXT NOT NULL DEFAULT 'unified_proxy'
    CHECK(access_mode IN ('unified_proxy','desktop_loopback'))
);

CREATE TABLE managed_web_service_templates (
  template_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  deployment TEXT NOT NULL CHECK(deployment IN ('host','container','compose')),
  version TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL CHECK(revision > 0),
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

CREATE TABLE managed_web_services (
  service_id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL UNIQUE,
  template_source TEXT NOT NULL,
  template_revision INTEGER NOT NULL CHECK(template_revision > 0),
  template_snapshot_json TEXT NOT NULL,
  template_snapshot_sha256 TEXT NOT NULL,
  service_family_id TEXT NOT NULL UNIQUE,
  deployment TEXT NOT NULL CHECK(deployment IN ('host','container','compose')),
  workspace_path TEXT NOT NULL,
  configuration_json TEXT NOT NULL,
  configuration_revision INTEGER NOT NULL CHECK(configuration_revision > 0),
  configuration_sha256 TEXT NOT NULL,
  release_identity_json TEXT NOT NULL,
  release_identity_sha256 TEXT NOT NULL,
  runtime_binding_json TEXT NOT NULL,
  runtime_binding_sha256 TEXT NOT NULL,
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

CREATE TABLE managed_web_service_resources (
  service_id TEXT NOT NULL REFERENCES managed_web_services(service_id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  engine_identity TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY(service_id, resource_id)
);

CREATE TABLE managed_web_service_operations (
  operation_id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  retry_of_operation_id TEXT NOT NULL DEFAULT '',
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
  finished_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  progress_detail_json TEXT NOT NULL DEFAULT '{"schema_version":1}'
);
`)
	return err
}

func verifyRegistryV1(tx *sql.Tx) error {
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	wantTables := []string{
		"managed_web_service_operations",
		"managed_web_service_resources",
		"managed_web_service_template_requests",
		"managed_web_service_templates",
		"managed_web_services",
		"port_forwards",
	}
	if !slices.Equal(tables, wantTables) {
		return fmt.Errorf("port forward registry v1 table mismatch: got %v, want %v", tables, wantTables)
	}
	wantColumns := map[string][]string{
		"port_forwards": {
			"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify",
			"created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms", "access_mode",
		},
		"managed_web_service_templates": {
			"template_id", "name", "description", "source", "deployment", "version", "revision", "spec_json",
			"spec_sha256", "derived_from_template_id", "derived_from_revision", "service_family_id",
			"created_at_unix_ms", "updated_at_unix_ms",
		},
		"managed_web_service_template_requests": {
			"request_id", "request_fingerprint", "template_id", "action", "created_at_unix_ms",
		},
		"managed_web_services": {
			"service_id", "template_id", "template_source", "template_revision", "template_snapshot_json",
			"template_snapshot_sha256", "service_family_id", "deployment", "workspace_path", "configuration_json",
			"configuration_revision", "configuration_sha256", "release_identity_json", "release_identity_sha256",
			"runtime_binding_json", "runtime_binding_sha256", "version", "desired_state", "observed_state", "forward_id",
			"runtime_identity", "runtime_manifest_json", "runtime_port", "artifact_reference", "last_error_code",
			"last_error_message", "created_at_unix_ms", "updated_at_unix_ms",
		},
		"managed_web_service_resources": {
			"service_id", "resource_id", "kind", "engine_identity", "created_at_unix_ms",
		},
		"managed_web_service_operations": {
			"operation_id", "service_id", "request_id", "request_fingerprint", "retry_of_operation_id", "action",
			"delete_data", "state", "stage", "progress_current", "progress_total", "cancel_requested", "error_code",
			"error_message", "created_at_unix_ms", "updated_at_unix_ms", "finished_at_unix_ms", "progress_detail_json",
		},
	}
	for table, want := range wantColumns {
		got, err := sqliteutil.TableColumnNamesTx(tx, table)
		if err != nil {
			return err
		}
		if !slices.Equal(got, want) {
			return fmt.Errorf("port forward registry v1 %s column mismatch: got %v, want %v", table, got, want)
		}
	}
	indexes, err := sqliteutil.ListUserIndexesTx(tx)
	if err != nil {
		return err
	}
	if len(indexes) != 0 {
		return fmt.Errorf("port forward registry v1 has unexpected indexes %v", indexes)
	}
	if err := verifyRegistryDocuments(tx); err != nil {
		return err
	}
	var invalid int
	if err := tx.QueryRow(`SELECT COUNT(1) FROM port_forwards WHERE access_mode NOT IN ('unified_proxy','desktop_loopback')`).Scan(&invalid); err != nil {
		return err
	}
	if invalid != 0 {
		return fmt.Errorf("port forward registry v1 has %d invalid access modes", invalid)
	}
	if err := tx.QueryRow(`SELECT COUNT(1) FROM port_forwards WHERE length(forward_id) NOT BETWEEN 1 AND 48 OR forward_id GLOB '*[^a-z0-9-]*' OR substr(forward_id,1,1)='-' OR substr(forward_id,-1,1)='-'`).Scan(&invalid); err != nil {
		return err
	}
	if invalid != 0 {
		return fmt.Errorf("port forward registry v1 has %d invalid forward identities", invalid)
	}
	return nil
}

func verifyRegistryDocuments(tx *sql.Tx) error {
	templateRows, err := tx.Query(`SELECT template_id,spec_json,spec_sha256 FROM managed_web_service_templates ORDER BY template_id`)
	if err != nil {
		return err
	}
	for templateRows.Next() {
		var owner, raw, digest string
		if err := templateRows.Scan(&owner, &raw, &digest); err != nil {
			_ = templateRows.Close()
			return err
		}
		if err := verifyDocumentDigest("template spec", owner, raw, digest); err != nil {
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

	serviceRows, err := tx.Query(`
SELECT service_id,deployment,
       template_snapshot_json,template_snapshot_sha256,
       configuration_json,configuration_sha256,
       release_identity_json,release_identity_sha256,
       runtime_binding_json,runtime_binding_sha256
FROM managed_web_services ORDER BY service_id`)
	if err != nil {
		return err
	}
	defer serviceRows.Close()
	for serviceRows.Next() {
		var owner, deployment string
		var documents [4][2]string
		if err := serviceRows.Scan(
			&owner, &deployment,
			&documents[0][0], &documents[0][1],
			&documents[1][0], &documents[1][1],
			&documents[2][0], &documents[2][1],
			&documents[3][0], &documents[3][1],
		); err != nil {
			return err
		}
		labels := []string{"template snapshot", "configuration", "release identity", "runtime binding"}
		for index := range documents {
			if err := verifyDocumentDigest(labels[index], owner, documents[index][0], documents[index][1]); err != nil {
				return err
			}
		}
		var binding struct {
			SchemaVersion int    `json:"schema_version"`
			Deployment    string `json:"deployment"`
			Host          any    `json:"host,omitempty"`
			Container     any    `json:"container,omitempty"`
			Compose       any    `json:"compose,omitempty"`
		}
		if err := decodeStrictRegistryJSON(documents[3][0], &binding); err != nil {
			return fmt.Errorf("runtime binding %s: %w", owner, err)
		}
		if binding.SchemaVersion != 1 || binding.Deployment != deployment {
			return fmt.Errorf("runtime binding %s does not match service deployment", owner)
		}
	}
	if err := serviceRows.Err(); err != nil {
		return err
	}

	operationRows, err := tx.Query(`SELECT operation_id,progress_detail_json FROM managed_web_service_operations ORDER BY operation_id`)
	if err != nil {
		return err
	}
	defer operationRows.Close()
	for operationRows.Next() {
		var operationID, raw string
		if err := operationRows.Scan(&operationID, &raw); err != nil {
			return err
		}
		if _, _, err := decodeManagedOperationProgressDetail(raw); err != nil {
			return fmt.Errorf("operation %s progress detail: %w", operationID, err)
		}
	}
	return operationRows.Err()
}

func verifyDocumentDigest(kind, owner, raw, expected string) error {
	sum := sha256.Sum256([]byte(raw))
	if actual := hex.EncodeToString(sum[:]); actual != strings.TrimSpace(expected) {
		return fmt.Errorf("managed Web Service %s %s SHA-256 mismatch", kind, owner)
	}
	return nil
}

func decodeStrictRegistryJSON(raw string, target any) error {
	decoder := json.NewDecoder(strings.NewReader(strings.TrimSpace(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}
