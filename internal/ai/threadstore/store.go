package threadstore

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"

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

const (
	ThreadTitleSourceAuto = "auto"
	ThreadTitleSourceUser = "user"
)

type FlowerActivitySnapshot struct {
	ActivityRevision    int64
	LastMessageAtUnixMs int64
	ActivitySignature   string
	WaitingPromptID     string
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
	if err := ensureIncrementalAutoVacuum(db); err != nil {
		_ = db.Close()
		return nil, err
	}

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	return &Store{db: db}, nil
}

func OpenResettingInvalidSchema(path string) (*Store, error) {
	store, err := Open(path)
	if err == nil {
		return store, nil
	}
	var schemaErr *sqliteutil.SchemaVerifyError
	if !errors.As(err, &schemaErr) {
		return nil, err
	}
	if resetErr := removeSQLiteFiles(path); resetErr != nil {
		return nil, errors.Join(err, resetErr)
	}
	return Open(path)
}

func removeSQLiteFiles(path string) error {
	p := filepath.Clean(strings.TrimSpace(path))
	if p == "" {
		return errors.New("missing db path")
	}
	for _, candidate := range []string{p, p + "-wal", p + "-shm", p + "-journal"} {
		if err := os.Remove(candidate); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
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
	RunStatus              string `json:"run_status"`
	RunUpdatedAtUnixMs     int64  `json:"run_updated_at_unix_ms"`
	RunErrorCode           string `json:"run_error_code"`
	RunError               string `json:"run_error"`
	WaitingUserInputJSON   string `json:"waiting_user_input_json"`
	LastContextRunID       string `json:"last_context_run_id"`
	PinnedAtUnixMs         int64  `json:"pinned_at_unix_ms"`

	FlowerActivityRevision        int64  `json:"flower_activity_revision"`
	FlowerActivitySignature       string `json:"flower_activity_signature"`
	FlowerActivityWaitingPromptID string `json:"flower_activity_waiting_prompt_id"`

	CreatedByUserPublicID string `json:"created_by_user_public_id"`
	CreatedByUserEmail    string `json:"created_by_user_email"`
	UpdatedByUserPublicID string `json:"updated_by_user_public_id"`
	UpdatedByUserEmail    string `json:"updated_by_user_email"`

	CreatedAtUnixMs     int64  `json:"created_at_unix_ms"`
	UpdatedAtUnixMs     int64  `json:"updated_at_unix_ms"`
	LastMessageAtUnixMs int64  `json:"last_message_at_unix_ms"`
	LastMessagePreview  string `json:"last_message_preview"`
}

type AutoThreadTitleCandidate struct {
	EndpointID string `json:"endpoint_id"`
	ThreadID   string `json:"thread_id"`
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
	RunStatus            string `json:"run_status"`
	RunErrorCode         string `json:"run_error_code"`
	RunError             string `json:"run_error"`
	WaitingUserInputJSON string `json:"waiting_user_input_json"`
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
  thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json, execution_mode, permission_type, working_dir, title,
  title_source, title_generated_at_unix_ms, title_input_message_id, title_model_id, title_prompt_version,
  run_status, run_updated_at_unix_ms, run_error_code, run_error,
  waiting_user_input_json, last_context_run_id, pinned_at_unix_ms,
  flower_activity_revision, flower_activity_signature, flower_activity_waiting_prompt_id,
  created_by_user_public_id, created_by_user_email,
  updated_by_user_public_id, updated_by_user_email,
  created_at_unix_ms, updated_at_unix_ms, last_message_at_unix_ms, last_message_preview
`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanThreadRow(scan rowScanner, t *Thread) error {
	if t == nil {
		return errors.New("nil thread")
	}
	var legacyExecutionMode string
	if err := scan.Scan(
		&t.ThreadID,
		&t.EndpointID,
		&t.NamespacePublicID,
		&t.ModelID,
		&t.ReasoningSelectionJSON,
		&legacyExecutionMode,
		&t.PermissionType,
		&t.WorkingDir,
		&t.Title,
		&t.TitleSource,
		&t.TitleGeneratedAtUnixMs,
		&t.TitleInputMessageID,
		&t.TitleModelID,
		&t.TitlePromptVersion,
		&t.RunStatus,
		&t.RunUpdatedAtUnixMs,
		&t.RunErrorCode,
		&t.RunError,
		&t.WaitingUserInputJSON,
		&t.LastContextRunID,
		&t.PinnedAtUnixMs,
		&t.FlowerActivityRevision,
		&t.FlowerActivitySignature,
		&t.FlowerActivityWaitingPromptID,
		&t.CreatedByUserPublicID,
		&t.CreatedByUserEmail,
		&t.UpdatedByUserPublicID,
		&t.UpdatedByUserEmail,
		&t.CreatedAtUnixMs,
		&t.UpdatedAtUnixMs,
		&t.LastMessageAtUnixMs,
		&t.LastMessagePreview,
	); err != nil {
		return err
	}
	t.ReasoningSelectionJSON = strings.TrimSpace(t.ReasoningSelectionJSON)
	t.TitleSource = normalizeThreadTitleSource(t.TitleSource)
	t.TitleInputMessageID = strings.TrimSpace(t.TitleInputMessageID)
	t.TitleModelID = strings.TrimSpace(t.TitleModelID)
	t.TitlePromptVersion = strings.TrimSpace(t.TitlePromptVersion)
	t.LastContextRunID = strings.TrimSpace(t.LastContextRunID)
	t.FlowerActivitySignature = strings.TrimSpace(t.FlowerActivitySignature)
	t.FlowerActivityWaitingPromptID = strings.TrimSpace(t.FlowerActivityWaitingPromptID)
	if t.FlowerActivityRevision < 0 {
		t.FlowerActivityRevision = 0
	}
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
  AND last_message_at_unix_ms > 0
ORDER BY
  CASE
    WHEN last_message_at_unix_ms > 0 THEN last_message_at_unix_ms
    ELSE updated_at_unix_ms
  END DESC,
  thread_id DESC
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
	t.PermissionType = normalizePermissionType(t.PermissionType)
	t.WorkingDir = strings.TrimSpace(t.WorkingDir)
	t.Title = strings.TrimSpace(t.Title)
	t.TitleSource = normalizeThreadTitleSource(t.TitleSource)
	if t.TitleSource == "" && t.Title != "" {
		t.TitleSource = ThreadTitleSourceUser
	}
	t.TitleInputMessageID = strings.TrimSpace(t.TitleInputMessageID)
	t.TitleModelID = strings.TrimSpace(t.TitleModelID)
	t.TitlePromptVersion = strings.TrimSpace(t.TitlePromptVersion)
	runStatus, err := canonicalRunStatusForCreate(t.RunStatus)
	if err != nil {
		return err
	}
	t.RunStatus = runStatus
	t.RunErrorCode = strings.TrimSpace(t.RunErrorCode)
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
	initialSnapshot := initialFlowerActivitySnapshot(t)
	t.FlowerActivityRevision = initialSnapshot.ActivityRevision
	t.FlowerActivitySignature = initialSnapshot.ActivitySignature
	t.FlowerActivityWaitingPromptID = initialSnapshot.WaitingPromptID

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO ai_threads(
		  thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json, permission_type, working_dir, title,
	  title_source, title_generated_at_unix_ms, title_input_message_id, title_model_id, title_prompt_version,
	  run_status, run_updated_at_unix_ms, run_error_code, run_error,
	  waiting_user_input_json, last_context_run_id,
	  flower_activity_revision, flower_activity_signature, flower_activity_waiting_prompt_id,
	  created_by_user_public_id, created_by_user_email,
	  updated_by_user_public_id, updated_by_user_email,
	  created_at_unix_ms, updated_at_unix_ms,
	  last_message_at_unix_ms, last_message_preview, pinned_at_unix_ms
		) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
		t.RunStatus,
		t.RunUpdatedAtUnixMs,
		t.RunErrorCode,
		t.RunError,
		t.WaitingUserInputJSON,
		t.LastContextRunID,
		t.FlowerActivityRevision,
		t.FlowerActivitySignature,
		t.FlowerActivityWaitingPromptID,
		t.CreatedByUserPublicID,
		t.CreatedByUserEmail,
		t.UpdatedByUserPublicID,
		t.UpdatedByUserEmail,
		t.CreatedAtUnixMs,
		t.UpdatedAtUnixMs,
		t.LastMessageAtUnixMs,
		t.LastMessagePreview,
		nonNegativeInt64(t.PinnedAtUnixMs),
	)
	return err
}

// UpsertProjectedThread stores a host-owned thread projection without assuming
// the normal user-created thread lifecycle.
func (s *Store) UpsertProjectedThread(ctx context.Context, t Thread) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	t, err := normalizeProjectedThread(t)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := upsertProjectedThreadTx(ctx, tx, t); err != nil {
		return err
	}
	return tx.Commit()
}

// UpsertProjectedThreadWithFlowerMetadata atomically stores a projected thread
// and its Flower ownership metadata, so projection-only threads cannot leak into
// ordinary thread-list queries between separate writes.
func (s *Store) UpsertProjectedThreadWithFlowerMetadata(ctx context.Context, t Thread, meta FlowerThreadMetadata) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	t, err := normalizeProjectedThread(t)
	if err != nil {
		return err
	}
	meta, err = normalizeFlowerThreadMetadata(meta)
	if err != nil {
		return err
	}
	if meta.EndpointID != t.EndpointID || meta.ThreadID != t.ThreadID {
		return errors.New("projected thread metadata identity mismatch")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := upsertProjectedThreadTx(ctx, tx, t); err != nil {
		return err
	}
	if err := upsertFlowerThreadMetadataExec(ctx, tx, meta); err != nil {
		return err
	}
	return tx.Commit()
}

func normalizeProjectedThread(t Thread) (Thread, error) {
	t.ThreadID = strings.TrimSpace(t.ThreadID)
	t.EndpointID = strings.TrimSpace(t.EndpointID)
	t.NamespacePublicID = strings.TrimSpace(t.NamespacePublicID)
	t.ModelID = strings.TrimSpace(t.ModelID)
	t.PermissionType = normalizePermissionType(t.PermissionType)
	t.WorkingDir = strings.TrimSpace(t.WorkingDir)
	t.Title = strings.TrimSpace(t.Title)
	t.TitleSource = normalizeThreadTitleSource(t.TitleSource)
	if t.TitleSource == "" && t.Title != "" {
		t.TitleSource = ThreadTitleSourceUser
	}
	t.TitleInputMessageID = strings.TrimSpace(t.TitleInputMessageID)
	t.TitleModelID = strings.TrimSpace(t.TitleModelID)
	t.TitlePromptVersion = strings.TrimSpace(t.TitlePromptVersion)
	runStatus, err := canonicalRunStatusForCreate(t.RunStatus)
	if err != nil {
		return Thread{}, err
	}
	t.RunStatus = runStatus
	t.RunErrorCode = strings.TrimSpace(t.RunErrorCode)
	t.RunError = strings.TrimSpace(t.RunError)
	t.WaitingUserInputJSON = strings.TrimSpace(t.WaitingUserInputJSON)
	t.LastContextRunID = strings.TrimSpace(t.LastContextRunID)
	t.CreatedByUserPublicID = strings.TrimSpace(t.CreatedByUserPublicID)
	t.CreatedByUserEmail = strings.TrimSpace(t.CreatedByUserEmail)
	t.UpdatedByUserPublicID = strings.TrimSpace(t.UpdatedByUserPublicID)
	t.UpdatedByUserEmail = strings.TrimSpace(t.UpdatedByUserEmail)
	t.LastMessagePreview = strings.TrimSpace(t.LastMessagePreview)
	if t.ThreadID == "" || t.EndpointID == "" {
		return Thread{}, errors.New("invalid thread")
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
	initialSnapshot := initialFlowerActivitySnapshot(t)
	t.FlowerActivityRevision = initialSnapshot.ActivityRevision
	t.FlowerActivitySignature = initialSnapshot.ActivitySignature
	t.FlowerActivityWaitingPromptID = initialSnapshot.WaitingPromptID
	return t, nil
}

func upsertProjectedThreadTx(ctx context.Context, tx *sql.Tx, t Thread) error {
	if tx == nil {
		return errors.New("store not initialized")
	}
	var existing Thread
	err := scanThreadRow(tx.QueryRowContext(ctx, fmt.Sprintf(`
SELECT
%s
FROM ai_threads
WHERE thread_id = ?
`, threadSelectColumnsSQL), t.ThreadID), &existing)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if errors.Is(err, sql.ErrNoRows) {
		if _, err := tx.ExecContext(ctx, `
INSERT INTO ai_threads(
  thread_id, endpoint_id, namespace_public_id, model_id, permission_type, working_dir, title,
  title_source, title_generated_at_unix_ms, title_input_message_id, title_model_id, title_prompt_version,
  run_status, run_updated_at_unix_ms, run_error_code, run_error,
  waiting_user_input_json, last_context_run_id,
  flower_activity_revision, flower_activity_signature, flower_activity_waiting_prompt_id,
  created_by_user_public_id, created_by_user_email,
  updated_by_user_public_id, updated_by_user_email,
  created_at_unix_ms, updated_at_unix_ms,
  last_message_at_unix_ms, last_message_preview, pinned_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
			t.ThreadID,
			t.EndpointID,
			t.NamespacePublicID,
			t.ModelID,
			t.PermissionType,
			t.WorkingDir,
			t.Title,
			t.TitleSource,
			t.TitleGeneratedAtUnixMs,
			t.TitleInputMessageID,
			t.TitleModelID,
			t.TitlePromptVersion,
			t.RunStatus,
			t.RunUpdatedAtUnixMs,
			t.RunErrorCode,
			t.RunError,
			t.WaitingUserInputJSON,
			t.LastContextRunID,
			t.FlowerActivityRevision,
			t.FlowerActivitySignature,
			t.FlowerActivityWaitingPromptID,
			t.CreatedByUserPublicID,
			t.CreatedByUserEmail,
			t.UpdatedByUserPublicID,
			t.UpdatedByUserEmail,
			t.CreatedAtUnixMs,
			t.UpdatedAtUnixMs,
			t.LastMessageAtUnixMs,
			t.LastMessagePreview,
			nonNegativeInt64(t.PinnedAtUnixMs),
		); err != nil {
			return err
		}
		return nil
	}
	if existing.EndpointID != t.EndpointID {
		return errors.New("thread belongs to a different endpoint")
	}
	if t.UpdatedAtUnixMs < existing.UpdatedAtUnixMs {
		t.UpdatedAtUnixMs = existing.UpdatedAtUnixMs
	}
	if t.LastMessageAtUnixMs < existing.LastMessageAtUnixMs {
		t.LastMessageAtUnixMs = existing.LastMessageAtUnixMs
		t.LastMessagePreview = existing.LastMessagePreview
	} else if t.LastMessageAtUnixMs == existing.LastMessageAtUnixMs && t.LastMessagePreview == "" {
		t.LastMessagePreview = existing.LastMessagePreview
	}
	if projectedThreadEqual(existing, t) {
		return nil
	}
	snapshot, err := nextFlowerActivitySnapshotForThreadTx(ctx, tx, t.EndpointID, t.ThreadID, t)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
UPDATE ai_threads
SET namespace_public_id = ?,
    model_id = ?,
    permission_type = ?,
    working_dir = ?,
    title = ?,
    title_source = ?,
    title_generated_at_unix_ms = ?,
    title_input_message_id = ?,
    title_model_id = ?,
    title_prompt_version = ?,
    run_status = ?,
    run_updated_at_unix_ms = ?,
    run_error_code = ?,
    run_error = ?,
    waiting_user_input_json = ?,
    last_context_run_id = ?,
    updated_by_user_public_id = ?,
    updated_by_user_email = ?,
    updated_at_unix_ms = ?,
    last_message_at_unix_ms = ?,
    last_message_preview = ?,
    flower_activity_revision = ?,
    flower_activity_signature = ?,
    flower_activity_waiting_prompt_id = ?
WHERE endpoint_id = ? AND thread_id = ?
`,
		t.NamespacePublicID,
		t.ModelID,
		t.PermissionType,
		t.WorkingDir,
		t.Title,
		t.TitleSource,
		t.TitleGeneratedAtUnixMs,
		t.TitleInputMessageID,
		t.TitleModelID,
		t.TitlePromptVersion,
		t.RunStatus,
		t.RunUpdatedAtUnixMs,
		t.RunErrorCode,
		t.RunError,
		t.WaitingUserInputJSON,
		t.LastContextRunID,
		t.UpdatedByUserPublicID,
		t.UpdatedByUserEmail,
		t.UpdatedAtUnixMs,
		t.LastMessageAtUnixMs,
		t.LastMessagePreview,
		snapshot.ActivityRevision,
		snapshot.ActivitySignature,
		snapshot.WaitingPromptID,
		t.EndpointID,
		t.ThreadID,
	)
	if err != nil {
		return err
	}
	return nil
}

func projectedThreadEqual(existing Thread, next Thread) bool {
	return existing.NamespacePublicID == next.NamespacePublicID &&
		existing.ModelID == next.ModelID &&
		existing.PermissionType == next.PermissionType &&
		existing.WorkingDir == next.WorkingDir &&
		existing.Title == next.Title &&
		existing.TitleSource == next.TitleSource &&
		existing.TitleGeneratedAtUnixMs == next.TitleGeneratedAtUnixMs &&
		existing.TitleInputMessageID == next.TitleInputMessageID &&
		existing.TitleModelID == next.TitleModelID &&
		existing.TitlePromptVersion == next.TitlePromptVersion &&
		existing.RunStatus == next.RunStatus &&
		existing.RunUpdatedAtUnixMs == next.RunUpdatedAtUnixMs &&
		existing.RunErrorCode == next.RunErrorCode &&
		existing.RunError == next.RunError &&
		existing.WaitingUserInputJSON == next.WaitingUserInputJSON &&
		existing.LastContextRunID == next.LastContextRunID &&
		existing.UpdatedByUserPublicID == next.UpdatedByUserPublicID &&
		existing.UpdatedByUserEmail == next.UpdatedByUserEmail &&
		existing.UpdatedAtUnixMs == next.UpdatedAtUnixMs &&
		existing.LastMessageAtUnixMs == next.LastMessageAtUnixMs &&
		existing.LastMessagePreview == next.LastMessagePreview
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
	permissionType = normalizePermissionType(permissionType)
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

func canonicalRunStatus(status string) (string, bool) {
	status = strings.TrimSpace(strings.ToLower(status))
	switch status {
	case "idle", "accepted", "running", "waiting_approval", "recovering", "finalizing", "waiting_user", "success", "failed", "canceled", "timed_out":
		return status, true
	default:
		return "", false
	}
}

func canonicalRunStatusForCreate(status string) (string, error) {
	if strings.TrimSpace(status) == "" {
		return "idle", nil
	}
	return canonicalRunStatusForWrite(status)
}

func canonicalRunStatusForWrite(status string) (string, error) {
	if normalized, ok := canonicalRunStatus(status); ok {
		return normalized, nil
	}
	return "", fmt.Errorf("unsupported run status %q", strings.TrimSpace(status))
}

func normalizePermissionType(permissionType string) string {
	switch strings.TrimSpace(strings.ToLower(permissionType)) {
	case "readonly":
		return "readonly"
	case "full_access":
		return "full_access"
	case "approval_required":
		return "approval_required"
	}
	return "approval_required"
}

func normalizeWaitingUserInputJSONForStatus(runStatus string, waitingUserInputJSON string) string {
	waitingUserInputJSON = strings.TrimSpace(waitingUserInputJSON)
	if runStatus != "waiting_user" {
		return ""
	}
	return waitingUserInputJSON
}

func isPersistedContextRunEventType(eventType string) bool {
	eventType = strings.TrimSpace(strings.ToLower(eventType))
	return eventType == "context.usage.updated" || eventType == "context.compaction.updated"
}

func initialFlowerActivitySnapshot(t Thread) FlowerActivitySnapshot {
	revision := legacyFlowerActivityRevision(t.RunStatus, t.RunUpdatedAtUnixMs, t.LastMessageAtUnixMs)
	waitingPromptID := flowerActivityWaitingPromptID(t.RunStatus, t.WaitingUserInputJSON)
	return FlowerActivitySnapshot{
		ActivityRevision:    revision,
		LastMessageAtUnixMs: nonNegativeInt64(t.LastMessageAtUnixMs),
		ActivitySignature:   flowerActivitySignatureForState(revision, t.RunStatus, t.LastContextRunID, waitingPromptID, t.LastMessageAtUnixMs, t.LastMessagePreview),
		WaitingPromptID:     waitingPromptID,
	}
}

func loadThreadTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) (Thread, error) {
	var thread Thread
	if err := scanThreadRow(tx.QueryRowContext(ctx, fmt.Sprintf(`
SELECT
%s
FROM ai_threads
WHERE endpoint_id = ? AND thread_id = ?
`, threadSelectColumnsSQL), endpointID, threadID), &thread); err != nil {
		return Thread{}, err
	}
	return thread, nil
}

func nextFlowerActivitySnapshotForThreadTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, next Thread) (FlowerActivitySnapshot, error) {
	var currentRevision int64
	if err := tx.QueryRowContext(ctx, `
SELECT flower_activity_revision
FROM ai_threads
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(&currentRevision); err != nil {
		return FlowerActivitySnapshot{}, err
	}
	revision := maxInt64(time.Now().UnixMilli(), currentRevision+1)
	if revision <= 0 {
		revision = 1
	}
	waitingPromptID := flowerActivityWaitingPromptID(next.RunStatus, next.WaitingUserInputJSON)
	return FlowerActivitySnapshot{
		ActivityRevision:    revision,
		LastMessageAtUnixMs: nonNegativeInt64(next.LastMessageAtUnixMs),
		ActivitySignature:   flowerActivitySignatureForState(revision, next.RunStatus, next.LastContextRunID, waitingPromptID, next.LastMessageAtUnixMs, next.LastMessagePreview),
		WaitingPromptID:     waitingPromptID,
	}, nil
}

func bumpFlowerActivityTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) (FlowerActivitySnapshot, error) {
	thread, err := loadThreadTx(ctx, tx, endpointID, threadID)
	if err != nil {
		return FlowerActivitySnapshot{}, err
	}
	snapshot, err := nextFlowerActivitySnapshotForThreadTx(ctx, tx, endpointID, threadID, thread)
	if err != nil {
		return FlowerActivitySnapshot{}, err
	}
	if err := storeFlowerActivitySnapshotTx(ctx, tx, endpointID, threadID, snapshot); err != nil {
		return FlowerActivitySnapshot{}, err
	}
	return snapshot, nil
}

func storeFlowerActivitySnapshotTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, snapshot FlowerActivitySnapshot) error {
	_, err := tx.ExecContext(ctx, `
UPDATE ai_threads
SET flower_activity_revision = ?,
    flower_activity_signature = ?,
    flower_activity_waiting_prompt_id = ?
WHERE endpoint_id = ? AND thread_id = ?
`, snapshot.ActivityRevision, snapshot.ActivitySignature, snapshot.WaitingPromptID, endpointID, threadID)
	return err
}

func legacyFlowerActivityRevision(runStatus string, runUpdatedAtUnixMs int64, lastMessageAtUnixMs int64) int64 {
	base := maxInt64(nonNegativeInt64(lastMessageAtUnixMs), nonNegativeInt64(runUpdatedAtUnixMs))
	ordinal := flowerRunStatusRevisionOrdinal(runStatus)
	if base <= 0 {
		return ordinal
	}
	return base*10 + ordinal
}

