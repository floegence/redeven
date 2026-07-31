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
	ThreadCreateStagePrepared            = "prepared"
	ThreadCreateStageFloretCreated       = "floret_created"
	ThreadCreateStageProductMaterialized = "product_materialized"
	ThreadCreateStageTitleApplied        = "title_applied"
	ThreadCreateStageTitleSkipped        = "title_skipped"
	ThreadCreateStageCompleted           = "completed"
	ThreadCreateStageFailed              = "failed"
)

// Deprecated names remain package-local migration aids while call sites move to Stage.
const (
	ThreadCreateOperationPending   = ThreadCreateStagePrepared
	ThreadCreateOperationCommitted = ThreadCreateStageCompleted
	ThreadCreateOperationFailed    = ThreadCreateStageFailed
)

var ErrThreadCreateConflict = errors.New("thread create operation conflicts with existing request")

type PrepareThreadCreateRequest struct {
	OperationID           string
	ClientRequestID       string
	LogicalRequestID      string
	TitleLogicalRequestID string
	Settings              ThreadSettings
	ExplicitTitle         string
	InitialTurn           *QueuedTurn
	UploadIDs             []string
	AttachmentAdmission   AttachmentAdmission
	StagingScope          *UploadStagingScope
	CreatedAtMS           int64
}

type ThreadCreateOperation struct {
	OperationID           string
	EndpointID            string
	ClientRequestID       string
	LogicalRequestID      string
	TitleLogicalRequestID string
	CanonicalThreadID     string
	ThreadID              string
	RequestFingerprint    string
	Stage                 string
	Status                string
	SnapshotSchemaVersion int
	SnapshotJSON          string
	Settings              ThreadSettings
	ExplicitTitle         string
	InitialTurn           *QueuedTurn
	UploadIDs             []string
	AttachmentAdmission   AttachmentAdmission
	StagingScope          *UploadStagingScope
	RetryCount            int
	ErrorCode             string
	ErrorMessage          string
	CreatedAtMS           int64
	UpdatedAtMS           int64
}

type threadCreateSnapshotV1 struct {
	SchemaVersion        int                  `json:"schema_version"`
	Settings             ThreadSettings       `json:"settings"`
	ExplicitTitle        string               `json:"explicit_title,omitempty"`
	InitialTurn          *QueuedTurn          `json:"initial_turn,omitempty"`
	UploadIDs            []string             `json:"upload_ids,omitempty"`
	AttachmentAdmission  *AttachmentAdmission `json:"attachment_admission,omitempty"`
	StagingScope         *UploadStagingScope  `json:"staging_scope,omitempty"`
	StagingOwnerUserHash string               `json:"staging_owner_user_hash,omitempty"`
}

func stableProductOperationID(prefix string, parts ...string) string {
	joined := strings.Join(parts, "\x00")
	sum := sha256.Sum256([]byte(joined))
	return prefix + hex.EncodeToString(sum[:12])
}

func stableThreadCreateOperationID(endpointID, clientRequestID string) string {
	return stableProductOperationID("thread_create_", strings.TrimSpace(endpointID), strings.TrimSpace(clientRequestID))
}

func stableThreadCreateLogicalRequestID(operationID string) string {
	return stableProductOperationID("create_request_", strings.TrimSpace(operationID))
}

func stableThreadCreateTitleLogicalRequestID(operationID string) string {
	return stableProductOperationID("create_title_", strings.TrimSpace(operationID))
}

func normalizeProductRequestID(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 200 || strings.ContainsAny(raw, "\r\n\x00") {
		return "", errors.New("invalid client_request_id")
	}
	return raw, nil
}

