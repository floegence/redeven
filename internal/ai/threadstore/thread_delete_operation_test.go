package threadstore

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/ai/permissionsnapshot"
)

func TestStorePrepareThreadDeleteOperationPersistsReplaySnapshotAndRetiresThreadID(t *testing.T) {
	t.Parallel()

	store, err := Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	const endpointID = "env_delete_operation"
	const threadID = "thread_delete_operation"
	if err := store.CreateThreadSettings(ctx, ThreadSettings{ThreadID: threadID, EndpointID: endpointID, PermissionType: "approval_required"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := store.InsertUpload(ctx, UploadRecord{
		UploadID:       "upload_delete_operation",
		EndpointID:     endpointID,
		StorageRelPath: "upload_delete_operation.data",
		Name:           "attachment.txt",
		MimeType:       "text/plain",
		SizeBytes:      4,
	}); err != nil {
		t.Fatalf("InsertUpload: %v", err)
	}
	if err := store.BindUploadsToRef(ctx, endpointID, threadID, UploadRefKindThread, threadID, []string{"upload_delete_operation"}, 1000); err != nil {
		t.Fatalf("BindUploadsToRef: %v", err)
	}

	operation, err := store.PrepareThreadDeleteOperation(ctx, endpointID, threadID, true)
	if err != nil {
		t.Fatalf("PrepareThreadDeleteOperation: %v", err)
	}
	if operation.OperationID == "" || operation.Status != ThreadDeleteOperationPending {
		t.Fatalf("operation=%+v", operation)
	}
	if operation.ProductDataDeletedAtUnixMs != 0 {
		t.Fatalf("product data was deleted before canonical Floret deletion: %d", operation.ProductDataDeletedAtUnixMs)
	}
	if operation.Snapshot.SchemaVersion != ThreadDeleteSnapshotSchemaV1 || !operation.Snapshot.DeleteFlowerReadState {
		t.Fatalf("snapshot=%+v", operation.Snapshot)
	}
	if len(operation.Snapshot.UploadCleanupIDs) != 1 || operation.Snapshot.UploadCleanupIDs[0] != "upload_delete_operation" {
		t.Fatalf("upload ids=%v", operation.Snapshot.UploadCleanupIDs)
	}
	thread, err := store.GetThreadSettings(ctx, endpointID, threadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if thread == nil {
		t.Fatal("thread settings were deleted while only the delete intent was persisted")
	}
	upload, err := store.GetUpload(ctx, endpointID, "upload_delete_operation")
	if err != nil {
		t.Fatalf("GetUpload: %v", err)
	}
	if upload == nil || upload.State != UploadStateLive {
		t.Fatalf("upload=%+v, want live before canonical deletion", upload)
	}
	operation, err = store.ConfirmThreadDeleteFloretDeleted(ctx, operation.OperationID)
	if err != nil {
		t.Fatalf("ConfirmThreadDeleteFloretDeleted: %v", err)
	}
	operation, err = store.CommitThreadDeleteProductData(ctx, operation.OperationID)
	if err != nil || operation.ProductDataDeletedAtUnixMs <= 0 {
		t.Fatalf("CommitThreadDeleteProductData operation=%+v err=%v", operation, err)
	}

	repeated, err := store.PrepareThreadDeleteOperation(ctx, endpointID, threadID, true)
	if err != nil {
		t.Fatalf("PrepareThreadDeleteOperation repeated: %v", err)
	}
	if repeated.OperationID != operation.OperationID || repeated.CreatedAtUnixMs != operation.CreatedAtUnixMs {
		t.Fatalf("repeated=%+v, want stable operation %+v", repeated, operation)
	}
	if err := store.CreateThreadSettings(ctx, ThreadSettings{ThreadID: threadID, EndpointID: endpointID, PermissionType: "approval_required"}); !errors.Is(err, ErrThreadIDRetired) {
		t.Fatalf("CreateThread reused err=%v, want %v", err, ErrThreadIDRetired)
	}
}

func TestStoreThreadDeleteIntentFreezesThreadScopedWrites(t *testing.T) {
	t.Parallel()

	store, err := Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = store.Close() }()
	ctx := context.Background()
	const endpointID = "env_write_freeze"
	const threadID = "thread_write_freeze"
	const destinationID = "thread_write_freeze_destination"
	for _, id := range []string{threadID, destinationID} {
		if err := store.CreateThreadSettings(ctx, ThreadSettings{
			ThreadID: id, EndpointID: endpointID, ModelID: "openai/gpt-5",
			ReasoningSelectionJSON: `{"level":"low"}`, PermissionType: "approval_required", WorkingDir: "/workspace",
		}); err != nil {
			t.Fatalf("CreateThreadSettings(%s): %v", id, err)
		}
	}
	if err := store.InsertUpload(ctx, UploadRecord{
		UploadID: "upload_write_freeze", EndpointID: endpointID, StorageRelPath: "upload_write_freeze.data",
		Name: "queued.txt", MimeType: "text/plain", SizeBytes: 6, State: UploadStateStaged,
	}); err != nil {
		t.Fatalf("InsertUpload: %v", err)
	}
	queued, _, revision, err := store.CreateFollowupWithUploadRefs(ctx, QueuedTurn{
		QueueID: "queue_write_freeze", EndpointID: endpointID, ThreadID: threadID, ChannelID: "channel_write_freeze",
		Lane: FollowupLaneQueued, TurnID: "turn_write_freeze", RunID: "run_write_freeze", TextContent: "queued",
	}, []string{"upload_write_freeze"}, 100)
	if err != nil {
		t.Fatalf("CreateFollowupWithUploadRefs: %v", err)
	}
	if err := store.UpsertFlowerThreadRouting(ctx, FlowerThreadRouting{
		EndpointID: endpointID, ThreadID: threadID, PrimaryTargetID: "target_before_delete",
	}); err != nil {
		t.Fatalf("UpsertFlowerThreadRouting: %v", err)
	}
	beforeChildJSON, beforeChildHash, beforeChildRegistry, beforeChildSchema, beforeChildPresentation := permissionSnapshotPayloadForTest(t, "child_snapshot_before_delete", permissionsnapshot.PermissionApprovalRequired)
	if err := store.InsertChildPermissionSnapshotProvisional(ctx, ChildPermissionSnapshotRecord{
		ChildSnapshotID: "child_snapshot_before_delete", EndpointID: endpointID, ParentSnapshotID: "parent_snapshot_before_delete",
		SpawnToolCallID: "spawn_before_delete", ParentThreadID: threadID, ParentRunID: "parent_run_before_delete",
		ChildThreadID: destinationID, ChildRunID: "child_run_before_delete", SnapshotJSON: beforeChildJSON,
		SnapshotHash: beforeChildHash, RegistryHash: beforeChildRegistry, SchemaHash: beforeChildSchema, PresentationHash: beforeChildPresentation, CreatedAtUnixMs: 90,
	}); err != nil {
		t.Fatalf("InsertChildPermissionSnapshotProvisional: %v", err)
	}
	if _, err := store.PrepareThreadDeleteOperation(ctx, endpointID, threadID, false); err != nil {
		t.Fatalf("PrepareThreadDeleteOperation: %v", err)
	}

	permissionJSON, permissionHash, permissionRegistry, permissionSchema, permissionPresentation := permissionSnapshotPayloadForTest(t, "permission_snapshot_after_delete", permissionsnapshot.PermissionApprovalRequired)
	childJSON, childHash, childRegistry, childSchema, childPresentation := permissionSnapshotPayloadForTest(t, "child_snapshot_after_delete", permissionsnapshot.PermissionApprovalRequired)
	checks := []struct {
		name string
		run  func() error
	}{
		{name: "writable precheck", run: func() error { return store.RequireThreadSettingsWritable(ctx, endpointID, threadID) }},
		{name: "model", run: func() error { return store.UpdateThreadModelID(ctx, endpointID, threadID, "openai/gpt-5-mini") }},
		{name: "model and reasoning", run: func() error {
			return store.UpdateThreadModelAndReasoningSelection(ctx, endpointID, threadID, "openai/gpt-5-mini", `{"level":"medium"}`)
		}},
		{name: "reasoning", run: func() error {
			return store.UpdateThreadReasoningSelection(ctx, endpointID, threadID, `{"level":"medium"}`)
		}},
		{name: "permission", run: func() error { return store.UpdateThreadPermissionType(ctx, endpointID, threadID, "full_access") }},
		{name: "pin", run: func() error {
			_, err := store.SetThreadPinned(ctx, endpointID, threadID, true, "user", "user@example.com")
			return err
		}},
		{name: "create queue item", run: func() error {
			_, _, _, err := store.CreateFollowup(ctx, QueuedTurn{
				QueueID: "queue_after_delete", EndpointID: endpointID, ThreadID: threadID, ChannelID: "channel_write_freeze",
				Lane: FollowupLaneQueued, TurnID: "turn_after_delete", RunID: "run_after_delete", TextContent: "blocked",
			})
			return err
		}},
		{name: "update queue item", run: func() error {
			_, err := store.UpdateFollowupText(ctx, endpointID, threadID, queued.QueueID, "changed")
			return err
		}},
		{name: "delete queue item", run: func() error {
			_, err := store.DeleteFollowup(ctx, endpointID, threadID, queued.QueueID)
			return err
		}},
		{name: "reorder queue", run: func() error {
			_, err := store.ReorderFollowups(ctx, endpointID, threadID, FollowupLaneQueued, []string{queued.QueueID}, revision)
			return err
		}},
		{name: "recover queue", run: func() error {
			_, _, err := store.RecoverQueuedTurnsToDrafts(ctx, endpointID, threadID)
			return err
		}},
		{name: "legacy update queue", run: func() error {
			return store.UpdateQueuedTurn(ctx, endpointID, threadID, queued.QueueID, "changed")
		}},
		{name: "legacy delete queue", run: func() error {
			return store.DeleteQueuedTurn(ctx, endpointID, threadID, queued.QueueID)
		}},
		{name: "legacy delete all queue", run: func() error { return store.DeleteQueuedTurns(ctx, endpointID, threadID) }},
		{name: "legacy pop queue", run: func() error {
			_, err := store.PopNextQueuedTurn(ctx, endpointID, threadID)
			return err
		}},
		{name: "upload ownership", run: func() error {
			return store.BindUploadsToRef(ctx, endpointID, threadID, UploadRefKindThread, threadID, []string{"upload_write_freeze"}, 200)
		}},
		{name: "admission", run: func() error {
			return store.CommitPendingTurnAdmission(ctx, endpointID, threadID, queued.QueueID, queued.TurnID, nil, 200)
		}},
		{name: "queue resource delete", run: func() error {
			_, err := store.DeleteFollowupResources(ctx, endpointID, threadID, queued.QueueID)
			return err
		}},
		{name: "fork", run: func() error {
			_, err := store.PrepareForkOperation(ctx, ForkThreadRequest{
				OperationID: "fork_after_delete", EndpointID: endpointID, SourceThreadID: threadID,
				DestinationThreadID: "fork_destination_after_delete", CreatedAtUnixMs: 300,
			})
			return err
		}},
		{name: "flower routing", run: func() error {
			return store.UpsertFlowerThreadRouting(ctx, FlowerThreadRouting{
				EndpointID: endpointID, ThreadID: threadID, PrimaryTargetID: "target_after_delete",
			})
		}},
		{name: "permission snapshot", run: func() error {
			return store.InsertPermissionSnapshot(ctx, PermissionSnapshotRecord{
				SnapshotID: "permission_snapshot_after_delete", EndpointID: endpointID, OwnerThreadID: threadID,
				OwnerRunID: "run_after_delete", PermissionType: "approval_required", SnapshotJSON: permissionJSON,
				SnapshotHash: permissionHash, RegistryHash: permissionRegistry, SchemaHash: permissionSchema, PresentationHash: permissionPresentation, CreatedAtUnixMs: 400,
			})
		}},
		{name: "child permission snapshot", run: func() error {
			return store.InsertChildPermissionSnapshot(ctx, ChildPermissionSnapshotRecord{
				ChildSnapshotID: "child_snapshot_after_delete", EndpointID: endpointID, ParentSnapshotID: "parent_snapshot_after_delete",
				SpawnToolCallID: "spawn_after_delete", ParentThreadID: threadID, ParentRunID: "parent_run_after_delete",
				ChildThreadID: destinationID, ChildRunID: "child_run_after_delete", State: "finalized",
				SnapshotJSON: childJSON, SnapshotHash: childHash, RegistryHash: childRegistry, SchemaHash: childSchema,
				PresentationHash: childPresentation, CreatedAtUnixMs: 399, FinalizedAtUnixMs: 400,
			})
		}},
		{name: "finalize child permission snapshot", run: func() error {
			_, err := store.FinalizeChildPermissionSnapshot(ctx, endpointID, "child_snapshot_before_delete", destinationID, "child_run_before_delete", 400)
			return err
		}},
	}
	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			if err := check.run(); !errors.Is(err, ErrThreadIDRetired) {
				t.Fatalf("error=%v, want %v", err, ErrThreadIDRetired)
			}
		})
	}

	storedQueue, err := store.GetQueuedTurn(ctx, endpointID, threadID, queued.QueueID)
	if err != nil || storedQueue == nil || storedQueue.TextContent != "queued" {
		t.Fatalf("stored queue=%#v err=%v", storedQueue, err)
	}
	queuedUpload, err := store.GetQueuedTurnOwnedUpload(ctx, endpointID, threadID, queued.QueueID, "upload_write_freeze")
	if err != nil || queuedUpload == nil {
		t.Fatalf("queued upload ownership=%#v err=%v", queuedUpload, err)
	}
	routing, err := store.GetFlowerThreadRouting(ctx, endpointID, threadID)
	if err != nil || routing == nil || routing.PrimaryTargetID != "target_before_delete" {
		t.Fatalf("flower routing=%#v err=%v", routing, err)
	}
}

