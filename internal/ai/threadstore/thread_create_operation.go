package threadstore

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const ThreadCreateSnapshotSchemaVersion = 1

const (
	ThreadCreateOperationPending   = "pending"
	ThreadCreateOperationCommitted = "committed"
	ThreadCreateOperationFailed    = "failed"
)

type PrepareThreadCreateRequest struct {
	OperationID   string
	Settings      ThreadSettings
	ExplicitTitle string
	CreatedAtMS   int64
}

type ThreadCreateOperation struct {
	OperationID           string
	EndpointID            string
	ThreadID              string
	RequestFingerprint    string
	Status                string
	SnapshotSchemaVersion int
	SnapshotJSON          string
	Settings              ThreadSettings
	ExplicitTitle         string
	FloretCreatedAtMS     int64
	TitleSetAtMS          int64
	SettingsCommittedAtMS int64
	RetryCount            int
	ErrorCode             string
	ErrorMessage          string
	CreatedAtMS           int64
	UpdatedAtMS           int64
}

type threadCreateSnapshotV1 struct {
	SchemaVersion int            `json:"schema_version"`
	Settings      ThreadSettings `json:"settings"`
	ExplicitTitle string         `json:"explicit_title,omitempty"`
}

func stableThreadCreateOperationID(endpointID, threadID string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(endpointID) + "\x00" + strings.TrimSpace(threadID)))
	return "thread_create_" + hex.EncodeToString(sum[:12])
}

