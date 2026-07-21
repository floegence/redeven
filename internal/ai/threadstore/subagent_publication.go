package threadstore

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const (
	SubAgentPublicationPending   = "pending"
	SubAgentPublicationCommitted = "committed"
	SubAgentPublicationFailed    = "failed"
)

type SubAgentPublicationOperation struct {
	PublicationID          string
	EndpointID             string
	ParentThreadID         string
	ParentTurnID           string
	ParentRunID            string
	SpawnToolCallID        string
	ChildThreadID          string
	ChildRunID             string
	ChildSnapshotID        string
	RequestJSON            string
	RequestHash            string
	SessionMetaJSON        string
	ModelID                string
	ReasoningSelectionJSON string
	State                  string
	CreatedAtUnixMs        int64
	CommittedAtUnixMs      int64
	FailedAtUnixMs         int64
}

func (s *Store) PrepareSubAgentPublication(ctx context.Context, operation SubAgentPublicationOperation, snapshot ChildPermissionSnapshotRecord) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	operation = normalizeSubAgentPublicationOperation(operation)
	operation.State = SubAgentPublicationPending
	operation.CommittedAtUnixMs = 0
	operation.FailedAtUnixMs = 0
	snapshot = normalizeChildPermissionSnapshotRecord(snapshot)
	snapshot.State = "provisional"
	snapshot.FinalizedAtUnixMs = 0
	if err := validateSubAgentPublicationOperation(operation, true); err != nil {
		return err
	}
	if err := validateChildPermissionSnapshotRecord(snapshot); err != nil {
		return err
	}
	if operation.EndpointID != snapshot.EndpointID || operation.ParentThreadID != snapshot.ParentThreadID ||
		operation.ParentRunID != snapshot.ParentRunID || operation.SpawnToolCallID != snapshot.SpawnToolCallID ||
		operation.ChildThreadID != snapshot.ChildThreadID || operation.ChildRunID != snapshot.ChildRunID ||
		operation.ChildSnapshotID != snapshot.ChildSnapshotID {
		return errors.New("SubAgent publication operation conflicts with its permission audit")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	stored, found, err := loadSubAgentPublicationOperationTx(ctx, tx, operation.PublicationID)
	if err != nil {
		return err
	}
	if found {
		if !sameSubAgentPublicationIdentity(stored, operation) {
			return fmt.Errorf("SubAgent publication %q conflicts with the stored operation", operation.PublicationID)
		}
		if stored.State == SubAgentPublicationCommitted {
			return tx.Commit()
		}
		if stored.State == SubAgentPublicationFailed {
			return fmt.Errorf("SubAgent publication %q already failed", operation.PublicationID)
		}
		if stored.RequestJSON != operation.RequestJSON || stored.SessionMetaJSON != operation.SessionMetaJSON ||
			stored.ModelID != operation.ModelID || stored.ReasoningSelectionJSON != operation.ReasoningSelectionJSON ||
			stored.CreatedAtUnixMs != operation.CreatedAtUnixMs {
			return fmt.Errorf("SubAgent publication %q conflicts with the stored pending intent", operation.PublicationID)
		}
	} else {
		if _, err := tx.ExecContext(ctx, `
INSERT INTO ai_subagent_publication_operations(
  publication_id, endpoint_id, parent_thread_id, parent_turn_id, parent_run_id,
  spawn_tool_call_id, child_thread_id, child_run_id, child_snapshot_id,
  request_json, request_hash, session_meta_json, model_id, reasoning_selection_json,
	  state, created_at_unix_ms, committed_at_unix_ms, failed_at_unix_ms
	) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, operation.PublicationID, operation.EndpointID, operation.ParentThreadID, operation.ParentTurnID, operation.ParentRunID,
			operation.SpawnToolCallID, operation.ChildThreadID, operation.ChildRunID, operation.ChildSnapshotID,
			operation.RequestJSON, operation.RequestHash, operation.SessionMetaJSON, operation.ModelID, operation.ReasoningSelectionJSON,
			operation.State, operation.CreatedAtUnixMs, operation.CommittedAtUnixMs, operation.FailedAtUnixMs); err != nil {
			return err
		}
	}
	if err := insertChildPermissionSnapshotTx(ctx, tx, snapshot); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) FinalizeSubAgentPublication(ctx context.Context, publicationID string, childSnapshotID string, childThreadID string, childRunID string, committedAtUnixMs int64) (bool, error) {
	if s == nil || s.db == nil {
		return false, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	publicationID = strings.TrimSpace(publicationID)
	childSnapshotID = strings.TrimSpace(childSnapshotID)
	childThreadID = strings.TrimSpace(childThreadID)
	childRunID = strings.TrimSpace(childRunID)
	if publicationID == "" || childSnapshotID == "" || childThreadID == "" || childRunID == "" || childRunID == childThreadID || committedAtUnixMs <= 0 {
		return false, errors.New("invalid SubAgent publication finalize request")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()
	operation, found, err := loadSubAgentPublicationOperationTx(ctx, tx, publicationID)
	if err != nil {
		return false, err
	}
	if !found {
		return false, fmt.Errorf("SubAgent publication %q is missing", publicationID)
	}
	if operation.ChildSnapshotID != childSnapshotID || operation.ChildThreadID != childThreadID || operation.ChildRunID != childRunID {
		return false, errors.New("SubAgent publication finalization identity mismatch")
	}
	if operation.State == SubAgentPublicationCommitted {
		return true, tx.Commit()
	}
	if operation.State != SubAgentPublicationPending {
		return false, errors.New("SubAgent publication state is invalid")
	}
	record, err := loadChildPermissionSnapshotTx(ctx, tx, childSnapshotID)
	if err != nil {
		return false, err
	}
	if record.EndpointID != operation.EndpointID || record.ParentThreadID != operation.ParentThreadID ||
		record.ParentRunID != operation.ParentRunID || record.SpawnToolCallID != operation.SpawnToolCallID ||
		record.ChildThreadID != childThreadID || record.ChildRunID != childRunID || record.State != "provisional" {
		return false, errors.New("SubAgent publication permission audit mismatch")
	}
	if err := requireThreadWritableTx(ctx, tx, operation.EndpointID, operation.ParentThreadID); err != nil {
		return false, err
	}
	if err := requireThreadWritableTx(ctx, tx, operation.EndpointID, operation.ChildThreadID); err != nil {
		return false, err
	}
	res, err := tx.ExecContext(ctx, `
UPDATE ai_child_permission_snapshots
SET state = 'finalized', finalized_at_unix_ms = ?
WHERE child_snapshot_id = ? AND state = 'provisional'
`, committedAtUnixMs, childSnapshotID)
	if err != nil {
		return false, err
	}
	if changed, _ := res.RowsAffected(); changed != 1 {
		return false, errors.New("SubAgent publication permission audit changed during finalization")
	}
	res, err = tx.ExecContext(ctx, `
UPDATE ai_subagent_publication_operations
SET state = ?, request_json = '', session_meta_json = '', model_id = '', reasoning_selection_json = '', committed_at_unix_ms = ?
WHERE publication_id = ? AND state = ?
`, SubAgentPublicationCommitted, committedAtUnixMs, publicationID, SubAgentPublicationPending)
	if err != nil {
		return false, err
	}
	if changed, _ := res.RowsAffected(); changed != 1 {
		return false, errors.New("SubAgent publication changed during finalization")
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Store) FailSubAgentPublication(ctx context.Context, publicationID string, childSnapshotID string, childThreadID string, childRunID string, failedAtUnixMs int64) (bool, error) {
	if s == nil || s.db == nil {
		return false, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	publicationID = strings.TrimSpace(publicationID)
	childSnapshotID = strings.TrimSpace(childSnapshotID)
	childThreadID = strings.TrimSpace(childThreadID)
	childRunID = strings.TrimSpace(childRunID)
	if publicationID == "" || childSnapshotID == "" || childThreadID == "" || childRunID == "" || childRunID == childThreadID || failedAtUnixMs <= 0 {
		return false, errors.New("invalid SubAgent publication failure request")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()
	operation, found, err := loadSubAgentPublicationOperationTx(ctx, tx, publicationID)
	if err != nil {
		return false, err
	}
	if !found {
		return false, fmt.Errorf("SubAgent publication %q is missing", publicationID)
	}
	if operation.ChildSnapshotID != childSnapshotID || operation.ChildThreadID != childThreadID || operation.ChildRunID != childRunID {
		return false, errors.New("SubAgent publication failure identity mismatch")
	}
	record, err := loadChildPermissionSnapshotTx(ctx, tx, childSnapshotID)
	if err != nil {
		return false, err
	}
	if record.EndpointID != operation.EndpointID || record.ParentThreadID != operation.ParentThreadID ||
		record.ParentRunID != operation.ParentRunID || record.SpawnToolCallID != operation.SpawnToolCallID ||
		record.ChildThreadID != childThreadID || record.ChildRunID != childRunID {
		return false, errors.New("SubAgent publication failure permission audit mismatch")
	}
	if operation.State == SubAgentPublicationFailed {
		if record.State != "aborted" {
			return false, errors.New("failed SubAgent publication permission audit is not aborted")
		}
		return true, tx.Commit()
	}
	if operation.State != SubAgentPublicationPending {
		return false, errors.New("SubAgent publication cannot fail after commit")
	}
	if record.State != "provisional" {
		return false, errors.New("SubAgent publication failure permission audit is not provisional")
	}
	if err := requireThreadWritableTx(ctx, tx, operation.EndpointID, operation.ParentThreadID); err != nil {
		return false, err
	}
	res, err := tx.ExecContext(ctx, `
	UPDATE ai_child_permission_snapshots
	SET state = 'aborted'
	WHERE child_snapshot_id = ? AND state = 'provisional'
`, childSnapshotID)
	if err != nil {
		return false, err
	}
	if changed, _ := res.RowsAffected(); changed != 1 {
		return false, errors.New("SubAgent publication permission audit changed during failure recording")
	}
	res, err = tx.ExecContext(ctx, `
UPDATE ai_subagent_publication_operations
SET state = ?, request_json = '', session_meta_json = '', model_id = '', reasoning_selection_json = '', failed_at_unix_ms = ?
WHERE publication_id = ? AND state = ?
`, SubAgentPublicationFailed, failedAtUnixMs, publicationID, SubAgentPublicationPending)
	if err != nil {
		return false, err
	}
	if changed, _ := res.RowsAffected(); changed != 1 {
		return false, errors.New("SubAgent publication changed during failure recording")
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Store) ListPendingSubAgentPublications(ctx context.Context, limit int) ([]SubAgentPublicationOperation, error) {
	return s.listPendingSubAgentPublications(ctx, "", "", limit)
}

func (s *Store) ListPendingSubAgentPublicationsForParent(ctx context.Context, endpointID string, parentThreadID string, limit int) ([]SubAgentPublicationOperation, error) {
	endpointID = strings.TrimSpace(endpointID)
	parentThreadID = strings.TrimSpace(parentThreadID)
	if endpointID == "" || parentThreadID == "" {
		return nil, errors.New("invalid SubAgent publication parent identity")
	}
	return s.listPendingSubAgentPublications(ctx, endpointID, parentThreadID, limit)
}

func (s *Store) listPendingSubAgentPublications(ctx context.Context, endpointID string, parentThreadID string, limit int) ([]SubAgentPublicationOperation, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	query := `
SELECT publication_id, endpoint_id, parent_thread_id, parent_turn_id, parent_run_id,
       spawn_tool_call_id, child_thread_id, child_run_id, child_snapshot_id,
	       request_json, request_hash, session_meta_json, model_id, reasoning_selection_json,
	       state, created_at_unix_ms, committed_at_unix_ms, failed_at_unix_ms
FROM ai_subagent_publication_operations
WHERE state = ?
`
	args := []any{SubAgentPublicationPending}
	if endpointID != "" || parentThreadID != "" {
		query += ` AND endpoint_id = ? AND parent_thread_id = ?`
		args = append(args, endpointID, parentThreadID)
	}
	query += `
ORDER BY created_at_unix_ms ASC, publication_id ASC
LIMIT ?
`
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]SubAgentPublicationOperation, 0)
	for rows.Next() {
		record, err := scanSubAgentPublicationOperation(rows)
		if err != nil {
			return nil, err
		}
		if err := validateSubAgentPublicationOperation(record, true); err != nil {
			return nil, err
		}
		out = append(out, record)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) GetSubAgentPublication(ctx context.Context, publicationID string) (SubAgentPublicationOperation, bool, error) {
	if s == nil || s.db == nil {
		return SubAgentPublicationOperation{}, false, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	publicationID = strings.TrimSpace(publicationID)
	if publicationID == "" {
		return SubAgentPublicationOperation{}, false, errors.New("invalid SubAgent publication lookup")
	}
	row := s.db.QueryRowContext(ctx, `
SELECT publication_id, endpoint_id, parent_thread_id, parent_turn_id, parent_run_id,
       spawn_tool_call_id, child_thread_id, child_run_id, child_snapshot_id,
	       request_json, request_hash, session_meta_json, model_id, reasoning_selection_json,
	       state, created_at_unix_ms, committed_at_unix_ms, failed_at_unix_ms
FROM ai_subagent_publication_operations
WHERE publication_id = ?
`, publicationID)
	record, err := scanSubAgentPublicationOperation(row)
	if errors.Is(err, sql.ErrNoRows) {
		return SubAgentPublicationOperation{}, false, nil
	}
	if err != nil {
		return SubAgentPublicationOperation{}, false, err
	}
	if err := validateSubAgentPublicationOperation(record, false); err != nil {
		return SubAgentPublicationOperation{}, false, fmt.Errorf("stored SubAgent publication is invalid: %w", err)
	}
	return record, true, nil
}

func loadSubAgentPublicationOperationTx(ctx context.Context, tx *sql.Tx, publicationID string) (SubAgentPublicationOperation, bool, error) {
	row := tx.QueryRowContext(ctx, `
SELECT publication_id, endpoint_id, parent_thread_id, parent_turn_id, parent_run_id,
       spawn_tool_call_id, child_thread_id, child_run_id, child_snapshot_id,
	       request_json, request_hash, session_meta_json, model_id, reasoning_selection_json,
	       state, created_at_unix_ms, committed_at_unix_ms, failed_at_unix_ms
FROM ai_subagent_publication_operations
WHERE publication_id = ?
`, publicationID)
	record, err := scanSubAgentPublicationOperation(row)
	if errors.Is(err, sql.ErrNoRows) {
		return SubAgentPublicationOperation{}, false, nil
	}
	if err != nil {
		return SubAgentPublicationOperation{}, false, err
	}
	if err := validateSubAgentPublicationOperation(record, false); err != nil {
		return SubAgentPublicationOperation{}, false, fmt.Errorf("stored SubAgent publication is invalid: %w", err)
	}
	return record, true, nil
}

func scanSubAgentPublicationOperation(scanner interface{ Scan(...any) error }) (SubAgentPublicationOperation, error) {
	var record SubAgentPublicationOperation
	err := scanner.Scan(
		&record.PublicationID, &record.EndpointID, &record.ParentThreadID, &record.ParentTurnID, &record.ParentRunID,
		&record.SpawnToolCallID, &record.ChildThreadID, &record.ChildRunID, &record.ChildSnapshotID,
		&record.RequestJSON, &record.RequestHash, &record.SessionMetaJSON, &record.ModelID, &record.ReasoningSelectionJSON,
		&record.State, &record.CreatedAtUnixMs, &record.CommittedAtUnixMs, &record.FailedAtUnixMs,
	)
	return normalizeSubAgentPublicationOperation(record), err
}

func normalizeSubAgentPublicationOperation(record SubAgentPublicationOperation) SubAgentPublicationOperation {
	record.PublicationID = strings.TrimSpace(record.PublicationID)
	record.EndpointID = strings.TrimSpace(record.EndpointID)
	record.ParentThreadID = strings.TrimSpace(record.ParentThreadID)
	record.ParentTurnID = strings.TrimSpace(record.ParentTurnID)
	record.ParentRunID = strings.TrimSpace(record.ParentRunID)
	record.SpawnToolCallID = strings.TrimSpace(record.SpawnToolCallID)
	record.ChildThreadID = strings.TrimSpace(record.ChildThreadID)
	record.ChildRunID = strings.TrimSpace(record.ChildRunID)
	record.ChildSnapshotID = strings.TrimSpace(record.ChildSnapshotID)
	record.RequestJSON = strings.TrimSpace(record.RequestJSON)
	record.RequestHash = strings.TrimSpace(record.RequestHash)
	record.SessionMetaJSON = strings.TrimSpace(record.SessionMetaJSON)
	record.ModelID = strings.TrimSpace(record.ModelID)
	record.ReasoningSelectionJSON = strings.TrimSpace(record.ReasoningSelectionJSON)
	record.State = strings.TrimSpace(record.State)
	return record
}

func validateSubAgentPublicationOperation(record SubAgentPublicationOperation, requirePendingPayload bool) error {
	if record.PublicationID == "" || record.EndpointID == "" || record.ParentThreadID == "" || record.ParentTurnID == "" ||
		record.ParentRunID == "" || record.SpawnToolCallID == "" || record.ChildThreadID == "" || record.ChildRunID == "" ||
		record.ChildSnapshotID == "" || record.RequestHash == "" || record.CreatedAtUnixMs <= 0 ||
		record.ChildRunID == record.ChildThreadID || record.ChildRunID == record.ParentRunID {
		return errors.New("invalid SubAgent publication operation")
	}
	if decoded, err := hex.DecodeString(record.RequestHash); err != nil || len(decoded) != 32 {
		return errors.New("invalid SubAgent publication request hash")
	}
	if record.State != SubAgentPublicationPending && record.State != SubAgentPublicationCommitted && record.State != SubAgentPublicationFailed {
		return errors.New("invalid SubAgent publication state")
	}
	if record.State == SubAgentPublicationPending {
		if record.CommittedAtUnixMs != 0 || record.FailedAtUnixMs != 0 {
			return errors.New("invalid pending SubAgent publication timestamp")
		}
		if requirePendingPayload && (record.RequestJSON == "" || record.SessionMetaJSON == "" || record.ModelID == "" || !json.Valid([]byte(record.RequestJSON)) || !json.Valid([]byte(record.SessionMetaJSON))) {
			return errors.New("invalid pending SubAgent publication payload")
		}
	} else if record.State == SubAgentPublicationCommitted {
		if record.CommittedAtUnixMs <= 0 || record.FailedAtUnixMs != 0 {
			return errors.New("invalid committed SubAgent publication timestamp")
		}
		if record.RequestJSON != "" || record.SessionMetaJSON != "" || record.ModelID != "" || record.ReasoningSelectionJSON != "" {
			return errors.New("committed SubAgent publication retained replay payload")
		}
	} else {
		if record.FailedAtUnixMs <= 0 || record.CommittedAtUnixMs != 0 {
			return errors.New("invalid failed SubAgent publication timestamp")
		}
		if record.RequestJSON != "" || record.SessionMetaJSON != "" || record.ModelID != "" || record.ReasoningSelectionJSON != "" {
			return errors.New("failed SubAgent publication retained replay payload")
		}
	}
	return nil
}

func sameSubAgentPublicationIdentity(left, right SubAgentPublicationOperation) bool {
	return left.PublicationID == right.PublicationID && left.EndpointID == right.EndpointID &&
		left.ParentThreadID == right.ParentThreadID && left.ParentTurnID == right.ParentTurnID && left.ParentRunID == right.ParentRunID &&
		left.SpawnToolCallID == right.SpawnToolCallID && left.ChildThreadID == right.ChildThreadID && left.ChildRunID == right.ChildRunID &&
		left.ChildSnapshotID == right.ChildSnapshotID && left.RequestHash == right.RequestHash
}
