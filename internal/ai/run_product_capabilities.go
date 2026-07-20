package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/redeven/internal/ai/threadstore"
)

type runProductCapabilities struct {
	currentSettings          func(context.Context) (*threadstore.ThreadSettings, error)
	requireAuthorityWritable func(context.Context) error
	permissionSnapshot       func(context.Context, string) (threadstore.PermissionSnapshotRecord, bool, error)
	childPermissionSnapshot  func(context.Context, string, string, string) (threadstore.PermissionSnapshotRecord, bool, error)
	insertPermissionSnapshot func(context.Context, threadstore.PermissionSnapshotRecord) error
	finalizedChildSnapshot   func(context.Context, string) (threadstore.ChildPermissionSnapshotRecord, bool, error)
	getThreadOwnedUpload     func(context.Context, string) (*threadstore.UploadRecord, error)
	getQueuedTurnOwnedUpload func(context.Context, string, string) (*threadstore.UploadRecord, error)
	preparePublication       func(context.Context, threadstore.SubAgentPublicationOperation, threadstore.ChildPermissionSnapshotRecord) error
	finalizePublication      func(context.Context, string, string, string, string, int64) (bool, error)
	failPublication          func(context.Context, string, string, string, string, int64) (bool, error)
}

func bindRootRunProductCapabilities(store *threadstore.Store, endpointID string, threadID string, runID string) (runProductCapabilities, error) {
	if store == nil {
		return runProductCapabilities{}, errors.New("run product store is unavailable")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	runID = strings.TrimSpace(runID)
	if endpointID == "" || threadID == "" || runID == "" {
		return runProductCapabilities{}, errors.New("root run product authority identity is incomplete")
	}

	capabilities := runProductCapabilities{
		currentSettings: func(ctx context.Context) (*threadstore.ThreadSettings, error) {
			return store.GetThreadSettings(ctx, endpointID, threadID)
		},
		requireAuthorityWritable: func(ctx context.Context) error {
			return store.RequireThreadSettingsWritable(ctx, endpointID, threadID)
		},
		permissionSnapshot: func(ctx context.Context, snapshotID string) (threadstore.PermissionSnapshotRecord, bool, error) {
			record, ok, err := store.GetPermissionSnapshot(ctx, endpointID, strings.TrimSpace(snapshotID))
			if err != nil || !ok {
				return record, ok, err
			}
			if record.OwnerThreadID != threadID || record.OwnerRunID != runID {
				return threadstore.PermissionSnapshotRecord{}, false, errors.New("permission snapshot is outside the root run authority")
			}
			return record, true, nil
		},
		childPermissionSnapshot: func(ctx context.Context, snapshotID string, childThreadID string, childRunID string) (threadstore.PermissionSnapshotRecord, bool, error) {
			childThreadID = strings.TrimSpace(childThreadID)
			childRunID = strings.TrimSpace(childRunID)
			child, ok, err := store.GetFinalizedChildPermissionSnapshotByThread(ctx, endpointID, childThreadID)
			if err != nil || !ok {
				return threadstore.PermissionSnapshotRecord{}, false, err
			}
			if child.ParentThreadID != threadID || child.ChildThreadID != childThreadID || child.ChildRunID != childRunID {
				return threadstore.PermissionSnapshotRecord{}, false, errors.New("permission snapshot owner is outside the root run authority")
			}
			record, ok, err := store.GetPermissionSnapshot(ctx, endpointID, strings.TrimSpace(snapshotID))
			if err != nil || !ok {
				return record, ok, err
			}
			if record.OwnerThreadID != childThreadID || record.OwnerRunID != childRunID {
				return threadstore.PermissionSnapshotRecord{}, false, errors.New("child permission snapshot owner mismatch")
			}
			return record, true, nil
		},
		insertPermissionSnapshot: func(ctx context.Context, record threadstore.PermissionSnapshotRecord) error {
			if strings.TrimSpace(record.EndpointID) != endpointID || strings.TrimSpace(record.OwnerThreadID) != threadID || strings.TrimSpace(record.OwnerRunID) != runID {
				return errors.New("permission snapshot write authority mismatch")
			}
			return store.InsertPermissionSnapshot(ctx, record)
		},
		finalizedChildSnapshot: func(ctx context.Context, childThreadID string) (threadstore.ChildPermissionSnapshotRecord, bool, error) {
			record, ok, err := store.GetFinalizedChildPermissionSnapshotByThread(ctx, endpointID, strings.TrimSpace(childThreadID))
			if err != nil || !ok {
				return record, ok, err
			}
			if record.ParentThreadID != threadID {
				return threadstore.ChildPermissionSnapshotRecord{}, false, errors.New("child permission audit authority mismatch")
			}
			return record, true, nil
		},
		getThreadOwnedUpload: func(ctx context.Context, uploadID string) (*threadstore.UploadRecord, error) {
			return store.GetThreadOwnedUpload(ctx, endpointID, threadID, strings.TrimSpace(uploadID))
		},
		getQueuedTurnOwnedUpload: func(ctx context.Context, commandID string, uploadID string) (*threadstore.UploadRecord, error) {
			return store.GetQueuedTurnOwnedUpload(ctx, endpointID, threadID, strings.TrimSpace(commandID), strings.TrimSpace(uploadID))
		},
		preparePublication: func(ctx context.Context, operation threadstore.SubAgentPublicationOperation, snapshot threadstore.ChildPermissionSnapshotRecord) error {
			if strings.TrimSpace(operation.EndpointID) != endpointID || strings.TrimSpace(operation.ParentThreadID) != threadID || strings.TrimSpace(operation.ParentRunID) != runID ||
				strings.TrimSpace(snapshot.EndpointID) != endpointID || strings.TrimSpace(snapshot.ParentThreadID) != threadID || strings.TrimSpace(snapshot.ParentRunID) != runID {
				return errors.New("SubAgent publication authority mismatch")
			}
			return store.PrepareSubAgentPublication(ctx, operation, snapshot)
		},
		finalizePublication: func(ctx context.Context, publicationID string, childSnapshotID string, childThreadID string, childRunID string, committedAtUnixMs int64) (bool, error) {
			operation, ok, err := store.GetSubAgentPublication(ctx, strings.TrimSpace(publicationID))
			if err != nil || !ok {
				return false, err
			}
			if operation.EndpointID != endpointID || operation.ParentThreadID != threadID || operation.ParentRunID != runID ||
				operation.ChildSnapshotID != strings.TrimSpace(childSnapshotID) || operation.ChildThreadID != strings.TrimSpace(childThreadID) || operation.ChildRunID != strings.TrimSpace(childRunID) {
				return false, errors.New("SubAgent publication finalization authority mismatch")
			}
			return store.FinalizeSubAgentPublication(ctx, publicationID, childSnapshotID, childThreadID, childRunID, committedAtUnixMs)
		},
		failPublication: func(ctx context.Context, publicationID string, childSnapshotID string, childThreadID string, childRunID string, failedAtUnixMs int64) (bool, error) {
			operation, ok, err := store.GetSubAgentPublication(ctx, strings.TrimSpace(publicationID))
			if err != nil || !ok {
				return false, err
			}
			if operation.EndpointID != endpointID || operation.ParentThreadID != threadID || operation.ParentRunID != runID ||
				operation.ChildSnapshotID != strings.TrimSpace(childSnapshotID) || operation.ChildThreadID != strings.TrimSpace(childThreadID) || operation.ChildRunID != strings.TrimSpace(childRunID) {
				return false, errors.New("SubAgent publication failure authority mismatch")
			}
			return store.FailSubAgentPublication(ctx, publicationID, childSnapshotID, childThreadID, childRunID, failedAtUnixMs)
		},
	}
	return capabilities, nil
}

func bindChildRunProductCapabilities(store *threadstore.Store, endpointID string, parentThreadID string, childThreadID string, childRunID string) (runProductCapabilities, error) {
	if store == nil {
		return runProductCapabilities{}, errors.New("child run product store is unavailable")
	}
	endpointID = strings.TrimSpace(endpointID)
	parentThreadID = strings.TrimSpace(parentThreadID)
	childThreadID = strings.TrimSpace(childThreadID)
	childRunID = strings.TrimSpace(childRunID)
	if endpointID == "" || parentThreadID == "" || childThreadID == "" || childRunID == "" || parentThreadID == childThreadID || childThreadID == childRunID {
		return runProductCapabilities{}, errors.New("child run product authority identity is incomplete")
	}
	return runProductCapabilities{
		currentSettings: func(ctx context.Context) (*threadstore.ThreadSettings, error) {
			return store.GetThreadSettings(ctx, endpointID, parentThreadID)
		},
		requireAuthorityWritable: func(ctx context.Context) error {
			return store.RequireThreadSettingsWritable(ctx, endpointID, parentThreadID)
		},
		permissionSnapshot: func(ctx context.Context, snapshotID string) (threadstore.PermissionSnapshotRecord, bool, error) {
			record, ok, err := store.GetPermissionSnapshot(ctx, endpointID, strings.TrimSpace(snapshotID))
			if err != nil || !ok {
				return record, ok, err
			}
			if record.OwnerThreadID != childThreadID || record.OwnerRunID != childRunID {
				return threadstore.PermissionSnapshotRecord{}, false, errors.New("child permission snapshot owner authority mismatch")
			}
			return record, true, nil
		},
		insertPermissionSnapshot: func(ctx context.Context, record threadstore.PermissionSnapshotRecord) error {
			if strings.TrimSpace(record.EndpointID) != endpointID || strings.TrimSpace(record.OwnerThreadID) != childThreadID || strings.TrimSpace(record.OwnerRunID) != childRunID {
				return errors.New("child permission snapshot write authority mismatch")
			}
			return store.InsertPermissionSnapshot(ctx, record)
		},
		getThreadOwnedUpload: func(ctx context.Context, uploadID string) (*threadstore.UploadRecord, error) {
			return store.GetThreadOwnedUpload(ctx, endpointID, childThreadID, strings.TrimSpace(uploadID))
		},
	}, nil
}

func (c runProductCapabilities) currentThreadSettings(ctx context.Context) (*threadstore.ThreadSettings, error) {
	if c.currentSettings == nil {
		return nil, errors.New("thread settings capability is unavailable")
	}
	return c.currentSettings(ctx)
}

func (c runProductCapabilities) requireThreadAuthorityWritable(ctx context.Context) error {
	if c.requireAuthorityWritable == nil {
		return errors.New("thread write authority is unavailable")
	}
	return c.requireAuthorityWritable(ctx)
}

func (c runProductCapabilities) loadPermissionSnapshot(ctx context.Context, snapshotID string) (threadstore.PermissionSnapshotRecord, bool, error) {
	if c.permissionSnapshot == nil {
		return threadstore.PermissionSnapshotRecord{}, false, errors.New("permission snapshot read capability is unavailable")
	}
	return c.permissionSnapshot(ctx, snapshotID)
}

func (c runProductCapabilities) loadChildPermissionSnapshot(ctx context.Context, snapshotID string, childThreadID string, childRunID string) (threadstore.PermissionSnapshotRecord, bool, error) {
	if c.childPermissionSnapshot == nil {
		return threadstore.PermissionSnapshotRecord{}, false, errors.New("child permission snapshot read capability is unavailable")
	}
	return c.childPermissionSnapshot(ctx, snapshotID, childThreadID, childRunID)
}

func (c runProductCapabilities) persistPermissionSnapshot(ctx context.Context, record threadstore.PermissionSnapshotRecord) error {
	if c.insertPermissionSnapshot == nil {
		return errors.New("permission snapshot write capability is unavailable")
	}
	return c.insertPermissionSnapshot(ctx, record)
}

func (c runProductCapabilities) loadFinalizedChildSnapshot(ctx context.Context, childThreadID string) (threadstore.ChildPermissionSnapshotRecord, bool, error) {
	if c.finalizedChildSnapshot == nil {
		return threadstore.ChildPermissionSnapshotRecord{}, false, errors.New("child permission audit capability is unavailable")
	}
	return c.finalizedChildSnapshot(ctx, childThreadID)
}

func (c runProductCapabilities) loadThreadOwnedUpload(ctx context.Context, uploadID string) (*threadstore.UploadRecord, error) {
	if c.getThreadOwnedUpload == nil {
		return nil, errors.New("thread upload read capability is unavailable")
	}
	return c.getThreadOwnedUpload(ctx, uploadID)
}

func (c runProductCapabilities) loadQueuedTurnOwnedUpload(ctx context.Context, commandID string, uploadID string) (*threadstore.UploadRecord, error) {
	if c.getQueuedTurnOwnedUpload == nil {
		return nil, errors.New("queued upload read capability is unavailable")
	}
	return c.getQueuedTurnOwnedUpload(ctx, commandID, uploadID)
}

func (c runProductCapabilities) prepareSubAgentPublication(ctx context.Context, operation threadstore.SubAgentPublicationOperation, snapshot threadstore.ChildPermissionSnapshotRecord) error {
	if c.preparePublication == nil {
		return errors.New("SubAgent publication capability is unavailable")
	}
	return c.preparePublication(ctx, operation, snapshot)
}

func (c runProductCapabilities) finalizeSubAgentPublication(ctx context.Context, publicationID string, childSnapshotID string, childThreadID string, childRunID string, committedAtUnixMs int64) (bool, error) {
	if c.finalizePublication == nil {
		return false, errors.New("SubAgent publication capability is unavailable")
	}
	return c.finalizePublication(ctx, publicationID, childSnapshotID, childThreadID, childRunID, committedAtUnixMs)
}

func (c runProductCapabilities) failSubAgentPublication(ctx context.Context, publicationID string, childSnapshotID string, childThreadID string, childRunID string, failedAtUnixMs int64) (bool, error) {
	if c.failPublication == nil {
		return false, errors.New("SubAgent publication capability is unavailable")
	}
	return c.failPublication(ctx, publicationID, childSnapshotID, childThreadID, childRunID, failedAtUnixMs)
}
