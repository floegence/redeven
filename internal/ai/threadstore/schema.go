package threadstore

import (
	"database/sql"
	"fmt"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	threadstoreSchemaKind           = "ai_threadstore"
	threadstoreCurrentSchemaVersion = 37
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
			{FromVersion: 22, ToVersion: 23, Apply: migrateThreadstoreToV23},
			{FromVersion: 23, ToVersion: 24, Apply: migrateThreadstoreToV24},
			{FromVersion: 24, ToVersion: 25, Apply: migrateThreadstoreToV25},
			{FromVersion: 25, ToVersion: 26, Apply: migrateThreadstoreToV26},
			{FromVersion: 26, ToVersion: 27, Apply: migrateThreadstoreToV27},
			{FromVersion: 27, ToVersion: 28, Apply: migrateThreadstoreToV28},
			{FromVersion: 28, ToVersion: 29, Apply: migrateThreadstoreToV29},
			{FromVersion: 29, ToVersion: 30, Apply: migrateThreadstoreToV30},
			{FromVersion: 30, ToVersion: 31, Apply: migrateThreadstoreToV31},
			{FromVersion: 31, ToVersion: 32, Apply: migrateThreadstoreToV32},
			{FromVersion: 32, ToVersion: 33, Apply: migrateThreadstoreToV33},
			{FromVersion: 33, ToVersion: 34, Apply: migrateThreadstoreToV34},
			{FromVersion: 34, ToVersion: 35, Apply: migrateThreadstoreToV35},
			{FromVersion: 35, ToVersion: 36, Apply: migrateThreadstoreToV36},
			{FromVersion: 36, ToVersion: 37, Apply: migrateThreadstoreToV37},
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
	return nil
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

func migrateThreadstoreToV23(tx *sql.Tx) error {
	return ensureFollowupSessionMetaJSONTx(tx)
}

func migrateThreadstoreToV24(tx *sql.Tx) error {
	return ensureFollowupLaneMessageIDIndexTx(tx)
}

func migrateThreadstoreToV25(tx *sql.Tx) error {
	_ = tx
	return nil
}

func migrateThreadstoreToV26(tx *sql.Tx) error {
	_ = tx
	return nil
}

func migrateThreadstoreToV27(tx *sql.Tx) error {
	return ensureFollowupContextActionJSONTx(tx)
}

func migrateThreadstoreToV28(tx *sql.Tx) error {
	return ensureFlowerTransferHandoffTablesTx(tx)
}

func migrateThreadstoreToV29(tx *sql.Tx) error {
	return ensureFlowerThreadMetadataOwnershipColumnsTx(tx)
}

func migrateThreadstoreToV30(tx *sql.Tx) error {
	return ensureAIThreadsPinnedAtTx(tx)
}

func migrateThreadstoreToV31(tx *sql.Tx) error {
	if err := ensureAIThreadsRunErrorCodeTx(tx); err != nil {
		return err
	}
	return ensureFlowerThreadMetadataOwnershipColumnsTx(tx)
}

func migrateThreadstoreToV32(tx *sql.Tx) error {
	return ensureAIThreadStateContinuationColumnsTx(tx)
}

func migrateThreadstoreToV33(tx *sql.Tx) error {
	return ensureAIThreadsReasoningSelectionTx(tx)
}

func migrateThreadstoreToV34(tx *sql.Tx) error {
	if err := ensureAIThreadsFlowerActivitySnapshotTx(tx); err != nil {
		return err
	}
	return backfillAIThreadsFlowerActivitySnapshotTx(tx)
}

func migrateThreadstoreToV35(tx *sql.Tx) error {
	return ensureAIThreadsPermissionTypeTx(tx)
}

func migrateThreadstoreToV36(tx *sql.Tx) error {
	return ensureDelegatedApprovalTablesTx(tx)
}

func migrateThreadstoreToV37(tx *sql.Tx) error {
	return cleanupLegacyFloretSubagentProjectionRowsTx(tx)
}

func cleanupLegacyFloretSubagentProjectionRowsTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TEMP TABLE IF NOT EXISTS legacy_floret_subagent_projection_threads (
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  PRIMARY KEY(endpoint_id, thread_id)
);
DELETE FROM legacy_floret_subagent_projection_threads;
INSERT OR IGNORE INTO legacy_floret_subagent_projection_threads(endpoint_id, thread_id)
SELECT endpoint_id, thread_id
FROM ai_flower_thread_metadata
WHERE LOWER(TRIM(COALESCE(owner_kind, ''))) = 'subagent_projection'
  AND LOWER(TRIM(COALESCE(owner_id, ''))) = 'floret'
  AND TRIM(COALESCE(endpoint_id, '')) <> ''
  AND TRIM(COALESCE(thread_id, '')) <> '';

DELETE FROM ai_messages
WHERE EXISTS (
  SELECT 1
  FROM legacy_floret_subagent_projection_threads legacy
  WHERE legacy.endpoint_id = ai_messages.endpoint_id
    AND legacy.thread_id = ai_messages.thread_id
);
DELETE FROM transcript_messages
WHERE EXISTS (
  SELECT 1
  FROM legacy_floret_subagent_projection_threads legacy
  WHERE legacy.endpoint_id = transcript_messages.endpoint_id
    AND legacy.thread_id = transcript_messages.thread_id
);
DELETE FROM ai_flower_thread_metadata
WHERE EXISTS (
  SELECT 1
  FROM legacy_floret_subagent_projection_threads legacy
  WHERE legacy.endpoint_id = ai_flower_thread_metadata.endpoint_id
    AND legacy.thread_id = ai_flower_thread_metadata.thread_id
);
DELETE FROM ai_threads
WHERE EXISTS (
  SELECT 1
  FROM legacy_floret_subagent_projection_threads legacy
  WHERE legacy.endpoint_id = ai_threads.endpoint_id
    AND legacy.thread_id = ai_threads.thread_id
);
DROP TABLE legacy_floret_subagent_projection_threads;
`)
	return err
}

func ensureAIThreadsModelIDTx(tx *sql.Tx) error {
	return ensureColumnTx(tx, "ai_threads", "model_id", `ALTER TABLE ai_threads ADD COLUMN model_id TEXT NOT NULL DEFAULT ''`)
}

func ensureAIThreadsReasoningSelectionTx(tx *sql.Tx) error {
	return ensureColumnTx(tx, "ai_threads", "reasoning_selection_json", `ALTER TABLE ai_threads ADD COLUMN reasoning_selection_json TEXT NOT NULL DEFAULT ''`)
}

func ensureAIThreadsExecutionModeTx(tx *sql.Tx) error {
	return ensureColumnTx(tx, "ai_threads", "execution_mode", `ALTER TABLE ai_threads ADD COLUMN execution_mode TEXT NOT NULL DEFAULT ''`)
}

func ensureAIThreadsPermissionTypeTx(tx *sql.Tx) error {
	if err := ensureColumnTx(tx, "ai_threads", "permission_type", `ALTER TABLE ai_threads ADD COLUMN permission_type TEXT NOT NULL DEFAULT 'approval_required'`); err != nil {
		return err
	}
	_, err := tx.Exec(`
UPDATE ai_threads
SET permission_type = CASE
  WHEN lower(trim(COALESCE(execution_mode, ''))) = 'plan' THEN 'readonly'
  ELSE 'approval_required'
END
WHERE trim(COALESCE(permission_type, '')) = '' OR permission_type = 'approval_required'
`)
	return err
}

func ensureAIThreadsWorkingDirTx(tx *sql.Tx) error {
	return ensureColumnTx(tx, "ai_threads", "working_dir", `ALTER TABLE ai_threads ADD COLUMN working_dir TEXT NOT NULL DEFAULT ''`)
}

func ensureAIThreadsFollowupsRevisionTx(tx *sql.Tx) error {
	return ensureColumnTx(tx, "ai_threads", "followups_revision", `ALTER TABLE ai_threads ADD COLUMN followups_revision INTEGER NOT NULL DEFAULT 0`)
}

func ensureAIThreadsPinnedAtTx(tx *sql.Tx) error {
	if err := ensureColumnTx(tx, "ai_threads", "pinned_at_unix_ms", `ALTER TABLE ai_threads ADD COLUMN pinned_at_unix_ms INTEGER NOT NULL DEFAULT 0`); err != nil {
		return err
	}
	_, err := tx.Exec(`CREATE INDEX IF NOT EXISTS idx_ai_threads_endpoint_pinned_created ON ai_threads(endpoint_id, pinned_at_unix_ms DESC, created_at_unix_ms DESC, thread_id ASC)`)
	return err
}

func ensureAIThreadsRunStateColumnsTx(tx *sql.Tx) error {
	stmts := []struct {
		column string
		sql    string
	}{
		{column: "run_status", sql: `ALTER TABLE ai_threads ADD COLUMN run_status TEXT NOT NULL DEFAULT 'idle'`},
		{column: "run_updated_at_unix_ms", sql: `ALTER TABLE ai_threads ADD COLUMN run_updated_at_unix_ms INTEGER NOT NULL DEFAULT 0`},
		{column: "run_error_code", sql: `ALTER TABLE ai_threads ADD COLUMN run_error_code TEXT NOT NULL DEFAULT ''`},
		{column: "run_error", sql: `ALTER TABLE ai_threads ADD COLUMN run_error TEXT NOT NULL DEFAULT ''`},
	}
	for _, stmt := range stmts {
		if err := ensureColumnTx(tx, "ai_threads", stmt.column, stmt.sql); err != nil {
			return err
		}
	}
	return nil
}

func ensureAIThreadsRunErrorCodeTx(tx *sql.Tx) error {
	return ensureColumnTx(tx, "ai_threads", "run_error_code", `ALTER TABLE ai_threads ADD COLUMN run_error_code TEXT NOT NULL DEFAULT ''`)
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

func ensureAIThreadsFlowerActivitySnapshotTx(tx *sql.Tx) error {
	stmts := []struct {
		column string
		sql    string
	}{
		{column: "flower_activity_revision", sql: `ALTER TABLE ai_threads ADD COLUMN flower_activity_revision INTEGER NOT NULL DEFAULT 0`},
		{column: "flower_activity_signature", sql: `ALTER TABLE ai_threads ADD COLUMN flower_activity_signature TEXT NOT NULL DEFAULT ''`},
		{column: "flower_activity_waiting_prompt_id", sql: `ALTER TABLE ai_threads ADD COLUMN flower_activity_waiting_prompt_id TEXT NOT NULL DEFAULT ''`},
	}
	for _, stmt := range stmts {
		if err := ensureColumnTx(tx, "ai_threads", stmt.column, stmt.sql); err != nil {
			return err
		}
	}
	return nil
}

func backfillAIThreadsFlowerActivitySnapshotTx(tx *sql.Tx) error {
	rows, err := tx.Query(`
SELECT thread_id, endpoint_id, run_status, last_context_run_id, waiting_user_input_json,
       run_updated_at_unix_ms, last_message_at_unix_ms, last_message_preview,
       flower_activity_revision, flower_activity_signature
FROM ai_threads
WHERE flower_activity_revision <= 0 OR TRIM(COALESCE(flower_activity_signature, '')) = ''
`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type row struct {
		threadID           string
		endpointID         string
		runStatus          string
		lastContextRunID   string
		waitingJSON        string
		runUpdatedAt       int64
		lastMessageAt      int64
		lastMessagePreview string
		revision           int64
		signature          string
	}
	updates := make([]row, 0)
	for rows.Next() {
		var item row
		if err := rows.Scan(
			&item.threadID,
			&item.endpointID,
			&item.runStatus,
			&item.lastContextRunID,
			&item.waitingJSON,
			&item.runUpdatedAt,
			&item.lastMessageAt,
			&item.lastMessagePreview,
			&item.revision,
			&item.signature,
		); err != nil {
			return err
		}
		updates = append(updates, item)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, item := range updates {
		waitingPromptID := flowerActivityWaitingPromptID(item.runStatus, item.waitingJSON)
		revision := legacyFlowerActivityRevision(item.runStatus, item.runUpdatedAt, item.lastMessageAt)
		if item.revision > revision {
			revision = item.revision
		}
		signature := flowerActivitySignatureForState(revision, item.runStatus, item.lastContextRunID, waitingPromptID, item.lastMessageAt, item.lastMessagePreview)
		if _, err := tx.Exec(`
UPDATE ai_threads
SET flower_activity_revision = ?,
    flower_activity_signature = ?,
    flower_activity_waiting_prompt_id = ?
WHERE endpoint_id = ? AND thread_id = ?
`, revision, signature, waitingPromptID, item.endpointID, item.threadID); err != nil {
			return err
		}
	}
	return nil
}

func ensureAIThreadStateContinuationColumnsTx(tx *sql.Tx) error {
	stmts := []struct {
		column string
		sql    string
	}{
		{column: "provider_continuation_state_json", sql: `ALTER TABLE ai_thread_state ADD COLUMN provider_continuation_state_json TEXT NOT NULL DEFAULT ''`},
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
  provider_continuation_state_json TEXT NOT NULL DEFAULT '',
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
  context_action_json TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '{}',
  session_meta_json TEXT NOT NULL DEFAULT '{}',
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

func ensureFollowupContextActionJSONTx(tx *sql.Tx) error {
	return ensureColumnTx(tx, "ai_queued_turns", "context_action_json", `ALTER TABLE ai_queued_turns ADD COLUMN context_action_json TEXT NOT NULL DEFAULT ''`)
}

func ensureFollowupSessionMetaJSONTx(tx *sql.Tx) error {
	if err := ensureColumnTx(tx, "ai_queued_turns", "session_meta_json", `ALTER TABLE ai_queued_turns ADD COLUMN session_meta_json TEXT NOT NULL DEFAULT '{}'`); err != nil {
		return err
	}
	_, err := tx.Exec(`UPDATE ai_queued_turns SET session_meta_json = '{}' WHERE TRIM(COALESCE(session_meta_json, '')) = ''`)
	return err
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
	return ensureFollowupLaneMessageIDIndexTx(tx)
}

func ensureFollowupLaneMessageIDIndexTx(tx *sql.Tx) error {
	if _, err := tx.Exec(`DROP INDEX IF EXISTS idx_ai_queued_turns_message_id`); err != nil {
		return err
	}
	_, err := tx.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_queued_turns_lane_message_id ON ai_queued_turns(endpoint_id, thread_id, lane, message_id)`)
	return err
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
	if err != nil {
		return err
	}
	if err := ensureColumnTx(tx, "ai_delegated_approval_requests", "request_fingerprint", `ALTER TABLE ai_delegated_approval_requests ADD COLUMN request_fingerprint TEXT NOT NULL DEFAULT ''`); err != nil {
		return err
	}
	if err := ensureColumnTx(tx, "ai_delegated_approval_idempotency", "ref_hash", `ALTER TABLE ai_delegated_approval_idempotency ADD COLUMN ref_hash TEXT NOT NULL DEFAULT ''`); err != nil {
		return err
	}
	return ensureColumnTx(tx, "ai_delegated_approval_requests", "parent_user_public_id", `ALTER TABLE ai_delegated_approval_requests ADD COLUMN parent_user_public_id TEXT NOT NULL DEFAULT ''`)
}

