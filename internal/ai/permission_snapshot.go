package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/ai/permissionsnapshot"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

type toolAuthorizationSnapshotContextKey struct{}

func contextWithToolAuthorizationSnapshot(ctx context.Context, snapshot PermissionSnapshot) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, toolAuthorizationSnapshotContextKey{}, snapshot)
}

func toolAuthorizationSnapshotFromContext(ctx context.Context) (PermissionSnapshot, bool) {
	if ctx == nil {
		return PermissionSnapshot{}, false
	}
	snapshot, ok := ctx.Value(toolAuthorizationSnapshotContextKey{}).(PermissionSnapshot)
	return snapshot, ok && permissionSnapshotActive(snapshot)
}

func (r *run) loadFloretPermissionSnapshot(ctx context.Context, hostContext map[string]string, ownerThreadID string, ownerRunID string) (PermissionSnapshot, error) {
	if r == nil || r.product.permissionSnapshot == nil {
		return PermissionSnapshot{}, errors.New("permission snapshot store is unavailable")
	}
	snapshotID := strings.TrimSpace(hostContext[floretToolHostContextPermissionSnapshotIDKey])
	epoch := strings.TrimSpace(hostContext[floretToolHostContextPermissionEpochKey])
	ownerThreadID = strings.TrimSpace(ownerThreadID)
	ownerRunID = strings.TrimSpace(ownerRunID)
	if snapshotID == "" || epoch == "" || ownerThreadID == "" || ownerRunID == "" {
		return PermissionSnapshot{}, errors.New("Floret permission snapshot identity is incomplete")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	var rec threadstore.PermissionSnapshotRecord
	var ok bool
	var err error
	if ownerThreadID == strings.TrimSpace(r.threadID) && ownerRunID == strings.TrimSpace(r.id) {
		rec, ok, err = r.product.loadPermissionSnapshot(ctx, snapshotID)
	} else {
		rec, ok, err = r.product.loadChildPermissionSnapshot(ctx, snapshotID, ownerThreadID, ownerRunID)
	}
	if err != nil {
		return PermissionSnapshot{}, err
	}
	if !ok {
		return PermissionSnapshot{}, errors.New("Floret permission snapshot is missing")
	}
	if strings.TrimSpace(rec.OwnerThreadID) != ownerThreadID || strings.TrimSpace(rec.OwnerRunID) != ownerRunID {
		return PermissionSnapshot{}, errors.New("Floret permission snapshot owner mismatch")
	}
	snapshot, err := decodePermissionSnapshot(rec.SnapshotJSON)
	if err != nil {
		return PermissionSnapshot{}, err
	}
	if strings.TrimSpace(snapshot.SnapshotID) != snapshotID || strings.TrimSpace(rec.SnapshotID) != snapshotID {
		return PermissionSnapshot{}, errors.New("Floret permission snapshot id mismatch")
	}
	if permissionTypeString(snapshot.PermissionType) != strings.TrimSpace(rec.PermissionType) {
		return PermissionSnapshot{}, errors.New("Floret permission snapshot type mismatch")
	}
	if strings.TrimSpace(snapshot.SnapshotHash) != strings.TrimSpace(rec.SnapshotHash) {
		return PermissionSnapshot{}, errors.New("Floret permission snapshot hash mismatch")
	}
	if err := validateStoredPermissionSnapshotHashes("Floret", rec.RegistryHash, rec.SchemaHash, rec.PresentationHash, snapshot); err != nil {
		return PermissionSnapshot{}, err
	}
	if permissionSurfaceEpoch(snapshot) != epoch {
		return PermissionSnapshot{}, errors.New("Floret permission snapshot epoch mismatch")
	}
	return snapshot, nil
}

func marshalPermissionSnapshot(snapshot PermissionSnapshot) ([]byte, error) {
	if snapshot.Version != permissionSnapshotVersionCurrent {
		return nil, fmt.Errorf("unsupported permission snapshot version %d", snapshot.Version)
	}
	return json.Marshal(snapshot)
}

func decodePermissionSnapshot(raw string) (PermissionSnapshot, error) {
	return permissionsnapshot.Decode(raw)
}

func (r *run) freezePermissionSnapshot(snapshot PermissionSnapshot) (PermissionSnapshot, error) {
	snapshot, err := r.preparePermissionSnapshot(snapshot)
	if err != nil {
		return PermissionSnapshot{}, err
	}
	if err := r.commitPermissionSnapshot(snapshot); err != nil {
		return PermissionSnapshot{}, err
	}
	return snapshot, nil
}

func (r *run) preparePermissionSnapshot(snapshot PermissionSnapshot) (PermissionSnapshot, error) {
	if r == nil {
		return PermissionSnapshot{}, errors.New("missing permission snapshot owner")
	}
	snapshot = permissionSnapshotWithOwnerIdentity(snapshot, r.endpointID, r.threadID, r.id)
	if !permissionSnapshotActive(snapshot) || strings.TrimSpace(snapshot.SnapshotHash) == "" {
		return PermissionSnapshot{}, errors.New("permission snapshot is empty")
	}
	r.setPermissionState(snapshot.PermissionType, snapshot)
	return snapshot, nil
}

func (r *run) commitPermissionSnapshot(snapshot PermissionSnapshot) error {
	if r == nil {
		return errors.New("missing permission snapshot owner")
	}
	if !permissionSnapshotActive(snapshot) || strings.TrimSpace(snapshot.SnapshotHash) == "" {
		return errors.New("permission snapshot is empty")
	}
	if err := r.persistPermissionSnapshot(snapshot); err != nil {
		return err
	}
	r.setPermissionState(snapshot.PermissionType, snapshot)
	return nil
}

func (r *run) setPermissionType(permissionType FlowerPermissionType) {
	if r == nil {
		return
	}
	r.muPermission.Lock()
	r.permissionType = permissionType
	r.muPermission.Unlock()
}

func (r *run) setPermissionState(permissionType FlowerPermissionType, snapshot PermissionSnapshot) {
	if r == nil {
		return
	}
	r.muPermission.Lock()
	r.permissionType = permissionType
	r.permissionSnapshot = snapshot
	r.muPermission.Unlock()
}

func (r *run) currentPermissionType() FlowerPermissionType {
	permissionType, _ := r.currentPermissionState()
	return permissionType
}

func (r *run) currentPermissionSnapshot() PermissionSnapshot {
	_, snapshot := r.currentPermissionState()
	return snapshot
}

func (r *run) currentPermissionState() (FlowerPermissionType, PermissionSnapshot) {
	if r == nil {
		return "", PermissionSnapshot{}
	}
	r.muPermission.RLock()
	defer r.muPermission.RUnlock()
	return r.permissionType, r.permissionSnapshot
}

func persistContextForRun(r *run) (context.Context, context.CancelFunc) {
	persistTO := defaultPersistOpTimeout
	if r != nil && r.persistOpTimeout > 0 {
		persistTO = r.persistOpTimeout
	}
	return context.WithTimeout(context.Background(), persistTO)
}

func (r *run) persistPermissionSnapshot(snapshot PermissionSnapshot) error {
	if r == nil || r.product.insertPermissionSnapshot == nil {
		return errors.New("permission snapshot store is unavailable")
	}
	if strings.TrimSpace(snapshot.SnapshotID) == "" {
		return errors.New("permission snapshot id is missing")
	}
	payload, err := marshalPermissionSnapshot(snapshot)
	if err != nil {
		return err
	}
	ctx, cancel := persistContextForRun(r)
	defer cancel()
	if err := r.product.persistPermissionSnapshot(ctx, threadstore.PermissionSnapshotRecord{
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
	}); err != nil {
		return fmt.Errorf("persist permission snapshot: %w", err)
	}
	return nil
}

func (r *run) childPermissionSnapshotRecord(childThreadID string, childRunID string, spawnToolCallID string, state string, parentSnapshot PermissionSnapshot, child PermissionSnapshot) (threadstore.ChildPermissionSnapshotRecord, error) {
	if r == nil || strings.TrimSpace(parentSnapshot.SnapshotID) == "" || strings.TrimSpace(child.SnapshotID) == "" {
		return threadstore.ChildPermissionSnapshotRecord{}, errors.New("missing child permission snapshot persistence context")
	}
	childThreadID = strings.TrimSpace(childThreadID)
	childRunID = strings.TrimSpace(childRunID)
	spawnToolCallID = strings.TrimSpace(spawnToolCallID)
	state = strings.TrimSpace(state)
	parentRunID := strings.TrimSpace(r.id)
	if childThreadID == "" || childRunID == "" || childRunID == childThreadID || (parentRunID != "" && childRunID == parentRunID) {
		return threadstore.ChildPermissionSnapshotRecord{}, errors.New("invalid child permission snapshot owner identity")
	}
	if spawnToolCallID == "" || spawnToolCallID == childThreadID || spawnToolCallID == childRunID {
		return threadstore.ChildPermissionSnapshotRecord{}, errors.New("invalid child permission snapshot spawn identity")
	}
	if state != "provisional" && state != "finalized" {
		return threadstore.ChildPermissionSnapshotRecord{}, errors.New("invalid child permission snapshot state")
	}
	payload, err := marshalPermissionSnapshot(child)
	if err != nil {
		return threadstore.ChildPermissionSnapshotRecord{}, err
	}
	now := time.Now().UnixMilli()
	rec := threadstore.ChildPermissionSnapshotRecord{
		ChildSnapshotID:  child.SnapshotID,
		EndpointID:       strings.TrimSpace(r.endpointID),
		ParentSnapshotID: parentSnapshot.SnapshotID,
		SpawnToolCallID:  spawnToolCallID,
		ParentThreadID:   strings.TrimSpace(r.threadID),
		ParentRunID:      strings.TrimSpace(r.id),
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
	}
	return rec, nil
}
