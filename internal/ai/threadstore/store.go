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

type OpenOption func(*openOptions)

type openOptions struct {
	migrateTitle func(context.Context, LegacyThreadTitle) error
}

// WithLegacyThreadTitleMigrator supplies the Floret-side title migration used
// before the product schema v2 to v3 SQL migration starts.
func WithLegacyThreadTitleMigrator(migrateTitle func(context.Context, LegacyThreadTitle) error) OpenOption {
	return func(options *openOptions) {
		options.migrateTitle = migrateTitle
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
	if err := migrateLegacyThreadTitles(p, options.migrateTitle); err != nil {
		return nil, err
	}
	db, err := sqliteutil.Open(p, threadstoreSchemaSpec())
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

type ThreadSettings struct {
	ThreadID               string `json:"thread_id"`
	EndpointID             string `json:"endpoint_id"`
	NamespacePublicID      string `json:"namespace_public_id"`
	ModelID                string `json:"model_id"`
	ReasoningSelectionJSON string `json:"reasoning_selection_json"`
	PermissionType         string `json:"permission_type"`
	WorkingDir             string `json:"working_dir"`
	PinnedAtUnixMs         int64  `json:"pinned_at_unix_ms"`
	QueueRevision          int64  `json:"queue_revision"`

	CreatedByUserPublicID string `json:"created_by_user_public_id"`
	CreatedByUserEmail    string `json:"created_by_user_email"`
	UpdatedByUserPublicID string `json:"updated_by_user_public_id"`
	UpdatedByUserEmail    string `json:"updated_by_user_email"`

	SettingsCreatedAtUnixMs int64 `json:"settings_created_at_unix_ms"`
	SettingsUpdatedAtUnixMs int64 `json:"settings_updated_at_unix_ms"`
}

type QueuedTurn struct {
	QueueID string `json:"queue_id"`

	ThreadID       string `json:"thread_id"`
	EndpointID     string `json:"endpoint_id"`
	ChannelID      string `json:"channel_id"`
	Lane           string `json:"lane"`
	AdmissionState string `json:"admission_state"`

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
	PinnedAtUnixMs          int64
	SettingsCreatedAtUnixMs int64
	ThreadID                string
}

const threadSelectColumnsSQL = `
  thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json, permission_type, working_dir,
  pinned_at_unix_ms, queue_revision,
  created_by_user_public_id, created_by_user_email,
  updated_by_user_public_id, updated_by_user_email,
  settings_created_at_unix_ms, settings_updated_at_unix_ms
`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanThreadRow(scan rowScanner, t *ThreadSettings) error {
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
		&t.PinnedAtUnixMs,
		&t.QueueRevision,
		&t.CreatedByUserPublicID,
		&t.CreatedByUserEmail,
		&t.UpdatedByUserPublicID,
		&t.UpdatedByUserEmail,
		&t.SettingsCreatedAtUnixMs,
		&t.SettingsUpdatedAtUnixMs,
	); err != nil {
		return err
	}
	permissionType, err := canonicalPermissionType(t.PermissionType)
	if err != nil {
		return err
	}
	t.PermissionType = permissionType
	t.ReasoningSelectionJSON = strings.TrimSpace(t.ReasoningSelectionJSON)
	return nil
}

// EncodeCursor encodes a cursor as a URL-safe base64 string.
func EncodeCursor(c ThreadsCursor) string {
	if c.SettingsCreatedAtUnixMs <= 0 || strings.TrimSpace(c.ThreadID) == "" {
		return ""
	}
	raw := fmt.Sprintf("%d:%d:%s", nonNegativeInt64(c.PinnedAtUnixMs), c.SettingsCreatedAtUnixMs, strings.TrimSpace(c.ThreadID))
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
	return ThreadsCursor{PinnedAtUnixMs: pinnedAt, SettingsCreatedAtUnixMs: ms, ThreadID: id}, true
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

func (s *Store) ListThreadSettings(ctx context.Context, endpointID string, limit int, cursor ThreadsCursor) ([]ThreadSettings, string, error) {
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
FROM ai_thread_settings
WHERE endpoint_id = ?
`, threadSelectColumnsSQL)
	if cursor.SettingsCreatedAtUnixMs > 0 && strings.TrimSpace(cursor.ThreadID) != "" {
		cursorPinned := nonNegativeInt64(cursor.PinnedAtUnixMs)
		cursorThreadID := strings.TrimSpace(cursor.ThreadID)
		q += `
  AND (
    CASE WHEN pinned_at_unix_ms > 0 THEN 1 ELSE 0 END < CASE WHEN ? > 0 THEN 1 ELSE 0 END
    OR (
      CASE WHEN pinned_at_unix_ms > 0 THEN 1 ELSE 0 END = CASE WHEN ? > 0 THEN 1 ELSE 0 END
      AND (
        (? > 0 AND pinned_at_unix_ms < ?)
		OR ((pinned_at_unix_ms = ? OR (? = 0 AND pinned_at_unix_ms <= 0)) AND settings_created_at_unix_ms < ?)
		OR ((pinned_at_unix_ms = ? OR (? = 0 AND pinned_at_unix_ms <= 0)) AND settings_created_at_unix_ms = ? AND thread_id > ?)
      )
    )
  )
`
		args = append(args,
			cursorPinned,
			cursorPinned,
			cursorPinned, cursorPinned,
			cursorPinned, cursorPinned, cursor.SettingsCreatedAtUnixMs,
			cursorPinned, cursorPinned, cursor.SettingsCreatedAtUnixMs, cursorThreadID,
		)
	}
	q += `
ORDER BY
  CASE WHEN pinned_at_unix_ms > 0 THEN 1 ELSE 0 END DESC,
  pinned_at_unix_ms DESC,
  settings_created_at_unix_ms DESC,
  thread_id ASC
LIMIT ?
`
	args = append(args, limit+1)

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()

	out := make([]ThreadSettings, 0, limit+1)
	for rows.Next() {
		var t ThreadSettings
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
		next = EncodeCursor(ThreadsCursor{PinnedAtUnixMs: last.PinnedAtUnixMs, SettingsCreatedAtUnixMs: last.SettingsCreatedAtUnixMs, ThreadID: last.ThreadID})
	}
	return out, next, nil
}

// ListAllThreadSettingsForRecovery returns the host-owned root identities that
// the startup recovery coordinator must reconcile with Floret. It is not a UI
// pagination surface and does not project canonical Agent state.
func (s *Store) ListAllThreadSettingsForRecovery(ctx context.Context) ([]ThreadSettings, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rows, err := s.db.QueryContext(ctx, fmt.Sprintf(`
SELECT
%s
FROM ai_thread_settings
ORDER BY endpoint_id ASC, thread_id ASC
`, threadSelectColumnsSQL))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ThreadSettings, 0)
	for rows.Next() {
		var settings ThreadSettings
		if err := scanThreadRow(rows, &settings); err != nil {
			return nil, err
		}
		out = append(out, settings)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) GetThreadSettings(ctx context.Context, endpointID string, threadID string) (*ThreadSettings, error) {
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

	var t ThreadSettings
	err := scanThreadRow(s.db.QueryRowContext(ctx, fmt.Sprintf(`
SELECT
%s
FROM ai_thread_settings
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

func (s *Store) getThreadTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) (*ThreadSettings, error) {
	var thread ThreadSettings
	err := scanThreadRow(tx.QueryRowContext(ctx, fmt.Sprintf(`SELECT %s FROM ai_thread_settings WHERE endpoint_id = ? AND thread_id = ?`, threadSelectColumnsSQL), endpointID, threadID), &thread)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &thread, nil
}

func (s *Store) CreateThreadSettings(ctx context.Context, t ThreadSettings) error {
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
	t.CreatedByUserPublicID = strings.TrimSpace(t.CreatedByUserPublicID)
	t.CreatedByUserEmail = strings.TrimSpace(t.CreatedByUserEmail)
	t.UpdatedByUserPublicID = strings.TrimSpace(t.UpdatedByUserPublicID)
	t.UpdatedByUserEmail = strings.TrimSpace(t.UpdatedByUserEmail)

	if t.ThreadID == "" || t.EndpointID == "" {
		return errors.New("invalid thread")
	}
	now := time.Now().UnixMilli()
	if t.SettingsCreatedAtUnixMs <= 0 {
		t.SettingsCreatedAtUnixMs = now
	}
	if t.SettingsUpdatedAtUnixMs <= 0 {
		t.SettingsUpdatedAtUnixMs = t.SettingsCreatedAtUnixMs
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireThreadWritableTx(ctx, tx, t.EndpointID, t.ThreadID); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO ai_thread_settings(
		  thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json, permission_type, working_dir,
	  pinned_at_unix_ms, queue_revision,
	  created_by_user_public_id, created_by_user_email,
	  updated_by_user_public_id, updated_by_user_email,
	  settings_created_at_unix_ms, settings_updated_at_unix_ms
			) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		t.ThreadID,
		t.EndpointID,
		t.NamespacePublicID,
		t.ModelID,
		t.ReasoningSelectionJSON,
		t.PermissionType,
		t.WorkingDir,
		nonNegativeInt64(t.PinnedAtUnixMs),
		nonNegativeInt64(t.QueueRevision),
		t.CreatedByUserPublicID,
		t.CreatedByUserEmail,
		t.UpdatedByUserPublicID,
		t.UpdatedByUserEmail,
		t.SettingsCreatedAtUnixMs,
		t.SettingsUpdatedAtUnixMs,
	)
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "thread id retired") {
		return ErrThreadIDRetired
	}
	if err != nil {
		return err
	}
	return tx.Commit()
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

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireThreadWritableTx(ctx, tx, endpointID, threadID); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `
UPDATE ai_thread_settings
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
	return tx.Commit()
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
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireThreadWritableTx(ctx, tx, endpointID, threadID); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `
UPDATE ai_thread_settings
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
	return tx.Commit()
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
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireThreadWritableTx(ctx, tx, endpointID, threadID); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `
UPDATE ai_thread_settings
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
	return tx.Commit()
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

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireThreadWritableTx(ctx, tx, endpointID, threadID); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `
UPDATE ai_thread_settings
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
	return tx.Commit()
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
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireThreadWritableTx(ctx, tx, endpointID, threadID); err != nil {
		return 0, err
	}
	res, err := tx.ExecContext(ctx, `
UPDATE ai_thread_settings
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
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return pinnedAt, nil
}

func canonicalPermissionType(permissionType string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(permissionType)) {
	case "":
		return "", errors.New("thread permission type is empty")
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
SELECT queue_id, endpoint_id, thread_id, channel_id, lane, admission_state, turn_id, run_id, model_id, text_content, attachments_json, context_action_json, options_json, session_meta_json,
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
	if err := requireThreadWritableTx(ctx, tx, endpointID, threadID); err != nil {
		return err
	}
	if err := requireFollowupMutableTx(ctx, tx, endpointID, threadID, queueID); err != nil {
		return err
	}
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
	if err := requireThreadWritableTx(ctx, tx, endpointID, threadID); err != nil {
		return err
	}
	if err := requireFollowupMutableTx(ctx, tx, endpointID, threadID, queueID); err != nil {
		return err
	}
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
	if err := requireThreadWritableTx(ctx, tx, endpointID, threadID); err != nil {
		return err
	}
	var inFlight int
	if err := tx.QueryRowContext(ctx, `
SELECT COUNT(1)
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND lane = ? AND admission_state = ?
`, endpointID, threadID, FollowupLaneQueued, PendingTurnAdmissionInFlight).Scan(&inFlight); err != nil {
		return err
	}
	if inFlight != 0 {
		return ErrPendingTurnAdmissionInProgress
	}
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
	if err := requireThreadWritableTx(ctx, tx, endpointID, threadID); err != nil {
		return nil, err
	}

	rec, err := getNextQueuedTurnTx(ctx, tx, endpointID, threadID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
DELETE FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ? AND lane = ? AND admission_state = ?
`, endpointID, threadID, rec.QueueID, FollowupLaneQueued, PendingTurnAdmissionReady); err != nil {
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
SELECT queue_id, endpoint_id, thread_id, channel_id, lane, admission_state, turn_id, run_id, model_id, text_content, attachments_json, context_action_json, options_json, session_meta_json,
       created_by_user_public_id, created_by_user_email, sort_index, created_at_unix_ms, updated_at_unix_ms
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND lane = ? AND admission_state = ?
ORDER BY sort_index ASC, queue_id ASC
LIMIT 1
`, endpointID, threadID, FollowupLaneQueued, PendingTurnAdmissionReady)
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
