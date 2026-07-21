package threadstore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/redeven/internal/ai/permissionsnapshot"
)

type PermissionSnapshotRecord struct {
	SnapshotID       string
	EndpointID       string
	OwnerThreadID    string
	OwnerRunID       string
	PermissionType   string
	SnapshotJSON     string
	SnapshotHash     string
	RegistryHash     string
	SchemaHash       string
	PresentationHash string
	CreatedAtUnixMs  int64
}

type ChildPermissionSnapshotRecord struct {
	ChildSnapshotID   string
	EndpointID        string
	ParentSnapshotID  string
	SpawnToolCallID   string
	ParentThreadID    string
	ParentRunID       string
	ChildThreadID     string
	ChildRunID        string
	State             string
	SnapshotJSON      string
	SnapshotHash      string
	RegistryHash      string
	SchemaHash        string
	PresentationHash  string
	CreatedAtUnixMs   int64
	FinalizedAtUnixMs int64
}

func (s *Store) InsertPermissionSnapshot(ctx context.Context, rec PermissionSnapshotRecord) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec = normalizePermissionSnapshotRecord(rec)
	if err := validatePermissionSnapshotRecord(rec); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireThreadWritableTx(ctx, tx, rec.EndpointID, rec.OwnerThreadID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
INSERT OR IGNORE INTO ai_permission_snapshots(
  snapshot_id, endpoint_id, owner_thread_id, owner_run_id, permission_type,
  snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash,
  created_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, rec.SnapshotID, rec.EndpointID, rec.OwnerThreadID, rec.OwnerRunID, rec.PermissionType,
		rec.SnapshotJSON, rec.SnapshotHash, rec.RegistryHash, rec.SchemaHash, rec.PresentationHash,
		rec.CreatedAtUnixMs); err != nil {
		return err
	}
	var stored PermissionSnapshotRecord
	if err := tx.QueryRowContext(ctx, `
SELECT snapshot_id, endpoint_id, owner_thread_id, owner_run_id, permission_type,
       snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash,
       created_at_unix_ms
FROM ai_permission_snapshots
WHERE snapshot_id = ?
`, rec.SnapshotID).Scan(
		&stored.SnapshotID, &stored.EndpointID, &stored.OwnerThreadID, &stored.OwnerRunID, &stored.PermissionType,
		&stored.SnapshotJSON, &stored.SnapshotHash, &stored.RegistryHash, &stored.SchemaHash, &stored.PresentationHash,
		&stored.CreatedAtUnixMs,
	); err != nil {
		return err
	}
	stored = normalizePermissionSnapshotRecord(stored)
	if err := validatePermissionSnapshotRecord(stored); err != nil {
		return fmt.Errorf("stored permission snapshot is invalid: %w", err)
	}
	if stored.SnapshotID != rec.SnapshotID || stored.EndpointID != rec.EndpointID ||
		stored.OwnerThreadID != rec.OwnerThreadID || stored.OwnerRunID != rec.OwnerRunID ||
		stored.PermissionType != rec.PermissionType || stored.SnapshotJSON != rec.SnapshotJSON ||
		stored.SnapshotHash != rec.SnapshotHash || stored.RegistryHash != rec.RegistryHash ||
		stored.SchemaHash != rec.SchemaHash || stored.PresentationHash != rec.PresentationHash {
		return fmt.Errorf("permission snapshot %q conflicts with the stored audit record", rec.SnapshotID)
	}
	return tx.Commit()
}

