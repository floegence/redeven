package threadstore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
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

type ForkTurnRef struct {
	SourceTurnID      string
	SourceRunID       string
	DestinationTurnID string
	DestinationRunID  string
	CreatedAtUnixMs   int64
}

func insertForkedThreadTx(ctx context.Context, tx *sql.Tx, req ForkThreadRequest, source Thread, title string) error {
	if tx == nil {
		return errors.New("store not initialized")
	}
	permissionType, err := canonicalPermissionType(source.PermissionType)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO ai_threads(
  thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json,
  permission_type, working_dir, title, title_source, title_generated_at_unix_ms,
  title_input_message_id, title_model_id, title_prompt_version, followups_revision,
  pinned_at_unix_ms, created_by_user_public_id, created_by_user_email,
  updated_by_user_public_id, updated_by_user_email, created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', '', '', 0, 0, ?, ?, ?, ?, ?, ?)
`,
		req.DestinationThreadID,
		req.EndpointID,
		strings.TrimSpace(source.NamespacePublicID),
		strings.TrimSpace(source.ModelID),
		strings.TrimSpace(source.ReasoningSelectionJSON),
		permissionType,
		strings.TrimSpace(source.WorkingDir),
		strings.TrimSpace(title),
		ThreadTitleSourceUser,
		strings.TrimSpace(req.CreatedByUserPublicID),
		strings.TrimSpace(req.CreatedByUserEmail),
		strings.TrimSpace(req.CreatedByUserPublicID),
		strings.TrimSpace(req.CreatedByUserEmail),
		req.CreatedAtUnixMs,
		req.CreatedAtUnixMs,
	)
	return err
}

func forkTurnRefsBySource(refs []ForkTurnRef) (map[string]ForkTurnRef, error) {
	out := make(map[string]ForkTurnRef, len(refs)*2)
	seenDestination := make(map[string]struct{}, len(refs)*2)
	for _, ref := range refs {
		ref.SourceTurnID = strings.TrimSpace(ref.SourceTurnID)
		ref.SourceRunID = strings.TrimSpace(ref.SourceRunID)
		ref.DestinationTurnID = strings.TrimSpace(ref.DestinationTurnID)
		ref.DestinationRunID = strings.TrimSpace(ref.DestinationRunID)
		if ref.SourceTurnID == "" || ref.DestinationTurnID == "" || (ref.SourceRunID == "") != (ref.DestinationRunID == "") {
			return nil, fmt.Errorf("%w: incomplete Floret turn mapping", ErrForkResultConflict)
		}
		if _, exists := out[ref.SourceTurnID]; exists {
			return nil, fmt.Errorf("%w: duplicate source identity %q", ErrForkResultConflict, ref.SourceTurnID)
		}
		if _, exists := seenDestination[ref.DestinationTurnID]; exists {
			return nil, fmt.Errorf("%w: duplicate destination identity %q", ErrForkResultConflict, ref.DestinationTurnID)
		}
		out[ref.SourceTurnID] = ref
		seenDestination[ref.DestinationTurnID] = struct{}{}
		if ref.SourceRunID != "" {
			if _, exists := out[ref.SourceRunID]; exists {
				return nil, fmt.Errorf("%w: duplicate source identity %q", ErrForkResultConflict, ref.SourceRunID)
			}
			if _, exists := seenDestination[ref.DestinationRunID]; exists {
				return nil, fmt.Errorf("%w: duplicate destination identity %q", ErrForkResultConflict, ref.DestinationRunID)
			}
			out[ref.SourceRunID] = ref
			seenDestination[ref.DestinationRunID] = struct{}{}
		}
	}
	return out, nil
}
