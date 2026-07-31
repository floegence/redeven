package threadstore

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

func (s *Store) PrepareThreadCreateWithInitialTurn(ctx context.Context, createReq PrepareThreadCreateRequest, rec QueuedTurn, uploadIDs []string, claimedAtUnixMs int64, attachmentAdmission AttachmentAdmission, stagingScope *UploadStagingScope) (ThreadCreateOperation, QueuedTurn, error) {
	rec.ThreadID = ""
	rec.TurnID = ""
	rec.RunID = ""
	rec.AdmissionState = PendingTurnAdmissionReady
	createReq.InitialTurn = &rec
	createReq.UploadIDs = uploadIDs
	createReq.AttachmentAdmission = attachmentAdmission
	createReq.StagingScope = stagingScope
	if createReq.CreatedAtMS <= 0 {
		createReq.CreatedAtMS = rec.CreatedAtUnixMs
	}
	operation, err := s.PrepareThreadCreateOperation(ctx, createReq)
	return operation, rec, err
}

type UploadStagingScope struct {
	StagingScopeID   string `json:"staging_scope_id"`
	EndpointID       string `json:"endpoint_id"`
	OwnerUserHash    string `json:"-"`
	TargetID         string `json:"target_id"`
	CapabilityHash   string `json:"-"`
	CreatedAtUnixMs  int64  `json:"created_at_unix_ms"`
	ExpiresAtUnixMs  int64  `json:"expires_at_unix_ms"`
	ReleasedAtUnixMs int64  `json:"-"`
}

