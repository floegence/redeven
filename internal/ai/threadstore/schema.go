package threadstore

import (
	"database/sql"
	"fmt"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	threadstoreSchemaKind           = "ai_threadstore"
	threadstoreCurrentSchemaVersion = 22
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
		LegacyMarkers:  []string{"ai_threads", "ai_messages", "transcript_messages"},
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA auto_vacuum=INCREMENTAL;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: migrateThreadstoreToV1},
			{FromVersion: 1, ToVersion: 2, Apply: migrateThreadstoreToV2},
			{FromVersion: 2, ToVersion: 3, Apply: migrateThreadstoreToV3},
			{FromVersion: 3, ToVersion: 4, Apply: migrateThreadstoreToV4},
			{FromVersion: 4, ToVersion: 5, Apply: migrateThreadstoreToV5},
			{FromVersion: 5, ToVersion: 6, Apply: migrateThreadstoreToV6},
			{FromVersion: 6, ToVersion: 7, Apply: migrateThreadstoreToV7},
			{FromVersion: 7, ToVersion: 8, Apply: migrateThreadstoreToV8},
			{FromVersion: 8, ToVersion: 9, Apply: migrateThreadstoreToV9},
			{FromVersion: 9, ToVersion: 10, Apply: migrateThreadstoreToV10},
			{FromVersion: 10, ToVersion: 11, Apply: migrateThreadstoreToV11},
			{FromVersion: 11, ToVersion: 12, Apply: migrateThreadstoreToV12},
			{FromVersion: 12, ToVersion: 13, Apply: migrateThreadstoreToV13},
			{FromVersion: 13, ToVersion: 14, Apply: migrateThreadstoreToV14},
			{FromVersion: 14, ToVersion: 15, Apply: migrateThreadstoreToV15},
			{FromVersion: 15, ToVersion: 16, Apply: migrateThreadstoreToV16},
			{FromVersion: 16, ToVersion: 17, Apply: migrateThreadstoreToV17},
			{FromVersion: 17, ToVersion: 18, Apply: migrateThreadstoreToV18},
			{FromVersion: 18, ToVersion: 19, Apply: migrateThreadstoreToV19},
			{FromVersion: 19, ToVersion: 20, Apply: migrateThreadstoreToV20},
			{FromVersion: 20, ToVersion: 21, Apply: migrateThreadstoreToV21},
			{FromVersion: 21, ToVersion: 22, Apply: migrateThreadstoreToV22},
		},
		Verify: verifyThreadstoreSchema,
	}
}

