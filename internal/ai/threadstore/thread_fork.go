package threadstore

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

type ForkThreadRequest struct {
	OperationID           string
	EndpointID            string
	SourceThreadID        string
	DestinationThreadID   string
	Title                 string
	CreatedByUserPublicID string
	CreatedByUserEmail    string
	CreatedAtUnixMs       int64
}

func insertForkedThreadTx(ctx context.Context, tx *sql.Tx, req ForkThreadRequest, source ThreadSettings) error {
	if tx == nil {
		return errors.New("store not initialized")
	}
	permissionType, err := canonicalPermissionType(source.PermissionType)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO ai_thread_settings(
  thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json,
  permission_type, working_dir, pinned_at_unix_ms, queue_revision,
  created_by_user_public_id, created_by_user_email,
  updated_by_user_public_id, updated_by_user_email,
  settings_created_at_unix_ms, settings_updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)
`,
		req.DestinationThreadID,
		req.EndpointID,
		strings.TrimSpace(source.NamespacePublicID),
		strings.TrimSpace(source.ModelID),
		strings.TrimSpace(source.ReasoningSelectionJSON),
		permissionType,
		strings.TrimSpace(source.WorkingDir),
		strings.TrimSpace(req.CreatedByUserPublicID),
		strings.TrimSpace(req.CreatedByUserEmail),
		strings.TrimSpace(req.CreatedByUserPublicID),
		strings.TrimSpace(req.CreatedByUserEmail),
		req.CreatedAtUnixMs,
		req.CreatedAtUnixMs,
	)
	return err
}
