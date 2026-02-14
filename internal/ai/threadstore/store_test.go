package threadstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestStore_UpdateThreadRunState(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	th, err := s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if th == nil {
		t.Fatalf("thread missing")
	}
	if th.RunStatus != "idle" {
		t.Fatalf("RunStatus=%q, want idle", th.RunStatus)
	}

	if err := s.UpdateThreadRunState(ctx, "env_1", "th_1", "running", "", "u1", "u1@example.com"); err != nil {
		t.Fatalf("UpdateThreadRunState running: %v", err)
	}
	th, err = s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread after running: %v", err)
	}
	if th.RunStatus != "running" {
		t.Fatalf("RunStatus=%q, want running", th.RunStatus)
	}
	if th.RunUpdatedAtUnixMs <= 0 {
		t.Fatalf("RunUpdatedAtUnixMs=%d, want > 0", th.RunUpdatedAtUnixMs)
	}

	if err := s.UpdateThreadRunState(ctx, "env_1", "th_1", "failed", strings.Repeat("x", 900), "u1", "u1@example.com"); err != nil {
		t.Fatalf("UpdateThreadRunState failed: %v", err)
	}
	th, err = s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread after failed: %v", err)
	}
	if th.RunStatus != "failed" {
		t.Fatalf("RunStatus=%q, want failed", th.RunStatus)
	}
	if got := len([]rune(th.RunError)); got != 600 {
		t.Fatalf("RunError rune len=%d, want 600", got)
	}

	if err := s.UpdateThreadRunState(ctx, "env_1", "th_1", "success", "should be cleared", "u1", "u1@example.com"); err != nil {
		t.Fatalf("UpdateThreadRunState success: %v", err)
	}
	th, err = s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread after success: %v", err)
	}
	if th.RunStatus != "success" {
		t.Fatalf("RunStatus=%q, want success", th.RunStatus)
	}
	if th.RunError != "" {
		t.Fatalf("RunError=%q, want empty", th.RunError)
	}
}

