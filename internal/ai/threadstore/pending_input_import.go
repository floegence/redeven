package threadstore

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// PendingInputImport is a one-time v1 queue migration record. Floret owns the
// input lifecycle after ImportPendingInputs accepts this record.
type PendingInputImport struct {
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

func (s *Store) ListPendingInputImports(ctx context.Context, limit int) ([]PendingInputImport, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT request_id, endpoint_id, thread_id, model_id, text_content,
       attachments_json, context_action_json, options_json, session_meta_json,
       created_at_unix_ms
FROM ai_pending_input_imports
WHERE imported_at_unix_ms = 0
ORDER BY endpoint_id, thread_id, created_at_unix_ms, request_id
LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("list pending input imports: %w", err)
	}
	defer rows.Close()
	var records []PendingInputImport
	for rows.Next() {
		var record PendingInputImport
		if err := rows.Scan(
			&record.RequestID, &record.EndpointID, &record.ThreadID, &record.ModelID,
			&record.TextContent, &record.AttachmentsJSON, &record.ContextActionJSON,
			&record.OptionsJSON, &record.SessionMetaJSON, &record.CreatedAtUnixMs,
		); err != nil {
			return nil, fmt.Errorf("scan pending input import: %w", err)
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate pending input imports: %w", err)
	}
	return records, nil
}

func (s *Store) CompletePendingInputImports(ctx context.Context, requestIDs []string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin pending input import completion: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	now := time.Now().UnixMilli()
	for _, requestID := range requestIDs {
		requestID = strings.TrimSpace(requestID)
		if requestID == "" {
			return errors.New("pending input import has an empty request id")
		}
		if _, err := tx.ExecContext(ctx, `
UPDATE ai_pending_input_imports
SET imported_at_unix_ms = ?, error_message = ''
WHERE request_id = ? AND imported_at_unix_ms = 0`, now, requestID); err != nil {
			return fmt.Errorf("complete pending input import %q: %w", requestID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit pending input import completion: %w", err)
	}
	return nil
}
