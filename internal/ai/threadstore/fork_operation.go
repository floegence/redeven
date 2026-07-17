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
)

const ForkSnapshotSchemaVersion = 2

type ForkOperationStatus string

const (
	ForkOperationPending   ForkOperationStatus = "pending"
	ForkOperationCommitted ForkOperationStatus = "committed"
	ForkOperationFailed    ForkOperationStatus = "failed"
)

var (
	ErrForkOperationConflict   = errors.New("thread fork operation conflicts with existing request")
	ErrForkDestinationConflict = errors.New("thread fork destination conflicts with existing operation")
	ErrForkOperationFailed     = errors.New("thread fork operation is failed")
	ErrForkResultConflict      = errors.New("thread fork result conflicts with source snapshot")
)

type ForkOperation struct {
	OperationID                    string
	EndpointID                     string
	SourceThreadID                 string
	DestinationThreadID            string
	RequestFingerprint             string
	Status                         ForkOperationStatus
	SnapshotSchemaVersion          int
	SnapshotJSON                   string
	RetryCount                     int
	ErrorCode                      string
	ErrorMessage                   string
	SourceBroadcastedAtUnixMs      int64
	DestinationBroadcastedAtUnixMs int64
	CreatedAtUnixMs                int64
	UpdatedAtUnixMs                int64
}

type CommitForkOperationRequest struct {
	OperationID     string
	FloretTurnRefs  []ForkTurnRef
	UpdatedAtUnixMs int64
}

type forkSnapshotV2 struct {
	SchemaVersion  int                     `json:"schema_version"`
	Request        forkSnapshotRequest     `json:"request"`
	SourceThread   Thread                  `json:"source_thread"`
	UploadRefs     []forkSnapshotUploadRef `json:"upload_refs"`
	FlowerMetadata *FlowerThreadMetadata   `json:"flower_metadata,omitempty"`
}

type forkSnapshotRequest struct {
	EndpointID            string `json:"endpoint_id"`
	SourceThreadID        string `json:"source_thread_id"`
	DestinationThreadID   string `json:"destination_thread_id"`
	Title                 string `json:"title"`
	CreatedByUserPublicID string `json:"created_by_user_public_id"`
	CreatedByUserEmail    string `json:"created_by_user_email"`
	CreatedAtUnixMs       int64  `json:"created_at_unix_ms"`
}

type forkSnapshotUploadRef struct {
	UploadID        string `json:"upload_id"`
	RefKind         string `json:"ref_kind"`
	RefID           string `json:"ref_id"`
	CreatedAtUnixMs int64  `json:"created_at_unix_ms"`
}

