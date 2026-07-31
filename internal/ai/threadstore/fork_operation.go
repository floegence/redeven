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

const ForkSnapshotSchemaVersion = 1

type ForkOperationStage string

const (
	ForkStagePrepared            ForkOperationStage = "prepared"
	ForkStageFloretForked        ForkOperationStage = "floret_forked"
	ForkStageProductMaterialized ForkOperationStage = "product_materialized"
	ForkStageTitleApplied        ForkOperationStage = "title_applied"
	ForkStageTitleSkipped        ForkOperationStage = "title_skipped"
	ForkStageCompleted           ForkOperationStage = "completed"
	ForkStageFailed              ForkOperationStage = "failed"
)

var (
	ErrForkOperationConflict     = errors.New("thread fork operation conflicts with existing request")
	ErrForkDestinationConflict   = errors.New("thread fork destination conflicts with existing operation")
	ErrForkOperationFailed       = errors.New("thread fork operation is failed")
	ErrForkResultConflict        = errors.New("thread fork result conflicts with source snapshot")
	ErrThreadOperationInProgress = errors.New("thread lifecycle operation is in progress")
)

type ForkOperation struct {
	OperationID                    string
	EndpointID                     string
	ClientRequestID                string
	LogicalRequestID               string
	TitleLogicalRequestID          string
	SourceThreadID                 string
	DestinationThreadID            string
	RequestFingerprint             string
	Stage                          ForkOperationStage
	SnapshotSchemaVersion          int
	SnapshotJSON                   string
	SnapshotFingerprint            string
	RetryCount                     int
	ErrorCode                      string
	ErrorMessage                   string
	SourceBroadcastedAtUnixMs      int64
	DestinationBroadcastedAtUnixMs int64
	CreatedAtUnixMs                int64
	UpdatedAtUnixMs                int64
	RequestedTitle                 string
}

type CommitForkOperationRequest struct {
	OperationID     string
	UpdatedAtUnixMs int64
}

type forkSnapshot struct {
	SchemaVersion int                     `json:"schema_version"`
	Request       forkSnapshotRequest     `json:"request"`
	SourceThread  ThreadSettings          `json:"source_thread"`
	UploadRefs    []forkSnapshotUploadRef `json:"upload_refs"`
	FlowerRouting *FlowerThreadRouting    `json:"flower_routing,omitempty"`
}

