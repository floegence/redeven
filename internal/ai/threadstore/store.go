package threadstore

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
	_ "modernc.org/sqlite"
)

// Store is a local SQLite-backed persistence layer for Redeven product data.
//
// Notes:
// - Data is scoped by endpoint_id (env public id). It is intentionally shared within the same env for collaboration.
// - WAL is enabled to support concurrent reads while writing (multiple browser sessions).
type Store struct {
	db *sql.DB
}

const (
	ThreadTitleSourceAuto = "auto"
	ThreadTitleSourceUser = "user"
)

type OpenOption func(*openOptions)

type openOptions struct {
	ensureThread func(string) error
}

func WithThreadIdentityEnsurer(ensureThread func(string) error) OpenOption {
	return func(options *openOptions) {
		options.ensureThread = ensureThread
	}
}

func Open(path string, optionList ...OpenOption) (*Store, error) {
	p := filepath.Clean(strings.TrimSpace(path))
	if p == "" {
		return nil, errors.New("missing db path")
	}
	options := openOptions{}
	for _, option := range optionList {
		if option != nil {
			option(&options)
		}
	}
	db, err := sqliteutil.Open(p, threadstoreSchemaSpec(options.ensureThread))
	if err != nil {
		return nil, err
	}
	if err := ensureIncrementalAutoVacuum(db); err != nil {
		_ = db.Close()
		return nil, err
	}

	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

type Thread struct {
	ThreadID               string `json:"thread_id"`
	EndpointID             string `json:"endpoint_id"`
	NamespacePublicID      string `json:"namespace_public_id"`
	ModelID                string `json:"model_id"`
	ReasoningSelectionJSON string `json:"reasoning_selection_json"`
	PermissionType         string `json:"permission_type"`
	WorkingDir             string `json:"working_dir"`
	Title                  string `json:"title"`
	TitleSource            string `json:"title_source"`
	TitleGeneratedAtUnixMs int64  `json:"title_generated_at_unix_ms"`
	TitleInputMessageID    string `json:"title_input_message_id"`
	TitleModelID           string `json:"title_model_id"`
	TitlePromptVersion     string `json:"title_prompt_version"`
	PinnedAtUnixMs         int64  `json:"pinned_at_unix_ms"`

	CreatedByUserPublicID string `json:"created_by_user_public_id"`
	CreatedByUserEmail    string `json:"created_by_user_email"`
	UpdatedByUserPublicID string `json:"updated_by_user_public_id"`
	UpdatedByUserEmail    string `json:"updated_by_user_email"`

	CreatedAtUnixMs int64 `json:"created_at_unix_ms"`
	UpdatedAtUnixMs int64 `json:"updated_at_unix_ms"`
}

type AutoThreadTitleCandidate struct {
	EndpointID string `json:"endpoint_id"`
	ThreadID   string `json:"thread_id"`
}

type QueuedTurn struct {
	QueueID string `json:"queue_id"`

	ThreadID   string `json:"thread_id"`
	EndpointID string `json:"endpoint_id"`
	ChannelID  string `json:"channel_id"`
	Lane       string `json:"lane"`

	TurnID  string `json:"turn_id"`
	RunID   string `json:"run_id"`
	ModelID string `json:"model_id"`

	TextContent       string `json:"text_content"`
	AttachmentsJSON   string `json:"attachments_json"`
	ContextActionJSON string `json:"context_action_json"`
	OptionsJSON       string `json:"options_json"`
	SessionMetaJSON   string `json:"session_meta_json"`

	CreatedByUserPublicID string `json:"created_by_user_public_id"`
	CreatedByUserEmail    string `json:"created_by_user_email"`

	SortIndex       int64 `json:"sort_index"`
	CreatedAtUnixMs int64 `json:"created_at_unix_ms"`
	UpdatedAtUnixMs int64 `json:"updated_at_unix_ms"`
}

type QueuedThread struct {
	EndpointID           string `json:"endpoint_id"`
	ThreadID             string `json:"thread_id"`
	NamespacePublicID    string `json:"namespace_public_id"`
	QueuedTurnCount      int    `json:"queued_turn_count"`
	FirstQueuedAtUnixMs  int64  `json:"first_queued_at_unix_ms"`
	FirstQueuedSortIndex int64  `json:"first_queued_sort_index"`
	FirstQueuedTurnID    string `json:"first_queued_turn_id"`
}

type ThreadsCursor struct {
	PinnedAtUnixMs  int64
	CreatedAtUnixMs int64
	ThreadID        string
}

const threadSelectColumnsSQL = `
  thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json, permission_type, working_dir, title,
  title_source, title_generated_at_unix_ms, title_input_message_id, title_model_id, title_prompt_version,
  pinned_at_unix_ms,
  created_by_user_public_id, created_by_user_email,
  updated_by_user_public_id, updated_by_user_email,
  created_at_unix_ms, updated_at_unix_ms
`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanThreadRow(scan rowScanner, t *Thread) error {
	if t == nil {
		return errors.New("nil thread")
	}
	if err := scan.Scan(
		&t.ThreadID,
		&t.EndpointID,
		&t.NamespacePublicID,
		&t.ModelID,
		&t.ReasoningSelectionJSON,
		&t.PermissionType,
		&t.WorkingDir,
		&t.Title,
		&t.TitleSource,
		&t.TitleGeneratedAtUnixMs,
		&t.TitleInputMessageID,
		&t.TitleModelID,
		&t.TitlePromptVersion,
		&t.PinnedAtUnixMs,
		&t.CreatedByUserPublicID,
		&t.CreatedByUserEmail,
		&t.UpdatedByUserPublicID,
		&t.UpdatedByUserEmail,
		&t.CreatedAtUnixMs,
		&t.UpdatedAtUnixMs,
	); err != nil {
		return err
	}
	permissionType, err := canonicalPermissionType(t.PermissionType)
	if err != nil {
		return err
	}
	t.PermissionType = permissionType
	t.ReasoningSelectionJSON = strings.TrimSpace(t.ReasoningSelectionJSON)
	t.TitleSource = normalizeThreadTitleSource(t.TitleSource)
	t.TitleInputMessageID = strings.TrimSpace(t.TitleInputMessageID)
	t.TitleModelID = strings.TrimSpace(t.TitleModelID)
	t.TitlePromptVersion = strings.TrimSpace(t.TitlePromptVersion)
	return nil
}

// EncodeCursor encodes a cursor as a URL-safe base64 string.
func EncodeCursor(c ThreadsCursor) string {
	if c.CreatedAtUnixMs <= 0 || strings.TrimSpace(c.ThreadID) == "" {
		return ""
	}
	raw := fmt.Sprintf("%d:%d:%s", nonNegativeInt64(c.PinnedAtUnixMs), c.CreatedAtUnixMs, strings.TrimSpace(c.ThreadID))
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
	parts := strings.SplitN(string(b), ":", 3)
	if len(parts) != 2 && len(parts) != 3 {
		return ThreadsCursor{}, false
	}
	pinnedAt := int64(0)
	createdIndex := 0
	idIndex := 1
	if len(parts) == 3 {
		ms, err := parseInt64(parts[0])
		if err != nil || ms < 0 {
			return ThreadsCursor{}, false
		}
		pinnedAt = ms
		createdIndex = 1
		idIndex = 2
	}
	ms, err := parseInt64(parts[createdIndex])
	if err != nil || ms <= 0 {
		return ThreadsCursor{}, false
	}
	id := strings.TrimSpace(parts[idIndex])
	if id == "" {
		return ThreadsCursor{}, false
	}
	return ThreadsCursor{PinnedAtUnixMs: pinnedAt, CreatedAtUnixMs: ms, ThreadID: id}, true
}

func parseInt64(raw string) (int64, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, errors.New("empty")
	}
	return strconv.ParseInt(raw, 10, 64)
}

