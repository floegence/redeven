package legacydb

import (
	"database/sql"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

func SeedThreadstoreV15(dbPath string) error {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o700); err != nil {
		return err
	}
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return err
	}
	defer func() { _ = raw.Close() }()

	_, err = raw.Exec(`
CREATE TABLE IF NOT EXISTS ai_threads (
  thread_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  namespace_public_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  model_locked INTEGER NOT NULL DEFAULT 0,
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
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(endpoint_id, thread_id)
);
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
PRAGMA user_version=15;
`)
	return err
}
