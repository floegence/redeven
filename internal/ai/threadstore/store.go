package threadstore

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const (
	runEventRetentionMaxAge       = 30 * 24 * time.Hour
	runEventRetentionMaxPerThread = 5000
)

// Store is a local SQLite-backed persistence layer for AI threads and messages.
//
// Notes:
// - Data is scoped by endpoint_id (env public id). It is intentionally shared within the same env for collaboration.
// - WAL is enabled to support concurrent reads while writing (multiple browser sessions).
type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	p := filepath.Clean(strings.TrimSpace(path))
	if p == "" {
		return nil, errors.New("missing db path")
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", p)
	if err != nil {
		return nil, err
	}
	if err := initSchema(db); err != nil {
		_ = db.Close()
		return nil, err
	}

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

type Thread struct {
	ThreadID             string `json:"thread_id"`
	EndpointID           string `json:"endpoint_id"`
	NamespacePublicID    string `json:"namespace_public_id"`
	ModelID              string `json:"model_id"`
	ModelLocked          bool   `json:"model_locked"`
	ExecutionMode        string `json:"execution_mode"`
	WorkingDir           string `json:"working_dir"`
	Title                string `json:"title"`
	RunStatus            string `json:"run_status"`
	RunUpdatedAtUnixMs   int64  `json:"run_updated_at_unix_ms"`
	RunError             string `json:"run_error"`
	WaitingUserInputJSON string `json:"waiting_user_input_json"`

	CreatedByUserPublicID string `json:"created_by_user_public_id"`
	CreatedByUserEmail    string `json:"created_by_user_email"`
	UpdatedByUserPublicID string `json:"updated_by_user_public_id"`
	UpdatedByUserEmail    string `json:"updated_by_user_email"`

	CreatedAtUnixMs     int64  `json:"created_at_unix_ms"`
	UpdatedAtUnixMs     int64  `json:"updated_at_unix_ms"`
	LastMessageAtUnixMs int64  `json:"last_message_at_unix_ms"`
	LastMessagePreview  string `json:"last_message_preview"`
}

type Message struct {
	ID         int64  `json:"id"`
	ThreadID   string `json:"thread_id"`
	EndpointID string `json:"endpoint_id"`

	MessageID string `json:"message_id"`
	Role      string `json:"role"`

	AuthorUserPublicID string `json:"author_user_public_id"`
	AuthorUserEmail    string `json:"author_user_email"`

	Status string `json:"status"`

	CreatedAtUnixMs int64 `json:"created_at_unix_ms"`
	UpdatedAtUnixMs int64 `json:"updated_at_unix_ms"`

	TextContent string `json:"text_content"`
	MessageJSON string `json:"message_json"`
}

type QueuedTurn struct {
	QueueID string `json:"queue_id"`

	ThreadID   string `json:"thread_id"`
	EndpointID string `json:"endpoint_id"`
	ChannelID  string `json:"channel_id"`
	Lane       string `json:"lane"`

	MessageID string `json:"message_id"`
	ModelID   string `json:"model_id"`

	TextContent     string `json:"text_content"`
	AttachmentsJSON string `json:"attachments_json"`
	OptionsJSON     string `json:"options_json"`

	CreatedByUserPublicID string `json:"created_by_user_public_id"`
	CreatedByUserEmail    string `json:"created_by_user_email"`

	SortIndex       int64 `json:"sort_index"`
	CreatedAtUnixMs int64 `json:"created_at_unix_ms"`
	UpdatedAtUnixMs int64 `json:"updated_at_unix_ms"`
}

type ThreadsCursor struct {
	UpdatedAtUnixMs int64
	ThreadID        string
}

// EncodeCursor encodes a cursor as a URL-safe base64 string.
func EncodeCursor(c ThreadsCursor) string {
	if c.UpdatedAtUnixMs <= 0 || strings.TrimSpace(c.ThreadID) == "" {
		return ""
	}
	raw := fmt.Sprintf("%d:%s", c.UpdatedAtUnixMs, strings.TrimSpace(c.ThreadID))
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func DecodeCursor(raw string) (ThreadsCursor, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ThreadsCursor{}, true
	}
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return ThreadsCursor{}, false
	}
	parts := strings.SplitN(string(b), ":", 2)
	if len(parts) != 2 {
		return ThreadsCursor{}, false
	}
	ms, err := parseInt64(parts[0])
	if err != nil || ms <= 0 {
		return ThreadsCursor{}, false
	}
	id := strings.TrimSpace(parts[1])
	if id == "" {
		return ThreadsCursor{}, false
	}
	return ThreadsCursor{UpdatedAtUnixMs: ms, ThreadID: id}, true
}

func parseInt64(raw string) (int64, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, errors.New("empty")
	}
	return strconv.ParseInt(raw, 10, 64)
}

func isUniqueConstraintError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(strings.TrimSpace(err.Error()))
	if msg == "" {
		return false
	}
	if strings.Contains(msg, "unique constraint failed") {
		return true
	}
	return strings.Contains(msg, "constraint failed") && strings.Contains(msg, "unique")
}

