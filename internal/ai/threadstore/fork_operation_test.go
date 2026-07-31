package threadstore

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func prepareForkSource(t *testing.T, store *Store, threadID string) {
	t.Helper()
	if err := store.CreateThreadSettings(context.Background(), ThreadSettings{
		ThreadID: threadID, EndpointID: "env", NamespacePublicID: "ns",
		ModelID: "openai/gpt-5", ReasoningSelectionJSON: `{"effort":"high"}`,
		PermissionType: "approval_required", WorkingDir: "/workspace",
		CreatedByUserPublicID: "user_1", CreatedByUserEmail: "user@example.com",
		UpdatedByUserPublicID: "user_1", UpdatedByUserEmail: "user@example.com",
		SettingsCreatedAtUnixMs: 1, SettingsUpdatedAtUnixMs: 1,
	}); err != nil {
		t.Fatal(err)
	}
}

func forkRequest(source, clientRequestID, title string) ForkThreadRequest {
	return ForkThreadRequest{
		ClientRequestID: clientRequestID, EndpointID: "env", SourceThreadID: source, Title: title,
		CreatedByUserPublicID: "user_1", CreatedByUserEmail: "user@example.com", CreatedAtUnixMs: 2,
	}
}

func TestForkOperationBindsCanonicalDestinationAndCompletes(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	prepareForkSource(t, store, "source")
	if err := store.UpsertFlowerThreadRouting(ctx, FlowerThreadRouting{
		EndpointID: "env", ThreadID: "source", HomeRuntimeID: "runtime_1",
		HomeRuntimeKind: "local_environment", PrimaryTargetID: "target_primary",
		ActiveTargetIDsJSON: `["target_primary"]`, UpdatedAtUnixMs: 1,
	}); err != nil {
		t.Fatal(err)
	}

	prepared, err := store.PrepareForkOperation(ctx, forkRequest("source", "fork_client_1", "Forked"))
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Stage != ForkStagePrepared || prepared.DestinationThreadID != "" || prepared.LogicalRequestID == "" || prepared.TitleLogicalRequestID == "" {
		t.Fatalf("unexpected prepared operation: %#v", prepared)
	}
	for _, forbidden := range []string{"flower_metadata", "owner_kind", "parent_thread_id", "context_json", "action_json"} {
		if strings.Contains(prepared.SnapshotJSON, forbidden) {
			t.Fatalf("fork snapshot retained Agent shadow field %q: %s", forbidden, prepared.SnapshotJSON)
		}
	}

	bound, err := store.BindForkCanonicalDestination(ctx, prepared.OperationID, "destination")
	if err != nil {
		t.Fatal(err)
	}
	if bound.Stage != ForkStageFloretForked || bound.DestinationThreadID != "destination" {
		t.Fatalf("unexpected bound operation: %#v", bound)
	}
	replayedBind, err := store.BindForkCanonicalDestination(ctx, prepared.OperationID, "destination")
	if err != nil || replayedBind.DestinationThreadID != "destination" {
		t.Fatalf("replayed bind=%#v err=%v", replayedBind, err)
	}
	if _, err := store.BindForkCanonicalDestination(ctx, prepared.OperationID, "different"); !errors.Is(err, ErrForkDestinationConflict) {
		t.Fatalf("conflicting bind error=%v", err)
	}

	forked, err := store.MaterializeForkProduct(ctx, prepared.OperationID, 3)
	if err != nil {
		t.Fatal(err)
	}
	if forked.ThreadID != "destination" || forked.ModelID != "openai/gpt-5" || forked.PermissionType != "approval_required" {
		t.Fatalf("unexpected forked metadata: %#v", forked)
	}
	materialized, err := store.GetForkOperation(ctx, prepared.OperationID)
	if err != nil || materialized.Stage != ForkStageProductMaterialized {
		t.Fatalf("materialized operation=%#v err=%v", materialized, err)
	}
	routing, err := store.GetFlowerThreadRouting(ctx, "env", "destination")
	if err != nil || routing == nil || routing.HomeRuntimeID != "runtime_1" || routing.PrimaryTargetID != "target_primary" {
		t.Fatalf("unexpected forked routing: %#v err=%v", routing, err)
	}
	if _, err := store.ConfirmForkTitleApplied(ctx, prepared.OperationID, 4); err != nil {
		t.Fatal(err)
	}
	completed, err := store.CompleteForkOperation(ctx, prepared.OperationID, 5)
	if err != nil || completed.Stage != ForkStageCompleted {
		t.Fatalf("completed operation=%#v err=%v", completed, err)
	}
	replayed, err := store.MaterializeForkProduct(ctx, prepared.OperationID, 6)
	if err != nil || replayed.ThreadID != forked.ThreadID || replayed.SettingsCreatedAtUnixMs != forked.SettingsCreatedAtUnixMs {
		t.Fatalf("materialize replay=%#v err=%v", replayed, err)
	}
}

