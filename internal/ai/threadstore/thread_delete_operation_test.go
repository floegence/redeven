package threadstore

import (
	"context"
	"database/sql"
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
	if err := store.CreateThread(ctx, Thread{ThreadID: threadID, EndpointID: endpointID, Title: "delete me"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if _, err := store.CreateThreadCheckpoint(ctx, endpointID, threadID, "checkpoint_delete_operation", "", CheckpointKindPreRun); err != nil {
		t.Fatalf("CreateThreadCheckpoint: %v", err)
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
	if _, err := store.AppendMessageWithUploadRefs(ctx, endpointID, threadID, Message{
		ThreadID:        threadID,
		EndpointID:      endpointID,
		MessageID:       "message_delete_operation",
		Role:            "user",
		Status:          "complete",
		CreatedAtUnixMs: 1000,
		UpdatedAtUnixMs: 1000,
		TextContent:     "attachment",
		MessageJSON:     `{"id":"message_delete_operation"}`,
	}, "user_1", "user@example.com", []string{"upload_delete_operation"}, 1000); err != nil {
		t.Fatalf("AppendMessageWithUploadRefs: %v", err)
	}

	operation, err := store.PrepareThreadDeleteOperation(ctx, endpointID, threadID, true)
	if err != nil {
		t.Fatalf("PrepareThreadDeleteOperation: %v", err)
	}
	if operation.OperationID == "" || operation.Status != ThreadDeleteOperationPending {
		t.Fatalf("operation=%+v", operation)
	}
	if operation.ProductDataDeletedAtUnixMs <= 0 {
		t.Fatalf("product delete timestamp=%d", operation.ProductDataDeletedAtUnixMs)
	}
	if operation.Snapshot.SchemaVersion != ThreadDeleteSnapshotSchemaV1 || !operation.Snapshot.DeleteFlowerReadState {
		t.Fatalf("snapshot=%+v", operation.Snapshot)
	}
	if len(operation.Snapshot.CheckpointIDs) != 1 || operation.Snapshot.CheckpointIDs[0] != "checkpoint_delete_operation" {
		t.Fatalf("checkpoint ids=%v", operation.Snapshot.CheckpointIDs)
	}
	if len(operation.Snapshot.UploadCleanupIDs) != 1 || operation.Snapshot.UploadCleanupIDs[0] != "upload_delete_operation" {
		t.Fatalf("upload ids=%v", operation.Snapshot.UploadCleanupIDs)
	}
	thread, err := store.GetThread(ctx, endpointID, threadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if thread != nil {
		t.Fatalf("thread=%+v, want deleted", thread)
	}
	upload, err := store.GetUpload(ctx, endpointID, "upload_delete_operation")
	if err != nil {
		t.Fatalf("GetUpload: %v", err)
	}
	if upload == nil || upload.State != UploadStateDeleting {
		t.Fatalf("upload=%+v, want deleting", upload)
	}

	repeated, err := store.PrepareThreadDeleteOperation(ctx, endpointID, threadID, true)
	if err != nil {
		t.Fatalf("PrepareThreadDeleteOperation repeated: %v", err)
	}
	if repeated.OperationID != operation.OperationID || repeated.CreatedAtUnixMs != operation.CreatedAtUnixMs {
		t.Fatalf("repeated=%+v, want stable operation %+v", repeated, operation)
	}
	if err := store.CreateThread(ctx, Thread{ThreadID: threadID, EndpointID: endpointID, Title: "reused"}); !errors.Is(err, ErrThreadIDRetired) {
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
	if err := store.CreateThread(ctx, Thread{ThreadID: "thread_steps", EndpointID: "env_steps", Title: "steps"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	operation, err := store.PrepareThreadDeleteOperation(ctx, "env_steps", "thread_steps", true)
	if err != nil {
		t.Fatalf("PrepareThreadDeleteOperation: %v", err)
	}

	operation, err = store.ConfirmThreadDeleteFilesCleaned(ctx, operation.OperationID)
	if err != nil || operation.Status != ThreadDeleteOperationPending || operation.FilesCleanedAtUnixMs <= 0 {
		t.Fatalf("files confirmation operation=%+v err=%v", operation, err)
	}
	operation, err = store.ConfirmThreadDeleteFloretDeleted(ctx, operation.OperationID)
	if err != nil || operation.Status != ThreadDeleteOperationPending || operation.FloretDeletedAtUnixMs <= 0 {
		t.Fatalf("Floret confirmation operation=%+v err=%v", operation, err)
	}
	operation, err = store.ConfirmThreadDeleteReadStateDeleted(ctx, operation.OperationID)
	if err != nil {
		t.Fatalf("ConfirmThreadDeleteReadStateDeleted: %v", err)
	}
	if operation.Status != ThreadDeleteOperationCommitted || operation.CommittedAtUnixMs <= 0 {
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

func TestStoreMigratesV38ToV39ThreadDeleteOperations(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	schema := threadstoreSchemaSpec()
	tx, err := raw.Begin()
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	for _, migration := range schema.Migrations {
		if migration.ToVersion > 38 {
			break
		}
		if err := migration.Apply(tx); err != nil {
			_ = tx.Rollback()
			t.Fatalf("apply migration %d->%d: %v", migration.FromVersion, migration.ToVersion, err)
		}
	}
	if _, err := tx.Exec(`
INSERT INTO ai_threads(thread_id, endpoint_id, created_at_unix_ms, updated_at_unix_ms)
VALUES('thread_from_v38', 'env_from_v38', 1000, 1000)
`); err != nil {
		_ = tx.Rollback()
		t.Fatalf("insert v38 thread: %v", err)
	}
	if _, err := tx.Exec(`PRAGMA user_version=38;`); err != nil {
		_ = tx.Rollback()
		t.Fatalf("set user_version: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("Close raw: %v", err)
	}

	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open migrated: %v", err)
	}
	defer func() { _ = store.Close() }()
	if !tableExistsForTest(t, store.db, "ai_thread_delete_operations") {
		t.Fatalf("missing ai_thread_delete_operations")
	}
	if !indexExistsForTest(t, store.db, "idx_ai_thread_delete_operations_status_updated") {
		t.Fatalf("missing delete operation status index")
	}
	thread, err := store.GetThread(context.Background(), "env_from_v38", "thread_from_v38")
	if err != nil || thread == nil {
		t.Fatalf("migrated thread=%+v err=%v", thread, err)
	}
	operation, err := store.PrepareThreadDeleteOperation(context.Background(), "env_from_v38", "thread_from_v38", true)
	if err != nil {
		t.Fatalf("PrepareThreadDeleteOperation: %v", err)
	}
	if operation.Status != ThreadDeleteOperationPending {
		t.Fatalf("operation status=%q, want %q", operation.Status, ThreadDeleteOperationPending)
	}
	if err := store.CreateThread(context.Background(), Thread{
		ThreadID:   "thread_from_v38",
		EndpointID: "env_from_v38",
		Title:      "reused",
	}); !errors.Is(err, ErrThreadIDRetired) {
		t.Fatalf("CreateThread reused err=%v, want %v", err, ErrThreadIDRetired)
	}
	var version int
	if err := store.db.QueryRow(`PRAGMA user_version;`).Scan(&version); err != nil {
		t.Fatalf("read user_version: %v", err)
	}
	if version != CurrentSchemaVersion() {
		t.Fatalf("user_version=%d, want %d", version, CurrentSchemaVersion())
	}
}