func normalizeThreadCreateRequest(req PrepareThreadCreateRequest) (PrepareThreadCreateRequest, threadCreateSnapshotV1, string, error) {
	var err error
	req.ClientRequestID, err = normalizeProductRequestID(req.ClientRequestID)
	if err != nil {
		return PrepareThreadCreateRequest{}, threadCreateSnapshotV1{}, "", err
	}
	req.Settings.ThreadID = ""
	req.Settings.EndpointID = strings.TrimSpace(req.Settings.EndpointID)
	req.Settings.NamespacePublicID = strings.TrimSpace(req.Settings.NamespacePublicID)
	req.Settings.ModelID = strings.TrimSpace(req.Settings.ModelID)
	req.Settings.ReasoningSelectionJSON = strings.TrimSpace(req.Settings.ReasoningSelectionJSON)
	req.Settings.WorkingDir = strings.TrimSpace(req.Settings.WorkingDir)
	req.Settings.CreatedByUserPublicID = strings.TrimSpace(req.Settings.CreatedByUserPublicID)
	req.Settings.CreatedByUserEmail = strings.TrimSpace(req.Settings.CreatedByUserEmail)
	req.Settings.UpdatedByUserPublicID = strings.TrimSpace(req.Settings.UpdatedByUserPublicID)
	req.Settings.UpdatedByUserEmail = strings.TrimSpace(req.Settings.UpdatedByUserEmail)
	req.Settings.PermissionType, err = canonicalPermissionType(req.Settings.PermissionType)
	if err != nil {
		return PrepareThreadCreateRequest{}, threadCreateSnapshotV1{}, "", err
	}
	if req.Settings.EndpointID == "" {
		return PrepareThreadCreateRequest{}, threadCreateSnapshotV1{}, "", errors.New("invalid thread create request")
	}
	req.OperationID = strings.TrimSpace(req.OperationID)
	if req.OperationID == "" {
		req.OperationID = stableThreadCreateOperationID(req.Settings.EndpointID, req.ClientRequestID)
	}
	req.LogicalRequestID = strings.TrimSpace(req.LogicalRequestID)
	if req.LogicalRequestID == "" {
		req.LogicalRequestID = stableThreadCreateLogicalRequestID(req.OperationID)
	}
	req.TitleLogicalRequestID = strings.TrimSpace(req.TitleLogicalRequestID)
	if req.TitleLogicalRequestID == "" {
		req.TitleLogicalRequestID = stableThreadCreateTitleLogicalRequestID(req.OperationID)
	}
	if _, err := normalizeProductRequestID(req.LogicalRequestID); err != nil {
		return PrepareThreadCreateRequest{}, threadCreateSnapshotV1{}, "", errors.New("invalid create logical request id")
	}
	if _, err := normalizeProductRequestID(req.TitleLogicalRequestID); err != nil {
		return PrepareThreadCreateRequest{}, threadCreateSnapshotV1{}, "", errors.New("invalid create title logical request id")
	}
	if req.CreatedAtMS <= 0 {
		req.CreatedAtMS = time.Now().UnixMilli()
	}
	req.ExplicitTitle = strings.TrimSpace(req.ExplicitTitle)
	req.UploadIDs = dedupeNonEmptyStrings(req.UploadIDs)
	snapshot := threadCreateSnapshotV1{SchemaVersion: ThreadCreateSnapshotSchemaVersion, Settings: req.Settings, ExplicitTitle: req.ExplicitTitle, UploadIDs: req.UploadIDs}
	if req.InitialTurn != nil {
		turn := *req.InitialTurn
		turn.ThreadID = ""
		turn.TurnID = ""
		turn.RunID = ""
		turn.AdmissionState = PendingTurnAdmissionReady
		if turn.QueueID == "" || strings.TrimSpace(turn.EndpointID) != req.Settings.EndpointID || strings.TrimSpace(turn.ChannelID) == "" {
			return PrepareThreadCreateRequest{}, threadCreateSnapshotV1{}, "", errors.New("invalid initial queued turn")
		}
		snapshot.InitialTurn = &turn
		admission := req.AttachmentAdmission
		snapshot.AttachmentAdmission = &admission
		if req.StagingScope != nil {
			scope := normalizeUploadStagingScope(*req.StagingScope)
			if scope.EndpointID != req.Settings.EndpointID || scope.TargetID != req.ClientRequestID {
				return PrepareThreadCreateRequest{}, threadCreateSnapshotV1{}, "", errors.New("upload staging target changed")
			}
			snapshot.StagingScope = &scope
			snapshot.StagingOwnerUserHash = scope.OwnerUserHash
		}
	}
	fingerprint, err := threadCreateRequestFingerprint(req.ClientRequestID, req.LogicalRequestID, req.TitleLogicalRequestID, snapshot)
	return req, snapshot, fingerprint, err
}

