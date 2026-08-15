package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
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

func (r *run) loadFloretPermissionSnapshot(_ context.Context, hostContext map[string]string, ownerThreadID string, ownerRunID string) (PermissionSnapshot, error) {
	if r == nil {
		return PermissionSnapshot{}, errors.New("permission snapshot owner is unavailable")
	}
	snapshotID := strings.TrimSpace(hostContext[floretToolHostContextPermissionSnapshotIDKey])
	epoch := strings.TrimSpace(hostContext[floretToolHostContextPermissionEpochKey])
	ownerThreadID = strings.TrimSpace(ownerThreadID)
	ownerRunID = strings.TrimSpace(ownerRunID)
	if snapshotID == "" || epoch == "" || ownerThreadID == "" || ownerRunID == "" {
		return PermissionSnapshot{}, errors.New("Floret permission snapshot identity is incomplete")
	}
	snapshot := r.currentPermissionSnapshot()
	if strings.TrimSpace(snapshot.SnapshotID) != snapshotID {
		return PermissionSnapshot{}, errors.New("Floret permission snapshot id mismatch")
	}
	if permissionSurfaceEpoch(snapshot) != epoch {
		return PermissionSnapshot{}, errors.New("Floret permission snapshot epoch mismatch")
	}
	if strings.TrimSpace(r.threadID) != ownerThreadID {
		return PermissionSnapshot{}, errors.New("Floret permission snapshot owner mismatch")
	}
	return snapshot, nil
}

func (r *run) freezePermissionSnapshot(snapshot PermissionSnapshot) (PermissionSnapshot, error) {
	snapshot, err := r.preparePermissionSnapshot(snapshot)
	if err != nil {
		return PermissionSnapshot{}, err
	}
	r.setPermissionState(snapshot.PermissionType, snapshot)
	return snapshot, nil
}

func (r *run) preparePermissionSnapshot(snapshot PermissionSnapshot) (PermissionSnapshot, error) {
	if r == nil {
		return PermissionSnapshot{}, errors.New("missing permission snapshot owner")
	}
	ownerRunID, ownerThreadID, _ := r.floretCanonicalIdentity()
	if ownerRunID == "" {
		r.muPendingCommand.Lock()
		logicalRequestID := strings.TrimSpace(r.pendingCommandID)
		r.muPendingCommand.Unlock()
		if logicalRequestID != "" {
			ownerRunID, ownerThreadID = logicalRequestID, r.threadID
		} else {
			ownerRunID, ownerThreadID = r.id, r.threadID
		}
	}
	snapshot = permissionSnapshotWithOwnerIdentity(snapshot, r.endpointID, ownerThreadID, ownerRunID)
	if !permissionSnapshotActive(snapshot) || strings.TrimSpace(snapshot.SnapshotHash) == "" {
		return PermissionSnapshot{}, errors.New("permission snapshot is empty")
	}
	r.setPermissionState(snapshot.PermissionType, snapshot)
	return snapshot, nil
}

func (r *run) ensureCanonicalPermissionSnapshotPersisted(_ context.Context) error {
	if r == nil {
		return errors.New("missing permission snapshot owner")
	}
	ownerRunID, ownerThreadID, _ := r.floretCanonicalIdentity()
	if strings.TrimSpace(ownerRunID) == "" || strings.TrimSpace(ownerThreadID) == "" {
		return errors.New("Floret canonical permission owner is unavailable")
	}
	snapshot := permissionSnapshotWithOwnerIdentity(r.currentPermissionSnapshot(), r.endpointID, ownerThreadID, ownerRunID)
	if err := validatePermissionSnapshotConsistency(snapshot); err != nil {
		return fmt.Errorf("validate canonical permission snapshot: %w", err)
	}
	r.setPermissionState(snapshot.PermissionType, snapshot)
	return nil
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
