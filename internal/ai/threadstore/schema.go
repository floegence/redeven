package threadstore

import (
	"database/sql"
	"fmt"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	threadstoreSchemaKind           = "ai_threadstore_product_v1"
	threadstoreCurrentSchemaVersion = 1
)

// CurrentSchemaVersion returns the product-only threadstore schema version.
func CurrentSchemaVersion() int {
	return threadstoreCurrentSchemaVersion
}

func threadstoreSchemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           threadstoreSchemaKind,
		CurrentVersion: threadstoreCurrentSchemaVersion,
		MinimumVersion: threadstoreCurrentSchemaVersion,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA auto_vacuum=INCREMENTAL;`},
		Initialize:     createThreadstoreSchema,
		Verify:         verifyThreadstoreSchema,
	}
}

func createThreadstoreSchema(tx *sql.Tx) error {
	if _, err := tx.Exec(`
CREATE TABLE ai_thread_settings (
  thread_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  namespace_public_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  reasoning_selection_json TEXT NOT NULL DEFAULT '',
  permission_type TEXT NOT NULL DEFAULT 'approval_required',
  working_dir TEXT NOT NULL DEFAULT '',
  pinned_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  queue_revision INTEGER NOT NULL DEFAULT 0,
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
		createPendingTurnCommandsTableTx,
		createProviderCapabilitiesTableTx,
		createUploadTablesTx,
		createUploadStagingScopesTableTx,
		createFlowerThreadRoutingTableTx,
		createPermissionSnapshotTablesTx,
		createSubAgentPublicationOperationsTableTx,
		createThreadCreateOperationsTableTx,
		createThreadForkOperationsTableTx,
		createThreadDeleteOperationsTableTx,
	}
	for _, build := range builders {
		if err := build(tx); err != nil {
			return err
		}
	}
	return nil
}

func createPendingTurnCommandsTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_queued_turns (
  queue_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  channel_id TEXT NOT NULL DEFAULT '',
  lane TEXT NOT NULL DEFAULT 'queued',
  sort_index INTEGER NOT NULL DEFAULT 0,
  turn_id TEXT NOT NULL DEFAULT '',
  run_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  text_content TEXT NOT NULL DEFAULT '',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  context_action_json TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '{}',
  session_meta_json TEXT NOT NULL DEFAULT '{}',
  created_by_user_public_id TEXT NOT NULL DEFAULT '',
  created_by_user_email TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  admission_state TEXT NOT NULL DEFAULT 'ready' CHECK(admission_state IN ('ready', 'in_flight'))
);
CREATE INDEX idx_ai_queued_turns_thread_created ON ai_queued_turns(endpoint_id, thread_id, created_at_unix_ms ASC, queue_id ASC);
CREATE INDEX idx_ai_queued_turns_thread_lane_sort ON ai_queued_turns(endpoint_id, thread_id, lane, sort_index ASC, queue_id ASC);
CREATE UNIQUE INDEX idx_ai_queued_turns_canonical_turn ON ai_queued_turns(endpoint_id, thread_id, turn_id) WHERE turn_id <> '';
CREATE UNIQUE INDEX idx_ai_queued_turns_canonical_run ON ai_queued_turns(run_id) WHERE run_id <> '';
CREATE TABLE ai_turn_admission_receipts (
  queue_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  logical_request_id TEXT NOT NULL,
  command_fingerprint TEXT NOT NULL CHECK(length(command_fingerprint) = 64),
  turn_id TEXT NOT NULL DEFAULT '',
  run_id TEXT NOT NULL DEFAULT '',
  entry_id TEXT NOT NULL DEFAULT '',
  permission_snapshot_id TEXT NOT NULL DEFAULT '',
  permission_snapshot_hash TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL CHECK(stage IN ('in_flight', 'settled')),
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  UNIQUE(endpoint_id, logical_request_id),
  CHECK((stage = 'in_flight' AND turn_id = '' AND run_id = '' AND entry_id = '' AND permission_snapshot_id = '' AND permission_snapshot_hash = '') OR
        (stage = 'settled' AND turn_id <> '' AND run_id <> '' AND entry_id <> '' AND permission_snapshot_id <> '' AND permission_snapshot_hash <> ''))
);
CREATE INDEX idx_ai_turn_admission_receipts_thread_stage ON ai_turn_admission_receipts(endpoint_id, thread_id, stage, updated_at_unix_ms);
CREATE UNIQUE INDEX idx_ai_turn_admission_receipts_turn ON ai_turn_admission_receipts(turn_id) WHERE turn_id <> '';
CREATE UNIQUE INDEX idx_ai_turn_admission_receipts_run ON ai_turn_admission_receipts(run_id) WHERE run_id <> '';
CREATE UNIQUE INDEX idx_ai_turn_admission_receipts_entry ON ai_turn_admission_receipts(entry_id) WHERE entry_id <> '';
`)
	return err
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

func createPermissionSnapshotTablesTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_permission_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  owner_thread_id TEXT NOT NULL DEFAULT '',
  owner_run_id TEXT NOT NULL DEFAULT '',
  permission_type TEXT NOT NULL DEFAULT 'approval_required',
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  snapshot_hash TEXT NOT NULL DEFAULT '',
  registry_hash TEXT NOT NULL DEFAULT '',
  schema_hash TEXT NOT NULL DEFAULT '',
  presentation_hash TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_ai_permission_snapshots_owner ON ai_permission_snapshots(endpoint_id, owner_thread_id, owner_run_id);
CREATE TABLE ai_child_permission_snapshots (
  child_snapshot_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  parent_snapshot_id TEXT NOT NULL DEFAULT '',
  spawn_tool_call_id TEXT NOT NULL DEFAULT '',
  parent_thread_id TEXT NOT NULL DEFAULT '',
  parent_run_id TEXT NOT NULL DEFAULT '',
  child_thread_id TEXT NOT NULL DEFAULT '',
  child_run_id TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'provisional',
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  snapshot_hash TEXT NOT NULL DEFAULT '',
  registry_hash TEXT NOT NULL DEFAULT '',
  schema_hash TEXT NOT NULL DEFAULT '',
  presentation_hash TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  finalized_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_ai_child_permission_snapshots_spawn ON ai_child_permission_snapshots(endpoint_id, spawn_tool_call_id);
CREATE INDEX idx_ai_child_permission_snapshots_parent ON ai_child_permission_snapshots(endpoint_id, parent_thread_id, parent_run_id);
CREATE INDEX idx_ai_child_permission_snapshots_child ON ai_child_permission_snapshots(endpoint_id, child_thread_id);
`)
	return err
}

func createSubAgentPublicationOperationsTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_subagent_publication_operations (
  publication_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  parent_thread_id TEXT NOT NULL,
  parent_turn_id TEXT NOT NULL,
  parent_run_id TEXT NOT NULL,
  parent_snapshot_id TEXT NOT NULL,
  spawn_tool_call_id TEXT NOT NULL,
  child_thread_id TEXT NOT NULL DEFAULT '',
  child_run_id TEXT NOT NULL DEFAULT '',
  child_snapshot_id TEXT NOT NULL DEFAULT '',
  request_json TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  session_meta_json TEXT NOT NULL,
  model_id TEXT NOT NULL,
  reasoning_selection_json TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK(state IN ('pending', 'committed', 'failed')),
  created_at_unix_ms INTEGER NOT NULL,
  committed_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  failed_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  CHECK((child_thread_id = '' AND child_run_id = '' AND child_snapshot_id = '') OR
        (child_thread_id <> '' AND child_run_id <> '' AND child_snapshot_id <> ''))
);
CREATE UNIQUE INDEX idx_ai_subagent_publication_spawn ON ai_subagent_publication_operations(endpoint_id, spawn_tool_call_id);
CREATE UNIQUE INDEX idx_ai_subagent_publication_child_thread ON ai_subagent_publication_operations(child_thread_id) WHERE child_thread_id <> '';
CREATE UNIQUE INDEX idx_ai_subagent_publication_child_run ON ai_subagent_publication_operations(child_run_id) WHERE child_run_id <> '';
CREATE UNIQUE INDEX idx_ai_subagent_publication_child_snapshot ON ai_subagent_publication_operations(child_snapshot_id) WHERE child_snapshot_id <> '';
CREATE INDEX idx_ai_subagent_publication_pending ON ai_subagent_publication_operations(state, created_at_unix_ms ASC, publication_id ASC);
`)
	return err
}

func createThreadForkOperationsTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_thread_fork_operations (
  operation_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  logical_request_id TEXT NOT NULL,
  title_logical_request_id TEXT NOT NULL,
  source_thread_id TEXT NOT NULL,
  destination_thread_id TEXT NOT NULL DEFAULT '',
  request_fingerprint TEXT NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('prepared', 'floret_forked', 'product_materialized', 'title_applied', 'title_skipped', 'completed', 'failed')),
  snapshot_schema_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  source_broadcasted_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  destination_broadcasted_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
, snapshot_fingerprint TEXT NOT NULL DEFAULT '');
CREATE INDEX idx_ai_thread_fork_operations_stage_updated ON ai_thread_fork_operations(stage, updated_at_unix_ms ASC, operation_id ASC);
CREATE INDEX idx_ai_thread_fork_operations_source ON ai_thread_fork_operations(endpoint_id, source_thread_id, created_at_unix_ms DESC);
CREATE UNIQUE INDEX idx_ai_thread_fork_operations_destination ON ai_thread_fork_operations(destination_thread_id) WHERE destination_thread_id <> '';
CREATE UNIQUE INDEX idx_ai_thread_fork_operations_client_request ON ai_thread_fork_operations(endpoint_id, client_request_id);
CREATE UNIQUE INDEX idx_ai_thread_fork_operations_logical_request ON ai_thread_fork_operations(logical_request_id);
`)
	return err
}

func createThreadCreateOperationsTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_thread_create_operations (
  operation_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  logical_request_id TEXT NOT NULL,
  title_logical_request_id TEXT NOT NULL,
  canonical_thread_id TEXT NOT NULL DEFAULT '',
  request_fingerprint TEXT NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('prepared', 'floret_created', 'product_materialized', 'title_applied', 'title_skipped', 'completed', 'failed')),
  snapshot_schema_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX idx_ai_thread_create_operations_stage_updated ON ai_thread_create_operations(stage, updated_at_unix_ms ASC, operation_id ASC);
CREATE UNIQUE INDEX idx_ai_thread_create_operations_client_request ON ai_thread_create_operations(endpoint_id, client_request_id);
CREATE UNIQUE INDEX idx_ai_thread_create_operations_logical_request ON ai_thread_create_operations(logical_request_id);
CREATE UNIQUE INDEX idx_ai_thread_create_operations_canonical_thread ON ai_thread_create_operations(canonical_thread_id) WHERE canonical_thread_id <> '';
`)
	return err
}

func createThreadDeleteOperationsTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_thread_delete_operations (
  operation_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'committed', 'failed')),
  snapshot_schema_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  read_state_required INTEGER NOT NULL DEFAULT 0 CHECK(read_state_required IN (0, 1)),
  product_data_deleted_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  files_cleaned_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  floret_deleted_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  read_state_deleted_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  committed_at_unix_ms INTEGER NOT NULL DEFAULT 0, snapshot_fingerprint TEXT NOT NULL DEFAULT '',
  UNIQUE(endpoint_id, thread_id)
);
CREATE INDEX idx_ai_thread_delete_operations_status_updated ON ai_thread_delete_operations(status, updated_at_unix_ms ASC, operation_id ASC);
CREATE TRIGGER trg_ai_thread_settings_reject_retired_id
BEFORE INSERT ON ai_thread_settings
WHEN EXISTS (
  SELECT 1 FROM ai_thread_delete_operations op
  WHERE op.endpoint_id = NEW.endpoint_id AND op.thread_id = NEW.thread_id
)
BEGIN
  SELECT RAISE(ABORT, 'thread id retired');
END;
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