func threadCreateRequestFingerprint(clientRequestID, logicalRequestID, titleLogicalRequestID string, snapshot threadCreateSnapshotV1) (string, error) {
	snapshot.Settings.SettingsCreatedAtUnixMs = 0
	snapshot.Settings.SettingsUpdatedAtUnixMs = 0
	body, err := json.Marshal(struct {
		ClientRequestID       string                 `json:"client_request_id"`
		LogicalRequestID      string                 `json:"logical_request_id"`
		TitleLogicalRequestID string                 `json:"title_logical_request_id"`
		Snapshot              threadCreateSnapshotV1 `json:"snapshot"`
	}{clientRequestID, logicalRequestID, titleLogicalRequestID, snapshot})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:]), nil
}

func (s *Store) PrepareThreadCreateOperation(ctx context.Context, req PrepareThreadCreateRequest) (ThreadCreateOperation, error) {
	if s == nil || s.db == nil {
		return ThreadCreateOperation{}, errors.New("store not initialized")
	}
	req, snapshot, fingerprint, err := normalizeThreadCreateRequest(req)
	if err != nil {
		return ThreadCreateOperation{}, err
	}
	snapshotJSON, err := json.Marshal(snapshot)
	if err != nil {
		return ThreadCreateOperation{}, err
	}
	tx, err := s.db.BeginTx(operationContext(ctx), nil)
	if err != nil {
		return ThreadCreateOperation{}, err
	}
	defer func() { _ = tx.Rollback() }()
	existing, err := loadThreadCreateOperationTx(operationContext(ctx), tx, req.OperationID)
	if err == nil {
		if existing.EndpointID != req.Settings.EndpointID || existing.ClientRequestID != req.ClientRequestID || existing.RequestFingerprint != fingerprint {
			return ThreadCreateOperation{}, ErrThreadCreateConflict
		}
		return existing, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return ThreadCreateOperation{}, err
	}
	if snapshot.InitialTurn != nil {
		if len(snapshot.UploadIDs) != 0 && snapshot.StagingScope == nil {
			return ThreadCreateOperation{}, errors.New("initial attachments require an upload staging scope")
		}
		if snapshot.StagingScope != nil {
			if err := requireUploadStagingScopeActiveTx(operationContext(ctx), tx, *snapshot.StagingScope, time.Now().UnixMilli()); err != nil {
				return ThreadCreateOperation{}, err
			}
		}
		if snapshot.AttachmentAdmission == nil {
			return ThreadCreateOperation{}, errors.New("initial attachment admission is missing")
		}
		if err := validateAttachmentAdmissionTx(operationContext(ctx), tx, req.Settings.EndpointID, snapshot.UploadIDs, *snapshot.AttachmentAdmission); err != nil {
			return ThreadCreateOperation{}, err
		}
	}
	_, err = tx.ExecContext(operationContext(ctx), `
INSERT INTO ai_thread_create_operations(
  operation_id, endpoint_id, client_request_id, logical_request_id, title_logical_request_id,
  request_fingerprint, stage, snapshot_schema_version, snapshot_json, created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, req.OperationID, req.Settings.EndpointID, req.ClientRequestID, req.LogicalRequestID, req.TitleLogicalRequestID, fingerprint, ThreadCreateStagePrepared, ThreadCreateSnapshotSchemaVersion, string(snapshotJSON), req.CreatedAtMS, req.CreatedAtMS)
	if err != nil {
		if isUniqueConstraintError(err) {
			return ThreadCreateOperation{}, ErrThreadCreateConflict
		}
		return ThreadCreateOperation{}, err
	}
	operation, err := loadThreadCreateOperationTx(operationContext(ctx), tx, req.OperationID)
	if err != nil {
		return ThreadCreateOperation{}, err
	}
	return operation, tx.Commit()
}

func (s *Store) BindThreadCreateCanonicalID(ctx context.Context, operationID, canonicalThreadID string) (ThreadCreateOperation, error) {
	operationID = strings.TrimSpace(operationID)
	canonicalThreadID = strings.TrimSpace(canonicalThreadID)
	if operationID == "" || canonicalThreadID == "" {
		return ThreadCreateOperation{}, errors.New("invalid canonical create binding")
	}
	tx, err := s.db.BeginTx(operationContext(ctx), nil)
	if err != nil {
		return ThreadCreateOperation{}, err
	}
	defer func() { _ = tx.Rollback() }()
	op, err := loadThreadCreateOperationTx(operationContext(ctx), tx, operationID)
	if err != nil {
		return ThreadCreateOperation{}, err
	}
	if op.CanonicalThreadID != "" {
		if op.CanonicalThreadID != canonicalThreadID {
			return ThreadCreateOperation{}, ErrThreadCreateConflict
		}
		return op, tx.Commit()
	}
	if op.Stage != ThreadCreateStagePrepared {
		return ThreadCreateOperation{}, ErrThreadCreateConflict
	}
	if err := requireThreadNotRetiredTx(operationContext(ctx), tx, op.EndpointID, canonicalThreadID); err != nil {
		return ThreadCreateOperation{}, err
	}
	result, err := tx.ExecContext(operationContext(ctx), `UPDATE ai_thread_create_operations SET canonical_thread_id = ?, stage = ?, error_code = '', error_message = '', updated_at_unix_ms = ? WHERE operation_id = ? AND stage = ? AND canonical_thread_id = ''`, canonicalThreadID, ThreadCreateStageFloretCreated, time.Now().UnixMilli(), operationID, ThreadCreateStagePrepared)
	if err != nil {
		return ThreadCreateOperation{}, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return ThreadCreateOperation{}, ErrThreadCreateConflict
	}
	op, err = loadThreadCreateOperationTx(operationContext(ctx), tx, operationID)
	if err != nil {
		return ThreadCreateOperation{}, err
	}
	return op, tx.Commit()
}

func (s *Store) MaterializeThreadCreateProduct(ctx context.Context, operationID string) (ThreadSettings, error) {
	tx, err := s.db.BeginTx(operationContext(ctx), nil)
	if err != nil {
		return ThreadSettings{}, err
	}
	defer func() { _ = tx.Rollback() }()
	op, err := loadThreadCreateOperationTx(operationContext(ctx), tx, strings.TrimSpace(operationID))
	if err != nil {
		return ThreadSettings{}, err
	}
	if op.CanonicalThreadID == "" {
		return ThreadSettings{}, errors.New("thread create materialization requires canonical Floret thread")
	}
	if op.Stage != ThreadCreateStageFloretCreated {
		settings, loadErr := s.getThreadTx(operationContext(ctx), tx, op.EndpointID, op.CanonicalThreadID)
		if loadErr != nil || settings == nil {
			return ThreadSettings{}, errors.New("materialized thread create operation is missing settings")
		}
		return *settings, tx.Commit()
	}
	snapshot, err := decodeThreadCreateSnapshot(op)
	if err != nil {
		return ThreadSettings{}, err
	}
	settings := snapshot.Settings
	settings.ThreadID = op.CanonicalThreadID
	if snapshot.InitialTurn != nil {
		settings.QueueRevision = 1
	}
	if err := insertThreadSettingsTx(operationContext(ctx), tx, settings); err != nil {
		return ThreadSettings{}, err
	}
	if snapshot.InitialTurn != nil {
		turn := *snapshot.InitialTurn
		turn.ThreadID = op.CanonicalThreadID
		turn.TurnID = ""
		turn.RunID = ""
		turn.SortIndex = 1
		turn.AdmissionState = PendingTurnAdmissionReady
		if _, err := tx.ExecContext(operationContext(ctx), `
INSERT INTO ai_queued_turns(queue_id, endpoint_id, thread_id, channel_id, lane, admission_state, sort_index, turn_id, run_id, model_id, text_content, attachments_json, context_action_json, options_json, session_meta_json, created_by_user_public_id, created_by_user_email, created_at_unix_ms, updated_at_unix_ms)
VALUES(?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, turn.QueueID, turn.EndpointID, turn.ThreadID, turn.ChannelID, FollowupLaneQueued, PendingTurnAdmissionReady, turn.SortIndex, turn.ModelID, turn.TextContent, turn.AttachmentsJSON, turn.ContextActionJSON, turn.OptionsJSON, turn.SessionMetaJSON, turn.CreatedByUserPublicID, turn.CreatedByUserEmail, turn.CreatedAtUnixMs, turn.UpdatedAtUnixMs); err != nil {
			return ThreadSettings{}, err
		}
		if snapshot.StagingScope != nil {
			refID := stagingUploadRefID(snapshot.StagingScope.OwnerUserHash, snapshot.StagingScope.StagingScopeID)
			if err := bindUploadsToRefTx(operationContext(ctx), tx, op.EndpointID, op.CanonicalThreadID, UploadRefKindQueuedTurn, turn.QueueID, snapshot.UploadIDs, turn.CreatedAtUnixMs, UploadRefKindStaging, refID, snapshot.StagingScope.OwnerUserHash); err != nil {
				return ThreadSettings{}, err
			}
			if _, err := tx.ExecContext(operationContext(ctx), `UPDATE ai_upload_staging_scopes SET target_id = ? WHERE staging_scope_id = ? AND target_id = ?`, op.CanonicalThreadID, snapshot.StagingScope.StagingScopeID, op.ClientRequestID); err != nil {
				return ThreadSettings{}, err
			}
		}
	}
	nextStage := ThreadCreateStageProductMaterialized
	if snapshot.ExplicitTitle == "" {
		nextStage = ThreadCreateStageTitleSkipped
	}
	result, err := tx.ExecContext(operationContext(ctx), `UPDATE ai_thread_create_operations SET stage = ?, error_code = '', error_message = '', updated_at_unix_ms = ? WHERE operation_id = ? AND stage = ?`, nextStage, time.Now().UnixMilli(), op.OperationID, ThreadCreateStageFloretCreated)
	if err != nil {
		return ThreadSettings{}, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return ThreadSettings{}, ErrThreadCreateConflict
	}
	if err := tx.Commit(); err != nil {
		return ThreadSettings{}, err
	}
	return settings, nil
}