func (s *Store) CompleteUploadAttemptToStaging(ctx context.Context, attempt UploadAttemptRecord, rec UploadRecord, scope UploadStagingScope) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	rec = normalizeUploadRecord(rec)
	scope = normalizeUploadStagingScope(scope)
	if err := validateUploadRecordForWrite(rec); err != nil {
		return err
	}
	if err := validateUploadStagingScope(scope); err != nil || scope.EndpointID != rec.EndpointID || scope.OwnerUserHash != rec.OwnerUserHash {
		return errors.New("invalid upload staging scope")
	}
	refID := stagingUploadRefID(rec.OwnerUserHash, scope.StagingScopeID)
	tx, err := s.db.BeginTx(ctxOrBackground(ctx), nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	observeStoreTransaction(ctx, "complete_upload_attempt_to_staging")
	var active int
	if err := tx.QueryRowContext(ctxOrBackground(ctx), `
SELECT COUNT(1) FROM ai_upload_staging_scopes
WHERE staging_scope_id = ? AND endpoint_id = ? AND owner_user_hash = ? AND target_id = ?
  AND capability_hash = ? AND released_at_unix_ms = 0 AND expires_at_unix_ms > ?
`, scope.StagingScopeID, scope.EndpointID, scope.OwnerUserHash, scope.TargetID, scope.CapabilityHash, time.Now().UnixMilli()).Scan(&active); err != nil || active != 1 {
		return errors.New("upload staging scope is unavailable")
	}
	var storedFingerprint, storedUploadID, status string
	if err := tx.QueryRowContext(ctxOrBackground(ctx), `
SELECT request_fingerprint, upload_id, status FROM ai_upload_attempts
WHERE endpoint_id = ? AND owner_user_hash = ? AND upload_request_id = ?
`, attempt.EndpointID, attempt.OwnerUserHash, attempt.UploadRequestID).Scan(&storedFingerprint, &storedUploadID, &status); err != nil {
		return err
	}
	if storedFingerprint != attempt.RequestFingerprint || storedUploadID != rec.UploadID {
		return ErrUploadIdempotencyConflict
	}
	if status == UploadAttemptComplete {
		var refs int
		if err := tx.QueryRowContext(ctxOrBackground(ctx), `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = ? AND ref_kind = ? AND ref_id = ?`, rec.EndpointID, rec.UploadID, UploadRefKindStaging, refID).Scan(&refs); err != nil {
			return err
		}
		if refs != 1 {
			return errors.New("completed upload is missing its staging claim")
		}
		return tx.Commit()
	}
	if status != UploadAttemptReceiving {
		return errors.New("upload attempt is not receiving")
	}
	if rec.OwnerScopeKind == UploadOwnerScopeUser {
		if err := enforceUploadQuotaTx(ctxOrBackground(ctx), tx, rec.EndpointID, rec.OwnerUserHash, "", UploadStateStaged, rec.SizeBytes); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctxOrBackground(ctx), `
INSERT INTO ai_uploads(
  upload_id, endpoint_id, owner_scope_kind, owner_user_hash, storage_relpath, name,
  declared_media_type, detected_media_type, size_bytes, content_sha256,
  unicode_code_points, logical_line_count, source, state,
  created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, uploadRecordArgs(rec)...); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctxOrBackground(ctx), `
UPDATE ai_upload_attempts SET status = ?, error_code = '', updated_at_unix_ms = ?
WHERE endpoint_id = ? AND owner_user_hash = ? AND upload_request_id = ? AND status = ?
`, UploadAttemptComplete, time.Now().UnixMilli(), attempt.EndpointID, attempt.OwnerUserHash, attempt.UploadRequestID, UploadAttemptReceiving); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctxOrBackground(ctx), `
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
VALUES(?, ?, ?, ?, ?, ?)
`, rec.EndpointID, rec.UploadID, scope.TargetID, UploadRefKindStaging, refID, rec.CreatedAtUnixMs); err != nil {
		return err
	}
	return tx.Commit()
}

func requireUploadStagingScopeActiveTx(ctx context.Context, tx *sql.Tx, scope UploadStagingScope, nowUnixMs int64) error {
	scope = normalizeUploadStagingScope(scope)
	if err := validateUploadStagingScope(scope); err != nil {
		return err
	}
	var count int
	if err := tx.QueryRowContext(ctx, `
SELECT COUNT(1) FROM ai_upload_staging_scopes
WHERE staging_scope_id = ? AND endpoint_id = ? AND owner_user_hash = ? AND target_id = ?
  AND capability_hash = ? AND released_at_unix_ms = 0 AND expires_at_unix_ms > ?
`, scope.StagingScopeID, scope.EndpointID, scope.OwnerUserHash, scope.TargetID, scope.CapabilityHash, nowUnixMs).Scan(&count); err != nil {
		return err
	}
	if count != 1 {
		return errors.New("upload staging scope is unavailable")
	}
	return nil
}

func normalizeFrozenQueuedTurn(rec QueuedTurn) (QueuedTurn, error) {
	rec.QueueID = strings.TrimSpace(rec.QueueID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	rec.ChannelID = strings.TrimSpace(rec.ChannelID)
	lane, err := parseFollowupLane(rec.Lane)
	if err != nil {
		return QueuedTurn{}, err
	}
	rec.Lane = lane
	rec.TurnID = strings.TrimSpace(rec.TurnID)
	rec.RunID = strings.TrimSpace(rec.RunID)
	rec.ModelID = strings.TrimSpace(rec.ModelID)
	if !utf8.ValidString(rec.TextContent) {
		return QueuedTurn{}, errors.New("invalid text content")
	}
	rec.AttachmentsJSON = strings.TrimSpace(rec.AttachmentsJSON)
	rec.ContextActionJSON = strings.TrimSpace(rec.ContextActionJSON)
	rec.OptionsJSON = strings.TrimSpace(rec.OptionsJSON)
	rec.SessionMetaJSON = strings.TrimSpace(rec.SessionMetaJSON)
	rec.CreatedByUserPublicID = strings.TrimSpace(rec.CreatedByUserPublicID)
	rec.CreatedByUserEmail = strings.TrimSpace(rec.CreatedByUserEmail)
	if rec.QueueID == "" || rec.EndpointID == "" || rec.ThreadID == "" || rec.ChannelID == "" || rec.TurnID != "" || rec.RunID != "" {
		return QueuedTurn{}, errors.New("invalid request")
	}
	if rec.AttachmentsJSON == "" {
		rec.AttachmentsJSON = "[]"
	}
	if rec.OptionsJSON == "" {
		rec.OptionsJSON = "{}"
	}
	if rec.SessionMetaJSON == "" {
		rec.SessionMetaJSON = "{}"
	}
	now := time.Now().UnixMilli()
	if rec.CreatedAtUnixMs <= 0 {
		rec.CreatedAtUnixMs = now
	}
	if rec.UpdatedAtUnixMs <= 0 {
		rec.UpdatedAtUnixMs = rec.CreatedAtUnixMs
	}
	return rec, nil
}

func sameFrozenQueuedTurn(a, b QueuedTurn) bool {
	return a.EndpointID == b.EndpointID && a.ThreadID == b.ThreadID && a.TurnID == b.TurnID &&
		a.RunID == b.RunID && a.ModelID == b.ModelID && a.TextContent == b.TextContent &&
		a.AttachmentsJSON == b.AttachmentsJSON && a.ContextActionJSON == b.ContextActionJSON &&
		a.OptionsJSON == b.OptionsJSON && a.SessionMetaJSON == b.SessionMetaJSON && a.ChannelID == b.ChannelID
}

func (s *Store) CreateFollowupFromStaging(ctx context.Context, rec QueuedTurn, uploadIDs []string, claimedAtUnixMs int64, attachmentAdmission AttachmentAdmission, scope UploadStagingScope) (QueuedTurn, int, int64, error) {
	if s == nil || s.db == nil {
		return QueuedTurn{}, 0, 0, errors.New("store not initialized")
	}
	var err error
	rec, err = normalizeFrozenQueuedTurn(rec)
	if err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	scope = normalizeUploadStagingScope(scope)
	if scope.EndpointID != rec.EndpointID || scope.TargetID != rec.ThreadID {
		return QueuedTurn{}, 0, 0, errors.New("upload staging target changed")
	}
	uploadIDs = dedupeNonEmptyStrings(uploadIDs)
	if claimedAtUnixMs <= 0 {
		claimedAtUnixMs = rec.CreatedAtUnixMs
	}
	tx, err := s.db.BeginTx(ctxOrBackground(ctx), nil)
	if err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireUploadStagingScopeActiveTx(ctxOrBackground(ctx), tx, scope, time.Now().UnixMilli()); err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	if err := validateAttachmentAdmissionTx(ctxOrBackground(ctx), tx, rec.EndpointID, uploadIDs, attachmentAdmission); err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	queued, position, revision, err := createFollowupTx(ctxOrBackground(ctx), tx, rec)
	if err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	if !sameFrozenQueuedTurn(queued, rec) {
		return QueuedTurn{}, 0, 0, errors.New("turn id conflicts with a different frozen command")
	}
	refID := stagingUploadRefID(scope.OwnerUserHash, scope.StagingScopeID)
	if err := bindUploadsToRefTx(ctxOrBackground(ctx), tx, rec.EndpointID, rec.ThreadID, UploadRefKindQueuedTurn, queued.QueueID, uploadIDs, claimedAtUnixMs, UploadRefKindStaging, refID, scope.OwnerUserHash); err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	if err := tx.Commit(); err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	return queued, position, revision, nil
}

func normalizeUploadStagingScope(scope UploadStagingScope) UploadStagingScope {
	scope.StagingScopeID = strings.TrimSpace(scope.StagingScopeID)
	scope.EndpointID = strings.TrimSpace(scope.EndpointID)
	scope.OwnerUserHash = strings.ToLower(strings.TrimSpace(scope.OwnerUserHash))
	scope.TargetID = strings.TrimSpace(scope.TargetID)
	scope.CapabilityHash = strings.ToLower(strings.TrimSpace(scope.CapabilityHash))
	return scope
}

func validateUploadStagingScope(scope UploadStagingScope) error {
	if scope.StagingScopeID == "" || scope.EndpointID == "" || len(scope.OwnerUserHash) != 64 || scope.TargetID == "" || len(scope.CapabilityHash) != 64 || scope.CreatedAtUnixMs <= 0 || scope.ExpiresAtUnixMs <= scope.CreatedAtUnixMs {
		return errors.New("invalid upload staging scope")
	}
	return nil
}

func (s *Store) CreateUploadStagingScope(ctx context.Context, scope UploadStagingScope) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	scope = normalizeUploadStagingScope(scope)
	if err := validateUploadStagingScope(scope); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctxOrBackground(ctx), `
INSERT INTO ai_upload_staging_scopes(
  staging_scope_id, endpoint_id, owner_user_hash, target_id, capability_hash,
  created_at_unix_ms, expires_at_unix_ms, released_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, 0)
`, scope.StagingScopeID, scope.EndpointID, scope.OwnerUserHash, scope.TargetID, scope.CapabilityHash, scope.CreatedAtUnixMs, scope.ExpiresAtUnixMs)
	return err
}

func loadUploadStagingScopeRow(row *sql.Row) (UploadStagingScope, error) {
	var scope UploadStagingScope
	err := row.Scan(&scope.StagingScopeID, &scope.EndpointID, &scope.OwnerUserHash, &scope.TargetID, &scope.CapabilityHash, &scope.CreatedAtUnixMs, &scope.ExpiresAtUnixMs, &scope.ReleasedAtUnixMs)
	return normalizeUploadStagingScope(scope), err
}

func (s *Store) AuthorizeUploadStagingScope(ctx context.Context, endpointID, ownerUserHash, stagingScopeID, capabilityHash string, nowUnixMs int64) (UploadStagingScope, error) {
	if s == nil || s.db == nil {
		return UploadStagingScope{}, errors.New("store not initialized")
	}
	endpointID = strings.TrimSpace(endpointID)
	ownerUserHash = strings.ToLower(strings.TrimSpace(ownerUserHash))
	stagingScopeID = strings.TrimSpace(stagingScopeID)
	capabilityHash = strings.ToLower(strings.TrimSpace(capabilityHash))
	if endpointID == "" || len(ownerUserHash) != 64 || stagingScopeID == "" || len(capabilityHash) != 64 || nowUnixMs <= 0 {
		return UploadStagingScope{}, sql.ErrNoRows
	}
	scope, err := loadUploadStagingScopeRow(s.db.QueryRowContext(ctxOrBackground(ctx), `
SELECT staging_scope_id, endpoint_id, owner_user_hash, target_id, capability_hash,
       created_at_unix_ms, expires_at_unix_ms, released_at_unix_ms
FROM ai_upload_staging_scopes WHERE staging_scope_id = ?
`, stagingScopeID))
	if err != nil || scope.EndpointID != endpointID || scope.OwnerUserHash != ownerUserHash || scope.ReleasedAtUnixMs != 0 || scope.ExpiresAtUnixMs <= nowUnixMs || subtle.ConstantTimeCompare([]byte(scope.CapabilityHash), []byte(capabilityHash)) != 1 {
		return UploadStagingScope{}, sql.ErrNoRows
	}
	return scope, nil
}

func stagingUploadRefID(ownerUserHash, stagingScopeID string) string {
	ownerUserHash = strings.ToLower(strings.TrimSpace(ownerUserHash))
	stagingScopeID = strings.TrimSpace(stagingScopeID)
	if len(ownerUserHash) != 64 || stagingScopeID == "" {
		return ""
	}
	digest := sha256.Sum256([]byte("redeven-upload-staging-v1\x00" + ownerUserHash + "\x00" + stagingScopeID))
	return "staging_ref_v1_" + hex.EncodeToString(digest[:])
}

func (s *Store) GetStagingOwnedUpload(ctx context.Context, endpointID, ownerUserHash, stagingScopeID, uploadID string) (*UploadRecord, error) {
	refID := stagingUploadRefID(ownerUserHash, stagingScopeID)
	if refID == "" {
		return nil, sql.ErrNoRows
	}
	var rec UploadRecord
	if err := scanUploadRow(s.db.QueryRowContext(ctxOrBackground(ctx), `
SELECT u.upload_id, u.endpoint_id, u.owner_scope_kind, u.owner_user_hash, u.storage_relpath, u.name,
       u.declared_media_type, u.detected_media_type, u.size_bytes, u.content_sha256,
       u.unicode_code_points, u.logical_line_count, u.source, u.state,
       u.created_at_unix_ms, u.claimed_at_unix_ms, u.delete_after_unix_ms
FROM ai_uploads u
JOIN ai_upload_refs r ON r.endpoint_id = u.endpoint_id AND r.upload_id = u.upload_id
WHERE u.endpoint_id = ? AND u.owner_scope_kind = ? AND u.owner_user_hash = ?
	  AND u.upload_id = ? AND u.state = ? AND r.ref_kind = ? AND r.ref_id = ?
`, strings.TrimSpace(endpointID), UploadOwnerScopeUser, strings.ToLower(strings.TrimSpace(ownerUserHash)), strings.TrimSpace(uploadID), UploadStateStaged, UploadRefKindStaging, refID), &rec); err != nil {
		return nil, err
	}
	return &rec, nil
}

func (s *Store) ReleaseUploadStagingScope(ctx context.Context, scope UploadStagingScope, nowUnixMs int64) ([]UploadRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	scope = normalizeUploadStagingScope(scope)
	refID := stagingUploadRefID(scope.OwnerUserHash, scope.StagingScopeID)
	if refID == "" || nowUnixMs <= 0 {
		return nil, errors.New("invalid upload staging scope")
	}
	tx, err := s.db.BeginTx(ctxOrBackground(ctx), nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctxOrBackground(ctx), `
SELECT u.upload_id, u.endpoint_id, u.owner_scope_kind, u.owner_user_hash, u.storage_relpath, u.name,
       u.declared_media_type, u.detected_media_type, u.size_bytes, u.content_sha256,
       u.unicode_code_points, u.logical_line_count, u.source, u.state,
       u.created_at_unix_ms, u.claimed_at_unix_ms, u.delete_after_unix_ms
FROM ai_uploads u
JOIN ai_upload_refs r ON r.endpoint_id = u.endpoint_id AND r.upload_id = u.upload_id
WHERE r.endpoint_id = ? AND r.ref_kind = ? AND r.ref_id = ?
ORDER BY u.upload_id
`, scope.EndpointID, UploadRefKindStaging, refID)
	if err != nil {
		return nil, err
	}
	var uploads []UploadRecord
	for rows.Next() {
		var rec UploadRecord
		if scanErr := scanUploadRow(rows, &rec); scanErr != nil {
			_ = rows.Close()
			return nil, scanErr
		}
		uploads = append(uploads, rec)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctxOrBackground(ctx), `DELETE FROM ai_upload_refs WHERE endpoint_id = ? AND ref_kind = ? AND ref_id = ?`, scope.EndpointID, UploadRefKindStaging, refID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctxOrBackground(ctx), `UPDATE ai_upload_staging_scopes SET released_at_unix_ms = ? WHERE staging_scope_id = ? AND released_at_unix_ms = 0`, nowUnixMs, scope.StagingScopeID); err != nil {
		return nil, err
	}
	var cleanup []UploadRecord
	for _, rec := range uploads {
		var refs int
		if err := tx.QueryRowContext(ctxOrBackground(ctx), `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = ?`, rec.EndpointID, rec.UploadID).Scan(&refs); err != nil {
			return nil, err
		}
		if refs == 0 {
			if _, err := tx.ExecContext(ctxOrBackground(ctx), `UPDATE ai_uploads SET state = ?, delete_after_unix_ms = ? WHERE endpoint_id = ? AND upload_id = ?`, UploadStateDeleting, nowUnixMs, rec.EndpointID, rec.UploadID); err != nil {
				return nil, err
			}
			rec.State = UploadStateDeleting
			cleanup = append(cleanup, rec)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return cleanup, nil
}

func (s *Store) ReleaseUploadStagingScopeUpload(ctx context.Context, scope UploadStagingScope, uploadID string, nowUnixMs int64) ([]UploadRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	scope = normalizeUploadStagingScope(scope)
	uploadID = strings.TrimSpace(uploadID)
	refID := stagingUploadRefID(scope.OwnerUserHash, scope.StagingScopeID)
	if refID == "" || uploadID == "" || nowUnixMs <= 0 {
		return nil, errors.New("invalid upload staging resource")
	}
	tx, err := s.db.BeginTx(ctxOrBackground(ctx), nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	var rec UploadRecord
	if err := scanUploadRow(tx.QueryRowContext(ctxOrBackground(ctx), `
SELECT u.upload_id, u.endpoint_id, u.owner_scope_kind, u.owner_user_hash, u.storage_relpath, u.name,
       u.declared_media_type, u.detected_media_type, u.size_bytes, u.content_sha256,
       u.unicode_code_points, u.logical_line_count, u.source, u.state,
       u.created_at_unix_ms, u.claimed_at_unix_ms, u.delete_after_unix_ms
FROM ai_uploads u
JOIN ai_upload_refs r ON r.endpoint_id = u.endpoint_id AND r.upload_id = u.upload_id
WHERE u.endpoint_id = ? AND u.upload_id = ? AND u.owner_scope_kind = ? AND u.owner_user_hash = ?
  AND r.ref_kind = ? AND r.ref_id = ?
`, scope.EndpointID, uploadID, UploadOwnerScopeUser, scope.OwnerUserHash, UploadRefKindStaging, refID), &rec); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctxOrBackground(ctx), `DELETE FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = ? AND ref_kind = ? AND ref_id = ?`, scope.EndpointID, uploadID, UploadRefKindStaging, refID); err != nil {
		return nil, err
	}
	var refs int
	if err := tx.QueryRowContext(ctxOrBackground(ctx), `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = ?`, scope.EndpointID, uploadID).Scan(&refs); err != nil {
		return nil, err
	}
	var cleanup []UploadRecord
	if refs == 0 {
		if _, err := tx.ExecContext(ctxOrBackground(ctx), `UPDATE ai_uploads SET state = ?, delete_after_unix_ms = ? WHERE endpoint_id = ? AND upload_id = ?`, UploadStateDeleting, nowUnixMs, scope.EndpointID, uploadID); err != nil {
			return nil, err
		}
		rec.State = UploadStateDeleting
		rec.DeleteAfterUnixMs = nowUnixMs
		cleanup = append(cleanup, rec)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return cleanup, nil
}

func (s *Store) ReleaseExpiredUploadStagingScopes(ctx context.Context, nowUnixMs int64, limit int) ([]UploadRecord, int, error) {
	if s == nil || s.db == nil {
		return nil, 0, errors.New("store not initialized")
	}
	if nowUnixMs <= 0 || limit <= 0 || limit > 500 {
		return nil, 0, errors.New("invalid upload staging expiry sweep")
	}
	tx, err := s.db.BeginTx(ctxOrBackground(ctx), nil)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctxOrBackground(ctx), `
SELECT staging_scope_id, endpoint_id, owner_user_hash, target_id, capability_hash,
       created_at_unix_ms, expires_at_unix_ms, released_at_unix_ms
FROM ai_upload_staging_scopes
WHERE released_at_unix_ms = 0 AND expires_at_unix_ms <= ?
ORDER BY expires_at_unix_ms, staging_scope_id
LIMIT ?
`, nowUnixMs, limit)
	if err != nil {
		return nil, 0, err
	}
	var scopes []UploadStagingScope
	for rows.Next() {
		var scope UploadStagingScope
		if err := rows.Scan(&scope.StagingScopeID, &scope.EndpointID, &scope.OwnerUserHash, &scope.TargetID, &scope.CapabilityHash, &scope.CreatedAtUnixMs, &scope.ExpiresAtUnixMs, &scope.ReleasedAtUnixMs); err != nil {
			_ = rows.Close()
			return nil, 0, err
		}
		scopes = append(scopes, normalizeUploadStagingScope(scope))
	}
	if err := rows.Close(); err != nil {
		return nil, 0, err
	}
	if len(scopes) == 0 {
		return nil, 0, tx.Commit()
	}
	candidates := make(map[string]UploadRecord)
	for _, scope := range scopes {
		refID := stagingUploadRefID(scope.OwnerUserHash, scope.StagingScopeID)
		if refID == "" {
			return nil, 0, errors.New("expired upload staging scope is malformed")
		}
		uploadRows, err := tx.QueryContext(ctxOrBackground(ctx), `
SELECT u.upload_id, u.endpoint_id, u.owner_scope_kind, u.owner_user_hash, u.storage_relpath, u.name,
       u.declared_media_type, u.detected_media_type, u.size_bytes, u.content_sha256,
       u.unicode_code_points, u.logical_line_count, u.source, u.state,
       u.created_at_unix_ms, u.claimed_at_unix_ms, u.delete_after_unix_ms
FROM ai_uploads u
JOIN ai_upload_refs r ON r.endpoint_id = u.endpoint_id AND r.upload_id = u.upload_id
WHERE r.endpoint_id = ? AND r.ref_kind = ? AND r.ref_id = ?
ORDER BY u.upload_id
`, scope.EndpointID, UploadRefKindStaging, refID)
		if err != nil {
			return nil, 0, err
		}
		for uploadRows.Next() {
			var rec UploadRecord
			if err := scanUploadRow(uploadRows, &rec); err != nil {
				_ = uploadRows.Close()
				return nil, 0, err
			}
			candidates[rec.EndpointID+"\x00"+rec.UploadID] = rec
		}
		if err := uploadRows.Close(); err != nil {
			return nil, 0, err
		}
		if _, err := tx.ExecContext(ctxOrBackground(ctx), `DELETE FROM ai_upload_refs WHERE endpoint_id = ? AND ref_kind = ? AND ref_id = ?`, scope.EndpointID, UploadRefKindStaging, refID); err != nil {
			return nil, 0, err
		}
		if _, err := tx.ExecContext(ctxOrBackground(ctx), `UPDATE ai_upload_staging_scopes SET released_at_unix_ms = ? WHERE staging_scope_id = ? AND released_at_unix_ms = 0`, nowUnixMs, scope.StagingScopeID); err != nil {
			return nil, 0, err
		}
	}
	cleanup := make([]UploadRecord, 0, len(candidates))
	for _, rec := range candidates {
		var refs int
		if err := tx.QueryRowContext(ctxOrBackground(ctx), `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = ?`, rec.EndpointID, rec.UploadID).Scan(&refs); err != nil {
			return nil, 0, err
		}
		if refs != 0 {
			continue
		}
		if _, err := tx.ExecContext(ctxOrBackground(ctx), `UPDATE ai_uploads SET state = ?, delete_after_unix_ms = ? WHERE endpoint_id = ? AND upload_id = ?`, UploadStateDeleting, nowUnixMs, rec.EndpointID, rec.UploadID); err != nil {
			return nil, 0, err
		}
		rec.State = UploadStateDeleting
		rec.DeleteAfterUnixMs = nowUnixMs
		cleanup = append(cleanup, rec)
	}
	if err := tx.Commit(); err != nil {
		return nil, 0, err
	}
	return cleanup, len(scopes), nil
}
