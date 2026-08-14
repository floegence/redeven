package threadstore

import (
	"database/sql"
	"fmt"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	threadstoreSchemaKind           = "ai_threadstore_product_v1"
	threadstoreCurrentSchemaVersion = 2
)

// CurrentSchemaVersion returns the product-only threadstore schema version.
func CurrentSchemaVersion() int {
	return threadstoreCurrentSchemaVersion
}

func threadstoreSchemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           threadstoreSchemaKind,
		CurrentVersion: threadstoreCurrentSchemaVersion,
		MinimumVersion: 1,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA auto_vacuum=INCREMENTAL;`},
		Initialize:     createThreadstoreSchema,
		Migrations: []sqliteutil.Migration{
			{FromVersion: 1, ToVersion: 2, Apply: migrateThreadstoreV1ToV2},
		},
		Verify: verifyThreadstoreSchema,
	}
}

func createThreadstoreSchema(tx *sql.Tx) error {
	if _, err := tx.Exec(`
CREATE TABLE ai_thread_settings (
  thread_id TEXT PRIMARY KEY,
  parent_thread_id TEXT NOT NULL DEFAULT '',
  endpoint_id TEXT NOT NULL,
  namespace_public_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  reasoning_selection_json TEXT NOT NULL DEFAULT '',
  permission_type TEXT NOT NULL DEFAULT 'approval_required',
  working_dir TEXT NOT NULL DEFAULT '',
  pinned_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  created_by_user_public_id TEXT NOT NULL DEFAULT '',
  created_by_user_email TEXT NOT NULL DEFAULT '',
  updated_by_user_public_id TEXT NOT NULL DEFAULT '',
  updated_by_user_email TEXT NOT NULL DEFAULT '',
  settings_created_at_unix_ms INTEGER NOT NULL,
  settings_updated_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX idx_ai_thread_settings_endpoint_updated ON ai_thread_settings(endpoint_id, settings_updated_at_unix_ms DESC, thread_id DESC);
CREATE INDEX idx_ai_thread_settings_endpoint_pinned_created ON ai_thread_settings(endpoint_id, pinned_at_unix_ms DESC, settings_created_at_unix_ms DESC, thread_id ASC);
`); err != nil {
		return err
	}
	builders := []func(*sql.Tx) error{
		createPendingInputImportsTableTx,
		createProviderCapabilitiesTableTx,
		createUploadTablesTx,
		createUploadStagingScopesTableTx,
		createFlowerThreadRoutingTableTx,
	}
	for _, build := range builders {
		if err := build(tx); err != nil {
			return err
		}
	}
	return nil
}

func createPendingInputImportsTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_pending_input_imports (
  request_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT '',
  text_content TEXT NOT NULL DEFAULT '',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  context_action_json TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '{}',
  session_meta_json TEXT NOT NULL DEFAULT '{}',
  created_at_unix_ms INTEGER NOT NULL,
  imported_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_ai_pending_input_imports_pending ON ai_pending_input_imports(imported_at_unix_ms, endpoint_id, thread_id, created_at_unix_ms, request_id);
`)
	return err
}

func migrateThreadstoreV1ToV2(tx *sql.Tx) error {
	if err := createPendingInputImportsTableTx(tx); err != nil {
		return err
	}
	if _, err := tx.Exec(`
ALTER TABLE ai_thread_settings ADD COLUMN parent_thread_id TEXT NOT NULL DEFAULT '';
INSERT INTO ai_pending_input_imports(
  request_id, endpoint_id, thread_id, model_id, text_content, attachments_json,
  context_action_json, options_json, session_meta_json, created_at_unix_ms
)
SELECT queue_id, endpoint_id, thread_id, model_id, text_content, attachments_json,
       context_action_json, options_json, session_meta_json, created_at_unix_ms
FROM ai_queued_turns
ORDER BY endpoint_id, thread_id, created_at_unix_ms, queue_id;
DROP TRIGGER IF EXISTS trg_ai_thread_settings_reject_retired_id;
DROP TABLE ai_turn_admission_receipts;
DROP TABLE ai_queued_turns;
DROP TABLE ai_thread_create_operations;
DROP TABLE ai_thread_fork_operations;
DROP TABLE ai_thread_delete_operations;
DROP TABLE ai_subagent_publication_operations;
DROP TABLE ai_child_permission_snapshots;
DROP TABLE ai_permission_snapshots;
ALTER TABLE ai_thread_settings DROP COLUMN queue_revision;
`); err != nil {
		return err
	}
	return verifyProductSchemaVersion(tx, 2)
}

func createProviderCapabilitiesTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE provider_capabilities (
  provider_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  capability_json TEXT NOT NULL DEFAULT '{}',
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(provider_id, model_name)
);
`)
	return err
}

func createUploadTablesTx(tx *sql.Tx) error {
	if err := createUploadResourcesTx(tx); err != nil {
		return err
	}
	_, err := tx.Exec(`
CREATE TABLE ai_upload_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  ref_kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_ai_upload_refs_unique_ref ON ai_upload_refs(endpoint_id, upload_id, ref_kind, ref_id);
CREATE INDEX idx_ai_upload_refs_thread_upload ON ai_upload_refs(endpoint_id, thread_id, upload_id);
CREATE INDEX idx_ai_upload_refs_upload ON ai_upload_refs(endpoint_id, upload_id);
`)
	return err
}

func createUploadStagingScopesTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_upload_staging_scopes (
  staging_scope_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  owner_user_hash TEXT NOT NULL CHECK(length(owner_user_hash) = 64),
  target_id TEXT NOT NULL,
  capability_hash TEXT NOT NULL CHECK(length(capability_hash) = 64),
  created_at_unix_ms INTEGER NOT NULL,
  expires_at_unix_ms INTEGER NOT NULL,
  released_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_ai_upload_staging_scopes_expiry ON ai_upload_staging_scopes(expires_at_unix_ms, staging_scope_id);
CREATE UNIQUE INDEX idx_ai_upload_staging_scopes_capability ON ai_upload_staging_scopes(capability_hash);
`)
	return err
}

func createUploadResourcesTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_uploads (
  upload_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  owner_scope_kind TEXT NOT NULL CHECK(owner_scope_kind = 'user'),
  owner_user_hash TEXT NOT NULL CHECK(length(owner_user_hash) = 64),
  storage_relpath TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  declared_media_type TEXT NOT NULL DEFAULT '',
  detected_media_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0 CHECK(size_bytes >= 0),
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
  unicode_code_points INTEGER CHECK(unicode_code_points IS NULL OR unicode_code_points >= 0),
  logical_line_count INTEGER CHECK(logical_line_count IS NULL OR logical_line_count >= 0),
  source TEXT NOT NULL DEFAULT 'uploaded_file' CHECK(source IN ('uploaded_file', 'long_text')),
  state TEXT NOT NULL DEFAULT 'staged' CHECK(state IN ('staged', 'live', 'deleting')),
  created_at_unix_ms INTEGER NOT NULL,
  claimed_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  delete_after_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_ai_uploads_endpoint_owner_created ON ai_uploads(endpoint_id, owner_user_hash, created_at_unix_ms DESC, upload_id DESC);
CREATE INDEX idx_ai_uploads_state_delete_after ON ai_uploads(endpoint_id, state, delete_after_unix_ms, created_at_unix_ms);
CREATE TABLE ai_upload_attempts (
  endpoint_id TEXT NOT NULL,
  owner_user_hash TEXT NOT NULL,
  upload_request_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('receiving', 'complete', 'failed')),
  error_code TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY(endpoint_id, owner_user_hash, upload_request_id),
  UNIQUE(upload_id)
);
CREATE INDEX idx_ai_upload_attempts_status_updated ON ai_upload_attempts(status, updated_at_unix_ms, upload_id);
`)
	return err
}

func createFlowerThreadRoutingTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_flower_thread_routing (
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  home_runtime_id TEXT NOT NULL DEFAULT '',
  home_runtime_kind TEXT NOT NULL DEFAULT '',
  origin_env_public_id TEXT NOT NULL DEFAULT '',
  primary_target_id TEXT NOT NULL DEFAULT '',
  active_target_ids_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY(endpoint_id, thread_id)
);
`)
	return err
}

func verifyThreadstoreSchema(tx *sql.Tx) error {
	return verifyProductSchemaVersion(tx, threadstoreCurrentSchemaVersion)
}

func verifyProductSchemaVersion(tx *sql.Tx, version int) error {
	expected, err := reviewedProductSchemaContract(version)
	if err != nil {
		return err
	}
	actual, err := inspectReviewedSchemaTx(tx)
	if err != nil {
		return err
	}
	// Migration Apply functions verify their target shape before sqliteutil
	// advances PRAGMA user_version to the target version.
	actual.Version = version
	if err := compareReviewedSchemas(actual, expected); err != nil {
		return fmt.Errorf("product threadstore schema v%d contract mismatch: %w", version, err)
	}
	return nil
}
