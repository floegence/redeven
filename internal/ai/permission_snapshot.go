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

func (r *run) insertChildPermissionSnapshot(childThreadID string, childRunID string, spawnToolCallID string, child PermissionSnapshot) error {
	return r.persistChildPermissionSnapshot(childThreadID, childRunID, spawnToolCallID, "finalized", child)
}

func (r *run) insertChildPermissionSnapshotProvisional(childThreadID string, childRunID string, spawnToolCallID string, child PermissionSnapshot) error {
	return r.persistChildPermissionSnapshot(childThreadID, childRunID, spawnToolCallID, "provisional", child)
}

func (r *run) persistChildPermissionSnapshot(childThreadID string, childRunID string, spawnToolCallID string, state string, child PermissionSnapshot) error {
	if r == nil || r.threadsDB == nil || strings.TrimSpace(r.permissionSnapshot.SnapshotID) == "" || strings.TrimSpace(child.SnapshotID) == "" {
		return errors.New("missing child permission snapshot persistence context")
	}
	childThreadID = strings.TrimSpace(childThreadID)
	childRunID = strings.TrimSpace(childRunID)
	spawnToolCallID = strings.TrimSpace(spawnToolCallID)
	state = strings.TrimSpace(state)
	parentRunID := strings.TrimSpace(r.id)
	if childThreadID == "" || childRunID == "" || childRunID == childThreadID || (parentRunID != "" && childRunID == parentRunID) {
		return errors.New("invalid child permission snapshot owner identity")
	}
	if spawnToolCallID == "" || spawnToolCallID == childThreadID || spawnToolCallID == childRunID {
		return errors.New("invalid child permission snapshot spawn identity")
	}
	if state != "provisional" && state != "finalized" {
		return errors.New("invalid child permission snapshot state")
	}
	payload, err := json.Marshal(child)
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	ctx, cancel := persistContextForRun(r)
	defer cancel()
	rec := threadstore.ChildPermissionSnapshotRecord{
		ChildSnapshotID:  child.SnapshotID,
		EndpointID:       strings.TrimSpace(r.endpointID),
		ParentSnapshotID: r.permissionSnapshot.SnapshotID,
		SpawnToolCallID:  spawnToolCallID,
		ParentThreadID:   strings.TrimSpace(r.threadID),
		ParentRunID:      strings.TrimSpace(r.id),
		SubagentID:       childThreadID,
		ChildThreadID:    childThreadID,
		ChildRunID:       childRunID,
		State:            state,
		SnapshotJSON:     string(payload),
		SnapshotHash:     child.SnapshotHash,
		RegistryHash:     child.RegistryHash,
		SchemaHash:       child.SchemaHash,
		PresentationHash: child.PresentationHash,
		CreatedAtUnixMs:  now,
	}
	if state == "finalized" {
		rec.FinalizedAtUnixMs = now
		return r.threadsDB.InsertChildPermissionSnapshot(ctx, rec)
	}
	return r.threadsDB.InsertChildPermissionSnapshotProvisional(ctx, rec)
}

func (r *run) finalizeChildPermissionSnapshot(childThreadID string, childRunID string, childSnapshotID string) error {
	if r == nil || r.threadsDB == nil {
		return errors.New("missing child permission snapshot persistence context")
	}
	childThreadID = strings.TrimSpace(childThreadID)
	childRunID = strings.TrimSpace(childRunID)
	childSnapshotID = strings.TrimSpace(childSnapshotID)
	parentRunID := strings.TrimSpace(r.id)
	if childThreadID == "" || childRunID == "" || childSnapshotID == "" || childRunID == childThreadID || (parentRunID != "" && childRunID == parentRunID) {
		return errors.New("invalid child permission snapshot owner identity")
	}
	ctx, cancel := persistContextForRun(r)
	defer cancel()
	ok, err := r.threadsDB.FinalizeChildPermissionSnapshot(ctx, strings.TrimSpace(r.endpointID), childSnapshotID, childThreadID, childRunID, time.Now().UnixMilli())
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("child permission snapshot was not finalized")
	}
	return nil
}
