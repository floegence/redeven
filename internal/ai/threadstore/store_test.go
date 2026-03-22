package threadstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

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

	if err := s.UpdateThreadRunState(ctx, "env_1", "th_1", "running", "", "", "u1", "u1@example.com"); err != nil {
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

	if err := s.UpdateThreadRunState(ctx, "env_1", "th_1", "failed", strings.Repeat("x", 900), "", "u1", "u1@example.com"); err != nil {
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

	waitingPromptJSONBytes, err := json.Marshal(map[string]any{
		"prompt_id":          "wp_1",
		"message_id":         "msg_1",
		"tool_id":            "tool_1",
		"reason_code":        "user_decision_required",
		"required_from_user": []string{"Choose next step"},
		"questions": []map[string]any{
			{
				"id":        "question_1",
				"header":    "Need confirmation",
				"question":  "Need confirmation",
				"is_other":  true,
				"is_secret": false,
			},
		},
	})
	if err != nil {
		t.Fatalf("json.Marshal waiting prompt: %v", err)
	}
	waitingPromptJSON := string(waitingPromptJSONBytes)
	if err := s.UpdateThreadRunState(ctx, "env_1", "th_1", "waiting_user", "", waitingPromptJSON, "u1", "u1@example.com"); err != nil {
		t.Fatalf("UpdateThreadRunState waiting_user: %v", err)
	}
	th, err = s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread after waiting_user: %v", err)
	}
	if th.RunStatus != "waiting_user" {
		t.Fatalf("RunStatus=%q, want waiting_user", th.RunStatus)
	}
	if strings.TrimSpace(th.WaitingUserInputJSON) != waitingPromptJSON {
		t.Fatalf("waiting prompt mismatch: %+v", th)
	}

	if err := s.UpdateThreadRunState(ctx, "env_1", "th_1", "success", "should be cleared", "", "u1", "u1@example.com"); err != nil {
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
	if th.WaitingUserInputJSON != "" {
		t.Fatalf("waiting prompt should be cleared, got %+v", th)
	}
}

func TestStore_ResetStaleActiveThreadRunStates(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	type threadCase struct {
		threadID   string
		status     string
		runError   string
		wantStatus string
		wantRunErr string
	}
	cases := []threadCase{
		{threadID: "th_accepted", status: "accepted", wantStatus: "canceled"},
		{threadID: "th_running", status: "running", wantStatus: "canceled"},
		{threadID: "th_waiting_approval", status: "waiting_approval", wantStatus: "canceled"},
		{threadID: "th_recovering", status: "recovering", wantStatus: "canceled"},
		{threadID: "th_finalizing", status: "finalizing", wantStatus: "canceled"},
		{threadID: "th_waiting_user", status: "waiting_user", wantStatus: "waiting_user"},
		{threadID: "th_success", status: "success", wantStatus: "success"},
		{threadID: "th_failed", status: "failed", runError: "boom", wantStatus: "failed", wantRunErr: "boom"},
	}

	for _, tc := range cases {
		if err := s.CreateThread(ctx, Thread{ThreadID: tc.threadID, EndpointID: "env_1", Title: tc.threadID}); err != nil {
			t.Fatalf("CreateThread(%s): %v", tc.threadID, err)
		}
		if err := s.UpdateThreadRunState(ctx, "env_1", tc.threadID, tc.status, tc.runError, "", "u1", "u1@example.com"); err != nil {
			t.Fatalf("UpdateThreadRunState(%s): %v", tc.threadID, err)
		}
	}

	affected, err := s.ResetStaleActiveThreadRunStates(ctx)
	if err != nil {
		t.Fatalf("ResetStaleActiveThreadRunStates: %v", err)
	}
	if affected != 5 {
		t.Fatalf("affected=%d, want 5", affected)
	}

	for _, tc := range cases {
		th, err := s.GetThread(ctx, "env_1", tc.threadID)
		if err != nil {
			t.Fatalf("GetThread(%s): %v", tc.threadID, err)
		}
		if th == nil {
			t.Fatalf("thread %s missing", tc.threadID)
		}
		if got := strings.TrimSpace(th.RunStatus); got != tc.wantStatus {
			t.Fatalf("thread %s run_status=%q, want %q", tc.threadID, got, tc.wantStatus)
		}
		if gotErr := strings.TrimSpace(th.RunError); gotErr != tc.wantRunErr {
			t.Fatalf("thread %s run_error=%q, want %q", tc.threadID, gotErr, tc.wantRunErr)
		}
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

	for _, col := range []string{"model_id", "model_locked", "execution_mode", "working_dir", "run_status", "run_updated_at_unix_ms", "run_error", "waiting_user_input_json"} {
		if !cols[col] {
			t.Fatalf("missing migrated column %q", col)
		}
	}

	for _, table := range []string{"ai_runs", "ai_tool_calls", "ai_run_events", "ai_thread_todos", "ai_thread_checkpoints", "transcript_messages", "conversation_turns", "execution_spans", "memory_items", "context_snapshots", "provider_capabilities", "structured_user_inputs", "request_user_input_secret_answers"} {
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
	if version != 17 {
		t.Fatalf("user_version=%d, want 17", version)
	}
}

func TestStore_MigrateFromV9ScrubsLegacyModelDefaultToken(t *testing.T) {
	t.Parallel()

	legacyToken := strings.Join([]string{"is", "default"}, "_")
	toolCallPayload := strings.Replace(`{"TOKEN":true}`, "TOKEN", legacyToken, 1)
	runEventPayload := strings.Replace(`{"legacy":"TOKEN"}`, "TOKEN", legacyToken, 1)

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
	defer func() { _ = raw.Close() }()

	if _, err := raw.Exec(`PRAGMA user_version=9;`); err != nil {
		t.Fatalf("set user_version: %v", err)
	}
	if _, err := raw.Exec(`
INSERT INTO ai_tool_calls(run_id, tool_id, tool_name, status, result_json)
VALUES(?, ?, ?, ?, ?)
`, "run_legacy", "tool_legacy", "terminal.exec", "succeeded", toolCallPayload); err != nil {
		t.Fatalf("seed tool call: %v", err)
	}
	if _, err := raw.Exec(`
INSERT INTO ai_run_events(endpoint_id, thread_id, run_id, event_type, payload_json)
VALUES(?, ?, ?, ?, ?)
`, "env_legacy", "th_legacy", "run_legacy", "stream_event", runEventPayload); err != nil {
		t.Fatalf("seed legacy data: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close seeded db: %v", err)
	}

	s, err = Open(dbPath)
	if err != nil {
		t.Fatalf("Open after v9 seed: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()

	var cleanedToolCall string
	if err := s.db.QueryRowContext(ctx, `
SELECT result_json
FROM ai_tool_calls
WHERE run_id = 'run_legacy' AND tool_id = 'tool_legacy'
`).Scan(&cleanedToolCall); err != nil {
		t.Fatalf("load tool call: %v", err)
	}
	if strings.Contains(cleanedToolCall, legacyToken) {
		t.Fatalf("tool call result_json still contains legacy token: %s", cleanedToolCall)
	}
	if !strings.Contains(cleanedToolCall, "current_model_id") {
		t.Fatalf("tool call result_json not rewritten: %s", cleanedToolCall)
	}

	var cleanedEvent string
	if err := s.db.QueryRowContext(ctx, `
SELECT payload_json
FROM ai_run_events
WHERE run_id = 'run_legacy'
`).Scan(&cleanedEvent); err != nil {
		t.Fatalf("load run event: %v", err)
	}
	if strings.Contains(cleanedEvent, legacyToken) {
		t.Fatalf("run event payload_json still contains legacy token: %s", cleanedEvent)
	}
	if !strings.Contains(cleanedEvent, "current_model_id") {
		t.Fatalf("run event payload_json not rewritten: %s", cleanedEvent)
	}

	var version int
	if err := s.db.QueryRowContext(ctx, `PRAGMA user_version;`).Scan(&version); err != nil {
		t.Fatalf("read user_version: %v", err)
	}
	if version != 17 {
		t.Fatalf("user_version=%d, want 17", version)
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

func TestStore_CreateThread_ModelLockDefaultsToFalse(t *testing.T) {
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
	if th.ModelLocked {
		t.Fatalf("ModelLocked=%v, want false", th.ModelLocked)
	}
}

func TestStore_UpdateThreadModelLock(t *testing.T) {
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
	if err := s.UpdateThreadModelLock(ctx, "env_1", "th_1", true); err != nil {
		t.Fatalf("UpdateThreadModelLock(true): %v", err)
	}
	th, err := s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if th == nil {
		t.Fatalf("thread missing")
	}
	if !th.ModelLocked {
		t.Fatalf("ModelLocked=%v, want true", th.ModelLocked)
	}

	if err := s.UpdateThreadModelLock(ctx, "env_1", "th_1", false); err != nil {
		t.Fatalf("UpdateThreadModelLock(false): %v", err)
	}
	th, err = s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread after unlock: %v", err)
	}
	if th == nil {
		t.Fatalf("thread missing after unlock")
	}
	if th.ModelLocked {
		t.Fatalf("ModelLocked=%v, want false", th.ModelLocked)
	}
}

func TestStore_UpdateTranscriptMessageJSONByRowID_DoesNotTouchThreadUpdatedAt(t *testing.T) {
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

	rowID, err := s.AppendMessage(ctx, "env_1", "th_1", Message{
		ThreadID:        "th_1",
		EndpointID:      "env_1",
		MessageID:       "msg_1",
		Role:            "assistant",
		Status:          "complete",
		CreatedAtUnixMs: 123,
		UpdatedAtUnixMs: 123,
		TextContent:     "hello",
		MessageJSON:     `{"id":"msg_1","role":"assistant","blocks":[{"type":"tool-call","toolName":"terminal.exec","toolId":"tool_1","args":{},"status":"success"}],"status":"complete","timestamp":123}`,
	}, "u1", "u1@example.com")
	if err != nil {
		t.Fatalf("AppendMessage: %v", err)
	}
	if rowID <= 0 {
		t.Fatalf("rowID=%d, want > 0", rowID)
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

	nextJSON := `{"id":"msg_1","role":"assistant","blocks":[{"type":"tool-call","toolName":"terminal.exec","toolId":"tool_1","args":{},"status":"success","collapsed":false}],"status":"complete","timestamp":123}`
	if err := s.UpdateTranscriptMessageJSONByRowID(ctx, "env_1", rowID, nextJSON, 0); err != nil {
		t.Fatalf("UpdateTranscriptMessageJSONByRowID: %v", err)
	}

	th2, err := s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread after update: %v", err)
	}
	if th2 == nil {
		t.Fatalf("thread missing after update")
	}
	if th2.UpdatedAtUnixMs != updatedAt {
		t.Fatalf("UpdatedAtUnixMs changed: got=%d want=%d", th2.UpdatedAtUnixMs, updatedAt)
	}

	_, gotJSON, err := s.GetTranscriptMessageRowIDAndJSONByMessageID(ctx, "env_1", "th_1", "msg_1")
	if err != nil {
		t.Fatalf("GetTranscriptMessageRowIDAndJSONByMessageID: %v", err)
	}
	if gotJSON != nextJSON {
		t.Fatalf("message_json=%q, want %q", gotJSON, nextJSON)
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

func TestStore_GetToolCall(t *testing.T) {
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
		t.Fatalf("UpsertRun: %v", err)
	}
	if err := s.UpsertToolCall(ctx, ToolCallRecord{
		RunID:      "run_a",
		ToolID:     "tool_a",
		ToolName:   "terminal.exec",
		Status:     "success",
		ArgsJSON:   `{"command":"pwd","cwd":"/tmp"}`,
		ResultJSON: `{"stdout":"ok\n","exit_code":0}`,
	}); err != nil {
		t.Fatalf("UpsertToolCall: %v", err)
	}

	rec, err := s.GetToolCall(ctx, "env_1", "run_a", "tool_a")
	if err != nil {
		t.Fatalf("GetToolCall: %v", err)
	}
	if rec == nil {
		t.Fatalf("GetToolCall returned nil record")
	}
	if rec.ToolName != "terminal.exec" {
		t.Fatalf("ToolName=%q, want terminal.exec", rec.ToolName)
	}
	if rec.ResultJSON != `{"stdout":"ok\n","exit_code":0}` {
		t.Fatalf("ResultJSON=%q", rec.ResultJSON)
	}

	if _, err := s.GetToolCall(ctx, "env_1", "run_a", "missing"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("GetToolCall missing err=%v, want sql.ErrNoRows", err)
	}
	if _, err := s.GetToolCall(ctx, "env_2", "run_a", "tool_a"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("GetToolCall endpoint mismatch err=%v, want sql.ErrNoRows", err)
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

func TestBuildPreview_AssistantFallsBackToAskUserQuestion(t *testing.T) {
	t.Parallel()

	messageJSON := `{"id":"m1","role":"assistant","blocks":[{"type":"tool-call","toolName":"ask_user","toolId":"tool_1","args":{"questions":[{"id":"question_1","header":"Need guidance","question":"I hit repeated tool failures while inspecting the file. Choose the next direction.","is_other":true}],"reason_code":"conflicting_constraints","required_from_user":["Choose the next direction."],"evidence_refs":["tool:terminal_exec:1"]},"result":{"questions":[{"id":"question_1","header":"Need guidance","question":"I hit repeated tool failures while inspecting the file. Choose the next direction.","is_other":true}],"waiting_user":true}}],"status":"complete","timestamp":1}`

	preview := buildPreview("assistant", "", messageJSON)
	if !strings.Contains(preview, "Choose the next direction") {
		t.Fatalf("preview=%q, want ask_user question fallback", preview)
	}
}

func TestBuildPreview_AssistantFallsBackToTaskCompleteResult(t *testing.T) {
	t.Parallel()

	messageJSON := `{"id":"m1","role":"assistant","blocks":[{"type":"tool-call","toolName":"task_complete","toolId":"tool_1","args":{"result":"Completed the verification and documented the remaining risks."}}],"status":"complete","timestamp":1}`

	preview := buildPreview("assistant", "", messageJSON)
	if !strings.Contains(preview, "Completed the verification") {
		t.Fatalf("preview=%q, want task_complete result fallback", preview)
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

func TestStore_ListRunEventsPage_ContextCategory(t *testing.T) {
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

	appendEvent := func(eventType string) {
		t.Helper()
		err := s.AppendRunEvent(ctx, RunEventRecord{
			EndpointID:  "env_1",
			ThreadID:    "th_1",
			RunID:       "run_1",
			StreamKind:  "lifecycle",
			EventType:   eventType,
			PayloadJSON: "{}",
			AtUnixMs:    time.Now().UnixMilli(),
		})
		if err != nil {
			t.Fatalf("AppendRunEvent(%s): %v", eventType, err)
		}
	}

	appendEvent("context.integrity.repair_applied")
	appendEvent("context.compaction.started")
	appendEvent("context.usage.updated")
	appendEvent("context.compaction.skipped")
	appendEvent("native.turn.result")

	firstPage, nextCursor, hasMore, err := s.ListRunEventsPage(ctx, "env_1", "run_1", RunEventsQuery{
		Category: "context",
		Limit:    2,
	})
	if err != nil {
		t.Fatalf("ListRunEventsPage first: %v", err)
	}
	if len(firstPage) != 2 {
		t.Fatalf("len(firstPage)=%d, want 2", len(firstPage))
	}
	if !hasMore {
		t.Fatalf("hasMore=%v, want true", hasMore)
	}
	if strings.TrimSpace(firstPage[0].EventType) != "context.compaction.started" {
		t.Fatalf("firstPage[0].EventType=%q, want context.compaction.started", firstPage[0].EventType)
	}
	if strings.TrimSpace(firstPage[1].EventType) != "context.usage.updated" {
		t.Fatalf("firstPage[1].EventType=%q, want context.usage.updated", firstPage[1].EventType)
	}
	if nextCursor <= 0 {
		t.Fatalf("nextCursor=%d, want > 0", nextCursor)
	}

	secondPage, secondCursor, secondHasMore, err := s.ListRunEventsPage(ctx, "env_1", "run_1", RunEventsQuery{
		Category: "context",
		Limit:    2,
		Cursor:   nextCursor,
	})
	if err != nil {
		t.Fatalf("ListRunEventsPage second: %v", err)
	}
	if secondHasMore {
		t.Fatalf("secondHasMore=%v, want false", secondHasMore)
	}
	if len(secondPage) != 1 {
		t.Fatalf("len(secondPage)=%d, want 1", len(secondPage))
	}
	if strings.TrimSpace(secondPage[0].EventType) != "context.compaction.skipped" {
		t.Fatalf("secondPage[0].EventType=%q, want context.compaction.skipped", secondPage[0].EventType)
	}
	if secondCursor < nextCursor {
		t.Fatalf("secondCursor=%d, want >= %d", secondCursor, nextCursor)
	}
}

func TestStore_AppendRunEvent_AgeRetention(t *testing.T) {
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

	oldEventTime := time.Now().Add(-(runEventRetentionMaxAge + 24*time.Hour)).UnixMilli()
	if err := s.AppendRunEvent(ctx, RunEventRecord{
		EndpointID:  "env_1",
		ThreadID:    "th_1",
		RunID:       "run_1",
		StreamKind:  "context",
		EventType:   "context.usage.updated",
		PayloadJSON: "{}",
		AtUnixMs:    oldEventTime,
	}); err != nil {
		t.Fatalf("AppendRunEvent old: %v", err)
	}

	eventsAfterOld, err := s.ListRunEvents(ctx, "env_1", "run_1", 10)
	if err != nil {
		t.Fatalf("ListRunEvents after old: %v", err)
	}
	if len(eventsAfterOld) != 0 {
		t.Fatalf("len(eventsAfterOld)=%d, want 0", len(eventsAfterOld))
	}

	if err := s.AppendRunEvent(ctx, RunEventRecord{
		EndpointID:  "env_1",
		ThreadID:    "th_1",
		RunID:       "run_1",
		StreamKind:  "context",
		EventType:   "context.compaction.started",
		PayloadJSON: "{}",
		AtUnixMs:    time.Now().UnixMilli(),
	}); err != nil {
		t.Fatalf("AppendRunEvent fresh: %v", err)
	}

	events, err := s.ListRunEvents(ctx, "env_1", "run_1", 10)
	if err != nil {
		t.Fatalf("ListRunEvents fresh: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("len(events)=%d, want 1", len(events))
	}
	if strings.TrimSpace(events[0].EventType) != "context.compaction.started" {
		t.Fatalf("EventType=%q, want context.compaction.started", events[0].EventType)
	}
}

func anyToString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func TestStore_FollowupsCRUDReorderAndRecover(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_queue", EndpointID: "env_queue", Title: "queue"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	first, firstPos, firstRevision, err := s.CreateFollowup(ctx, QueuedTurn{
		QueueID:               "fu_1",
		EndpointID:            "env_queue",
		ThreadID:              "th_queue",
		ChannelID:             "ch_queue",
		Lane:                  FollowupLaneQueued,
		MessageID:             "m_queue_1",
		ModelID:               "openai/gpt-5-mini",
		TextContent:           "first queued turn",
		AttachmentsJSON:       `[{"name":"spec.md","mime_type":"text/markdown","url":"file:///tmp/spec.md"}]`,
		OptionsJSON:           `{"max_steps":4,"mode":"plan"}`,
		CreatedByUserPublicID: "u_queue",
		CreatedByUserEmail:    "u_queue@example.com",
		CreatedAtUnixMs:       1000,
	})
	if err != nil {
		t.Fatalf("CreateFollowup first: %v", err)
	}
	if firstPos != 1 {
		t.Fatalf("firstPos=%d, want 1", firstPos)
	}
	if first.ChannelID != "ch_queue" {
		t.Fatalf("first.ChannelID=%q, want ch_queue", first.ChannelID)
	}
	if firstRevision <= 0 {
		t.Fatalf("firstRevision=%d, want > 0", firstRevision)
	}

	_, secondPos, secondRevision, err := s.CreateFollowup(ctx, QueuedTurn{
		QueueID:               "fu_2",
		EndpointID:            "env_queue",
		ThreadID:              "th_queue",
		ChannelID:             "ch_queue",
		Lane:                  FollowupLaneQueued,
		MessageID:             "m_queue_2",
		ModelID:               "openai/gpt-5-mini",
		TextContent:           "second queued turn",
		OptionsJSON:           `{"max_steps":2,"mode":"act"}`,
		CreatedByUserPublicID: "u_queue",
		CreatedByUserEmail:    "u_queue@example.com",
		CreatedAtUnixMs:       2000,
	})
	if err != nil {
		t.Fatalf("CreateFollowup second: %v", err)
	}
	if secondPos != 2 {
		t.Fatalf("secondPos=%d, want 2", secondPos)
	}
	if secondRevision <= firstRevision {
		t.Fatalf("secondRevision=%d, want > %d", secondRevision, firstRevision)
	}

	_, draftPos, draftRevision, err := s.CreateFollowup(ctx, QueuedTurn{
		QueueID:               "fu_3",
		EndpointID:            "env_queue",
		ThreadID:              "th_queue",
		ChannelID:             "ch_queue",
		Lane:                  FollowupLaneDraft,
		MessageID:             "m_draft_1",
		ModelID:               "openai/gpt-5-mini",
		TextContent:           "draft follow-up",
		OptionsJSON:           `{"max_steps":2,"mode":"plan"}`,
		CreatedByUserPublicID: "u_queue",
		CreatedByUserEmail:    "u_queue@example.com",
		CreatedAtUnixMs:       3000,
	})
	if err != nil {
		t.Fatalf("CreateFollowup draft: %v", err)
	}
	if draftPos != 1 {
		t.Fatalf("draftPos=%d, want 1", draftPos)
	}
	if draftRevision <= secondRevision {
		t.Fatalf("draftRevision=%d, want > %d", draftRevision, secondRevision)
	}

	count, err := s.CountFollowupsByLane(ctx, "env_queue", "th_queue", FollowupLaneQueued)
	if err != nil {
		t.Fatalf("CountFollowupsByLane: %v", err)
	}
	if count != 2 {
		t.Fatalf("count=%d, want 2", count)
	}

	counts, err := s.CountFollowupsByThreadAndLane(ctx, "env_queue", []string{"th_queue", "th_other"}, FollowupLaneQueued)
	if err != nil {
		t.Fatalf("CountFollowupsByThreadAndLane: %v", err)
	}
	if counts["th_queue"] != 2 {
		t.Fatalf("counts[th_queue]=%d, want 2", counts["th_queue"])
	}
	if counts["th_other"] != 0 {
		t.Fatalf("counts[th_other]=%d, want 0", counts["th_other"])
	}

	queued, err := s.ListFollowupsByLane(ctx, "env_queue", "th_queue", FollowupLaneQueued, 10)
	if err != nil {
		t.Fatalf("ListFollowupsByLane queued: %v", err)
	}
	if len(queued) != 2 {
		t.Fatalf("len(queued)=%d, want 2", len(queued))
	}
	if queued[0].QueueID != "fu_1" || queued[1].QueueID != "fu_2" {
		t.Fatalf("unexpected queued order: %+v", queued)
	}
	if queued[0].Lane != FollowupLaneQueued {
		t.Fatalf("queued[0].Lane=%q, want %q", queued[0].Lane, FollowupLaneQueued)
	}

	revision, err := s.GetThreadFollowupsRevision(ctx, "env_queue", "th_queue")
	if err != nil {
		t.Fatalf("GetThreadFollowupsRevision: %v", err)
	}
	if revision != draftRevision {
		t.Fatalf("revision=%d, want %d", revision, draftRevision)
	}

	updatedRevision, err := s.UpdateFollowupText(ctx, "env_queue", "th_queue", "fu_2", "updated second follow-up")
	if err != nil {
		t.Fatalf("UpdateFollowupText: %v", err)
	}
	if updatedRevision <= revision {
		t.Fatalf("updatedRevision=%d, want > %d", updatedRevision, revision)
	}

	queued, err = s.ListFollowupsByLane(ctx, "env_queue", "th_queue", FollowupLaneQueued, 10)
	if err != nil {
		t.Fatalf("ListFollowupsByLane queued updated: %v", err)
	}
	if queued[1].TextContent != "updated second follow-up" {
		t.Fatalf("queued[1].TextContent=%q, want updated second follow-up", queued[1].TextContent)
	}

	reorderedRevision, err := s.ReorderFollowups(ctx, "env_queue", "th_queue", FollowupLaneQueued, []string{"fu_2", "fu_1"}, updatedRevision)
	if err != nil {
		t.Fatalf("ReorderFollowups: %v", err)
	}
	if reorderedRevision <= updatedRevision {
		t.Fatalf("reorderedRevision=%d, want > %d", reorderedRevision, updatedRevision)
	}

	queued, err = s.ListFollowupsByLane(ctx, "env_queue", "th_queue", FollowupLaneQueued, 10)
	if err != nil {
		t.Fatalf("ListFollowupsByLane queued reordered: %v", err)
	}
	if queued[0].QueueID != "fu_2" || queued[1].QueueID != "fu_1" {
		t.Fatalf("unexpected reordered queue: %+v", queued)
	}

	if _, err := s.ReorderFollowups(ctx, "env_queue", "th_queue", FollowupLaneQueued, []string{"fu_1", "fu_2"}, updatedRevision); !errors.Is(err, ErrFollowupsRevisionChanged) {
		t.Fatalf("stale ReorderFollowups err=%v, want %v", err, ErrFollowupsRevisionChanged)
	}

	recovered, recoveredRevision, err := s.RecoverQueuedTurnsToDrafts(ctx, "env_queue", "th_queue")
	if err != nil {
		t.Fatalf("RecoverQueuedTurnsToDrafts: %v", err)
	}
	if len(recovered) != 2 {
		t.Fatalf("len(recovered)=%d, want 2", len(recovered))
	}
	if recovered[0].QueueID != "fu_2" || recovered[1].QueueID != "fu_1" {
		t.Fatalf("unexpected recovered followups: %+v", recovered)
	}
	if recoveredRevision <= reorderedRevision {
		t.Fatalf("recoveredRevision=%d, want > %d", recoveredRevision, reorderedRevision)
	}

	finalQueued, err := s.CountFollowupsByLane(ctx, "env_queue", "th_queue", FollowupLaneQueued)
	if err != nil {
		t.Fatalf("CountFollowupsByLane queued final: %v", err)
	}
	if finalQueued != 0 {
		t.Fatalf("finalQueued=%d, want 0", finalQueued)
	}

	drafts, err := s.ListFollowupsByLane(ctx, "env_queue", "th_queue", FollowupLaneDraft, 10)
	if err != nil {
		t.Fatalf("ListFollowupsByLane draft: %v", err)
	}
	if len(drafts) != 3 {
		t.Fatalf("len(drafts)=%d, want 3", len(drafts))
	}
	if drafts[0].QueueID != "fu_3" || drafts[1].QueueID != "fu_2" || drafts[2].QueueID != "fu_1" {
		t.Fatalf("unexpected draft order: %+v", drafts)
	}

	deletedRevision, err := s.DeleteFollowup(ctx, "env_queue", "th_queue", "fu_1")
	if err != nil {
		t.Fatalf("DeleteFollowup: %v", err)
	}
	if deletedRevision <= recoveredRevision {
		t.Fatalf("deletedRevision=%d, want > %d", deletedRevision, recoveredRevision)
	}

	drafts, err = s.ListFollowupsByLane(ctx, "env_queue", "th_queue", FollowupLaneDraft, 10)
	if err != nil {
		t.Fatalf("ListFollowupsByLane draft after delete: %v", err)
	}
	if len(drafts) != 2 {
		t.Fatalf("len(drafts)=%d, want 2", len(drafts))
	}
}
