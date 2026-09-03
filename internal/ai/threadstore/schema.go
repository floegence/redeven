package threadstore

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	threadstoreSchemaKind           = "ai_threadstore_product_v1"
	threadstoreMinimumSchemaVersion = 1
	threadstoreCurrentSchemaVersion = 6
)

// CurrentSchemaVersion returns the product-only threadstore schema version.
func CurrentSchemaVersion() int {
	return threadstoreCurrentSchemaVersion
}

func threadstoreSchemaSpec() sqliteutil.Spec {
	return threadstoreSchemaSpecWithPendingInputMigration(context.TODO(), nil)
}

func threadstoreSchemaSpecWithPendingInputMigration(ctx context.Context, migrate PendingInputMigrationHandler) sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:             threadstoreSchemaKind,
		CurrentVersion:   threadstoreCurrentSchemaVersion,
		MinimumVersion:   threadstoreMinimumSchemaVersion,
		Pragmas:          []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA auto_vacuum=INCREMENTAL;`},
		ValidateExisting: validateExistingThreadstore,
		Initialize:       createThreadstoreSchema,
		Migrations: []sqliteutil.Migration{
			{FromVersion: 1, ToVersion: 2, Apply: migrateThreadstoreV1ToV2},
			{FromVersion: 2, ToVersion: 3, Apply: migrateThreadstoreV2ToV3},
			{FromVersion: 3, ToVersion: 4, Apply: migrateThreadstoreV3ToV4},
			{FromVersion: 4, ToVersion: 5, Apply: func(tx *sql.Tx) error {
				return migrateThreadstoreV4ToV5(ctx, tx, migrate)
			}},
			{FromVersion: 5, ToVersion: 6, Apply: migrateThreadstoreV5ToV6},
		},
		Verify: verifyThreadstoreSchema,
	}
}

func validateExistingThreadstore(tx *sql.Tx) error {
	var version int
	if err := tx.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return fmt.Errorf("read threadstore preflight version: %w", err)
	}
	var metaTableCount int
	if err := tx.QueryRow("SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = '__redeven_db_meta'").Scan(&metaTableCount); err != nil {
		return fmt.Errorf("inspect threadstore metadata table: %w", err)
	}
	if metaTableCount != 1 {
		return &sqliteutil.WrongDatabaseKindError{ExpectedKind: threadstoreSchemaKind}
	}
	var kind string
	if err := tx.QueryRow("SELECT db_kind FROM __redeven_db_meta WHERE singleton = 1").Scan(&kind); err != nil {
		return fmt.Errorf("read threadstore database kind: %w", err)
	}
	kind = strings.TrimSpace(kind)
	if kind != threadstoreSchemaKind {
		return &sqliteutil.WrongDatabaseKindError{ExpectedKind: threadstoreSchemaKind, ActualKind: kind}
	}
	if version > threadstoreCurrentSchemaVersion {
		return &sqliteutil.DatabaseTooNewError{Kind: kind, Version: version, CurrentVersion: threadstoreCurrentSchemaVersion}
	}
	if version < threadstoreMinimumSchemaVersion {
		return &sqliteutil.DatabaseTooOldError{Kind: kind, Version: version, MinimumVersion: threadstoreMinimumSchemaVersion}
	}
	expected, err := reviewedProductSchemaContract(version)
	if err != nil {
		return err
	}
	actual, err := inspectReviewedSchemaTx(tx)
	if err != nil {
		return fmt.Errorf("inspect threadstore reviewed schema: %w", err)
	}
	if err := compareReviewedSchemas(actual, expected); err != nil {
		return &sqliteutil.SchemaVerifyError{Kind: threadstoreSchemaKind, Err: err}
	}
	return nil
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
  settings_created_at_unix_ms INTEGER NOT NULL,
  settings_updated_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX idx_ai_thread_settings_endpoint_updated ON ai_thread_settings(endpoint_id, settings_updated_at_unix_ms DESC, thread_id DESC);
CREATE INDEX idx_ai_thread_settings_endpoint_pinned_created ON ai_thread_settings(endpoint_id, pinned_at_unix_ms DESC, settings_created_at_unix_ms DESC, thread_id ASC);
`); err != nil {
		return err
	}
	builders := []func(*sql.Tx) error{
		createUploadTablesTx,
		createUploadStagingScopesTableTx,
		createFlowerExecutionAuthorityTableTx,
	}
	for _, build := range builders {
		if err := build(tx); err != nil {
			return err
		}
	}
	return nil
}

func createThreadDeleteAuthorityTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_thread_delete_authority (
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  deleted_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY(endpoint_id, thread_id)
);
`)
	return err
}

func createFlowerExecutionAuthorityTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_flower_execution_authority (
  request_key TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL DEFAULT '',
  endpoint_id TEXT NOT NULL,
  namespace_public_id TEXT NOT NULL DEFAULT '',
  channel_id TEXT NOT NULL DEFAULT '',
  user_public_id TEXT NOT NULL,
  user_email TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX idx_ai_flower_execution_authority_thread_turn ON ai_flower_execution_authority(thread_id, turn_id, created_at_unix_ms DESC);
CREATE INDEX idx_ai_flower_execution_authority_endpoint_thread ON ai_flower_execution_authority(endpoint_id, thread_id, created_at_unix_ms DESC);
`)
	return err
}

func migrateThreadstoreV2ToV3(tx *sql.Tx) error {
	if err := createFlowerExecutionAuthorityTableTx(tx); err != nil {
		return err
	}
	return verifyProductSchemaVersion(tx, 3)
}

func migrateThreadstoreV3ToV4(tx *sql.Tx) error {
	if err := createThreadDeleteAuthorityTableTx(tx); err != nil {
		return err
	}
	return verifyProductSchemaVersion(tx, 4)
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
INSERT INTO ai_pending_input_imports(
  request_id, endpoint_id, thread_id, model_id, text_content, attachments_json,
  context_action_json, options_json, session_meta_json, created_at_unix_ms
)
SELECT queue_id, endpoint_id, thread_id, model_id, text_content, attachments_json,
       context_action_json, options_json, session_meta_json, created_at_unix_ms
FROM ai_queued_turns
ORDER BY endpoint_id, thread_id, created_at_unix_ms, queue_id;
CREATE TEMP TABLE ai_thread_settings_v2 AS
SELECT thread_id, '' AS parent_thread_id, endpoint_id, namespace_public_id, model_id,
       reasoning_selection_json, permission_type, working_dir, pinned_at_unix_ms,
       created_by_user_public_id, created_by_user_email, updated_by_user_public_id,
       updated_by_user_email, settings_created_at_unix_ms, settings_updated_at_unix_ms
FROM ai_thread_settings;
DROP TRIGGER IF EXISTS trg_ai_thread_settings_reject_retired_id;
DROP TABLE ai_thread_settings;
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
INSERT INTO ai_thread_settings SELECT * FROM ai_thread_settings_v2;
DROP TABLE ai_thread_settings_v2;
CREATE INDEX idx_ai_thread_settings_endpoint_updated ON ai_thread_settings(endpoint_id, settings_updated_at_unix_ms DESC, thread_id DESC);
CREATE INDEX idx_ai_thread_settings_endpoint_pinned_created ON ai_thread_settings(endpoint_id, pinned_at_unix_ms DESC, settings_created_at_unix_ms DESC, thread_id ASC);
DROP TABLE ai_turn_admission_receipts;
DROP TABLE ai_queued_turns;
DROP TABLE ai_thread_create_operations;
DROP TABLE ai_thread_fork_operations;
DROP TABLE ai_thread_delete_operations;
DROP TABLE ai_subagent_publication_operations;
DROP TABLE ai_child_permission_snapshots;
DROP TABLE ai_permission_snapshots;
`); err != nil {
		return err
	}
	return verifyProductSchemaVersion(tx, 2)
}

func createUploadTablesTx(tx *sql.Tx) error {
	if err := createUploadResourcesTx(tx); err != nil {
		return err
	}
	_, err := tx.Exec(`
CREATE TABLE ai_upload_refs (
  endpoint_id TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  ref_kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  PRIMARY KEY(endpoint_id, upload_id, ref_kind, ref_id)
) WITHOUT ROWID;
CREATE INDEX idx_ai_upload_refs_target_upload ON ai_upload_refs(endpoint_id, target_id, upload_id);
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
  expires_at_unix_ms INTEGER NOT NULL
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
  owner_user_hash TEXT NOT NULL CHECK(length(owner_user_hash) = 64),
  storage_relpath TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  detected_media_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0 CHECK(size_bytes >= 0),
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
  unicode_code_points INTEGER CHECK(unicode_code_points IS NULL OR unicode_code_points >= 0),
  logical_line_count INTEGER CHECK(logical_line_count IS NULL OR logical_line_count >= 0),
  source TEXT NOT NULL DEFAULT 'uploaded_file' CHECK(source IN ('uploaded_file', 'long_text')),
  state TEXT NOT NULL DEFAULT 'staged' CHECK(state IN ('staged', 'live', 'deleting')),
  created_at_unix_ms INTEGER NOT NULL,
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

func migrateThreadstoreV5ToV6(tx *sql.Tx) error {
	if tx == nil {
		return fmt.Errorf("threadstore v5 to v6 migration transaction is unavailable")
	}
	nowUnixMs := time.Now().UnixMilli()
	rows, err := tx.Query(`
SELECT endpoint_id, owner_user_hash, staging_scope_id
FROM ai_upload_staging_scopes
WHERE released_at_unix_ms <> 0 OR expires_at_unix_ms <= ?
`, nowUnixMs)
	if err != nil {
		return err
	}
	type retiredScope struct {
		endpointID    string
		ownerUserHash string
		scopeID       string
	}
	var retired []retiredScope
	for rows.Next() {
		var scope retiredScope
		if err := rows.Scan(&scope.endpointID, &scope.ownerUserHash, &scope.scopeID); err != nil {
			_ = rows.Close()
			return err
		}
		retired = append(retired, scope)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, scope := range retired {
		refID := stagingUploadRefID(scope.ownerUserHash, scope.scopeID)
		if refID == "" {
			return fmt.Errorf("threadstore v5 contains malformed upload staging scope %q", scope.scopeID)
		}
		if _, err := tx.Exec(`DELETE FROM ai_upload_refs WHERE endpoint_id = ? AND ref_kind = ? AND ref_id = ?`, scope.endpointID, UploadRefKindStaging, refID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`
ALTER TABLE ai_thread_settings RENAME TO ai_thread_settings_v5;
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
  settings_created_at_unix_ms INTEGER NOT NULL,
  settings_updated_at_unix_ms INTEGER NOT NULL
);
INSERT INTO ai_thread_settings(
  thread_id, parent_thread_id, endpoint_id, namespace_public_id, model_id,
  reasoning_selection_json, permission_type, working_dir, pinned_at_unix_ms,
  settings_created_at_unix_ms, settings_updated_at_unix_ms
)
SELECT thread_id, parent_thread_id, endpoint_id, namespace_public_id, model_id,
       reasoning_selection_json, permission_type, working_dir, pinned_at_unix_ms,
       settings_created_at_unix_ms, settings_updated_at_unix_ms
FROM ai_thread_settings_v5;
DROP TABLE ai_thread_settings_v5;
CREATE INDEX idx_ai_thread_settings_endpoint_updated ON ai_thread_settings(endpoint_id, settings_updated_at_unix_ms DESC, thread_id DESC);
CREATE INDEX idx_ai_thread_settings_endpoint_pinned_created ON ai_thread_settings(endpoint_id, pinned_at_unix_ms DESC, settings_created_at_unix_ms DESC, thread_id ASC);

ALTER TABLE ai_uploads RENAME TO ai_uploads_v5;
CREATE TABLE ai_uploads (
  upload_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  owner_user_hash TEXT NOT NULL CHECK(length(owner_user_hash) = 64),
  storage_relpath TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  detected_media_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0 CHECK(size_bytes >= 0),
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
  unicode_code_points INTEGER CHECK(unicode_code_points IS NULL OR unicode_code_points >= 0),
  logical_line_count INTEGER CHECK(logical_line_count IS NULL OR logical_line_count >= 0),
  source TEXT NOT NULL DEFAULT 'uploaded_file' CHECK(source IN ('uploaded_file', 'long_text')),
  state TEXT NOT NULL DEFAULT 'staged' CHECK(state IN ('staged', 'live', 'deleting')),
  created_at_unix_ms INTEGER NOT NULL,
  delete_after_unix_ms INTEGER NOT NULL DEFAULT 0
);
INSERT INTO ai_uploads(
  upload_id, endpoint_id, owner_user_hash, storage_relpath, name,
  detected_media_type, size_bytes, content_sha256, unicode_code_points,
  logical_line_count, source, state, created_at_unix_ms, delete_after_unix_ms
)
SELECT upload_id, endpoint_id, owner_user_hash, storage_relpath, name,
       detected_media_type, size_bytes, content_sha256, unicode_code_points,
       logical_line_count, source, state, created_at_unix_ms, delete_after_unix_ms
FROM ai_uploads_v5;
DROP TABLE ai_uploads_v5;
CREATE INDEX idx_ai_uploads_endpoint_owner_created ON ai_uploads(endpoint_id, owner_user_hash, created_at_unix_ms DESC, upload_id DESC);
CREATE INDEX idx_ai_uploads_state_delete_after ON ai_uploads(endpoint_id, state, delete_after_unix_ms, created_at_unix_ms);

ALTER TABLE ai_upload_refs RENAME TO ai_upload_refs_v5;
CREATE TABLE ai_upload_refs (
  endpoint_id TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  ref_kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  PRIMARY KEY(endpoint_id, upload_id, ref_kind, ref_id)
) WITHOUT ROWID;
INSERT INTO ai_upload_refs(endpoint_id, upload_id, target_id, ref_kind, ref_id)
SELECT endpoint_id, upload_id, thread_id, ref_kind, ref_id
FROM ai_upload_refs_v5;
DROP TABLE ai_upload_refs_v5;
CREATE INDEX idx_ai_upload_refs_target_upload ON ai_upload_refs(endpoint_id, target_id, upload_id);

ALTER TABLE ai_upload_staging_scopes RENAME TO ai_upload_staging_scopes_v5;
CREATE TABLE ai_upload_staging_scopes (
  staging_scope_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  owner_user_hash TEXT NOT NULL CHECK(length(owner_user_hash) = 64),
  target_id TEXT NOT NULL,
  capability_hash TEXT NOT NULL CHECK(length(capability_hash) = 64),
  expires_at_unix_ms INTEGER NOT NULL
);
INSERT INTO ai_upload_staging_scopes(
  staging_scope_id, endpoint_id, owner_user_hash, target_id, capability_hash, expires_at_unix_ms
)
SELECT staging_scope_id, endpoint_id, owner_user_hash, target_id, capability_hash, expires_at_unix_ms
FROM ai_upload_staging_scopes_v5
WHERE released_at_unix_ms = 0 AND expires_at_unix_ms > ?;
DROP TABLE ai_upload_staging_scopes_v5;
CREATE INDEX idx_ai_upload_staging_scopes_expiry ON ai_upload_staging_scopes(expires_at_unix_ms, staging_scope_id);
CREATE UNIQUE INDEX idx_ai_upload_staging_scopes_capability ON ai_upload_staging_scopes(capability_hash);

DROP TABLE provider_capabilities;
DROP TABLE ai_flower_thread_routing;
DROP TABLE ai_thread_delete_authority;
`, nowUnixMs); err != nil {
		return err
	}
	return verifyProductSchemaVersion(tx, 6)
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
