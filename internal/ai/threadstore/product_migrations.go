package threadstore

import (
	"database/sql"
	"fmt"
)

func createThreadForkOperationsTableV1Tx(tx *sql.Tx) error {
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
  floret_result_json TEXT NOT NULL DEFAULT '',
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

func migrateProductV1ToV2(tx *sql.Tx) error {
	if err := verifyProductV1Schema(tx); err != nil {
		return fmt.Errorf("verify product threadstore v1: %w", err)
	}
	if _, err := tx.Exec(`
DROP INDEX idx_ai_thread_fork_operations_status_updated;
DROP INDEX idx_ai_thread_fork_operations_source;
ALTER TABLE ai_thread_fork_operations RENAME TO product_v1_thread_fork_operations;
`); err != nil {
		return err
	}
	if err := createThreadForkOperationsTableTx(tx); err != nil {
		return err
	}
	if _, err := tx.Exec(`
INSERT INTO ai_thread_fork_operations(
  operation_id, endpoint_id, source_thread_id, destination_thread_id,
  request_fingerprint, status, snapshot_schema_version, snapshot_json,
  retry_count, error_code, error_message, source_broadcasted_at_unix_ms,
  destination_broadcasted_at_unix_ms, created_at_unix_ms, updated_at_unix_ms
)
SELECT
  operation_id, endpoint_id, source_thread_id, destination_thread_id,
  request_fingerprint, status, snapshot_schema_version, snapshot_json,
  retry_count, error_code, error_message, source_broadcasted_at_unix_ms,
  destination_broadcasted_at_unix_ms, created_at_unix_ms, updated_at_unix_ms
FROM product_v1_thread_fork_operations;
DROP TABLE product_v1_thread_fork_operations;
`); err != nil {
		return err
	}
	return nil
}

func verifyProductV1Schema(tx *sql.Tx) error {
	return verifyProductSchemaVersion(tx, 1)
}

func migrateProductV2ToV3(tx *sql.Tx) error {
	if err := verifyProductSchemaVersion(tx, 2); err != nil {
		return fmt.Errorf("verify product threadstore v2: %w", err)
	}
	if err := createThreadCreateOperationsTableTx(tx); err != nil {
		return err
	}
	if _, err := tx.Exec(`
DROP TRIGGER trg_ai_threads_reject_retired_id;
DROP INDEX idx_ai_threads_endpoint_updated;
DROP INDEX idx_ai_threads_endpoint_pinned_created;
ALTER TABLE ai_threads RENAME TO product_v2_ai_threads;

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
INSERT INTO ai_thread_settings(
  thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json,
  permission_type, working_dir, pinned_at_unix_ms, queue_revision,
  created_by_user_public_id, created_by_user_email, updated_by_user_public_id,
  updated_by_user_email, settings_created_at_unix_ms, settings_updated_at_unix_ms
)
SELECT
  thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json,
  permission_type, working_dir, pinned_at_unix_ms, followups_revision,
  created_by_user_public_id, created_by_user_email, updated_by_user_public_id,
  updated_by_user_email, created_at_unix_ms, updated_at_unix_ms
FROM product_v2_ai_threads;

DROP INDEX idx_ai_upload_refs_unique_ref;
DROP INDEX idx_ai_upload_refs_thread_upload;
DROP INDEX idx_ai_upload_refs_upload;
ALTER TABLE ai_upload_refs RENAME TO product_v2_ai_upload_refs;
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
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
SELECT endpoint_id, upload_id, thread_id,
       CASE WHEN ref_kind = 'queued_turn' THEN 'queued_turn' ELSE 'thread' END,
       CASE WHEN ref_kind = 'queued_turn' THEN ref_id ELSE thread_id END,
       MIN(created_at_unix_ms)
FROM product_v2_ai_upload_refs
GROUP BY endpoint_id, upload_id, thread_id,
         CASE WHEN ref_kind = 'queued_turn' THEN 'queued_turn' ELSE 'thread' END,
         CASE WHEN ref_kind = 'queued_turn' THEN ref_id ELSE thread_id END;

DELETE FROM ai_permission_snapshots
WHERE CASE
  WHEN json_valid(snapshot_json) THEN COALESCE(CAST(json_extract(snapshot_json, '$.version') AS INTEGER), 0)
  ELSE 0
END <> 2;

DROP INDEX idx_ai_child_permission_snapshots_spawn;
DROP INDEX idx_ai_child_permission_snapshots_parent;
DROP INDEX idx_ai_child_permission_snapshots_child;
ALTER TABLE ai_child_permission_snapshots RENAME TO product_v2_ai_child_permission_snapshots;
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
INSERT INTO ai_child_permission_snapshots(
  child_snapshot_id, endpoint_id, parent_snapshot_id, spawn_tool_call_id,
  parent_thread_id, parent_run_id, child_thread_id, child_run_id, state,
  snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash,
  created_at_unix_ms, finalized_at_unix_ms
)
SELECT
  child_snapshot_id, endpoint_id, parent_snapshot_id, spawn_tool_call_id,
  parent_thread_id, parent_run_id, child_thread_id, child_run_id, state,
  snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash,
  created_at_unix_ms, finalized_at_unix_ms
FROM product_v2_ai_child_permission_snapshots
WHERE CASE
  WHEN json_valid(snapshot_json) THEN COALESCE(CAST(json_extract(snapshot_json, '$.version') AS INTEGER), 0)
  ELSE 0
END = 2;

UPDATE ai_thread_fork_operations
SET snapshot_json = json_remove(
  snapshot_json,
  '$.source_thread.title',
  '$.source_thread.title_source',
  '$.source_thread.title_generated_at_unix_ms',
  '$.source_thread.title_input_message_id',
  '$.source_thread.title_model_id',
  '$.source_thread.title_prompt_version'
)
WHERE json_valid(snapshot_json);

CREATE TRIGGER trg_ai_thread_settings_reject_retired_id
BEFORE INSERT ON ai_thread_settings
WHEN EXISTS (
  SELECT 1 FROM ai_thread_delete_operations op
  WHERE op.endpoint_id = NEW.endpoint_id AND op.thread_id = NEW.thread_id
)
BEGIN
  SELECT RAISE(ABORT, 'thread id retired');
END;

DROP TABLE product_v2_ai_threads;
DROP TABLE product_v2_ai_upload_refs;
DROP TABLE product_v2_ai_child_permission_snapshots;
`); err != nil {
		return err
	}
	return nil
}