func insertThreadSettingsTx(ctx context.Context, tx *sql.Tx, settings ThreadSettings) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO ai_thread_settings(thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json, permission_type, working_dir, pinned_at_unix_ms, queue_revision, created_by_user_public_id, created_by_user_email, updated_by_user_public_id, updated_by_user_email, settings_created_at_unix_ms, settings_updated_at_unix_ms) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, settings.ThreadID, settings.EndpointID, settings.NamespacePublicID, settings.ModelID, settings.ReasoningSelectionJSON, settings.PermissionType, settings.WorkingDir, nonNegativeInt64(settings.PinnedAtUnixMs), nonNegativeInt64(settings.QueueRevision), settings.CreatedByUserPublicID, settings.CreatedByUserEmail, settings.UpdatedByUserPublicID, settings.UpdatedByUserEmail, settings.SettingsCreatedAtUnixMs, settings.SettingsUpdatedAtUnixMs)
	return err
}

func (s *Store) ConfirmThreadCreateTitleSet(ctx context.Context, operationID string) (ThreadCreateOperation, error) {
	result, err := s.db.ExecContext(operationContext(ctx), `UPDATE ai_thread_create_operations SET stage = ?, error_code = '', error_message = '', updated_at_unix_ms = ? WHERE operation_id = ? AND stage = ?`, ThreadCreateStageTitleApplied, time.Now().UnixMilli(), strings.TrimSpace(operationID), ThreadCreateStageProductMaterialized)
	if err != nil {
		return ThreadCreateOperation{}, err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		op, loadErr := s.GetThreadCreateOperation(ctx, operationID)
		if loadErr != nil || (op.Stage != ThreadCreateStageTitleApplied && op.Stage != ThreadCreateStageCompleted) {
			return ThreadCreateOperation{}, ErrThreadCreateConflict
		}
		return op, nil
	}
	return s.GetThreadCreateOperation(ctx, operationID)
}