func nonNegativeInt64(v int64) int64 {
	if v < 0 {
		return 0
	}
	return v
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
	q := fmt.Sprintf(`
SELECT
%s
FROM ai_threads
WHERE endpoint_id = ?
`, threadSelectColumnsSQL)
	if cursor.CreatedAtUnixMs > 0 && strings.TrimSpace(cursor.ThreadID) != "" {
		cursorPinned := nonNegativeInt64(cursor.PinnedAtUnixMs)
		cursorThreadID := strings.TrimSpace(cursor.ThreadID)
		q += `
  AND (
    CASE WHEN pinned_at_unix_ms > 0 THEN 1 ELSE 0 END < CASE WHEN ? > 0 THEN 1 ELSE 0 END
    OR (
      CASE WHEN pinned_at_unix_ms > 0 THEN 1 ELSE 0 END = CASE WHEN ? > 0 THEN 1 ELSE 0 END
      AND (
        (? > 0 AND pinned_at_unix_ms < ?)
        OR ((pinned_at_unix_ms = ? OR (? = 0 AND pinned_at_unix_ms <= 0)) AND created_at_unix_ms < ?)
        OR ((pinned_at_unix_ms = ? OR (? = 0 AND pinned_at_unix_ms <= 0)) AND created_at_unix_ms = ? AND thread_id > ?)
      )
    )
  )
`
		args = append(args,
			cursorPinned,
			cursorPinned,
			cursorPinned, cursorPinned,
			cursorPinned, cursorPinned, cursor.CreatedAtUnixMs,
			cursorPinned, cursorPinned, cursor.CreatedAtUnixMs, cursorThreadID,
		)
	}
	q += `
ORDER BY
  CASE WHEN pinned_at_unix_ms > 0 THEN 1 ELSE 0 END DESC,
  pinned_at_unix_ms DESC,
  created_at_unix_ms DESC,
  thread_id ASC
LIMIT ?
`
	args = append(args, limit+1)

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()

	out := make([]Thread, 0, limit+1)
	for rows.Next() {
		var t Thread
		if err := scanThreadRow(rows, &t); err != nil {
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
	hasMore := len(out) > limit
	if hasMore {
		out = out[:limit]
	}
	last := out[len(out)-1]
	next := ""
	if hasMore {
		next = EncodeCursor(ThreadsCursor{PinnedAtUnixMs: last.PinnedAtUnixMs, CreatedAtUnixMs: last.CreatedAtUnixMs, ThreadID: last.ThreadID})
	}
	return out, next, nil
}

func (s *Store) ListAutoThreadTitleCandidates(ctx context.Context, limit int) ([]AutoThreadTitleCandidate, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if limit <= 0 {
		limit = 64
	}
	if limit > 500 {
		limit = 500
	}

	rows, err := s.db.QueryContext(ctx, `
SELECT endpoint_id, thread_id
FROM ai_threads
WHERE TRIM(COALESCE(title, '')) = ''
  AND LOWER(TRIM(COALESCE(title_source, ''))) != ?
ORDER BY updated_at_unix_ms DESC, thread_id DESC
LIMIT ?
`, ThreadTitleSourceUser, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]AutoThreadTitleCandidate, 0, limit)
	for rows.Next() {
		var candidate AutoThreadTitleCandidate
		if err := rows.Scan(&candidate.EndpointID, &candidate.ThreadID); err != nil {
			return nil, err
		}
		candidate.EndpointID = strings.TrimSpace(candidate.EndpointID)
		candidate.ThreadID = strings.TrimSpace(candidate.ThreadID)
		if candidate.EndpointID == "" || candidate.ThreadID == "" {
			continue
		}
		out = append(out, candidate)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
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
	err := scanThreadRow(s.db.QueryRowContext(ctx, fmt.Sprintf(`
SELECT
%s
FROM ai_threads
WHERE endpoint_id = ? AND thread_id = ?
`, threadSelectColumnsSQL), endpointID, threadID), &t)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &t, nil
}

func (s *Store) getThreadTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) (*Thread, error) {
	var thread Thread
	err := scanThreadRow(tx.QueryRowContext(ctx, fmt.Sprintf(`SELECT %s FROM ai_threads WHERE endpoint_id = ? AND thread_id = ?`, threadSelectColumnsSQL), endpointID, threadID), &thread)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &thread, nil
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
	t.ReasoningSelectionJSON = strings.TrimSpace(t.ReasoningSelectionJSON)
	permissionType, err := canonicalPermissionType(t.PermissionType)
	if err != nil {
		return err
	}
	t.PermissionType = permissionType
	t.WorkingDir = strings.TrimSpace(t.WorkingDir)
	t.Title = strings.TrimSpace(t.Title)
	t.TitleSource = normalizeThreadTitleSource(t.TitleSource)
	if t.TitleSource == "" && t.Title != "" {
		t.TitleSource = ThreadTitleSourceUser
	}
	t.TitleInputMessageID = strings.TrimSpace(t.TitleInputMessageID)
	t.TitleModelID = strings.TrimSpace(t.TitleModelID)
	t.TitlePromptVersion = strings.TrimSpace(t.TitlePromptVersion)
	t.CreatedByUserPublicID = strings.TrimSpace(t.CreatedByUserPublicID)
	t.CreatedByUserEmail = strings.TrimSpace(t.CreatedByUserEmail)
	t.UpdatedByUserPublicID = strings.TrimSpace(t.UpdatedByUserPublicID)
	t.UpdatedByUserEmail = strings.TrimSpace(t.UpdatedByUserEmail)

	if t.ThreadID == "" || t.EndpointID == "" {
		return errors.New("invalid thread")
	}
	var retired int
	if err := s.db.QueryRowContext(ctx, `SELECT 1 FROM ai_thread_delete_operations WHERE endpoint_id = ? AND thread_id = ?`, t.EndpointID, t.ThreadID).Scan(&retired); err == nil {
		return ErrThreadIDRetired
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	now := time.Now().UnixMilli()
	if t.CreatedAtUnixMs <= 0 {
		t.CreatedAtUnixMs = now
	}
	if t.UpdatedAtUnixMs <= 0 {
		t.UpdatedAtUnixMs = t.CreatedAtUnixMs
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO ai_threads(
		  thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json, permission_type, working_dir, title,
	  title_source, title_generated_at_unix_ms, title_input_message_id, title_model_id, title_prompt_version,
	  pinned_at_unix_ms,
	  created_by_user_public_id, created_by_user_email,
	  updated_by_user_public_id, updated_by_user_email,
	  created_at_unix_ms, updated_at_unix_ms
			) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		t.ThreadID,
		t.EndpointID,
		t.NamespacePublicID,
		t.ModelID,
		t.ReasoningSelectionJSON,
		t.PermissionType,
		t.WorkingDir,
		t.Title,
		t.TitleSource,
		t.TitleGeneratedAtUnixMs,
		t.TitleInputMessageID,
		t.TitleModelID,
		t.TitlePromptVersion,
		nonNegativeInt64(t.PinnedAtUnixMs),
		t.CreatedByUserPublicID,
		t.CreatedByUserEmail,
		t.UpdatedByUserPublicID,
		t.UpdatedByUserEmail,
		t.CreatedAtUnixMs,
		t.UpdatedAtUnixMs,
	)
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "thread id retired") {
		return ErrThreadIDRetired
	}
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

func (s *Store) UpdateThreadModelAndReasoningSelection(ctx context.Context, endpointID string, threadID string, modelID string, reasoningSelectionJSON string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	modelID = strings.TrimSpace(modelID)
	reasoningSelectionJSON = strings.TrimSpace(reasoningSelectionJSON)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid request")
	}
	if modelID == "" {
		return errors.New("missing model_id")
	}
	res, err := s.db.ExecContext(ctx, `
UPDATE ai_threads
SET model_id = ?,
    reasoning_selection_json = ?
WHERE endpoint_id = ? AND thread_id = ?
`, modelID, reasoningSelectionJSON, endpointID, threadID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) UpdateThreadReasoningSelection(ctx context.Context, endpointID string, threadID string, reasoningSelectionJSON string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	reasoningSelectionJSON = strings.TrimSpace(reasoningSelectionJSON)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid request")
	}
	res, err := s.db.ExecContext(ctx, `
UPDATE ai_threads
SET reasoning_selection_json = ?
WHERE endpoint_id = ? AND thread_id = ?
`, reasoningSelectionJSON, endpointID, threadID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) UpdateThreadPermissionType(ctx context.Context, endpointID string, threadID string, permissionType string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	permissionType, err := canonicalPermissionType(permissionType)
	if err != nil {
		return err
	}
	if endpointID == "" || threadID == "" {
		return errors.New("invalid request")
	}

	res, err := s.db.ExecContext(ctx, `
UPDATE ai_threads
SET permission_type = ?
WHERE endpoint_id = ? AND thread_id = ?
`, permissionType, endpointID, threadID)
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
SET title = ?,
    title_source = ?,
    title_generated_at_unix_ms = 0,
    title_input_message_id = '',
    title_model_id = '',
    title_prompt_version = '',
    updated_at_unix_ms = ?,
    updated_by_user_public_id = ?,
    updated_by_user_email = ?
WHERE endpoint_id = ? AND thread_id = ?
`, title, ThreadTitleSourceUser, now, strings.TrimSpace(updatedByID), strings.TrimSpace(updatedByEmail), endpointID, threadID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) SetThreadPinned(ctx context.Context, endpointID string, threadID string, pinned bool, updatedByID string, updatedByEmail string) (int64, error) {
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
	pinnedAt := int64(0)
	if pinned {
		pinnedAt = time.Now().UnixMilli()
	}
	res, err := s.db.ExecContext(ctx, `
UPDATE ai_threads
SET pinned_at_unix_ms = ?,
    updated_by_user_public_id = ?,
    updated_by_user_email = ?
WHERE endpoint_id = ? AND thread_id = ?
`, pinnedAt, strings.TrimSpace(updatedByID), strings.TrimSpace(updatedByEmail), endpointID, threadID)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return 0, sql.ErrNoRows
	}
	return pinnedAt, nil
}

func (s *Store) SetAutoThreadTitle(ctx context.Context, endpointID string, threadID string, title string, inputMessageID string, modelID string, promptVersion string, generatedAtUnixMs int64, updatedByID string, updatedByEmail string) (bool, error) {
	if s == nil || s.db == nil {
		return false, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	title = strings.TrimSpace(title)
	inputMessageID = strings.TrimSpace(inputMessageID)
	modelID = strings.TrimSpace(modelID)
	promptVersion = strings.TrimSpace(promptVersion)
	if endpointID == "" || threadID == "" || title == "" {
		return false, errors.New("invalid request")
	}
	if len(title) > 200 {
		return false, errors.New("title too long")
	}
	if generatedAtUnixMs <= 0 {
		generatedAtUnixMs = time.Now().UnixMilli()
	}
	res, err := s.db.ExecContext(ctx, `
UPDATE ai_threads
SET title = ?,
    title_source = ?,
    title_generated_at_unix_ms = ?,
    title_input_message_id = ?,
    title_model_id = ?,
    title_prompt_version = ?,
    updated_at_unix_ms = ?,
    updated_by_user_public_id = ?,
    updated_by_user_email = ?
WHERE endpoint_id = ? AND thread_id = ?
  AND TRIM(COALESCE(title, '')) = ''
  AND LOWER(TRIM(COALESCE(title_source, ''))) != ?
`, title, ThreadTitleSourceAuto, generatedAtUnixMs, inputMessageID, modelID, promptVersion, generatedAtUnixMs, strings.TrimSpace(updatedByID), strings.TrimSpace(updatedByEmail), endpointID, threadID, ThreadTitleSourceUser)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func normalizeThreadTitleSource(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case ThreadTitleSourceAuto:
		return ThreadTitleSourceAuto
	case ThreadTitleSourceUser:
		return ThreadTitleSourceUser
	default:
		return ""
	}
}

func canonicalPermissionType(permissionType string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(permissionType)) {
	case "":
		return "approval_required", nil
	case "readonly":
		return "readonly", nil
	case "full_access":
		return "full_access", nil
	case "approval_required":
		return "approval_required", nil
	default:
		return "", fmt.Errorf("invalid thread permission type %q", permissionType)
	}
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

	if err := deleteThreadScopedRowsTx(ctx, tx, endpointID, threadID); err != nil {
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
SELECT queue_id, endpoint_id, thread_id, channel_id, lane, turn_id, run_id, model_id, text_content, attachments_json, context_action_json, options_json, session_meta_json,
       created_by_user_public_id, created_by_user_email, sort_index, created_at_unix_ms, updated_at_unix_ms
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ? AND lane = ?
	`, endpointID, threadID, queueID, FollowupLaneQueued)
	out, err := scanFollowup(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	return &out, nil
}

func (s *Store) EnqueueQueuedTurn(ctx context.Context, rec QueuedTurn) (QueuedTurn, int, error) {
	rec.Lane = FollowupLaneQueued
	created, position, _, err := s.CreateFollowup(ctx, rec)
	return created, position, err
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
WHERE endpoint_id = ? AND thread_id = ? AND lane = ?
`, endpointID, threadID, FollowupLaneQueued).Scan(&count)
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

	args = append(args, FollowupLaneQueued)
	rows, err := s.db.QueryContext(ctx, `
SELECT thread_id, COUNT(1)
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id IN (`+placeholders+`) AND lane = ?
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

	return s.ListFollowupsByLane(ctx, endpointID, threadID, FollowupLaneQueued, limit)
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
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	now := time.Now().UnixMilli()
	res, err := tx.ExecContext(ctx, `
UPDATE ai_queued_turns
SET text_content = ?, updated_at_unix_ms = ?
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ? AND lane = ?
`, textContent, now, endpointID, threadID, queueID, FollowupLaneQueued)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	if _, err := bumpThreadFollowupsRevisionTx(ctx, tx, endpointID, threadID); err != nil {
		return err
	}
	return tx.Commit()
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
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(ctx, `
DELETE FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ? AND lane = ?
`, endpointID, threadID, queueID, FollowupLaneQueued)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	if _, err := bumpThreadFollowupsRevisionTx(ctx, tx, endpointID, threadID); err != nil {
		return err
	}
	return tx.Commit()
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
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(ctx, `
DELETE FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND lane = ?
`, endpointID, threadID, FollowupLaneQueued)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		if _, err := bumpThreadFollowupsRevisionTx(ctx, tx, endpointID, threadID); err != nil {
			return err
		}
	}
	return tx.Commit()
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
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ? AND lane = ?
`, endpointID, threadID, rec.QueueID, FollowupLaneQueued); err != nil {
		return nil, err
	}
	if _, err := bumpThreadFollowupsRevisionTx(ctx, tx, endpointID, threadID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return rec, nil
}

func getNextQueuedTurnTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) (*QueuedTurn, error) {
	row := tx.QueryRowContext(ctx, `
SELECT queue_id, endpoint_id, thread_id, channel_id, lane, turn_id, run_id, model_id, text_content, attachments_json, context_action_json, options_json, session_meta_json,
       created_by_user_public_id, created_by_user_email, sort_index, created_at_unix_ms, updated_at_unix_ms
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND lane = ?
ORDER BY sort_index ASC, queue_id ASC
LIMIT 1
`, endpointID, threadID, FollowupLaneQueued)
	rec, err := scanFollowup(row)
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
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
