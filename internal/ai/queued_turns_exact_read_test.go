package ai

import (
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/ai/threadstore"
)

func TestPendingTurnRecoveryStateRequiresDurableInFlightReceipt(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "durable admission recovery", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	command := createPendingCommandForTest(t, svc, meta, thread.ThreadID, "queue_recovery", "", "")
	if err := validatePendingTurnRecoveryState(t.Context(), meta.EndpointID, thread.ThreadID, svc.threadsDB, true); err != nil {
		t.Fatalf("validate recoverable in-flight receipt: %v", err)
	}
	receipt, err := svc.threadsDB.GetPendingTurnAdmissionReceipt(t.Context(), command.QueueID)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Stage != threadstore.PendingTurnAdmissionStageInFlight || receipt.LogicalRequestID != command.QueueID ||
		receipt.TurnID != "" || receipt.RunID != "" || receipt.EntryID != "" {
		t.Fatalf("unexpected recovery receipt: %#v", receipt)
	}
}

func TestPendingTurnRecoveryStateBlocksLifecycleWhileAdmissionIsInFlight(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "blocked admission lifecycle", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	command := createPendingCommandForTest(t, svc, meta, thread.ThreadID, "queue_blocked", "", "")
	err = validatePendingTurnRecoveryState(t.Context(), meta.EndpointID, thread.ThreadID, svc.threadsDB, false)
	if err == nil || !strings.Contains(err.Error(), command.QueueID) || !strings.Contains(err.Error(), "still in flight") {
		t.Fatalf("validation error=%v, want exact in-flight lifecycle block", err)
	}
}

func TestPendingTurnRecoveryStateAcceptsReadyCommandWithoutCanonicalIdentity(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "ready admission recovery", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := svc.threadsDB.CreateFollowup(t.Context(), threadstore.QueuedTurn{
		QueueID: "queue_ready", EndpointID: meta.EndpointID, ThreadID: thread.ThreadID, ChannelID: meta.ChannelID,
		Lane: threadstore.FollowupLaneQueued, ModelID: "openai/gpt-5-mini", TextContent: "ready prompt",
		AttachmentsJSON: "[]", OptionsJSON: "{}", SessionMetaJSON: "{}",
		CreatedByUserPublicID: meta.UserPublicID, CreatedByUserEmail: meta.UserEmail,
	}); err != nil {
		t.Fatal(err)
	}
	if err := validatePendingTurnRecoveryState(t.Context(), meta.EndpointID, thread.ThreadID, svc.threadsDB, false); err != nil {
		t.Fatalf("validate ready command: %v", err)
	}
}