func TestStoreThreadDeleteOperationStepConfirmationCommitsOnlyAfterRequiredSteps(t *testing.T) {
	t.Parallel()

	store, err := Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = store.Close() }()
	ctx := context.Background()
	if err := store.CreateThreadSettings(ctx, ThreadSettings{ThreadID: "thread_steps", EndpointID: "env_steps", PermissionType: "approval_required"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	operation, err := store.PrepareThreadDeleteOperation(ctx, "env_steps", "thread_steps", true)
	if err != nil {
		t.Fatalf("PrepareThreadDeleteOperation: %v", err)
	}

	operation, err = store.ConfirmThreadDeleteFloretDeleted(ctx, operation.OperationID)
	if err != nil || operation.Status != ThreadDeleteOperationPending || operation.FloretDeletedAtUnixMs <= 0 {
		t.Fatalf("Floret confirmation operation=%+v err=%v", operation, err)
	}
	operation, err = store.CommitThreadDeleteProductData(ctx, operation.OperationID)
	if err != nil || operation.Status != ThreadDeleteOperationPending || operation.ProductDataDeletedAtUnixMs <= 0 {
		t.Fatalf("product confirmation operation=%+v err=%v", operation, err)
	}
	operation, err = store.ConfirmThreadDeleteReadStateDeleted(ctx, operation.OperationID)
	if err != nil {
		t.Fatalf("ConfirmThreadDeleteReadStateDeleted: %v", err)
	}
	if operation.Status != ThreadDeleteOperationPending {
		t.Fatalf("operation committed before physical files were cleaned: %+v", operation)
	}
	operation, err = store.ConfirmThreadDeleteFilesCleaned(ctx, operation.OperationID)
	if err != nil || operation.Status != ThreadDeleteOperationCommitted || operation.CommittedAtUnixMs <= 0 {
		t.Fatalf("committed operation=%+v", operation)
	}

	pending, err := store.ListPendingThreadDeleteOperations(ctx, 10)
	if err != nil {
		t.Fatalf("ListPendingThreadDeleteOperations: %v", err)
	}
	if len(pending) != 0 {
		t.Fatalf("pending=%+v, want none", pending)
	}
}

func TestStoreThreadDeleteOperationRejectsUnsupportedSnapshotShape(t *testing.T) {
	for _, snapshot := range []string{
		`{"schema_version":1,"upload_cleanup_ids":[],"delete_flower_read_state":false,"unknown":true}`,
		`{"schema_version":1,"upload_cleanup_ids":[],"delete_flower_read_state":false} {}`,
	} {
		store := openStoreForTest(t)
		ctx := context.Background()
		if err := store.CreateThreadSettings(ctx, ThreadSettings{ThreadID: "thread_delete_shape", EndpointID: "env_delete_shape", PermissionType: "approval_required"}); err != nil {
			t.Fatal(err)
		}
		operation, err := store.PrepareThreadDeleteOperation(ctx, "env_delete_shape", "thread_delete_shape", false)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.db.ExecContext(ctx, `UPDATE ai_thread_delete_operations SET snapshot_json = ? WHERE operation_id = ?`, snapshot, operation.OperationID); err != nil {
			t.Fatal(err)
		}
		loaded, err := store.GetThreadDeleteOperation(ctx, "env_delete_shape", "thread_delete_shape")
		if err != nil {
			t.Fatal(err)
		}
		if loaded == nil || loaded.SnapshotValid || !strings.Contains(loaded.SnapshotErrorCode, "invalid_snapshot_json") {
			t.Fatalf("loaded operation=%#v, want invalid snapshot", loaded)
		}
	}
}

func TestStoreThreadDeleteOperationRejectsTamperedCleanupSnapshot(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	if err := store.CreateThreadSettings(ctx, ThreadSettings{ThreadID: "thread_delete_tamper", EndpointID: "env_delete_tamper", PermissionType: "approval_required"}); err != nil {
		t.Fatal(err)
	}
	operation, err := store.PrepareThreadDeleteOperation(ctx, "env_delete_tamper", "thread_delete_tamper", false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE ai_thread_delete_operations SET snapshot_json = json_set(snapshot_json, '$.upload_cleanup_ids', json_array('upload_injected')) WHERE operation_id = ?`, operation.OperationID); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.GetThreadDeleteOperation(ctx, "env_delete_tamper", "thread_delete_tamper")
	if err != nil {
		t.Fatal(err)
	}
	if loaded == nil || loaded.SnapshotValid || loaded.SnapshotErrorCode != "snapshot_fingerprint_mismatch" {
		t.Fatalf("loaded operation=%#v, want fingerprint rejection", loaded)
	}
}
