package threadstore

import (
	"database/sql"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"sync"
)

const (
	canonicalMinimumVersion = 15
	canonicalCurrentVersion = 40
)

type canonicalMigration struct {
	from  int
	to    int
	apply func(*sql.Tx) error
}

type canonicalSchemaObject struct {
	Type  string
	Name  string
	Table string
	SQL   string
}

var canonicalMigrationsByVersion = []canonicalMigration{
	{15, 16, migrateCanonicalV15ToV16},
	{16, 17, migrateCanonicalV16ToV17},
	{17, 18, migrateCanonicalV17ToV18},
	{18, 19, migrateCanonicalV18ToV19},
	{19, 20, migrateCanonicalV19ToV20},
	{20, 21, migrateCanonicalV20ToV21},
	{21, 22, migrateCanonicalV21ToV22},
	{22, 23, migrateCanonicalV22ToV23},
	{23, 24, migrateCanonicalV23ToV24},
	{24, 25, migrateCanonicalV24ToV25},
	{25, 26, migrateCanonicalV25ToV26},
	{26, 27, migrateCanonicalV26ToV27},
	{27, 28, migrateCanonicalV27ToV28},
	{28, 29, migrateCanonicalV28ToV29},
	{29, 30, migrateCanonicalV29ToV30},
	{30, 31, migrateCanonicalV30ToV31},
	{31, 32, migrateCanonicalV31ToV32},
	{32, 33, migrateCanonicalV32ToV33},
	{33, 34, migrateCanonicalV33ToV34},
	{34, 35, migrateCanonicalV34ToV35},
	{35, 36, migrateCanonicalV35ToV36},
	{36, 37, migrateCanonicalV36ToV37},
	{37, 38, migrateCanonicalV37ToV38},
	{38, 39, migrateCanonicalV38ToV39},
	{39, 40, migrateCanonicalV39ToV40},
}

var (
	canonicalContractsOnce sync.Once
	canonicalContracts     map[int][]canonicalSchemaObject
	canonicalContractsErr  error
)

func migrateCanonicalToProductV1(tx *sql.Tx, version int, ensureThread func(string) error) error {
	if version < canonicalMinimumVersion || version > canonicalCurrentVersion {
		return fmt.Errorf("unsupported canonical threadstore version %d", version)
	}
	for current := version; current < canonicalCurrentVersion; current++ {
		if err := verifyCanonicalSchemaVersion(tx, current); err != nil {
			return fmt.Errorf("verify canonical threadstore v%d: %w", current, err)
		}
		migration := canonicalMigrationFrom(current)
		if migration == nil {
			return fmt.Errorf("missing canonical threadstore migration from v%d", current)
		}
		if err := migration.apply(tx); err != nil {
			return fmt.Errorf("migrate canonical threadstore v%d to v%d: %w", migration.from, migration.to, err)
		}
	}
	if err := verifyCanonicalSchemaVersion(tx, canonicalCurrentVersion); err != nil {
		return fmt.Errorf("verify canonical threadstore v%d: %w", canonicalCurrentVersion, err)
	}
	if ensureThread == nil {
		return errors.New("canonical threadstore migration requires a Floret thread identity ensurer")
	}
	if err := validateCanonicalProductData(tx); err != nil {
		return err
	}
	if err := ensureCanonicalThreadIdentities(tx, ensureThread); err != nil {
		return err
	}
	return convertCanonicalV40ToProductV1(tx)
}

func canonicalMigrationFrom(version int) *canonicalMigration {
	for index := range canonicalMigrationsByVersion {
		if canonicalMigrationsByVersion[index].from == version {
			return &canonicalMigrationsByVersion[index]
		}
	}
	return nil
}

func verifyCanonicalSchemaVersion(tx *sql.Tx, version int) error {
	expected, err := expectedCanonicalContracts()
	if err != nil {
		return err
	}
	contract, ok := expected[version]
	if !ok {
		return fmt.Errorf("unsupported canonical threadstore schema version %d", version)
	}
	actual, err := readCanonicalSchemaObjects(tx)
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(actual, contract) {
		return fmt.Errorf("canonical threadstore schema v%d contract mismatch", version)
	}
	return nil
}

func expectedCanonicalContracts() (map[int][]canonicalSchemaObject, error) {
	canonicalContractsOnce.Do(func() {
		db, err := sql.Open("sqlite", "file:redeven-canonical-contract?mode=memory&cache=shared&_txlock=immediate")
		if err != nil {
			canonicalContractsErr = err
			return
		}
		defer db.Close()
		db.SetMaxOpenConns(1)
		db.SetMaxIdleConns(1)
		if _, err := db.Exec(canonicalV15SchemaSQL); err != nil {
			canonicalContractsErr = fmt.Errorf("create canonical v15 contract: %w", err)
			return
		}
		canonicalContracts = make(map[int][]canonicalSchemaObject, canonicalCurrentVersion-canonicalMinimumVersion+1)
		for version := canonicalMinimumVersion; version <= canonicalCurrentVersion; version++ {
			tx, err := db.Begin()
			if err != nil {
				canonicalContractsErr = err
				return
			}
			objects, err := readCanonicalSchemaObjects(tx)
			if err == nil {
				canonicalContracts[version] = objects
			}
			if err == nil && version < canonicalCurrentVersion {
				migration := canonicalMigrationFrom(version)
				if migration == nil {
					err = fmt.Errorf("missing canonical contract migration from v%d", version)
				} else {
					err = migration.apply(tx)
				}
			}
			if err != nil {
				_ = tx.Rollback()
				canonicalContractsErr = err
				return
			}
			if err := tx.Commit(); err != nil {
				canonicalContractsErr = err
				return
			}
		}
	})
	return canonicalContracts, canonicalContractsErr
}

