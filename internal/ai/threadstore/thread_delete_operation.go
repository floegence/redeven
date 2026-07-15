package threadstore

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

const (
	ThreadDeleteSnapshotSchemaV1 = 1

	ThreadDeleteOperationPending   = "pending"
	ThreadDeleteOperationCommitted = "committed"
	ThreadDeleteOperationFailed    = "failed"
)

var ErrThreadIDRetired = errors.New("thread id retired")

type ThreadDeleteSnapshotV1 struct {
	SchemaVersion         int      `json:"schema_version"`
	CheckpointIDs         []string `json:"checkpoint_ids"`
	UploadCleanupIDs      []string `json:"upload_cleanup_ids"`
	DeleteFlowerReadState bool     `json:"delete_flower_read_state"`
}

type ThreadDeleteOperation struct {
	OperationID                string
	EndpointID                 string
	ThreadID                   string
	Status                     string
	Snapshot                   ThreadDeleteSnapshotV1
	SnapshotValid              bool
	SnapshotErrorCode          string
	ProductDataDeletedAtUnixMs int64
	FilesCleanedAtUnixMs       int64
	FloretDeletedAtUnixMs      int64
	ReadStateDeletedAtUnixMs   int64
	RetryCount                 int
	ErrorCode                  string
	ErrorMessage               string
	CreatedAtUnixMs            int64
	UpdatedAtUnixMs            int64
	CommittedAtUnixMs          int64
}

func stableThreadDeleteOperationID(endpointID string, threadID string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(endpointID) + "\x00" + strings.TrimSpace(threadID)))
	return "thread_delete_" + hex.EncodeToString(sum[:12])
}

func (s *Store) PrepareThreadDeleteOperation(ctx context.Context, endpointID string, threadID string, deleteFlowerReadState bool) (ThreadDeleteOperation, error) {
	if s == nil || s.db == nil {
		return ThreadDeleteOperation{}, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return ThreadDeleteOperation{}, errors.New("invalid request")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ThreadDeleteOperation{}, err
	}
	defer func() { _ = tx.Rollback() }()

	existing, err := loadThreadDeleteOperationByThreadTx(ctx, tx, endpointID, threadID)
	if err != nil {
		return ThreadDeleteOperation{}, err
	}
	if existing != nil {
		return *existing, tx.Commit()
	}
	thread, err := s.getThreadTx(ctx, tx, endpointID, threadID)
	if err != nil {
		return ThreadDeleteOperation{}, err
	}
	if thread == nil {
		return ThreadDeleteOperation{}, sql.ErrNoRows
	}
	checkpointIDs, err := listThreadCheckpointIDsTx(ctx, tx, endpointID, threadID)
	if err != nil {
		return ThreadDeleteOperation{}, err
	}
	now := time.Now().UnixMilli()
	uploads, err := prepareUploadCleanupForThreadTx(ctx, tx, endpointID, threadID, now)
	if err != nil {
		return ThreadDeleteOperation{}, err
	}
	uploadIDs := make([]string, 0, len(uploads))
	for _, upload := range uploads {
		uploadIDs = append(uploadIDs, strings.TrimSpace(upload.UploadID))
	}
	snapshot := ThreadDeleteSnapshotV1{
		SchemaVersion:         ThreadDeleteSnapshotSchemaV1,
		CheckpointIDs:         dedupeNonEmptyStrings(checkpointIDs),
		UploadCleanupIDs:      dedupeNonEmptyStrings(uploadIDs),
		DeleteFlowerReadState: deleteFlowerReadState,
	}
	snapshotJSON, err := json.Marshal(snapshot)
	if err != nil {
		return ThreadDeleteOperation{}, err
	}
	if err := deleteThreadScopedRowsTx(ctx, tx, endpointID, threadID); err != nil {
		return ThreadDeleteOperation{}, err
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM ai_threads WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID)
	if err != nil {
		return ThreadDeleteOperation{}, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return ThreadDeleteOperation{}, sql.ErrNoRows
	}
	operationID := stableThreadDeleteOperationID(endpointID, threadID)
	if _, err := tx.ExecContext(ctx, `
INSERT INTO ai_thread_delete_operations(
  operation_id, endpoint_id, thread_id, status, snapshot_schema_version, snapshot_json,
  read_state_required, product_data_deleted_at_unix_ms, created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, operationID, endpointID, threadID, ThreadDeleteOperationPending, ThreadDeleteSnapshotSchemaV1, string(snapshotJSON), boolToInt(deleteFlowerReadState), now, now, now); err != nil {
		return ThreadDeleteOperation{}, err
	}
	operation, err := loadThreadDeleteOperationByIDTx(ctx, tx, operationID)
	if err != nil {
		return ThreadDeleteOperation{}, err
	}
	if operation == nil {
		return ThreadDeleteOperation{}, errors.New("thread delete operation missing after insert")
	}
	if err := tx.Commit(); err != nil {
		return ThreadDeleteOperation{}, err
	}
	return *operation, nil
}

func (s *Store) GetThreadDeleteOperation(ctx context.Context, endpointID string, threadID string) (*ThreadDeleteOperation, error) {
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
	return scanThreadDeleteOperation(s.db.QueryRowContext(ctx, threadDeleteOperationSelectSQL+` WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID))
}

