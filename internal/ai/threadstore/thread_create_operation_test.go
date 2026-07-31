package threadstore

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func createRequestForTest(clientRequestID, endpointID, title string) PrepareThreadCreateRequest {
	return PrepareThreadCreateRequest{
		ClientRequestID: clientRequestID,
		Settings: ThreadSettings{
			EndpointID: endpointID, NamespacePublicID: "ns", ModelID: "openai/gpt-5",
			PermissionType: "approval_required", WorkingDir: "/workspace",
			CreatedByUserPublicID: "user_1", UpdatedByUserPublicID: "user_1",
			SettingsCreatedAtUnixMs: 100, SettingsUpdatedAtUnixMs: 100,
		},
		ExplicitTitle: title, CreatedAtMS: 100,
	}
}

func TestThreadCreateOperationBindsCanonicalIdentityAndAdvancesStages(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	request := createRequestForTest("create_request_1", "env_create", "Canonical title")
	operation, err := store.PrepareThreadCreateOperation(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if operation.Stage != ThreadCreateStagePrepared || operation.CanonicalThreadID != "" || operation.Settings.ThreadID != "" {
		t.Fatalf("prepared operation=%#v", operation)
	}
	if _, err := store.MaterializeThreadCreateProduct(ctx, operation.OperationID); err == nil {
		t.Fatal("materialization succeeded before canonical binding")
	}
	operation, err = store.BindThreadCreateCanonicalID(ctx, operation.OperationID, "th_canonical_create")
	if err != nil || operation.Stage != ThreadCreateStageFloretCreated || operation.CanonicalThreadID != "th_canonical_create" {
		t.Fatalf("bound operation=%#v err=%v", operation, err)
	}
	if _, err := store.BindThreadCreateCanonicalID(ctx, operation.OperationID, "th_other"); !errors.Is(err, ErrThreadCreateConflict) {
		t.Fatalf("conflicting bind error=%v", err)
	}
	settings, err := store.MaterializeThreadCreateProduct(ctx, operation.OperationID)
	if err != nil || settings.ThreadID != "th_canonical_create" {
		t.Fatalf("materialized settings=%#v err=%v", settings, err)
	}
	operation, err = store.ConfirmThreadCreateTitleSet(ctx, operation.OperationID)
	if err != nil || operation.Stage != ThreadCreateStageTitleApplied {
		t.Fatalf("title operation=%#v err=%v", operation, err)
	}
	operation, err = store.CompleteThreadCreateOperation(ctx, operation.OperationID)
	if err != nil || operation.Stage != ThreadCreateStageCompleted {
		t.Fatalf("completed operation=%#v err=%v", operation, err)
	}
	replayed, err := store.MaterializeThreadCreateProduct(ctx, operation.OperationID)
	if err != nil || replayed.ThreadID != settings.ThreadID {
		t.Fatalf("materialization replay=%#v err=%v", replayed, err)
	}
}

func TestThreadCreateOperationReplaysStableClientRequestAndRejectsConflict(t *testing.T) {
	store := openStoreForTest(t)
	request := createRequestForTest("create_request_replay", "env_create", "First")
	first, err := store.PrepareThreadCreateOperation(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := store.PrepareThreadCreateOperation(t.Context(), request)
	if err != nil || replayed.OperationID != first.OperationID || replayed.LogicalRequestID != first.LogicalRequestID {
		t.Fatalf("replayed operation=%#v err=%v", replayed, err)
	}
	request.ExplicitTitle = "Different"
	if _, err := store.PrepareThreadCreateOperation(t.Context(), request); !errors.Is(err, ErrThreadCreateConflict) {
		t.Fatalf("conflicting request error=%v", err)
	}
}

func TestThreadCreateOperationSkipsEmptyTitle(t *testing.T) {
	store := openStoreForTest(t)
	op, err := store.PrepareThreadCreateOperation(t.Context(), createRequestForTest("create_no_title", "env_create", ""))
	if err != nil {
		t.Fatal(err)
	}
	op, err = store.BindThreadCreateCanonicalID(t.Context(), op.OperationID, "th_no_title")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.MaterializeThreadCreateProduct(t.Context(), op.OperationID); err != nil {
		t.Fatal(err)
	}
	op, err = store.GetThreadCreateOperation(t.Context(), op.OperationID)
	if err != nil || op.Stage != ThreadCreateStageTitleSkipped {
		t.Fatalf("operation=%#v err=%v", op, err)
	}
	if _, err := store.CompleteThreadCreateOperation(t.Context(), op.OperationID); err != nil {
		t.Fatal(err)
	}
}

func TestThreadCreateOperationRejectsDamagedSnapshot(t *testing.T) {
	store := openStoreForTest(t)
	op, err := store.PrepareThreadCreateOperation(t.Context(), createRequestForTest("create_damage", "env_damage", "Damage"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(t.Context(), `UPDATE ai_thread_create_operations SET request_fingerprint = 'damaged' WHERE operation_id = ?`, op.OperationID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetThreadCreateOperation(t.Context(), op.OperationID); err == nil || !strings.Contains(err.Error(), "fingerprint mismatch") {
		t.Fatalf("damaged snapshot error=%v", err)
	}
}
