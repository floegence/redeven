package threadstore

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestForkOperationCopiesOnlyProductMetadataAndReplays(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	if err := store.CreateThreadSettings(ctx, ThreadSettings{
		ThreadID: "source", EndpointID: "env", NamespacePublicID: "ns",
		ModelID: "openai/gpt-5", ReasoningSelectionJSON: `{"effort":"high"}`,
		PermissionType: "approval_required", WorkingDir: "/workspace", SettingsCreatedAtUnixMs: 1, SettingsUpdatedAtUnixMs: 1,
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertFlowerThreadRouting(ctx, FlowerThreadRouting{
		EndpointID: "env", ThreadID: "source", HomeRuntimeID: "runtime_1",
		HomeRuntimeKind: "local_environment", PrimaryTargetID: "target_primary",
		ActiveTargetIDsJSON: `["target_primary"]`, UpdatedAtUnixMs: 1,
	}); err != nil {
		t.Fatal(err)
	}
	request := ForkThreadRequest{
		OperationID: "fork_1", EndpointID: "env", SourceThreadID: "source", DestinationThreadID: "destination",
		Title: "Forked", CreatedByUserPublicID: "user_1", CreatedByUserEmail: "user@example.com", CreatedAtUnixMs: 2,
	}
	prepared, err := store.PrepareForkOperation(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Status != ForkOperationPending || prepared.SnapshotSchemaVersion != ForkSnapshotSchemaVersion || prepared.SnapshotJSON == "" || prepared.RequestedTitle != "Forked" {
		t.Fatalf("unexpected prepared operation: %#v", prepared)
	}
	for _, forbidden := range []string{"flower_metadata", "owner_kind", "parent_thread_id", "context_json", "action_json"} {
		if strings.Contains(prepared.SnapshotJSON, forbidden) {
			t.Fatalf("fork snapshot retained Agent shadow field %q: %s", forbidden, prepared.SnapshotJSON)
		}
	}
	forked, err := store.CommitForkOperation(ctx, CommitForkOperationRequest{OperationID: "fork_1", UpdatedAtUnixMs: 3})
	if err != nil {
		t.Fatal(err)
	}
	if forked.ThreadID != "destination" || forked.ModelID != "openai/gpt-5" || forked.PermissionType != "approval_required" {
		t.Fatalf("unexpected forked metadata: %#v", forked)
	}
	routing, err := store.GetFlowerThreadRouting(ctx, "env", "destination")
	if err != nil {
		t.Fatal(err)
	}
	if routing == nil || routing.HomeRuntimeID != "runtime_1" || routing.PrimaryTargetID != "target_primary" || routing.UpdatedAtUnixMs != 2 {
		t.Fatalf("unexpected forked routing: %#v", routing)
	}
	replayed, err := store.CommitForkOperation(ctx, CommitForkOperationRequest{OperationID: "fork_1", UpdatedAtUnixMs: 4})
	if err != nil {
		t.Fatal(err)
	}
	if replayed.ThreadID != forked.ThreadID || replayed.SettingsCreatedAtUnixMs != forked.SettingsCreatedAtUnixMs {
		t.Fatalf("unexpected replay: %#v", replayed)
	}
}

func TestForkOperationRejectsRequestAndDestinationConflicts(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	if err := store.CreateThreadSettings(ctx, ThreadSettings{ThreadID: "source", EndpointID: "env", PermissionType: "approval_required", SettingsCreatedAtUnixMs: 1, SettingsUpdatedAtUnixMs: 1}); err != nil {
		t.Fatal(err)
	}
	request := ForkThreadRequest{OperationID: "fork_1", EndpointID: "env", SourceThreadID: "source", DestinationThreadID: "destination", Title: "Fork", CreatedAtUnixMs: 2}
	first, err := store.PrepareForkOperation(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := store.PrepareForkOperation(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if replay.RequestFingerprint != first.RequestFingerprint || replay.SnapshotJSON != first.SnapshotJSON {
		t.Fatalf("idempotent prepare changed snapshot")
	}
	changed := request
	changed.Title = "Different"
	if _, err := store.PrepareForkOperation(ctx, changed); !errors.Is(err, ErrForkOperationConflict) {
		t.Fatalf("request conflict error = %v", err)
	}
	other := request
	other.OperationID = "fork_2"
	if _, err := store.PrepareForkOperation(ctx, other); !errors.Is(err, ErrForkDestinationConflict) {
		t.Fatalf("destination conflict error = %v", err)
	}
}

func TestThreadDeleteIntentWaitsForPendingForkCoordinator(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	if err := store.CreateThreadSettings(ctx, ThreadSettings{
		ThreadID: "source_pending_fork", EndpointID: "env", PermissionType: "approval_required", WorkingDir: "/workspace",
	}); err != nil {
		t.Fatal(err)
	}
	operation, err := store.PrepareForkOperation(ctx, ForkThreadRequest{
		OperationID: "fork_pending_delete", EndpointID: "env", SourceThreadID: "source_pending_fork",
		DestinationThreadID: "destination_pending_fork", CreatedAtUnixMs: 10,
	})
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

func TestPendingForkClaimsDestinationAgainstCreateAndWrites(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	if err := store.CreateThreadSettings(ctx, ThreadSettings{
		ThreadID: "source_destination_claim", EndpointID: "env", PermissionType: "approval_required",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PrepareForkOperation(ctx, ForkThreadRequest{
		OperationID: "fork_destination_claim", EndpointID: "env", SourceThreadID: "source_destination_claim",
		DestinationThreadID: "destination_claimed", CreatedAtUnixMs: 10,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PrepareThreadCreateOperation(ctx, PrepareThreadCreateRequest{
		Settings: ThreadSettings{ThreadID: "destination_claimed", EndpointID: "env", PermissionType: "approval_required"}, CreatedAtMS: 11,
	}); !errors.Is(err, ErrThreadOperationInProgress) {
		t.Fatalf("PrepareThreadCreateOperation error=%v, want %v", err, ErrThreadOperationInProgress)
	}
	if err := store.CreateThreadSettings(ctx, ThreadSettings{ThreadID: "destination_claimed", EndpointID: "env", PermissionType: "approval_required"}); !errors.Is(err, ErrThreadOperationInProgress) {
		t.Fatalf("CreateThreadSettings error=%v, want %v", err, ErrThreadOperationInProgress)
	}
}

func TestPendingCreateClaimsDestinationAgainstFork(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	if err := store.CreateThreadSettings(ctx, ThreadSettings{
		ThreadID: "source_create_claim", EndpointID: "env", PermissionType: "approval_required",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PrepareThreadCreateOperation(ctx, PrepareThreadCreateRequest{
		Settings: ThreadSettings{ThreadID: "destination_create_claim", EndpointID: "env", PermissionType: "approval_required"}, CreatedAtMS: 10,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PrepareForkOperation(ctx, ForkThreadRequest{
		OperationID: "fork_conflicts_with_create", EndpointID: "env", SourceThreadID: "source_create_claim",
		DestinationThreadID: "destination_create_claim", CreatedAtUnixMs: 11,
	}); !errors.Is(err, ErrForkDestinationConflict) {
		t.Fatalf("PrepareForkOperation error=%v, want %v", err, ErrForkDestinationConflict)
	}
}

func TestPendingForkFreezesSourceSettingsAndAdmission(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	if err := store.CreateThreadSettings(ctx, ThreadSettings{
		ThreadID: "source_frozen", EndpointID: "env", ModelID: "model_before",
		PermissionType: "approval_required", WorkingDir: "/workspace",
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.InsertUpload(ctx, UploadRecord{
		UploadID: "upload_frozen", EndpointID: "env", StorageRelPath: "upload_frozen.data",
		Name: "frozen.txt", MimeType: "text/plain", SizeBytes: 6, CreatedAtUnixMs: 1,
	}); err != nil {
		t.Fatal(err)
	}
	command, _, _, err := store.CreateFollowupWithUploadRefs(ctx, QueuedTurn{
		QueueID: "queue_frozen", EndpointID: "env", ThreadID: "source_frozen", ChannelID: "channel",
		Lane: FollowupLaneQueued, TurnID: "turn_frozen", RunID: "run_frozen", TextContent: "queued",
	}, []string{"upload_frozen"}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.PrepareForkOperation(ctx, ForkThreadRequest{
		OperationID: "fork_freeze", EndpointID: "env", SourceThreadID: "source_frozen",
		DestinationThreadID: "destination_frozen", CreatedAtUnixMs: 3,
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateThreadModelID(ctx, "env", "source_frozen", "model_after"); !errors.Is(err, ErrThreadOperationInProgress) {
		t.Fatalf("UpdateThreadModelID error=%v, want %v", err, ErrThreadOperationInProgress)
	}
	if err := store.CommitPendingTurnAdmission(ctx, "env", "source_frozen", command.QueueID, command.TurnID, []string{"upload_frozen"}, 4); !errors.Is(err, ErrThreadOperationInProgress) {
		t.Fatalf("CommitPendingTurnAdmission error=%v, want %v", err, ErrThreadOperationInProgress)
	}
	if count := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_queued_turns WHERE queue_id = ?`, command.QueueID); count != 1 {
		t.Fatalf("queued commands=%d, want 1", count)
	}
	if count := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE upload_id = ? AND ref_kind = ? AND ref_id = ?`, "upload_frozen", UploadRefKindQueuedTurn, command.QueueID); count != 1 {
		t.Fatalf("queued upload refs=%d, want 1", count)
	}
	if count := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE upload_id = ? AND ref_kind = ?`, "upload_frozen", UploadRefKindThread); count != 0 {
		t.Fatalf("thread upload refs=%d, want 0", count)
	}
}

func TestForkOperationRejectsDamagedPendingSnapshot(t *testing.T) {
	for _, testCase := range []struct {
		name      string
		updateSQL string
		want      string
	}{
		{name: "empty", updateSQL: `UPDATE ai_thread_fork_operations SET snapshot_json = '' WHERE operation_id = ?`, want: "snapshot is empty"},
		{name: "unknown field", updateSQL: `UPDATE ai_thread_fork_operations SET snapshot_json = json_set(snapshot_json, '$.unknown', 1) WHERE operation_id = ?`, want: "unknown field"},
		{name: "identity mismatch", updateSQL: `UPDATE ai_thread_fork_operations SET snapshot_json = replace(snapshot_json, 'destination_damage', 'destination_other') WHERE operation_id = ?`, want: "identity mismatch"},
		{name: "source settings fingerprint mismatch", updateSQL: `UPDATE ai_thread_fork_operations SET snapshot_json = json_set(snapshot_json, '$.source_thread.model_id', 'tampered-model') WHERE operation_id = ?`, want: "snapshot fingerprint mismatch"},
		{name: "fingerprint mismatch", updateSQL: `UPDATE ai_thread_fork_operations SET request_fingerprint = 'damaged' WHERE operation_id = ?`, want: "fingerprint mismatch"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			store := openStoreForTest(t)
			ctx := context.Background()
			if err := store.CreateThreadSettings(ctx, ThreadSettings{ThreadID: "source_damage", EndpointID: "env_damage", PermissionType: "approval_required"}); err != nil {
				t.Fatal(err)
			}
			operation, err := store.PrepareForkOperation(ctx, ForkThreadRequest{
				OperationID: "fork_damage", EndpointID: "env_damage", SourceThreadID: "source_damage",
				DestinationThreadID: "destination_damage", Title: "Fork damage", CreatedAtUnixMs: 100,
			})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := store.db.ExecContext(ctx, testCase.updateSQL, operation.OperationID); err != nil {
				t.Fatal(err)
			}
			if _, err := store.GetForkOperation(ctx, operation.OperationID); err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("GetForkOperation error=%v, want %q", err, testCase.want)
			}
			if _, err := store.CommitForkOperation(ctx, CommitForkOperationRequest{OperationID: operation.OperationID, UpdatedAtUnixMs: 200}); err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("CommitForkOperation error=%v, want %q", err, testCase.want)
			}
			if destination, err := store.GetThreadSettings(ctx, "env_damage", "destination_damage"); err != nil || destination != nil {
				t.Fatalf("destination settings=%#v err=%v, want no materialization", destination, err)
			}
		})
	}
}