func (s *Store) PrepareForkOperation(ctx context.Context, req ForkThreadRequest) (*ForkOperation, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := normalizeForkThreadRequest(&req); err != nil {
		return nil, err
	}
	fingerprint, err := forkRequestFingerprint(req)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	if existing, err := loadForkOperationTx(ctx, tx, req.OperationID); err == nil {
		if existing.RequestFingerprint != fingerprint {
			return nil, ErrForkOperationConflict
		}
		return existing, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	var destinationCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(1) FROM ai_threads WHERE endpoint_id = ? AND thread_id = ?`, req.EndpointID, req.DestinationThreadID).Scan(&destinationCount); err != nil {
		return nil, err
	}
	if destinationCount != 0 {
		return nil, ErrForkDestinationConflict
	}
	snapshot, err := captureForkSnapshotV2(ctx, tx, req)
	if err != nil {
		return nil, err
	}
	snapshotJSON, err := json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO ai_thread_fork_operations(
  operation_id, endpoint_id, source_thread_id, destination_thread_id,
  request_fingerprint, status, snapshot_schema_version, snapshot_json,
  created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, req.OperationID, req.EndpointID, req.SourceThreadID, req.DestinationThreadID,
		fingerprint, string(ForkOperationPending), ForkSnapshotSchemaVersion, string(snapshotJSON), req.CreatedAtUnixMs, req.CreatedAtUnixMs)
	if err != nil {
		if isUniqueConstraintError(err) {
			return nil, ErrForkDestinationConflict
		}
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &ForkOperation{
		OperationID: req.OperationID, EndpointID: req.EndpointID, SourceThreadID: req.SourceThreadID,
		DestinationThreadID: req.DestinationThreadID, RequestFingerprint: fingerprint,
		Status: ForkOperationPending, SnapshotSchemaVersion: ForkSnapshotSchemaVersion,
		SnapshotJSON: string(snapshotJSON), CreatedAtUnixMs: req.CreatedAtUnixMs, UpdatedAtUnixMs: req.CreatedAtUnixMs,
	}, nil
}

func (s *Store) CommitForkOperation(ctx context.Context, req CommitForkOperationRequest) (*Thread, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	req.OperationID = strings.TrimSpace(req.OperationID)
	if req.OperationID == "" || req.UpdatedAtUnixMs <= 0 {
		return nil, errors.New("invalid fork commit request")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	operation, err := loadForkOperationTx(ctx, tx, req.OperationID)
	if err != nil {
		return nil, err
	}
	switch operation.Status {
	case ForkOperationCommitted:
		return loadForkDestinationThreadTx(ctx, tx, operation)
	case ForkOperationFailed:
		return nil, fmt.Errorf("%w: %s", ErrForkOperationFailed, strings.TrimSpace(operation.ErrorMessage))
	case ForkOperationPending:
	default:
		return nil, fmt.Errorf("unsupported fork operation status %q", operation.Status)
	}
	var snapshot forkSnapshotV2
	if operation.SnapshotSchemaVersion != ForkSnapshotSchemaVersion || json.Unmarshal([]byte(operation.SnapshotJSON), &snapshot) != nil {
		return nil, fmt.Errorf("unsupported fork snapshot schema %d", operation.SnapshotSchemaVersion)
	}
	if err := validateForkSnapshot(operation, snapshot); err != nil {
		return nil, err
	}
	if err := materializeForkSnapshotV2(ctx, tx, snapshot, req.FloretTurnRefs); err != nil {
		return nil, err
	}
	result, err := tx.ExecContext(ctx, `
UPDATE ai_thread_fork_operations
SET status = ?, snapshot_json = '', error_code = '', error_message = '', updated_at_unix_ms = ?
WHERE operation_id = ? AND status = ?
`, string(ForkOperationCommitted), req.UpdatedAtUnixMs, req.OperationID, string(ForkOperationPending))
	if err != nil {
		return nil, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return nil, ErrForkOperationConflict
	}
	out, err := loadForkDestinationThreadTx(ctx, tx, operation)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) ListPendingForkOperations(ctx context.Context, limit int) ([]ForkOperation, error) {
	return s.listForkOperations(ctx, `status = ?`, []any{string(ForkOperationPending)}, limit)
}

func (s *Store) ListUnbroadcastCommittedForkOperations(ctx context.Context, limit int) ([]ForkOperation, error) {
	return s.listForkOperations(ctx, `status = ? AND (source_broadcasted_at_unix_ms = 0 OR destination_broadcasted_at_unix_ms = 0)`, []any{string(ForkOperationCommitted)}, limit)
}

func (s *Store) listForkOperations(ctx context.Context, where string, args []any, limit int) ([]ForkOperation, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, forkOperationSelectSQL+` WHERE `+where+` ORDER BY updated_at_unix_ms ASC, operation_id ASC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ForkOperation, 0)
	for rows.Next() {
		var operation ForkOperation
		if err := scanForkOperation(rows, &operation); err != nil {
			return nil, err
		}
		out = append(out, operation)
	}
	return out, rows.Err()
}

func (s *Store) GetForkOperation(ctx context.Context, operationID string) (*ForkOperation, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	return loadForkOperationRow(s.db.QueryRowContext(ctx, forkOperationSelectSQL+` WHERE operation_id = ?`, strings.TrimSpace(operationID)))
}

func (s *Store) RecordForkOperationFailure(ctx context.Context, operationID, code, message string, terminal bool, updatedAtUnixMs int64) error {
	status := ForkOperationPending
	if terminal {
		status = ForkOperationFailed
	}
	result, err := s.db.ExecContext(ctx, `UPDATE ai_thread_fork_operations SET status = ?, retry_count = retry_count + 1, error_code = ?, error_message = ?, updated_at_unix_ms = ? WHERE operation_id = ? AND status = ?`, string(status), strings.TrimSpace(code), strings.TrimSpace(message), updatedAtUnixMs, strings.TrimSpace(operationID), string(ForkOperationPending))
	if err != nil {
		return err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return ErrForkOperationConflict
	}
	return nil
}

func (s *Store) MarkForkOperationBroadcasted(ctx context.Context, operationID string, source bool, atUnixMs int64) error {
	column := "destination_broadcasted_at_unix_ms"
	if source {
		column = "source_broadcasted_at_unix_ms"
	}
	result, err := s.db.ExecContext(ctx, `UPDATE ai_thread_fork_operations SET `+column+` = ?, updated_at_unix_ms = ? WHERE operation_id = ? AND status = ? AND `+column+` = 0`, atUnixMs, atUnixMs, strings.TrimSpace(operationID), string(ForkOperationCommitted))
	if err != nil {
		return err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		operation, loadErr := s.GetForkOperation(ctx, operationID)
		if loadErr != nil || operation == nil || operation.Status != ForkOperationCommitted {
			return ErrForkOperationConflict
		}
	}
	return nil
}

