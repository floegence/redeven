package threadstore

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
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
	if err := store.CreateThread(ctx, ThreadSettings{ThreadID: threadID, EndpointID: endpointID}); err != nil {
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
	thread, err := store.GetThread(ctx, endpointID, threadID)
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
	if err := store.CreateThread(ctx, ThreadSettings{ThreadID: threadID, EndpointID: endpointID}); !errors.Is(err, ErrThreadIDRetired) {
		t.Fatalf("CreateThread reused err=%v, want %v", err, ErrThreadIDRetired)
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
	if err := store.CreateThread(ctx, ThreadSettings{ThreadID: "thread_steps", EndpointID: "env_steps"}); err != nil {
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
