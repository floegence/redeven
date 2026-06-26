package threadstore

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
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
	SubagentID        string
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
	if rec.SnapshotID == "" || rec.EndpointID == "" || rec.OwnerThreadID == "" || rec.PermissionType == "" || rec.SnapshotJSON == "" {
		return errors.New("invalid permission snapshot")
	}
	_, err := s.db.ExecContext(ctx, `
INSERT OR IGNORE INTO ai_permission_snapshots(
  snapshot_id, endpoint_id, owner_thread_id, owner_run_id, permission_type,
  snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash,
  created_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, rec.SnapshotID, rec.EndpointID, rec.OwnerThreadID, rec.OwnerRunID, rec.PermissionType,
		rec.SnapshotJSON, rec.SnapshotHash, rec.RegistryHash, rec.SchemaHash, rec.PresentationHash,
		rec.CreatedAtUnixMs)
	return err
}

func (s *Store) InsertChildPermissionSnapshot(ctx context.Context, rec ChildPermissionSnapshotRecord) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec = normalizeChildPermissionSnapshotRecord(rec)
	if rec.ChildSnapshotID == "" || rec.EndpointID == "" || rec.ParentSnapshotID == "" || rec.SpawnToolCallID == "" || rec.ParentThreadID == "" || rec.ChildThreadID == "" || rec.SnapshotJSON == "" {
		return errors.New("invalid child permission snapshot")
	}
	_, err := s.db.ExecContext(ctx, `
INSERT OR IGNORE INTO ai_child_permission_snapshots(
  child_snapshot_id, endpoint_id, parent_snapshot_id, spawn_tool_call_id,
  parent_thread_id, parent_run_id, subagent_id, child_thread_id, child_run_id,
  state, snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash,
  created_at_unix_ms, finalized_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, rec.ChildSnapshotID, rec.EndpointID, rec.ParentSnapshotID, rec.SpawnToolCallID,
		rec.ParentThreadID, rec.ParentRunID, rec.SubagentID, rec.ChildThreadID, rec.ChildRunID,
		rec.State, rec.SnapshotJSON, rec.SnapshotHash, rec.RegistryHash, rec.SchemaHash, rec.PresentationHash,
		rec.CreatedAtUnixMs, rec.FinalizedAtUnixMs)
	return err
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
       parent_thread_id, parent_run_id, subagent_id, child_thread_id, child_run_id,
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
		&rec.ParentThreadID, &rec.ParentRunID, &rec.SubagentID, &rec.ChildThreadID, &rec.ChildRunID,
		&rec.State, &rec.SnapshotJSON, &rec.SnapshotHash, &rec.RegistryHash, &rec.SchemaHash, &rec.PresentationHash,
		&rec.CreatedAtUnixMs, &rec.FinalizedAtUnixMs,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ChildPermissionSnapshotRecord{}, false, nil
		}
		return ChildPermissionSnapshotRecord{}, false, err
	}
	return normalizeChildPermissionSnapshotRecord(rec), true, nil
}

func normalizePermissionSnapshotRecord(rec PermissionSnapshotRecord) PermissionSnapshotRecord {
	rec.SnapshotID = strings.TrimSpace(rec.SnapshotID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.OwnerThreadID = strings.TrimSpace(rec.OwnerThreadID)
	rec.OwnerRunID = strings.TrimSpace(rec.OwnerRunID)
	rec.PermissionType = strings.TrimSpace(rec.PermissionType)
	rec.SnapshotJSON = strings.TrimSpace(rec.SnapshotJSON)
	if rec.SnapshotJSON == "" {
		rec.SnapshotJSON = "{}"
	}
	rec.SnapshotHash = strings.TrimSpace(rec.SnapshotHash)
	rec.RegistryHash = strings.TrimSpace(rec.RegistryHash)
	rec.SchemaHash = strings.TrimSpace(rec.SchemaHash)
	rec.PresentationHash = strings.TrimSpace(rec.PresentationHash)
	if rec.CreatedAtUnixMs <= 0 {
		rec.CreatedAtUnixMs = time.Now().UnixMilli()
	}
	return rec
}

func normalizeChildPermissionSnapshotRecord(rec ChildPermissionSnapshotRecord) ChildPermissionSnapshotRecord {
	rec.ChildSnapshotID = strings.TrimSpace(rec.ChildSnapshotID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ParentSnapshotID = strings.TrimSpace(rec.ParentSnapshotID)
	rec.SpawnToolCallID = strings.TrimSpace(rec.SpawnToolCallID)
	rec.ParentThreadID = strings.TrimSpace(rec.ParentThreadID)
	rec.ParentRunID = strings.TrimSpace(rec.ParentRunID)
	rec.SubagentID = strings.TrimSpace(rec.SubagentID)
	rec.ChildThreadID = strings.TrimSpace(rec.ChildThreadID)
	rec.ChildRunID = strings.TrimSpace(rec.ChildRunID)
	rec.State = strings.TrimSpace(rec.State)
	if rec.State == "" {
		rec.State = "finalized"
	}
	rec.SnapshotJSON = strings.TrimSpace(rec.SnapshotJSON)
	if rec.SnapshotJSON == "" {
		rec.SnapshotJSON = "{}"
	}
	rec.SnapshotHash = strings.TrimSpace(rec.SnapshotHash)
	rec.RegistryHash = strings.TrimSpace(rec.RegistryHash)
	rec.SchemaHash = strings.TrimSpace(rec.SchemaHash)
	rec.PresentationHash = strings.TrimSpace(rec.PresentationHash)
	if rec.CreatedAtUnixMs <= 0 {
		rec.CreatedAtUnixMs = time.Now().UnixMilli()
	}
	if rec.FinalizedAtUnixMs <= 0 && rec.State == "finalized" {
		rec.FinalizedAtUnixMs = rec.CreatedAtUnixMs
	}
	return rec
}