func migrateThreadstoreToV1(tx *sql.Tx) error {
	if _, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS ai_threads (
  thread_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  namespace_public_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
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
CREATE TABLE IF NOT EXISTS ai_messages (
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
CREATE INDEX IF NOT EXISTS idx_ai_messages_thread_id ON ai_messages(endpoint_id, thread_id, id ASC);
`); err != nil {
		return err
	}
	return nil
}

func migrateThreadstoreToV2(tx *sql.Tx) error {
	if err := ensureAIThreadsModelIDTx(tx); err != nil {
		return err
	}
	if err := ensureAIThreadsRunStateColumnsTx(tx); err != nil {
		return err
	}
	if err := ensureRunStateTablesTx(tx); err != nil {
		return err
	}
	return nil
}

func migrateThreadstoreToV3(tx *sql.Tx) error {
	if err := ensureAIThreadsModelIDTx(tx); err != nil {
		return err
	}
	if err := ensureRunStateTablesTx(tx); err != nil {
		return err
	}
	return nil
}

func migrateThreadstoreToV4(tx *sql.Tx) error {
	return ensureRunStateTablesTx(tx)
}

func migrateThreadstoreToV5(tx *sql.Tx) error {
	return ensureContextPlaneTablesTx(tx)
}

func migrateThreadstoreToV6(tx *sql.Tx) error {
	return ensureThreadTodosTableTx(tx)
}

func migrateThreadstoreToV7(tx *sql.Tx) error {
	_, err := tx.Exec(`
UPDATE memory_items
SET kind = 'blocker'
WHERE kind = 'todo' AND content LIKE 'Action blocked:%'
`)
	return err
}

func migrateThreadstoreToV8(tx *sql.Tx) error {
	return ensureAIThreadsWorkingDirTx(tx)
}

func migrateThreadstoreToV9(tx *sql.Tx) error {
	return ensureAIThreadsWaitingPromptColumnsTx(tx)
}

func migrateThreadstoreToV10(tx *sql.Tx) error {
	return scrubLegacyModelDefaultToken(tx)
}

func migrateThreadstoreToV11(tx *sql.Tx) error {
	return ensureAIThreadsModelLockedTx(tx)
}

func migrateThreadstoreToV12(tx *sql.Tx) error {
	return ensureThreadCheckpointsTableTx(tx)
}

func migrateThreadstoreToV13(tx *sql.Tx) error {
	if err := ensureAIThreadsExecutionModeTx(tx); err != nil {
		return err
	}
	return ensureAIThreadsModelIDTx(tx)
}

func migrateThreadstoreToV14(tx *sql.Tx) error {
	return nil
}

func migrateThreadstoreToV15(tx *sql.Tx) error {
	if err := ensureAIThreadsFollowupsRevisionTx(tx); err != nil {
		return err
	}
	return ensureFollowupQueueBaseTx(tx)
}

func migrateThreadstoreToV16(tx *sql.Tx) error {
	return ensureFollowupLaneColumnsTx(tx)
}

func migrateThreadstoreToV17(tx *sql.Tx) error {
	if err := ensureAIThreadsWaitingUserInputJSONTx(tx); err != nil {
		return err
	}
	if err := ensureStructuredUserInputTablesTx(tx); err != nil {
		return err
	}
	return ensureRequestUserInputSecretAnswersTableTx(tx)
}

func migrateThreadstoreToV18(tx *sql.Tx) error {
	return ensureAIThreadsTitleMetadataColumnsTx(tx)
}

func migrateThreadstoreToV19(tx *sql.Tx) error {
	// Older databases may still carry the abandoned embeddings table from historical
	// schema versions. The current runtime contract removes it entirely.
	_, err := tx.Exec(`DROP TABLE IF EXISTS memory_embeddings`)
	return err
}

func migrateThreadstoreToV20(tx *sql.Tx) error {
	return ensureAIThreadsLastContextRunIDTx(tx)
}

func migrateThreadstoreToV21(tx *sql.Tx) error {
	return ensureUploadTablesTx(tx)
}

func migrateThreadstoreToV22(tx *sql.Tx) error {
	return ensureAIThreadStateContinuationColumnsTx(tx)
}

func ensureAIThreadsModelIDTx(tx *sql.Tx) error {
	return ensureColumnTx(tx, "ai_threads", "model_id", `ALTER TABLE ai_threads ADD COLUMN model_id TEXT NOT NULL DEFAULT ''`)
}

func ensureAIThreadsModelLockedTx(tx *sql.Tx) error {
	return ensureColumnTx(tx, "ai_threads", "model_locked", `ALTER TABLE ai_threads ADD COLUMN model_locked INTEGER NOT NULL DEFAULT 0`)
}

func ensureAIThreadsExecutionModeTx(tx *sql.Tx) error {
	return ensureColumnTx(tx, "ai_threads", "execution_mode", `ALTER TABLE ai_threads ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'act'`)
}

func ensureAIThreadsWorkingDirTx(tx *sql.Tx) error {
	return ensureColumnTx(tx, "ai_threads", "working_dir", `ALTER TABLE ai_threads ADD COLUMN working_dir TEXT NOT NULL DEFAULT ''`)
}

func ensureAIThreadsFollowupsRevisionTx(tx *sql.Tx) error {
	return ensureColumnTx(tx, "ai_threads", "followups_revision", `ALTER TABLE ai_threads ADD COLUMN followups_revision INTEGER NOT NULL DEFAULT 0`)
}

func ensureAIThreadsRunStateColumnsTx(tx *sql.Tx) error {
	stmts := []struct {
		column string
		sql    string
	}{
		{column: "run_status", sql: `ALTER TABLE ai_threads ADD COLUMN run_status TEXT NOT NULL DEFAULT 'idle'`},
		{column: "run_updated_at_unix_ms", sql: `ALTER TABLE ai_threads ADD COLUMN run_updated_at_unix_ms INTEGER NOT NULL DEFAULT 0`},
		{column: "run_error", sql: `ALTER TABLE ai_threads ADD COLUMN run_error TEXT NOT NULL DEFAULT ''`},
	}
	for _, stmt := range stmts {
		if err := ensureColumnTx(tx, "ai_threads", stmt.column, stmt.sql); err != nil {
			return err
		}
	}
	return nil
}

func ensureAIThreadsWaitingPromptColumnsTx(tx *sql.Tx) error {
	stmts := []struct {
		column string
		sql    string
	}{
		{column: "waiting_prompt_id", sql: `ALTER TABLE ai_threads ADD COLUMN waiting_prompt_id TEXT NOT NULL DEFAULT ''`},
		{column: "waiting_message_id", sql: `ALTER TABLE ai_threads ADD COLUMN waiting_message_id TEXT NOT NULL DEFAULT ''`},
		{column: "waiting_tool_id", sql: `ALTER TABLE ai_threads ADD COLUMN waiting_tool_id TEXT NOT NULL DEFAULT ''`},
		{column: "waiting_choices_json", sql: `ALTER TABLE ai_threads ADD COLUMN waiting_choices_json TEXT NOT NULL DEFAULT ''`},
	}
	for _, stmt := range stmts {
		if err := ensureColumnTx(tx, "ai_threads", stmt.column, stmt.sql); err != nil {
			return err
		}
	}
	return nil
}

func ensureAIThreadsWaitingUserInputJSONTx(tx *sql.Tx) error {
	return ensureColumnTx(tx, "ai_threads", "waiting_user_input_json", `ALTER TABLE ai_threads ADD COLUMN waiting_user_input_json TEXT NOT NULL DEFAULT ''`)
}

func ensureAIThreadsLastContextRunIDTx(tx *sql.Tx) error {
	return ensureColumnTx(tx, "ai_threads", "last_context_run_id", `ALTER TABLE ai_threads ADD COLUMN last_context_run_id TEXT NOT NULL DEFAULT ''`)
}

func ensureAIThreadStateContinuationColumnsTx(tx *sql.Tx) error {
	stmts := []struct {
		column string
		sql    string
	}{
		{column: "provider_continuation_kind", sql: `ALTER TABLE ai_thread_state ADD COLUMN provider_continuation_kind TEXT NOT NULL DEFAULT ''`},
		{column: "provider_continuation_id", sql: `ALTER TABLE ai_thread_state ADD COLUMN provider_continuation_id TEXT NOT NULL DEFAULT ''`},
		{column: "provider_continuation_provider_id", sql: `ALTER TABLE ai_thread_state ADD COLUMN provider_continuation_provider_id TEXT NOT NULL DEFAULT ''`},
		{column: "provider_continuation_model", sql: `ALTER TABLE ai_thread_state ADD COLUMN provider_continuation_model TEXT NOT NULL DEFAULT ''`},
		{column: "provider_continuation_base_url", sql: `ALTER TABLE ai_thread_state ADD COLUMN provider_continuation_base_url TEXT NOT NULL DEFAULT ''`},
		{column: "provider_continuation_updated_at_unix_ms", sql: `ALTER TABLE ai_thread_state ADD COLUMN provider_continuation_updated_at_unix_ms INTEGER NOT NULL DEFAULT 0`},
	}
	for _, stmt := range stmts {
		if err := ensureColumnTx(tx, "ai_thread_state", stmt.column, stmt.sql); err != nil {
			return err
		}
	}
	return nil
}

func ensureAIThreadsTitleMetadataColumnsTx(tx *sql.Tx) error {
	stmts := []struct {
		column string
		sql    string
	}{
		{column: "title_source", sql: `ALTER TABLE ai_threads ADD COLUMN title_source TEXT NOT NULL DEFAULT ''`},
		{column: "title_generated_at_unix_ms", sql: `ALTER TABLE ai_threads ADD COLUMN title_generated_at_unix_ms INTEGER NOT NULL DEFAULT 0`},
		{column: "title_input_message_id", sql: `ALTER TABLE ai_threads ADD COLUMN title_input_message_id TEXT NOT NULL DEFAULT ''`},
		{column: "title_model_id", sql: `ALTER TABLE ai_threads ADD COLUMN title_model_id TEXT NOT NULL DEFAULT ''`},
		{column: "title_prompt_version", sql: `ALTER TABLE ai_threads ADD COLUMN title_prompt_version TEXT NOT NULL DEFAULT ''`},
	}
	for _, stmt := range stmts {
		if err := ensureColumnTx(tx, "ai_threads", stmt.column, stmt.sql); err != nil {
			return err
		}
	}
	return nil
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

CREATE TABLE IF NOT EXISTS ai_tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL,
  args_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '',
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  retryable INTEGER NOT NULL DEFAULT 0,
  recovery_action TEXT NOT NULL DEFAULT '',
  started_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  ended_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  UNIQUE(run_id, tool_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_run_id ON ai_tool_calls(run_id, id ASC);

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
  provider_continuation_kind TEXT NOT NULL DEFAULT '',
  provider_continuation_id TEXT NOT NULL DEFAULT '',
  provider_continuation_provider_id TEXT NOT NULL DEFAULT '',
  provider_continuation_model TEXT NOT NULL DEFAULT '',
  provider_continuation_base_url TEXT NOT NULL DEFAULT '',
  provider_continuation_updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
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
  selected_option_id TEXT NOT NULL DEFAULT '',
  selected_option_label TEXT NOT NULL DEFAULT '',
  answers_json TEXT NOT NULL DEFAULT '[]',
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

CREATE TABLE IF NOT EXISTS execution_spans (
  span_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'system',
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  payload_json TEXT NOT NULL DEFAULT '{}',
  started_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  ended_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_execution_spans_thread_started ON execution_spans(endpoint_id, thread_id, started_at_unix_ms DESC, span_id DESC);
CREATE INDEX IF NOT EXISTS idx_execution_spans_run_started ON execution_spans(endpoint_id, run_id, started_at_unix_ms ASC, span_id ASC);

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

CREATE TABLE IF NOT EXISTS memory_embeddings (
  memory_id TEXT NOT NULL,
  embedding_model TEXT NOT NULL DEFAULT '',
  vector_blob BLOB NOT NULL,
  dim INTEGER NOT NULL DEFAULT 0,
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(memory_id, embedding_model)
);

CREATE TABLE IF NOT EXISTS context_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'turn',
  summary_text TEXT NOT NULL DEFAULT '',
  covers_turn_from_id INTEGER NOT NULL DEFAULT 0,
  covers_turn_to_id INTEGER NOT NULL DEFAULT 0,
  quality_score REAL NOT NULL DEFAULT 0.5,
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_context_snapshots_thread_level ON context_snapshots(endpoint_id, thread_id, level, created_at_unix_ms DESC);

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
	if _, err := tx.Exec(`
INSERT OR IGNORE INTO transcript_messages(
  id, thread_id, endpoint_id, message_id, role,
  author_user_public_id, author_user_email,
  status, created_at_unix_ms, updated_at_unix_ms,
  text_content, message_json
)
SELECT
  id, thread_id, endpoint_id, message_id, role,
  author_user_public_id, author_user_email,
  status, created_at_unix_ms, updated_at_unix_ms,
  text_content, message_json
FROM ai_messages
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
  tool_calls_max_id INTEGER NOT NULL DEFAULT 0,
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
  message_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  text_content TEXT NOT NULL DEFAULT '',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  options_json TEXT NOT NULL DEFAULT '{}',
  created_by_user_public_id TEXT NOT NULL DEFAULT '',
  created_by_user_email TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_queued_turns_thread_created ON ai_queued_turns(endpoint_id, thread_id, created_at_unix_ms ASC, queue_id ASC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_queued_turns_message_id ON ai_queued_turns(endpoint_id, thread_id, message_id);
`); err != nil {
		return err
	}
	return ensureColumnTx(tx, "ai_queued_turns", "channel_id", `ALTER TABLE ai_queued_turns ADD COLUMN channel_id TEXT NOT NULL DEFAULT ''`)
}

func ensureFollowupLaneColumnsTx(tx *sql.Tx) error {
	stmts := []struct {
		table  string
		column string
		sql    string
	}{
		{table: "ai_queued_turns", column: "lane", sql: `ALTER TABLE ai_queued_turns ADD COLUMN lane TEXT NOT NULL DEFAULT 'queued'`},
		{table: "ai_queued_turns", column: "sort_index", sql: `ALTER TABLE ai_queued_turns ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0`},
		{table: "ai_queued_turns", column: "updated_at_unix_ms", sql: `ALTER TABLE ai_queued_turns ADD COLUMN updated_at_unix_ms INTEGER NOT NULL DEFAULT 0`},
	}
	for _, stmt := range stmts {
		if err := ensureColumnTx(tx, stmt.table, stmt.column, stmt.sql); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`UPDATE ai_queued_turns SET lane = 'queued' WHERE TRIM(COALESCE(lane, '')) = ''`); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE ai_queued_turns SET updated_at_unix_ms = CASE WHEN updated_at_unix_ms <= 0 THEN created_at_unix_ms ELSE updated_at_unix_ms END`); err != nil {
		return err
	}
	if _, err := tx.Exec(`
UPDATE ai_queued_turns AS cur
SET sort_index = (
  SELECT COUNT(1)
  FROM ai_queued_turns AS other
  WHERE other.endpoint_id = cur.endpoint_id
    AND other.thread_id = cur.thread_id
    AND LOWER(COALESCE(other.lane, 'queued')) = LOWER(COALESCE(cur.lane, 'queued'))
    AND (
      other.created_at_unix_ms < cur.created_at_unix_ms
      OR (other.created_at_unix_ms = cur.created_at_unix_ms AND other.queue_id <= cur.queue_id)
    )
)
WHERE sort_index <= 0
`); err != nil {
		return err
	}
	if _, err := tx.Exec(`CREATE INDEX IF NOT EXISTS idx_ai_queued_turns_thread_lane_sort ON ai_queued_turns(endpoint_id, thread_id, lane, sort_index ASC, queue_id ASC)`); err != nil {
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

func ensureColumnTx(tx *sql.Tx, tableName string, columnName string, stmt string) error {
	has, err := columnExists(tx, tableName, columnName)
	if err != nil {
		return err
	}
	if has {
		return nil
	}
	_, err = tx.Exec(stmt)
	return err
}

func verifyThreadstoreSchema(tx *sql.Tx) error {
	requiredTables := []string{
		"ai_threads",
		"ai_messages",
		"ai_runs",
		"ai_tool_calls",
		"ai_run_events",
		"ai_thread_state",
		"ai_thread_todos",
		"ai_thread_checkpoints",
		"ai_queued_turns",
		"transcript_messages",
		"conversation_turns",
		"structured_user_inputs",
		"request_user_input_secret_answers",
		"execution_spans",
		"memory_items",
		"context_snapshots",
		"provider_capabilities",
		"ai_uploads",
		"ai_upload_refs",
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
	for _, tableName := range []string{"memory_embeddings"} {
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
			"thread_id", "endpoint_id", "namespace_public_id", "model_id", "model_locked",
			"execution_mode", "working_dir", "title", "title_source", "title_generated_at_unix_ms",
			"title_input_message_id", "title_model_id", "title_prompt_version", "followups_revision",
			"run_status", "run_updated_at_unix_ms", "run_error", "waiting_user_input_json", "last_context_run_id",
			"created_by_user_public_id", "created_by_user_email", "updated_by_user_public_id",
			"updated_by_user_email", "created_at_unix_ms", "updated_at_unix_ms",
			"last_message_at_unix_ms", "last_message_preview",
		},
		"ai_messages": {
			"id", "thread_id", "endpoint_id", "message_id", "role", "author_user_public_id",
			"author_user_email", "status", "created_at_unix_ms", "updated_at_unix_ms",
			"text_content", "message_json",
		},
		"ai_runs": {
			"run_id", "endpoint_id", "thread_id", "message_id", "state", "error_code",
			"error_message", "attempt_count", "started_at_unix_ms", "ended_at_unix_ms",
			"updated_at_unix_ms",
		},
		"ai_tool_calls": {
			"id", "run_id", "tool_id", "tool_name", "status", "args_json", "result_json",
			"error_code", "error_message", "retryable", "recovery_action", "started_at_unix_ms",
			"ended_at_unix_ms", "latency_ms",
		},
		"ai_run_events": {
			"id", "endpoint_id", "thread_id", "run_id", "stream_kind", "event_type",
			"payload_json", "at_unix_ms",
		},
		"ai_thread_state": {
			"endpoint_id", "thread_id", "open_goal", "last_assistant_summary",
			"provider_continuation_kind", "provider_continuation_id", "provider_continuation_provider_id",
			"provider_continuation_model", "provider_continuation_base_url",
			"provider_continuation_updated_at_unix_ms", "updated_at_unix_ms",
		},
		"ai_thread_todos": {
			"endpoint_id", "thread_id", "version", "todos_json", "updated_at_unix_ms",
			"updated_by_run_id", "updated_by_tool_id",
		},
		"ai_thread_checkpoints": {
			"checkpoint_id", "endpoint_id", "thread_id", "run_id", "kind", "created_at_unix_ms",
			"thread_json", "derived_json", "workspace_json", "transcript_max_id",
			"turns_max_id", "tool_calls_max_id", "run_events_max_id",
		},
		"ai_queued_turns": {
			"queue_id", "endpoint_id", "thread_id", "channel_id", "lane", "sort_index",
			"message_id", "model_id", "text_content", "attachments_json", "options_json",
			"created_by_user_public_id", "created_by_user_email", "created_at_unix_ms",
			"updated_at_unix_ms",
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
		"execution_spans": {
			"span_id", "endpoint_id", "thread_id", "run_id", "kind", "name", "status",
			"payload_json", "started_at_unix_ms", "ended_at_unix_ms", "updated_at_unix_ms",
		},
		"memory_items": {
			"memory_id", "endpoint_id", "thread_id", "scope", "kind", "content",
			"source_refs_json", "importance", "freshness", "confidence", "created_at_unix_ms",
			"updated_at_unix_ms",
		},
		"context_snapshots": {
			"snapshot_id", "endpoint_id", "thread_id", "level", "summary_text",
			"covers_turn_from_id", "covers_turn_to_id", "quality_score", "created_at_unix_ms",
		},
		"provider_capabilities": {
			"provider_id", "model_name", "capability_json", "updated_at_unix_ms",
		},
		"structured_user_inputs": {
			"id", "endpoint_id", "thread_id", "response_message_id", "prompt_id", "tool_id",
			"reason_code", "question_id", "header", "question_text", "selected_option_id",
			"selected_option_label", "answers_json", "public_summary", "contains_secret",
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

	requiredIndexes := []string{
		"idx_ai_threads_endpoint_updated",
		"idx_ai_messages_thread_id",
		"idx_ai_runs_endpoint_thread_updated",
		"idx_ai_tool_calls_run_id",
		"idx_ai_run_events_run_id",
		"idx_ai_run_events_endpoint_thread",
		"idx_ai_thread_todos_updated",
		"idx_ai_thread_checkpoints_thread_created",
		"idx_ai_thread_checkpoints_run_id",
		"idx_ai_queued_turns_thread_created",
		"idx_ai_queued_turns_thread_lane_sort",
		"idx_ai_queued_turns_message_id",
		"idx_transcript_messages_thread_id",
		"idx_conversation_turns_thread_id",
		"idx_conversation_turns_run_id",
		"idx_execution_spans_thread_started",
		"idx_execution_spans_run_started",
		"idx_memory_items_thread_updated",
		"idx_memory_items_scope_kind",
		"idx_context_snapshots_thread_level",
		"idx_structured_user_inputs_recent",
		"idx_request_user_input_secret_answers_message",
		"idx_ai_uploads_endpoint_created",
		"idx_ai_uploads_state_delete_after",
		"idx_ai_upload_refs_unique_ref",
		"idx_ai_upload_refs_thread_upload",
		"idx_ai_upload_refs_upload",
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
