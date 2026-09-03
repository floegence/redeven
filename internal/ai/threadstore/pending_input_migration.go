package threadstore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// PendingInputMigrationRecord is one retired product queue item presented only
// while an older threadstore is being upgraded. It is never current-schema
// state and cannot be created by production handlers.
type PendingInputMigrationRecord struct {
	RequestID         string
	EndpointID        string
	ThreadID          string
	ModelID           string
	TextContent       string
	AttachmentsJSON   string
	ContextActionJSON string
	OptionsJSON       string
	SessionMetaJSON   string
	CreatedAtUnixMs   int64
}

// PendingInputMigrationSource exposes only the current product facts needed to
// convert a retired queue item into Floret's canonical input contract.
type PendingInputMigrationSource interface {
	GetThreadSettings(context.Context, string, string) (*ThreadSettings, error)
	LegacyPrimaryTargetID(context.Context, string, string) (string, error)
	GetThreadOwnedUpload(context.Context, string, string, string) (*UploadRecord, error)
}

// PendingInputMigrationHandler converts every supplied retired queue item into
// canonical Floret state. Returned authorities must correspond one-to-one with
// the records. The product migration commits those authorities and removes the
// retired source in the same transaction after the handler succeeds.
type PendingInputMigrationHandler func(context.Context, PendingInputMigrationSource, []PendingInputMigrationRecord) ([]ExecutionAuthority, error)

type pendingInputMigrationSource struct {
	tx *sql.Tx
}

func (source pendingInputMigrationSource) GetThreadSettings(ctx context.Context, endpointID, threadID string) (*ThreadSettings, error) {
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if source.tx == nil || endpointID == "" || threadID == "" {
		return nil, errors.New("invalid pending input migration thread")
	}
	var settings ThreadSettings
	err := scanThreadRow(source.tx.QueryRowContext(ctxOrBackground(ctx), fmt.Sprintf(`
SELECT
%s
FROM ai_thread_settings
WHERE endpoint_id = ? AND thread_id = ?
`, threadSelectColumnsSQL), endpointID, threadID), &settings)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &settings, nil
}

