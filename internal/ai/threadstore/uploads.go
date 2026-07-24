package threadstore

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrUploadIdempotencyConflict = errors.New("upload idempotency conflict")
	ErrUploadInProgress          = errors.New("upload is still in progress")
	ErrUploadQuotaExceeded       = errors.New("upload quota exceeded")
)

const (
	UploadStateStaged   = "staged"
	UploadStateLive     = "live"
	UploadStateDeleting = "deleting"

	UploadRefKindThread       = "thread"
	UploadRefKindQueuedTurn   = "queued_turn"
	UploadRefKindDraft        = "draft"
	UploadRefKindDraftPending = "draft_pending"

	UploadOwnerScopeUser                   = "user"
	UploadOwnerScopeLegacyThread           = "legacy_thread"
	UploadOwnerScopeLegacyStagedQuarantine = "legacy_staged_quarantine"

	UploadSourceFile     = "uploaded_file"
	UploadSourceLongText = "long_text"

	UploadAttemptReceiving = "receiving"
	UploadAttemptComplete  = "complete"
	UploadAttemptFailed    = "failed"

	UploadStagedOwnerItemLimit      = 100
	UploadStagedOwnerByteLimit      = int64(100 << 20)
	UploadLiveOwnerItemLimit        = 1000
	UploadLiveOwnerByteLimit        = int64(1 << 30)
	UploadLiveThreadItemLimit       = 1000
	UploadLiveThreadByteLimit       = int64(250 << 20)
	AttachmentAdmissionMaxCount     = 10
	AttachmentAdmissionMaxTurnBytes = int64(25 << 20)

	sqliteAutoVacuumNone        = 0
	sqliteAutoVacuumFull        = 1
	sqliteAutoVacuumIncremental = 2

	sqliteCompactionMinFreeBytes = 4 << 20
	sqliteCompactionMinFreePages = 256
	sqliteCompactionMinFreeRatio = 10
)

type UploadQuotaError struct {
	Scope  string
	Metric string
	Limit  int64
}

func (e *UploadQuotaError) Error() string {
	if e == nil {
		return ErrUploadQuotaExceeded.Error()
	}
	return fmt.Sprintf("%s: scope=%s metric=%s limit=%d", ErrUploadQuotaExceeded, e.Scope, e.Metric, e.Limit)
}

func (e *UploadQuotaError) Unwrap() error { return ErrUploadQuotaExceeded }

type UploadRecord struct {
	UploadID          string `json:"upload_id"`
	EndpointID        string `json:"endpoint_id"`
	OwnerScopeKind    string `json:"owner_scope_kind"`
	OwnerUserHash     string `json:"owner_user_hash,omitempty"`
	StorageRelPath    string `json:"storage_relpath"`
	Name              string `json:"name"`
	DeclaredMediaType string `json:"declared_media_type,omitempty"`
	DetectedMediaType string `json:"detected_media_type"`
	MimeType          string `json:"mime_type"`
	SizeBytes         int64  `json:"size_bytes"`
	ContentSHA256     string `json:"content_sha256,omitempty"`
	UnicodeCodePoints *int64 `json:"unicode_code_points,omitempty"`
	LogicalLineCount  *int64 `json:"logical_line_count,omitempty"`
	Source            string `json:"source"`
	State             string `json:"state"`
	CreatedAtUnixMs   int64  `json:"created_at_unix_ms"`
	ClaimedAtUnixMs   int64  `json:"claimed_at_unix_ms"`
	DeleteAfterUnixMs int64  `json:"delete_after_unix_ms"`
}

type UploadAttemptRecord struct {
	EndpointID         string
	OwnerUserHash      string
	UploadRequestID    string
	RequestFingerprint string
	UploadID           string
	Status             string
	ErrorCode          string
	CreatedAtUnixMs    int64
	UpdatedAtUnixMs    int64
}

type UploadRefRecord struct {
	ID              int64  `json:"id"`
	EndpointID      string `json:"endpoint_id"`
	UploadID        string `json:"upload_id"`
	ThreadID        string `json:"thread_id"`
	RefKind         string `json:"ref_kind"`
	RefID           string `json:"ref_id"`
	CreatedAtUnixMs int64  `json:"created_at_unix_ms"`
}

type FollowupDeleteResourcesResult struct {
	Revision        int64
	UploadsToDelete []UploadRecord
}

type FollowupReplacementResult struct {
	Queued          QueuedTurn
	Position        int
	Revision        int64
	UploadsToDelete []UploadRecord
}

type SQLitePageStats struct {
	PageSize       int64
	PageCount      int64
	FreelistCount  int64
	AutoVacuumMode int64
}

type SQLiteCompactionPlan struct {
	ShouldCompact  bool
	UseIncremental bool
	PageSize       int64
	PageCount      int64
	FreelistCount  int64
	FreeBytes      int64
	PagesToRelease int64
}

func normalizeUploadState(state string) string {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case UploadStateLive:
		return UploadStateLive
	case UploadStateDeleting:
		return UploadStateDeleting
	default:
		return UploadStateStaged
	}
}

func normalizeUploadRefKind(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case UploadRefKindQueuedTurn:
		return UploadRefKindQueuedTurn
	case UploadRefKindThread:
		return UploadRefKindThread
	case UploadRefKindDraft:
		return UploadRefKindDraft
	case UploadRefKindDraftPending:
		return UploadRefKindDraftPending
	default:
		return ""
	}
}

func composerDraftUploadRefID(ownerUserHash string, scopeID string) string {
	ownerUserHash = strings.ToLower(strings.TrimSpace(ownerUserHash))
	scopeID = strings.TrimSpace(scopeID)
	if len(ownerUserHash) != 64 || scopeID == "" {
		return ""
	}
	digest := sha256.Sum256([]byte(ownerUserHash + "\x00" + scopeID))
	return "draft_ref_v1_" + hex.EncodeToString(digest[:])
}

func sanitizeUploadStorageRelPath(raw string) string {
	raw = filepath.Base(strings.TrimSpace(raw))
	switch raw {
	case "", ".", string(filepath.Separator):
		return ""
	default:
		return raw
	}
}

func normalizeUploadRecord(rec UploadRecord) UploadRecord {
	rec.UploadID = strings.TrimSpace(rec.UploadID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.OwnerScopeKind = strings.ToLower(strings.TrimSpace(rec.OwnerScopeKind))
	if rec.OwnerScopeKind == "" {
		rec.OwnerScopeKind = UploadOwnerScopeLegacyStagedQuarantine
	}
	rec.OwnerUserHash = strings.ToLower(strings.TrimSpace(rec.OwnerUserHash))
	rec.StorageRelPath = sanitizeUploadStorageRelPath(rec.StorageRelPath)
	rec.Name = strings.TrimSpace(rec.Name)
	rec.DeclaredMediaType = strings.TrimSpace(rec.DeclaredMediaType)
	rec.DetectedMediaType = strings.TrimSpace(rec.DetectedMediaType)
	if rec.DetectedMediaType == "" {
		rec.DetectedMediaType = strings.TrimSpace(rec.MimeType)
	}
	if rec.DetectedMediaType == "" {
		rec.DetectedMediaType = "application/octet-stream"
	}
	rec.MimeType = rec.DetectedMediaType
	rec.ContentSHA256 = strings.ToLower(strings.TrimSpace(rec.ContentSHA256))
	rec.Source = strings.ToLower(strings.TrimSpace(rec.Source))
	if rec.Source != UploadSourceLongText {
		rec.Source = UploadSourceFile
	}
	if rec.SizeBytes < 0 {
		rec.SizeBytes = 0
	}
	rec.State = normalizeUploadState(rec.State)
	if rec.CreatedAtUnixMs <= 0 {
		rec.CreatedAtUnixMs = time.Now().UnixMilli()
	}
	if rec.ClaimedAtUnixMs < 0 {
		rec.ClaimedAtUnixMs = 0
	}
	if rec.DeleteAfterUnixMs < 0 {
		rec.DeleteAfterUnixMs = 0
	}
	return rec
}

func scanUploadRow(scan rowScanner, rec *UploadRecord) error {
	if rec == nil {
		return errors.New("nil upload record")
	}
	var ownerHash sql.NullString
	var unicodePoints sql.NullInt64
	var logicalLines sql.NullInt64
	if err := scan.Scan(
		&rec.UploadID,
		&rec.EndpointID,
		&rec.OwnerScopeKind,
		&ownerHash,
		&rec.StorageRelPath,
		&rec.Name,
		&rec.DeclaredMediaType,
		&rec.DetectedMediaType,
		&rec.SizeBytes,
		&rec.ContentSHA256,
		&unicodePoints,
		&logicalLines,
		&rec.Source,
		&rec.State,
		&rec.CreatedAtUnixMs,
		&rec.ClaimedAtUnixMs,
		&rec.DeleteAfterUnixMs,
	); err != nil {
		return err
	}
	if ownerHash.Valid {
		rec.OwnerUserHash = ownerHash.String
	}
	if unicodePoints.Valid {
		value := unicodePoints.Int64
		rec.UnicodeCodePoints = &value
	}
	if logicalLines.Valid {
		value := logicalLines.Int64
		rec.LogicalLineCount = &value
	}
	*rec = normalizeUploadRecord(*rec)
	return nil
}

func (s *Store) InsertUpload(ctx context.Context, rec UploadRecord) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec = normalizeUploadRecord(rec)
	if err := validateUploadRecordForWrite(rec); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO ai_uploads(
  upload_id, endpoint_id, owner_scope_kind, owner_user_hash, storage_relpath, name,
  declared_media_type, detected_media_type, size_bytes, content_sha256,
  unicode_code_points, logical_line_count, source, state,
  created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms
)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, uploadRecordArgs(rec)...)
	return err
}

func validateUploadRecordForWrite(rec UploadRecord) error {
	if rec.UploadID == "" || rec.EndpointID == "" || rec.StorageRelPath == "" {
		return errors.New("invalid request")
	}
	if rec.OwnerScopeKind == UploadOwnerScopeUser && (len(rec.OwnerUserHash) != 64 || len(rec.ContentSHA256) != 64) {
		return errors.New("user-owned upload requires owner and content digests")
	}
	return nil
}