func readCanonicalSchemaObjects(tx *sql.Tx) ([]canonicalSchemaObject, error) {
	rows, err := tx.Query(`
SELECT type, name, tbl_name, COALESCE(sql, '')
FROM sqlite_master
WHERE name NOT LIKE 'sqlite_%'
  AND name <> '__redeven_db_meta'
ORDER BY type, name
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var objects []canonicalSchemaObject
	for rows.Next() {
		var object canonicalSchemaObject
		if err := rows.Scan(&object.Type, &object.Name, &object.Table, &object.SQL); err != nil {
			return nil, err
		}
		objects = append(objects, object)
	}
	return objects, rows.Err()
}

const canonicalV15SchemaSQL = `
CREATE TABLE ai_threads (
  thread_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  namespace_public_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  execution_mode TEXT NOT NULL DEFAULT 'act',
  working_dir TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  followups_revision INTEGER NOT NULL DEFAULT 0,
  run_status TEXT NOT NULL DEFAULT 'idle',
  run_updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  run_error TEXT NOT NULL DEFAULT '',
  waiting_prompt_id TEXT NOT NULL DEFAULT '',
  waiting_message_id TEXT NOT NULL DEFAULT '',
  waiting_tool_id TEXT NOT NULL DEFAULT '',
  waiting_choices_json TEXT NOT NULL DEFAULT '',
  created_by_user_public_id TEXT NOT NULL DEFAULT '',
  created_by_user_email TEXT NOT NULL DEFAULT '',
  updated_by_user_public_id TEXT NOT NULL DEFAULT '',
  updated_by_user_email TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  last_message_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_message_preview TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_ai_threads_endpoint_updated ON ai_threads(endpoint_id, updated_at_unix_ms DESC, thread_id DESC);
CREATE TABLE ai_messages (
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
CREATE INDEX idx_ai_messages_thread_id ON ai_messages(endpoint_id, thread_id, id ASC);
CREATE TABLE ai_runs (
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
CREATE INDEX idx_ai_runs_endpoint_thread_updated ON ai_runs(endpoint_id, thread_id, updated_at_unix_ms DESC);
CREATE TABLE ai_tool_calls (
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
CREATE INDEX idx_ai_tool_calls_run_id ON ai_tool_calls(run_id, id ASC);
CREATE TABLE ai_run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  stream_kind TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_ai_run_events_run_id ON ai_run_events(run_id, id ASC);
CREATE INDEX idx_ai_run_events_endpoint_thread ON ai_run_events(endpoint_id, thread_id, id ASC);
CREATE TABLE ai_thread_state (
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  open_goal TEXT NOT NULL DEFAULT '',
  last_assistant_summary TEXT NOT NULL DEFAULT '',
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(endpoint_id, thread_id)
);
CREATE TABLE ai_thread_todos (
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  todos_json TEXT NOT NULL DEFAULT '[]',
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  updated_by_run_id TEXT NOT NULL DEFAULT '',
  updated_by_tool_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(endpoint_id, thread_id)
);
CREATE INDEX idx_ai_thread_todos_updated ON ai_thread_todos(endpoint_id, thread_id, updated_at_unix_ms DESC);
CREATE TABLE ai_queued_turns (
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
CREATE INDEX idx_ai_queued_turns_thread_created ON ai_queued_turns(endpoint_id, thread_id, created_at_unix_ms ASC, queue_id ASC);
CREATE UNIQUE INDEX idx_ai_queued_turns_message_id ON ai_queued_turns(endpoint_id, thread_id, message_id);
CREATE TABLE ai_thread_checkpoints (
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
CREATE INDEX idx_ai_thread_checkpoints_thread_created ON ai_thread_checkpoints(endpoint_id, thread_id, created_at_unix_ms DESC, checkpoint_id DESC);
CREATE INDEX idx_ai_thread_checkpoints_run_id ON ai_thread_checkpoints(run_id);
CREATE TABLE transcript_messages (
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
CREATE INDEX idx_transcript_messages_thread_id ON transcript_messages(endpoint_id, thread_id, id ASC);
CREATE TABLE conversation_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_id TEXT NOT NULL UNIQUE,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  run_id TEXT NOT NULL DEFAULT '',
  user_message_id TEXT NOT NULL DEFAULT '',
  assistant_message_id TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_conversation_turns_thread_id ON conversation_turns(endpoint_id, thread_id, id ASC);
CREATE INDEX idx_conversation_turns_run_id ON conversation_turns(run_id, id ASC);
CREATE TABLE execution_spans (
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
CREATE INDEX idx_execution_spans_thread_started ON execution_spans(endpoint_id, thread_id, started_at_unix_ms DESC, span_id DESC);
CREATE INDEX idx_execution_spans_run_started ON execution_spans(endpoint_id, run_id, started_at_unix_ms ASC, span_id ASC);
CREATE TABLE memory_items (
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
CREATE INDEX idx_memory_items_thread_updated ON memory_items(endpoint_id, thread_id, updated_at_unix_ms DESC, memory_id DESC);
CREATE INDEX idx_memory_items_scope_kind ON memory_items(endpoint_id, thread_id, scope, kind, updated_at_unix_ms DESC);
CREATE TABLE memory_embeddings (
  memory_id TEXT NOT NULL,
  embedding_model TEXT NOT NULL DEFAULT '',
  vector_blob BLOB NOT NULL,
  dim INTEGER NOT NULL DEFAULT 0,
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(memory_id, embedding_model)
);
CREATE TABLE provider_capabilities (
  provider_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  capability_json TEXT NOT NULL DEFAULT '{}',
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(provider_id, model_name)
);
`

func migrateCanonicalV15ToV16(tx *sql.Tx) error {
	_, err := tx.Exec(`
ALTER TABLE ai_queued_turns ADD COLUMN lane TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE ai_queued_turns ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_queued_turns ADD COLUMN updated_at_unix_ms INTEGER NOT NULL DEFAULT 0;
UPDATE ai_queued_turns SET updated_at_unix_ms = created_at_unix_ms WHERE updated_at_unix_ms <= 0;
UPDATE ai_queued_turns AS cur
SET sort_index = (
  SELECT COUNT(1)
  FROM ai_queued_turns AS other
  WHERE other.endpoint_id = cur.endpoint_id
    AND other.thread_id = cur.thread_id
    AND LOWER(other.lane) = LOWER(cur.lane)
    AND (
      other.created_at_unix_ms < cur.created_at_unix_ms
      OR (other.created_at_unix_ms = cur.created_at_unix_ms AND other.queue_id <= cur.queue_id)
    )
)
WHERE sort_index <= 0;
CREATE INDEX idx_ai_queued_turns_thread_lane_sort
ON ai_queued_turns(endpoint_id, thread_id, lane, sort_index ASC, queue_id ASC);
`)
	return err
}

func migrateCanonicalV16ToV17(tx *sql.Tx) error {
	_, err := tx.Exec(`
ALTER TABLE ai_threads ADD COLUMN waiting_user_input_json TEXT NOT NULL DEFAULT '';
CREATE TABLE structured_user_inputs (
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
CREATE INDEX idx_structured_user_inputs_recent
ON structured_user_inputs(endpoint_id, thread_id, id DESC);
CREATE TABLE request_user_input_secret_answers (
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
CREATE INDEX idx_request_user_input_secret_answers_message
ON request_user_input_secret_answers(endpoint_id, thread_id, response_message_id, question_id, answer_index);
`)
	return err
}

func migrateCanonicalV17ToV18(tx *sql.Tx) error {
	_, err := tx.Exec(`
ALTER TABLE ai_threads ADD COLUMN title_source TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_threads ADD COLUMN title_generated_at_unix_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_threads ADD COLUMN title_input_message_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_threads ADD COLUMN title_model_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_threads ADD COLUMN title_prompt_version TEXT NOT NULL DEFAULT '';
`)
	return err
}

func migrateCanonicalV18ToV19(tx *sql.Tx) error {
	_, err := tx.Exec(`DROP TABLE memory_embeddings`)
	return err
}

func migrateCanonicalV19ToV20(tx *sql.Tx) error {
	_, err := tx.Exec(`ALTER TABLE ai_threads ADD COLUMN last_context_run_id TEXT NOT NULL DEFAULT ''`)
	return err
}

func migrateCanonicalV20ToV21(tx *sql.Tx) error {
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

func migrateCanonicalV21ToV22(tx *sql.Tx) error {
	_, err := tx.Exec(`
ALTER TABLE ai_thread_state ADD COLUMN provider_continuation_kind TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_thread_state ADD COLUMN provider_continuation_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_thread_state ADD COLUMN provider_continuation_provider_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_thread_state ADD COLUMN provider_continuation_model TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_thread_state ADD COLUMN provider_continuation_base_url TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_thread_state ADD COLUMN provider_continuation_updated_at_unix_ms INTEGER NOT NULL DEFAULT 0;
`)
	return err
}

func migrateCanonicalV22ToV23(tx *sql.Tx) error {
	_, err := tx.Exec(`
ALTER TABLE ai_queued_turns ADD COLUMN session_meta_json TEXT NOT NULL DEFAULT '{}';
UPDATE ai_queued_turns SET session_meta_json = '{}' WHERE TRIM(session_meta_json) = '';
`)
	return err
}

func migrateCanonicalV23ToV24(tx *sql.Tx) error {
	_, err := tx.Exec(`
DROP INDEX idx_ai_queued_turns_message_id;
CREATE UNIQUE INDEX idx_ai_queued_turns_lane_message_id
ON ai_queued_turns(endpoint_id, thread_id, lane, message_id);
`)
	return err
}

func migrateCanonicalV24ToV25(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_activity_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  tool_id TEXT NOT NULL DEFAULT '',
  tool_name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  renderer TEXT NOT NULL,
  status TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'normal',
  summary_json TEXT NOT NULL DEFAULT '{}',
  detail_refs_json TEXT NOT NULL DEFAULT '[]',
  target_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  order_index INTEGER NOT NULL DEFAULT 0,
  started_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  ended_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  UNIQUE(run_id, item_id)
);
CREATE INDEX idx_ai_activity_items_run_order ON ai_activity_items(run_id, order_index ASC, id ASC);
CREATE INDEX idx_ai_activity_items_thread ON ai_activity_items(endpoint_id, thread_id, id ASC);
ALTER TABLE ai_thread_checkpoints ADD COLUMN activity_items_max_id INTEGER NOT NULL DEFAULT 0;
`)
	return err
}

func migrateCanonicalV25ToV26(tx *sql.Tx) error {
	if _, err := tx.Exec(`
DROP TABLE ai_activity_items;
DROP INDEX idx_ai_thread_checkpoints_thread_created;
DROP INDEX idx_ai_thread_checkpoints_run_id;
ALTER TABLE ai_thread_checkpoints RENAME TO canonical_v25_thread_checkpoints;
CREATE TABLE ai_thread_checkpoints (
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
INSERT INTO ai_thread_checkpoints(
  checkpoint_id, endpoint_id, thread_id, run_id, kind, created_at_unix_ms,
  thread_json, derived_json, workspace_json, transcript_max_id, turns_max_id,
  tool_calls_max_id, run_events_max_id
)
SELECT
  checkpoint_id, endpoint_id, thread_id, run_id, kind, created_at_unix_ms,
  thread_json, derived_json, workspace_json, transcript_max_id, turns_max_id,
  tool_calls_max_id, run_events_max_id
FROM canonical_v25_thread_checkpoints;
DROP TABLE canonical_v25_thread_checkpoints;
CREATE INDEX idx_ai_thread_checkpoints_thread_created ON ai_thread_checkpoints(endpoint_id, thread_id, created_at_unix_ms DESC, checkpoint_id DESC);
CREATE INDEX idx_ai_thread_checkpoints_run_id ON ai_thread_checkpoints(run_id);
`); err != nil {
		return err
	}
	return nil
}

func migrateCanonicalV26ToV27(tx *sql.Tx) error {
	_, err := tx.Exec(`ALTER TABLE ai_queued_turns ADD COLUMN context_action_json TEXT NOT NULL DEFAULT ''`)
	return err
}

func migrateCanonicalV27ToV28(tx *sql.Tx) error {
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

func migrateCanonicalV28ToV29(tx *sql.Tx) error {
	_, err := tx.Exec(`
ALTER TABLE ai_flower_thread_metadata ADD COLUMN home_host_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_flower_thread_metadata ADD COLUMN home_host_kind TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_flower_thread_metadata ADD COLUMN origin_env_public_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_flower_thread_metadata ADD COLUMN primary_target_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_flower_thread_metadata ADD COLUMN active_target_ids_json TEXT NOT NULL DEFAULT '[]';
`)
	return err
}

func migrateCanonicalV29ToV30(tx *sql.Tx) error {
	_, err := tx.Exec(`
ALTER TABLE ai_threads ADD COLUMN pinned_at_unix_ms INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_ai_threads_endpoint_pinned_created
ON ai_threads(endpoint_id, pinned_at_unix_ms DESC, created_at_unix_ms DESC, thread_id ASC);
`)
	return err
}

func migrateCanonicalV30ToV31(tx *sql.Tx) error {
	_, err := tx.Exec(`
ALTER TABLE ai_threads ADD COLUMN run_error_code TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_flower_thread_metadata ADD COLUMN home_runtime_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_flower_thread_metadata ADD COLUMN home_runtime_kind TEXT NOT NULL DEFAULT '';
`)
	return err
}

func migrateCanonicalV31ToV32(tx *sql.Tx) error {
	_, err := tx.Exec(`ALTER TABLE ai_thread_state ADD COLUMN provider_continuation_state_json TEXT NOT NULL DEFAULT ''`)
	return err
}

func migrateCanonicalV32ToV33(tx *sql.Tx) error {
	_, err := tx.Exec(`ALTER TABLE ai_threads ADD COLUMN reasoning_selection_json TEXT NOT NULL DEFAULT ''`)
	return err
}

func migrateCanonicalV33ToV34(tx *sql.Tx) error {
	_, err := tx.Exec(`
ALTER TABLE ai_threads ADD COLUMN flower_activity_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_threads ADD COLUMN flower_activity_signature TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_threads ADD COLUMN flower_activity_waiting_prompt_id TEXT NOT NULL DEFAULT '';
`)
	return err
}

func migrateCanonicalV34ToV35(tx *sql.Tx) error {
	_, err := tx.Exec(`
ALTER TABLE ai_threads ADD COLUMN permission_type TEXT NOT NULL DEFAULT 'approval_required';
UPDATE ai_threads
SET permission_type = CASE
  WHEN lower(trim(execution_mode)) = 'plan' THEN 'readonly'
  ELSE 'approval_required'
END;
`)
	return err
}

func migrateCanonicalV35ToV36(tx *sql.Tx) error {
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
CREATE TABLE ai_delegated_approval_requests (
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
CREATE UNIQUE INDEX idx_ai_delegated_approval_ref ON ai_delegated_approval_requests(endpoint_id, parent_thread_id, ref_hash);
CREATE INDEX idx_ai_delegated_approval_thread_status ON ai_delegated_approval_requests(endpoint_id, parent_thread_id, status, updated_at_unix_ms DESC);
CREATE TABLE ai_delegated_approval_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id TEXT NOT NULL,
  parent_thread_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_ai_delegated_approval_events_action ON ai_delegated_approval_events(endpoint_id, action_id, id ASC);
CREATE TABLE ai_delegated_approval_outbox (
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
CREATE INDEX idx_ai_delegated_approval_outbox_pending ON ai_delegated_approval_outbox(endpoint_id, delivery_state, id ASC);
CREATE TABLE ai_delegated_approval_idempotency (
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
CREATE INDEX idx_ai_delegated_approval_idempotency_action ON ai_delegated_approval_idempotency(endpoint_id, action_id);
`)
	return err
}

func migrateCanonicalV36ToV37(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TEMP TABLE canonical_v36_projection_threads (
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  PRIMARY KEY(endpoint_id, thread_id)
);
INSERT INTO canonical_v36_projection_threads(endpoint_id, thread_id)
SELECT endpoint_id, thread_id
FROM ai_flower_thread_metadata
WHERE LOWER(TRIM(owner_kind)) = 'subagent_projection'
  AND LOWER(TRIM(owner_id)) = 'floret'
  AND TRIM(endpoint_id) <> ''
  AND TRIM(thread_id) <> '';
DELETE FROM ai_messages
WHERE EXISTS (
  SELECT 1 FROM canonical_v36_projection_threads legacy
  WHERE legacy.endpoint_id = ai_messages.endpoint_id AND legacy.thread_id = ai_messages.thread_id
);
DELETE FROM transcript_messages
WHERE EXISTS (
  SELECT 1 FROM canonical_v36_projection_threads legacy
  WHERE legacy.endpoint_id = transcript_messages.endpoint_id AND legacy.thread_id = transcript_messages.thread_id
);
DELETE FROM ai_flower_thread_metadata
WHERE EXISTS (
  SELECT 1 FROM canonical_v36_projection_threads legacy
  WHERE legacy.endpoint_id = ai_flower_thread_metadata.endpoint_id AND legacy.thread_id = ai_flower_thread_metadata.thread_id
);
DELETE FROM ai_threads
WHERE EXISTS (
  SELECT 1 FROM canonical_v36_projection_threads legacy
  WHERE legacy.endpoint_id = ai_threads.endpoint_id AND legacy.thread_id = ai_threads.thread_id
);
DROP TABLE canonical_v36_projection_threads;
`)
	return err
}

func migrateCanonicalV37ToV38(tx *sql.Tx) error {
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
CREATE INDEX idx_ai_thread_fork_operations_status_updated
ON ai_thread_fork_operations(status, updated_at_unix_ms ASC, operation_id ASC);
CREATE INDEX idx_ai_thread_fork_operations_source
ON ai_thread_fork_operations(endpoint_id, source_thread_id, created_at_unix_ms DESC);
`)
	return err
}

func migrateCanonicalV38ToV39(tx *sql.Tx) error {
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
CREATE INDEX idx_ai_thread_delete_operations_status_updated
ON ai_thread_delete_operations(status, updated_at_unix_ms ASC, operation_id ASC);
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

func migrateCanonicalV39ToV40(tx *sql.Tx) error {
	_, err := tx.Exec(`
DROP TABLE ai_tool_calls;
DROP TABLE execution_spans;
DROP INDEX idx_ai_thread_checkpoints_thread_created;
DROP INDEX idx_ai_thread_checkpoints_run_id;
ALTER TABLE ai_thread_checkpoints RENAME TO canonical_v39_thread_checkpoints;
CREATE TABLE ai_thread_checkpoints (
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
INSERT INTO ai_thread_checkpoints(
  checkpoint_id, endpoint_id, thread_id, run_id, kind, created_at_unix_ms,
  thread_json, derived_json, workspace_json, transcript_max_id, turns_max_id, run_events_max_id
)
SELECT
  checkpoint_id, endpoint_id, thread_id, run_id, kind, created_at_unix_ms,
  thread_json, derived_json, workspace_json, transcript_max_id, turns_max_id, run_events_max_id
FROM canonical_v39_thread_checkpoints;
DROP TABLE canonical_v39_thread_checkpoints;
CREATE INDEX idx_ai_thread_checkpoints_thread_created ON ai_thread_checkpoints(endpoint_id, thread_id, created_at_unix_ms DESC, checkpoint_id DESC);
CREATE INDEX idx_ai_thread_checkpoints_run_id ON ai_thread_checkpoints(run_id);
`)
	return err
}

func ensureCanonicalThreadIdentities(tx *sql.Tx, ensureThread func(string) error) error {
	rows, err := tx.Query(`
SELECT thread_id FROM ai_threads
UNION SELECT thread_id FROM ai_queued_turns
UNION SELECT thread_id FROM ai_upload_refs
UNION SELECT thread_id FROM ai_flower_thread_metadata
UNION SELECT parent_thread_id FROM ai_flower_thread_metadata
UNION SELECT source_thread_id FROM ai_flower_transfers
UNION SELECT destination_thread_id FROM ai_flower_transfers
UNION SELECT source_thread_id FROM ai_flower_handoffs
UNION SELECT destination_thread_id FROM ai_flower_handoffs
UNION SELECT owner_thread_id FROM ai_permission_snapshots
UNION SELECT parent_thread_id FROM ai_child_permission_snapshots
UNION SELECT child_thread_id FROM ai_child_permission_snapshots
UNION SELECT source_thread_id FROM ai_thread_fork_operations
UNION SELECT destination_thread_id FROM ai_thread_fork_operations
UNION SELECT thread_id FROM ai_thread_delete_operations
`)
	if err != nil {
		return err
	}
	var threadIDs []string
	for rows.Next() {
		var threadID string
		if err := rows.Scan(&threadID); err != nil {
			_ = rows.Close()
			return err
		}
		threadID = strings.TrimSpace(threadID)
		if threadID != "" {
			threadIDs = append(threadIDs, threadID)
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	sort.Strings(threadIDs)
	for _, threadID := range threadIDs {
		if err := ensureThread(threadID); err != nil {
			return fmt.Errorf("ensure Floret thread %q before canonical conversion: %w", threadID, err)
		}
	}
	return nil
}

func validateCanonicalProductData(tx *sql.Tx) error {
	var invalid int
	checks := []struct {
		label string
		query string
	}{
		{label: "threads", query: `SELECT COUNT(1) FROM ai_threads WHERE TRIM(thread_id) = '' OR TRIM(endpoint_id) = ''`},
		{label: "thread permissions", query: `SELECT COUNT(1) FROM ai_threads WHERE permission_type NOT IN ('readonly', 'approval_required', 'full_access')`},
		{label: "upload references", query: `SELECT COUNT(1) FROM ai_upload_refs WHERE TRIM(endpoint_id) = '' OR TRIM(upload_id) = '' OR TRIM(thread_id) = '' OR TRIM(ref_kind) = '' OR TRIM(ref_id) = ''`},
		{label: "fork operations", query: `SELECT COUNT(1) FROM ai_thread_fork_operations WHERE TRIM(operation_id) = '' OR TRIM(endpoint_id) = '' OR TRIM(source_thread_id) = '' OR TRIM(destination_thread_id) = ''`},
		{label: "delete operations", query: `SELECT COUNT(1) FROM ai_thread_delete_operations WHERE TRIM(operation_id) = '' OR TRIM(endpoint_id) = '' OR TRIM(thread_id) = ''`},
		{label: "permission snapshots", query: `SELECT COUNT(1) FROM ai_permission_snapshots WHERE permission_type NOT IN ('readonly', 'approval_required', 'full_access')`},
	}
	for _, check := range checks {
		if err := tx.QueryRow(check.query).Scan(&invalid); err != nil {
			return err
		}
		if invalid > 0 {
			return fmt.Errorf("canonical %s contain %d rows with invalid product data", check.label, invalid)
		}
	}
	if err := tx.QueryRow(`
SELECT COUNT(1)
FROM ai_queued_turns
WHERE TRIM(queue_id) = '' OR TRIM(endpoint_id) = '' OR TRIM(thread_id) = '' OR TRIM(message_id) = ''
`).Scan(&invalid); err != nil {
		return err
	}
	if invalid > 0 {
		return fmt.Errorf("canonical queued turns contain %d rows with incomplete identity", invalid)
	}
	if err := tx.QueryRow(`
SELECT COUNT(1)
FROM (
  SELECT endpoint_id, thread_id, message_id
  FROM ai_queued_turns
  GROUP BY endpoint_id, thread_id, message_id
  HAVING COUNT(1) > 1
)
`).Scan(&invalid); err != nil {
		return err
	}
	if invalid > 0 {
		return fmt.Errorf("canonical queued turns contain %d duplicate turn identities", invalid)
	}
	return nil
}

func convertCanonicalV40ToProductV1(tx *sql.Tx) error {
	if _, err := tx.Exec(`
DROP TRIGGER trg_ai_threads_reject_retired_id;
DROP INDEX idx_ai_threads_endpoint_updated;
DROP INDEX idx_ai_threads_endpoint_pinned_created;
DROP INDEX idx_ai_queued_turns_thread_created;
DROP INDEX idx_ai_queued_turns_thread_lane_sort;
DROP INDEX idx_ai_queued_turns_lane_message_id;
DROP INDEX idx_ai_uploads_endpoint_created;
DROP INDEX idx_ai_uploads_state_delete_after;
DROP INDEX idx_ai_upload_refs_unique_ref;
DROP INDEX idx_ai_upload_refs_thread_upload;
DROP INDEX idx_ai_upload_refs_upload;
DROP INDEX idx_ai_flower_thread_metadata_owner;
DROP INDEX idx_ai_flower_thread_metadata_parent;
DROP INDEX idx_ai_flower_transfers_idempotency;
DROP INDEX idx_ai_flower_transfers_source;
DROP INDEX idx_ai_flower_transfers_destination;
DROP INDEX idx_ai_flower_handoffs_idempotency;
DROP INDEX idx_ai_flower_handoffs_source;
DROP INDEX idx_ai_flower_handoffs_destination;
DROP INDEX idx_ai_permission_snapshots_owner;
DROP INDEX idx_ai_child_permission_snapshots_spawn;
DROP INDEX idx_ai_child_permission_snapshots_parent;
DROP INDEX idx_ai_child_permission_snapshots_child;
DROP INDEX idx_ai_thread_fork_operations_status_updated;
DROP INDEX idx_ai_thread_fork_operations_source;
DROP INDEX idx_ai_thread_delete_operations_status_updated;

ALTER TABLE ai_threads RENAME TO canonical_v40_ai_threads;
ALTER TABLE ai_queued_turns RENAME TO canonical_v40_ai_queued_turns;
ALTER TABLE provider_capabilities RENAME TO canonical_v40_provider_capabilities;
ALTER TABLE ai_uploads RENAME TO canonical_v40_ai_uploads;
ALTER TABLE ai_upload_refs RENAME TO canonical_v40_ai_upload_refs;
ALTER TABLE ai_flower_thread_metadata RENAME TO canonical_v40_ai_flower_thread_metadata;
ALTER TABLE ai_flower_transfers RENAME TO canonical_v40_ai_flower_transfers;
ALTER TABLE ai_flower_handoffs RENAME TO canonical_v40_ai_flower_handoffs;
ALTER TABLE ai_permission_snapshots RENAME TO canonical_v40_ai_permission_snapshots;
ALTER TABLE ai_child_permission_snapshots RENAME TO canonical_v40_ai_child_permission_snapshots;
ALTER TABLE ai_thread_fork_operations RENAME TO canonical_v40_ai_thread_fork_operations;
ALTER TABLE ai_thread_delete_operations RENAME TO canonical_v40_ai_thread_delete_operations;

DROP TABLE ai_messages;
DROP TABLE ai_runs;
DROP TABLE ai_run_events;
DROP TABLE ai_thread_state;
DROP TABLE ai_thread_todos;
DROP TABLE ai_thread_checkpoints;
DROP TABLE transcript_messages;
DROP TABLE conversation_turns;
DROP TABLE structured_user_inputs;
DROP TABLE request_user_input_secret_answers;
DROP TABLE memory_items;
DROP TABLE ai_delegated_approval_requests;
DROP TABLE ai_delegated_approval_events;
DROP TABLE ai_delegated_approval_outbox;
DROP TABLE ai_delegated_approval_idempotency;
`); err != nil {
		return err
	}
	if err := createThreadstoreSchemaV1(tx); err != nil {
		return err
	}
	if _, err := tx.Exec(`
INSERT INTO ai_threads(
  thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json,
  permission_type, working_dir, title, title_source, title_generated_at_unix_ms,
  title_input_message_id, title_model_id, title_prompt_version, followups_revision,
  pinned_at_unix_ms, created_by_user_public_id, created_by_user_email,
  updated_by_user_public_id, updated_by_user_email, created_at_unix_ms, updated_at_unix_ms
)
SELECT
  thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json,
  permission_type, working_dir, title, title_source, title_generated_at_unix_ms,
  title_input_message_id, title_model_id, title_prompt_version, followups_revision,
  pinned_at_unix_ms, created_by_user_public_id, created_by_user_email,
  updated_by_user_public_id, updated_by_user_email, created_at_unix_ms, updated_at_unix_ms
FROM canonical_v40_ai_threads;

INSERT INTO ai_queued_turns(
  queue_id, endpoint_id, thread_id, channel_id, lane, sort_index, turn_id, run_id,
  model_id, text_content, attachments_json, context_action_json, options_json,
  session_meta_json, created_by_user_public_id, created_by_user_email,
  created_at_unix_ms, updated_at_unix_ms
)
SELECT
  queue_id, endpoint_id, thread_id, channel_id, lane, sort_index, message_id,
  'run_migrated_' || queue_id, model_id, text_content, attachments_json,
  context_action_json, options_json, session_meta_json, created_by_user_public_id,
  created_by_user_email, created_at_unix_ms, updated_at_unix_ms
FROM canonical_v40_ai_queued_turns;

INSERT INTO provider_capabilities(provider_id, model_name, capability_json, updated_at_unix_ms)
SELECT provider_id, model_name, capability_json, updated_at_unix_ms
FROM canonical_v40_provider_capabilities;

INSERT INTO ai_uploads(upload_id, endpoint_id, storage_relpath, name, mime_type, size_bytes, state, created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms)
SELECT upload_id, endpoint_id, storage_relpath, name, mime_type, size_bytes, state, created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms
FROM canonical_v40_ai_uploads;

INSERT INTO ai_upload_refs(id, endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
SELECT id, endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms
FROM canonical_v40_ai_upload_refs;

INSERT INTO ai_flower_thread_metadata(
  endpoint_id, thread_id, owner_kind, owner_id, parent_thread_id, parent_run_id,
  context_json, action_json, updated_at_unix_ms, home_runtime_id, home_runtime_kind,
  origin_env_public_id, primary_target_id, active_target_ids_json
)
SELECT
  endpoint_id, thread_id, owner_kind, owner_id, parent_thread_id, parent_run_id,
  context_json, action_json, updated_at_unix_ms, home_runtime_id, home_runtime_kind,
  origin_env_public_id, primary_target_id, active_target_ids_json
FROM canonical_v40_ai_flower_thread_metadata;

INSERT INTO ai_flower_transfers(transfer_id, endpoint_id, source_thread_id, destination_thread_id, idempotency_key, manifest_hash, approval_hash, state, plan_json, created_at_unix_ms, updated_at_unix_ms)
SELECT transfer_id, endpoint_id, source_thread_id, destination_thread_id, idempotency_key, manifest_hash, approval_hash, state, plan_json, created_at_unix_ms, updated_at_unix_ms
FROM canonical_v40_ai_flower_transfers;

INSERT INTO ai_flower_handoffs(handoff_id, endpoint_id, source_thread_id, destination_thread_id, idempotency_key, envelope_hash, state, envelope_json, created_at_unix_ms, updated_at_unix_ms)
SELECT handoff_id, endpoint_id, source_thread_id, destination_thread_id, idempotency_key, envelope_hash, state, envelope_json, created_at_unix_ms, updated_at_unix_ms
FROM canonical_v40_ai_flower_handoffs;

INSERT INTO ai_permission_snapshots(snapshot_id, endpoint_id, owner_thread_id, owner_run_id, permission_type, snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash, created_at_unix_ms)
SELECT snapshot_id, endpoint_id, owner_thread_id, owner_run_id, permission_type, snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash, created_at_unix_ms
FROM canonical_v40_ai_permission_snapshots;

INSERT INTO ai_child_permission_snapshots(child_snapshot_id, endpoint_id, parent_snapshot_id, spawn_tool_call_id, parent_thread_id, parent_run_id, subagent_id, child_thread_id, child_run_id, state, snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash, created_at_unix_ms, finalized_at_unix_ms)
SELECT child_snapshot_id, endpoint_id, parent_snapshot_id, spawn_tool_call_id, parent_thread_id, parent_run_id, subagent_id, child_thread_id, child_run_id, state, snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash, created_at_unix_ms, finalized_at_unix_ms
FROM canonical_v40_ai_child_permission_snapshots;

	INSERT INTO ai_thread_fork_operations(operation_id, endpoint_id, source_thread_id, destination_thread_id, request_fingerprint, status, snapshot_schema_version, snapshot_json, floret_result_json, retry_count, error_code, error_message, source_broadcasted_at_unix_ms, destination_broadcasted_at_unix_ms, created_at_unix_ms, updated_at_unix_ms)
	SELECT operation_id, endpoint_id, source_thread_id, destination_thread_id, request_fingerprint, status, snapshot_schema_version, snapshot_json, '', retry_count, error_code, error_message, source_broadcasted_at_unix_ms, destination_broadcasted_at_unix_ms, created_at_unix_ms, updated_at_unix_ms
FROM canonical_v40_ai_thread_fork_operations;

INSERT INTO ai_thread_delete_operations(operation_id, endpoint_id, thread_id, status, snapshot_schema_version, snapshot_json, read_state_required, product_data_deleted_at_unix_ms, files_cleaned_at_unix_ms, floret_deleted_at_unix_ms, read_state_deleted_at_unix_ms, retry_count, error_code, error_message, created_at_unix_ms, updated_at_unix_ms, committed_at_unix_ms)
SELECT operation_id, endpoint_id, thread_id, status, snapshot_schema_version, snapshot_json, read_state_required, product_data_deleted_at_unix_ms, files_cleaned_at_unix_ms, floret_deleted_at_unix_ms, read_state_deleted_at_unix_ms, retry_count, error_code, error_message, created_at_unix_ms, updated_at_unix_ms, committed_at_unix_ms
FROM canonical_v40_ai_thread_delete_operations;

DROP TABLE canonical_v40_ai_threads;
DROP TABLE canonical_v40_ai_queued_turns;
DROP TABLE canonical_v40_provider_capabilities;
DROP TABLE canonical_v40_ai_uploads;
DROP TABLE canonical_v40_ai_upload_refs;
DROP TABLE canonical_v40_ai_flower_thread_metadata;
DROP TABLE canonical_v40_ai_flower_transfers;
DROP TABLE canonical_v40_ai_flower_handoffs;
DROP TABLE canonical_v40_ai_permission_snapshots;
DROP TABLE canonical_v40_ai_child_permission_snapshots;
DROP TABLE canonical_v40_ai_thread_fork_operations;
DROP TABLE canonical_v40_ai_thread_delete_operations;
`); err != nil {
		return err
	}
	return nil
}
