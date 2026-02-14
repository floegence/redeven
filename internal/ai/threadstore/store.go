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
	ThreadID           string `json:"thread_id"`
	EndpointID         string `json:"endpoint_id"`
	NamespacePublicID  string `json:"namespace_public_id"`
	ModelID            string `json:"model_id"`
	Title              string `json:"title"`
	RunStatus          string `json:"run_status"`
	RunUpdatedAtUnixMs int64  `json:"run_updated_at_unix_ms"`
	RunError           string `json:"run_error"`

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
  thread_id, endpoint_id, namespace_public_id, model_id, title,
  run_status, run_updated_at_unix_ms, run_error,
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
		if err := rows.Scan(
			&t.ThreadID,
			&t.EndpointID,
			&t.NamespacePublicID,
			&t.ModelID,
			&t.Title,
			&t.RunStatus,
			&t.RunUpdatedAtUnixMs,
			&t.RunError,
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
	err := s.db.QueryRowContext(ctx, `
SELECT
  thread_id, endpoint_id, namespace_public_id, model_id, title,
  run_status, run_updated_at_unix_ms, run_error,
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
		&t.Title,
		&t.RunStatus,
		&t.RunUpdatedAtUnixMs,
		&t.RunError,
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
	t.Title = strings.TrimSpace(t.Title)
	t.RunStatus = normalizeRunStatus(t.RunStatus)
	t.RunError = strings.TrimSpace(t.RunError)
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
  thread_id, endpoint_id, namespace_public_id, model_id, title,
  run_status, run_updated_at_unix_ms, run_error,
  created_by_user_public_id, created_by_user_email,
  updated_by_user_public_id, updated_by_user_email,
  created_at_unix_ms, updated_at_unix_ms,
  last_message_at_unix_ms, last_message_preview
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
		t.ThreadID,
		t.EndpointID,
		t.NamespacePublicID,
		t.ModelID,
		t.Title,
		t.RunStatus,
		t.RunUpdatedAtUnixMs,
		t.RunError,
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
	case "idle", "accepted", "running", "waiting_approval", "recovering", "waiting_user", "success", "failed", "canceled", "timed_out":
		return status
	default:
		return "idle"
	}
}

func (s *Store) UpdateThreadRunState(ctx context.Context, endpointID string, threadID string, runStatus string, runError string, updatedByID string, updatedByEmail string) error {
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
	if len(runError) > 600 {
		runError = truncateRunes(runError, 600)
	}

	now := time.Now().UnixMilli()
	res, err := s.db.ExecContext(ctx, `
UPDATE ai_threads
SET run_status = ?,
    run_updated_at_unix_ms = ?,
    run_error = ?,
    updated_at_unix_ms = ?,
    updated_by_user_public_id = ?,
    updated_by_user_email = ?
WHERE endpoint_id = ? AND thread_id = ?
`, runStatus, now, runError, now, strings.TrimSpace(updatedByID), strings.TrimSpace(updatedByEmail), endpointID, threadID)
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
	EndpointID  string `json:"endpoint_id"`
	ThreadID    string `json:"thread_id"`
	RunID       string `json:"run_id"`
	StreamKind  string `json:"stream_kind"`
	EventType   string `json:"event_type"`
	PayloadJSON string `json:"payload_json"`
	AtUnixMs    int64  `json:"at_unix_ms"`
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
	return err
}

func (s *Store) ListRunEvents(ctx context.Context, endpointID string, runID string, limit int) ([]RunEventRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	runID = strings.TrimSpace(runID)
	if endpointID == "" || runID == "" {
		return nil, errors.New("invalid request")
	}
	if limit <= 0 {
		limit = 200
	}
	if limit > 2000 {
		limit = 2000
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT endpoint_id, thread_id, run_id, stream_kind, event_type, payload_json, at_unix_ms
FROM ai_run_events
WHERE endpoint_id = ? AND run_id = ?
ORDER BY id ASC
LIMIT ?
`, endpointID, runID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]RunEventRecord, 0, limit)
	for rows.Next() {
		var rec RunEventRecord
		if err := rows.Scan(&rec.EndpointID, &rec.ThreadID, &rec.RunID, &rec.StreamKind, &rec.EventType, &rec.PayloadJSON, &rec.AtUnixMs); err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func initSchema(db *sql.DB) error {
	if db == nil {
		return errors.New("nil db")
	}
	if _, err := db.Exec(`PRAGMA journal_mode=WAL;`); err != nil {
		return fmt.Errorf("pragma journal_mode: %w", err)
	}
	if _, err := db.Exec(`PRAGMA busy_timeout=3000;`); err != nil {
		return fmt.Errorf("pragma busy_timeout: %w", err)
	}
	return migrateSchema(db)
}

func migrateSchema(db *sql.DB) error {
	if db == nil {
		return errors.New("nil db")
	}
	const targetVersion = 7

	var v int
	if err := db.QueryRow(`PRAGMA user_version;`).Scan(&v); err != nil {
		return fmt.Errorf("pragma user_version: %w", err)
	}
	if v >= targetVersion {
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	// Fresh DB: create the latest schema directly.
	var exists int
	if err := tx.QueryRow(`
SELECT COUNT(1)
FROM sqlite_master
WHERE type = 'table' AND name = 'ai_threads'
`).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		if _, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS ai_threads (
  thread_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  namespace_public_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  run_status TEXT NOT NULL DEFAULT 'idle',
  run_updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  run_error TEXT NOT NULL DEFAULT '',
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
`); err != nil {
			return err
		}
	}

	if has, err := columnExists(tx, "ai_threads", "model_id"); err != nil {
		return err
	} else if !has {
		if _, err := tx.Exec(`ALTER TABLE ai_threads ADD COLUMN model_id TEXT NOT NULL DEFAULT ''`); err != nil {
			return err
		}
	}

	if has, err := columnExists(tx, "ai_threads", "run_status"); err != nil {
		return err
	} else if !has {
		if _, err := tx.Exec(`ALTER TABLE ai_threads ADD COLUMN run_status TEXT NOT NULL DEFAULT 'idle'`); err != nil {
			return err
		}
	}
	if has, err := columnExists(tx, "ai_threads", "run_updated_at_unix_ms"); err != nil {
		return err
	} else if !has {
		if _, err := tx.Exec(`ALTER TABLE ai_threads ADD COLUMN run_updated_at_unix_ms INTEGER NOT NULL DEFAULT 0`); err != nil {
			return err
		}
	}
	if has, err := columnExists(tx, "ai_threads", "run_error"); err != nil {
		return err
	} else if !has {
		if _, err := tx.Exec(`ALTER TABLE ai_threads ADD COLUMN run_error TEXT NOT NULL DEFAULT ''`); err != nil {
			return err
		}
	}

	var msgExists int
	if err := tx.QueryRow(`
SELECT COUNT(1)
FROM sqlite_master
WHERE type = 'table' AND name = 'ai_messages'
`).Scan(&msgExists); err != nil {
		return err
	}
	if msgExists == 0 {
		if _, err := tx.Exec(`
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
	}

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

	// v7: Convert legacy "Action blocked:" todos into blockers, so they no longer pollute pending_todos.
	if _, err := tx.Exec(`
UPDATE memory_items
SET kind = 'blocker'
WHERE kind = 'todo' AND content LIKE 'Action blocked:%'
`); err != nil {
		return err
	}

	if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version=%d;`, targetVersion)); err != nil {
		return err
	}
	return tx.Commit()
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