func (s *Store) PrepareThreadCreateOperation(ctx context.Context, req PrepareThreadCreateRequest) (ThreadCreateOperation, error) {
	if s == nil || s.db == nil {
		return ThreadCreateOperation{}, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	req.Settings.ThreadID = strings.TrimSpace(req.Settings.ThreadID)
	req.Settings.EndpointID = strings.TrimSpace(req.Settings.EndpointID)
	req.Settings.NamespacePublicID = strings.TrimSpace(req.Settings.NamespacePublicID)
	req.Settings.ModelID = strings.TrimSpace(req.Settings.ModelID)
	req.Settings.ReasoningSelectionJSON = strings.TrimSpace(req.Settings.ReasoningSelectionJSON)
	permissionType, err := canonicalPermissionType(req.Settings.PermissionType)
	if err != nil {
		return ThreadCreateOperation{}, err
	}
	req.Settings.PermissionType = permissionType
	req.Settings.WorkingDir = strings.TrimSpace(req.Settings.WorkingDir)
	req.Settings.CreatedByUserPublicID = strings.TrimSpace(req.Settings.CreatedByUserPublicID)
	req.Settings.CreatedByUserEmail = strings.TrimSpace(req.Settings.CreatedByUserEmail)
	req.Settings.UpdatedByUserPublicID = strings.TrimSpace(req.Settings.UpdatedByUserPublicID)
	req.Settings.UpdatedByUserEmail = strings.TrimSpace(req.Settings.UpdatedByUserEmail)
	req.ExplicitTitle = strings.TrimSpace(req.ExplicitTitle)
	if req.Settings.ThreadID == "" || req.Settings.EndpointID == "" {
		return ThreadCreateOperation{}, errors.New("invalid thread create request")
	}
	if req.OperationID = strings.TrimSpace(req.OperationID); req.OperationID == "" {
		req.OperationID = stableThreadCreateOperationID(req.Settings.EndpointID, req.Settings.ThreadID)
	}
	if req.CreatedAtMS <= 0 {
		req.CreatedAtMS = time.Now().UnixMilli()
	}
	snapshot := threadCreateSnapshotV1{SchemaVersion: ThreadCreateSnapshotSchemaVersion, Settings: req.Settings, ExplicitTitle: req.ExplicitTitle}
	snapshotJSON, err := json.Marshal(snapshot)
	if err != nil {
		return ThreadCreateOperation{}, err
	}
	sum := sha256.Sum256(snapshotJSON)
	fingerprint := hex.EncodeToString(sum[:])
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ThreadCreateOperation{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireThreadWritableTx(ctx, tx, req.Settings.EndpointID, req.Settings.ThreadID); err != nil {
		return ThreadCreateOperation{}, err
	}
	existing, err := loadThreadCreateOperationTx(ctx, tx, req.OperationID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return ThreadCreateOperation{}, err
	}
	if err == nil {
		if existing.RequestFingerprint != fingerprint || existing.EndpointID != req.Settings.EndpointID || existing.ThreadID != req.Settings.ThreadID {
			return ThreadCreateOperation{}, errors.New("thread create operation conflicts with existing request")
		}
		if err := tx.Commit(); err != nil {
			return ThreadCreateOperation{}, err
		}
		return existing, nil
	}
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(1) FROM ai_thread_settings WHERE endpoint_id = ? AND thread_id = ?`, req.Settings.EndpointID, req.Settings.ThreadID).Scan(&count); err != nil {
		return ThreadCreateOperation{}, err
	}
	if count != 0 {
		return ThreadCreateOperation{}, errors.New("thread settings already exist")
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO ai_thread_create_operations(
  operation_id, endpoint_id, thread_id, request_fingerprint, status,
  snapshot_schema_version, snapshot_json, created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
`, req.OperationID, req.Settings.EndpointID, req.Settings.ThreadID, fingerprint, ThreadCreateOperationPending, ThreadCreateSnapshotSchemaVersion, string(snapshotJSON), req.CreatedAtMS, req.CreatedAtMS); err != nil {
		return ThreadCreateOperation{}, err
	}
	operation, err := loadThreadCreateOperationTx(ctx, tx, req.OperationID)
	if err != nil {
		return ThreadCreateOperation{}, err
	}
	if err := tx.Commit(); err != nil {
		return ThreadCreateOperation{}, err
	}
	return operation, nil
}

func (s *Store) ConfirmThreadCreateFloretCreated(ctx context.Context, operationID string) (ThreadCreateOperation, error) {
	return s.confirmThreadCreateStep(ctx, operationID, "floret_created_at_unix_ms")
}

func (s *Store) ConfirmThreadCreateTitleSet(ctx context.Context, operationID string) (ThreadCreateOperation, error) {
	return s.confirmThreadCreateStep(ctx, operationID, "title_set_at_unix_ms")
}

func (s *Store) confirmThreadCreateStep(ctx context.Context, operationID, column string) (ThreadCreateOperation, error) {
	if s == nil || s.db == nil {
		return ThreadCreateOperation{}, errors.New("store not initialized")
	}
	if column != "floret_created_at_unix_ms" && column != "title_set_at_unix_ms" {
		return ThreadCreateOperation{}, errors.New("invalid thread create step")
	}
	now := time.Now().UnixMilli()
	if _, err := s.db.ExecContext(operationContext(ctx), fmt.Sprintf(`UPDATE ai_thread_create_operations SET %s = CASE WHEN %s = 0 THEN ? ELSE %s END, error_code = '', error_message = '', updated_at_unix_ms = ? WHERE operation_id = ? AND status = ?`, column, column, column), now, now, strings.TrimSpace(operationID), ThreadCreateOperationPending); err != nil {
		return ThreadCreateOperation{}, err
	}
	return s.GetThreadCreateOperation(ctx, operationID)
}

func (s *Store) CommitThreadCreateSettings(ctx context.Context, operationID string) (ThreadSettings, error) {
	if s == nil || s.db == nil {
		return ThreadSettings{}, errors.New("store not initialized")
	}
	tx, err := s.db.BeginTx(operationContext(ctx), nil)
	if err != nil {
		return ThreadSettings{}, err
	}
	defer func() { _ = tx.Rollback() }()
	operation, err := loadThreadCreateOperationTx(operationContext(ctx), tx, strings.TrimSpace(operationID))
	if err != nil {
		return ThreadSettings{}, err
	}
	if operation.Status == ThreadCreateOperationCommitted {
		settings, err := s.getThreadTx(operationContext(ctx), tx, operation.EndpointID, operation.ThreadID)
		if err != nil || settings == nil {
			return ThreadSettings{}, errors.New("committed thread create operation is missing settings")
		}
		if err := tx.Commit(); err != nil {
			return ThreadSettings{}, err
		}
		return *settings, nil
	}
	if operation.Status != ThreadCreateOperationPending || operation.FloretCreatedAtMS <= 0 {
		return ThreadSettings{}, errors.New("thread create settings commit requires canonical Floret thread")
	}
	if operation.ExplicitTitle != "" && operation.TitleSetAtMS <= 0 {
		return ThreadSettings{}, errors.New("thread create settings commit requires canonical title")
	}
	settings := operation.Settings
	if _, err := tx.ExecContext(operationContext(ctx), `
INSERT INTO ai_thread_settings(
  thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json,
  permission_type, working_dir, pinned_at_unix_ms, queue_revision,
  created_by_user_public_id, created_by_user_email, updated_by_user_public_id,
  updated_by_user_email, settings_created_at_unix_ms, settings_updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, settings.ThreadID, settings.EndpointID, settings.NamespacePublicID, settings.ModelID, settings.ReasoningSelectionJSON,
		settings.PermissionType, settings.WorkingDir, nonNegativeInt64(settings.PinnedAtUnixMs), nonNegativeInt64(settings.QueueRevision),
		settings.CreatedByUserPublicID, settings.CreatedByUserEmail, settings.UpdatedByUserPublicID, settings.UpdatedByUserEmail,
		settings.SettingsCreatedAtUnixMs, settings.SettingsUpdatedAtUnixMs); err != nil {
		return ThreadSettings{}, err
	}
	now := time.Now().UnixMilli()
	if _, err := tx.ExecContext(operationContext(ctx), `
UPDATE ai_thread_create_operations
SET status = ?, snapshot_json = '', settings_committed_at_unix_ms = ?, updated_at_unix_ms = ?, error_code = '', error_message = ''
WHERE operation_id = ? AND status = ?
`, ThreadCreateOperationCommitted, now, now, operation.OperationID, ThreadCreateOperationPending); err != nil {
		return ThreadSettings{}, err
	}
	if err := tx.Commit(); err != nil {
		return ThreadSettings{}, err
	}
	return settings, nil
}

func (s *Store) GetThreadCreateOperation(ctx context.Context, operationID string) (ThreadCreateOperation, error) {
	if s == nil || s.db == nil {
		return ThreadCreateOperation{}, errors.New("store not initialized")
	}
	return loadThreadCreateOperationRow(s.db.QueryRowContext(operationContext(ctx), threadCreateOperationSelectSQL+` WHERE operation_id = ?`, strings.TrimSpace(operationID)))
}

func (s *Store) ListPendingThreadCreateOperations(ctx context.Context, limit int) ([]ThreadCreateOperation, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	rows, err := s.db.QueryContext(operationContext(ctx), threadCreateOperationSelectSQL+` WHERE status = ? ORDER BY updated_at_unix_ms, operation_id LIMIT ?`, ThreadCreateOperationPending, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ThreadCreateOperation
	for rows.Next() {
		operation, err := loadThreadCreateOperationRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, operation)
	}
	return out, rows.Err()
}

func (s *Store) RecordThreadCreateRetry(ctx context.Context, operationID, code, message string) error {
	message = truncateRunes(message, 600)
	_, err := s.db.ExecContext(operationContext(ctx), `UPDATE ai_thread_create_operations SET retry_count = retry_count + 1, error_code = ?, error_message = ?, updated_at_unix_ms = ? WHERE operation_id = ? AND status = ?`, strings.TrimSpace(code), strings.TrimSpace(message), time.Now().UnixMilli(), strings.TrimSpace(operationID), ThreadCreateOperationPending)
	return err
}

const threadCreateOperationSelectSQL = `
SELECT operation_id, endpoint_id, thread_id, request_fingerprint, status,
       snapshot_schema_version, snapshot_json, floret_created_at_unix_ms,
       title_set_at_unix_ms, settings_committed_at_unix_ms, retry_count,
       error_code, error_message, created_at_unix_ms, updated_at_unix_ms
FROM ai_thread_create_operations`

func loadThreadCreateOperationTx(ctx context.Context, tx *sql.Tx, operationID string) (ThreadCreateOperation, error) {
	return loadThreadCreateOperationRow(tx.QueryRowContext(ctx, threadCreateOperationSelectSQL+` WHERE operation_id = ?`, operationID))
}

func loadThreadCreateOperationRow(scanner rowScanner) (ThreadCreateOperation, error) {
	var operation ThreadCreateOperation
	if err := scanner.Scan(
		&operation.OperationID, &operation.EndpointID, &operation.ThreadID, &operation.RequestFingerprint,
		&operation.Status, &operation.SnapshotSchemaVersion, &operation.SnapshotJSON,
		&operation.FloretCreatedAtMS, &operation.TitleSetAtMS, &operation.SettingsCommittedAtMS,
		&operation.RetryCount, &operation.ErrorCode, &operation.ErrorMessage, &operation.CreatedAtMS, &operation.UpdatedAtMS,
	); err != nil {
		return ThreadCreateOperation{}, err
	}
	switch operation.Status {
	case ThreadCreateOperationCommitted:
		if strings.TrimSpace(operation.SnapshotJSON) == "" {
			return operation, nil
		}
	case ThreadCreateOperationPending, ThreadCreateOperationFailed:
		if strings.TrimSpace(operation.SnapshotJSON) == "" {
			return ThreadCreateOperation{}, errors.New("thread create operation snapshot is empty")
		}
	default:
		return ThreadCreateOperation{}, fmt.Errorf("unsupported thread create operation status %q", operation.Status)
	}
	if operation.SnapshotSchemaVersion != ThreadCreateSnapshotSchemaVersion {
		return ThreadCreateOperation{}, fmt.Errorf("unsupported thread create snapshot schema %d", operation.SnapshotSchemaVersion)
	}
	var snapshot threadCreateSnapshotV1
	if err := decodeStrictJSON(operation.SnapshotJSON, &snapshot); err != nil {
		return ThreadCreateOperation{}, fmt.Errorf("decode thread create operation snapshot: %w", err)
	}
	if snapshot.SchemaVersion != ThreadCreateSnapshotSchemaVersion ||
		snapshot.Settings.EndpointID != operation.EndpointID ||
		snapshot.Settings.ThreadID != operation.ThreadID {
		return ThreadCreateOperation{}, errors.New("thread create operation snapshot identity mismatch")
	}
	permissionType, err := canonicalPermissionType(snapshot.Settings.PermissionType)
	if err != nil || permissionType != snapshot.Settings.PermissionType {
		return ThreadCreateOperation{}, errors.New("thread create operation snapshot has invalid permission type")
	}
	sum := sha256.Sum256([]byte(operation.SnapshotJSON))
	if operation.RequestFingerprint == "" || operation.RequestFingerprint != hex.EncodeToString(sum[:]) {
		return ThreadCreateOperation{}, errors.New("thread create operation snapshot fingerprint mismatch")
	}
	operation.Settings = snapshot.Settings
	operation.ExplicitTitle = strings.TrimSpace(snapshot.ExplicitTitle)
	return operation, nil
}

func operationContext(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	return ctx
}