func uploadRecordArgs(rec UploadRecord) []any {
	var ownerHash any
	if rec.OwnerUserHash != "" {
		ownerHash = rec.OwnerUserHash
	}
	return []any{rec.UploadID, rec.EndpointID, rec.OwnerScopeKind, ownerHash, rec.StorageRelPath, rec.Name,
		rec.DeclaredMediaType, rec.DetectedMediaType, rec.SizeBytes, rec.ContentSHA256,
		rec.UnicodeCodePoints, rec.LogicalLineCount, rec.Source, rec.State,
		rec.CreatedAtUnixMs, rec.ClaimedAtUnixMs, rec.DeleteAfterUnixMs}
}

func (s *Store) EnsureUpload(ctx context.Context, rec UploadRecord) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec = normalizeUploadRecord(rec)
	if err := validateUploadRecordForWrite(rec); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO ai_uploads(
  upload_id, endpoint_id, owner_scope_kind, owner_user_hash, storage_relpath, name,
  declared_media_type, detected_media_type, size_bytes, content_sha256,
  unicode_code_points, logical_line_count, source, state,
  created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms
)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(upload_id) DO NOTHING
`, uploadRecordArgs(rec)...)
	return err
}

func (s *Store) GetUpload(ctx context.Context, endpointID string, uploadID string) (*UploadRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	uploadID = strings.TrimSpace(uploadID)
	if endpointID == "" || uploadID == "" {
		return nil, errors.New("invalid request")
	}
	var rec UploadRecord
	if err := scanUploadRow(s.db.QueryRowContext(ctx, `
SELECT upload_id, endpoint_id, owner_scope_kind, owner_user_hash, storage_relpath, name,
       declared_media_type, detected_media_type, size_bytes, content_sha256,
       unicode_code_points, logical_line_count, source, state,
       created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms
FROM ai_uploads
WHERE endpoint_id = ? AND upload_id = ?
`, endpointID, uploadID), &rec); err != nil {
		return nil, err
	}
	return &rec, nil
}

func (s *Store) SealLegacyUploadDigest(ctx context.Context, endpointID, uploadID, digest string) (string, error) {
	if s == nil || s.db == nil {
		return "", errors.New("store not initialized")
	}
	endpointID = strings.TrimSpace(endpointID)
	uploadID = strings.TrimSpace(uploadID)
	digest = strings.ToLower(strings.TrimSpace(digest))
	decoded, err := hex.DecodeString(digest)
	if endpointID == "" || uploadID == "" || err != nil || len(decoded) != 32 {
		return "", errors.New("invalid legacy upload digest seal")
	}
	ctx = ctxOrBackground(ctx)
	result, err := s.db.ExecContext(ctx, `
UPDATE ai_uploads
SET content_sha256 = ?
WHERE endpoint_id = ? AND upload_id = ? AND owner_scope_kind = ? AND state = ? AND content_sha256 = ''
`, digest, endpointID, uploadID, UploadOwnerScopeLegacyThread, UploadStateLive)
	if err != nil {
		return "", err
	}
	if affected, _ := result.RowsAffected(); affected == 1 {
		return digest, nil
	}
	var sealed string
	if err := s.db.QueryRowContext(ctx, `
SELECT content_sha256
FROM ai_uploads
WHERE endpoint_id = ? AND upload_id = ? AND owner_scope_kind = ? AND state = ?
`, endpointID, uploadID, UploadOwnerScopeLegacyThread, UploadStateLive).Scan(&sealed); err != nil {
		return "", err
	}
	sealed = strings.ToLower(strings.TrimSpace(sealed))
	if sealed == "" || sealed != digest {
		return "", errors.New("legacy upload digest changed")
	}
	return sealed, nil
}

func (s *Store) SealLegacyTextUploadMetadata(ctx context.Context, endpointID, uploadID, digest string, unicodeCodePoints, logicalLineCount int64) (string, error) {
	if s == nil || s.db == nil {
		return "", errors.New("store not initialized")
	}
	endpointID = strings.TrimSpace(endpointID)
	uploadID = strings.TrimSpace(uploadID)
	digest = strings.ToLower(strings.TrimSpace(digest))
	decoded, err := hex.DecodeString(digest)
	if endpointID == "" || uploadID == "" || err != nil || len(decoded) != 32 || unicodeCodePoints < 0 || logicalLineCount < 0 {
		return "", errors.New("invalid legacy text upload metadata seal")
	}
	ctx = ctxOrBackground(ctx)
	if _, err := s.db.ExecContext(ctx, `
UPDATE ai_uploads
SET content_sha256 = ?, unicode_code_points = ?, logical_line_count = ?
WHERE endpoint_id = ? AND upload_id = ? AND owner_scope_kind = ? AND state = ?
  AND (content_sha256 = '' OR content_sha256 = ?)
  AND (unicode_code_points IS NULL OR unicode_code_points = ?)
  AND (logical_line_count IS NULL OR logical_line_count = ?)
`, digest, unicodeCodePoints, logicalLineCount, endpointID, uploadID, UploadOwnerScopeLegacyThread, UploadStateLive,
		digest, unicodeCodePoints, logicalLineCount); err != nil {
		return "", err
	}
	var sealedDigest string
	var sealedCodePoints, sealedLineCount sql.NullInt64
	if err := s.db.QueryRowContext(ctx, `
SELECT content_sha256, unicode_code_points, logical_line_count
FROM ai_uploads
WHERE endpoint_id = ? AND upload_id = ? AND owner_scope_kind = ? AND state = ?
`, endpointID, uploadID, UploadOwnerScopeLegacyThread, UploadStateLive).Scan(
		&sealedDigest, &sealedCodePoints, &sealedLineCount,
	); err != nil {
		return "", err
	}
	sealedDigest = strings.ToLower(strings.TrimSpace(sealedDigest))
	if sealedDigest != digest || !sealedCodePoints.Valid || sealedCodePoints.Int64 != unicodeCodePoints ||
		!sealedLineCount.Valid || sealedLineCount.Int64 != logicalLineCount {
		return "", errors.New("legacy text upload metadata changed")
	}
	return sealedDigest, nil
}

func (s *Store) GetUserOwnedUpload(ctx context.Context, endpointID string, ownerUserHash string, uploadID string) (*UploadRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	endpointID = strings.TrimSpace(endpointID)
	ownerUserHash = strings.ToLower(strings.TrimSpace(ownerUserHash))
	uploadID = strings.TrimSpace(uploadID)
	if endpointID == "" || len(ownerUserHash) != 64 || uploadID == "" {
		return nil, errors.New("invalid request")
	}
	var rec UploadRecord
	if err := scanUploadRow(s.db.QueryRowContext(ctxOrBackground(ctx), `
SELECT upload_id, endpoint_id, owner_scope_kind, owner_user_hash, storage_relpath, name,
       declared_media_type, detected_media_type, size_bytes, content_sha256,
       unicode_code_points, logical_line_count, source, state,
       created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms
FROM ai_uploads
WHERE endpoint_id = ? AND owner_scope_kind = ? AND owner_user_hash = ? AND upload_id = ?
`, endpointID, UploadOwnerScopeUser, ownerUserHash, uploadID), &rec); err != nil {
		return nil, err
	}
	return &rec, nil
}

func (s *Store) PrepareUserStagedUploadDeletion(ctx context.Context, endpointID string, ownerUserHash string, uploadID string, nowUnixMs int64) (*UploadRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	endpointID = strings.TrimSpace(endpointID)
	ownerUserHash = strings.ToLower(strings.TrimSpace(ownerUserHash))
	uploadID = strings.TrimSpace(uploadID)
	if endpointID == "" || len(ownerUserHash) != 64 || uploadID == "" {
		return nil, errors.New("invalid request")
	}
	if nowUnixMs <= 0 {
		nowUnixMs = time.Now().UnixMilli()
	}
	tx, err := s.db.BeginTx(ctxOrBackground(ctx), nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	var rec UploadRecord
	if err := scanUploadRow(tx.QueryRowContext(ctxOrBackground(ctx), `
SELECT upload_id, endpoint_id, owner_scope_kind, owner_user_hash, storage_relpath, name,
       declared_media_type, detected_media_type, size_bytes, content_sha256,
       unicode_code_points, logical_line_count, source, state,
       created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms
FROM ai_uploads u
WHERE endpoint_id = ? AND owner_scope_kind = ? AND owner_user_hash = ? AND upload_id = ?
  AND state = ?
  AND NOT EXISTS (
    SELECT 1 FROM ai_upload_refs r
    WHERE r.endpoint_id = u.endpoint_id AND r.upload_id = u.upload_id
  )
`, endpointID, UploadOwnerScopeUser, ownerUserHash, uploadID, UploadStateStaged), &rec); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctxOrBackground(ctx), `
UPDATE ai_uploads SET state = ?, delete_after_unix_ms = ?
WHERE endpoint_id = ? AND owner_scope_kind = ? AND owner_user_hash = ? AND upload_id = ? AND state = ?
`, UploadStateDeleting, nowUnixMs, endpointID, UploadOwnerScopeUser, ownerUserHash, uploadID, UploadStateStaged); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	rec.State = UploadStateDeleting
	rec.DeleteAfterUnixMs = nowUnixMs
	return &rec, nil
}

func (s *Store) BindUserUploadsToDraft(ctx context.Context, endpointID string, ownerUserHash string, draftID string, uploadIDs []string, createdAtUnixMs int64) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	endpointID = strings.TrimSpace(endpointID)
	ownerUserHash = strings.ToLower(strings.TrimSpace(ownerUserHash))
	draftID = strings.TrimSpace(draftID)
	uploadIDs = dedupeNonEmptyStrings(uploadIDs)
	if endpointID == "" || len(ownerUserHash) != 64 || draftID == "" || len(uploadIDs) == 0 {
		return errors.New("invalid draft upload reference")
	}
	draftRefID := composerDraftUploadRefID(ownerUserHash, draftID)
	if createdAtUnixMs <= 0 {
		createdAtUnixMs = time.Now().UnixMilli()
	}
	tx, err := s.db.BeginTx(ctxOrBackground(ctx), nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	observeStoreTransaction(ctx, "bind_user_uploads_to_draft")
	if err := requireComposerDraftScopeWritableTx(ctxOrBackground(ctx), tx, endpointID, draftID); err != nil {
		return err
	}
	for _, uploadID := range uploadIDs {
		var state string
		if err := tx.QueryRowContext(ctxOrBackground(ctx), `