func TestForkOperationSkipsEmptyTitle(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	prepareForkSource(t, store, "source_no_title")
	op, err := store.PrepareForkOperation(ctx, forkRequest("source_no_title", "fork_client_no_title", ""))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.BindForkCanonicalDestination(ctx, op.OperationID, "destination_no_title"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.MaterializeForkProduct(ctx, op.OperationID, 3); err != nil {
		t.Fatal(err)
	}
	materialized, err := store.GetForkOperation(ctx, op.OperationID)
	if err != nil || materialized.Stage != ForkStageTitleSkipped {
		t.Fatalf("operation=%#v err=%v", materialized, err)
	}
	completed, err := store.CompleteForkOperation(ctx, op.OperationID, 4)
	if err != nil || completed.Stage != ForkStageCompleted {
		t.Fatalf("completed=%#v err=%v", completed, err)
	}
}

func TestForkOperationRejectsRequestAndCanonicalDestinationConflicts(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	prepareForkSource(t, store, "source_conflict")
	request := forkRequest("source_conflict", "fork_client_conflict", "Fork")
	first, err := store.PrepareForkOperation(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := store.PrepareForkOperation(ctx, request)
	if err != nil || replay.RequestFingerprint != first.RequestFingerprint || replay.SnapshotJSON != first.SnapshotJSON {
		t.Fatalf("prepare replay=%#v err=%v", replay, err)
	}
	changed := request
	changed.Title = "Different"
	if _, err := store.PrepareForkOperation(ctx, changed); !errors.Is(err, ErrForkOperationConflict) {
		t.Fatalf("request conflict error=%v", err)
	}
	prepareForkSource(t, store, "source_conflict_2")
	second, err := store.PrepareForkOperation(ctx, forkRequest("source_conflict_2", "fork_client_conflict_2", "Fork 2"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.BindForkCanonicalDestination(ctx, first.OperationID, "destination_claimed"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.BindForkCanonicalDestination(ctx, second.OperationID, "destination_claimed"); !errors.Is(err, ErrForkDestinationConflict) {
		t.Fatalf("destination conflict error=%v", err)
	}
}

func TestThreadDeleteIntentWaitsForActiveForkCoordinator(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	prepareForkSource(t, store, "source_pending_fork")
	operation, err := store.PrepareForkOperation(ctx, forkRequest("source_pending_fork", "fork_client_delete", ""))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.PrepareThreadDeleteOperation(ctx, "env", "source_pending_fork", false); !errors.Is(err, ErrThreadOperationInProgress) {
		t.Fatalf("PrepareThreadDeleteOperation error=%v, want %v", err, ErrThreadOperationInProgress)
	}
	if err := store.RecordForkOperationFailure(ctx, operation.OperationID, "test_terminal", "terminal", true, 20); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PrepareThreadDeleteOperation(ctx, "env", "source_pending_fork", false); err != nil {
		t.Fatalf("PrepareThreadDeleteOperation after terminal fork: %v", err)
	}
}

func TestPendingCanonicalRootOwnershipClaimsRequireFloretBinding(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	prepareForkSource(t, store, "source_claim")
	fork, err := store.PrepareForkOperation(ctx, forkRequest("source_claim", "fork_client_claim", ""))
	if err != nil {
		t.Fatal(err)
	}
	create, err := store.PrepareThreadCreateOperation(ctx, PrepareThreadCreateRequest{
		ClientRequestID: "create_client_claim", Settings: ThreadSettings{EndpointID: "env", PermissionType: "approval_required"}, CreatedAtMS: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	claims, err := store.ListPendingCanonicalRootOwnershipClaims(ctx)
	if err != nil || len(claims) != 0 {
		t.Fatalf("unbound claims=%v err=%v", claims, err)
	}
	if _, err := store.BindForkCanonicalDestination(ctx, fork.OperationID, "fork_claim"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.BindThreadCreateCanonicalID(ctx, create.OperationID, "create_claim"); err != nil {
		t.Fatal(err)
	}
	claims, err = store.ListPendingCanonicalRootOwnershipClaims(ctx)
	if err != nil || strings.Join(claims, ",") != "create_claim,fork_claim" {
		t.Fatalf("bound claims=%v err=%v", claims, err)
	}
}

func TestForkOperationRejectsDamagedSnapshot(t *testing.T) {
	for _, testCase := range []struct {
		name      string
		updateSQL string
		want      string
	}{
		{name: "empty", updateSQL: `UPDATE ai_thread_fork_operations SET snapshot_json = '' WHERE operation_id = ?`, want: "snapshot is invalid"},
		{name: "unknown field", updateSQL: `UPDATE ai_thread_fork_operations SET snapshot_json = json_set(snapshot_json, '$.unknown', 1) WHERE operation_id = ?`, want: "unknown field"},
		{name: "identity mismatch", updateSQL: `UPDATE ai_thread_fork_operations SET snapshot_json = replace(snapshot_json, 'source_damage', 'source_other') WHERE operation_id = ?`, want: "identity mismatch"},
		{name: "snapshot fingerprint mismatch", updateSQL: `UPDATE ai_thread_fork_operations SET snapshot_json = json_set(snapshot_json, '$.source_thread.model_id', 'tampered-model') WHERE operation_id = ?`, want: "snapshot fingerprint mismatch"},
		{name: "request fingerprint mismatch", updateSQL: `UPDATE ai_thread_fork_operations SET request_fingerprint = 'damaged' WHERE operation_id = ?`, want: "request fingerprint mismatch"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			store := openStoreForTest(t)
			ctx := context.Background()
			prepareForkSource(t, store, "source_damage")
			operation, err := store.PrepareForkOperation(ctx, forkRequest("source_damage", "fork_client_damage", "Fork damage"))
			if err != nil {
				t.Fatal(err)
			}
			if _, err := store.db.ExecContext(ctx, testCase.updateSQL, operation.OperationID); err != nil {
				t.Fatal(err)
			}
			if _, err := store.GetForkOperation(ctx, operation.OperationID); err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("GetForkOperation error=%v, want %q", err, testCase.want)
			}
		})
	}
}
