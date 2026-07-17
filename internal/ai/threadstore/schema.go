package threadstore

import (
	"database/sql"
	"fmt"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	threadstoreSchemaKind           = "ai_threadstore_canonical"
	threadstoreCurrentSchemaVersion = 1
)

// CurrentSchemaVersion returns the latest threadstore schema version expected by migrations.
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
		LegacyMarkers:  nil,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA auto_vacuum=INCREMENTAL;`},
		Migrations:     []sqliteutil.Migration{{FromVersion: 0, ToVersion: 1, Apply: createThreadstoreSchema}},
		Verify:         verifyThreadstoreSchema,
	}
}

func createThreadstoreSchema(tx *sql.Tx) error {
	if _, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS ai_threads (
  thread_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  namespace_public_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  reasoning_selection_json TEXT NOT NULL DEFAULT '',
  execution_mode TEXT NOT NULL DEFAULT '',
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
  run_status TEXT NOT NULL DEFAULT 'idle',
  run_updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  run_error_code TEXT NOT NULL DEFAULT '',
  run_error TEXT NOT NULL DEFAULT '',
  waiting_user_input_json TEXT NOT NULL DEFAULT '',
  flower_activity_revision INTEGER NOT NULL DEFAULT 0,
  flower_activity_signature TEXT NOT NULL DEFAULT '',
  flower_activity_waiting_prompt_id TEXT NOT NULL DEFAULT '',
  created_by_user_public_id TEXT NOT NULL DEFAULT '',
  created_by_user_email TEXT NOT NULL DEFAULT '',
  updated_by_user_public_id TEXT NOT NULL DEFAULT '',
  updated_by_user_email TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  last_message_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_message_preview TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ai_threads_endpoint_updated ON ai_threads(endpoint_id, updated_at_unix_ms DESC, thread_id DESC);
CREATE INDEX IF NOT EXISTS idx_ai_threads_endpoint_pinned_created ON ai_threads(endpoint_id, pinned_at_unix_ms DESC, created_at_unix_ms DESC, thread_id ASC);
`); err != nil {
		return err
	}
	builders := []func(*sql.Tx) error{
		ensureRunStateTablesTx,
		ensureContextPlaneTablesTx,
		ensureThreadTodosTableTx,
		ensureThreadCheckpointsTableTx,
		ensureFollowupQueueBaseTx,
		ensureStructuredUserInputTablesTx,
		ensureRequestUserInputSecretAnswersTableTx,
		ensureUploadTablesTx,
		ensureFlowerTransferHandoffTablesTx,
		ensureDelegatedApprovalTablesTx,
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

func createThreadForkOperationsTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS ai_thread_fork_operations (
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
CREATE INDEX IF NOT EXISTS idx_ai_thread_fork_operations_status_updated
ON ai_thread_fork_operations(status, updated_at_unix_ms ASC, operation_id ASC);
CREATE INDEX IF NOT EXISTS idx_ai_thread_fork_operations_source
ON ai_thread_fork_operations(endpoint_id, source_thread_id, created_at_unix_ms DESC);
`)
	return err
}

func createThreadDeleteOperationsTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS ai_thread_delete_operations (
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
CREATE INDEX IF NOT EXISTS idx_ai_thread_delete_operations_status_updated
ON ai_thread_delete_operations(status, updated_at_unix_ms ASC, operation_id ASC);
CREATE TRIGGER IF NOT EXISTS trg_ai_threads_reject_retired_id
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

func ensureRunStateTablesTx(tx *sql.Tx) error {
	if _, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS ai_runs (
  run_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'accepted',
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  started_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  ended_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ai_runs_endpoint_thread_updated ON ai_runs(endpoint_id, thread_id, updated_at_unix_ms DESC);

CREATE TABLE IF NOT EXISTS ai_run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  stream_kind TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ai_run_events_run_id ON ai_run_events(run_id, id ASC);
CREATE INDEX IF NOT EXISTS idx_ai_run_events_endpoint_thread ON ai_run_events(endpoint_id, thread_id, id ASC);

CREATE TABLE IF NOT EXISTS ai_thread_state (
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  open_goal TEXT NOT NULL DEFAULT '',
  last_assistant_summary TEXT NOT NULL DEFAULT '',
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(endpoint_id, thread_id)
);
`); err != nil {
		return err
	}
	return nil
}

func ensureStructuredUserInputTablesTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS structured_user_inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  response_message_id TEXT NOT NULL,
  prompt_id TEXT NOT NULL DEFAULT '',
  tool_id TEXT NOT NULL DEFAULT '',
  reason_code TEXT NOT NULL DEFAULT '',
  question_id TEXT NOT NULL,
  header TEXT NOT NULL DEFAULT '',
  question_text TEXT NOT NULL DEFAULT '',
  selected_choice_id TEXT NOT NULL DEFAULT '',
  selected_choice_label TEXT NOT NULL DEFAULT '',
  response_text TEXT NOT NULL DEFAULT '',
  public_summary TEXT NOT NULL DEFAULT '',
  contains_secret INTEGER NOT NULL DEFAULT 0,
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  UNIQUE(endpoint_id, thread_id, response_message_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_structured_user_inputs_recent
ON structured_user_inputs(endpoint_id, thread_id, id DESC);
`)
	return err
}

func ensureRequestUserInputSecretAnswersTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS request_user_input_secret_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  response_message_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  answer_index INTEGER NOT NULL,
  answer_text TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  UNIQUE(endpoint_id, thread_id, response_message_id, question_id, answer_index)
);
CREATE INDEX IF NOT EXISTS idx_request_user_input_secret_answers_message
ON request_user_input_secret_answers(endpoint_id, thread_id, response_message_id, question_id, answer_index);
`)
	return err
}

func ensureContextPlaneTablesTx(tx *sql.Tx) error {
	if _, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS transcript_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  role TEXT NOT NULL,
  author_user_public_id TEXT NOT NULL DEFAULT '',
  author_user_email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  text_content TEXT NOT NULL DEFAULT '',
  message_json TEXT NOT NULL,
  UNIQUE(thread_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_transcript_messages_thread_id ON transcript_messages(endpoint_id, thread_id, id ASC);

CREATE TABLE IF NOT EXISTS conversation_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_id TEXT NOT NULL UNIQUE,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  run_id TEXT NOT NULL DEFAULT '',
  user_message_id TEXT NOT NULL DEFAULT '',
  assistant_message_id TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_conversation_turns_thread_id ON conversation_turns(endpoint_id, thread_id, id ASC);
CREATE INDEX IF NOT EXISTS idx_conversation_turns_run_id ON conversation_turns(run_id, id ASC);

CREATE TABLE IF NOT EXISTS memory_items (
  memory_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'episodic',
  kind TEXT NOT NULL DEFAULT 'fact',
  content TEXT NOT NULL DEFAULT '',
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  importance REAL NOT NULL DEFAULT 0.5,
  freshness REAL NOT NULL DEFAULT 0.5,
  confidence REAL NOT NULL DEFAULT 0.6,
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_memory_items_thread_updated ON memory_items(endpoint_id, thread_id, updated_at_unix_ms DESC, memory_id DESC);
CREATE INDEX IF NOT EXISTS idx_memory_items_scope_kind ON memory_items(endpoint_id, thread_id, scope, kind, updated_at_unix_ms DESC);

CREATE TABLE IF NOT EXISTS provider_capabilities (
  provider_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  capability_json TEXT NOT NULL DEFAULT '{}',
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(provider_id, model_name)
);
`); err != nil {
		return err
	}
	return nil
}

func ensureThreadTodosTableTx(tx *sql.Tx) error {
	if _, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS ai_thread_todos (
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  todos_json TEXT NOT NULL DEFAULT '[]',
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  updated_by_run_id TEXT NOT NULL DEFAULT '',
  updated_by_tool_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(endpoint_id, thread_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_thread_todos_updated ON ai_thread_todos(endpoint_id, thread_id, updated_at_unix_ms DESC);
`); err != nil {
		return err
	}
	return nil
}

func ensureThreadCheckpointsTableTx(tx *sql.Tx) error {
	if _, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS ai_thread_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  run_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'pre_run',
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  thread_json TEXT NOT NULL DEFAULT '{}',
  derived_json TEXT NOT NULL DEFAULT '{}',
  workspace_json TEXT NOT NULL DEFAULT '',
  transcript_max_id INTEGER NOT NULL DEFAULT 0,
  turns_max_id INTEGER NOT NULL DEFAULT 0,
  run_events_max_id INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ai_thread_checkpoints_thread_created ON ai_thread_checkpoints(endpoint_id, thread_id, created_at_unix_ms DESC, checkpoint_id DESC);
CREATE INDEX IF NOT EXISTS idx_ai_thread_checkpoints_run_id ON ai_thread_checkpoints(run_id);
`); err != nil {
		return err
	}
	return nil
}

func ensureFollowupQueueBaseTx(tx *sql.Tx) error {
	if _, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS ai_queued_turns (
  queue_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  channel_id TEXT NOT NULL DEFAULT '',
	  lane TEXT NOT NULL DEFAULT 'queued',
	  sort_index INTEGER NOT NULL DEFAULT 0,
  message_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  text_content TEXT NOT NULL DEFAULT '',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  context_action_json TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '{}',
  session_meta_json TEXT NOT NULL DEFAULT '{}',
  created_by_user_public_id TEXT NOT NULL DEFAULT '',
  created_by_user_email TEXT NOT NULL DEFAULT '',
	  created_at_unix_ms INTEGER NOT NULL,
	  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ai_queued_turns_thread_created ON ai_queued_turns(endpoint_id, thread_id, created_at_unix_ms ASC, queue_id ASC);
	CREATE INDEX IF NOT EXISTS idx_ai_queued_turns_thread_lane_sort ON ai_queued_turns(endpoint_id, thread_id, lane, sort_index ASC, queue_id ASC);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_queued_turns_lane_message_id ON ai_queued_turns(endpoint_id, thread_id, lane, message_id);
`); err != nil {
		return err
	}
	return nil
}