SELECT state FROM ai_uploads
WHERE endpoint_id = ? AND owner_scope_kind = ? AND owner_user_hash = ? AND upload_id = ?
`, endpointID, UploadOwnerScopeUser, ownerUserHash, uploadID).Scan(&state); err != nil {
			return err
		}
		if state != UploadStateStaged {
			return errors.New("draft attachment is not staged")
		}
		var otherDraft string
		err := tx.QueryRowContext(ctxOrBackground(ctx), `
SELECT ref_id FROM ai_upload_refs
	WHERE endpoint_id = ? AND upload_id = ? AND ref_kind IN (?, ?) AND ref_id <> ?
	LIMIT 1
		`, endpointID, uploadID, UploadRefKindDraft, UploadRefKindDraftPending, draftRefID).Scan(&otherDraft)
		if err == nil {
			return errors.New("attachment is already claimed by another draft")
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if _, err := tx.ExecContext(ctxOrBackground(ctx), `
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
	VALUES(?, ?, ?, ?, ?, ?)
	ON CONFLICT(endpoint_id, upload_id, ref_kind, ref_id) DO NOTHING
		`, endpointID, uploadID, draftID, UploadRefKindDraft, draftRefID, createdAtUnixMs); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctxOrBackground(ctx), `
DELETE FROM ai_upload_refs
WHERE endpoint_id = ? AND upload_id = ? AND ref_kind = ? AND ref_id = ?
`, endpointID, uploadID, UploadRefKindDraftPending, draftRefID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) GetDraftOwnedUpload(ctx context.Context, endpointID string, ownerUserHash string, draftID string, uploadID string) (*UploadRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	ownerUserHash = strings.ToLower(strings.TrimSpace(ownerUserHash))
	draftID = strings.TrimSpace(draftID)
	draftRefID := composerDraftUploadRefID(ownerUserHash, draftID)
	if draftRefID == "" {
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
WHERE u.endpoint_id = ? AND u.owner_scope_kind = ? AND u.owner_user_hash = ? AND u.upload_id = ?
  AND u.state = ? AND r.ref_kind IN (?, ?) AND r.ref_id = ?
	`, strings.TrimSpace(endpointID), UploadOwnerScopeUser, ownerUserHash,
		strings.TrimSpace(uploadID), UploadStateStaged, UploadRefKindDraft, UploadRefKindDraftPending, draftRefID), &rec); err != nil {
		return nil, err
	}
	return &rec, nil
}