func ensureFlowerThreadMetadataOwnershipColumnsTx(tx *sql.Tx) error {
	columns := []struct {
		name string
		def  string
	}{
		{name: "home_runtime_id", def: "TEXT NOT NULL DEFAULT ''"},
		{name: "home_runtime_kind", def: "TEXT NOT NULL DEFAULT ''"},
		{name: "origin_env_public_id", def: "TEXT NOT NULL DEFAULT ''"},
		{name: "primary_target_id", def: "TEXT NOT NULL DEFAULT ''"},
		{name: "active_target_ids_json", def: "TEXT NOT NULL DEFAULT '[]'"},
	}
	for _, column := range columns {
		has, err := sqliteutil.ColumnExistsTx(tx, "ai_flower_thread_metadata", column.name)
		if err != nil {
			return err
		}
		if has {
			continue
		}
		if _, err := tx.Exec(fmt.Sprintf(`ALTER TABLE ai_flower_thread_metadata ADD COLUMN %s %s`, column.name, column.def)); err != nil {
			return err
		}
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
			"thread_id", "endpoint_id", "namespace_public_id", "model_id",
			"execution_mode", "permission_type", "working_dir", "title", "title_source", "title_generated_at_unix_ms",
			"title_input_message_id", "title_model_id", "title_prompt_version", "followups_revision",
			"pinned_at_unix_ms",
			"run_status", "run_updated_at_unix_ms", "run_error_code", "run_error", "waiting_user_input_json", "last_context_run_id",
			"flower_activity_revision", "flower_activity_signature", "flower_activity_waiting_prompt_id",
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
			"provider_continuation_state_json", "provider_continuation_provider_id",
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
		"execution_spans": {
			"span_id", "endpoint_id", "thread_id", "run_id", "kind", "name", "status",
			"payload_json", "started_at_unix_ms", "ended_at_unix_ms", "updated_at_unix_ms",
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
		"idx_ai_threads_endpoint_pinned_created",
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
		"idx_ai_queued_turns_lane_message_id",
		"idx_transcript_messages_thread_id",
		"idx_conversation_turns_thread_id",
		"idx_conversation_turns_run_id",
		"idx_execution_spans_thread_started",
		"idx_execution_spans_run_started",
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
