package registry

import "database/sql"

func migrateRegistryV3ToV4(tx *sql.Tx) error {
	if err := verifyRegistryV3(tx); err != nil {
		return err
	}
	if err := applyManagementSchema(tx); err != nil {
		return err
	}
	return verifyRegistryVersion(tx, 4)
}

// Rebuild only Redeven-owned tables in the surrounding atomic migration.
// Resource identities and all configuration documents retain their original bytes.
func applyManagementSchema(tx *sql.Tx) error {
	_, err := tx.Exec(`CREATE TEMP TABLE services_v3 AS SELECT * FROM managed_web_services;
CREATE TEMP TABLE resources_v3 AS SELECT * FROM managed_web_service_resources;
CREATE TEMP TABLE checks_v3 AS SELECT * FROM managed_web_service_release_checks;
DROP TABLE managed_web_service_resources;
DROP TABLE managed_web_service_release_checks;
DROP TABLE managed_web_services;
CREATE TABLE managed_web_services (
  service_id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  workspace_ownership TEXT NOT NULL
    CHECK(workspace_ownership IN ('pending','redeven_created','user_selected')),
  configuration_json TEXT NOT NULL,
  configuration_revision INTEGER NOT NULL CHECK(configuration_revision > 0),
  configuration_sha256 TEXT NOT NULL,
  release_identity_json TEXT NOT NULL,
  release_identity_sha256 TEXT NOT NULL,
  runtime_binding_json TEXT NOT NULL,
  runtime_binding_sha256 TEXT NOT NULL,
  desired_state TEXT NOT NULL,
  observed_state TEXT NOT NULL,
  forward_id TEXT UNIQUE REFERENCES port_forwards(forward_id) ON DELETE RESTRICT,
  runtime_identity TEXT NOT NULL DEFAULT '',
  runtime_spec_sha256 TEXT NOT NULL DEFAULT '',
  runtime_manifest_json TEXT NOT NULL DEFAULT '{}',
  runtime_port INTEGER NOT NULL DEFAULT 0,
  artifact_reference TEXT NOT NULL DEFAULT '',
  last_error_code TEXT NOT NULL DEFAULT '',
  last_error_message TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  management_state TEXT NOT NULL DEFAULT 'active' CHECK(management_state IN ('active','detached','uninstalled')),
  archived_forward_json TEXT NOT NULL DEFAULT '{}',
  CHECK((management_state='active' AND forward_id IS NOT NULL) OR (management_state<>'active' AND forward_id IS NULL))
);

CREATE TABLE managed_web_service_resources (
  service_id TEXT NOT NULL REFERENCES managed_web_services(service_id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  engine_identity TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  stable_identity TEXT NOT NULL DEFAULT '',
  ownership TEXT NOT NULL DEFAULT 'unverified' CHECK(ownership IN ('unverified','owned','external')),
  PRIMARY KEY(service_id, resource_id)
);

CREATE TABLE managed_web_service_release_checks (
  service_id TEXT PRIMARY KEY REFERENCES managed_web_services(service_id) ON DELETE CASCADE,
  summary_json TEXT NOT NULL,
  summary_sha256 TEXT NOT NULL,
  checked_at_unix_ms INTEGER NOT NULL,
  next_check_at_unix_ms INTEGER NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0 CHECK(stale IN (0,1)),
  last_error_code TEXT NOT NULL DEFAULT '',
  updated_at_unix_ms INTEGER NOT NULL
);

INSERT INTO managed_web_services(service_id,template_id,workspace_path,workspace_ownership,configuration_json,configuration_revision,configuration_sha256,release_identity_json,release_identity_sha256,runtime_binding_json,runtime_binding_sha256,desired_state,observed_state,forward_id,runtime_identity,runtime_spec_sha256,runtime_manifest_json,runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms) SELECT service_id,template_id,workspace_path,workspace_ownership,configuration_json,configuration_revision,configuration_sha256,release_identity_json,release_identity_sha256,runtime_binding_json,runtime_binding_sha256,desired_state,observed_state,forward_id,runtime_identity,runtime_spec_sha256,runtime_manifest_json,runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms FROM services_v3;
INSERT INTO managed_web_service_resources(service_id,resource_id,kind,engine_identity,created_at_unix_ms) SELECT * FROM resources_v3;
INSERT INTO managed_web_service_release_checks SELECT * FROM checks_v3;
DROP TABLE services_v3;
DROP TABLE resources_v3;
DROP TABLE checks_v3;
CREATE UNIQUE INDEX managed_web_services_active_template ON managed_web_services(template_id) WHERE management_state='active';
`)
	return err
}
