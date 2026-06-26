package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
)

func (r *run) freezePermissionSnapshot(snapshot PermissionSnapshot) PermissionSnapshot {
	if r == nil {
		return snapshot
	}
	snapshot = permissionSnapshotWithOwnerIdentity(snapshot, r.endpointID, r.threadID, r.id)
	r.permissionSnapshot = snapshot
	r.persistPermissionSnapshot(snapshot)
	return snapshot
}

func persistContextForRun(r *run) (context.Context, context.CancelFunc) {
	persistTO := defaultPersistOpTimeout
	if r != nil && r.persistOpTimeout > 0 {
		persistTO = r.persistOpTimeout
	}
	return context.WithTimeout(context.Background(), persistTO)
}

func (r *run) persistPermissionSnapshot(snapshot PermissionSnapshot) {
	if r == nil || r.threadsDB == nil || strings.TrimSpace(snapshot.SnapshotID) == "" {
		return
	}
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return
	}
	ctx, cancel := persistContextForRun(r)
	defer cancel()
	_ = r.threadsDB.InsertPermissionSnapshot(ctx, threadstore.PermissionSnapshotRecord{
		SnapshotID:       snapshot.SnapshotID,
		EndpointID:       strings.TrimSpace(r.endpointID),
		OwnerThreadID:    strings.TrimSpace(r.threadID),
		OwnerRunID:       strings.TrimSpace(r.id),
		PermissionType:   permissionTypeString(snapshot.PermissionType),
		SnapshotJSON:     string(payload),
		SnapshotHash:     snapshot.SnapshotHash,
		RegistryHash:     snapshot.RegistryHash,
		SchemaHash:       snapshot.SchemaHash,
		PresentationHash: snapshot.PresentationHash,
		CreatedAtUnixMs:  time.Now().UnixMilli(),
	})
}

func (r *run) insertChildPermissionSnapshot(childThreadID string, spawnToolCallID string, child PermissionSnapshot) error {
	if r == nil || r.threadsDB == nil || strings.TrimSpace(r.permissionSnapshot.SnapshotID) == "" || strings.TrimSpace(child.SnapshotID) == "" {
		return errors.New("missing child permission snapshot persistence context")
	}
	payload, err := json.Marshal(child)
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	ctx, cancel := persistContextForRun(r)
	defer cancel()
	return r.threadsDB.InsertChildPermissionSnapshot(ctx, threadstore.ChildPermissionSnapshotRecord{
		ChildSnapshotID:   child.SnapshotID,
		EndpointID:        strings.TrimSpace(r.endpointID),
		ParentSnapshotID:  r.permissionSnapshot.SnapshotID,
		SpawnToolCallID:   firstNonEmptyString(strings.TrimSpace(spawnToolCallID), strings.TrimSpace(childThreadID)),
		ParentThreadID:    strings.TrimSpace(r.threadID),
		ParentRunID:       strings.TrimSpace(r.id),
		SubagentID:        strings.TrimSpace(childThreadID),
		ChildThreadID:     strings.TrimSpace(childThreadID),
		ChildRunID:        strings.TrimSpace(childThreadID),
		State:             "finalized",
		SnapshotJSON:      string(payload),
		SnapshotHash:      child.SnapshotHash,
		RegistryHash:      child.RegistryHash,
		SchemaHash:        child.SchemaHash,
		PresentationHash:  child.PresentationHash,
		CreatedAtUnixMs:   now,
		FinalizedAtUnixMs: now,
	})
}