func validatePermissionSnapshotRecord(rec PermissionSnapshotRecord) error {
	if rec.SnapshotID == "" || rec.EndpointID == "" || rec.OwnerThreadID == "" || rec.OwnerRunID == "" ||
		rec.PermissionType == "" || rec.SnapshotJSON == "" || rec.SnapshotHash == "" || rec.RegistryHash == "" ||
		rec.SchemaHash == "" || rec.PresentationHash == "" || rec.CreatedAtUnixMs <= 0 {
		return errors.New("invalid permission snapshot")
	}
	if err := permissionsnapshot.ValidateStored(rec.SnapshotJSON, permissionsnapshot.StoredMetadata{
		SnapshotID: rec.SnapshotID, PermissionType: rec.PermissionType, SnapshotHash: rec.SnapshotHash,
		RegistryHash: rec.RegistryHash, SchemaHash: rec.SchemaHash, PresentationHash: rec.PresentationHash,
	}); err != nil {
		return fmt.Errorf("invalid permission snapshot: %w", err)
	}
	return nil
}

func (s *Store) InsertChildPermissionSnapshot(ctx context.Context, rec ChildPermissionSnapshotRecord) error {
	return s.insertChildPermissionSnapshot(ctx, rec)
}

func (s *Store) InsertChildPermissionSnapshotProvisional(ctx context.Context, rec ChildPermissionSnapshotRecord) error {
	rec.State = "provisional"
	rec.FinalizedAtUnixMs = 0
	return s.insertChildPermissionSnapshot(ctx, rec)
}

func (s *Store) insertChildPermissionSnapshot(ctx context.Context, rec ChildPermissionSnapshotRecord) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec = normalizeChildPermissionSnapshotRecord(rec)
	if err := validateChildPermissionSnapshotRecord(rec); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := insertChildPermissionSnapshotTx(ctx, tx, rec); err != nil {
		return err
	}
	return tx.Commit()
}

func validateChildPermissionSnapshotRecord(rec ChildPermissionSnapshotRecord) error {
	if rec.ChildSnapshotID == "" || rec.EndpointID == "" || rec.ParentSnapshotID == "" || rec.SpawnToolCallID == "" ||
		rec.ParentThreadID == "" || rec.ParentRunID == "" || rec.ChildThreadID == "" || rec.SnapshotJSON == "" ||
		rec.SnapshotHash == "" || rec.RegistryHash == "" || rec.SchemaHash == "" || rec.PresentationHash == "" ||
		rec.CreatedAtUnixMs <= 0 {
		return errors.New("invalid child permission snapshot")
	}
	if rec.State != "provisional" && rec.State != "finalized" && rec.State != "aborted" {
		return errors.New("invalid child permission snapshot state")
	}
	if ((rec.State == "provisional" || rec.State == "aborted") && rec.FinalizedAtUnixMs != 0) || (rec.State == "finalized" && rec.FinalizedAtUnixMs <= 0) {
		return errors.New("invalid child permission snapshot finalization")
	}
	if rec.ChildRunID == "" || rec.ChildRunID == rec.ChildThreadID || (rec.ParentRunID != "" && rec.ChildRunID == rec.ParentRunID) {
		return errors.New("invalid child permission snapshot run identity")
	}
	if rec.SpawnToolCallID == rec.ChildThreadID || rec.SpawnToolCallID == rec.ChildRunID {
		return errors.New("invalid child permission snapshot spawn identity")
	}
	if err := permissionsnapshot.ValidateStored(rec.SnapshotJSON, permissionsnapshot.StoredMetadata{
		SnapshotID: rec.ChildSnapshotID, SnapshotHash: rec.SnapshotHash,
		RegistryHash: rec.RegistryHash, SchemaHash: rec.SchemaHash, PresentationHash: rec.PresentationHash,
	}); err != nil {
		return fmt.Errorf("invalid child permission snapshot: %w", err)
	}
	return nil
}

