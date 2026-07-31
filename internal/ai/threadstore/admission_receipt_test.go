package threadstore

import (
	"context"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/ai/permissionsnapshot"
)

func TestPendingTurnAdmissionBindsReceiptSnapshotAndSettlementAtomically(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	const endpointID = "env_admission"
	const threadID = "thread_admission"
	const queueID = "queue_admission"
	if err := store.CreateThreadSettings(ctx, ThreadSettings{EndpointID: endpointID, ThreadID: threadID, PermissionType: "approval_required"}); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := store.CreateFollowup(ctx, QueuedTurn{
		QueueID: queueID, EndpointID: endpointID, ThreadID: threadID, ChannelID: "channel",
		Lane: FollowupLaneQueued, TextContent: "hello", AttachmentsJSON: "[]", OptionsJSON: "{}", SessionMetaJSON: "{}",
	}); err != nil {
		t.Fatal(err)
	}
	receipt, err := store.BeginPendingTurnAdmission(ctx, endpointID, threadID, queueID, queueID)
	if err != nil || receipt.Stage != PendingTurnAdmissionStageInFlight || receipt.TurnID != "" || receipt.RunID != "" {
		t.Fatalf("begin receipt=%+v err=%v", receipt, err)
	}
	payload, snapshotHash, registryHash, schemaHash, presentationHash := permissionSnapshotPayloadForTest(t, "psnap_admission", permissionsnapshot.PermissionApprovalRequired)
	binding := PendingTurnAdmissionBinding{
		QueueID: queueID, EndpointID: endpointID, ThreadID: threadID, LogicalRequestID: queueID,
		CommandFingerprint: receipt.CommandFingerprint, TurnID: "turn_canonical", RunID: "run_canonical", EntryID: "entry_canonical",
		PermissionSnapshot: PermissionSnapshotRecord{
			SnapshotID: "psnap_admission", EndpointID: endpointID, OwnerThreadID: threadID, OwnerRunID: "run_canonical",
			PermissionType: "approval_required", SnapshotJSON: payload, SnapshotHash: snapshotHash,
			RegistryHash: registryHash, SchemaHash: schemaHash, PresentationHash: presentationHash, CreatedAtUnixMs: 100,
		}, AdmittedAtUnixMs: 200,
	}
	settled, revision, err := store.BindPendingTurnAdmission(ctx, binding)
	if err != nil || settled.Stage != PendingTurnAdmissionStageSettled || settled.TurnID != binding.TurnID || settled.RunID != binding.RunID || settled.EntryID != binding.EntryID || revision != 3 {
		t.Fatalf("settled=%+v revision=%d err=%v", settled, revision, err)
	}
	if _, err := store.GetQueuedTurn(ctx, endpointID, threadID, queueID); err == nil {
		t.Fatal("settled queued row still exists")
	}
	if replay, replayRevision, err := store.BindPendingTurnAdmission(ctx, binding); err != nil || replay != settled || replayRevision != revision {
		t.Fatalf("replay=%+v revision=%d err=%v", replay, replayRevision, err)
	}
	conflict := binding
	conflict.RunID = "run_other"
	conflict.PermissionSnapshot.OwnerRunID = conflict.RunID
	if _, _, err := store.BindPendingTurnAdmission(ctx, conflict); err == nil {
		t.Fatal("conflicting canonical replay was accepted")
	}
}

func TestPendingTurnAdmissionFailureLeavesInFlightStateIntact(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	if err := store.CreateThreadSettings(ctx, ThreadSettings{EndpointID: "env_failure", ThreadID: "thread_failure", PermissionType: "approval_required"}); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := store.CreateFollowup(ctx, QueuedTurn{QueueID: "queue_failure", EndpointID: "env_failure", ThreadID: "thread_failure", ChannelID: "channel", Lane: FollowupLaneQueued}); err != nil {
		t.Fatal(err)
	}
	receipt, err := store.BeginPendingTurnAdmission(ctx, "env_failure", "thread_failure", "queue_failure", "logical_failure")
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = store.BindPendingTurnAdmission(ctx, PendingTurnAdmissionBinding{
		QueueID: receipt.QueueID, EndpointID: receipt.EndpointID, ThreadID: receipt.ThreadID, LogicalRequestID: receipt.LogicalRequestID,
		CommandFingerprint: receipt.CommandFingerprint, TurnID: "turn_failure", RunID: "run_failure", EntryID: "entry_failure",
		PermissionSnapshot: PermissionSnapshotRecord{SnapshotID: "invalid", EndpointID: receipt.EndpointID, OwnerThreadID: receipt.ThreadID, OwnerRunID: "run_failure", SnapshotHash: strings.Repeat("a", 64)},
	})
	if err == nil {
		t.Fatal("invalid permission proof was accepted")
	}
	queued, err := store.GetQueuedTurn(ctx, receipt.EndpointID, receipt.ThreadID, receipt.QueueID)
	if err != nil || queued.AdmissionState != PendingTurnAdmissionInFlight {
		t.Fatalf("queued=%+v err=%v", queued, err)
	}
	stored, err := store.GetPendingTurnAdmissionReceipt(ctx, receipt.QueueID)
	if err != nil || stored.Stage != PendingTurnAdmissionStageInFlight || stored.TurnID != "" || stored.RunID != "" {
		t.Fatalf("stored=%+v err=%v", stored, err)
	}
}