func ensureUploadTablesTx(tx *sql.Tx) error {
	if _, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS ai_uploads (
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
CREATE INDEX IF NOT EXISTS idx_ai_uploads_endpoint_created ON ai_uploads(endpoint_id, created_at_unix_ms DESC, upload_id DESC);
CREATE INDEX IF NOT EXISTS idx_ai_uploads_state_delete_after ON ai_uploads(endpoint_id, state, delete_after_unix_ms, created_at_unix_ms);
CREATE TABLE IF NOT EXISTS ai_upload_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  ref_kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_upload_refs_unique_ref ON ai_upload_refs(endpoint_id, upload_id, ref_kind, ref_id);
CREATE INDEX IF NOT EXISTS idx_ai_upload_refs_thread_upload ON ai_upload_refs(endpoint_id, thread_id, upload_id);
CREATE INDEX IF NOT EXISTS idx_ai_upload_refs_upload ON ai_upload_refs(endpoint_id, upload_id);
`); err != nil {
		return err
	}
	return nil
}

func ensureFlowerTransferHandoffTablesTx(tx *sql.Tx) error {
	if _, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS ai_flower_thread_metadata (
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
CREATE INDEX IF NOT EXISTS idx_ai_flower_thread_metadata_owner ON ai_flower_thread_metadata(endpoint_id, owner_kind, owner_id);
CREATE INDEX IF NOT EXISTS idx_ai_flower_thread_metadata_parent ON ai_flower_thread_metadata(endpoint_id, parent_thread_id, parent_run_id);

CREATE TABLE IF NOT EXISTS ai_flower_transfers (
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_flower_transfers_idempotency ON ai_flower_transfers(endpoint_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_ai_flower_transfers_source ON ai_flower_transfers(endpoint_id, source_thread_id, updated_at_unix_ms DESC);
CREATE INDEX IF NOT EXISTS idx_ai_flower_transfers_destination ON ai_flower_transfers(endpoint_id, destination_thread_id, updated_at_unix_ms DESC);

CREATE TABLE IF NOT EXISTS ai_flower_handoffs (
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_flower_handoffs_idempotency ON ai_flower_handoffs(endpoint_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_ai_flower_handoffs_source ON ai_flower_handoffs(endpoint_id, source_thread_id, updated_at_unix_ms DESC);
CREATE INDEX IF NOT EXISTS idx_ai_flower_handoffs_destination ON ai_flower_handoffs(endpoint_id, destination_thread_id, updated_at_unix_ms DESC);
`); err != nil {
		return err
	}
	return nil
}

func ensureDelegatedApprovalTablesTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS ai_permission_snapshots (
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
CREATE INDEX IF NOT EXISTS idx_ai_permission_snapshots_owner ON ai_permission_snapshots(endpoint_id, owner_thread_id, owner_run_id);

CREATE TABLE IF NOT EXISTS ai_child_permission_snapshots (
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_child_permission_snapshots_spawn ON ai_child_permission_snapshots(endpoint_id, spawn_tool_call_id);
CREATE INDEX IF NOT EXISTS idx_ai_child_permission_snapshots_parent ON ai_child_permission_snapshots(endpoint_id, parent_thread_id, parent_run_id);
CREATE INDEX IF NOT EXISTS idx_ai_child_permission_snapshots_child ON ai_child_permission_snapshots(endpoint_id, child_thread_id);

CREATE TABLE IF NOT EXISTS ai_delegated_approval_requests (
  action_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  parent_thread_id TEXT NOT NULL,
  parent_user_public_id TEXT NOT NULL DEFAULT '',
  parent_run_id TEXT NOT NULL DEFAULT '',
  parent_turn_id TEXT NOT NULL DEFAULT '',
  subagent_id TEXT NOT NULL DEFAULT '',
  child_thread_id TEXT NOT NULL DEFAULT '',
  child_run_id TEXT NOT NULL DEFAULT '',
  child_turn_id TEXT NOT NULL DEFAULT '',
  child_tool_call_id TEXT NOT NULL DEFAULT '',
  approval_id TEXT NOT NULL DEFAULT '',
  ref_hash TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'requested',
  status TEXT NOT NULL DEFAULT 'pending',
  delivery_state TEXT NOT NULL DEFAULT '',
  child_execution_state TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  surface_epoch INTEGER NOT NULL DEFAULT 1,
  requested_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  resolved_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  expires_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  action_json TEXT NOT NULL DEFAULT '{}',
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(endpoint_id, parent_thread_id, action_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_delegated_approval_ref ON ai_delegated_approval_requests(endpoint_id, parent_thread_id, ref_hash);
CREATE INDEX IF NOT EXISTS idx_ai_delegated_approval_thread_status ON ai_delegated_approval_requests(endpoint_id, parent_thread_id, status, updated_at_unix_ms DESC);

CREATE TABLE IF NOT EXISTS ai_delegated_approval_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id TEXT NOT NULL,
  parent_thread_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ai_delegated_approval_events_action ON ai_delegated_approval_events(endpoint_id, action_id, id ASC);

CREATE TABLE IF NOT EXISTS ai_delegated_approval_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id TEXT NOT NULL,
  parent_thread_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT '',
  delivery_state TEXT NOT NULL DEFAULT 'delivery_pending',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  delivered_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ai_delegated_approval_outbox_pending ON ai_delegated_approval_outbox(endpoint_id, delivery_state, id ASC);

CREATE TABLE IF NOT EXISTS ai_delegated_approval_idempotency (
  actor_scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
	  endpoint_id TEXT NOT NULL,
	  parent_thread_id TEXT NOT NULL,
	  action_id TEXT NOT NULL,
	  ref_hash TEXT NOT NULL DEFAULT '',
	  approved INTEGER NOT NULL DEFAULT 0,
	  response_json TEXT NOT NULL DEFAULT '{}',
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(actor_scope, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_ai_delegated_approval_idempotency_action ON ai_delegated_approval_idempotency(endpoint_id, action_id);
	`)
	return err
}

func verifyThreadstoreSchema(tx *sql.Tx) error {
	requiredTables := []string{
		"ai_threads",
		"ai_runs",
		"ai_run_events",
		"ai_thread_state",
		"ai_thread_todos",
		"ai_thread_checkpoints",
		"ai_queued_turns",
		"transcript_messages",
		"conversation_turns",
		"structured_user_inputs",
		"request_user_input_secret_answers",
		"memory_items",
		"provider_capabilities",
		"ai_uploads",
		"ai_upload_refs",
		"ai_flower_thread_metadata",
		"ai_flower_transfers",
		"ai_flower_handoffs",
		"ai_permission_snapshots",
		"ai_child_permission_snapshots",
		"ai_delegated_approval_requests",
		"ai_delegated_approval_events",
		"ai_delegated_approval_outbox",
		"ai_delegated_approval_idempotency",
		"ai_thread_fork_operations",
		"ai_thread_delete_operations",
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
	for _, tableName := range []string{"ai_messages", "memory_embeddings", "ai_tool_calls", "execution_spans"} {
		exists, err := sqliteutil.TableExistsTx(tx, tableName)
		if err != nil {
			return err
		}
		if exists {
			return fmt.Errorf("unexpected legacy table %q", tableName)
		}
	}

	requiredColumns := map[string][]string{
		"ai_threads": {
			"thread_id", "endpoint_id", "namespace_public_id", "model_id", "reasoning_selection_json",
			"execution_mode", "permission_type", "working_dir", "title", "title_source", "title_generated_at_unix_ms",
			"title_input_message_id", "title_model_id", "title_prompt_version", "followups_revision",
			"pinned_at_unix_ms",
			"run_status", "run_updated_at_unix_ms", "run_error_code", "run_error", "waiting_user_input_json",
			"flower_activity_revision", "flower_activity_signature", "flower_activity_waiting_prompt_id",
			"created_by_user_public_id", "created_by_user_email", "updated_by_user_public_id",
			"updated_by_user_email", "created_at_unix_ms", "updated_at_unix_ms",
			"last_message_at_unix_ms", "last_message_preview",
		},
		"ai_runs": {
			"run_id", "endpoint_id", "thread_id", "message_id", "state", "error_code",
			"error_message", "attempt_count", "started_at_unix_ms", "ended_at_unix_ms",
			"updated_at_unix_ms",
		},
		"ai_run_events": {
			"id", "endpoint_id", "thread_id", "run_id", "stream_kind", "event_type",
			"payload_json", "at_unix_ms",
		},
		"ai_thread_state": {
			"endpoint_id", "thread_id", "open_goal", "last_assistant_summary",
			"updated_at_unix_ms",
		},
		"ai_thread_todos": {
			"endpoint_id", "thread_id", "version", "todos_json", "updated_at_unix_ms",
			"updated_by_run_id", "updated_by_tool_id",
		},
		"ai_thread_checkpoints": {
			"checkpoint_id", "endpoint_id", "thread_id", "run_id", "kind", "created_at_unix_ms",
			"thread_json", "derived_json", "workspace_json", "transcript_max_id",
			"turns_max_id", "run_events_max_id",
		},
		"ai_queued_turns": {
			"queue_id", "endpoint_id", "thread_id", "channel_id", "lane", "sort_index",
			"message_id", "model_id", "text_content", "attachments_json", "context_action_json",
			"options_json", "session_meta_json", "created_by_user_public_id", "created_by_user_email",
			"created_at_unix_ms", "updated_at_unix_ms",
		},
		"transcript_messages": {
			"id", "thread_id", "endpoint_id", "message_id", "role", "author_user_public_id",
			"author_user_email", "status", "created_at_unix_ms", "updated_at_unix_ms",
			"text_content", "message_json",
		},
		"conversation_turns": {
			"id", "turn_id", "endpoint_id", "thread_id", "run_id", "user_message_id",
			"assistant_message_id", "created_at_unix_ms",
		},
		"memory_items": {
			"memory_id", "endpoint_id", "thread_id", "scope", "kind", "content",
			"source_refs_json", "importance", "freshness", "confidence", "created_at_unix_ms",
			"updated_at_unix_ms",
		},
		"provider_capabilities": {
			"provider_id", "model_name", "capability_json", "updated_at_unix_ms",
		},
		"structured_user_inputs": {
			"id", "endpoint_id", "thread_id", "response_message_id", "prompt_id", "tool_id",
			"reason_code", "question_id", "header", "question_text", "selected_choice_id",
			"selected_choice_label", "response_text", "public_summary", "contains_secret",
			"created_at_unix_ms",
		},
		"request_user_input_secret_answers": {
			"id", "endpoint_id", "thread_id", "response_message_id", "question_id",
			"answer_index", "answer_text", "created_at_unix_ms",
		},
		"ai_uploads": {
			"upload_id", "endpoint_id", "storage_relpath", "name", "mime_type",
			"size_bytes", "state", "created_at_unix_ms", "claimed_at_unix_ms", "delete_after_unix_ms",
		},
		"ai_upload_refs": {
			"id", "endpoint_id", "upload_id", "thread_id", "ref_kind", "ref_id", "created_at_unix_ms",
		},
		"ai_flower_thread_metadata": {
			"endpoint_id", "thread_id", "owner_kind", "owner_id", "parent_thread_id",
			"parent_run_id", "context_json", "action_json", "updated_at_unix_ms",
			"home_runtime_id", "home_runtime_kind", "origin_env_public_id", "primary_target_id",
			"active_target_ids_json",
		},
		"ai_flower_transfers": {
			"transfer_id", "endpoint_id", "source_thread_id", "destination_thread_id",
			"idempotency_key", "manifest_hash", "approval_hash", "state", "plan_json",
			"created_at_unix_ms", "updated_at_unix_ms",
		},
		"ai_flower_handoffs": {
			"handoff_id", "endpoint_id", "source_thread_id", "destination_thread_id",
			"idempotency_key", "envelope_hash", "state", "envelope_json",
			"created_at_unix_ms", "updated_at_unix_ms",
		},
		"ai_permission_snapshots": {
			"snapshot_id", "endpoint_id", "owner_thread_id", "owner_run_id",
			"permission_type", "snapshot_json", "snapshot_hash", "registry_hash",
			"schema_hash", "presentation_hash", "created_at_unix_ms",
		},
		"ai_child_permission_snapshots": {
			"child_snapshot_id", "endpoint_id", "parent_snapshot_id", "spawn_tool_call_id",
			"parent_thread_id", "parent_run_id", "subagent_id", "child_thread_id",
			"child_run_id", "state", "snapshot_json", "snapshot_hash", "registry_hash",
			"schema_hash", "presentation_hash", "created_at_unix_ms", "finalized_at_unix_ms",
		},
		"ai_delegated_approval_requests": {
			"action_id", "endpoint_id", "parent_thread_id", "parent_user_public_id", "parent_run_id", "parent_turn_id",
			"subagent_id", "child_thread_id", "child_run_id", "child_turn_id",
			"child_tool_call_id", "approval_id", "ref_hash", "request_fingerprint", "state", "status",
			"delivery_state", "child_execution_state", "version", "surface_epoch",
			"requested_at_unix_ms", "resolved_at_unix_ms", "expires_at_unix_ms",
			"action_json", "created_at_unix_ms", "updated_at_unix_ms",
		},
		"ai_delegated_approval_events": {
			"id", "endpoint_id", "parent_thread_id", "action_id", "event_type",
			"version", "payload_json", "created_at_unix_ms",
		},
		"ai_delegated_approval_outbox": {
			"id", "endpoint_id", "parent_thread_id", "action_id", "decision",
			"delivery_state", "payload_json", "created_at_unix_ms", "delivered_at_unix_ms",
		},
		"ai_delegated_approval_idempotency": {
			"actor_scope", "idempotency_key", "endpoint_id", "parent_thread_id",
			"action_id", "ref_hash", "approved", "response_json", "created_at_unix_ms",
		},
		"ai_thread_fork_operations": {
			"operation_id", "endpoint_id", "source_thread_id", "destination_thread_id",
			"request_fingerprint", "status", "snapshot_schema_version", "snapshot_json",
			"floret_result_json", "retry_count", "error_code", "error_message",
			"source_broadcasted_at_unix_ms", "destination_broadcasted_at_unix_ms",
			"created_at_unix_ms", "updated_at_unix_ms",
		},
		"ai_thread_delete_operations": {
			"operation_id", "endpoint_id", "thread_id", "status", "snapshot_schema_version", "snapshot_json",
			"read_state_required", "product_data_deleted_at_unix_ms", "files_cleaned_at_unix_ms",
			"floret_deleted_at_unix_ms", "read_state_deleted_at_unix_ms", "retry_count", "error_code",
			"error_message", "created_at_unix_ms", "updated_at_unix_ms", "committed_at_unix_ms",
		},
	}
	for tableName, columns := range requiredColumns {
		for _, columnName := range columns {
			has, err := sqliteutil.ColumnExistsTx(tx, tableName, columnName)
			if err != nil {
				return err
			}
			if !has {
				return fmt.Errorf("missing column %q on %q", columnName, tableName)
			}
		}
	}
	for tableName, columns := range map[string][]string{
		"ai_threads": {
			"last_context_run_id",
		},
		"ai_thread_state": {
			"provider_continuation_state_json",
			"provider_continuation_provider_id",
			"provider_continuation_model",
			"provider_continuation_base_url",
			"provider_continuation_updated_at_unix_ms",
		},
		"ai_thread_checkpoints": {
			"tool_calls_max_id",
		},
	} {
		for _, columnName := range columns {
			has, err := sqliteutil.ColumnExistsTx(tx, tableName, columnName)
			if err != nil {
				return err
			}
			if has {
				return fmt.Errorf("unexpected legacy column %q on %q", columnName, tableName)
			}
		}
	}

	requiredIndexes := []string{
		"idx_ai_threads_endpoint_updated",
		"idx_ai_threads_endpoint_pinned_created",
		"idx_ai_runs_endpoint_thread_updated",
		"idx_ai_run_events_run_id",
		"idx_ai_run_events_endpoint_thread",
		"idx_ai_thread_todos_updated",
		"idx_ai_thread_checkpoints_thread_created",
		"idx_ai_thread_checkpoints_run_id",
		"idx_ai_queued_turns_thread_created",
		"idx_ai_queued_turns_thread_lane_sort",
		"idx_ai_queued_turns_lane_message_id",
		"idx_transcript_messages_thread_id",
		"idx_conversation_turns_thread_id",
		"idx_conversation_turns_run_id",
		"idx_memory_items_thread_updated",
		"idx_memory_items_scope_kind",
		"idx_structured_user_inputs_recent",
		"idx_request_user_input_secret_answers_message",
		"idx_ai_uploads_endpoint_created",
		"idx_ai_uploads_state_delete_after",
		"idx_ai_upload_refs_unique_ref",
		"idx_ai_upload_refs_thread_upload",
		"idx_ai_upload_refs_upload",
		"idx_ai_flower_thread_metadata_owner",
		"idx_ai_flower_thread_metadata_parent",
		"idx_ai_flower_transfers_idempotency",
		"idx_ai_flower_transfers_source",
		"idx_ai_flower_transfers_destination",
		"idx_ai_flower_handoffs_idempotency",
		"idx_ai_flower_handoffs_source",
		"idx_ai_flower_handoffs_destination",
		"idx_ai_permission_snapshots_owner",
		"idx_ai_child_permission_snapshots_spawn",
		"idx_ai_child_permission_snapshots_parent",
		"idx_ai_child_permission_snapshots_child",
		"idx_ai_delegated_approval_ref",
		"idx_ai_delegated_approval_thread_status",
		"idx_ai_delegated_approval_events_action",
		"idx_ai_delegated_approval_outbox_pending",
		"idx_ai_delegated_approval_idempotency_action",
		"idx_ai_thread_fork_operations_status_updated",
		"idx_ai_thread_fork_operations_source",
		"idx_ai_thread_delete_operations_status_updated",
	}
	for _, indexName := range requiredIndexes {
		exists, err := sqliteutil.IndexExistsTx(tx, indexName)
		if err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("missing index %q", indexName)
		}
	}

	return nil
}