func (s *Store) CompleteThreadCreateOperation(ctx context.Context, operationID string) (ThreadCreateOperation, error) {
	result, err := s.db.ExecContext(operationContext(ctx), `UPDATE ai_thread_create_operations SET stage = ?, error_code = '', error_message = '', updated_at_unix_ms = ? WHERE operation_id = ? AND stage IN (?, ?)`, ThreadCreateStageCompleted, time.Now().UnixMilli(), strings.TrimSpace(operationID), ThreadCreateStageTitleApplied, ThreadCreateStageTitleSkipped)
	if err != nil {
		return ThreadCreateOperation{}, err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		op, loadErr := s.GetThreadCreateOperation(ctx, operationID)
		if loadErr != nil || op.Stage != ThreadCreateStageCompleted {
			return ThreadCreateOperation{}, ErrThreadCreateConflict
		}
		return op, nil
	}
	return s.GetThreadCreateOperation(ctx, operationID)
}

func (s *Store) CommitThreadCreateSettings(ctx context.Context, operationID string) (ThreadSettings, error) {
	return s.MaterializeThreadCreateProduct(ctx, operationID)
}

func (s *Store) ConfirmThreadCreateFloretCreated(ctx context.Context, operationID string) (ThreadCreateOperation, error) {
	op, err := s.GetThreadCreateOperation(ctx, operationID)
	if err != nil {
		return ThreadCreateOperation{}, err
	}
	if op.CanonicalThreadID == "" {
		return ThreadCreateOperation{}, errors.New("canonical thread id is required")
	}
	return s.BindThreadCreateCanonicalID(ctx, operationID, op.CanonicalThreadID)
}