type forkSnapshotRequest struct {
	EndpointID            string `json:"endpoint_id"`
	SourceThreadID        string `json:"source_thread_id"`
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

func stableForkOperationID(endpointID, ownerID, sourceThreadID, clientRequestID string) string {
	return stableProductOperationID("thread_fork_", strings.TrimSpace(endpointID), strings.TrimSpace(ownerID), strings.TrimSpace(sourceThreadID), strings.TrimSpace(clientRequestID))
}

func stableForkLogicalRequestID(operationID string) string {
	return stableProductOperationID("fork_request_", strings.TrimSpace(operationID))
}

func stableForkTitleLogicalRequestID(operationID string) string {
	return stableProductOperationID("fork_title_", strings.TrimSpace(operationID))
}

func normalizeForkThreadRequest(req *ForkThreadRequest) error {
	if req == nil {
		return errors.New("invalid fork request")
	}
	var err error
	req.ClientRequestID, err = normalizeProductRequestID(req.ClientRequestID)
	if err != nil {
		return err
	}
	req.EndpointID = strings.TrimSpace(req.EndpointID)
	req.SourceThreadID = strings.TrimSpace(req.SourceThreadID)
	req.Title = strings.TrimSpace(req.Title)
	req.CreatedByUserPublicID = strings.TrimSpace(req.CreatedByUserPublicID)
	req.CreatedByUserEmail = strings.TrimSpace(req.CreatedByUserEmail)
	if req.EndpointID == "" || req.SourceThreadID == "" || req.CreatedByUserPublicID == "" || req.CreatedAtUnixMs <= 0 {
		return errors.New("invalid fork request")
	}
	req.OperationID = strings.TrimSpace(req.OperationID)
	if req.OperationID == "" {
		req.OperationID = stableForkOperationID(req.EndpointID, req.CreatedByUserPublicID, req.SourceThreadID, req.ClientRequestID)
	}
	req.LogicalRequestID = strings.TrimSpace(req.LogicalRequestID)
	if req.LogicalRequestID == "" {
		req.LogicalRequestID = stableForkLogicalRequestID(req.OperationID)
	}
	req.TitleLogicalRequestID = strings.TrimSpace(req.TitleLogicalRequestID)
	if req.TitleLogicalRequestID == "" {
		req.TitleLogicalRequestID = stableForkTitleLogicalRequestID(req.OperationID)
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

func (s *Store) PrepareForkOperation(ctx context.Context, req ForkThreadRequest) (*ForkOperation, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if err := normalizeForkThreadRequest(&req); err != nil {
		return nil, err
	}
	fingerprint, err := forkRequestFingerprint(req)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(operationContext(ctx), nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	if existing, loadErr := loadForkOperationTx(operationContext(ctx), tx, req.OperationID); loadErr == nil {
		if existing.EndpointID != req.EndpointID || existing.SourceThreadID != req.SourceThreadID || existing.ClientRequestID != req.ClientRequestID || existing.RequestFingerprint != fingerprint {
			return nil, ErrForkOperationConflict
		}
		return existing, tx.Commit()
	} else if !errors.Is(loadErr, sql.ErrNoRows) {
		return nil, loadErr
	}
	if err := requireThreadWritableTx(operationContext(ctx), tx, req.EndpointID, req.SourceThreadID); err != nil {
		return nil, err
	}
	snapshot, err := captureForkSnapshot(operationContext(ctx), tx, req)
	if err != nil {
		return nil, err
	}
	snapshotJSON, err := json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	snapshotFingerprint, err := forkSnapshotFingerprint(snapshot)
	if err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(operationContext(ctx), `
INSERT INTO ai_thread_fork_operations(
  operation_id, endpoint_id, client_request_id, logical_request_id, title_logical_request_id,
  source_thread_id, request_fingerprint, stage, snapshot_schema_version, snapshot_json, snapshot_fingerprint,
  created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, req.OperationID, req.EndpointID, req.ClientRequestID, req.LogicalRequestID, req.TitleLogicalRequestID, req.SourceThreadID, fingerprint, string(ForkStagePrepared), ForkSnapshotSchemaVersion, string(snapshotJSON), snapshotFingerprint, req.CreatedAtUnixMs, req.CreatedAtUnixMs)
	if err != nil {
		if isUniqueConstraintError(err) {
			return nil, ErrForkOperationConflict
		}
		return nil, err
	}
	op, err := loadForkOperationTx(operationContext(ctx), tx, req.OperationID)
	if err != nil {
		return nil, err
	}
	return op, tx.Commit()
}

func (s *Store) BindForkCanonicalDestination(ctx context.Context, operationID, destinationThreadID string) (*ForkOperation, error) {
	operationID = strings.TrimSpace(operationID)
	destinationThreadID = strings.TrimSpace(destinationThreadID)
	if operationID == "" || destinationThreadID == "" {
		return nil, errors.New("invalid canonical fork binding")
	}
	tx, err := s.db.BeginTx(operationContext(ctx), nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	op, err := loadForkOperationTx(operationContext(ctx), tx, operationID)
	if err != nil {
		return nil, err
	}
	if op.DestinationThreadID != "" {
		if op.DestinationThreadID != destinationThreadID {
			return nil, ErrForkDestinationConflict
		}
		return op, tx.Commit()
	}
	if op.Stage != ForkStagePrepared || destinationThreadID == op.SourceThreadID {
		return nil, ErrForkDestinationConflict
	}
	if err := requireThreadNotRetiredTx(operationContext(ctx), tx, op.EndpointID, destinationThreadID); err != nil {
		return nil, err
	}
	var existing int
	if err := tx.QueryRowContext(operationContext(ctx), `SELECT COUNT(1) FROM ai_thread_settings WHERE endpoint_id = ? AND thread_id = ?`, op.EndpointID, destinationThreadID).Scan(&existing); err != nil {
		return nil, err
	}
	if existing != 0 {
		return nil, ErrForkDestinationConflict
	}
	result, err := tx.ExecContext(operationContext(ctx), `UPDATE ai_thread_fork_operations SET destination_thread_id = ?, stage = ?, error_code = '', error_message = '', updated_at_unix_ms = ? WHERE operation_id = ? AND stage = ? AND destination_thread_id = ''`, destinationThreadID, string(ForkStageFloretForked), time.Now().UnixMilli(), operationID, string(ForkStagePrepared))
	if err != nil {
		if isUniqueConstraintError(err) {
			return nil, ErrForkDestinationConflict
		}
		return nil, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return nil, ErrForkDestinationConflict
	}
	op, err = loadForkOperationTx(operationContext(ctx), tx, operationID)
	if err != nil {
		return nil, err
	}
	return op, tx.Commit()
}

func (s *Store) MaterializeForkProduct(ctx context.Context, operationID string, updatedAtUnixMs int64) (*ThreadSettings, error) {
	if updatedAtUnixMs <= 0 {
		return nil, errors.New("invalid fork materialization time")
	}
	tx, err := s.db.BeginTx(operationContext(ctx), nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	op, err := loadForkOperationTx(operationContext(ctx), tx, strings.TrimSpace(operationID))
	if err != nil {
		return nil, err
	}
	if op.DestinationThreadID == "" {
		return nil, errors.New("fork product materialization requires canonical destination")
	}
	if op.Stage != ForkStageFloretForked {
		destination, loadErr := loadForkDestinationThreadTx(operationContext(ctx), tx, op)
		if loadErr != nil {
			return nil, loadErr
		}
		return destination, tx.Commit()
	}
	snapshot, err := decodeForkSnapshot(op)
	if err != nil {
		return nil, err
	}
	if err := materializeForkSnapshot(operationContext(ctx), tx, op, snapshot); err != nil {
		return nil, err
	}
	nextStage := ForkStageProductMaterialized
	if snapshot.Request.Title == "" {
		nextStage = ForkStageTitleSkipped
	}
	result, err := tx.ExecContext(operationContext(ctx), `UPDATE ai_thread_fork_operations SET stage = ?, error_code = '', error_message = '', updated_at_unix_ms = ? WHERE operation_id = ? AND stage = ?`, string(nextStage), updatedAtUnixMs, op.OperationID, string(ForkStageFloretForked))
	if err != nil {
		return nil, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return nil, ErrForkOperationConflict
	}
	destination, err := loadForkDestinationThreadTx(operationContext(ctx), tx, op)
	if err != nil {
		return nil, err
	}
	return destination, tx.Commit()
}

func (s *Store) ConfirmForkTitleApplied(ctx context.Context, operationID string, updatedAtUnixMs int64) (*ForkOperation, error) {
	result, err := s.db.ExecContext(operationContext(ctx), `UPDATE ai_thread_fork_operations SET stage = ?, error_code = '', error_message = '', updated_at_unix_ms = ? WHERE operation_id = ? AND stage = ?`, string(ForkStageTitleApplied), updatedAtUnixMs, strings.TrimSpace(operationID), string(ForkStageProductMaterialized))
	if err != nil {
		return nil, err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		op, loadErr := s.GetForkOperation(ctx, operationID)
		if loadErr != nil || (op.Stage != ForkStageTitleApplied && op.Stage != ForkStageCompleted) {
			return nil, ErrForkOperationConflict
		}
		return op, nil
	}
	return s.GetForkOperation(ctx, operationID)
}

func (s *Store) CompleteForkOperation(ctx context.Context, operationID string, updatedAtUnixMs int64) (*ForkOperation, error) {
	result, err := s.db.ExecContext(operationContext(ctx), `UPDATE ai_thread_fork_operations SET stage = ?, error_code = '', error_message = '', updated_at_unix_ms = ? WHERE operation_id = ? AND stage IN (?, ?)`, string(ForkStageCompleted), updatedAtUnixMs, strings.TrimSpace(operationID), string(ForkStageTitleApplied), string(ForkStageTitleSkipped))
	if err != nil {
		return nil, err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		op, loadErr := s.GetForkOperation(ctx, operationID)
		if loadErr != nil || op.Stage != ForkStageCompleted {
			return nil, ErrForkOperationConflict
		}
		return op, nil
	}
	return s.GetForkOperation(ctx, operationID)
}

func (s *Store) CommitForkOperation(ctx context.Context, req CommitForkOperationRequest) (*ThreadSettings, error) {
	return s.MaterializeForkProduct(ctx, req.OperationID, req.UpdatedAtUnixMs)
}

func (s *Store) ListPendingForkOperations(ctx context.Context, limit int) ([]ForkOperation, error) {
	return s.listForkOperations(ctx, `stage NOT IN (?, ?)`, []any{string(ForkStageCompleted), string(ForkStageFailed)}, limit)
}

func (s *Store) ListUnbroadcastCommittedForkOperations(ctx context.Context, limit int) ([]ForkOperation, error) {
	return s.listForkOperations(ctx, `stage = ? AND (source_broadcasted_at_unix_ms = 0 OR destination_broadcasted_at_unix_ms = 0)`, []any{string(ForkStageCompleted)}, limit)
}

func (s *Store) listForkOperations(ctx context.Context, where string, args []any, limit int) ([]ForkOperation, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	args = append(args, limit)
	rows, err := s.db.QueryContext(operationContext(ctx), forkOperationSelectSQL+` WHERE `+where+` ORDER BY updated_at_unix_ms, operation_id LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ForkOperation
	for rows.Next() {
		var op ForkOperation
		if err := scanForkOperation(rows, &op); err != nil {
			return nil, err
		}
		out = append(out, op)
	}
	return out, rows.Err()
}

func (s *Store) GetForkOperation(ctx context.Context, operationID string) (*ForkOperation, error) {
	return loadForkOperationRow(s.db.QueryRowContext(operationContext(ctx), forkOperationSelectSQL+` WHERE operation_id = ?`, strings.TrimSpace(operationID)))
}

func (s *Store) RecordForkOperationFailure(ctx context.Context, operationID, code, message string, terminal bool, updatedAtUnixMs int64) error {
	if terminal {
		_, err := s.db.ExecContext(operationContext(ctx), `UPDATE ai_thread_fork_operations SET stage = ?, retry_count = retry_count + 1, error_code = ?, error_message = ?, updated_at_unix_ms = ? WHERE operation_id = ? AND stage NOT IN (?, ?)`, string(ForkStageFailed), strings.TrimSpace(code), truncateRunes(message, 600), updatedAtUnixMs, strings.TrimSpace(operationID), string(ForkStageCompleted), string(ForkStageFailed))
		return err
	}
	_, err := s.db.ExecContext(operationContext(ctx), `UPDATE ai_thread_fork_operations SET retry_count = retry_count + 1, error_code = ?, error_message = ?, updated_at_unix_ms = ? WHERE operation_id = ? AND stage NOT IN (?, ?)`, strings.TrimSpace(code), truncateRunes(message, 600), updatedAtUnixMs, strings.TrimSpace(operationID), string(ForkStageCompleted), string(ForkStageFailed))
	return err
}

func (s *Store) MarkForkOperationBroadcasted(ctx context.Context, operationID string, source bool, atUnixMs int64) error {
	column := "destination_broadcasted_at_unix_ms"
	if source {
		column = "source_broadcasted_at_unix_ms"
	}
	result, err := s.db.ExecContext(operationContext(ctx), `UPDATE ai_thread_fork_operations SET `+column+` = ?, updated_at_unix_ms = ? WHERE operation_id = ? AND stage = ? AND `+column+` = 0`, atUnixMs, atUnixMs, strings.TrimSpace(operationID), string(ForkStageCompleted))
	if err != nil {
		return err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		op, loadErr := s.GetForkOperation(ctx, operationID)
		if loadErr != nil || op.Stage != ForkStageCompleted {
			return ErrForkOperationConflict
		}
	}
	return nil
}

const forkOperationSelectSQL = `SELECT operation_id, endpoint_id, client_request_id, logical_request_id, title_logical_request_id, source_thread_id, destination_thread_id, request_fingerprint, stage, snapshot_schema_version, snapshot_json, snapshot_fingerprint, retry_count, error_code, error_message, source_broadcasted_at_unix_ms, destination_broadcasted_at_unix_ms, created_at_unix_ms, updated_at_unix_ms FROM ai_thread_fork_operations`

func scanForkOperation(scanner interface{ Scan(...any) error }, op *ForkOperation) error {
	var stage string
	if err := scanner.Scan(&op.OperationID, &op.EndpointID, &op.ClientRequestID, &op.LogicalRequestID, &op.TitleLogicalRequestID, &op.SourceThreadID, &op.DestinationThreadID, &op.RequestFingerprint, &stage, &op.SnapshotSchemaVersion, &op.SnapshotJSON, &op.SnapshotFingerprint, &op.RetryCount, &op.ErrorCode, &op.ErrorMessage, &op.SourceBroadcastedAtUnixMs, &op.DestinationBroadcastedAtUnixMs, &op.CreatedAtUnixMs, &op.UpdatedAtUnixMs); err != nil {
		return err
	}
	op.Stage = ForkOperationStage(stage)
	snapshot, err := decodeForkSnapshot(op)
	if err != nil {
		return err
	}
	op.RequestedTitle = strings.TrimSpace(snapshot.Request.Title)
	return nil
}

func loadForkOperationRow(scanner interface{ Scan(...any) error }) (*ForkOperation, error) {
	var op ForkOperation
	if err := scanForkOperation(scanner, &op); err != nil {
		return nil, err
	}
	return &op, nil
}

func loadForkOperationTx(ctx context.Context, tx *sql.Tx, operationID string) (*ForkOperation, error) {
	return loadForkOperationRow(tx.QueryRowContext(ctx, forkOperationSelectSQL+` WHERE operation_id = ?`, strings.TrimSpace(operationID)))
}

func loadForkDestinationThreadTx(ctx context.Context, tx *sql.Tx, op *ForkOperation) (*ThreadSettings, error) {
	var thread ThreadSettings
	if err := scanThreadRow(tx.QueryRowContext(ctx, fmt.Sprintf(`SELECT %s FROM ai_thread_settings WHERE endpoint_id = ? AND thread_id = ?`, threadSelectColumnsSQL), op.EndpointID, op.DestinationThreadID), &thread); err != nil {
		return nil, err
	}
	return &thread, nil
}

func forkSnapshotFingerprint(snapshot forkSnapshot) (string, error) {
	body, err := json.Marshal(snapshot)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:]), nil
}

func captureForkSnapshot(ctx context.Context, tx *sql.Tx, req ForkThreadRequest) (forkSnapshot, error) {
	var source ThreadSettings
	if err := scanThreadRow(tx.QueryRowContext(ctx, fmt.Sprintf(`SELECT %s FROM ai_thread_settings WHERE endpoint_id = ? AND thread_id = ?`, threadSelectColumnsSQL), req.EndpointID, req.SourceThreadID), &source); err != nil {
		return forkSnapshot{}, err
	}
	snapshot := forkSnapshot{SchemaVersion: ForkSnapshotSchemaVersion, Request: forkSnapshotRequest{EndpointID: req.EndpointID, SourceThreadID: req.SourceThreadID, Title: req.Title, CreatedByUserPublicID: req.CreatedByUserPublicID, CreatedByUserEmail: req.CreatedByUserEmail, CreatedAtUnixMs: req.CreatedAtUnixMs}, SourceThread: source}
	rows, err := tx.QueryContext(ctx, `SELECT upload_id, ref_kind, ref_id, created_at_unix_ms FROM ai_upload_refs WHERE endpoint_id = ? AND thread_id = ? AND ref_kind = ? AND ref_id = ? ORDER BY id`, req.EndpointID, req.SourceThreadID, UploadRefKindThread, req.SourceThreadID)
	if err != nil {
		return forkSnapshot{}, err
	}
	for rows.Next() {
		var ref forkSnapshotUploadRef
		if err := rows.Scan(&ref.UploadID, &ref.RefKind, &ref.RefID, &ref.CreatedAtUnixMs); err != nil {
			_ = rows.Close()
			return forkSnapshot{}, err
		}
		snapshot.UploadRefs = append(snapshot.UploadRefs, ref)
	}
	if err := rows.Close(); err != nil {
		return forkSnapshot{}, err
	}
	var routing FlowerThreadRouting
	err = tx.QueryRowContext(ctx, `SELECT endpoint_id, thread_id, updated_at_unix_ms, home_runtime_id, home_runtime_kind, origin_env_public_id, primary_target_id, active_target_ids_json FROM ai_flower_thread_routing WHERE endpoint_id = ? AND thread_id = ?`, req.EndpointID, req.SourceThreadID).Scan(&routing.EndpointID, &routing.ThreadID, &routing.UpdatedAtUnixMs, &routing.HomeRuntimeID, &routing.HomeRuntimeKind, &routing.OriginEnvPublicID, &routing.PrimaryTargetID, &routing.ActiveTargetIDsJSON)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return forkSnapshot{}, err
	}
	if err == nil {
		snapshot.FlowerRouting = &routing
	}
	return snapshot, nil
}

func decodeForkSnapshot(op *ForkOperation) (forkSnapshot, error) {
	if op == nil || op.SnapshotSchemaVersion != ForkSnapshotSchemaVersion || strings.TrimSpace(op.SnapshotJSON) == "" {
		return forkSnapshot{}, errors.New("fork operation snapshot is invalid")
	}
	var snapshot forkSnapshot
	if err := decodeStrictJSON(op.SnapshotJSON, &snapshot); err != nil {
		return forkSnapshot{}, fmt.Errorf("decode fork operation snapshot: %w", err)
	}
	if snapshot.SchemaVersion != ForkSnapshotSchemaVersion || snapshot.Request.EndpointID != op.EndpointID || snapshot.Request.SourceThreadID != op.SourceThreadID || snapshot.SourceThread.EndpointID != op.EndpointID || snapshot.SourceThread.ThreadID != op.SourceThreadID {
		return forkSnapshot{}, errors.New("fork snapshot identity mismatch")
	}
	req := ForkThreadRequest{OperationID: op.OperationID, ClientRequestID: op.ClientRequestID, LogicalRequestID: op.LogicalRequestID, TitleLogicalRequestID: op.TitleLogicalRequestID, EndpointID: snapshot.Request.EndpointID, SourceThreadID: snapshot.Request.SourceThreadID, Title: snapshot.Request.Title, CreatedByUserPublicID: snapshot.Request.CreatedByUserPublicID, CreatedByUserEmail: snapshot.Request.CreatedByUserEmail, CreatedAtUnixMs: snapshot.Request.CreatedAtUnixMs}
	if err := normalizeForkThreadRequest(&req); err != nil {
		return forkSnapshot{}, err
	}
	fingerprint, err := forkRequestFingerprint(req)
	if err != nil || fingerprint != op.RequestFingerprint {
		return forkSnapshot{}, errors.New("fork snapshot request fingerprint mismatch")
	}
	snapshotFingerprint, err := forkSnapshotFingerprint(snapshot)
	if err != nil || snapshotFingerprint != op.SnapshotFingerprint {
		return forkSnapshot{}, errors.New("fork snapshot fingerprint mismatch")
	}
	return snapshot, nil
}

func materializeForkSnapshot(ctx context.Context, tx *sql.Tx, op *ForkOperation, snapshot forkSnapshot) error {
	req := ForkThreadRequest{EndpointID: op.EndpointID, SourceThreadID: op.SourceThreadID, DestinationThreadID: op.DestinationThreadID, Title: snapshot.Request.Title, CreatedByUserPublicID: snapshot.Request.CreatedByUserPublicID, CreatedByUserEmail: snapshot.Request.CreatedByUserEmail, CreatedAtUnixMs: snapshot.Request.CreatedAtUnixMs}
	if err := insertForkedThreadTx(ctx, tx, req, snapshot.SourceThread); err != nil {
		return err
	}
	for _, ref := range snapshot.UploadRefs {
		if normalizeUploadRefKind(ref.RefKind) != UploadRefKindThread || strings.TrimSpace(ref.RefID) != op.SourceThreadID {
			return errors.New("fork snapshot contains non-thread upload ownership")
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint_id, upload_id, ref_kind, ref_id) DO NOTHING`, op.EndpointID, strings.TrimSpace(ref.UploadID), op.DestinationThreadID, UploadRefKindThread, op.DestinationThreadID, ref.CreatedAtUnixMs); err != nil {
			return err
		}
	}
	if snapshot.FlowerRouting != nil {
		routing := *snapshot.FlowerRouting
		routing.ThreadID = op.DestinationThreadID
		routing.UpdatedAtUnixMs = snapshot.Request.CreatedAtUnixMs
		if err := upsertFlowerThreadRoutingExec(ctx, tx, routing); err != nil {
			return err
		}
	}
	return nil
}
