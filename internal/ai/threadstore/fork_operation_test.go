package threadstore

import (
	"context"
	"errors"
	"testing"
)

func TestForkOperationCopiesOnlyProductMetadataAndReplays(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	if err := store.CreateThread(ctx, ThreadSettings{
		ThreadID: "source", EndpointID: "env", NamespacePublicID: "ns",
		ModelID: "openai/gpt-5", ReasoningSelectionJSON: `{"effort":"high"}`,
		PermissionType: "approval_required", WorkingDir: "/workspace", CreatedAtUnixMs: 1, UpdatedAtUnixMs: 1,
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
	forked, err := store.CommitForkOperation(ctx, CommitForkOperationRequest{OperationID: "fork_1", UpdatedAtUnixMs: 3})
	if err != nil {
		t.Fatal(err)
	}
	if forked.ThreadID != "destination" || forked.ModelID != "openai/gpt-5" || forked.PermissionType != "approval_required" {
		t.Fatalf("unexpected forked metadata: %#v", forked)
	}
	replayed, err := store.CommitForkOperation(ctx, CommitForkOperationRequest{OperationID: "fork_1", UpdatedAtUnixMs: 4})
	if err != nil {
		t.Fatal(err)
	}
	if replayed.ThreadID != forked.ThreadID || replayed.CreatedAtUnixMs != forked.CreatedAtUnixMs {
		t.Fatalf("unexpected replay: %#v", replayed)
	}
}

func TestForkOperationRejectsRequestAndDestinationConflicts(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	if err := store.CreateThread(ctx, ThreadSettings{ThreadID: "source", EndpointID: "env", CreatedAtUnixMs: 1, UpdatedAtUnixMs: 1}); err != nil {
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