const forkOperationSelectSQL = `SELECT operation_id, endpoint_id, source_thread_id, destination_thread_id, request_fingerprint, status, snapshot_schema_version, snapshot_json, retry_count, error_code, error_message, source_broadcasted_at_unix_ms, destination_broadcasted_at_unix_ms, created_at_unix_ms, updated_at_unix_ms FROM ai_thread_fork_operations`

func scanForkOperation(scanner interface{ Scan(...any) error }, operation *ForkOperation) error {
	var status string
	if err := scanner.Scan(&operation.OperationID, &operation.EndpointID, &operation.SourceThreadID, &operation.DestinationThreadID, &operation.RequestFingerprint, &status, &operation.SnapshotSchemaVersion, &operation.SnapshotJSON, &operation.RetryCount, &operation.ErrorCode, &operation.ErrorMessage, &operation.SourceBroadcastedAtUnixMs, &operation.DestinationBroadcastedAtUnixMs, &operation.CreatedAtUnixMs, &operation.UpdatedAtUnixMs); err != nil {
		return err
	}
	operation.Status = ForkOperationStatus(status)
	return nil
}

func loadForkOperationRow(scanner interface{ Scan(...any) error }) (*ForkOperation, error) {
	var operation ForkOperation
	if err := scanForkOperation(scanner, &operation); err != nil {
		return nil, err
	}
	return &operation, nil
}

func loadForkOperationTx(ctx context.Context, tx *sql.Tx, operationID string) (*ForkOperation, error) {
	return loadForkOperationRow(tx.QueryRowContext(ctx, forkOperationSelectSQL+` WHERE operation_id = ?`, strings.TrimSpace(operationID)))
}

func loadForkDestinationThreadTx(ctx context.Context, tx *sql.Tx, operation *ForkOperation) (*Thread, error) {
	var thread Thread
	if err := scanThreadRow(tx.QueryRowContext(ctx, fmt.Sprintf(`SELECT %s FROM ai_threads WHERE endpoint_id = ? AND thread_id = ?`, threadSelectColumnsSQL), operation.EndpointID, operation.DestinationThreadID), &thread); err != nil {
		return nil, err
	}
	return &thread, nil
}

func normalizeForkThreadRequest(req *ForkThreadRequest) error {
	req.OperationID = strings.TrimSpace(req.OperationID)
	req.EndpointID = strings.TrimSpace(req.EndpointID)
	req.SourceThreadID = strings.TrimSpace(req.SourceThreadID)
	req.DestinationThreadID = strings.TrimSpace(req.DestinationThreadID)
	req.Title = strings.TrimSpace(req.Title)
	req.CreatedByUserPublicID = strings.TrimSpace(req.CreatedByUserPublicID)
	req.CreatedByUserEmail = strings.TrimSpace(req.CreatedByUserEmail)
	if req.OperationID == "" || req.EndpointID == "" || req.SourceThreadID == "" || req.DestinationThreadID == "" || req.SourceThreadID == req.DestinationThreadID || req.CreatedAtUnixMs <= 0 {
		return errors.New("invalid fork request")
	}
	return nil
}

func forkRequestFingerprint(req ForkThreadRequest) (string, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:]), nil
}

