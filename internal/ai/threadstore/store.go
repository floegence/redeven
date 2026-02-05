package threadstore

import (
	"context"
	"database/sql"
	"encoding/base64"
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
	ThreadID          string `json:"thread_id"`
	EndpointID        string `json:"endpoint_id"`
	NamespacePublicID string `json:"namespace_public_id"`
	Title             string `json:"title"`

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
  thread_id, endpoint_id, namespace_public_id, title,
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
			&t.Title,
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
  thread_id, endpoint_id, namespace_public_id, title,
  created_by_user_public_id, created_by_user_email,
  updated_by_user_public_id, updated_by_user_email,
  created_at_unix_ms, updated_at_unix_ms, last_message_at_unix_ms, last_message_preview
FROM ai_threads
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(
		&t.ThreadID,
		&t.EndpointID,
		&t.NamespacePublicID,
		&t.Title,
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
	t.Title = strings.TrimSpace(t.Title)
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

	_, err := s.db.ExecContext(ctx, `
INSERT INTO ai_threads(
  thread_id, endpoint_id, namespace_public_id, title,
  created_by_user_public_id, created_by_user_email,
  updated_by_user_public_id, updated_by_user_email,
  created_at_unix_ms, updated_at_unix_ms,
  last_message_at_unix_ms, last_message_preview
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
		t.ThreadID,
		t.EndpointID,
		t.NamespacePublicID,
		t.Title,
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

	preview := buildPreview(m.Role, m.TextContent)
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
INSERT INTO ai_messages(
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
FROM ai_messages
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
FROM ai_messages
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
FROM ai_messages
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
	const targetVersion = 1

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

	// Fresh DB: create v1 directly.
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
`); err != nil {
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

	if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version=%d;`, targetVersion)); err != nil {
		return err
	}
	return tx.Commit()
}

func buildPreview(role string, text string) string {
	role = strings.TrimSpace(role)
	text = strings.TrimSpace(text)
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