func TestStore_MigrateFromV1AddsRunColumns(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	_, err = raw.Exec(`
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
PRAGMA user_version=1;
`)
	if err != nil {
		t.Fatalf("init v1 schema: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close raw db: %v", err)
	}

	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open with migration: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(ai_threads)`)
	if err != nil {
		t.Fatalf("PRAGMA table_info: %v", err)
	}
	defer rows.Close()

	cols := map[string]bool{}
	for rows.Next() {
		var cid int
		var name string
		var typ string
		var notNull int
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk); err != nil {
			t.Fatalf("scan table_info: %v", err)
		}
		cols[strings.TrimSpace(name)] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows err: %v", err)
	}

	for _, col := range []string{"model_id", "run_status", "run_updated_at_unix_ms", "run_error"} {
		if !cols[col] {
			t.Fatalf("missing migrated column %q", col)
		}
	}

	for _, table := range []string{"ai_runs", "ai_tool_calls", "ai_run_events", "ai_thread_todos", "transcript_messages", "conversation_turns", "execution_spans", "memory_items", "context_snapshots", "provider_capabilities"} {
		var exists int
		if err := s.db.QueryRowContext(ctx, `
SELECT COUNT(1)
FROM sqlite_master
WHERE type = 'table' AND name = ?
`, table).Scan(&exists); err != nil {
			t.Fatalf("check table %s: %v", table, err)
		}
		if exists == 0 {
			t.Fatalf("missing migrated table %q", table)
		}
	}

	var version int
	if err := s.db.QueryRowContext(ctx, `PRAGMA user_version;`).Scan(&version); err != nil {
		t.Fatalf("read user_version: %v", err)
	}
	if version != 7 {
		t.Fatalf("user_version=%d, want 7", version)
	}
}

func TestStore_UpdateThreadModelID_DoesNotTouchUpdatedAt(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	th, err := s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if th == nil {
		t.Fatalf("thread missing")
	}
	updatedAt := th.UpdatedAtUnixMs
	if updatedAt <= 0 {
		t.Fatalf("UpdatedAtUnixMs=%d, want > 0", updatedAt)
	}

	if err := s.UpdateThreadModelID(ctx, "env_1", "th_1", "openai/gpt-5-mini"); err != nil {
		t.Fatalf("UpdateThreadModelID: %v", err)
	}

	th, err = s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread after update: %v", err)
	}
	if th == nil {
		t.Fatalf("thread missing after update")
	}
	if th.ModelID != "openai/gpt-5-mini" {
		t.Fatalf("ModelID=%q, want %q", th.ModelID, "openai/gpt-5-mini")
	}
	if th.UpdatedAtUnixMs != updatedAt {
		t.Fatalf("UpdatedAtUnixMs changed: got=%d want=%d", th.UpdatedAtUnixMs, updatedAt)
	}
}

func TestStore_ListRecentThreadToolCalls(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()

	if err := s.UpsertRun(ctx, RunRecord{
		RunID:      "run_a",
		EndpointID: "env_1",
		ThreadID:   "th_1",
		MessageID:  "msg_a",
		State:      "running",
	}); err != nil {
		t.Fatalf("UpsertRun run_a: %v", err)
	}
	if err := s.UpsertToolCall(ctx, ToolCallRecord{
		RunID:      "run_a",
		ToolID:     "tool_a",
		ToolName:   "terminal.exec",
		Status:     "success",
		ArgsJSON:   `{"command":"pwd","cwd":"/"}`,
		ResultJSON: `{"stdout":"/\n","exit_code":0}`,
	}); err != nil {
		t.Fatalf("UpsertToolCall tool_a: %v", err)
	}

	if err := s.UpsertRun(ctx, RunRecord{
		RunID:      "run_b",
		EndpointID: "env_1",
		ThreadID:   "th_1",
		MessageID:  "msg_b",
		State:      "running",
	}); err != nil {
		t.Fatalf("UpsertRun run_b: %v", err)
	}
	if err := s.UpsertToolCall(ctx, ToolCallRecord{
		RunID:        "run_b",
		ToolID:       "tool_b",
		ToolName:     "terminal.exec",
		Status:       "error",
		ArgsJSON:     `{"command":"rg \"TODO\" .","cwd":"/tmp"}`,
		ErrorCode:    "INVALID_PATH",
		ErrorMessage: "path must be absolute",
	}); err != nil {
		t.Fatalf("UpsertToolCall tool_b: %v", err)
	}

	if err := s.UpsertRun(ctx, RunRecord{
		RunID:      "run_other",
		EndpointID: "env_1",
		ThreadID:   "th_other",
		MessageID:  "msg_other",
		State:      "running",
	}); err != nil {
		t.Fatalf("UpsertRun run_other: %v", err)
	}
	if err := s.UpsertToolCall(ctx, ToolCallRecord{
		RunID:    "run_other",
		ToolID:   "tool_other",
		ToolName: "apply_patch",
		Status:   "success",
		ArgsJSON: `{"patch":"diff --git a/a.txt b/a.txt"}`,
	}); err != nil {
		t.Fatalf("UpsertToolCall tool_other: %v", err)
	}

	recs, err := s.ListRecentThreadToolCalls(ctx, "env_1", "th_1", 10)
	if err != nil {
		t.Fatalf("ListRecentThreadToolCalls: %v", err)
	}
	if len(recs) != 2 {
		t.Fatalf("len(recs)=%d, want 2", len(recs))
	}
	if recs[0].RunID != "run_a" || recs[0].ToolID != "tool_a" {
		t.Fatalf("recs[0]=%+v, want run_a/tool_a", recs[0])
	}
	if recs[1].RunID != "run_b" || recs[1].ToolID != "tool_b" {
		t.Fatalf("recs[1]=%+v, want run_b/tool_b", recs[1])
	}

	latestOnly, err := s.ListRecentThreadToolCalls(ctx, "env_1", "th_1", 1)
	if err != nil {
		t.Fatalf("ListRecentThreadToolCalls latest: %v", err)
	}
	if len(latestOnly) != 1 {
		t.Fatalf("len(latestOnly)=%d, want 1", len(latestOnly))
	}
	if latestOnly[0].RunID != "run_b" || latestOnly[0].ToolID != "tool_b" {
		t.Fatalf("latestOnly[0]=%+v, want run_b/tool_b", latestOnly[0])
	}
}

func TestBuildPreview_AssistantUsesLatestMarkdownBlock(t *testing.T) {
	t.Parallel()

	messageJSON := `{"id":"m1","role":"assistant","blocks":[{"type":"markdown","content":"I will quickly scan the project layout first."},{"type":"tool-call","toolName":"terminal.exec"},{"type":"markdown","content":"Findings:\n- Has clear module boundaries.\nEvidence:\n- README.md defines run steps."}],"status":"complete","timestamp":1}`
	text := "I will quickly scan the project layout first.\nFindings:\n- Has clear module boundaries.\nEvidence:\n- README.md defines run steps."

	preview := buildPreview("assistant", text, messageJSON)
	if !strings.Contains(preview, "Findings:") {
		t.Fatalf("preview=%q, want latest markdown content", preview)
	}
	if strings.Contains(preview, "I will quickly scan the project layout first") {
		t.Fatalf("preview=%q, should not start from earlier attempt preamble", preview)
	}
}

func TestBuildPreview_AssistantFallsBackWhenMessageJSONInvalid(t *testing.T) {
	t.Parallel()

	text := "Fallback preview text"
	preview := buildPreview("assistant", text, "{invalid json")
	if preview != text {
		t.Fatalf("preview=%q, want %q", preview, text)
	}
}

func TestStore_ReplaceThreadTodosSnapshot(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	initial, err := s.GetThreadTodosSnapshot(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThreadTodosSnapshot initial: %v", err)
	}
	if initial.Version != 0 {
		t.Fatalf("initial.Version=%d, want 0", initial.Version)
	}
	if initial.TodosJSON != "[]" {
		t.Fatalf("initial.TodosJSON=%q, want []", initial.TodosJSON)
	}

	payload1 := `[{"id":"todo_1","content":"Inspect workspace","status":"in_progress"}]`
	updated, err := s.ReplaceThreadTodosSnapshot(ctx, ThreadTodosSnapshot{
		EndpointID:      "env_1",
		ThreadID:        "th_1",
		TodosJSON:       payload1,
		UpdatedByRunID:  "run_1",
		UpdatedByToolID: "tool_1",
	}, nil)
	if err != nil {
		t.Fatalf("ReplaceThreadTodosSnapshot first: %v", err)
	}
	if updated.Version != 1 {
		t.Fatalf("updated.Version=%d, want 1", updated.Version)
	}

	payload2 := `[{"id":"todo_1","content":"Inspect workspace","status":"completed"}]`
	expectedV1 := int64(1)
	updated, err = s.ReplaceThreadTodosSnapshot(ctx, ThreadTodosSnapshot{
		EndpointID:      "env_1",
		ThreadID:        "th_1",
		TodosJSON:       payload2,
		UpdatedByRunID:  "run_1",
		UpdatedByToolID: "tool_2",
	}, &expectedV1)
	if err != nil {
		t.Fatalf("ReplaceThreadTodosSnapshot second: %v", err)
	}
	if updated.Version != 2 {
		t.Fatalf("updated.Version=%d, want 2", updated.Version)
	}

	latest, err := s.GetThreadTodosSnapshot(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThreadTodosSnapshot latest: %v", err)
	}
	if latest.Version != 2 {
		t.Fatalf("latest.Version=%d, want 2", latest.Version)
	}
	var decoded []map[string]any
	if err := json.Unmarshal([]byte(latest.TodosJSON), &decoded); err != nil {
		t.Fatalf("decode latest todos: %v", err)
	}
	if len(decoded) != 1 {
		t.Fatalf("len(decoded)=%d, want 1", len(decoded))
	}
	if got := strings.TrimSpace(anyToString(decoded[0]["status"])); got != "completed" {
		t.Fatalf("status=%q, want completed", got)
	}

	stale := int64(1)
	_, err = s.ReplaceThreadTodosSnapshot(ctx, ThreadTodosSnapshot{
		EndpointID:      "env_1",
		ThreadID:        "th_1",
		TodosJSON:       payload1,
		UpdatedByRunID:  "run_2",
		UpdatedByToolID: "tool_3",
	}, &stale)
	if !errors.Is(err, ErrThreadTodosVersionConflict) {
		t.Fatalf("stale replace err=%v, want %v", err, ErrThreadTodosVersionConflict)
	}
}

func anyToString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