func captureForkSnapshotV2(ctx context.Context, tx *sql.Tx, req ForkThreadRequest) (forkSnapshotV2, error) {
	var source Thread
	if err := scanThreadRow(tx.QueryRowContext(ctx, fmt.Sprintf(`SELECT %s FROM ai_threads WHERE endpoint_id = ? AND thread_id = ?`, threadSelectColumnsSQL), req.EndpointID, req.SourceThreadID), &source); err != nil {
		return forkSnapshotV2{}, err
	}
	if req.Title == "" {
		req.Title = strings.TrimSpace(source.Title)
	}
	snapshot := forkSnapshotV2{SchemaVersion: ForkSnapshotSchemaVersion, Request: forkSnapshotRequest{
		EndpointID: req.EndpointID, SourceThreadID: req.SourceThreadID, DestinationThreadID: req.DestinationThreadID,
		Title: req.Title, CreatedByUserPublicID: req.CreatedByUserPublicID, CreatedByUserEmail: req.CreatedByUserEmail, CreatedAtUnixMs: req.CreatedAtUnixMs,
	}, SourceThread: source}
	rows, err := tx.QueryContext(ctx, `SELECT upload_id, ref_kind, ref_id, created_at_unix_ms FROM ai_upload_refs WHERE endpoint_id = ? AND thread_id = ? ORDER BY id ASC`, req.EndpointID, req.SourceThreadID)
	if err != nil {
		return forkSnapshotV2{}, err
	}
	for rows.Next() {
		var ref forkSnapshotUploadRef
		if err := rows.Scan(&ref.UploadID, &ref.RefKind, &ref.RefID, &ref.CreatedAtUnixMs); err != nil {
			_ = rows.Close()
			return forkSnapshotV2{}, err
		}
		snapshot.UploadRefs = append(snapshot.UploadRefs, ref)
	}
	if err := rows.Close(); err != nil {
		return forkSnapshotV2{}, err
	}
	var metadata FlowerThreadMetadata
	err = tx.QueryRowContext(ctx, `
SELECT endpoint_id, thread_id, owner_kind, owner_id, parent_thread_id, parent_run_id,
       context_json, action_json, updated_at_unix_ms, home_runtime_id, home_runtime_kind,
       origin_env_public_id, primary_target_id, active_target_ids_json
FROM ai_flower_thread_metadata
WHERE endpoint_id = ? AND thread_id = ?
`, req.EndpointID, req.SourceThreadID).Scan(
		&metadata.EndpointID, &metadata.ThreadID, &metadata.OwnerKind, &metadata.OwnerID,
		&metadata.ParentThreadID, &metadata.ParentRunID, &metadata.ContextJSON, &metadata.ActionJSON,
		&metadata.UpdatedAtUnixMs, &metadata.HomeRuntimeID, &metadata.HomeRuntimeKind,
		&metadata.OriginEnvPublicID, &metadata.PrimaryTargetID, &metadata.ActiveTargetIDsJSON,
	)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return forkSnapshotV2{}, err
	}
	if err == nil {
		snapshot.FlowerMetadata = &metadata
	}
	return snapshot, nil
}

func validateForkSnapshot(operation *ForkOperation, snapshot forkSnapshotV2) error {
	if snapshot.SchemaVersion != ForkSnapshotSchemaVersion || snapshot.Request.EndpointID != operation.EndpointID || snapshot.Request.SourceThreadID != operation.SourceThreadID || snapshot.Request.DestinationThreadID != operation.DestinationThreadID || snapshot.SourceThread.ThreadID != operation.SourceThreadID {
		return errors.New("fork snapshot identity mismatch")
	}
	return nil
}

func materializeForkSnapshotV2(ctx context.Context, tx *sql.Tx, snapshot forkSnapshotV2, refs []ForkTurnRef) error {
	req := ForkThreadRequest{
		EndpointID: snapshot.Request.EndpointID, SourceThreadID: snapshot.Request.SourceThreadID,
		DestinationThreadID: snapshot.Request.DestinationThreadID, Title: snapshot.Request.Title,
		CreatedByUserPublicID: snapshot.Request.CreatedByUserPublicID, CreatedByUserEmail: snapshot.Request.CreatedByUserEmail,
		CreatedAtUnixMs: snapshot.Request.CreatedAtUnixMs,
	}
	if err := insertForkedThreadTx(ctx, tx, req, snapshot.SourceThread, snapshot.Request.Title); err != nil {
		return err
	}
	rewrite, err := forkTurnRefsBySource(refs)
	if err != nil {
		return err
	}
	for _, ref := range snapshot.UploadRefs {
		mapping, ok := rewrite[strings.TrimSpace(ref.RefID)]
		if !ok {
			continue
		}
		destinationID := mapping.DestinationTurnID
		if strings.TrimSpace(ref.RefID) == mapping.SourceRunID {
			destinationID = mapping.DestinationRunID
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint_id, upload_id, ref_kind, ref_id) DO NOTHING`, req.EndpointID, strings.TrimSpace(ref.UploadID), req.DestinationThreadID, normalizeUploadRefKind(ref.RefKind), destinationID, ref.CreatedAtUnixMs); err != nil {
			return err
		}
	}
	if snapshot.FlowerMetadata != nil {
		metadata := *snapshot.FlowerMetadata
		metadata.ThreadID = req.DestinationThreadID
		metadata.ParentThreadID = req.SourceThreadID
		metadata.ParentRunID = ""
		metadata.UpdatedAtUnixMs = req.CreatedAtUnixMs
		if err := upsertFlowerThreadMetadataExec(ctx, tx, metadata); err != nil {
			return err
		}
	}
	return nil
}
