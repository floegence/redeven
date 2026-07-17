package threadstore

import (
	"database/sql"
	"fmt"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	threadstoreSchemaKind           = "ai_threadstore_product_v2"
	threadstoreCurrentSchemaVersion = 1
)

// CurrentSchemaVersion returns the product-only threadstore schema version.
func CurrentSchemaVersion() int {
	return threadstoreCurrentSchemaVersion
}

func initSchema(db *sql.DB) error {
	return sqliteutil.EnsureSchema(db, threadstoreSchemaSpec())
}

func threadstoreSchemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           threadstoreSchemaKind,
		CurrentVersion: threadstoreCurrentSchemaVersion,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA auto_vacuum=INCREMENTAL;`},
		Migrations:     []sqliteutil.Migration{{FromVersion: 0, ToVersion: 1, Apply: createThreadstoreSchema}},
		Verify:         verifyThreadstoreSchema,
	}
}

func createThreadstoreSchema(tx *sql.Tx) error {
	if _, err := tx.Exec(`
CREATE TABLE ai_threads (
  thread_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  namespace_public_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  reasoning_selection_json TEXT NOT NULL DEFAULT '',
  permission_type TEXT NOT NULL DEFAULT 'approval_required',
  working_dir TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  title_source TEXT NOT NULL DEFAULT '',
  title_generated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  title_input_message_id TEXT NOT NULL DEFAULT '',
  title_model_id TEXT NOT NULL DEFAULT '',
  title_prompt_version TEXT NOT NULL DEFAULT '',
  followups_revision INTEGER NOT NULL DEFAULT 0,
  pinned_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  created_by_user_public_id TEXT NOT NULL DEFAULT '',
  created_by_user_email TEXT NOT NULL DEFAULT '',
  updated_by_user_public_id TEXT NOT NULL DEFAULT '',
  updated_by_user_email TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX idx_ai_threads_endpoint_updated ON ai_threads(endpoint_id, updated_at_unix_ms DESC, thread_id DESC);
CREATE INDEX idx_ai_threads_endpoint_pinned_created ON ai_threads(endpoint_id, pinned_at_unix_ms DESC, created_at_unix_ms DESC, thread_id ASC);
`); err != nil {
		return err
	}
	builders := []func(*sql.Tx) error{
		ensurePendingTurnCommandsTableTx,
		ensureProviderCapabilitiesTableTx,
		ensureUploadTablesTx,
		ensureFlowerTransferHandoffTablesTx,
		ensurePermissionSnapshotTablesTx,
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

func ensurePendingTurnCommandsTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_queued_turns (
  queue_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  channel_id TEXT NOT NULL DEFAULT '',
  lane TEXT NOT NULL DEFAULT 'queued',
  sort_index INTEGER NOT NULL DEFAULT 0,
  turn_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
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
  UNIQUE(endpoint_id, thread_id, turn_id),
  UNIQUE(run_id)
);
CREATE INDEX idx_ai_queued_turns_thread_created ON ai_queued_turns(endpoint_id, thread_id, created_at_unix_ms ASC, queue_id ASC);
CREATE INDEX idx_ai_queued_turns_thread_lane_sort ON ai_queued_turns(endpoint_id, thread_id, lane, sort_index ASC, queue_id ASC);
`)
	return err
}