func (s *Store) ListThreads(ctx context.Context, endpointID string, limit int, cursor ThreadsCursor) ([]Thread, string, error) {
	if s == nil || s.db == nil {
		return nil, "", errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	if endpointID == "" {
		return nil, "", errors.New("missing endpoint_id")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	args := []any{endpointID}
	where := ""
	if cursor.UpdatedAtUnixMs > 0 && strings.TrimSpace(cursor.ThreadID) != "" {
		where = "AND (updated_at_unix_ms < ? OR (updated_at_unix_ms = ? AND thread_id < ?))"
		args = append(args, cursor.UpdatedAtUnixMs, cursor.UpdatedAtUnixMs, strings.TrimSpace(cursor.ThreadID))
	}
	args = append(args, limit)

	q := fmt.Sprintf(`
SELECT
  thread_id, endpoint_id, namespace_public_id, model_id, model_locked, execution_mode, working_dir, title,
  run_status, run_updated_at_unix_ms, run_error,
  waiting_user_input_json,
  created_by_user_public_id, created_by_user_email,
  updated_by_user_public_id, updated_by_user_email,
  created_at_unix_ms, updated_at_unix_ms, last_message_at_unix_ms, last_message_preview
FROM ai_threads
WHERE endpoint_id = ?
%s
ORDER BY updated_at_unix_ms DESC, thread_id DESC
LIMIT ?
`, where)

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()

	out := make([]Thread, 0, limit)
	for rows.Next() {
		var t Thread
		var modelLockedInt int
		if err := rows.Scan(
			&t.ThreadID,
			&t.EndpointID,
			&t.NamespacePublicID,
			&t.ModelID,
			&modelLockedInt,
			&t.ExecutionMode,
			&t.WorkingDir,
			&t.Title,
			&t.RunStatus,
			&t.RunUpdatedAtUnixMs,
			&t.RunError,
			&t.WaitingUserInputJSON,
			&t.CreatedByUserPublicID,
			&t.CreatedByUserEmail,
			&t.UpdatedByUserPublicID,
			&t.UpdatedByUserEmail,
			&t.CreatedAtUnixMs,
			&t.UpdatedAtUnixMs,
			&t.LastMessageAtUnixMs,
			&t.LastMessagePreview,
		); err != nil {
			return nil, "", err
		}
		t.ModelLocked = modelLockedInt != 0
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	if len(out) == 0 {
		return out, "", nil
	}
	last := out[len(out)-1]
	next := EncodeCursor(ThreadsCursor{UpdatedAtUnixMs: last.UpdatedAtUnixMs, ThreadID: last.ThreadID})
	return out, next, nil
}

func (s *Store) GetThread(ctx context.Context, endpointID string, threadID string) (*Thread, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return nil, errors.New("invalid request")
	}

	var t Thread
	var modelLockedInt int
	err := s.db.QueryRowContext(ctx, `
SELECT
  thread_id, endpoint_id, namespace_public_id, model_id, model_locked, execution_mode, working_dir, title,
  run_status, run_updated_at_unix_ms, run_error,
  waiting_user_input_json,
  created_by_user_public_id, created_by_user_email,
  updated_by_user_public_id, updated_by_user_email,
  created_at_unix_ms, updated_at_unix_ms, last_message_at_unix_ms, last_message_preview
FROM ai_threads
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(
		&t.ThreadID,
		&t.EndpointID,
		&t.NamespacePublicID,
		&t.ModelID,
		&modelLockedInt,
		&t.ExecutionMode,
		&t.WorkingDir,
		&t.Title,
		&t.RunStatus,
		&t.RunUpdatedAtUnixMs,
		&t.RunError,
		&t.WaitingUserInputJSON,
		&t.CreatedByUserPublicID,
		&t.CreatedByUserEmail,
		&t.UpdatedByUserPublicID,
		&t.UpdatedByUserEmail,
		&t.CreatedAtUnixMs,
		&t.UpdatedAtUnixMs,
		&t.LastMessageAtUnixMs,
		&t.LastMessagePreview,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	t.ModelLocked = modelLockedInt != 0
	return &t, nil
}

func (s *Store) CreateThread(ctx context.Context, t Thread) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	t.ThreadID = strings.TrimSpace(t.ThreadID)
	t.EndpointID = strings.TrimSpace(t.EndpointID)
	t.NamespacePublicID = strings.TrimSpace(t.NamespacePublicID)
	t.ModelID = strings.TrimSpace(t.ModelID)
	t.ExecutionMode = normalizeExecutionMode(t.ExecutionMode)
	t.WorkingDir = strings.TrimSpace(t.WorkingDir)
	t.Title = strings.TrimSpace(t.Title)
	t.RunStatus = normalizeRunStatus(t.RunStatus)
	t.RunError = strings.TrimSpace(t.RunError)
	t.WaitingUserInputJSON = strings.TrimSpace(t.WaitingUserInputJSON)
	t.CreatedByUserPublicID = strings.TrimSpace(t.CreatedByUserPublicID)
	t.CreatedByUserEmail = strings.TrimSpace(t.CreatedByUserEmail)
	t.UpdatedByUserPublicID = strings.TrimSpace(t.UpdatedByUserPublicID)
	t.UpdatedByUserEmail = strings.TrimSpace(t.UpdatedByUserEmail)

	if t.ThreadID == "" || t.EndpointID == "" {
		return errors.New("invalid thread")
	}

	now := time.Now().UnixMilli()
	if t.CreatedAtUnixMs <= 0 {
		t.CreatedAtUnixMs = now
	}
	if t.UpdatedAtUnixMs <= 0 {
		t.UpdatedAtUnixMs = t.CreatedAtUnixMs
	}
	if t.RunUpdatedAtUnixMs < 0 {
		t.RunUpdatedAtUnixMs = 0
	}

	_, err := s.db.ExecContext(ctx, `
	INSERT INTO ai_threads(
	  thread_id, endpoint_id, namespace_public_id, model_id, model_locked, execution_mode, working_dir, title,
	  run_status, run_updated_at_unix_ms, run_error,
	  waiting_user_input_json,
	  created_by_user_public_id, created_by_user_email,
	  updated_by_user_public_id, updated_by_user_email,
	  created_at_unix_ms, updated_at_unix_ms,
	  last_message_at_unix_ms, last_message_preview
	) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		t.ThreadID,
		t.EndpointID,
		t.NamespacePublicID,
		t.ModelID,
		boolToInt(t.ModelLocked),
		t.ExecutionMode,
		t.WorkingDir,
		t.Title,
		t.RunStatus,
		t.RunUpdatedAtUnixMs,
		t.RunError,
		t.WaitingUserInputJSON,
		t.CreatedByUserPublicID,
		t.CreatedByUserEmail,
		t.UpdatedByUserPublicID,
		t.UpdatedByUserEmail,
		t.CreatedAtUnixMs,
		t.UpdatedAtUnixMs,
		t.LastMessageAtUnixMs,
		t.LastMessagePreview,
	)
	return err
}

func (s *Store) UpdateThreadModelID(ctx context.Context, endpointID string, threadID string, modelID string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	modelID = strings.TrimSpace(modelID)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid request")
	}
	if modelID == "" {
		return errors.New("missing model_id")
	}

	res, err := s.db.ExecContext(ctx, `
UPDATE ai_threads
SET model_id = ?
WHERE endpoint_id = ? AND thread_id = ?
`, modelID, endpointID, threadID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) UpdateThreadModelLock(ctx context.Context, endpointID string, threadID string, locked bool) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid request")
	}

	res, err := s.db.ExecContext(ctx, `
UPDATE ai_threads
SET model_locked = ?
WHERE endpoint_id = ? AND thread_id = ?
`, boolToInt(locked), endpointID, threadID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) UpdateThreadExecutionMode(ctx context.Context, endpointID string, threadID string, executionMode string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	executionMode = normalizeExecutionMode(executionMode)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid request")
	}

	res, err := s.db.ExecContext(ctx, `
UPDATE ai_threads
SET execution_mode = ?
WHERE endpoint_id = ? AND thread_id = ?
`, executionMode, endpointID, threadID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) RenameThread(ctx context.Context, endpointID string, threadID string, title string, updatedByID string, updatedByEmail string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	title = strings.TrimSpace(title)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid request")
	}
	if len(title) > 200 {
		return errors.New("title too long")
	}

	now := time.Now().UnixMilli()
	res, err := s.db.ExecContext(ctx, `
UPDATE ai_threads
SET title = ?, updated_at_unix_ms = ?, updated_by_user_public_id = ?, updated_by_user_email = ?
WHERE endpoint_id = ? AND thread_id = ?
`, title, now, strings.TrimSpace(updatedByID), strings.TrimSpace(updatedByEmail), endpointID, threadID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func normalizeRunStatus(status string) string {
	status = strings.TrimSpace(strings.ToLower(status))
	switch status {
	case "idle", "accepted", "running", "waiting_approval", "recovering", "finalizing", "waiting_user", "success", "failed", "canceled", "timed_out":
		return status
	default:
		return "idle"
	}
}

func normalizeExecutionMode(mode string) string {
	mode = strings.TrimSpace(strings.ToLower(mode))
	if mode == "plan" {
		return "plan"
	}
	return "act"
}

func normalizeWaitingUserInputJSONForStatus(runStatus string, waitingUserInputJSON string) string {
	waitingUserInputJSON = strings.TrimSpace(waitingUserInputJSON)
	if runStatus != "waiting_user" {
		return ""
	}
	return waitingUserInputJSON
}

// ResetStaleActiveThreadRunStates marks startup-orphaned active thread states as canceled.
//
// Why this exists:
// - Active runs are held in memory during normal execution.
// - If the agent process restarts, those in-memory runs are gone.
// - Any persisted thread state that still looks "active" must be reset so UI does not show phantom running threads.
func (s *Store) ResetStaleActiveThreadRunStates(ctx context.Context) (int64, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	now := time.Now().UnixMilli()
	res, err := s.db.ExecContext(ctx, `
	UPDATE ai_threads
	SET run_status = 'canceled',
	    run_updated_at_unix_ms = ?,
	    run_error = '',
	    waiting_user_input_json = '',
	    updated_at_unix_ms = ?
	WHERE run_status IN ('accepted', 'running', 'waiting_approval', 'recovering', 'finalizing')
	`, now, now)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func (s *Store) UpdateThreadRunState(
	ctx context.Context,
	endpointID string,
	threadID string,
	runStatus string,
	runError string,
	waitingUserInputJSON string,
	updatedByID string,
	updatedByEmail string,
) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid request")
	}

	runStatus = normalizeRunStatus(runStatus)
	runError = strings.TrimSpace(runError)
	if runStatus != "failed" && runStatus != "timed_out" {
		runError = ""
	}
	waitingUserInputJSON = normalizeWaitingUserInputJSONForStatus(runStatus, waitingUserInputJSON)
	if len(runError) > 600 {
		runError = truncateRunes(runError, 600)
	}

	now := time.Now().UnixMilli()
	res, err := s.db.ExecContext(ctx, `
	UPDATE ai_threads
	SET run_status = ?,
	    run_updated_at_unix_ms = ?,
	    run_error = ?,
	    waiting_user_input_json = ?,
	    updated_at_unix_ms = ?,
	    updated_by_user_public_id = ?,
	    updated_by_user_email = ?
	WHERE endpoint_id = ? AND thread_id = ?
	`, runStatus, now, runError, strings.TrimSpace(waitingUserInputJSON), now, strings.TrimSpace(updatedByID), strings.TrimSpace(updatedByEmail), endpointID, threadID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) DeleteThread(ctx context.Context, endpointID string, threadID string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid request")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DELETE FROM ai_messages WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM transcript_messages WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM conversation_turns WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM structured_user_inputs WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM request_user_input_secret_answers WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM memory_items WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM context_snapshots WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM execution_spans WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM ai_thread_state WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM ai_thread_todos WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM ai_queued_turns WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM ai_threads WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return tx.Commit()
}

func (s *Store) GetQueuedTurn(ctx context.Context, endpointID string, threadID string, queueID string) (*QueuedTurn, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	queueID = strings.TrimSpace(queueID)
	if endpointID == "" || threadID == "" || queueID == "" {
		return nil, errors.New("invalid request")
	}

	row := s.db.QueryRowContext(ctx, `
SELECT queue_id, endpoint_id, thread_id, channel_id, message_id, model_id, text_content, attachments_json, options_json,
       created_by_user_public_id, created_by_user_email, created_at_unix_ms
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ?
`, endpointID, threadID, queueID)
	out, err := scanQueuedTurn(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	return &out, nil
}

func (s *Store) EnqueueQueuedTurn(ctx context.Context, rec QueuedTurn) (QueuedTurn, int, error) {
	if s == nil || s.db == nil {
		return QueuedTurn{}, 0, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec.QueueID = strings.TrimSpace(rec.QueueID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	rec.ChannelID = strings.TrimSpace(rec.ChannelID)
	rec.MessageID = strings.TrimSpace(rec.MessageID)
	rec.ModelID = strings.TrimSpace(rec.ModelID)
	rec.TextContent = strings.TrimSpace(rec.TextContent)
	rec.AttachmentsJSON = strings.TrimSpace(rec.AttachmentsJSON)
	rec.OptionsJSON = strings.TrimSpace(rec.OptionsJSON)
	rec.CreatedByUserPublicID = strings.TrimSpace(rec.CreatedByUserPublicID)
	rec.CreatedByUserEmail = strings.TrimSpace(rec.CreatedByUserEmail)
	if rec.QueueID == "" || rec.EndpointID == "" || rec.ThreadID == "" || rec.ChannelID == "" || rec.MessageID == "" {
		return QueuedTurn{}, 0, errors.New("invalid request")
	}
	if rec.AttachmentsJSON == "" {
		rec.AttachmentsJSON = "[]"
	}
	if rec.OptionsJSON == "" {
		rec.OptionsJSON = "{}"
	}
	if rec.CreatedAtUnixMs <= 0 {
		rec.CreatedAtUnixMs = time.Now().UnixMilli()
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return QueuedTurn{}, 0, err
	}
	defer func() { _ = tx.Rollback() }()

	var exists int
	if err := tx.QueryRowContext(ctx, `
SELECT COUNT(1)
FROM ai_threads
WHERE endpoint_id = ? AND thread_id = ?
`, rec.EndpointID, rec.ThreadID).Scan(&exists); err != nil {
		return QueuedTurn{}, 0, err
	}
	if exists == 0 {
		return QueuedTurn{}, 0, sql.ErrNoRows
	}

	_, err = tx.ExecContext(ctx, `
INSERT INTO ai_queued_turns(
	  queue_id, endpoint_id, thread_id, channel_id, message_id, model_id, text_content, attachments_json, options_json,
	  created_by_user_public_id, created_by_user_email, created_at_unix_ms
)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, rec.QueueID, rec.EndpointID, rec.ThreadID, rec.ChannelID, rec.MessageID, rec.ModelID, rec.TextContent, rec.AttachmentsJSON, rec.OptionsJSON,
		rec.CreatedByUserPublicID, rec.CreatedByUserEmail, rec.CreatedAtUnixMs)
	if err != nil {
		if !isUniqueConstraintError(err) {
			return QueuedTurn{}, 0, err
		}
		existing, getErr := getQueuedTurnByMessageIDTx(ctx, tx, rec.EndpointID, rec.ThreadID, rec.MessageID)
		if getErr != nil {
			return QueuedTurn{}, 0, err
		}
		position, posErr := queuedTurnPositionTx(ctx, tx, rec.EndpointID, rec.ThreadID, existing.QueueID, existing.CreatedAtUnixMs)
		if posErr != nil {
			return QueuedTurn{}, 0, posErr
		}
		if commitErr := tx.Commit(); commitErr != nil {
			return QueuedTurn{}, 0, commitErr
		}
		return existing, position, nil
	}

	position, err := queuedTurnPositionTx(ctx, tx, rec.EndpointID, rec.ThreadID, rec.QueueID, rec.CreatedAtUnixMs)
	if err != nil {
		return QueuedTurn{}, 0, err
	}
	if err := tx.Commit(); err != nil {
		return QueuedTurn{}, 0, err
	}
	return rec, position, nil
}

func (s *Store) CountQueuedTurns(ctx context.Context, endpointID string, threadID string) (int, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return 0, errors.New("invalid request")
	}
	var count int
	err := s.db.QueryRowContext(ctx, `
SELECT COUNT(1)
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(&count)
	if err != nil {
		return 0, err
	}
	return count, nil
}

func (s *Store) CountQueuedTurnsByThread(ctx context.Context, endpointID string, threadIDs []string) (map[string]int, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	if endpointID == "" {
		return nil, errors.New("invalid request")
	}
	out := make(map[string]int, len(threadIDs))
	cleanIDs := make([]string, 0, len(threadIDs))
	seen := make(map[string]struct{}, len(threadIDs))
	for _, raw := range threadIDs {
		id := strings.TrimSpace(raw)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		cleanIDs = append(cleanIDs, id)
		out[id] = 0
	}
	if len(cleanIDs) == 0 {
		return out, nil
	}

	placeholders := strings.TrimRight(strings.Repeat("?,", len(cleanIDs)), ",")
	args := make([]any, 0, len(cleanIDs)+1)
	args = append(args, endpointID)
	for _, id := range cleanIDs {
		args = append(args, id)
	}

	rows, err := s.db.QueryContext(ctx, `
SELECT thread_id, COUNT(1)
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id IN (`+placeholders+`)
GROUP BY thread_id
`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var threadID string
		var count int
		if err := rows.Scan(&threadID, &count); err != nil {
			return nil, err
		}
		out[strings.TrimSpace(threadID)] = count
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) ListQueuedTurns(ctx context.Context, endpointID string, threadID string, limit int) ([]QueuedTurn, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return nil, errors.New("invalid request")
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}

	rows, err := s.db.QueryContext(ctx, `
SELECT queue_id, endpoint_id, thread_id, channel_id, message_id, model_id, text_content, attachments_json, options_json,
       created_by_user_public_id, created_by_user_email, created_at_unix_ms
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY created_at_unix_ms ASC, queue_id ASC
LIMIT ?
`, endpointID, threadID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]QueuedTurn, 0)
	for rows.Next() {
		rec, err := scanQueuedTurn(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) UpdateQueuedTurn(ctx context.Context, endpointID string, threadID string, queueID string, textContent string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	queueID = strings.TrimSpace(queueID)
	textContent = strings.TrimSpace(textContent)
	if endpointID == "" || threadID == "" || queueID == "" || textContent == "" {
		return errors.New("invalid request")
	}
	res, err := s.db.ExecContext(ctx, `
UPDATE ai_queued_turns
SET text_content = ?
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ?
`, textContent, endpointID, threadID, queueID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) DeleteQueuedTurn(ctx context.Context, endpointID string, threadID string, queueID string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	queueID = strings.TrimSpace(queueID)
	if endpointID == "" || threadID == "" || queueID == "" {
		return errors.New("invalid request")
	}
	res, err := s.db.ExecContext(ctx, `
DELETE FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ?
`, endpointID, threadID, queueID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) DeleteQueuedTurns(ctx context.Context, endpointID string, threadID string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid request")
	}
	_, err := s.db.ExecContext(ctx, `
DELETE FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID)
	return err
}

func (s *Store) PopNextQueuedTurn(ctx context.Context, endpointID string, threadID string) (*QueuedTurn, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return nil, errors.New("invalid request")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	rec, err := getNextQueuedTurnTx(ctx, tx, endpointID, threadID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
DELETE FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ?
`, endpointID, threadID, rec.QueueID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return rec, nil
}

func scanQueuedTurn(scanner interface{ Scan(...any) error }) (QueuedTurn, error) {
	var rec QueuedTurn
	err := scanner.Scan(
		&rec.QueueID,
		&rec.EndpointID,
		&rec.ThreadID,
		&rec.ChannelID,
		&rec.MessageID,
		&rec.ModelID,
		&rec.TextContent,
		&rec.AttachmentsJSON,
		&rec.OptionsJSON,
		&rec.CreatedByUserPublicID,
		&rec.CreatedByUserEmail,
		&rec.CreatedAtUnixMs,
	)
	if err != nil {
		return QueuedTurn{}, err
	}
	return rec, nil
}

func getQueuedTurnByMessageIDTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, messageID string) (QueuedTurn, error) {
	row := tx.QueryRowContext(ctx, `
SELECT queue_id, endpoint_id, thread_id, channel_id, message_id, model_id, text_content, attachments_json, options_json,
       created_by_user_public_id, created_by_user_email, created_at_unix_ms
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND message_id = ?
`, endpointID, threadID, messageID)
	return scanQueuedTurn(row)
}

func queuedTurnPositionTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, queueID string, createdAtUnixMs int64) (int, error) {
	var count int
	err := tx.QueryRowContext(ctx, `
SELECT COUNT(1)
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ?
  AND (created_at_unix_ms < ? OR (created_at_unix_ms = ? AND queue_id <= ?))
`, endpointID, threadID, createdAtUnixMs, createdAtUnixMs, queueID).Scan(&count)
	if err != nil {
		return 0, err
	}
	return count, nil
}

func getNextQueuedTurnTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) (*QueuedTurn, error) {
	row := tx.QueryRowContext(ctx, `
SELECT queue_id, endpoint_id, thread_id, channel_id, message_id, model_id, text_content, attachments_json, options_json,
       created_by_user_public_id, created_by_user_email, created_at_unix_ms
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY created_at_unix_ms ASC, queue_id ASC
LIMIT 1
`, endpointID, threadID)
	rec, err := scanQueuedTurn(row)
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

// AppendMessage inserts a message into the thread and updates thread metadata in the same transaction.
//
// It also sets a default title if the thread title is empty and this is a user message with non-empty text_content.
func (s *Store) AppendMessage(ctx context.Context, endpointID string, threadID string, m Message, updatedByID string, updatedByEmail string) (int64, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return 0, errors.New("invalid request")
	}

	m.ThreadID = strings.TrimSpace(m.ThreadID)
	if m.ThreadID == "" {
		m.ThreadID = threadID
	}
	m.EndpointID = strings.TrimSpace(m.EndpointID)
	if m.EndpointID == "" {
		m.EndpointID = endpointID
	}
	m.MessageID = strings.TrimSpace(m.MessageID)
	m.Role = strings.TrimSpace(m.Role)
	m.Status = strings.TrimSpace(m.Status)
	m.AuthorUserPublicID = strings.TrimSpace(m.AuthorUserPublicID)
	m.AuthorUserEmail = strings.TrimSpace(m.AuthorUserEmail)
	m.TextContent = strings.TrimSpace(m.TextContent)
	m.MessageJSON = strings.TrimSpace(m.MessageJSON)

	if m.MessageID == "" || m.Role == "" || m.Status == "" || m.MessageJSON == "" {
		return 0, errors.New("invalid message")
	}

	now := time.Now().UnixMilli()
	if m.CreatedAtUnixMs <= 0 {
		m.CreatedAtUnixMs = now
	}
	if m.UpdatedAtUnixMs <= 0 {
		m.UpdatedAtUnixMs = m.CreatedAtUnixMs
	}

	preview := buildPreview(m.Role, m.TextContent, m.MessageJSON)
	titleCandidate := ""
	if m.Role == "user" {
		titleCandidate = buildTitleCandidate(m.TextContent)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	// Ensure thread exists (and belongs to the endpoint).
	var existingTitle string
	if err := tx.QueryRowContext(ctx, `
SELECT title
FROM ai_threads
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(&existingTitle); err != nil {
		return 0, err
	}

	res, err := tx.ExecContext(ctx, `
INSERT INTO transcript_messages(
  thread_id, endpoint_id, message_id, role,
  author_user_public_id, author_user_email,
  status, created_at_unix_ms, updated_at_unix_ms,
  text_content, message_json
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
		threadID,
		endpointID,
		m.MessageID,
		m.Role,
		m.AuthorUserPublicID,
		m.AuthorUserEmail,
		m.Status,
		m.CreatedAtUnixMs,
		m.UpdatedAtUnixMs,
		m.TextContent,
		m.MessageJSON,
	)
	if err != nil {
		return 0, err
	}
	rowID, _ := res.LastInsertId()

	// Update thread metadata.
	nextTitle := strings.TrimSpace(existingTitle)
	if nextTitle == "" && titleCandidate != "" {
		nextTitle = titleCandidate
	}
	if _, err := tx.ExecContext(ctx, `
UPDATE ai_threads
SET title = ?,
    updated_at_unix_ms = ?,
    updated_by_user_public_id = ?,
    updated_by_user_email = ?,
    last_message_at_unix_ms = ?,
    last_message_preview = ?
WHERE endpoint_id = ? AND thread_id = ?
`,
		nextTitle,
		m.UpdatedAtUnixMs,
		strings.TrimSpace(updatedByID),
		strings.TrimSpace(updatedByEmail),
		m.CreatedAtUnixMs,
		preview,
		endpointID,
		threadID,
	); err != nil {
		return 0, err
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return rowID, nil
}

// ListMessages returns messages in ascending order by internal id.
//
// If beforeID <= 0, it returns the latest messages. Otherwise, it returns messages with id < beforeID.
// The returned nextBeforeID is the smallest id in the result (for loading older history).
func (s *Store) ListMessages(ctx context.Context, endpointID string, threadID string, limit int, beforeID int64) ([]Message, int64, bool, error) {
	if s == nil || s.db == nil {
		return nil, 0, false, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return nil, 0, false, errors.New("invalid request")
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	if beforeID <= 0 {
		beforeID = 1<<62 - 1
	}

	rows, err := s.db.QueryContext(ctx, `
SELECT id, thread_id, endpoint_id, message_id, role,
       author_user_public_id, author_user_email,
       status, created_at_unix_ms, updated_at_unix_ms,
       text_content, message_json
FROM transcript_messages
WHERE endpoint_id = ? AND thread_id = ? AND id < ?
ORDER BY id DESC
LIMIT ?
`, endpointID, threadID, beforeID, limit)
	if err != nil {
		return nil, 0, false, err
	}
	defer rows.Close()

	tmp := make([]Message, 0, limit)
	for rows.Next() {
		var m Message
		if err := rows.Scan(
			&m.ID,
			&m.ThreadID,
			&m.EndpointID,
			&m.MessageID,
			&m.Role,
			&m.AuthorUserPublicID,
			&m.AuthorUserEmail,
			&m.Status,
			&m.CreatedAtUnixMs,
			&m.UpdatedAtUnixMs,
			&m.TextContent,
			&m.MessageJSON,
		); err != nil {
			return nil, 0, false, err
		}
		tmp = append(tmp, m)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, false, err
	}
	if len(tmp) == 0 {
		return nil, 0, false, nil
	}

	// Reverse to ASC order.
	out := make([]Message, 0, len(tmp))
	for i := len(tmp) - 1; i >= 0; i-- {
		out = append(out, tmp[i])
	}
	nextBeforeID := out[0].ID

	// Determine whether there's more history.
	var more int
	if err := s.db.QueryRowContext(ctx, `
SELECT COUNT(1)
FROM transcript_messages
WHERE endpoint_id = ? AND thread_id = ? AND id < ?
`, endpointID, threadID, nextBeforeID).Scan(&more); err != nil {
		// Best-effort: if this fails, just say no more.
		more = 0
	}
	hasMore := more > 0

	return out, nextBeforeID, hasMore, nil
}

// ListMessagesAfter returns messages in ascending order by internal id.
//
// It returns messages with id > afterID. The returned nextAfterID is the largest id in the result
// (for incremental backfill). If no messages are returned, nextAfterID equals afterID.
func (s *Store) ListMessagesAfter(ctx context.Context, endpointID string, threadID string, limit int, afterID int64) ([]Message, int64, bool, error) {
	if s == nil || s.db == nil {
		return nil, 0, false, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return nil, 0, false, errors.New("invalid request")
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	if afterID < 0 {
		afterID = 0
	}

	rows, err := s.db.QueryContext(ctx, `
SELECT id, thread_id, endpoint_id, message_id, role,
       author_user_public_id, author_user_email,
       status, created_at_unix_ms, updated_at_unix_ms,
       text_content, message_json
FROM transcript_messages
WHERE endpoint_id = ? AND thread_id = ? AND id > ?
ORDER BY id ASC
LIMIT ?
`, endpointID, threadID, afterID, limit)
	if err != nil {
		return nil, afterID, false, err
	}
	defer rows.Close()

	out := make([]Message, 0, limit)
	for rows.Next() {
		var m Message
		if err := rows.Scan(
			&m.ID,
			&m.ThreadID,
			&m.EndpointID,
			&m.MessageID,
			&m.Role,
			&m.AuthorUserPublicID,
			&m.AuthorUserEmail,
			&m.Status,
			&m.CreatedAtUnixMs,
			&m.UpdatedAtUnixMs,
			&m.TextContent,
			&m.MessageJSON,
		); err != nil {
			return nil, afterID, false, err
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, afterID, false, err
	}
	if len(out) == 0 {
		return nil, afterID, false, nil
	}

	nextAfterID := out[len(out)-1].ID

	// Determine whether there's more history after the last returned id.
	var more int
	if err := s.db.QueryRowContext(ctx, `
SELECT COUNT(1)
FROM transcript_messages
WHERE endpoint_id = ? AND thread_id = ? AND id > ?
`, endpointID, threadID, nextAfterID).Scan(&more); err != nil {
		// Best-effort: if this fails, just say no more.
		more = 0
	}
	hasMore := more > 0

	return out, nextAfterID, hasMore, nil
}

// ListHistoryLite returns the latest messages as (role, status, text_content), in ascending order.
func (s *Store) ListHistoryLite(ctx context.Context, endpointID string, threadID string, limit int) ([]Message, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return nil, errors.New("invalid request")
	}
	if limit <= 0 {
		limit = 80
	}
	if limit > 400 {
		limit = 400
	}

	rows, err := s.db.QueryContext(ctx, `
SELECT id, role, status, text_content
FROM transcript_messages
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY id DESC
LIMIT ?
`, endpointID, threadID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tmp := make([]Message, 0, limit)
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.Role, &m.Status, &m.TextContent); err != nil {
			return nil, err
		}
		tmp = append(tmp, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Reverse to ASC.
	out := make([]Message, 0, len(tmp))
	for i := len(tmp) - 1; i >= 0; i-- {
		out = append(out, tmp[i])
	}
	return out, nil
}

// GetTranscriptMessageRowIDAndJSONByMessageID returns (row_id, message_json) for a transcript message.
func (s *Store) GetTranscriptMessageRowIDAndJSONByMessageID(ctx context.Context, endpointID string, threadID string, messageID string) (int64, string, error) {
	if s == nil || s.db == nil {
		return 0, "", errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	messageID = strings.TrimSpace(messageID)
	if endpointID == "" || threadID == "" || messageID == "" {
		return 0, "", errors.New("invalid request")
	}

	var rowID int64
	var raw string
	if err := s.db.QueryRowContext(ctx, `
SELECT id, message_json
FROM transcript_messages
WHERE endpoint_id = ? AND thread_id = ? AND message_id = ?
`, endpointID, threadID, messageID).Scan(&rowID, &raw); err != nil {
		return 0, "", err
	}
	return rowID, strings.TrimSpace(raw), nil
}

// UpdateTranscriptMessageJSONByRowID updates transcript_messages.message_json without mutating thread metadata.
func (s *Store) UpdateTranscriptMessageJSONByRowID(ctx context.Context, endpointID string, rowID int64, messageJSON string, updatedAtUnixMs int64) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	messageJSON = strings.TrimSpace(messageJSON)
	if endpointID == "" || rowID <= 0 || messageJSON == "" {
		return errors.New("invalid request")
	}
	if updatedAtUnixMs <= 0 {
		updatedAtUnixMs = time.Now().UnixMilli()
	}

	res, err := s.db.ExecContext(ctx, `
UPDATE transcript_messages
SET message_json = ?,
    updated_at_unix_ms = ?
WHERE endpoint_id = ? AND id = ?
`, messageJSON, updatedAtUnixMs, endpointID, rowID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

type RunRecord struct {
	RunID           string `json:"run_id"`
	EndpointID      string `json:"endpoint_id"`
	ThreadID        string `json:"thread_id"`
	MessageID       string `json:"message_id"`
	State           string `json:"state"`
	ErrorCode       string `json:"error_code"`
	ErrorMessage    string `json:"error_message"`
	AttemptCount    int    `json:"attempt_count"`
	StartedAtUnixMs int64  `json:"started_at_unix_ms"`
	EndedAtUnixMs   int64  `json:"ended_at_unix_ms"`
	UpdatedAtUnixMs int64  `json:"updated_at_unix_ms"`
}

type ToolCallRecord struct {
	RunID           string `json:"run_id"`
	ToolID          string `json:"tool_id"`
	ToolName        string `json:"tool_name"`
	Status          string `json:"status"`
	ArgsJSON        string `json:"args_json"`
	ResultJSON      string `json:"result_json"`
	ErrorCode       string `json:"error_code"`
	ErrorMessage    string `json:"error_message"`
	Retryable       bool   `json:"retryable"`
	RecoveryAction  string `json:"recovery_action"`
	StartedAtUnixMs int64  `json:"started_at_unix_ms"`
	EndedAtUnixMs   int64  `json:"ended_at_unix_ms"`
	LatencyMS       int64  `json:"latency_ms"`
}

type RunEventRecord struct {
	ID          int64  `json:"id"`
	EndpointID  string `json:"endpoint_id"`
	ThreadID    string `json:"thread_id"`
	RunID       string `json:"run_id"`
	StreamKind  string `json:"stream_kind"`
	EventType   string `json:"event_type"`
	PayloadJSON string `json:"payload_json"`
	AtUnixMs    int64  `json:"at_unix_ms"`
}

type RunEventsQuery struct {
	Cursor   int64
	Limit    int
	Category string
}

type ThreadState struct {
	EndpointID           string `json:"endpoint_id"`
	ThreadID             string `json:"thread_id"`
	OpenGoal             string `json:"open_goal"`
	LastAssistantSummary string `json:"last_assistant_summary"`
	UpdatedAtUnixMs      int64  `json:"updated_at_unix_ms"`
}

func (s *Store) GetThreadState(ctx context.Context, endpointID string, threadID string) (*ThreadState, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return nil, errors.New("invalid request")
	}
	var st ThreadState
	err := s.db.QueryRowContext(ctx, `
SELECT endpoint_id, thread_id, open_goal, last_assistant_summary, updated_at_unix_ms
FROM ai_thread_state
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(&st.EndpointID, &st.ThreadID, &st.OpenGoal, &st.LastAssistantSummary, &st.UpdatedAtUnixMs)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	st.OpenGoal = strings.TrimSpace(st.OpenGoal)
	st.LastAssistantSummary = strings.TrimSpace(st.LastAssistantSummary)
	return &st, nil
}

func (s *Store) UpsertThreadState(ctx context.Context, st ThreadState) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	st.EndpointID = strings.TrimSpace(st.EndpointID)
	st.ThreadID = strings.TrimSpace(st.ThreadID)
	st.OpenGoal = strings.TrimSpace(st.OpenGoal)
	st.LastAssistantSummary = strings.TrimSpace(st.LastAssistantSummary)
	if st.EndpointID == "" || st.ThreadID == "" {
		return errors.New("invalid thread state")
	}
	if st.UpdatedAtUnixMs <= 0 {
		st.UpdatedAtUnixMs = time.Now().UnixMilli()
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO ai_thread_state(endpoint_id, thread_id, open_goal, last_assistant_summary, updated_at_unix_ms)
VALUES(?, ?, ?, ?, ?)
ON CONFLICT(endpoint_id, thread_id) DO UPDATE SET
  open_goal=excluded.open_goal,
  last_assistant_summary=excluded.last_assistant_summary,
  updated_at_unix_ms=excluded.updated_at_unix_ms
`, st.EndpointID, st.ThreadID, st.OpenGoal, st.LastAssistantSummary, st.UpdatedAtUnixMs)
	return err
}

func (s *Store) ClearThreadState(ctx context.Context, endpointID string, threadID string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid request")
	}
	_, err := s.db.ExecContext(ctx, `
DELETE FROM ai_thread_state
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID)
	return err
}

func (s *Store) UpsertRun(ctx context.Context, rec RunRecord) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec.RunID = strings.TrimSpace(rec.RunID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	rec.MessageID = strings.TrimSpace(rec.MessageID)
	rec.State = normalizeRunStatus(rec.State)
	rec.ErrorCode = strings.TrimSpace(rec.ErrorCode)
	rec.ErrorMessage = strings.TrimSpace(rec.ErrorMessage)
	if rec.RunID == "" || rec.EndpointID == "" || rec.ThreadID == "" {
		return errors.New("invalid run record")
	}
	now := time.Now().UnixMilli()
	if rec.UpdatedAtUnixMs <= 0 {
		rec.UpdatedAtUnixMs = now
	}
	if rec.StartedAtUnixMs <= 0 {
		rec.StartedAtUnixMs = now
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO ai_runs(
  run_id, endpoint_id, thread_id, message_id,
  state, error_code, error_message, attempt_count,
  started_at_unix_ms, ended_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(run_id) DO UPDATE SET
  endpoint_id=excluded.endpoint_id,
  thread_id=excluded.thread_id,
  message_id=excluded.message_id,
  state=excluded.state,
  error_code=excluded.error_code,
  error_message=excluded.error_message,
  attempt_count=excluded.attempt_count,
  started_at_unix_ms=excluded.started_at_unix_ms,
  ended_at_unix_ms=excluded.ended_at_unix_ms,
  updated_at_unix_ms=excluded.updated_at_unix_ms
`, rec.RunID, rec.EndpointID, rec.ThreadID, rec.MessageID, rec.State, rec.ErrorCode, rec.ErrorMessage, rec.AttemptCount, rec.StartedAtUnixMs, rec.EndedAtUnixMs, rec.UpdatedAtUnixMs)
	return err
}

func (s *Store) UpsertToolCall(ctx context.Context, rec ToolCallRecord) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec.RunID = strings.TrimSpace(rec.RunID)
	rec.ToolID = strings.TrimSpace(rec.ToolID)
	rec.ToolName = strings.TrimSpace(rec.ToolName)
	rec.Status = strings.TrimSpace(rec.Status)
	rec.ArgsJSON = strings.TrimSpace(rec.ArgsJSON)
	rec.ResultJSON = strings.TrimSpace(rec.ResultJSON)
	rec.ErrorCode = strings.TrimSpace(rec.ErrorCode)
	rec.ErrorMessage = strings.TrimSpace(rec.ErrorMessage)
	rec.RecoveryAction = strings.TrimSpace(rec.RecoveryAction)
	if rec.RunID == "" || rec.ToolID == "" || rec.ToolName == "" || rec.Status == "" {
		return errors.New("invalid tool call record")
	}
	if rec.ArgsJSON == "" {
		rec.ArgsJSON = "{}"
	}
	now := time.Now().UnixMilli()
	if rec.StartedAtUnixMs <= 0 {
		rec.StartedAtUnixMs = now
	}
	if rec.EndedAtUnixMs > 0 && rec.LatencyMS <= 0 && rec.EndedAtUnixMs >= rec.StartedAtUnixMs {
		rec.LatencyMS = rec.EndedAtUnixMs - rec.StartedAtUnixMs
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO ai_tool_calls(
  run_id, tool_id, tool_name, status,
  args_json, result_json, error_code, error_message,
  retryable, recovery_action, started_at_unix_ms, ended_at_unix_ms, latency_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(run_id, tool_id) DO UPDATE SET
  tool_name=excluded.tool_name,
  status=excluded.status,
  args_json=excluded.args_json,
  result_json=excluded.result_json,
  error_code=excluded.error_code,
  error_message=excluded.error_message,
  retryable=excluded.retryable,
  recovery_action=excluded.recovery_action,
  started_at_unix_ms=excluded.started_at_unix_ms,
  ended_at_unix_ms=excluded.ended_at_unix_ms,
  latency_ms=excluded.latency_ms
`, rec.RunID, rec.ToolID, rec.ToolName, rec.Status, rec.ArgsJSON, rec.ResultJSON, rec.ErrorCode, rec.ErrorMessage, boolToInt(rec.Retryable), rec.RecoveryAction, rec.StartedAtUnixMs, rec.EndedAtUnixMs, rec.LatencyMS)
	return err
}

func (s *Store) ListRecentThreadToolCalls(ctx context.Context, endpointID string, threadID string, limit int) ([]ToolCallRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return nil, errors.New("invalid request")
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 200 {
		limit = 200
	}

	rows, err := s.db.QueryContext(ctx, `
SELECT tc.run_id, tc.tool_id, tc.tool_name, tc.status,
       tc.args_json, tc.result_json, tc.error_code, tc.error_message,
       tc.retryable, tc.recovery_action,
       tc.started_at_unix_ms, tc.ended_at_unix_ms, tc.latency_ms
FROM ai_tool_calls tc
JOIN ai_runs r ON r.run_id = tc.run_id
WHERE r.endpoint_id = ? AND r.thread_id = ?
ORDER BY tc.id DESC
LIMIT ?
`, endpointID, threadID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tmp := make([]ToolCallRecord, 0, limit)
	for rows.Next() {
		var rec ToolCallRecord
		var retryableInt int
		if err := rows.Scan(
			&rec.RunID,
			&rec.ToolID,
			&rec.ToolName,
			&rec.Status,
			&rec.ArgsJSON,
			&rec.ResultJSON,
			&rec.ErrorCode,
			&rec.ErrorMessage,
			&retryableInt,
			&rec.RecoveryAction,
			&rec.StartedAtUnixMs,
			&rec.EndedAtUnixMs,
			&rec.LatencyMS,
		); err != nil {
			return nil, err
		}
		rec.Retryable = retryableInt != 0
		tmp = append(tmp, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Reverse to ASC for stable chronological context.
	out := make([]ToolCallRecord, 0, len(tmp))
	for i := len(tmp) - 1; i >= 0; i-- {
		out = append(out, tmp[i])
	}
	return out, nil
}

func (s *Store) GetToolCall(ctx context.Context, endpointID string, runID string, toolID string) (*ToolCallRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	runID = strings.TrimSpace(runID)
	toolID = strings.TrimSpace(toolID)
	if endpointID == "" || runID == "" || toolID == "" {
		return nil, errors.New("invalid request")
	}

	var (
		rec          ToolCallRecord
		retryableInt int
	)
	err := s.db.QueryRowContext(ctx, `
SELECT tc.run_id, tc.tool_id, tc.tool_name, tc.status,
       tc.args_json, tc.result_json, tc.error_code, tc.error_message,
       tc.retryable, tc.recovery_action,
       tc.started_at_unix_ms, tc.ended_at_unix_ms, tc.latency_ms
FROM ai_tool_calls tc
JOIN ai_runs r ON r.run_id = tc.run_id
WHERE r.endpoint_id = ? AND tc.run_id = ? AND tc.tool_id = ?
LIMIT 1
`, endpointID, runID, toolID).Scan(
		&rec.RunID,
		&rec.ToolID,
		&rec.ToolName,
		&rec.Status,
		&rec.ArgsJSON,
		&rec.ResultJSON,
		&rec.ErrorCode,
		&rec.ErrorMessage,
		&retryableInt,
		&rec.RecoveryAction,
		&rec.StartedAtUnixMs,
		&rec.EndedAtUnixMs,
		&rec.LatencyMS,
	)
	if err != nil {
		return nil, err
	}
	rec.Retryable = retryableInt != 0
	return &rec, nil
}

func (s *Store) AppendRunEvent(ctx context.Context, rec RunEventRecord) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	rec.RunID = strings.TrimSpace(rec.RunID)
	rec.StreamKind = strings.TrimSpace(rec.StreamKind)
	rec.EventType = strings.TrimSpace(rec.EventType)
	rec.PayloadJSON = strings.TrimSpace(rec.PayloadJSON)
	if rec.EndpointID == "" || rec.ThreadID == "" || rec.RunID == "" || rec.EventType == "" {
		return errors.New("invalid run event")
	}
	if rec.PayloadJSON == "" {
		rec.PayloadJSON = "{}"
	}
	if rec.AtUnixMs <= 0 {
		rec.AtUnixMs = time.Now().UnixMilli()
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO ai_run_events(endpoint_id, thread_id, run_id, stream_kind, event_type, payload_json, at_unix_ms)
VALUES(?, ?, ?, ?, ?, ?, ?)
`, rec.EndpointID, rec.ThreadID, rec.RunID, rec.StreamKind, rec.EventType, rec.PayloadJSON, rec.AtUnixMs)
	if err != nil {
		return err
	}
	return s.pruneRunEventsForThread(ctx, rec.EndpointID, rec.ThreadID)
}

func (s *Store) ListRunEvents(ctx context.Context, endpointID string, runID string, limit int) ([]RunEventRecord, error) {
	recs, _, _, err := s.ListRunEventsPage(ctx, endpointID, runID, RunEventsQuery{
		Limit: limit,
	})
	return recs, err
}

func (s *Store) ListRunEventsPage(ctx context.Context, endpointID string, runID string, query RunEventsQuery) ([]RunEventRecord, int64, bool, error) {
	if s == nil || s.db == nil {
		return nil, 0, false, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	runID = strings.TrimSpace(runID)
	if endpointID == "" || runID == "" {
		return nil, 0, false, errors.New("invalid request")
	}

	limit := query.Limit
	if limit <= 0 {
		limit = 200
	}
	if limit > 2000 {
		limit = 2000
	}
	cursor := query.Cursor
	if cursor < 0 {
		cursor = 0
	}

	category := strings.TrimSpace(strings.ToLower(query.Category))
	switch category {
	case "", "all":
		category = ""
	case "context":
		// keep as-is
	default:
		return nil, 0, false, fmt.Errorf("unsupported run event category: %s", category)
	}

	args := []any{endpointID, runID, cursor}
	whereCategory := ""
	if category == "context" {
		// Explicit whitelist to avoid leaking non-UI diagnostic categories (for example context.integrity.*).
		whereCategory = `
AND (
  event_type = 'context.usage.updated'
  OR event_type LIKE 'context.compaction.%'
)`
	}
	args = append(args, limit+1)

	q := fmt.Sprintf(`
SELECT id, endpoint_id, thread_id, run_id, stream_kind, event_type, payload_json, at_unix_ms
FROM ai_run_events
WHERE endpoint_id = ? AND run_id = ? AND id > ?
%s
ORDER BY id ASC
LIMIT ?
`, whereCategory)
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, 0, false, err
	}
	defer rows.Close()
	out := make([]RunEventRecord, 0, limit+1)
	for rows.Next() {
		var rec RunEventRecord
		if err := rows.Scan(&rec.ID, &rec.EndpointID, &rec.ThreadID, &rec.RunID, &rec.StreamKind, &rec.EventType, &rec.PayloadJSON, &rec.AtUnixMs); err != nil {
			return nil, 0, false, err
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, false, err
	}
	hasMore := len(out) > limit
	if hasMore {
		out = out[:limit]
	}
	nextCursor := cursor
	if len(out) > 0 {
		nextCursor = out[len(out)-1].ID
	}
	return out, nextCursor, hasMore, nil
}

func (s *Store) pruneRunEventsForThread(ctx context.Context, endpointID string, threadID string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid request")
	}

	if runEventRetentionMaxAge > 0 {
		minAtUnixMs := time.Now().Add(-runEventRetentionMaxAge).UnixMilli()
		if _, err := s.db.ExecContext(ctx, `
DELETE FROM ai_run_events
WHERE endpoint_id = ? AND thread_id = ? AND at_unix_ms > 0 AND at_unix_ms < ?
`, endpointID, threadID, minAtUnixMs); err != nil {
			return err
		}
	}

	if runEventRetentionMaxPerThread > 0 {
		if _, err := s.db.ExecContext(ctx, `
DELETE FROM ai_run_events
WHERE id IN (
  SELECT id
  FROM ai_run_events
  WHERE endpoint_id = ? AND thread_id = ?
  ORDER BY id DESC
  LIMIT -1 OFFSET ?
)
`, endpointID, threadID, runEventRetentionMaxPerThread); err != nil {
			return err
		}
	}
	return nil
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func scrubLegacyModelDefaultToken(tx *sql.Tx) error {
	if tx == nil {
		return errors.New("nil tx")
	}

	legacyToken := strings.Join([]string{"is", "default"}, "_")
	const replacementToken = "current_model_id"

	type target struct {
		table  string
		column string
	}
	targets := []target{
		{table: "ai_threads", column: "title"},
		{table: "ai_threads", column: "last_message_preview"},
		{table: "ai_messages", column: "text_content"},
		{table: "ai_messages", column: "message_json"},
		{table: "ai_runs", column: "error_message"},
		{table: "ai_tool_calls", column: "args_json"},
		{table: "ai_tool_calls", column: "result_json"},
		{table: "ai_tool_calls", column: "error_message"},
		{table: "ai_run_events", column: "payload_json"},
		{table: "transcript_messages", column: "text_content"},
		{table: "transcript_messages", column: "message_json"},
		{table: "execution_spans", column: "payload_json"},
		{table: "memory_items", column: "content"},
		{table: "provider_capabilities", column: "capability_json"},
	}

	for _, item := range targets {
		hasColumn, err := columnExists(tx, item.table, item.column)
		if err != nil {
			return err
		}
		if !hasColumn {
			continue
		}

		stmt := fmt.Sprintf(`
UPDATE %s
SET %s = REPLACE(%s, ?, ?)
WHERE instr(%s, ?) > 0
`, item.table, item.column, item.column, item.column)
		if _, err := tx.Exec(stmt, legacyToken, replacementToken, legacyToken); err != nil {
			return err
		}
	}

	return nil
}

func columnExists(tx *sql.Tx, tableName string, colName string) (bool, error) {
	tableName = strings.TrimSpace(tableName)
	colName = strings.TrimSpace(colName)
	if tableName == "" || colName == "" {
		return false, errors.New("invalid table/column")
	}

	rows, err := tx.Query(`PRAGMA table_info(` + tableName + `)`)
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var ctype string
		var notNull int
		var defaultValue sql.NullString
		var primaryKey int
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &defaultValue, &primaryKey); err != nil {
			return false, err
		}
		if strings.EqualFold(strings.TrimSpace(name), colName) {
			return true, nil
		}
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	return false, nil
}

func buildPreview(role string, text string, messageJSON string) string {
	role = strings.TrimSpace(role)
	text = strings.TrimSpace(text)
	if role == "assistant" {
		if latest := latestAssistantMarkdown(messageJSON); latest != "" {
			text = latest
		}
	}
	if text == "" {
		if role == "user" {
			return "(no text)"
		}
		return ""
	}
	// Single-line preview, capped.
	text = strings.ReplaceAll(text, "\n", " ")
	text = strings.ReplaceAll(text, "\r", " ")
	text = strings.TrimSpace(text)
	return truncateRunes(text, 160)
}

func latestAssistantMarkdown(messageJSON string) string {
	raw := strings.TrimSpace(messageJSON)
	if raw == "" {
		return ""
	}

	var payload struct {
		Blocks []json.RawMessage `json:"blocks"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return ""
	}
	for i := len(payload.Blocks) - 1; i >= 0; i-- {
		blk := payload.Blocks[i]
		if len(blk) == 0 {
			continue
		}
		var meta struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(blk, &meta); err != nil {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(meta.Type), "markdown") {
			continue
		}
		var md struct {
			Content string `json:"content"`
		}
		if err := json.Unmarshal(blk, &md); err != nil {
			continue
		}
		if content := strings.TrimSpace(md.Content); content != "" {
			return content
		}
	}
	return ""
}

func buildTitleCandidate(text string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}
	text = strings.ReplaceAll(text, "\n", " ")
	text = strings.ReplaceAll(text, "\r", " ")
	text = strings.TrimSpace(text)
	return truncateRunes(text, 48)
}

func truncateRunes(s string, max int) string {
	if max <= 0 {
		return ""
	}
	n := 0
	for i := range s {
		if n >= max {
			return strings.TrimSpace(s[:i])
		}
		n++
	}
	return strings.TrimSpace(s)
}
