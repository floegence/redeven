package threadstore

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func TestStore_OpenCurrentSchemaWithoutMetaBackfillsMetadata(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	if _, err := raw.Exec(`DROP TABLE __redeven_db_meta;`); err != nil {
		_ = raw.Close()
		t.Fatalf("drop meta table: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close raw db: %v", err)
	}

	s, err = Open(dbPath)
	if err != nil {
		t.Fatalf("Open without meta: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	var kind string
	if err := s.db.QueryRowContext(ctx, `SELECT db_kind FROM __redeven_db_meta WHERE singleton = 1`).Scan(&kind); err != nil {
		t.Fatalf("read db kind: %v", err)
	}
	if kind != threadstoreSchemaKind {
		t.Fatalf("db kind=%q, want %q", kind, threadstoreSchemaKind)
	}
}

func TestStore_OpenResettingInvalidSchemaRebuildsCurrentDatabase(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := s.CreateThread(context.Background(), Thread{ThreadID: "th_old", EndpointID: "env_1", Title: "old"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	if _, err := raw.Exec(`
DROP TABLE structured_user_inputs;
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
  response_text TEXT NOT NULL DEFAULT '',
  public_summary TEXT NOT NULL DEFAULT '',
  contains_secret INTEGER NOT NULL DEFAULT 0,
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  UNIQUE(endpoint_id, thread_id, response_message_id, question_id)
);
CREATE INDEX idx_structured_user_inputs_recent
ON structured_user_inputs(endpoint_id, thread_id, id DESC);
`); err != nil {
		_ = raw.Close()
		t.Fatalf("break structured_user_inputs schema: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close raw db: %v", err)
	}

	_, err = Open(dbPath)
	var schemaErr *sqliteutil.SchemaVerifyError
	if !errors.As(err, &schemaErr) {
		t.Fatalf("Open error=%v, want SchemaVerifyError", err)
	}

	s, err = OpenResettingInvalidSchema(dbPath)
	if err != nil {
		t.Fatalf("OpenResettingInvalidSchema: %v", err)
	}
	defer func() { _ = s.Close() }()

	if !tableHasColumnForTest(t, s.db, "structured_user_inputs", "selected_choice_id") {
		t.Fatalf("rebuilt structured_user_inputs is missing selected_choice_id")
	}
	if got := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_threads`); got != 0 {
		t.Fatalf("ai_threads row count=%d, want reset database", got)
	}
	var version int
	if err := s.db.QueryRow(`PRAGMA user_version;`).Scan(&version); err != nil {
		t.Fatalf("read user_version: %v", err)
	}
	if version != CurrentSchemaVersion() {
		t.Fatalf("user_version=%d, want %d", version, CurrentSchemaVersion())
	}
}