func ensureProviderCapabilitiesTableTx(tx *sql.Tx) error {
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

func ensureUploadTablesTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_uploads (
  upload_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  storage_relpath TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'staged',
  created_at_unix_ms INTEGER NOT NULL,
  claimed_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  delete_after_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_ai_uploads_endpoint_created ON ai_uploads(endpoint_id, created_at_unix_ms DESC, upload_id DESC);
CREATE INDEX idx_ai_uploads_state_delete_after ON ai_uploads(endpoint_id, state, delete_after_unix_ms, created_at_unix_ms);
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

func ensureFlowerTransferHandoffTablesTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_flower_thread_metadata (
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  owner_kind TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL DEFAULT '',
  parent_thread_id TEXT NOT NULL DEFAULT '',
  parent_run_id TEXT NOT NULL DEFAULT '',
  context_json TEXT NOT NULL DEFAULT '{}',
  action_json TEXT NOT NULL DEFAULT '{}',
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  home_runtime_id TEXT NOT NULL DEFAULT '',
  home_runtime_kind TEXT NOT NULL DEFAULT '',
  origin_env_public_id TEXT NOT NULL DEFAULT '',
  primary_target_id TEXT NOT NULL DEFAULT '',
  active_target_ids_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY(endpoint_id, thread_id)
);
CREATE INDEX idx_ai_flower_thread_metadata_owner ON ai_flower_thread_metadata(endpoint_id, owner_kind, owner_id);
CREATE INDEX idx_ai_flower_thread_metadata_parent ON ai_flower_thread_metadata(endpoint_id, parent_thread_id, parent_run_id);
CREATE TABLE ai_flower_transfers (
  transfer_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  source_thread_id TEXT NOT NULL DEFAULT '',
  destination_thread_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  manifest_hash TEXT NOT NULL DEFAULT '',
  approval_hash TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'planned',
  plan_json TEXT NOT NULL DEFAULT '{}',
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_ai_flower_transfers_idempotency ON ai_flower_transfers(endpoint_id, idempotency_key);
CREATE INDEX idx_ai_flower_transfers_source ON ai_flower_transfers(endpoint_id, source_thread_id, updated_at_unix_ms DESC);
CREATE INDEX idx_ai_flower_transfers_destination ON ai_flower_transfers(endpoint_id, destination_thread_id, updated_at_unix_ms DESC);
CREATE TABLE ai_flower_handoffs (
  handoff_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  source_thread_id TEXT NOT NULL DEFAULT '',
  destination_thread_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  envelope_hash TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'created',
  envelope_json TEXT NOT NULL DEFAULT '{}',
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_ai_flower_handoffs_idempotency ON ai_flower_handoffs(endpoint_id, idempotency_key);
CREATE INDEX idx_ai_flower_handoffs_source ON ai_flower_handoffs(endpoint_id, source_thread_id, updated_at_unix_ms DESC);
CREATE INDEX idx_ai_flower_handoffs_destination ON ai_flower_handoffs(endpoint_id, destination_thread_id, updated_at_unix_ms DESC);
`)
	return err
}

func ensurePermissionSnapshotTablesTx(tx *sql.Tx) error {
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
  subagent_id TEXT NOT NULL DEFAULT '',
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

func createThreadForkOperationsTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_thread_fork_operations (
  operation_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  source_thread_id TEXT NOT NULL,
  destination_thread_id TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'committed', 'failed')),
  snapshot_schema_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  source_broadcasted_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  destination_broadcasted_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX idx_ai_thread_fork_operations_status_updated ON ai_thread_fork_operations(status, updated_at_unix_ms ASC, operation_id ASC);
CREATE INDEX idx_ai_thread_fork_operations_source ON ai_thread_fork_operations(endpoint_id, source_thread_id, created_at_unix_ms DESC);
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
  committed_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  UNIQUE(endpoint_id, thread_id)
);
CREATE INDEX idx_ai_thread_delete_operations_status_updated ON ai_thread_delete_operations(status, updated_at_unix_ms ASC, operation_id ASC);
CREATE TRIGGER trg_ai_threads_reject_retired_id
BEFORE INSERT ON ai_threads
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
	requiredTables := []string{
		"ai_threads", "ai_queued_turns", "provider_capabilities", "ai_uploads", "ai_upload_refs",
		"ai_flower_thread_metadata", "ai_flower_transfers", "ai_flower_handoffs",
		"ai_permission_snapshots", "ai_child_permission_snapshots",
		"ai_thread_fork_operations", "ai_thread_delete_operations",
	}
	for _, tableName := range requiredTables {
		exists, err := sqliteutil.TableExistsTx(tx, tableName)
		if err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("missing table %q", tableName)
		}
	}
	forbiddenTables := []string{
		"ai_messages", "ai_runs", "ai_tool_calls", "ai_run_events", "execution_spans",
		"ai_thread_state", "ai_thread_todos", "ai_thread_checkpoints",
		"transcript_messages", "conversation_turns", "memory_items", "memory_embeddings", "structured_user_inputs",
		"request_user_input_secret_answers", "ai_delegated_approval_requests", "ai_delegated_approval_events",
		"ai_delegated_approval_outbox", "ai_delegated_approval_idempotency",
	}
	for _, tableName := range forbiddenTables {
		exists, err := sqliteutil.TableExistsTx(tx, tableName)
		if err != nil {
			return err
		}
		if exists {
			return fmt.Errorf("unexpected agent shadow table %q", tableName)
		}
	}
	for _, column := range []string{
		"run_status", "run_updated_at_unix_ms", "run_error_code", "run_error", "waiting_user_input_json",
		"flower_activity_revision", "flower_activity_signature", "flower_activity_waiting_prompt_id",
		"last_message_at_unix_ms", "last_message_preview", "execution_mode",
	} {
		exists, err := sqliteutil.ColumnExistsTx(tx, "ai_threads", column)
		if err != nil {
			return err
		}
		if exists {
			return fmt.Errorf("unexpected agent shadow column ai_threads.%s", column)
		}
	}
	if exists, err := sqliteutil.ColumnExistsTx(tx, "ai_thread_fork_operations", "floret_result_json"); err != nil {
		return err
	} else if exists {
		return fmt.Errorf("unexpected Floret fork result shadow column ai_thread_fork_operations.floret_result_json")
	}
	expectedThreadColumns := map[string]struct{}{
		"thread_id": {}, "endpoint_id": {}, "namespace_public_id": {}, "model_id": {},
		"reasoning_selection_json": {}, "permission_type": {}, "working_dir": {}, "title": {},
		"title_source": {}, "title_generated_at_unix_ms": {}, "title_input_message_id": {},
		"title_model_id": {}, "title_prompt_version": {}, "followups_revision": {}, "pinned_at_unix_ms": {},
		"created_by_user_public_id": {}, "created_by_user_email": {}, "updated_by_user_public_id": {},
		"updated_by_user_email": {}, "created_at_unix_ms": {}, "updated_at_unix_ms": {},
	}
	rows, err := tx.Query(`PRAGMA table_info(ai_threads)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	seen := make(map[string]struct{}, len(expectedThreadColumns))
	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull, primaryKey int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		if _, ok := expectedThreadColumns[name]; !ok {
			return fmt.Errorf("unexpected column ai_threads.%s", name)
		}
		seen[name] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(seen) != len(expectedThreadColumns) {
		return fmt.Errorf("ai_threads column set mismatch: got %d, want %d", len(seen), len(expectedThreadColumns))
	}
	return nil
}