func flowerRunStatusRevisionOrdinal(status string) int64 {
	switch normalizeFlowerActivityToken(status) {
	case "", "idle":
		return 0
	case "accepted":
		return 1
	case "running", "recovering", "finalizing":
		return 2
	case "waiting_approval":
		return 3
	case "waiting_user":
		return 4
	case "success", "completed":
		return 5
	case "failed", "timed_out", "canceled", "cancelled":
		return 6
	default:
		return 0
	}
}

func flowerActivityWaitingPromptID(runStatus string, waitingUserInputJSON string) string {
	if normalizeFlowerActivityToken(runStatus) != "waiting_user" {
		return ""
	}
	raw := strings.TrimSpace(waitingUserInputJSON)
	if raw == "" {
		return ""
	}
	var payload struct {
		PromptID string `json:"prompt_id"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return ""
	}
	return strings.TrimSpace(payload.PromptID)
}

func flowerActivitySignatureForState(
	activityRevision int64,
	runStatus string,
	lastContextRunID string,
	waitingPromptID string,
	lastMessageAtUnixMs int64,
	lastMessagePreview string,
) string {
	tokens := make([]string, 0, 6)
	if normalizedStatus := normalizeFlowerActivityToken(runStatus); normalizedStatus != "" {
		tokens = append(tokens, "status:"+normalizedStatus)
	}
	if lastContextRunID = strings.TrimSpace(lastContextRunID); lastContextRunID != "" {
		tokens = append(tokens, "turn:"+lastContextRunID)
	}
	tokens = append(tokens, "activity:"+formatNonNegativeInt64(activityRevision))
	tokens = append(tokens, "last_message:"+formatNonNegativeInt64(lastMessageAtUnixMs))
	if waitingPromptID = strings.TrimSpace(waitingPromptID); waitingPromptID != "" {
		tokens = append(tokens, "prompt:"+waitingPromptID)
	}
	if messageToken := flowerMessagePreviewToken(lastMessagePreview); messageToken != "" {
		tokens = append(tokens, "message:"+messageToken)
	}
	return strings.Join(tokens, "\u001f")
}

func flowerMessagePreviewToken(preview string) string {
	preview = strings.TrimSpace(preview)
	if preview == "" {
		return ""
	}
	h := fnv.New64a()
	_, _ = h.Write([]byte(preview))
	return strconv.FormatUint(h.Sum64(), 36)
}

func normalizeFlowerActivityToken(value string) string {
	value = strings.TrimSpace(value)
	value = camelSplitASCII(value)
	value = strings.ReplaceAll(value, "-", "_")
	value = strings.ReplaceAll(value, " ", "_")
	return strings.ToLower(value)
}

func camelSplitASCII(value string) string {
	if value == "" {
		return ""
	}
	var builder strings.Builder
	for index, r := range value {
		if index > 0 && isLowerAlphaNumeric(rune(value[index-1])) && isUpperAlpha(r) {
			builder.WriteByte('_')
		}
		builder.WriteRune(r)
	}
	return builder.String()
}

func isLowerAlphaNumeric(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
}

func isUpperAlpha(r rune) bool {
	return r >= 'A' && r <= 'Z'
}

func formatNonNegativeInt64(value int64) string {
	return strconv.FormatInt(nonNegativeInt64(value), 10)
}

const (
	RuntimeRestartedRunErrorCode    = "runtime_restarted"
	RuntimeRestartedRunErrorMessage = "The local runtime restarted before this reply finished."
)

// ResetStaleActiveThreadRunStates marks startup-orphaned active thread states as canceled.
//
// Why this exists:
// - Active runs are held in memory during normal execution.
// - If the runtime process restarts, those in-memory runs are gone.
// - Any persisted thread state that still looks "active" must be reset so UI does not show phantom running threads.
func (s *Store) ResetStaleActiveThreadRunStates(ctx context.Context) (int64, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	now := time.Now().UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `
SELECT endpoint_id, thread_id
FROM ai_threads
WHERE run_status IN ('accepted', 'running', 'waiting_approval', 'recovering', 'finalizing')
`)
	if err != nil {
		return 0, err
	}
	type staleThreadID struct {
		endpointID string
		threadID   string
	}
	threadIDs := make([]staleThreadID, 0)
	for rows.Next() {
		var endpointID string
		var threadID string
		if err := rows.Scan(&endpointID, &threadID); err != nil {
			_ = rows.Close()
			return 0, err
		}
		threadIDs = append(threadIDs, staleThreadID{
			endpointID: strings.TrimSpace(endpointID),
			threadID:   strings.TrimSpace(threadID),
		})
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return 0, err
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	res, err := tx.ExecContext(ctx, `
		UPDATE ai_threads
		SET run_status = 'canceled',
		    run_updated_at_unix_ms = ?,
		    run_error_code = ?,
		    run_error = ?,
		    waiting_user_input_json = '',
		    updated_at_unix_ms = ?
		WHERE run_status IN ('accepted', 'running', 'waiting_approval', 'recovering', 'finalizing')
		`, now, RuntimeRestartedRunErrorCode, RuntimeRestartedRunErrorMessage, now)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	if len(threadIDs) > 0 {
		for _, id := range threadIDs {
			if id.endpointID == "" || id.threadID == "" {
				continue
			}
			if _, err := tx.ExecContext(ctx, `
UPDATE ai_runs
SET state = 'canceled',
    error_code = ?,
    error_message = ?,
    ended_at_unix_ms = ?,
    updated_at_unix_ms = ?
WHERE endpoint_id = ?
  AND thread_id = ?
  AND state IN ('accepted', 'running', 'waiting_approval', 'recovering', 'finalizing')
`, RuntimeRestartedRunErrorCode, RuntimeRestartedRunErrorMessage, now, now, id.endpointID, id.threadID); err != nil {
				return 0, err
			}
		}
	}
	for _, id := range threadIDs {
		if id.endpointID == "" || id.threadID == "" {
			continue
		}
		if _, err := bumpFlowerActivityTx(ctx, tx, id.endpointID, id.threadID); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return n, nil
}

func (s *Store) UpdateThreadRunState(
	ctx context.Context,
	endpointID string,
	threadID string,
	runStatus string,
	runErrorCode string,
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

	now := time.Now().UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := updateThreadRunStateTx(ctx, tx, endpointID, threadID, ThreadRunStateWrite{
		Status:                runStatus,
		ErrorCode:             runErrorCode,
		ErrorMessage:          runError,
		WaitingUserInputJSON:  waitingUserInputJSON,
		UpdatedByUserPublicID: updatedByID,
		UpdatedByUserEmail:    updatedByEmail,
		UpdatedAtUnixMs:       now,
	}); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) UpdateThreadLastMessagePreview(ctx context.Context, endpointID string, threadID string, preview string, atUnixMs int64, updatedByID string, updatedByEmail string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	preview = buildPreview("assistant", preview, "")
	if endpointID == "" || threadID == "" || preview == "" || atUnixMs <= 0 {
		return errors.New("invalid request")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var currentUpdatedAt int64
	var currentLastMessageAt int64
	if err := tx.QueryRowContext(ctx, `
SELECT updated_at_unix_ms, last_message_at_unix_ms
FROM ai_threads
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(&currentUpdatedAt, &currentLastMessageAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return sql.ErrNoRows
		}
		return err
	}
	if atUnixMs < currentLastMessageAt {
		return tx.Commit()
	}

	threadUpdatedAt := maxInt64(time.Now().UnixMilli(), currentUpdatedAt+1)
	updateRes, err := tx.ExecContext(ctx, `
UPDATE ai_threads
SET updated_at_unix_ms = ?,
    updated_by_user_public_id = ?,
    updated_by_user_email = ?,
    last_message_at_unix_ms = ?,
    last_message_preview = ?
WHERE endpoint_id = ? AND thread_id = ?
`,
		threadUpdatedAt,
		strings.TrimSpace(updatedByID),
		strings.TrimSpace(updatedByEmail),
		atUnixMs,
		preview,
		endpointID,
		threadID,
	)
	if err != nil {
		return err
	}
	if n, _ := updateRes.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	if _, err := bumpFlowerActivityTx(ctx, tx, endpointID, threadID); err != nil {
		return err
	}
	return tx.Commit()
}

func updateThreadRunStateTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, state ThreadRunStateWrite) error {
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid request")
	}
	runStatus, err := canonicalRunStatusForWrite(state.Status)
	if err != nil {
		return err
	}
	runErrorCode := strings.TrimSpace(state.ErrorCode)
	runError := strings.TrimSpace(state.ErrorMessage)
	if runStatus != "failed" && runStatus != "timed_out" {
		runErrorCode = ""
		runError = ""
	}
	waitingUserInputJSON := normalizeWaitingUserInputJSONForStatus(runStatus, state.WaitingUserInputJSON)
	if len(runError) > 600 {
		runError = truncateRunes(runError, 600)
	}
	updatedAt := state.UpdatedAtUnixMs
	if updatedAt <= 0 {
		updatedAt = time.Now().UnixMilli()
	}
	res, err := tx.ExecContext(ctx, `
	UPDATE ai_threads
	SET run_status = ?,
	    run_updated_at_unix_ms = ?,
	    run_error_code = ?,
	    run_error = ?,
	    waiting_user_input_json = ?,
	    updated_at_unix_ms = ?,
	    updated_by_user_public_id = ?,
	    updated_by_user_email = ?
	WHERE endpoint_id = ? AND thread_id = ?
	`, runStatus, updatedAt, runErrorCode, runError, strings.TrimSpace(waitingUserInputJSON), updatedAt, strings.TrimSpace(state.UpdatedByUserPublicID), strings.TrimSpace(state.UpdatedByUserEmail), endpointID, threadID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	if _, err := bumpFlowerActivityTx(ctx, tx, endpointID, threadID); err != nil {
		return err
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
SELECT queue_id, endpoint_id, thread_id, channel_id, lane, message_id, model_id, text_content, attachments_json, context_action_json, options_json, session_meta_json,
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
SELECT queue_id, endpoint_id, thread_id, channel_id, lane, message_id, model_id, text_content, attachments_json, context_action_json, options_json, session_meta_json,
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

// AppendMessage inserts a message into the thread and updates thread metadata in the same transaction.
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

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	rowID, err := appendMessageTx(ctx, tx, endpointID, threadID, m, strings.TrimSpace(updatedByID), strings.TrimSpace(updatedByEmail), preview)
	if err != nil {
		return 0, err
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return rowID, nil
}

// UpsertProjectedMessage stores or replaces one host-owned transcript message
// identified by endpoint, thread, and message id.
func (s *Store) UpsertProjectedMessage(ctx context.Context, endpointID string, threadID string, m Message, updatedByID string, updatedByEmail string) (int64, error) {
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
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	var rowID int64
	var existing Message
	err = tx.QueryRowContext(ctx, `
SELECT id, role, author_user_public_id, author_user_email, status, created_at_unix_ms, updated_at_unix_ms, text_content, message_json
FROM transcript_messages
WHERE endpoint_id = ? AND thread_id = ? AND message_id = ?
`, endpointID, threadID, m.MessageID).Scan(
		&rowID,
		&existing.Role,
		&existing.AuthorUserPublicID,
		&existing.AuthorUserEmail,
		&existing.Status,
		&existing.CreatedAtUnixMs,
		&existing.UpdatedAtUnixMs,
		&existing.TextContent,
		&existing.MessageJSON,
	)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	if errors.Is(err, sql.ErrNoRows) {
		rowID, err = appendMessageTx(ctx, tx, endpointID, threadID, m, strings.TrimSpace(updatedByID), strings.TrimSpace(updatedByEmail), preview)
		if err != nil {
			return 0, err
		}
	} else {
		if existing.Role == m.Role &&
			existing.AuthorUserPublicID == m.AuthorUserPublicID &&
			existing.AuthorUserEmail == m.AuthorUserEmail &&
			existing.Status == m.Status &&
			existing.CreatedAtUnixMs == m.CreatedAtUnixMs &&
			existing.UpdatedAtUnixMs == m.UpdatedAtUnixMs &&
			existing.TextContent == m.TextContent &&
			existing.MessageJSON == m.MessageJSON {
			if err := tx.Commit(); err != nil {
				return 0, err
			}
			return rowID, nil
		}
		_, err = tx.ExecContext(ctx, `
UPDATE transcript_messages
SET role = ?,
    author_user_public_id = ?,
    author_user_email = ?,
    status = ?,
    created_at_unix_ms = ?,
    updated_at_unix_ms = ?,
    text_content = ?,
    message_json = ?
WHERE endpoint_id = ? AND thread_id = ? AND message_id = ?
`,
			m.Role,
			m.AuthorUserPublicID,
			m.AuthorUserEmail,
			m.Status,
			m.CreatedAtUnixMs,
			m.UpdatedAtUnixMs,
			m.TextContent,
			m.MessageJSON,
			endpointID,
			threadID,
			m.MessageID,
		)
		if err != nil {
			return 0, err
		}
		var currentUpdatedAt int64
		var currentLastMessageAt int64
		var currentPreview string
		if err := tx.QueryRowContext(ctx, `
SELECT updated_at_unix_ms, last_message_at_unix_ms, last_message_preview
FROM ai_threads
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(&currentUpdatedAt, &currentLastMessageAt, &currentPreview); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return 0, sql.ErrNoRows
			}
			return 0, err
		}
		nextLastMessageAt := currentLastMessageAt
		nextPreview := strings.TrimSpace(currentPreview)
		if m.CreatedAtUnixMs >= currentLastMessageAt {
			nextLastMessageAt = m.CreatedAtUnixMs
			nextPreview = preview
		}
		_, err = tx.ExecContext(ctx, `
UPDATE ai_threads
SET updated_at_unix_ms = ?,
    updated_by_user_public_id = ?,
    updated_by_user_email = ?,
    last_message_at_unix_ms = ?,
    last_message_preview = ?
WHERE endpoint_id = ? AND thread_id = ?
`,
			maxInt64(m.UpdatedAtUnixMs, currentUpdatedAt),
			strings.TrimSpace(updatedByID),
			strings.TrimSpace(updatedByEmail),
			nextLastMessageAt,
			nextPreview,
			endpointID,
			threadID,
		)
		if err != nil {
			return 0, err
		}
		if _, err := bumpFlowerActivityTx(ctx, tx, endpointID, threadID); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return rowID, nil
}

func appendMessageTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, m Message, updatedByID string, updatedByEmail string, preview string) (int64, error) {
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
	var currentUpdatedAt int64
	var currentLastMessageAt int64
	if err := tx.QueryRowContext(ctx, `
SELECT updated_at_unix_ms, last_message_at_unix_ms
FROM ai_threads
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(&currentUpdatedAt, &currentLastMessageAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, sql.ErrNoRows
		}
		return 0, err
	}
	threadUpdatedAt := maxInt64(m.UpdatedAtUnixMs, currentUpdatedAt+1)
	lastMessageAt := maxInt64(m.CreatedAtUnixMs, currentLastMessageAt+1)
	updateRes, err := tx.ExecContext(ctx, `
UPDATE ai_threads
SET updated_at_unix_ms = ?,
    updated_by_user_public_id = ?,
    updated_by_user_email = ?,
    last_message_at_unix_ms = ?,
    last_message_preview = ?
WHERE endpoint_id = ? AND thread_id = ?
`,
		threadUpdatedAt,
		strings.TrimSpace(updatedByID),
		strings.TrimSpace(updatedByEmail),
		lastMessageAt,
		preview,
		endpointID,
		threadID,
	)
	if err != nil {
		return 0, err
	}
	if n, _ := updateRes.RowsAffected(); n == 0 {
		return 0, sql.ErrNoRows
	}
	if _, err := bumpFlowerActivityTx(ctx, tx, endpointID, threadID); err != nil {
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

func (s *Store) GetFirstUserThreadMessage(ctx context.Context, endpointID string, threadID string) (*Message, error) {
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

	var msg Message
	err := s.db.QueryRowContext(ctx, `
SELECT id, thread_id, endpoint_id, message_id, role,
       author_user_public_id, author_user_email,
       status, created_at_unix_ms, updated_at_unix_ms,
       text_content, message_json
FROM transcript_messages
WHERE endpoint_id = ? AND thread_id = ?
  AND LOWER(TRIM(COALESCE(role, ''))) = 'user'
  AND TRIM(COALESCE(text_content, '')) != ''
ORDER BY id ASC
LIMIT 1
`, endpointID, threadID).Scan(
		&msg.ID,
		&msg.ThreadID,
		&msg.EndpointID,
		&msg.MessageID,
		&msg.Role,
		&msg.AuthorUserPublicID,
		&msg.AuthorUserEmail,
		&msg.Status,
		&msg.CreatedAtUnixMs,
		&msg.UpdatedAtUnixMs,
		&msg.TextContent,
		&msg.MessageJSON,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &msg, nil
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

type ProviderContinuationState struct {
	Kind       string            `json:"kind,omitempty"`
	ID         string            `json:"id,omitempty"`
	Attributes map[string]string `json:"attributes,omitempty"`
}

func (s ProviderContinuationState) normalized() ProviderContinuationState {
	s.Kind = strings.TrimSpace(s.Kind)
	s.ID = strings.TrimSpace(s.ID)
	s.Attributes = cloneProviderContinuationAttributes(s.Attributes)
	if s.Kind == "" || s.ID == "" {
		return ProviderContinuationState{}
	}
	return s
}

func (s ProviderContinuationState) IsZero() bool {
	normalized := s.normalized()
	return normalized.Kind == "" || normalized.ID == ""
}

type ThreadProviderContinuation struct {
	State           ProviderContinuationState `json:"state"`
	ProviderID      string                    `json:"provider_id"`
	Model           string                    `json:"model"`
	BaseURL         string                    `json:"base_url"`
	UpdatedAtUnixMs int64                     `json:"updated_at_unix_ms"`
}

func (c ThreadProviderContinuation) normalized() ThreadProviderContinuation {
	c.State = c.State.normalized()
	c.ProviderID = strings.TrimSpace(c.ProviderID)
	c.Model = strings.TrimSpace(c.Model)
	c.BaseURL = strings.TrimSpace(c.BaseURL)
	if c.State.IsZero() {
		return ThreadProviderContinuation{}
	}
	return c
}

func (c ThreadProviderContinuation) Normalized() ThreadProviderContinuation {
	return c.normalized()
}

func (c ThreadProviderContinuation) IsZero() bool {
	return c.normalized().State.IsZero()
}

func cloneProviderContinuationAttributes(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

func marshalProviderContinuationState(state ProviderContinuationState) string {
	state = state.normalized()
	if state.IsZero() {
		return ""
	}
	raw, err := json.Marshal(state)
	if err != nil || len(raw) == 0 {
		return ""
	}
	return string(raw)
}

func parseProviderContinuationStateJSON(raw string) ProviderContinuationState {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ProviderContinuationState{}
	}
	var state ProviderContinuationState
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return ProviderContinuationState{}
	}
	return state.normalized()
}

type ThreadState struct {
	EndpointID           string                     `json:"endpoint_id"`
	ThreadID             string                     `json:"thread_id"`
	OpenGoal             string                     `json:"open_goal"`
	LastAssistantSummary string                     `json:"last_assistant_summary"`
	ProviderContinuation ThreadProviderContinuation `json:"provider_continuation,omitempty"`
	UpdatedAtUnixMs      int64                      `json:"updated_at_unix_ms"`
}

type ThreadContextBoundary struct {
	TurnRowID int64
	MessageID int64
}

var ErrThreadContextBoundaryChanged = errors.New("thread context boundary changed")

func (s *Store) CurrentThreadContextBoundary(ctx context.Context, endpointID string, threadID string) (ThreadContextBoundary, error) {
	if s == nil || s.db == nil {
		return ThreadContextBoundary{}, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return ThreadContextBoundary{}, errors.New("invalid request")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ThreadContextBoundary{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := ensureThreadExistsTx(ctx, tx, endpointID, threadID); err != nil {
		return ThreadContextBoundary{}, err
	}
	boundary, err := currentThreadContextBoundaryTx(ctx, tx, endpointID, threadID)
	if err != nil {
		return ThreadContextBoundary{}, err
	}
	if err := tx.Commit(); err != nil {
		return ThreadContextBoundary{}, err
	}
	return boundary, nil
}

func currentThreadContextBoundaryTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) (ThreadContextBoundary, error) {
	var boundary ThreadContextBoundary
	if err := tx.QueryRowContext(ctx, `
SELECT COALESCE(MAX(id), 0)
FROM conversation_turns
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(&boundary.TurnRowID); err != nil {
		return ThreadContextBoundary{}, err
	}
	if err := tx.QueryRowContext(ctx, `
SELECT COALESCE(MAX(id), 0)
FROM transcript_messages
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(&boundary.MessageID); err != nil {
		return ThreadContextBoundary{}, err
	}
	return boundary, nil
}

func ensureThreadExistsTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) error {
	var exists int
	if err := tx.QueryRowContext(ctx, `
SELECT 1
FROM ai_threads
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return sql.ErrNoRows
		}
		return err
	}
	return nil
}

func ensureThreadContextBoundaryTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, expected ThreadContextBoundary) error {
	current, err := currentThreadContextBoundaryTx(ctx, tx, endpointID, threadID)
	if err != nil {
		return err
	}
	if current.TurnRowID != expected.TurnRowID || current.MessageID != expected.MessageID {
		return ErrThreadContextBoundaryChanged
	}
	return nil
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
	var providerContinuationStateJSON string
	err := s.db.QueryRowContext(ctx, `
	SELECT endpoint_id, thread_id, open_goal, last_assistant_summary,
	       provider_continuation_state_json, provider_continuation_provider_id,
	       provider_continuation_model, provider_continuation_base_url, provider_continuation_updated_at_unix_ms,
	       updated_at_unix_ms
	FROM ai_thread_state
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(
		&st.EndpointID,
		&st.ThreadID,
		&st.OpenGoal,
		&st.LastAssistantSummary,
		&providerContinuationStateJSON,
		&st.ProviderContinuation.ProviderID,
		&st.ProviderContinuation.Model,
		&st.ProviderContinuation.BaseURL,
		&st.ProviderContinuation.UpdatedAtUnixMs,
		&st.UpdatedAtUnixMs,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	st.OpenGoal = strings.TrimSpace(st.OpenGoal)
	st.LastAssistantSummary = strings.TrimSpace(st.LastAssistantSummary)
	st.ProviderContinuation.State = parseProviderContinuationStateJSON(providerContinuationStateJSON)
	st.ProviderContinuation = st.ProviderContinuation.normalized()
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
	st.ProviderContinuation = st.ProviderContinuation.normalized()
	if st.EndpointID == "" || st.ThreadID == "" {
		return errors.New("invalid thread state")
	}
	if st.UpdatedAtUnixMs <= 0 {
		st.UpdatedAtUnixMs = time.Now().UnixMilli()
	}
	_, err := s.db.ExecContext(ctx, `
	INSERT INTO ai_thread_state(
	  endpoint_id, thread_id, open_goal, last_assistant_summary,
	  provider_continuation_state_json, provider_continuation_provider_id,
	  provider_continuation_model, provider_continuation_base_url, provider_continuation_updated_at_unix_ms,
	  updated_at_unix_ms
	)
	VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(endpoint_id, thread_id) DO UPDATE SET
	  open_goal=excluded.open_goal,
	  last_assistant_summary=excluded.last_assistant_summary,
	  provider_continuation_state_json=excluded.provider_continuation_state_json,
	  provider_continuation_provider_id=excluded.provider_continuation_provider_id,
	  provider_continuation_model=excluded.provider_continuation_model,
	  provider_continuation_base_url=excluded.provider_continuation_base_url,
	  provider_continuation_updated_at_unix_ms=excluded.provider_continuation_updated_at_unix_ms,
	  updated_at_unix_ms=excluded.updated_at_unix_ms
	`, st.EndpointID, st.ThreadID, st.OpenGoal, st.LastAssistantSummary,
		marshalProviderContinuationState(st.ProviderContinuation.State), st.ProviderContinuation.ProviderID,
		st.ProviderContinuation.Model, st.ProviderContinuation.BaseURL, st.ProviderContinuation.UpdatedAtUnixMs,
		st.UpdatedAtUnixMs)
	return err
}

func (s *Store) GetThreadProviderContinuation(ctx context.Context, endpointID string, threadID string) (*ThreadProviderContinuation, error) {
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

	var cont ThreadProviderContinuation
	var stateJSON string
	err := s.db.QueryRowContext(ctx, `
	SELECT provider_continuation_state_json, provider_continuation_provider_id,
	       provider_continuation_model, provider_continuation_base_url, provider_continuation_updated_at_unix_ms
	FROM ai_thread_state
	WHERE endpoint_id = ? AND thread_id = ?
	`, endpointID, threadID).Scan(
		&stateJSON,
		&cont.ProviderID,
		&cont.Model,
		&cont.BaseURL,
		&cont.UpdatedAtUnixMs,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	cont.State = parseProviderContinuationStateJSON(stateJSON)
	cont = cont.normalized()
	if cont.IsZero() {
		return nil, nil
	}
	return &cont, nil
}

func (s *Store) SetThreadProviderContinuation(ctx context.Context, endpointID string, threadID string, cont ThreadProviderContinuation) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	cont = cont.normalized()
	if endpointID == "" || threadID == "" || cont.IsZero() {
		return errors.New("invalid request")
	}
	if cont.UpdatedAtUnixMs <= 0 {
		cont.UpdatedAtUnixMs = time.Now().UnixMilli()
	}
	updatedAt := time.Now().UnixMilli()
	_, err := s.db.ExecContext(ctx, `
	INSERT INTO ai_thread_state(
	  endpoint_id, thread_id, open_goal, last_assistant_summary,
	  provider_continuation_state_json, provider_continuation_provider_id,
	  provider_continuation_model, provider_continuation_base_url, provider_continuation_updated_at_unix_ms,
	  updated_at_unix_ms
	)
	VALUES(?, ?, '', '', ?, ?, ?, ?, ?, ?)
	ON CONFLICT(endpoint_id, thread_id) DO UPDATE SET
	  provider_continuation_state_json=excluded.provider_continuation_state_json,
	  provider_continuation_provider_id=excluded.provider_continuation_provider_id,
	  provider_continuation_model=excluded.provider_continuation_model,
	  provider_continuation_base_url=excluded.provider_continuation_base_url,
	  provider_continuation_updated_at_unix_ms=excluded.provider_continuation_updated_at_unix_ms,
	  updated_at_unix_ms=excluded.updated_at_unix_ms
	`, endpointID, threadID, marshalProviderContinuationState(cont.State), cont.ProviderID, cont.Model, cont.BaseURL, cont.UpdatedAtUnixMs, updatedAt)
	return err
}

func (s *Store) SetThreadProviderContinuationIfBoundaryMatches(ctx context.Context, endpointID string, threadID string, expected ThreadContextBoundary, cont ThreadProviderContinuation) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	cont = cont.normalized()
	if endpointID == "" || threadID == "" || cont.IsZero() {
		return errors.New("invalid request")
	}
	if cont.UpdatedAtUnixMs <= 0 {
		cont.UpdatedAtUnixMs = time.Now().UnixMilli()
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := ensureThreadExistsTx(ctx, tx, endpointID, threadID); err != nil {
		return err
	}
	if err := ensureThreadContextBoundaryTx(ctx, tx, endpointID, threadID, expected); err != nil {
		return err
	}
	updatedAt := time.Now().UnixMilli()
	if _, err := tx.ExecContext(ctx, `
	INSERT INTO ai_thread_state(
	  endpoint_id, thread_id, open_goal, last_assistant_summary,
	  provider_continuation_state_json, provider_continuation_provider_id,
	  provider_continuation_model, provider_continuation_base_url, provider_continuation_updated_at_unix_ms,
	  updated_at_unix_ms
	)
	VALUES(?, ?, '', '', ?, ?, ?, ?, ?, ?)
	ON CONFLICT(endpoint_id, thread_id) DO UPDATE SET
	  provider_continuation_state_json=excluded.provider_continuation_state_json,
	  provider_continuation_provider_id=excluded.provider_continuation_provider_id,
	  provider_continuation_model=excluded.provider_continuation_model,
	  provider_continuation_base_url=excluded.provider_continuation_base_url,
	  provider_continuation_updated_at_unix_ms=excluded.provider_continuation_updated_at_unix_ms,
	  updated_at_unix_ms=excluded.updated_at_unix_ms
	`, endpointID, threadID, marshalProviderContinuationState(cont.State), cont.ProviderID, cont.Model, cont.BaseURL, cont.UpdatedAtUnixMs, updatedAt); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) ClearThreadProviderContinuation(ctx context.Context, endpointID string, threadID string) error {
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
	UPDATE ai_thread_state
	SET provider_continuation_state_json = '',
	    provider_continuation_provider_id = '',
	    provider_continuation_model = '',
	    provider_continuation_base_url = '',
    provider_continuation_updated_at_unix_ms = 0,
    updated_at_unix_ms = ?
WHERE endpoint_id = ? AND thread_id = ?
`, time.Now().UnixMilli(), endpointID, threadID)
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
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := upsertRunTx(ctx, tx, rec); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) GetRun(ctx context.Context, endpointID string, runID string) (*RunRecord, error) {
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
	var rec RunRecord
	err := s.db.QueryRowContext(ctx, `
SELECT run_id, endpoint_id, thread_id, message_id,
       state, error_code, error_message, attempt_count,
       started_at_unix_ms, ended_at_unix_ms, updated_at_unix_ms
FROM ai_runs
WHERE endpoint_id = ? AND run_id = ?
`, endpointID, runID).Scan(
		&rec.RunID,
		&rec.EndpointID,
		&rec.ThreadID,
		&rec.MessageID,
		&rec.State,
		&rec.ErrorCode,
		&rec.ErrorMessage,
		&rec.AttemptCount,
		&rec.StartedAtUnixMs,
		&rec.EndedAtUnixMs,
		&rec.UpdatedAtUnixMs,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &rec, nil
}

func upsertRunTx(ctx context.Context, tx *sql.Tx, rec RunRecord) error {
	rec.RunID = strings.TrimSpace(rec.RunID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	rec.MessageID = strings.TrimSpace(rec.MessageID)
	state, err := canonicalRunStatusForWrite(rec.State)
	if err != nil {
		return err
	}
	rec.State = state
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
	_, err = tx.ExecContext(ctx, `
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
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	_, err = tx.ExecContext(ctx, `
INSERT INTO ai_run_events(endpoint_id, thread_id, run_id, stream_kind, event_type, payload_json, at_unix_ms)
VALUES(?, ?, ?, ?, ?, ?, ?)
`, rec.EndpointID, rec.ThreadID, rec.RunID, rec.StreamKind, rec.EventType, rec.PayloadJSON, rec.AtUnixMs)
	if err != nil {
		return err
	}
	if isPersistedContextRunEventType(rec.EventType) {
		res, err := tx.ExecContext(ctx, `
UPDATE ai_threads
SET last_context_run_id = ?
WHERE endpoint_id = ? AND thread_id = ?
`, rec.RunID, rec.EndpointID, rec.ThreadID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			if _, err := bumpFlowerActivityTx(ctx, tx, rec.EndpointID, rec.ThreadID); err != nil {
				return err
			}
		}
	}
	if err := pruneRunEventsForThreadTx(ctx, tx, rec.EndpointID, rec.ThreadID); err != nil {
		return err
	}
	return tx.Commit()
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
  OR event_type = 'context.compaction.updated'
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

func (s *Store) ListThreadContextRunEvents(ctx context.Context, endpointID string, threadID string, limit int) ([]RunEventRecord, error) {
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
		limit = 500
	}
	if limit > 2000 {
		limit = 2000
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT id, endpoint_id, thread_id, run_id, stream_kind, event_type, payload_json, at_unix_ms
FROM ai_run_events
WHERE endpoint_id = ? AND thread_id = ?
  AND event_type IN ('context.usage.updated', 'context.compaction.updated')
ORDER BY id DESC
LIMIT ?
`, endpointID, threadID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	reversed := make([]RunEventRecord, 0, limit)
	for rows.Next() {
		var rec RunEventRecord
		if err := rows.Scan(&rec.ID, &rec.EndpointID, &rec.ThreadID, &rec.RunID, &rec.StreamKind, &rec.EventType, &rec.PayloadJSON, &rec.AtUnixMs); err != nil {
			return nil, err
		}
		reversed = append(reversed, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]RunEventRecord, len(reversed))
	for i := range reversed {
		out[len(reversed)-1-i] = reversed[i]
	}
	return out, nil
}

func pruneRunEventsForThreadTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) error {
	if tx == nil {
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
		if _, err := tx.ExecContext(ctx, `
DELETE FROM ai_run_events
WHERE endpoint_id = ? AND thread_id = ? AND at_unix_ms > 0 AND at_unix_ms < ?
`, endpointID, threadID, minAtUnixMs); err != nil {
			return err
		}
	}

	if runEventRetentionMaxPerThread > 0 {
		if _, err := tx.ExecContext(ctx, `
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
		if latest := latestAssistantPreviewText(messageJSON); latest != "" {
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

func latestAssistantPreviewText(messageJSON string) string {
	return latestAssistantVisibleText(messageJSON)
}

func latestAssistantVisibleText(messageJSON string) string {
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
		if preview := assistantVisibleTextFromBlock(payload.Blocks[i]); preview != "" {
			return preview
		}
	}
	return ""
}

func assistantVisibleTextFromBlock(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var meta struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &meta); err != nil {
		return ""
	}
	switch strings.ToLower(strings.TrimSpace(meta.Type)) {
	case "markdown", "text", "thinking":
		var block struct {
			Content string `json:"content"`
			Text    string `json:"text"`
		}
		if err := json.Unmarshal(raw, &block); err != nil {
			return ""
		}
		return strings.TrimSpace(firstNonEmpty(block.Content, block.Text))
	default:
		return ""
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func maxInt64(a int64, b int64) int64 {
	if a > b {
		return a
	}
	return b
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