func (source pendingInputMigrationSource) LegacyPrimaryTargetID(ctx context.Context, endpointID, threadID string) (string, error) {
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if source.tx == nil || endpointID == "" || threadID == "" {
		return "", errors.New("invalid pending input migration routing")
	}
	var primaryTargetID string
	err := source.tx.QueryRowContext(ctxOrBackground(ctx), `
SELECT primary_target_id
FROM ai_flower_thread_routing
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(&primaryTargetID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(primaryTargetID), nil
}

func (source pendingInputMigrationSource) GetThreadOwnedUpload(ctx context.Context, endpointID, threadID, uploadID string) (*UploadRecord, error) {
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	uploadID = strings.TrimSpace(uploadID)
	if source.tx == nil || endpointID == "" || threadID == "" || uploadID == "" {
		return nil, errors.New("invalid pending input migration upload")
	}
	var record UploadRecord
	err := scanLegacyUploadRowV5(source.tx.QueryRowContext(ctxOrBackground(ctx), `
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
`, endpointID, uploadID, UploadStateLive, threadID, UploadRefKindThread, threadID), &record)
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func scanLegacyUploadRowV5(scan rowScanner, record *UploadRecord) error {
	if record == nil {
		return errors.New("nil legacy upload record")
	}
	var ownerScopeKind, declaredMediaType string
	var claimedAtUnixMs int64
	var unicodePoints, logicalLines sql.NullInt64
	if err := scan.Scan(
		&record.UploadID,
		&record.EndpointID,
		&ownerScopeKind,
		&record.OwnerUserHash,
		&record.StorageRelPath,
		&record.Name,
		&declaredMediaType,
		&record.DetectedMediaType,
		&record.SizeBytes,
		&record.ContentSHA256,
		&unicodePoints,
		&logicalLines,
		&record.Source,
		&record.State,
		&record.CreatedAtUnixMs,
		&claimedAtUnixMs,
		&record.DeleteAfterUnixMs,
	); err != nil {
		return err
	}
	if ownerScopeKind != "user" {
		return errors.New("legacy upload owner scope is invalid")
	}
	if unicodePoints.Valid {
		value := unicodePoints.Int64
		record.UnicodeCodePoints = &value
	}
	if logicalLines.Valid {
		value := logicalLines.Int64
		record.LogicalLineCount = &value
	}
	*record = normalizeUploadRecord(*record)
	return nil
}

func migrateThreadstoreV4ToV5(ctx context.Context, tx *sql.Tx, migrate PendingInputMigrationHandler) error {
	if tx == nil {
		return errors.New("pending input migration transaction is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	records, err := loadPendingInputMigrationRecords(ctx, tx)
	if err != nil {
		return err
	}
	if len(records) > 0 {
		if migrate == nil {
			return errors.New("retired pending inputs require the Flower startup migration handler")
		}
		authorities, err := migrate(ctx, pendingInputMigrationSource{tx: tx}, records)
		if err != nil {
			return fmt.Errorf("import retired pending inputs: %w", err)
		}
		if err := persistPendingInputMigrationAuthorities(ctx, tx, records, authorities); err != nil {
			return err
		}
	}
	if err := rebuildUploadRefsV5(tx); err != nil {
		return err
	}
	if _, err := tx.Exec(`DROP TABLE ai_pending_input_imports`); err != nil {
		return err
	}
	return verifyProductSchemaVersion(tx, 5)
}

func loadPendingInputMigrationRecords(ctx context.Context, tx *sql.Tx) ([]PendingInputMigrationRecord, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT request_id, endpoint_id, thread_id, model_id, text_content,
       attachments_json, context_action_json, options_json, session_meta_json,
       created_at_unix_ms
FROM ai_pending_input_imports
WHERE imported_at_unix_ms = 0
ORDER BY endpoint_id, thread_id, created_at_unix_ms, request_id
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var records []PendingInputMigrationRecord
	for rows.Next() {
		var record PendingInputMigrationRecord
		if err := rows.Scan(
			&record.RequestID,
			&record.EndpointID,
			&record.ThreadID,
			&record.ModelID,
			&record.TextContent,
			&record.AttachmentsJSON,
			&record.ContextActionJSON,
			&record.OptionsJSON,
			&record.SessionMetaJSON,
			&record.CreatedAtUnixMs,
		); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return records, nil
}

func persistPendingInputMigrationAuthorities(ctx context.Context, tx *sql.Tx, records []PendingInputMigrationRecord, authorities []ExecutionAuthority) error {
	if len(authorities) != len(records) {
		return fmt.Errorf("pending input migration returned %d authorities for %d records", len(authorities), len(records))
	}
	byRequest := make(map[string]ExecutionAuthority, len(authorities))
	for _, authority := range authorities {
		requestKey := strings.TrimSpace(authority.RequestKey)
		if requestKey == "" {
			return errors.New("pending input migration returned an authority without a request key")
		}
		if _, exists := byRequest[requestKey]; exists {
			return fmt.Errorf("pending input migration returned duplicate authority %q", requestKey)
		}
		byRequest[requestKey] = authority
	}
	for _, record := range records {
		authority, ok := byRequest[strings.TrimSpace(record.RequestID)]
		if !ok {
			return fmt.Errorf("pending input migration omitted authority %q", record.RequestID)
		}
		if strings.TrimSpace(authority.ThreadID) != strings.TrimSpace(record.ThreadID) ||
			strings.TrimSpace(authority.EndpointID) != strings.TrimSpace(record.EndpointID) {
			return fmt.Errorf("pending input migration authority %q conflicts with its retired source", record.RequestID)
		}
		if err := putExecutionAuthorityTx(ctx, tx, authority); err != nil {
			return fmt.Errorf("persist pending input migration authority %q: %w", record.RequestID, err)
		}
	}
	return nil
}

func rebuildUploadRefsV5(tx *sql.Tx) error {
	_, err := tx.Exec(`
ALTER TABLE ai_upload_refs RENAME TO ai_upload_refs_v4;
CREATE TABLE ai_upload_refs (
  endpoint_id TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  ref_kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY(endpoint_id, upload_id, ref_kind, ref_id)
) WITHOUT ROWID;
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
SELECT endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms
FROM ai_upload_refs_v4;
DROP TABLE ai_upload_refs_v4;
CREATE INDEX idx_ai_upload_refs_thread_upload ON ai_upload_refs(endpoint_id, thread_id, upload_id);
`)
	return err
}
