package threadstore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

const (
	UploadStateStaged   = "staged"
	UploadStateLive     = "live"
	UploadStateDeleting = "deleting"

	UploadRefKindMessage    = "message"
	UploadRefKindQueuedTurn = "queued_turn"

	sqliteAutoVacuumNone        = 0
	sqliteAutoVacuumFull        = 1
	sqliteAutoVacuumIncremental = 2

	sqliteCompactionMinFreeBytes = 4 << 20
	sqliteCompactionMinFreePages = 256
	sqliteCompactionMinFreeRatio = 10
)

type UploadRecord struct {
	UploadID          string `json:"upload_id"`
	EndpointID        string `json:"endpoint_id"`
	StorageRelPath    string `json:"storage_relpath"`
	Name              string `json:"name"`
	MimeType          string `json:"mime_type"`
	SizeBytes         int64  `json:"size_bytes"`
	State             string `json:"state"`
	CreatedAtUnixMs   int64  `json:"created_at_unix_ms"`
	ClaimedAtUnixMs   int64  `json:"claimed_at_unix_ms"`
	DeleteAfterUnixMs int64  `json:"delete_after_unix_ms"`
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

type ThreadDeleteResourcesResult struct {
	CheckpointIDs   []string
	UploadsToDelete []UploadRecord
}

type FollowupDeleteResourcesResult struct {
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
	default:
		return UploadRefKindMessage
	}
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
	rec.StorageRelPath = sanitizeUploadStorageRelPath(rec.StorageRelPath)
	rec.Name = strings.TrimSpace(rec.Name)
	rec.MimeType = strings.TrimSpace(rec.MimeType)
	if rec.MimeType == "" {
		rec.MimeType = "application/octet-stream"
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
	if err := scan.Scan(
		&rec.UploadID,
		&rec.EndpointID,
		&rec.StorageRelPath,
		&rec.Name,
		&rec.MimeType,
		&rec.SizeBytes,
		&rec.State,
		&rec.CreatedAtUnixMs,
		&rec.ClaimedAtUnixMs,
		&rec.DeleteAfterUnixMs,
	); err != nil {
		return err
	}
	rec.State = normalizeUploadState(rec.State)
	rec.StorageRelPath = sanitizeUploadStorageRelPath(rec.StorageRelPath)
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
	if rec.UploadID == "" || rec.EndpointID == "" || rec.StorageRelPath == "" {
		return errors.New("invalid request")
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO ai_uploads(
  upload_id, endpoint_id, storage_relpath, name, mime_type, size_bytes, state,
  created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms
)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, rec.UploadID, rec.EndpointID, rec.StorageRelPath, rec.Name, rec.MimeType, rec.SizeBytes, rec.State,
		rec.CreatedAtUnixMs, rec.ClaimedAtUnixMs, rec.DeleteAfterUnixMs)
	return err
}

func (s *Store) EnsureUpload(ctx context.Context, rec UploadRecord) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec = normalizeUploadRecord(rec)
	if rec.UploadID == "" || rec.EndpointID == "" || rec.StorageRelPath == "" {
		return errors.New("invalid request")
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO ai_uploads(
  upload_id, endpoint_id, storage_relpath, name, mime_type, size_bytes, state,
  created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms
)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(upload_id) DO NOTHING
`, rec.UploadID, rec.EndpointID, rec.StorageRelPath, rec.Name, rec.MimeType, rec.SizeBytes, rec.State,
		rec.CreatedAtUnixMs, rec.ClaimedAtUnixMs, rec.DeleteAfterUnixMs)
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
	if err := s.db.QueryRowContext(ctx, `
SELECT upload_id, endpoint_id, storage_relpath, name, mime_type, size_bytes, state,
       created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms
FROM ai_uploads
WHERE endpoint_id = ? AND upload_id = ?
`, endpointID, uploadID).Scan(
		&rec.UploadID,
		&rec.EndpointID,
		&rec.StorageRelPath,
		&rec.Name,
		&rec.MimeType,
		&rec.SizeBytes,
		&rec.State,
		&rec.CreatedAtUnixMs,
		&rec.ClaimedAtUnixMs,
		&rec.DeleteAfterUnixMs,
	); err != nil {
		return nil, err
	}
	rec.State = normalizeUploadState(rec.State)
	rec.StorageRelPath = sanitizeUploadStorageRelPath(rec.StorageRelPath)
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
	if endpointID == "" || threadID == "" || refID == "" {
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
	if err := bindUploadsToRefTx(ctx, tx, endpointID, threadID, refKind, refID, uploadIDs, claimedAtUnixMs); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) AppendMessageWithUploadRefs(ctx context.Context, endpointID string, threadID string, m Message, updatedByID string, updatedByEmail string, uploadIDs []string, claimedAtUnixMs int64) (int64, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	uploadIDs = dedupeNonEmptyStrings(uploadIDs)
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
	if claimedAtUnixMs <= 0 {
		claimedAtUnixMs = m.CreatedAtUnixMs
	}
	preview := buildPreview(m.Role, m.TextContent, m.MessageJSON)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	rowID, err := appendMessageTx(ctx, tx, endpointID, threadID, m, updatedByID, updatedByEmail, preview)
	if err != nil {
		return 0, err
	}
	if err := bindUploadsToRefTx(ctx, tx, endpointID, threadID, UploadRefKindMessage, m.MessageID, uploadIDs, claimedAtUnixMs); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return rowID, nil
}

func (s *Store) CreateFollowupWithUploadRefs(ctx context.Context, rec QueuedTurn, uploadIDs []string, claimedAtUnixMs int64) (QueuedTurn, int, int64, error) {
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
	rec.Lane = normalizeFollowupLane(rec.Lane)
	rec.MessageID = strings.TrimSpace(rec.MessageID)
	rec.ModelID = strings.TrimSpace(rec.ModelID)
	rec.TextContent = strings.TrimSpace(rec.TextContent)
	rec.AttachmentsJSON = strings.TrimSpace(rec.AttachmentsJSON)
	rec.OptionsJSON = strings.TrimSpace(rec.OptionsJSON)
	rec.SessionMetaJSON = strings.TrimSpace(rec.SessionMetaJSON)
	rec.CreatedByUserPublicID = strings.TrimSpace(rec.CreatedByUserPublicID)
	rec.CreatedByUserEmail = strings.TrimSpace(rec.CreatedByUserEmail)
	uploadIDs = dedupeNonEmptyStrings(uploadIDs)
	if rec.QueueID == "" || rec.EndpointID == "" || rec.ThreadID == "" || rec.ChannelID == "" || rec.MessageID == "" {
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
	queued, position, revision, err := createFollowupTx(ctx, tx, rec)
	if err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	if err := bindUploadsToRefTx(ctx, tx, rec.EndpointID, rec.ThreadID, UploadRefKindQueuedTurn, queued.QueueID, uploadIDs, claimedAtUnixMs); err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	if err := tx.Commit(); err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	return queued, position, revision, nil
}

func bindUploadsToRefTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, refKind string, refID string, uploadIDs []string, claimedAtUnixMs int64) error {
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	refKind = normalizeUploadRefKind(refKind)
	refID = strings.TrimSpace(refID)
	uploadIDs = dedupeNonEmptyStrings(uploadIDs)
	if endpointID == "" || threadID == "" || refID == "" {
		return errors.New("invalid request")
	}
	if len(uploadIDs) == 0 {
		return nil
	}
	if claimedAtUnixMs <= 0 {
		claimedAtUnixMs = time.Now().UnixMilli()
	}
	for _, uploadID := range uploadIDs {
		var exists int
		if err := tx.QueryRowContext(ctx, `
SELECT COUNT(1)
FROM ai_uploads
WHERE endpoint_id = ? AND upload_id = ? AND LOWER(COALESCE(state, '')) <> ?
`, endpointID, uploadID, UploadStateDeleting).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			return sql.ErrNoRows
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
VALUES(?, ?, ?, ?, ?, ?)
ON CONFLICT(endpoint_id, upload_id, ref_kind, ref_id) DO NOTHING
`, endpointID, uploadID, threadID, refKind, refID, claimedAtUnixMs); err != nil {
			return err
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

func (s *Store) DeleteThreadResources(ctx context.Context, endpointID string, threadID string) (ThreadDeleteResourcesResult, error) {
	if s == nil || s.db == nil {
		return ThreadDeleteResourcesResult{}, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return ThreadDeleteResourcesResult{}, errors.New("invalid request")
	}
	now := time.Now().UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ThreadDeleteResourcesResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	checkpointIDs, err := listThreadCheckpointIDsTx(ctx, tx, endpointID, threadID)
	if err != nil {
		return ThreadDeleteResourcesResult{}, err
	}
	uploadsToDelete, err := prepareUploadCleanupForThreadTx(ctx, tx, endpointID, threadID, now)
	if err != nil {
		return ThreadDeleteResourcesResult{}, err
	}
	if err := deleteThreadScopedRowsTx(ctx, tx, endpointID, threadID); err != nil {
		return ThreadDeleteResourcesResult{}, err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM ai_threads WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID)
	if err != nil {
		return ThreadDeleteResourcesResult{}, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ThreadDeleteResourcesResult{}, sql.ErrNoRows
	}
	if err := tx.Commit(); err != nil {
		return ThreadDeleteResourcesResult{}, err
	}
	return ThreadDeleteResourcesResult{
		CheckpointIDs:   checkpointIDs,
		UploadsToDelete: uploadsToDelete,
	}, nil
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

func listThreadCheckpointIDsTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT checkpoint_id
FROM ai_thread_checkpoints
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY created_at_unix_ms ASC, checkpoint_id ASC
`, endpointID, threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]string, 0)
	for rows.Next() {
		var checkpointID string
		if err := rows.Scan(&checkpointID); err != nil {
			return nil, err
		}
		checkpointID = strings.TrimSpace(checkpointID)
		if checkpointID == "" {
			continue
		}
		out = append(out, checkpointID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
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
`, endpointID, threadID, normalizeUploadRefKind(refKind), strings.TrimSpace(refID)); err != nil {
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
	rows, err := tx.QueryContext(ctx, `
SELECT DISTINCT upload_id
FROM ai_upload_refs
WHERE endpoint_id = ? AND thread_id = ? AND ref_kind = ? AND ref_id = ?
`, endpointID, threadID, normalizeUploadRefKind(refKind), strings.TrimSpace(refID))
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
SELECT upload_id, endpoint_id, storage_relpath, name, mime_type, size_bytes, state,
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
SELECT upload_id, endpoint_id, storage_relpath, name, mime_type, size_bytes, state,
       created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms
FROM ai_uploads
WHERE LOWER(COALESCE(state, '')) IN (?, ?)
  AND delete_after_unix_ms > 0
  AND delete_after_unix_ms <= ?
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
