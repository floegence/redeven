package codeapp

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/floegence/redeven-agent/internal/session"
	"testing"

	_ "modernc.org/sqlite"
)

func TestNewMigratesLegacyFollowupQueueSchema(t *testing.T) {
	t.Parallel()

	stateDir := t.TempDir()
	dbPath := filepath.Join(stateDir, "ai", "threads.sqlite")
	if err := seedLegacyFollowupQueueDB(dbPath); err != nil {
		t.Fatalf("seedLegacyFollowupQueueDB: %v", err)
	}

	svc, err := New(context.Background(), Options{
		Logger:     slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError})),
		StateDir:   stateDir,
		ConfigPath: filepath.Join(stateDir, "config.json"),
		FSRoot:     stateDir,
		Shell:      "/bin/sh",
		ResolveSessionMeta: func(string) (*session.Meta, bool) {
			return nil, false
		},
		ResolveSessionTunnelURL: func(string) (string, bool) {
			return "", false
		},
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer func() { _ = svc.Close() }()

	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer func() { _ = raw.Close() }()

	var version int
	if err := raw.QueryRow(`PRAGMA user_version;`).Scan(&version); err != nil {
		t.Fatalf("read user_version: %v", err)
	}
	if version != 16 {
		t.Fatalf("user_version=%d, want 16", version)
	}

	var laneColCount int
	if err := raw.QueryRow(`
SELECT COUNT(1)
FROM pragma_table_info('ai_queued_turns')
WHERE name = 'lane'
`).Scan(&laneColCount); err != nil {
		t.Fatalf("check lane column: %v", err)
	}
	if laneColCount != 1 {
		t.Fatalf("lane column count=%d, want 1", laneColCount)
	}
}

func seedLegacyFollowupQueueDB(dbPath string) error {
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
PRAGMA user_version=15;
`)
	return err
}