func (s *Store) GetThreadCreateOperation(ctx context.Context, operationID string) (ThreadCreateOperation, error) {
	return loadThreadCreateOperationRow(s.db.QueryRowContext(operationContext(ctx), threadCreateOperationSelectSQL+` WHERE operation_id = ?`, strings.TrimSpace(operationID)))
}

func (s *Store) GetThreadCreateOperationByClientRequest(ctx context.Context, endpointID, clientRequestID string) (ThreadCreateOperation, error) {
	endpointID = strings.TrimSpace(endpointID)
	clientRequestID = strings.TrimSpace(clientRequestID)
	if endpointID == "" || clientRequestID == "" {
		return ThreadCreateOperation{}, errors.New("invalid thread create client request identity")
	}
	return loadThreadCreateOperationRow(s.db.QueryRowContext(operationContext(ctx), threadCreateOperationSelectSQL+` WHERE endpoint_id = ? AND client_request_id = ?`, endpointID, clientRequestID))
}

func (s *Store) GetMatchingInitialThreadCreateOperation(ctx context.Context, req PrepareThreadCreateRequest) (ThreadCreateOperation, error) {
	req, _, fingerprint, err := normalizeThreadCreateRequest(req)
	if err != nil {
		return ThreadCreateOperation{}, err
	}
	op, err := s.GetThreadCreateOperation(ctx, req.OperationID)
	if err != nil {
		return ThreadCreateOperation{}, err
	}
	if op.EndpointID != req.Settings.EndpointID || op.ClientRequestID != req.ClientRequestID || op.RequestFingerprint != fingerprint {
		return ThreadCreateOperation{}, ErrThreadCreateConflict
	}
	return op, nil
}

func (s *Store) ListPendingThreadCreateOperations(ctx context.Context, limit int) ([]ThreadCreateOperation, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	rows, err := s.db.QueryContext(operationContext(ctx), threadCreateOperationSelectSQL+` WHERE stage NOT IN (?, ?) ORDER BY updated_at_unix_ms, operation_id LIMIT ?`, ThreadCreateStageCompleted, ThreadCreateStageFailed, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ThreadCreateOperation
	for rows.Next() {
		op, err := loadThreadCreateOperationRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, op)
	}
	return out, rows.Err()
}

func (s *Store) RecordThreadCreateRetry(ctx context.Context, operationID, code, message string) error {
	_, err := s.db.ExecContext(operationContext(ctx), `UPDATE ai_thread_create_operations SET retry_count = retry_count + 1, error_code = ?, error_message = ?, updated_at_unix_ms = ? WHERE operation_id = ? AND stage NOT IN (?, ?)`, strings.TrimSpace(code), truncateRunes(message, 600), time.Now().UnixMilli(), strings.TrimSpace(operationID), ThreadCreateStageCompleted, ThreadCreateStageFailed)
	return err
}