func insertChildPermissionSnapshotTx(ctx context.Context, tx *sql.Tx, rec ChildPermissionSnapshotRecord) error {
	if err := requireThreadWritableTx(ctx, tx, rec.EndpointID, rec.ParentThreadID); err != nil {
		return err
	}
	if err := requireThreadWritableTx(ctx, tx, rec.EndpointID, rec.ChildThreadID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
	INSERT OR IGNORE INTO ai_child_permission_snapshots(
	  child_snapshot_id, endpoint_id, parent_snapshot_id, spawn_tool_call_id,
	  parent_thread_id, parent_run_id, child_thread_id, child_run_id,
	  state, snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash,
	  created_at_unix_ms, finalized_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, rec.ChildSnapshotID, rec.EndpointID, rec.ParentSnapshotID, rec.SpawnToolCallID,
		rec.ParentThreadID, rec.ParentRunID, rec.ChildThreadID, rec.ChildRunID,
		rec.State, rec.SnapshotJSON, rec.SnapshotHash, rec.RegistryHash, rec.SchemaHash, rec.PresentationHash,
		rec.CreatedAtUnixMs, rec.FinalizedAtUnixMs); err != nil {
		return err
	}
	stored, err := loadChildPermissionSnapshotTx(ctx, tx, rec.ChildSnapshotID)
	if err != nil {
		return err
	}
	if !sameChildPermissionSnapshot(stored, rec) {
		return fmt.Errorf("child permission snapshot %q conflicts with the stored audit record", rec.ChildSnapshotID)
	}
	return nil
}

func loadChildPermissionSnapshotTx(ctx context.Context, tx *sql.Tx, snapshotID string) (ChildPermissionSnapshotRecord, error) {
	var rec ChildPermissionSnapshotRecord
	err := tx.QueryRowContext(ctx, `
SELECT child_snapshot_id, endpoint_id, parent_snapshot_id, spawn_tool_call_id,
       parent_thread_id, parent_run_id, child_thread_id, child_run_id,
       state, snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash,
       created_at_unix_ms, finalized_at_unix_ms
FROM ai_child_permission_snapshots
WHERE child_snapshot_id = ?
`, snapshotID).Scan(
		&rec.ChildSnapshotID, &rec.EndpointID, &rec.ParentSnapshotID, &rec.SpawnToolCallID,
		&rec.ParentThreadID, &rec.ParentRunID, &rec.ChildThreadID, &rec.ChildRunID,
		&rec.State, &rec.SnapshotJSON, &rec.SnapshotHash, &rec.RegistryHash, &rec.SchemaHash, &rec.PresentationHash,
		&rec.CreatedAtUnixMs, &rec.FinalizedAtUnixMs,
	)
	if err != nil {
		return ChildPermissionSnapshotRecord{}, err
	}
	rec = normalizeChildPermissionSnapshotRecord(rec)
	if err := validateChildPermissionSnapshotRecord(rec); err != nil {
		return ChildPermissionSnapshotRecord{}, fmt.Errorf("stored child permission snapshot is invalid: %w", err)
	}
	return rec, nil
}

func sameChildPermissionSnapshot(left, right ChildPermissionSnapshotRecord) bool {
	return left.ChildSnapshotID == right.ChildSnapshotID && left.EndpointID == right.EndpointID &&
		left.ParentSnapshotID == right.ParentSnapshotID && left.SpawnToolCallID == right.SpawnToolCallID &&
		left.ParentThreadID == right.ParentThreadID && left.ParentRunID == right.ParentRunID &&
		left.ChildThreadID == right.ChildThreadID && left.ChildRunID == right.ChildRunID &&
		left.State == right.State && left.SnapshotJSON == right.SnapshotJSON &&
		left.SnapshotHash == right.SnapshotHash && left.RegistryHash == right.RegistryHash &&
		left.SchemaHash == right.SchemaHash && left.PresentationHash == right.PresentationHash &&
		left.CreatedAtUnixMs == right.CreatedAtUnixMs && left.FinalizedAtUnixMs == right.FinalizedAtUnixMs
}

func (s *Store) GetChildPermissionSnapshotBySpawnToolCall(ctx context.Context, endpointID string, spawnToolCallID string) (ChildPermissionSnapshotRecord, bool, error) {
	if s == nil || s.db == nil {
		return ChildPermissionSnapshotRecord{}, false, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	spawnToolCallID = strings.TrimSpace(spawnToolCallID)
	if endpointID == "" || spawnToolCallID == "" {
		return ChildPermissionSnapshotRecord{}, false, errors.New("invalid child permission snapshot lookup")
	}
	row := s.db.QueryRowContext(ctx, `
	SELECT child_snapshot_id, endpoint_id, parent_snapshot_id, spawn_tool_call_id,
	       parent_thread_id, parent_run_id, child_thread_id, child_run_id,
	       state, snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash,
	       created_at_unix_ms, finalized_at_unix_ms
	FROM ai_child_permission_snapshots
	WHERE endpoint_id = ? AND spawn_tool_call_id = ?
	LIMIT 1
	`, endpointID, spawnToolCallID)
	var rec ChildPermissionSnapshotRecord
	if err := row.Scan(
		&rec.ChildSnapshotID, &rec.EndpointID, &rec.ParentSnapshotID, &rec.SpawnToolCallID,
		&rec.ParentThreadID, &rec.ParentRunID, &rec.ChildThreadID, &rec.ChildRunID,
		&rec.State, &rec.SnapshotJSON, &rec.SnapshotHash, &rec.RegistryHash, &rec.SchemaHash, &rec.PresentationHash,
		&rec.CreatedAtUnixMs, &rec.FinalizedAtUnixMs,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ChildPermissionSnapshotRecord{}, false, nil
		}
		return ChildPermissionSnapshotRecord{}, false, err
	}
	rec = normalizeChildPermissionSnapshotRecord(rec)
	if err := validateChildPermissionSnapshotRecord(rec); err != nil {
		return ChildPermissionSnapshotRecord{}, false, fmt.Errorf("stored child permission snapshot is invalid: %w", err)
	}
	return rec, true, nil
}

func (s *Store) FinalizeChildPermissionSnapshot(ctx context.Context, endpointID string, childSnapshotID string, childThreadID string, childRunID string, finalizedAtUnixMs int64) (bool, error) {
	if s == nil || s.db == nil {
		return false, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	childSnapshotID = strings.TrimSpace(childSnapshotID)
	childThreadID = strings.TrimSpace(childThreadID)
	childRunID = strings.TrimSpace(childRunID)
	if endpointID == "" || childSnapshotID == "" || childThreadID == "" || childRunID == "" || childRunID == childThreadID {
		return false, errors.New("invalid child permission snapshot finalize request")
	}
	if finalizedAtUnixMs <= 0 {
		return false, errors.New("invalid child permission snapshot finalize time")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()
	record, err := loadChildPermissionSnapshotTx(ctx, tx, childSnapshotID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if record.EndpointID != endpointID || record.ChildThreadID != childThreadID || record.ChildRunID != childRunID || record.State != "provisional" {
		return false, nil
	}
	if err := requireThreadWritableTx(ctx, tx, endpointID, record.ParentThreadID); err != nil {
		return false, err
	}
	if err := requireThreadWritableTx(ctx, tx, endpointID, record.ChildThreadID); err != nil {
		return false, err
	}
	res, err := tx.ExecContext(ctx, `
	UPDATE ai_child_permission_snapshots
	SET state = 'finalized',
	    finalized_at_unix_ms = ?
	WHERE endpoint_id = ?
	  AND child_snapshot_id = ?
	  AND child_thread_id = ?
	  AND child_run_id = ?
	  AND state = 'provisional'
	`, finalizedAtUnixMs, endpointID, childSnapshotID, childThreadID, childRunID)
	if err != nil {
		return false, err
	}
	changed, _ := res.RowsAffected()
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return changed > 0, nil
}

func (s *Store) GetPermissionSnapshot(ctx context.Context, endpointID string, snapshotID string) (PermissionSnapshotRecord, bool, error) {
	if s == nil || s.db == nil {
		return PermissionSnapshotRecord{}, false, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	snapshotID = strings.TrimSpace(snapshotID)
	if endpointID == "" || snapshotID == "" {
		return PermissionSnapshotRecord{}, false, errors.New("invalid permission snapshot lookup")
	}
	row := s.db.QueryRowContext(ctx, `
SELECT snapshot_id, endpoint_id, owner_thread_id, owner_run_id, permission_type,
       snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash,
       created_at_unix_ms
FROM ai_permission_snapshots
WHERE endpoint_id = ? AND snapshot_id = ?
LIMIT 1
`, endpointID, snapshotID)
	var rec PermissionSnapshotRecord
	if err := row.Scan(
		&rec.SnapshotID, &rec.EndpointID, &rec.OwnerThreadID, &rec.OwnerRunID, &rec.PermissionType,
		&rec.SnapshotJSON, &rec.SnapshotHash, &rec.RegistryHash, &rec.SchemaHash, &rec.PresentationHash,
		&rec.CreatedAtUnixMs,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return PermissionSnapshotRecord{}, false, nil
		}
		return PermissionSnapshotRecord{}, false, err
	}
	rec = normalizePermissionSnapshotRecord(rec)
	if err := validatePermissionSnapshotRecord(rec); err != nil {
		return PermissionSnapshotRecord{}, false, fmt.Errorf("stored permission snapshot is invalid: %w", err)
	}
	return rec, true, nil
}

func (s *Store) GetFinalizedChildPermissionSnapshot(ctx context.Context, endpointID string, childThreadID string, childRunID string) (ChildPermissionSnapshotRecord, bool, error) {
	if s == nil || s.db == nil {
		return ChildPermissionSnapshotRecord{}, false, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	childThreadID = strings.TrimSpace(childThreadID)
	childRunID = strings.TrimSpace(childRunID)
	if endpointID == "" || childThreadID == "" || childRunID == "" {
		return ChildPermissionSnapshotRecord{}, false, errors.New("invalid child permission snapshot lookup")
	}
	row := s.db.QueryRowContext(ctx, `
SELECT child_snapshot_id, endpoint_id, parent_snapshot_id, spawn_tool_call_id,
	       parent_thread_id, parent_run_id, child_thread_id, child_run_id,
       state, snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash,
       created_at_unix_ms, finalized_at_unix_ms
FROM ai_child_permission_snapshots
WHERE endpoint_id = ? AND child_thread_id = ? AND child_run_id = ? AND state = 'finalized'
LIMIT 1
`, endpointID, childThreadID, childRunID)
	var rec ChildPermissionSnapshotRecord
	if err := row.Scan(
		&rec.ChildSnapshotID, &rec.EndpointID, &rec.ParentSnapshotID, &rec.SpawnToolCallID,
		&rec.ParentThreadID, &rec.ParentRunID, &rec.ChildThreadID, &rec.ChildRunID,
		&rec.State, &rec.SnapshotJSON, &rec.SnapshotHash, &rec.RegistryHash, &rec.SchemaHash, &rec.PresentationHash,
		&rec.CreatedAtUnixMs, &rec.FinalizedAtUnixMs,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ChildPermissionSnapshotRecord{}, false, nil
		}
		return ChildPermissionSnapshotRecord{}, false, err
	}
	rec = normalizeChildPermissionSnapshotRecord(rec)
	if err := validateChildPermissionSnapshotRecord(rec); err != nil {
		return ChildPermissionSnapshotRecord{}, false, fmt.Errorf("stored child permission snapshot is invalid: %w", err)
	}
	return rec, true, nil
}

func (s *Store) GetFinalizedChildPermissionSnapshotByThread(ctx context.Context, endpointID string, childThreadID string) (ChildPermissionSnapshotRecord, bool, error) {
	if s == nil || s.db == nil {
		return ChildPermissionSnapshotRecord{}, false, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	childThreadID = strings.TrimSpace(childThreadID)
	if endpointID == "" || childThreadID == "" {
		return ChildPermissionSnapshotRecord{}, false, errors.New("invalid child permission snapshot lookup")
	}
	row := s.db.QueryRowContext(ctx, `
SELECT child_snapshot_id, endpoint_id, parent_snapshot_id, spawn_tool_call_id,
	       parent_thread_id, parent_run_id, child_thread_id, child_run_id,
       state, snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash,
       created_at_unix_ms, finalized_at_unix_ms
FROM ai_child_permission_snapshots
WHERE endpoint_id = ? AND child_thread_id = ? AND state = 'finalized'
ORDER BY finalized_at_unix_ms DESC, created_at_unix_ms DESC
LIMIT 1
`, endpointID, childThreadID)
	var rec ChildPermissionSnapshotRecord
	if err := row.Scan(
		&rec.ChildSnapshotID, &rec.EndpointID, &rec.ParentSnapshotID, &rec.SpawnToolCallID,
		&rec.ParentThreadID, &rec.ParentRunID, &rec.ChildThreadID, &rec.ChildRunID,
		&rec.State, &rec.SnapshotJSON, &rec.SnapshotHash, &rec.RegistryHash, &rec.SchemaHash, &rec.PresentationHash,
		&rec.CreatedAtUnixMs, &rec.FinalizedAtUnixMs,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ChildPermissionSnapshotRecord{}, false, nil
		}
		return ChildPermissionSnapshotRecord{}, false, err
	}
	rec = normalizeChildPermissionSnapshotRecord(rec)
	if err := validateChildPermissionSnapshotRecord(rec); err != nil {
		return ChildPermissionSnapshotRecord{}, false, fmt.Errorf("stored child permission snapshot is invalid: %w", err)
	}
	return rec, true, nil
}

func normalizePermissionSnapshotRecord(rec PermissionSnapshotRecord) PermissionSnapshotRecord {
	rec.SnapshotID = strings.TrimSpace(rec.SnapshotID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.OwnerThreadID = strings.TrimSpace(rec.OwnerThreadID)
	rec.OwnerRunID = strings.TrimSpace(rec.OwnerRunID)
	rec.PermissionType = strings.TrimSpace(rec.PermissionType)
	rec.SnapshotJSON = strings.TrimSpace(rec.SnapshotJSON)
	rec.SnapshotHash = strings.TrimSpace(rec.SnapshotHash)
	rec.RegistryHash = strings.TrimSpace(rec.RegistryHash)
	rec.SchemaHash = strings.TrimSpace(rec.SchemaHash)
	rec.PresentationHash = strings.TrimSpace(rec.PresentationHash)
	return rec
}

func normalizeChildPermissionSnapshotRecord(rec ChildPermissionSnapshotRecord) ChildPermissionSnapshotRecord {
	rec.ChildSnapshotID = strings.TrimSpace(rec.ChildSnapshotID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ParentSnapshotID = strings.TrimSpace(rec.ParentSnapshotID)
	rec.SpawnToolCallID = strings.TrimSpace(rec.SpawnToolCallID)
	rec.ParentThreadID = strings.TrimSpace(rec.ParentThreadID)
	rec.ParentRunID = strings.TrimSpace(rec.ParentRunID)
	rec.ChildThreadID = strings.TrimSpace(rec.ChildThreadID)
	rec.ChildRunID = strings.TrimSpace(rec.ChildRunID)
	rec.State = strings.TrimSpace(rec.State)
	rec.SnapshotJSON = strings.TrimSpace(rec.SnapshotJSON)
	rec.SnapshotHash = strings.TrimSpace(rec.SnapshotHash)
	rec.RegistryHash = strings.TrimSpace(rec.RegistryHash)
	rec.SchemaHash = strings.TrimSpace(rec.SchemaHash)
	rec.PresentationHash = strings.TrimSpace(rec.PresentationHash)
	return rec
}
