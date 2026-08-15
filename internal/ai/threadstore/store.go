package threadstore

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
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

func Open(path string) (*Store, error) {
	p := filepath.Clean(strings.TrimSpace(path))
	if p == "" {
		return nil, errors.New("missing db path")
	}
	if err := preflightCurrentThreadstore(p); err != nil {
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

func preflightCurrentThreadstore(path string) error {
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect threadstore file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return errors.New("threadstore path is not a regular file")
	}
	if info.Size() == 0 {
		return nil
	}
	u := url.URL{Scheme: "file", Path: path}
	query := u.Query()
	query.Set("mode", "ro")
	query.Set("immutable", "1")
	u.RawQuery = query.Encode()
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return fmt.Errorf("open threadstore preflight: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin threadstore preflight: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var version int
	if err := tx.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return fmt.Errorf("read threadstore preflight version: %w", err)
	}
	var metaTableCount int
	if err := tx.QueryRow("SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = '__redeven_db_meta'").Scan(&metaTableCount); err != nil {
		return fmt.Errorf("inspect threadstore metadata table: %w", err)
	}
	if metaTableCount != 1 {
		return &sqliteutil.WrongDatabaseKindError{ExpectedKind: threadstoreSchemaKind}
	}
	var kind string
	if err := tx.QueryRow("SELECT db_kind FROM __redeven_db_meta WHERE singleton = 1").Scan(&kind); err != nil {
		return fmt.Errorf("read threadstore database kind: %w", err)
	}
	kind = strings.TrimSpace(kind)
	if kind != threadstoreSchemaKind {
		return &sqliteutil.WrongDatabaseKindError{ExpectedKind: threadstoreSchemaKind, ActualKind: kind}
	}
	if version > threadstoreCurrentSchemaVersion {
		return &sqliteutil.DatabaseTooNewError{Kind: kind, Version: version, CurrentVersion: threadstoreCurrentSchemaVersion}
	}
	if version < threadstoreSchemaSpec().MinimumVersion {
		return &sqliteutil.DatabaseTooOldError{Kind: kind, Version: version, MinimumVersion: threadstoreSchemaSpec().MinimumVersion}
	}
	expected, err := reviewedProductSchemaContract(version)
	if err != nil {
		return err
	}
	actual, err := inspectReviewedSchemaTx(tx)
	if err != nil {
		return fmt.Errorf("inspect threadstore reviewed schema: %w", err)
	}
	if err := compareReviewedSchemas(actual, expected); err != nil {
		return &sqliteutil.SchemaVerifyError{Kind: threadstoreSchemaKind, Err: err}
	}
	return nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

type ThreadSettings struct {
	ThreadID               string `json:"thread_id"`
	ParentThreadID         string `json:"parent_thread_id,omitempty"`
	EndpointID             string `json:"endpoint_id"`
	NamespacePublicID      string `json:"namespace_public_id"`
	ModelID                string `json:"model_id"`
	ReasoningSelectionJSON string `json:"reasoning_selection_json"`
	PermissionType         string `json:"permission_type"`
	WorkingDir             string `json:"working_dir"`
	PinnedAtUnixMs         int64  `json:"pinned_at_unix_ms"`

	CreatedByUserPublicID string `json:"created_by_user_public_id"`
	CreatedByUserEmail    string `json:"created_by_user_email"`
	UpdatedByUserPublicID string `json:"updated_by_user_public_id"`
	UpdatedByUserEmail    string `json:"updated_by_user_email"`

	SettingsCreatedAtUnixMs int64 `json:"settings_created_at_unix_ms"`
	SettingsUpdatedAtUnixMs int64 `json:"settings_updated_at_unix_ms"`
}

type ThreadsCursor struct {
	PinnedAtUnixMs          int64
	SettingsCreatedAtUnixMs int64
	ThreadID                string
}

type ThreadSettingsRecoveryCursor struct {
	EndpointID string
	ThreadID   string
}

const threadSelectColumnsSQL = `
  thread_id, parent_thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json, permission_type, working_dir,
  pinned_at_unix_ms,
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
		&t.ParentThreadID,
		&t.EndpointID,
		&t.NamespacePublicID,
		&t.ModelID,
		&t.ReasoningSelectionJSON,
		&t.PermissionType,
		&t.WorkingDir,
		&t.PinnedAtUnixMs,
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
WHERE endpoint_id = ? AND parent_thread_id = ''
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

// ListThreadSettingsForRecoveryPage returns a stable page of host-owned root
// identities for startup reconciliation. It does not project Agent state.
func (s *Store) ListThreadSettingsForRecoveryPage(ctx context.Context, cursor ThreadSettingsRecoveryCursor, limit int) ([]ThreadSettings, ThreadSettingsRecoveryCursor, bool, error) {
	if s == nil || s.db == nil {
		return nil, ThreadSettingsRecoveryCursor{}, false, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	cursor.EndpointID = strings.TrimSpace(cursor.EndpointID)
	cursor.ThreadID = strings.TrimSpace(cursor.ThreadID)
	if (cursor.EndpointID == "") != (cursor.ThreadID == "") {
		return nil, ThreadSettingsRecoveryCursor{}, false, errors.New("recovery settings cursor is incomplete")
	}
	if limit <= 0 {
		limit = 200
	}
	if limit > 200 {
		return nil, ThreadSettingsRecoveryCursor{}, false, errors.New("recovery settings page size exceeds 200")
	}
	args := []any{}
	query := fmt.Sprintf(`
SELECT
%s
FROM ai_thread_settings
`, threadSelectColumnsSQL)
	if cursor.EndpointID != "" {
		query += `
WHERE endpoint_id > ? OR (endpoint_id = ? AND thread_id > ?)
`
		args = append(args, cursor.EndpointID, cursor.EndpointID, cursor.ThreadID)
	}
	query += `
ORDER BY endpoint_id ASC, thread_id ASC
LIMIT ?
`
	args = append(args, limit+1)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, ThreadSettingsRecoveryCursor{}, false, err
	}
	defer rows.Close()
	out := make([]ThreadSettings, 0, limit+1)
	for rows.Next() {
		var settings ThreadSettings
		if err := scanThreadRow(rows, &settings); err != nil {
			return nil, ThreadSettingsRecoveryCursor{}, false, err
		}
		out = append(out, settings)
	}
	if err := rows.Err(); err != nil {
		return nil, ThreadSettingsRecoveryCursor{}, false, err
	}
	hasMore := len(out) > limit
	if hasMore {
		out = out[:limit]
	}
	if !hasMore || len(out) == 0 {
		return out, ThreadSettingsRecoveryCursor{}, false, nil
	}
	last := out[len(out)-1]
	return out, ThreadSettingsRecoveryCursor{EndpointID: last.EndpointID, ThreadID: last.ThreadID}, true, nil
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

func (s *Store) CreateThreadSettings(ctx context.Context, t ThreadSettings) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	t.ThreadID = strings.TrimSpace(t.ThreadID)
	t.ParentThreadID = strings.TrimSpace(t.ParentThreadID)
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
	_, err = tx.ExecContext(ctx, `
		INSERT INTO ai_thread_settings(
		  thread_id, parent_thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json, permission_type, working_dir,
	  pinned_at_unix_ms,
	  created_by_user_public_id, created_by_user_email,
	  updated_by_user_public_id, updated_by_user_email,
	  settings_created_at_unix_ms, settings_updated_at_unix_ms
			) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		t.ThreadID,
		t.ParentThreadID,
		t.EndpointID,
		t.NamespacePublicID,
		t.ModelID,
		t.ReasoningSelectionJSON,
		t.PermissionType,
		t.WorkingDir,
		nonNegativeInt64(t.PinnedAtUnixMs),
		t.CreatedByUserPublicID,
		t.CreatedByUserEmail,
		t.UpdatedByUserPublicID,
		t.UpdatedByUserEmail,
		t.SettingsCreatedAtUnixMs,
		t.SettingsUpdatedAtUnixMs,
	)
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