const threadCreateOperationSelectSQL = `
SELECT operation_id, endpoint_id, client_request_id, logical_request_id, title_logical_request_id, canonical_thread_id, request_fingerprint, stage, snapshot_schema_version, snapshot_json, retry_count, error_code, error_message, created_at_unix_ms, updated_at_unix_ms
FROM ai_thread_create_operations`

func loadThreadCreateOperationTx(ctx context.Context, tx *sql.Tx, operationID string) (ThreadCreateOperation, error) {
	return loadThreadCreateOperationRow(tx.QueryRowContext(ctx, threadCreateOperationSelectSQL+` WHERE operation_id = ?`, strings.TrimSpace(operationID)))
}

func loadThreadCreateOperationRow(scanner rowScanner) (ThreadCreateOperation, error) {
	var op ThreadCreateOperation
	if err := scanner.Scan(&op.OperationID, &op.EndpointID, &op.ClientRequestID, &op.LogicalRequestID, &op.TitleLogicalRequestID, &op.CanonicalThreadID, &op.RequestFingerprint, &op.Stage, &op.SnapshotSchemaVersion, &op.SnapshotJSON, &op.RetryCount, &op.ErrorCode, &op.ErrorMessage, &op.CreatedAtMS, &op.UpdatedAtMS); err != nil {
		return ThreadCreateOperation{}, err
	}
	op.ThreadID = op.CanonicalThreadID
	op.Status = op.Stage
	snapshot, err := decodeThreadCreateSnapshot(op)
	if err != nil {
		return ThreadCreateOperation{}, err
	}
	op.Settings = snapshot.Settings
	if op.CanonicalThreadID != "" {
		op.Settings.ThreadID = op.CanonicalThreadID
	}
	op.ExplicitTitle = strings.TrimSpace(snapshot.ExplicitTitle)
	if snapshot.InitialTurn != nil {
		turn := *snapshot.InitialTurn
		op.InitialTurn = &turn
	}
	op.UploadIDs = append([]string(nil), snapshot.UploadIDs...)
	if snapshot.AttachmentAdmission != nil {
		op.AttachmentAdmission = *snapshot.AttachmentAdmission
	}
	if snapshot.StagingScope != nil {
		scope := *snapshot.StagingScope
		op.StagingScope = &scope
	}
	return op, nil
}

func decodeThreadCreateSnapshot(op ThreadCreateOperation) (threadCreateSnapshotV1, error) {
	if op.SnapshotSchemaVersion != ThreadCreateSnapshotSchemaVersion || strings.TrimSpace(op.SnapshotJSON) == "" {
		return threadCreateSnapshotV1{}, errors.New("thread create operation snapshot is invalid")
	}
	var snapshot threadCreateSnapshotV1
	if err := decodeStrictJSON(op.SnapshotJSON, &snapshot); err != nil {
		return threadCreateSnapshotV1{}, fmt.Errorf("decode thread create operation snapshot: %w", err)
	}
	if snapshot.SchemaVersion != ThreadCreateSnapshotSchemaVersion || snapshot.Settings.EndpointID != op.EndpointID || snapshot.Settings.ThreadID != "" {
		return threadCreateSnapshotV1{}, errors.New("thread create operation snapshot identity mismatch")
	}
	if snapshot.StagingScope != nil {
		snapshot.StagingOwnerUserHash = strings.ToLower(strings.TrimSpace(snapshot.StagingOwnerUserHash))
		if len(snapshot.StagingOwnerUserHash) != sha256.Size*2 {
			return threadCreateSnapshotV1{}, errors.New("thread create operation staging owner proof is invalid")
		}
		snapshot.StagingScope.OwnerUserHash = snapshot.StagingOwnerUserHash
	} else if strings.TrimSpace(snapshot.StagingOwnerUserHash) != "" {
		return threadCreateSnapshotV1{}, errors.New("thread create operation staging owner proof has no scope")
	}
	fingerprint, err := threadCreateRequestFingerprint(op.ClientRequestID, op.LogicalRequestID, op.TitleLogicalRequestID, snapshot)
	if err != nil || fingerprint != op.RequestFingerprint {
		return threadCreateSnapshotV1{}, errors.New("thread create operation snapshot fingerprint mismatch")
	}
	return snapshot, nil
}

func operationContext(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	return ctx
}