func (s *Store) ListPendingThreadDeleteOperations(ctx context.Context, limit int) ([]ThreadDeleteOperation, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	rows, err := s.db.QueryContext(ctx, threadDeleteOperationSelectSQL+` WHERE status = ? ORDER BY updated_at_unix_ms ASC, operation_id ASC LIMIT ?`, ThreadDeleteOperationPending, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ThreadDeleteOperation, 0, limit)
	for rows.Next() {
		operation, err := scanThreadDeleteOperation(rows)
		if err != nil {
			return nil, err
		}
		if operation != nil {
			out = append(out, *operation)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) ConfirmThreadDeleteFilesCleaned(ctx context.Context, operationID string) (ThreadDeleteOperation, error) {
	return s.confirmThreadDeleteStep(ctx, operationID, "files_cleaned_at_unix_ms")
}

func (s *Store) ConfirmThreadDeleteFloretDeleted(ctx context.Context, operationID string) (ThreadDeleteOperation, error) {
	return s.confirmThreadDeleteStep(ctx, operationID, "floret_deleted_at_unix_ms")
}

func (s *Store) ConfirmThreadDeleteReadStateDeleted(ctx context.Context, operationID string) (ThreadDeleteOperation, error) {
	return s.confirmThreadDeleteStep(ctx, operationID, "read_state_deleted_at_unix_ms")
}

func (s *Store) confirmThreadDeleteStep(ctx context.Context, operationID string, column string) (ThreadDeleteOperation, error) {
	if s == nil || s.db == nil {
		return ThreadDeleteOperation{}, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	operationID = strings.TrimSpace(operationID)
	if operationID == "" {
		return ThreadDeleteOperation{}, errors.New("missing operation_id")
	}
	switch column {
	case "files_cleaned_at_unix_ms", "floret_deleted_at_unix_ms", "read_state_deleted_at_unix_ms":
	default:
		return ThreadDeleteOperation{}, errors.New("invalid thread delete step")
	}
	now := time.Now().UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ThreadDeleteOperation{}, err
	}
	defer func() { _ = tx.Rollback() }()
	query := fmt.Sprintf(`UPDATE ai_thread_delete_operations SET %s = CASE WHEN %s <= 0 THEN ? ELSE %s END, error_code = '', error_message = '', updated_at_unix_ms = ? WHERE operation_id = ? AND status = ?`, column, column, column)
	if _, err := tx.ExecContext(ctx, query, now, now, operationID, ThreadDeleteOperationPending); err != nil {
		return ThreadDeleteOperation{}, err
	}
	if _, err := tx.ExecContext(ctx, `
UPDATE ai_thread_delete_operations
SET status = ?, committed_at_unix_ms = CASE WHEN committed_at_unix_ms <= 0 THEN ? ELSE committed_at_unix_ms END,
    updated_at_unix_ms = ?
WHERE operation_id = ? AND status = ?
  AND product_data_deleted_at_unix_ms > 0
  AND files_cleaned_at_unix_ms > 0
  AND floret_deleted_at_unix_ms > 0
  AND (read_state_required = 0 OR read_state_deleted_at_unix_ms > 0)
`, ThreadDeleteOperationCommitted, now, now, operationID, ThreadDeleteOperationPending); err != nil {
		return ThreadDeleteOperation{}, err
	}
	operation, err := loadThreadDeleteOperationByIDTx(ctx, tx, operationID)
	if err != nil {
		return ThreadDeleteOperation{}, err
	}
	if operation == nil {
		return ThreadDeleteOperation{}, sql.ErrNoRows
	}
	if err := tx.Commit(); err != nil {
		return ThreadDeleteOperation{}, err
	}
	return *operation, nil
}

func (s *Store) RecordThreadDeleteRetry(ctx context.Context, operationID string, errorCode string, errorMessage string) (ThreadDeleteOperation, error) {
	return s.recordThreadDeleteError(ctx, operationID, ThreadDeleteOperationPending, true, errorCode, errorMessage)
}

func (s *Store) MarkThreadDeleteFailed(ctx context.Context, operationID string, errorCode string, errorMessage string) (ThreadDeleteOperation, error) {
	return s.recordThreadDeleteError(ctx, operationID, ThreadDeleteOperationFailed, false, errorCode, errorMessage)
}

func (s *Store) recordThreadDeleteError(ctx context.Context, operationID string, status string, incrementRetry bool, errorCode string, errorMessage string) (ThreadDeleteOperation, error) {
	if s == nil || s.db == nil {
		return ThreadDeleteOperation{}, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	operationID = strings.TrimSpace(operationID)
	if operationID == "" {
		return ThreadDeleteOperation{}, errors.New("missing operation_id")
	}
	errorCode = strings.TrimSpace(errorCode)
	errorMessage = strings.TrimSpace(errorMessage)
	if len(errorMessage) > 600 {
		errorMessage = truncateRunes(errorMessage, 600)
	}
	now := time.Now().UnixMilli()
	retryIncrement := 0
	if incrementRetry {
		retryIncrement = 1
	}
	if _, err := s.db.ExecContext(ctx, `
UPDATE ai_thread_delete_operations
SET status = ?, retry_count = retry_count + ?, error_code = ?, error_message = ?, updated_at_unix_ms = ?
WHERE operation_id = ? AND status = ?
`, status, retryIncrement, errorCode, errorMessage, now, operationID, ThreadDeleteOperationPending); err != nil {
		return ThreadDeleteOperation{}, err
	}
	operation, err := scanThreadDeleteOperation(s.db.QueryRowContext(ctx, threadDeleteOperationSelectSQL+` WHERE operation_id = ?`, operationID))
	if err != nil {
		return ThreadDeleteOperation{}, err
	}
	if operation == nil {
		return ThreadDeleteOperation{}, sql.ErrNoRows
	}
	return *operation, nil
}

const threadDeleteOperationSelectSQL = `
SELECT operation_id, endpoint_id, thread_id, status, snapshot_schema_version, snapshot_json,
       read_state_required, product_data_deleted_at_unix_ms, files_cleaned_at_unix_ms,
       floret_deleted_at_unix_ms, read_state_deleted_at_unix_ms, retry_count, error_code,
       error_message, created_at_unix_ms, updated_at_unix_ms, committed_at_unix_ms
FROM ai_thread_delete_operations`

func loadThreadDeleteOperationByThreadTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) (*ThreadDeleteOperation, error) {
	return scanThreadDeleteOperation(tx.QueryRowContext(ctx, threadDeleteOperationSelectSQL+` WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID))
}

func loadThreadDeleteOperationByIDTx(ctx context.Context, tx *sql.Tx, operationID string) (*ThreadDeleteOperation, error) {
	return scanThreadDeleteOperation(tx.QueryRowContext(ctx, threadDeleteOperationSelectSQL+` WHERE operation_id = ?`, operationID))
}

func scanThreadDeleteOperation(scanner rowScanner) (*ThreadDeleteOperation, error) {
	var operation ThreadDeleteOperation
	var snapshotSchemaVersion int
	var snapshotJSON string
	var readStateRequired int
	if err := scanner.Scan(
		&operation.OperationID,
		&operation.EndpointID,
		&operation.ThreadID,
		&operation.Status,
		&snapshotSchemaVersion,
		&snapshotJSON,
		&readStateRequired,
		&operation.ProductDataDeletedAtUnixMs,
		&operation.FilesCleanedAtUnixMs,
		&operation.FloretDeletedAtUnixMs,
		&operation.ReadStateDeletedAtUnixMs,
		&operation.RetryCount,
		&operation.ErrorCode,
		&operation.ErrorMessage,
		&operation.CreatedAtUnixMs,
		&operation.UpdatedAtUnixMs,
		&operation.CommittedAtUnixMs,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	operation.SnapshotValid = true
	if snapshotSchemaVersion != ThreadDeleteSnapshotSchemaV1 {
		operation.SnapshotValid = false
		operation.SnapshotErrorCode = "unsupported_snapshot_schema"
		return &operation, nil
	}
	if err := json.Unmarshal([]byte(snapshotJSON), &operation.Snapshot); err != nil {
		operation.SnapshotValid = false
		operation.SnapshotErrorCode = "invalid_snapshot_json"
		return &operation, nil
	}
	if operation.Snapshot.SchemaVersion != ThreadDeleteSnapshotSchemaV1 ||
		operation.Snapshot.DeleteFlowerReadState != (readStateRequired != 0) ||
		!validThreadDeleteSnapshotIDs(operation.Snapshot.CheckpointIDs) ||
		!validThreadDeleteSnapshotIDs(operation.Snapshot.UploadCleanupIDs) {
		operation.SnapshotValid = false
		operation.SnapshotErrorCode = "invalid_snapshot_contract"
	}
	return &operation, nil
}

func validThreadDeleteSnapshotIDs(ids []string) bool {
	seen := make(map[string]struct{}, len(ids))
	for _, raw := range ids {
		id := strings.TrimSpace(raw)
		if id == "" || id != raw || filepath.Base(id) != id || id == "." {
			return false
		}
		if _, exists := seen[id]; exists {
			return false
		}
		seen[id] = struct{}{}
	}
	return true
}