func (s *Store) ReleaseUserDraftUploads(ctx context.Context, endpointID string, ownerUserHash string, draftID string, uploadIDs []string, deleteAfterUnixMs int64) ([]UploadRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	endpointID = strings.TrimSpace(endpointID)
	ownerUserHash = strings.ToLower(strings.TrimSpace(ownerUserHash))
	draftID = strings.TrimSpace(draftID)
	uploadIDs = dedupeNonEmptyStrings(uploadIDs)
	if endpointID == "" || len(ownerUserHash) != 64 || draftID == "" || len(uploadIDs) == 0 {
		return nil, errors.New("invalid draft upload reference")
	}
	draftRefID := composerDraftUploadRefID(ownerUserHash, draftID)
	tx, err := s.db.BeginTx(ctxOrBackground(ctx), nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	for _, uploadID := range uploadIDs {
		result, err := tx.ExecContext(ctxOrBackground(ctx), `
DELETE FROM ai_upload_refs
WHERE endpoint_id = ? AND upload_id = ? AND ref_kind IN (?, ?) AND ref_id = ?
  AND EXISTS (
    SELECT 1 FROM ai_uploads u
    WHERE u.endpoint_id = ai_upload_refs.endpoint_id AND u.upload_id = ai_upload_refs.upload_id
      AND u.owner_scope_kind = ? AND u.owner_user_hash = ?
  )
	`, endpointID, uploadID, UploadRefKindDraft, UploadRefKindDraftPending, draftRefID, UploadOwnerScopeUser, ownerUserHash)
		if err != nil {
			return nil, err
		}
		if affected, err := result.RowsAffected(); err != nil || affected != 1 {
			if err != nil {
				return nil, err
			}
			return nil, sql.ErrNoRows
		}
	}
	cleanup, err := collectUnreferencedUploadsTx(ctxOrBackground(ctx), tx, endpointID, uploadIDs, deleteAfterUnixMs)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return cleanup, nil
}

func (s *Store) ReserveUploadAttempt(ctx context.Context, attempt UploadAttemptRecord) (UploadAttemptRecord, bool, error) {
	if s == nil || s.db == nil {
		return UploadAttemptRecord{}, false, errors.New("store not initialized")
	}
	attempt.EndpointID = strings.TrimSpace(attempt.EndpointID)
	attempt.OwnerUserHash = strings.ToLower(strings.TrimSpace(attempt.OwnerUserHash))
	attempt.UploadRequestID = strings.TrimSpace(attempt.UploadRequestID)
	attempt.RequestFingerprint = strings.ToLower(strings.TrimSpace(attempt.RequestFingerprint))
	attempt.UploadID = strings.TrimSpace(attempt.UploadID)
	if attempt.EndpointID == "" || len(attempt.OwnerUserHash) != 64 || attempt.UploadRequestID == "" || attempt.RequestFingerprint == "" || attempt.UploadID == "" {
		return UploadAttemptRecord{}, false, errors.New("invalid upload attempt")
	}
	if attempt.CreatedAtUnixMs <= 0 {
		attempt.CreatedAtUnixMs = time.Now().UnixMilli()
	}
	attempt.UpdatedAtUnixMs = attempt.CreatedAtUnixMs
	attempt.Status = UploadAttemptReceiving
	tx, err := s.db.BeginTx(ctxOrBackground(ctx), nil)
	if err != nil {
		return UploadAttemptRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	var existing UploadAttemptRecord
	err = tx.QueryRowContext(ctxOrBackground(ctx), `
SELECT endpoint_id, owner_user_hash, upload_request_id, request_fingerprint, upload_id,
       status, error_code, created_at_unix_ms, updated_at_unix_ms
FROM ai_upload_attempts
WHERE endpoint_id = ? AND owner_user_hash = ? AND upload_request_id = ?
`, attempt.EndpointID, attempt.OwnerUserHash, attempt.UploadRequestID).Scan(
		&existing.EndpointID, &existing.OwnerUserHash, &existing.UploadRequestID,
		&existing.RequestFingerprint, &existing.UploadID, &existing.Status, &existing.ErrorCode,
		&existing.CreatedAtUnixMs, &existing.UpdatedAtUnixMs,
	)
	if err == nil {
		if existing.RequestFingerprint != attempt.RequestFingerprint {
			return UploadAttemptRecord{}, false, ErrUploadIdempotencyConflict
		}
		if err := tx.Commit(); err != nil {
			return UploadAttemptRecord{}, false, err
		}
		return existing, false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return UploadAttemptRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctxOrBackground(ctx), `
INSERT INTO ai_upload_attempts(
  endpoint_id, owner_user_hash, upload_request_id, request_fingerprint, upload_id,
  status, error_code, created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, '', ?, ?)
`, attempt.EndpointID, attempt.OwnerUserHash, attempt.UploadRequestID, attempt.RequestFingerprint,
		attempt.UploadID, attempt.Status, attempt.CreatedAtUnixMs, attempt.UpdatedAtUnixMs); err != nil {
		return UploadAttemptRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return UploadAttemptRecord{}, false, err
	}
	return attempt, true, nil
}

func (s *Store) CompleteUploadAttempt(ctx context.Context, attempt UploadAttemptRecord, rec UploadRecord, draftID string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	rec = normalizeUploadRecord(rec)
	draftID = strings.TrimSpace(draftID)
	if err := validateUploadRecordForWrite(rec); err != nil {
		return err
	}
	if draftID == "" {
		return errors.New("upload draft identity is required")
	}
	draftRefID := composerDraftUploadRefID(rec.OwnerUserHash, draftID)
	if draftRefID == "" {
		return errors.New("invalid upload draft identity")
	}
	tx, err := s.db.BeginTx(ctxOrBackground(ctx), nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	observeStoreTransaction(ctx, "complete_upload_attempt")
	if err := requireComposerDraftScopeWritableTx(ctxOrBackground(ctx), tx, rec.EndpointID, draftID); err != nil {
		return err
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
		var draftRef int
		if err := tx.QueryRowContext(ctxOrBackground(ctx), `
SELECT COUNT(1) FROM ai_upload_refs
			WHERE endpoint_id = ? AND upload_id = ? AND ref_kind IN (?, ?) AND ref_id = ?
	`, rec.EndpointID, rec.UploadID, UploadRefKindDraft, UploadRefKindDraftPending, draftRefID).Scan(&draftRef); err != nil {
			return err
		}
		if draftRef != 1 {
			return errors.New("completed upload is missing its draft claim")
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
`, UploadAttemptComplete, time.Now().UnixMilli(), attempt.EndpointID, attempt.OwnerUserHash,
		attempt.UploadRequestID, UploadAttemptReceiving); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctxOrBackground(ctx), `
	INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
		VALUES(?, ?, ?, ?, ?, ?)
	`, rec.EndpointID, rec.UploadID, draftID, UploadRefKindDraftPending, draftRefID, rec.CreatedAtUnixMs); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) FailUploadAttempt(ctx context.Context, attempt UploadAttemptRecord, errorCode string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	_, err := s.db.ExecContext(ctxOrBackground(ctx), `
UPDATE ai_upload_attempts SET status = ?, error_code = ?, updated_at_unix_ms = ?
WHERE endpoint_id = ? AND owner_user_hash = ? AND upload_request_id = ? AND request_fingerprint = ? AND status = ?
`, UploadAttemptFailed, strings.TrimSpace(errorCode), time.Now().UnixMilli(), attempt.EndpointID,
		attempt.OwnerUserHash, attempt.UploadRequestID, attempt.RequestFingerprint, UploadAttemptReceiving)
	return err
}

func (s *Store) RestartFailedUploadAttempt(ctx context.Context, attempt UploadAttemptRecord) (bool, error) {
	if s == nil || s.db == nil {
		return false, errors.New("store not initialized")
	}
	result, err := s.db.ExecContext(ctxOrBackground(ctx), `
UPDATE ai_upload_attempts SET status = ?, error_code = '', updated_at_unix_ms = ?
WHERE endpoint_id = ? AND owner_user_hash = ? AND upload_request_id = ?
  AND request_fingerprint = ? AND upload_id = ? AND status = ?
`, UploadAttemptReceiving, time.Now().UnixMilli(), attempt.EndpointID, attempt.OwnerUserHash,
		attempt.UploadRequestID, attempt.RequestFingerprint, attempt.UploadID, UploadAttemptFailed)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	return affected == 1, err
}

func (s *Store) InterruptReceivingUploadAttempts(ctx context.Context, nowUnixMs int64) ([]UploadAttemptRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if nowUnixMs <= 0 {
		nowUnixMs = time.Now().UnixMilli()
	}
	ctx = ctxOrBackground(ctx)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `
SELECT endpoint_id, owner_user_hash, upload_request_id, request_fingerprint, upload_id,
       status, error_code, created_at_unix_ms, updated_at_unix_ms
FROM ai_upload_attempts
WHERE status = ?
ORDER BY updated_at_unix_ms ASC, upload_id ASC
`, UploadAttemptReceiving)
	if err != nil {
		return nil, err
	}
	var attempts []UploadAttemptRecord
	for rows.Next() {
		var attempt UploadAttemptRecord
		if err := rows.Scan(
			&attempt.EndpointID, &attempt.OwnerUserHash, &attempt.UploadRequestID,
			&attempt.RequestFingerprint, &attempt.UploadID, &attempt.Status, &attempt.ErrorCode,
			&attempt.CreatedAtUnixMs, &attempt.UpdatedAtUnixMs,
		); err != nil {
			_ = rows.Close()
			return nil, err
		}
		attempts = append(attempts, attempt)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if len(attempts) == 0 {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return nil, nil
	}
	if _, err := tx.ExecContext(ctx, `
UPDATE ai_upload_attempts
SET status = ?, error_code = 'upload_interrupted', updated_at_unix_ms = ?
WHERE status = ?
`, UploadAttemptFailed, nowUnixMs, UploadAttemptReceiving); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return attempts, nil
}

func (s *Store) ExpireStaleUploadAttempts(ctx context.Context, staleBeforeUnixMs int64) (int64, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("store not initialized")
	}
	result, err := s.db.ExecContext(ctxOrBackground(ctx), `
UPDATE ai_upload_attempts
SET status = ?, error_code = 'upload_attempt_expired', updated_at_unix_ms = ?
WHERE status = ? AND updated_at_unix_ms < ?
`, UploadAttemptFailed, time.Now().UnixMilli(), UploadAttemptReceiving, staleBeforeUnixMs)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func (s *Store) ProtectedUploadArtifactNames(ctx context.Context) (map[string]struct{}, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	rows, err := s.db.QueryContext(ctxOrBackground(ctx), `
SELECT storage_relpath, '' FROM ai_uploads
UNION ALL
SELECT upload_id || '.data', upload_id || '.data.tmp' FROM ai_upload_attempts WHERE status IN ('receiving', 'complete')
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	protected := make(map[string]struct{})
	for rows.Next() {
		var first, second string
		if err := rows.Scan(&first, &second); err != nil {
			return nil, err
		}
		for _, raw := range []string{first, second} {
			if name := sanitizeUploadStorageRelPath(raw); name != "" {
				protected[name] = struct{}{}
			}
		}
	}
	return protected, rows.Err()
}

func (s *Store) HasCompletedOwnedUploadAttempt(ctx context.Context, endpointID string, ownerUserHash string, uploadID string) (bool, error) {
	if s == nil || s.db == nil {
		return false, errors.New("store not initialized")
	}
	var exists int
	err := s.db.QueryRowContext(ctxOrBackground(ctx), `
SELECT 1 FROM ai_upload_attempts
WHERE endpoint_id = ? AND owner_user_hash = ? AND upload_id = ? AND status = ?
`, strings.TrimSpace(endpointID), strings.ToLower(strings.TrimSpace(ownerUserHash)), strings.TrimSpace(uploadID), UploadAttemptComplete).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil && exists == 1, err
}

func ctxOrBackground(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	return ctx
}

func (s *Store) GetThreadOwnedUpload(ctx context.Context, endpointID string, threadID string, uploadID string) (*UploadRecord, error) {
	return s.getOwnedUpload(ctx, endpointID, threadID, UploadRefKindThread, threadID, uploadID)
}

func (s *Store) GetQueuedTurnOwnedUpload(ctx context.Context, endpointID string, threadID string, queueID string, uploadID string) (*UploadRecord, error) {
	return s.getOwnedUpload(ctx, endpointID, threadID, UploadRefKindQueuedTurn, queueID, uploadID)
}

func (s *Store) getOwnedUpload(ctx context.Context, endpointID string, threadID string, refKind string, refID string, uploadID string) (*UploadRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	refKind = normalizeUploadRefKind(refKind)
	refID = strings.TrimSpace(refID)
	uploadID = strings.TrimSpace(uploadID)
	if endpointID == "" || threadID == "" || refKind == "" || refID == "" || uploadID == "" {
		return nil, errors.New("invalid request")
	}
	var rec UploadRecord
	if err := scanUploadRow(s.db.QueryRowContext(ctx, `
SELECT u.upload_id, u.endpoint_id, u.owner_scope_kind, u.owner_user_hash, u.storage_relpath, u.name,
       u.declared_media_type, u.detected_media_type, u.size_bytes, u.content_sha256,
       u.unicode_code_points, u.logical_line_count, u.source, u.state,
       u.created_at_unix_ms, u.claimed_at_unix_ms, u.delete_after_unix_ms
FROM ai_uploads u
JOIN ai_upload_refs r
  ON r.endpoint_id = u.endpoint_id AND r.upload_id = u.upload_id
WHERE u.endpoint_id = ? AND u.upload_id = ? AND u.state = ?
  AND r.thread_id = ? AND r.ref_kind = ? AND r.ref_id = ?
LIMIT 1
`, endpointID, uploadID, UploadStateLive, threadID, refKind, refID), &rec); err != nil {
		return nil, err
	}
	return &rec, nil
}

func (s *Store) BindUploadsToRef(ctx context.Context, endpointID string, threadID string, refKind string, refID string, uploadIDs []string, claimedAtUnixMs int64) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	refKind = normalizeUploadRefKind(refKind)
	refID = strings.TrimSpace(refID)
	uploadIDs = dedupeNonEmptyStrings(uploadIDs)
	if endpointID == "" || threadID == "" || refKind == "" || refID == "" {
		return errors.New("invalid request")
	}
	if len(uploadIDs) == 0 {
		return nil
	}
	if claimedAtUnixMs <= 0 {
		claimedAtUnixMs = time.Now().UnixMilli()
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := bindUploadsToRefTx(ctx, tx, endpointID, threadID, refKind, refID, uploadIDs, claimedAtUnixMs, "", ""); err != nil {
		return err
	}
	return tx.Commit()
}

type ComposerDraftAdmission struct {
	OwnerUserHash    string
	DraftID          string
	ExpectedRevision int64
	Attachment       AttachmentAdmission
}

type AttachmentAdmission struct {
	OwnerUserHash      string
	CapabilityRevision string
	MaxCount           int
	MaxTurnBytes       int64
	SupportsLongText   bool
	Routes             map[string]string
}

func (s *Store) ValidateComposerDraftAdmission(ctx context.Context, rec QueuedTurn, uploadIDs []string, admission ComposerDraftAdmission) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	ctx = ctxOrBackground(ctx)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	rec.TurnID = strings.TrimSpace(rec.TurnID)
	rec.ModelID = strings.TrimSpace(rec.ModelID)
	admission.OwnerUserHash = strings.ToLower(strings.TrimSpace(admission.OwnerUserHash))
	admission.DraftID = strings.TrimSpace(admission.DraftID)
	uploadIDs = dedupeNonEmptyStrings(uploadIDs)
	if rec.EndpointID == "" || rec.ThreadID == "" || rec.TurnID == "" || len(admission.OwnerUserHash) != sha256.Size*2 || admission.DraftID == "" || admission.ExpectedRevision < 0 {
		return errors.New("invalid composer draft admission")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := validateAttachmentAdmissionTx(ctx, tx, rec.EndpointID, uploadIDs, admission.Attachment); err != nil {
		return err
	}
	if err := validateComposerDraftAdmissionTx(
		ctx, tx, rec.EndpointID, admission.OwnerUserHash, admission.DraftID,
		admission.ExpectedRevision, rec.TurnID, rec.ModelID, rec.TextContent, uploadIDs, admission,
	); err != nil {
		return err
	}
	return tx.Commit()
}

func validateAttachmentAdmissionTx(ctx context.Context, tx *sql.Tx, endpointID string, uploadIDs []string, admission AttachmentAdmission) error {
	admission.OwnerUserHash = strings.ToLower(strings.TrimSpace(admission.OwnerUserHash))
	admission.CapabilityRevision = strings.ToLower(strings.TrimSpace(admission.CapabilityRevision))
	if admission.MaxCount != AttachmentAdmissionMaxCount || admission.MaxTurnBytes != AttachmentAdmissionMaxTurnBytes ||
		len(admission.OwnerUserHash) != sha256.Size*2 || len(admission.CapabilityRevision) != sha256.Size*2 {
		return errors.New("invalid attachment admission capability")
	}
	if len(uploadIDs) > admission.MaxCount {
		return errors.New("attachment count exceeds turn limit")
	}
	var totalBytes int64
	for _, uploadID := range uploadIDs {
		var rec UploadRecord
		if err := scanUploadRow(tx.QueryRowContext(ctx, `
SELECT upload_id, endpoint_id, owner_scope_kind, owner_user_hash, storage_relpath, name,
       declared_media_type, detected_media_type, size_bytes, content_sha256,
       unicode_code_points, logical_line_count, source, state,
       created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms
FROM ai_uploads
WHERE endpoint_id = ? AND upload_id = ? AND owner_scope_kind = ? AND owner_user_hash = ? AND state IN (?, ?)
`, endpointID, uploadID, UploadOwnerScopeUser, admission.OwnerUserHash, UploadStateStaged, UploadStateLive), &rec); err != nil {
			return errors.New("attachment admission resource changed")
		}
		if rec.SizeBytes < 0 || rec.SizeBytes > admission.MaxTurnBytes-totalBytes {
			return errors.New("attachment bytes exceed turn limit")
		}
		totalBytes += rec.SizeBytes
		mediaType := strings.ToLower(strings.TrimSpace(rec.DetectedMediaType))
		route := strings.TrimSpace(admission.Routes[mediaType])
		if route != "native_full_content" && route != "tool_read" {
			return errors.New("attachment media route is unsupported for model")
		}
		if rec.Source == UploadSourceLongText && (!admission.SupportsLongText || !strings.HasPrefix(mediaType, "text/plain")) {
			return ErrLongTextAttachmentRequired
		}
	}
	return nil
}

func (s *Store) CreateFollowupWithUploadRefs(ctx context.Context, rec QueuedTurn, uploadIDs []string, claimedAtUnixMs int64) (QueuedTurn, int, int64, error) {
	return s.createFollowupWithUploadRefs(ctx, rec, uploadIDs, claimedAtUnixMs, nil, nil)
}

func (s *Store) CreateFollowupWithAttachmentAdmission(ctx context.Context, rec QueuedTurn, uploadIDs []string, claimedAtUnixMs int64, admission AttachmentAdmission) (QueuedTurn, int, int64, error) {
	return s.createFollowupWithUploadRefs(ctx, rec, uploadIDs, claimedAtUnixMs, &admission, nil)
}

func (s *Store) CreateFollowupFromComposerDraft(ctx context.Context, rec QueuedTurn, uploadIDs []string, claimedAtUnixMs int64, admission ComposerDraftAdmission) (QueuedTurn, int, int64, error) {
	return s.createFollowupWithUploadRefs(ctx, rec, uploadIDs, claimedAtUnixMs, &admission.Attachment, &admission)
}

func (s *Store) createFollowupWithUploadRefs(ctx context.Context, rec QueuedTurn, uploadIDs []string, claimedAtUnixMs int64, attachmentAdmission *AttachmentAdmission, admission *ComposerDraftAdmission) (QueuedTurn, int, int64, error) {
	if s == nil || s.db == nil {
		return QueuedTurn{}, 0, 0, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec.QueueID = strings.TrimSpace(rec.QueueID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	rec.ChannelID = strings.TrimSpace(rec.ChannelID)
	lane, err := parseFollowupLane(rec.Lane)
	if err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	rec.Lane = lane
	rec.TurnID = strings.TrimSpace(rec.TurnID)
	rec.RunID = strings.TrimSpace(rec.RunID)
	rec.ModelID = strings.TrimSpace(rec.ModelID)
	if !utf8.ValidString(rec.TextContent) {
		return QueuedTurn{}, 0, 0, errors.New("invalid text content")
	}
	rec.AttachmentsJSON = strings.TrimSpace(rec.AttachmentsJSON)
	rec.OptionsJSON = strings.TrimSpace(rec.OptionsJSON)
	rec.SessionMetaJSON = strings.TrimSpace(rec.SessionMetaJSON)
	rec.CreatedByUserPublicID = strings.TrimSpace(rec.CreatedByUserPublicID)
	rec.CreatedByUserEmail = strings.TrimSpace(rec.CreatedByUserEmail)
	uploadIDs = dedupeNonEmptyStrings(uploadIDs)
	if rec.QueueID == "" || rec.EndpointID == "" || rec.ThreadID == "" || rec.ChannelID == "" || rec.TurnID == "" || rec.RunID == "" {
		return QueuedTurn{}, 0, 0, errors.New("invalid request")
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
	if claimedAtUnixMs <= 0 {
		claimedAtUnixMs = rec.CreatedAtUnixMs
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	defer func() { _ = tx.Rollback() }()
	if attachmentAdmission != nil {
		if err := validateAttachmentAdmissionTx(ctx, tx, rec.EndpointID, uploadIDs, *attachmentAdmission); err != nil {
			return QueuedTurn{}, 0, 0, err
		}
	}
	if admission != nil {
		admission.OwnerUserHash = strings.ToLower(strings.TrimSpace(admission.OwnerUserHash))
		admission.DraftID = strings.TrimSpace(admission.DraftID)
		if len(admission.OwnerUserHash) != 64 || admission.DraftID == "" || admission.ExpectedRevision < 0 {
			return QueuedTurn{}, 0, 0, errors.New("invalid composer draft admission")
		}
		if err := validateComposerDraftAdmissionTx(
			ctx, tx, rec.EndpointID, admission.OwnerUserHash, admission.DraftID,
			admission.ExpectedRevision, rec.TurnID, rec.ModelID, rec.TextContent, uploadIDs,
			*admission,
		); err != nil {
			return QueuedTurn{}, 0, 0, err
		}
	}
	queued, position, revision, err := createFollowupTx(ctx, tx, rec)
	if err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	sourceDraftID := ""
	ownerUserHash := ""
	if admission != nil {
		sourceDraftID = admission.DraftID
		ownerUserHash = admission.OwnerUserHash
	}
	if err := bindUploadsToRefTx(ctx, tx, rec.EndpointID, rec.ThreadID, UploadRefKindQueuedTurn, queued.QueueID, uploadIDs, claimedAtUnixMs, sourceDraftID, ownerUserHash); err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	if admission != nil {
		if _, err := tx.ExecContext(ctx, `
DELETE FROM ai_composer_drafts
WHERE endpoint_id = ? AND owner_user_hash = ? AND scope_id = ? AND revision = ?
`, rec.EndpointID, admission.OwnerUserHash, admission.DraftID, admission.ExpectedRevision); err != nil {
			return QueuedTurn{}, 0, 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	return queued, position, revision, nil
}

func (s *Store) ReplaceFollowupWithUploadRefs(ctx context.Context, sourceFollowupID string, rec QueuedTurn, uploadIDs []string, claimedAtUnixMs int64) (FollowupReplacementResult, error) {
	return s.replaceFollowupWithUploadRefs(ctx, sourceFollowupID, rec, uploadIDs, claimedAtUnixMs, nil, nil)
}

func (s *Store) ReplaceFollowupWithAttachmentAdmission(ctx context.Context, sourceFollowupID string, rec QueuedTurn, uploadIDs []string, claimedAtUnixMs int64, admission AttachmentAdmission) (FollowupReplacementResult, error) {
	return s.replaceFollowupWithUploadRefs(ctx, sourceFollowupID, rec, uploadIDs, claimedAtUnixMs, &admission, nil)
}

func (s *Store) ReplaceFollowupFromComposerDraft(ctx context.Context, sourceFollowupID string, rec QueuedTurn, uploadIDs []string, claimedAtUnixMs int64, admission ComposerDraftAdmission) (FollowupReplacementResult, error) {
	return s.replaceFollowupWithUploadRefs(ctx, sourceFollowupID, rec, uploadIDs, claimedAtUnixMs, &admission.Attachment, &admission)
}

func (s *Store) replaceFollowupWithUploadRefs(ctx context.Context, sourceFollowupID string, rec QueuedTurn, uploadIDs []string, claimedAtUnixMs int64, attachmentAdmission *AttachmentAdmission, admission *ComposerDraftAdmission) (FollowupReplacementResult, error) {
	if s == nil || s.db == nil {
		return FollowupReplacementResult{}, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	sourceFollowupID = strings.TrimSpace(sourceFollowupID)
	rec.QueueID = strings.TrimSpace(rec.QueueID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	rec.ChannelID = strings.TrimSpace(rec.ChannelID)
	lane, err := parseFollowupLane(rec.Lane)
	if err != nil {
		return FollowupReplacementResult{}, err
	}
	rec.Lane = lane
	rec.AdmissionState = PendingTurnAdmissionReady
	rec.TurnID = strings.TrimSpace(rec.TurnID)
	rec.RunID = strings.TrimSpace(rec.RunID)
	rec.ModelID = strings.TrimSpace(rec.ModelID)
	rec.TextContent = strings.TrimSpace(rec.TextContent)
	rec.AttachmentsJSON = strings.TrimSpace(rec.AttachmentsJSON)
	rec.ContextActionJSON = strings.TrimSpace(rec.ContextActionJSON)
	rec.OptionsJSON = strings.TrimSpace(rec.OptionsJSON)
	rec.SessionMetaJSON = strings.TrimSpace(rec.SessionMetaJSON)
	rec.CreatedByUserPublicID = strings.TrimSpace(rec.CreatedByUserPublicID)
	rec.CreatedByUserEmail = strings.TrimSpace(rec.CreatedByUserEmail)
	uploadIDs = dedupeNonEmptyStrings(uploadIDs)
	if sourceFollowupID == "" || rec.QueueID == "" || rec.QueueID == sourceFollowupID || rec.EndpointID == "" || rec.ThreadID == "" || rec.ChannelID == "" || rec.TurnID == "" || rec.RunID == "" {
		return FollowupReplacementResult{}, errors.New("invalid followup replacement request")
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
	if claimedAtUnixMs <= 0 {
		claimedAtUnixMs = rec.CreatedAtUnixMs
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return FollowupReplacementResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if attachmentAdmission != nil {
		if err := validateAttachmentAdmissionTx(ctx, tx, rec.EndpointID, uploadIDs, *attachmentAdmission); err != nil {
			return FollowupReplacementResult{}, err
		}
	}
	if admission != nil {
		admission.OwnerUserHash = strings.ToLower(strings.TrimSpace(admission.OwnerUserHash))
		admission.DraftID = strings.TrimSpace(admission.DraftID)
		if len(admission.OwnerUserHash) != 64 || admission.DraftID == "" || admission.ExpectedRevision < 0 {
			return FollowupReplacementResult{}, errors.New("invalid composer draft admission")
		}
		if err := validateComposerDraftAdmissionTx(
			ctx, tx, rec.EndpointID, admission.OwnerUserHash, admission.DraftID,
			admission.ExpectedRevision, rec.TurnID, rec.ModelID, rec.TextContent, uploadIDs,
			*admission,
		); err != nil {
			return FollowupReplacementResult{}, err
		}
	}
	if err := requireThreadWritableTx(ctx, tx, rec.EndpointID, rec.ThreadID); err != nil {
		return FollowupReplacementResult{}, err
	}
	var sourceLane, sourceAdmissionState string
	var sourceSortIndex int64
	err = tx.QueryRowContext(ctx, `
SELECT lane, admission_state, sort_index
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ?
`, rec.EndpointID, rec.ThreadID, sourceFollowupID).Scan(&sourceLane, &sourceAdmissionState, &sourceSortIndex)
	if errors.Is(err, sql.ErrNoRows) {
		return FollowupReplacementResult{}, fmt.Errorf("%w: source followup %q is missing", ErrFollowupReplacementConflict, sourceFollowupID)
	}
	if err != nil {
		return FollowupReplacementResult{}, err
	}
	sourceLane, err = parseFollowupLane(sourceLane)
	if err != nil {
		return FollowupReplacementResult{}, err
	}
	sourceAdmissionState, err = parsePendingTurnAdmissionState(sourceAdmissionState)
	if err != nil {
		return FollowupReplacementResult{}, err
	}
	if sourceAdmissionState != PendingTurnAdmissionReady {
		return FollowupReplacementResult{}, fmt.Errorf("%w: source followup %q is not mutable", ErrFollowupReplacementConflict, sourceFollowupID)
	}
	if sourceLane == rec.Lane && sourceSortIndex > 0 {
		rec.SortIndex = sourceSortIndex
	} else {
		rec.SortIndex, err = getNextFollowupSortIndexTx(ctx, tx, rec.EndpointID, rec.ThreadID, rec.Lane)
		if err != nil {
			return FollowupReplacementResult{}, err
		}
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO ai_queued_turns(
  queue_id, endpoint_id, thread_id, channel_id, lane, admission_state, sort_index, turn_id, run_id, model_id, text_content, attachments_json, context_action_json, options_json, session_meta_json,
  created_by_user_public_id, created_by_user_email, created_at_unix_ms, updated_at_unix_ms
)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, rec.QueueID, rec.EndpointID, rec.ThreadID, rec.ChannelID, rec.Lane, rec.AdmissionState, rec.SortIndex, rec.TurnID, rec.RunID, rec.ModelID, rec.TextContent, rec.AttachmentsJSON, rec.ContextActionJSON, rec.OptionsJSON, rec.SessionMetaJSON,
		rec.CreatedByUserPublicID, rec.CreatedByUserEmail, rec.CreatedAtUnixMs, rec.UpdatedAtUnixMs)
	if err != nil {
		if isUniqueConstraintError(err) {
			return FollowupReplacementResult{}, fmt.Errorf("%w: destination identity already exists", ErrFollowupReplacementConflict)
		}
		return FollowupReplacementResult{}, err
	}
	sourceDraftID := ""
	ownerUserHash := ""
	if admission != nil {
		sourceDraftID = admission.DraftID
		ownerUserHash = admission.OwnerUserHash
	}
	if err := bindUploadsToRefTx(ctx, tx, rec.EndpointID, rec.ThreadID, UploadRefKindQueuedTurn, rec.QueueID, uploadIDs, claimedAtUnixMs, sourceDraftID, ownerUserHash); err != nil {
		return FollowupReplacementResult{}, err
	}
	deleted, err := tx.ExecContext(ctx, `
DELETE FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ? AND admission_state = ?
`, rec.EndpointID, rec.ThreadID, sourceFollowupID, PendingTurnAdmissionReady)
	if err != nil {
		return FollowupReplacementResult{}, err
	}
	if affected, _ := deleted.RowsAffected(); affected != 1 {
		return FollowupReplacementResult{}, fmt.Errorf("%w: source followup changed during replacement", ErrFollowupReplacementConflict)
	}
	uploadsToDelete, err := prepareUploadCleanupForRefTx(ctx, tx, rec.EndpointID, rec.ThreadID, UploadRefKindQueuedTurn, sourceFollowupID, now)
	if err != nil {
		return FollowupReplacementResult{}, err
	}
	if admission != nil {
		deletedDraft, err := tx.ExecContext(ctx, `
DELETE FROM ai_composer_drafts
WHERE endpoint_id = ? AND owner_user_hash = ? AND scope_id = ? AND revision = ?
`, rec.EndpointID, admission.OwnerUserHash, admission.DraftID, admission.ExpectedRevision)
		if err != nil {
			return FollowupReplacementResult{}, err
		}
		if affected, _ := deletedDraft.RowsAffected(); affected != 1 {
			return FollowupReplacementResult{}, ErrComposerDraftRevisionConflict
		}
	}
	position, err := followupPositionTx(ctx, tx, rec.EndpointID, rec.ThreadID, rec.Lane, rec.QueueID, rec.SortIndex)
	if err != nil {
		return FollowupReplacementResult{}, err
	}
	revision, err := bumpThreadFollowupsRevisionTx(ctx, tx, rec.EndpointID, rec.ThreadID)
	if err != nil {
		return FollowupReplacementResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return FollowupReplacementResult{}, err
	}
	return FollowupReplacementResult{Queued: rec, Position: position, Revision: revision, UploadsToDelete: uploadsToDelete}, nil
}

func (s *Store) CommitPendingTurnAdmission(ctx context.Context, endpointID string, threadID string, commandID string, turnID string, uploadIDs []string, admittedAtUnixMs int64) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	commandID = strings.TrimSpace(commandID)
	turnID = strings.TrimSpace(turnID)
	uploadIDs = dedupeNonEmptyStrings(uploadIDs)
	if endpointID == "" || threadID == "" || turnID == "" || commandID == "" {
		return errors.New("invalid request")
	}
	if admittedAtUnixMs <= 0 {
		admittedAtUnixMs = time.Now().UnixMilli()
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var storedTurnID string
	if err := requireThreadWritableTx(ctx, tx, endpointID, threadID); err != nil {
		return err
	}
	var lane, admissionState string
	err = tx.QueryRowContext(ctx, `
SELECT turn_id, lane, admission_state
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ?
`, endpointID, threadID, commandID).Scan(&storedTurnID, &lane, &admissionState)
	if errors.Is(err, sql.ErrNoRows) {
		return errors.New("pending turn command is missing during admission settlement")
	}
	if err != nil {
		return err
	}
	storedLane, err := parseFollowupLane(lane)
	if err != nil {
		return err
	}
	storedAdmissionState, err := parsePendingTurnAdmissionState(admissionState)
	if err != nil {
		return err
	}
	if strings.TrimSpace(storedTurnID) != turnID || storedLane != FollowupLaneQueued {
		return errors.New("pending turn command identity mismatch")
	}
	if storedAdmissionState != PendingTurnAdmissionReady && storedAdmissionState != PendingTurnAdmissionInFlight {
		return errors.New("pending turn command admission state mismatch")
	}
	queryRows, err := tx.QueryContext(ctx, `
SELECT upload_id
FROM ai_upload_refs
WHERE endpoint_id = ? AND thread_id = ? AND ref_kind = ? AND ref_id = ?
`, endpointID, threadID, UploadRefKindQueuedTurn, commandID)
	if err != nil {
		return err
	}
	for queryRows.Next() {
		var uploadID string
		if err := queryRows.Scan(&uploadID); err != nil {
			_ = queryRows.Close()
			return err
		}
		uploadIDs = append(uploadIDs, strings.TrimSpace(uploadID))
	}
	if err := queryRows.Err(); err != nil {
		_ = queryRows.Close()
		return err
	}
	if err := queryRows.Close(); err != nil {
		return err
	}
	if err := bindUploadsToRefTx(ctx, tx, endpointID, threadID, UploadRefKindThread, threadID, dedupeNonEmptyStrings(uploadIDs), admittedAtUnixMs, "", ""); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
DELETE FROM ai_upload_refs
WHERE endpoint_id = ? AND thread_id = ? AND ref_kind = ? AND ref_id = ?
`, endpointID, threadID, UploadRefKindQueuedTurn, commandID); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `
DELETE FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ? AND lane = ? AND turn_id = ?
`, endpointID, threadID, commandID, FollowupLaneQueued, turnID)
	if err != nil {
		return err
	}
	rowsAffected, _ := result.RowsAffected()
	if rowsAffected != 1 {
		return errors.New("pending turn command changed during admission")
	}
	if _, err := bumpThreadFollowupsRevisionTx(ctx, tx, endpointID, threadID); err != nil {
		return err
	}
	return tx.Commit()
}

func bindUploadsToRefTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, refKind string, refID string, uploadIDs []string, claimedAtUnixMs int64, sourceDraftID string, expectedOwnerUserHash string) error {
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	refKind = normalizeUploadRefKind(refKind)
	refID = strings.TrimSpace(refID)
	sourceDraftID = strings.TrimSpace(sourceDraftID)
	expectedOwnerUserHash = strings.ToLower(strings.TrimSpace(expectedOwnerUserHash))
	sourceDraftRefID := ""
	if sourceDraftID != "" {
		sourceDraftRefID = composerDraftUploadRefID(expectedOwnerUserHash, sourceDraftID)
		if sourceDraftRefID == "" {
			return errors.New("invalid draft upload reference")
		}
	}
	uploadIDs = dedupeNonEmptyStrings(uploadIDs)
	if endpointID == "" || threadID == "" || refKind == "" || refID == "" {
		return errors.New("invalid request")
	}
	if err := requireThreadWritableTx(ctx, tx, endpointID, threadID); err != nil {
		return err
	}
	if len(uploadIDs) == 0 {
		return nil
	}
	if claimedAtUnixMs <= 0 {
		claimedAtUnixMs = time.Now().UnixMilli()
	}
	for _, uploadID := range uploadIDs {
		var ownerScopeKind string
		var ownerUserHash sql.NullString
		var state string
		var sizeBytes int64
		if err := tx.QueryRowContext(ctx, `
SELECT owner_scope_kind, owner_user_hash, state, size_bytes
FROM ai_uploads
WHERE endpoint_id = ? AND upload_id = ? AND LOWER(COALESCE(state, '')) <> ?
`, endpointID, uploadID, UploadStateDeleting).Scan(&ownerScopeKind, &ownerUserHash, &state, &sizeBytes); err != nil {
			return err
		}
		if ownerScopeKind == UploadOwnerScopeUser {
			if state == UploadStateStaged {
				if sourceDraftID == "" || len(expectedOwnerUserHash) != 64 || expectedOwnerUserHash != ownerUserHash.String {
					return errors.New("staged attachment requires exact draft ownership")
				}
				var draftRef int
				if err := tx.QueryRowContext(ctx, `
SELECT COUNT(1) FROM ai_upload_refs
WHERE endpoint_id = ? AND upload_id = ? AND ref_kind = ? AND ref_id = ?
				`, endpointID, uploadID, UploadRefKindDraft, sourceDraftRefID).Scan(&draftRef); err != nil || draftRef != 1 {
					return errors.New("staged attachment is not owned by the exact draft")
				}
			}
			if state != UploadStateLive {
				if err := enforceUploadQuotaTx(ctx, tx, endpointID, ownerUserHash.String, "", UploadStateLive, sizeBytes); err != nil {
					return err
				}
			}
			var threadAlreadyOwns int
			if err := tx.QueryRowContext(ctx, `
SELECT COUNT(1) FROM ai_upload_refs
			WHERE endpoint_id = ? AND thread_id = ? AND upload_id = ? AND ref_kind IN (?, ?)
		`, endpointID, threadID, uploadID, UploadRefKindQueuedTurn, UploadRefKindThread).Scan(&threadAlreadyOwns); err != nil {
				return err
			}
			if threadAlreadyOwns == 0 {
				if err := enforceUploadQuotaTx(ctx, tx, endpointID, "", threadID, UploadStateLive, sizeBytes); err != nil {
					return err
				}
			}
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
VALUES(?, ?, ?, ?, ?, ?)
ON CONFLICT(endpoint_id, upload_id, ref_kind, ref_id) DO NOTHING
`, endpointID, uploadID, threadID, refKind, refID, claimedAtUnixMs); err != nil {
			return err
		}
		if sourceDraftID != "" {
			if _, err := tx.ExecContext(ctx, `
DELETE FROM ai_upload_refs
	WHERE endpoint_id = ? AND upload_id = ? AND ref_kind = ? AND ref_id = ?
			`, endpointID, uploadID, UploadRefKindDraft, sourceDraftRefID); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `
UPDATE ai_uploads
SET state = ?,
    claimed_at_unix_ms = CASE WHEN claimed_at_unix_ms <= 0 THEN ? ELSE claimed_at_unix_ms END,
    delete_after_unix_ms = 0
WHERE endpoint_id = ? AND upload_id = ?
`, UploadStateLive, claimedAtUnixMs, endpointID, uploadID); err != nil {
			return err
		}
	}
	return nil
}

func enforceUploadQuotaTx(ctx context.Context, tx *sql.Tx, endpointID string, ownerUserHash string, threadID string, state string, incomingBytes int64) error {
	var count, bytes int64
	var itemLimit, byteLimit int64
	scope := ""
	switch {
	case state == UploadStateStaged && ownerUserHash != "" && threadID == "":
		scope = "staged_owner"
		itemLimit = UploadStagedOwnerItemLimit
		byteLimit = UploadStagedOwnerByteLimit
		if err := tx.QueryRowContext(ctx, `
SELECT COUNT(1), COALESCE(SUM(size_bytes), 0) FROM ai_uploads
WHERE endpoint_id = ? AND owner_scope_kind = ? AND owner_user_hash = ? AND state = ?
`, endpointID, UploadOwnerScopeUser, ownerUserHash, UploadStateStaged).Scan(&count, &bytes); err != nil {
			return err
		}
	case state == UploadStateLive && ownerUserHash != "" && threadID == "":
		scope = "live_owner"
		itemLimit = UploadLiveOwnerItemLimit
		byteLimit = UploadLiveOwnerByteLimit
		if err := tx.QueryRowContext(ctx, `
SELECT COUNT(1), COALESCE(SUM(size_bytes), 0) FROM ai_uploads
WHERE endpoint_id = ? AND owner_scope_kind = ? AND owner_user_hash = ? AND state = ?
`, endpointID, UploadOwnerScopeUser, ownerUserHash, UploadStateLive).Scan(&count, &bytes); err != nil {
			return err
		}
	case state == UploadStateLive && threadID != "":
		scope = "live_thread"
		itemLimit = UploadLiveThreadItemLimit
		byteLimit = UploadLiveThreadByteLimit
		if err := tx.QueryRowContext(ctx, `
SELECT COUNT(1), COALESCE(SUM(size_bytes), 0)
FROM ai_uploads u
WHERE u.endpoint_id = ? AND u.state = ? AND u.upload_id IN (
  SELECT DISTINCT r.upload_id FROM ai_upload_refs r
	  WHERE r.endpoint_id = ? AND r.thread_id = ? AND r.ref_kind IN (?, ?)
	)
	`, endpointID, UploadStateLive, endpointID, threadID, UploadRefKindQueuedTurn, UploadRefKindThread).Scan(&count, &bytes); err != nil {
			return err
		}
	default:
		return errors.New("invalid upload quota scope")
	}
	if count >= itemLimit {
		return &UploadQuotaError{Scope: scope, Metric: "items", Limit: itemLimit}
	}
	if incomingBytes > byteLimit || bytes > byteLimit-incomingBytes {
		return &UploadQuotaError{Scope: scope, Metric: "bytes", Limit: byteLimit}
	}
	return nil
}

func (s *Store) DeleteFollowupResources(ctx context.Context, endpointID string, threadID string, followupID string) (FollowupDeleteResourcesResult, error) {
	if s == nil || s.db == nil {
		return FollowupDeleteResourcesResult{}, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	followupID = strings.TrimSpace(followupID)
	if endpointID == "" || threadID == "" || followupID == "" {
		return FollowupDeleteResourcesResult{}, errors.New("invalid request")
	}
	now := time.Now().UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return FollowupDeleteResourcesResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireThreadWritableTx(ctx, tx, endpointID, threadID); err != nil {
		return FollowupDeleteResourcesResult{}, err
	}
	if err := requireFollowupMutableTx(ctx, tx, endpointID, threadID, followupID); err != nil {
		return FollowupDeleteResourcesResult{}, err
	}
	res, err := tx.ExecContext(ctx, `
DELETE FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ?
`, endpointID, threadID, followupID)
	if err != nil {
		return FollowupDeleteResourcesResult{}, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return FollowupDeleteResourcesResult{}, sql.ErrNoRows
	}
	uploadsToDelete, err := prepareUploadCleanupForRefTx(ctx, tx, endpointID, threadID, UploadRefKindQueuedTurn, followupID, now)
	if err != nil {
		return FollowupDeleteResourcesResult{}, err
	}
	revision, err := bumpThreadFollowupsRevisionTx(ctx, tx, endpointID, threadID)
	if err != nil {
		return FollowupDeleteResourcesResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return FollowupDeleteResourcesResult{}, err
	}
	return FollowupDeleteResourcesResult{
		Revision:        revision,
		UploadsToDelete: uploadsToDelete,
	}, nil
}

func prepareUploadCleanupForThreadTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, deleteAfterUnixMs int64) ([]UploadRecord, error) {
	uploadIDs, err := listUploadIDsForThreadTx(ctx, tx, endpointID, threadID)
	if err != nil {
		return nil, err
	}
	if len(uploadIDs) == 0 {
		return nil, nil
	}
	if _, err := tx.ExecContext(ctx, `
DELETE FROM ai_upload_refs
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID); err != nil {
		return nil, err
	}
	return collectUnreferencedUploadsTx(ctx, tx, endpointID, uploadIDs, deleteAfterUnixMs)
}

func prepareUploadCleanupForRefTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, refKind string, refID string, deleteAfterUnixMs int64) ([]UploadRecord, error) {
	refKind = normalizeUploadRefKind(refKind)
	refID = strings.TrimSpace(refID)
	if refKind == "" || refID == "" {
		return nil, errors.New("invalid upload reference")
	}
	uploadIDs, err := listUploadIDsForRefTx(ctx, tx, endpointID, threadID, refKind, refID)
	if err != nil {
		return nil, err
	}
	if len(uploadIDs) == 0 {
		return nil, nil
	}
	if _, err := tx.ExecContext(ctx, `
DELETE FROM ai_upload_refs
WHERE endpoint_id = ? AND thread_id = ? AND ref_kind = ? AND ref_id = ?
`, endpointID, threadID, refKind, refID); err != nil {
		return nil, err
	}
	return collectUnreferencedUploadsTx(ctx, tx, endpointID, uploadIDs, deleteAfterUnixMs)
}

func listUploadIDsForThreadTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT DISTINCT upload_id
FROM ai_upload_refs
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]string, 0)
	for rows.Next() {
		var uploadID string
		if err := rows.Scan(&uploadID); err != nil {
			return nil, err
		}
		uploadID = strings.TrimSpace(uploadID)
		if uploadID == "" {
			continue
		}
		out = append(out, uploadID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func listUploadIDsForRefTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, refKind string, refID string) ([]string, error) {
	refKind = normalizeUploadRefKind(refKind)
	refID = strings.TrimSpace(refID)
	if refKind == "" || refID == "" {
		return nil, errors.New("invalid upload reference")
	}
	rows, err := tx.QueryContext(ctx, `
SELECT DISTINCT upload_id
FROM ai_upload_refs
WHERE endpoint_id = ? AND thread_id = ? AND ref_kind = ? AND ref_id = ?
`, endpointID, threadID, refKind, refID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]string, 0)
	for rows.Next() {
		var uploadID string
		if err := rows.Scan(&uploadID); err != nil {
			return nil, err
		}
		uploadID = strings.TrimSpace(uploadID)
		if uploadID == "" {
			continue
		}
		out = append(out, uploadID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func collectUnreferencedUploadsTx(ctx context.Context, tx *sql.Tx, endpointID string, uploadIDs []string, deleteAfterUnixMs int64) ([]UploadRecord, error) {
	uploadIDs = dedupeNonEmptyStrings(uploadIDs)
	if len(uploadIDs) == 0 {
		return nil, nil
	}
	if deleteAfterUnixMs <= 0 {
		deleteAfterUnixMs = time.Now().UnixMilli()
	}
	query, args := uploadRowsByIDQuery(`
SELECT upload_id, endpoint_id, owner_scope_kind, owner_user_hash, storage_relpath, name,
       declared_media_type, detected_media_type, size_bytes, content_sha256,
       unicode_code_points, logical_line_count, source, state,
       created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms
FROM ai_uploads u
WHERE endpoint_id = ?
  AND NOT EXISTS (
    SELECT 1
    FROM ai_upload_refs r
    WHERE r.endpoint_id = u.endpoint_id AND r.upload_id = u.upload_id
  )
  AND upload_id IN (%s)
`, endpointID, uploadIDs)
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]UploadRecord, 0, len(uploadIDs))
	for rows.Next() {
		var rec UploadRecord
		if err := scanUploadRow(rows, &rec); err != nil {
			return nil, err
		}
		rec.State = UploadStateDeleting
		rec.DeleteAfterUnixMs = deleteAfterUnixMs
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, nil
	}
	candidateIDs := make([]string, 0, len(out))
	for _, rec := range out {
		candidateIDs = append(candidateIDs, rec.UploadID)
	}
	updateSQL, updateArgs := uploadRowsByIDQuery(`
UPDATE ai_uploads
SET state = ?, delete_after_unix_ms = ?
WHERE endpoint_id = ? AND upload_id IN (%s)
`, endpointID, candidateIDs)
	updateArgs = append([]any{UploadStateDeleting, deleteAfterUnixMs}, updateArgs...)
	if _, err := tx.ExecContext(ctx, updateSQL, updateArgs...); err != nil {
		return nil, err
	}
	return out, nil
}

func uploadRowsByIDQuery(base string, endpointID string, uploadIDs []string) (string, []any) {
	uploadIDs = dedupeNonEmptyStrings(uploadIDs)
	placeholders := strings.TrimRight(strings.Repeat("?,", len(uploadIDs)), ",")
	args := make([]any, 0, len(uploadIDs)+1)
	args = append(args, endpointID)
	for _, uploadID := range uploadIDs {
		args = append(args, uploadID)
	}
	return fmt.Sprintf(base, placeholders), args
}

func (s *Store) PrepareExpiredUploadsForDeletion(ctx context.Context, nowUnixMs int64, limit int) ([]UploadRecord, error) {
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
	if nowUnixMs <= 0 {
		nowUnixMs = time.Now().UnixMilli()
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `
SELECT upload_id, endpoint_id, owner_scope_kind, owner_user_hash, storage_relpath, name,
       declared_media_type, detected_media_type, size_bytes, content_sha256,
       unicode_code_points, logical_line_count, source, state,
       created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms
FROM ai_uploads
WHERE LOWER(COALESCE(state, '')) IN (?, ?)
  AND delete_after_unix_ms > 0
  AND delete_after_unix_ms <= ?
  AND NOT EXISTS (
    SELECT 1 FROM ai_upload_refs ref
    WHERE ref.endpoint_id = ai_uploads.endpoint_id AND ref.upload_id = ai_uploads.upload_id
  )
ORDER BY delete_after_unix_ms ASC, created_at_unix_ms ASC, upload_id ASC
LIMIT ?
`, UploadStateStaged, UploadStateDeleting, nowUnixMs, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]UploadRecord, 0, limit)
	for rows.Next() {
		var rec UploadRecord
		if err := scanUploadRow(rows, &rec); err != nil {
			return nil, err
		}
		rec.State = UploadStateDeleting
		rec.DeleteAfterUnixMs = nowUnixMs
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return nil, nil
	}
	ids := make([]string, 0, len(out))
	for _, rec := range out {
		ids = append(ids, rec.UploadID)
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(ids)), ",")
	updateArgs := make([]any, 0, len(ids)+2)
	updateArgs = append(updateArgs, UploadStateDeleting, nowUnixMs)
	for _, uploadID := range ids {
		updateArgs = append(updateArgs, uploadID)
	}
	if _, err := tx.ExecContext(ctx, `
UPDATE ai_uploads
SET state = ?, delete_after_unix_ms = ?
WHERE upload_id IN (`+placeholders+`)
`, updateArgs...); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) FinalizeDeletedUploads(ctx context.Context, uploadIDs []string) (int64, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	uploadIDs = dedupeNonEmptyStrings(uploadIDs)
	if len(uploadIDs) == 0 {
		return 0, nil
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(uploadIDs)), ",")
	args := make([]any, 0, len(uploadIDs))
	for _, uploadID := range uploadIDs {
		args = append(args, uploadID)
	}
	if _, err := s.db.ExecContext(ctx, `
DELETE FROM ai_upload_refs
WHERE upload_id IN (`+placeholders+`)
`, args...); err != nil {
		return 0, err
	}
	res, err := s.db.ExecContext(ctx, `
DELETE FROM ai_uploads
WHERE LOWER(COALESCE(state, '')) = ? AND upload_id IN (`+placeholders+`)
`, append([]any{UploadStateDeleting}, args...)...)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func (s *Store) RescheduleUploadDeletion(ctx context.Context, uploadIDs []string, retryAtUnixMs int64) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	uploadIDs = dedupeNonEmptyStrings(uploadIDs)
	if len(uploadIDs) == 0 {
		return nil
	}
	if retryAtUnixMs <= 0 {
		retryAtUnixMs = time.Now().UnixMilli()
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(uploadIDs)), ",")
	args := make([]any, 0, len(uploadIDs)+2)
	args = append(args, UploadStateDeleting, retryAtUnixMs)
	for _, uploadID := range uploadIDs {
		args = append(args, uploadID)
	}
	_, err := s.db.ExecContext(ctx, `
UPDATE ai_uploads
SET state = ?, delete_after_unix_ms = ?
WHERE upload_id IN (`+placeholders+`)
`, args...)
	return err
}

func (s *Store) SQLitePageStats(ctx context.Context) (SQLitePageStats, error) {
	if s == nil || s.db == nil {
		return SQLitePageStats{}, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	var stats SQLitePageStats
	if err := s.db.QueryRowContext(ctx, `PRAGMA page_size;`).Scan(&stats.PageSize); err != nil {
		return SQLitePageStats{}, err
	}
	if err := s.db.QueryRowContext(ctx, `PRAGMA page_count;`).Scan(&stats.PageCount); err != nil {
		return SQLitePageStats{}, err
	}
	if err := s.db.QueryRowContext(ctx, `PRAGMA freelist_count;`).Scan(&stats.FreelistCount); err != nil {
		return SQLitePageStats{}, err
	}
	if err := s.db.QueryRowContext(ctx, `PRAGMA auto_vacuum;`).Scan(&stats.AutoVacuumMode); err != nil {
		return SQLitePageStats{}, err
	}
	return stats, nil
}

func BuildSQLiteCompactionPlan(stats SQLitePageStats) SQLiteCompactionPlan {
	pageSize := stats.PageSize
	if pageSize <= 0 {
		pageSize = 4096
	}
	freeBytes := stats.FreelistCount * pageSize
	plan := SQLiteCompactionPlan{
		PageSize:       pageSize,
		PageCount:      stats.PageCount,
		FreelistCount:  stats.FreelistCount,
		FreeBytes:      freeBytes,
		PagesToRelease: stats.FreelistCount,
	}
	if stats.FreelistCount <= 0 {
		return plan
	}
	if freeBytes < sqliteCompactionMinFreeBytes {
		return plan
	}
	if stats.FreelistCount < sqliteCompactionMinFreePages {
		return plan
	}
	if stats.PageCount > 0 && (stats.FreelistCount*100)/stats.PageCount < sqliteCompactionMinFreeRatio {
		return plan
	}
	plan.ShouldCompact = true
	plan.UseIncremental = stats.AutoVacuumMode == sqliteAutoVacuumIncremental
	return plan
}

func (s *Store) MaybeCompact(ctx context.Context) (SQLiteCompactionPlan, error) {
	stats, err := s.SQLitePageStats(ctx)
	if err != nil {
		return SQLiteCompactionPlan{}, err
	}
	plan := BuildSQLiteCompactionPlan(stats)
	if !plan.ShouldCompact {
		return plan, nil
	}
	if _, err := s.db.ExecContext(ctx, `PRAGMA wal_checkpoint(TRUNCATE);`); err != nil {
		return plan, err
	}
	if plan.UseIncremental {
		if _, err := s.db.ExecContext(ctx, fmt.Sprintf(`PRAGMA incremental_vacuum(%d);`, plan.PagesToRelease)); err != nil {
			return plan, err
		}
		return plan, nil
	}
	if _, err := s.db.ExecContext(ctx, `VACUUM;`); err != nil {
		return plan, err
	}
	return plan, nil
}

func ensureIncrementalAutoVacuum(db *sql.DB) error {
	if db == nil {
		return errors.New("nil db")
	}
	var mode int64
	if err := db.QueryRow(`PRAGMA auto_vacuum;`).Scan(&mode); err != nil {
		return err
	}
	if mode == sqliteAutoVacuumIncremental {
		return nil
	}
	if _, err := db.Exec(`PRAGMA auto_vacuum=INCREMENTAL;`); err != nil {
		return err
	}
	_, err := db.Exec(`VACUUM;`)
	return err
}

func dedupeNonEmptyStrings(items []string) []string {
	out := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, raw := range items {
		item := strings.TrimSpace(raw)
		if item == "" {
			continue
		}
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		out = append(out, item)
	}
	return out
}
