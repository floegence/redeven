package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

func seedStaleAdmissionDraftForServiceTest(
	t *testing.T,
	svc *Service,
	owner UploadOwner,
	scopeID, turnID, targetThreadID string,
) threadstore.ComposerDraftRecord {
	t.Helper()
	now := time.Now().Add(-time.Minute).UnixMilli()
	lease, err := svc.threadsDB.AcquireComposerDraftLease(t.Context(), owner.EndpointID, owner.OwnerUserHash, scopeID, "surface_recovery", false, now-1)
	if err != nil {
		t.Fatal(err)
	}
	value := map[string]any{
		"text":              "recover this admission",
		"attachments":       []any{},
		"mode":              threadstore.ComposerDraftModeAdmissionInFlight,
		"admission_started": true,
		"proposed_turn_id":  turnID,
	}
	if targetThreadID != "" {
		value["target_thread_id"] = targetThreadID
	}
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	draft, err := svc.threadsDB.MutateComposerDraft(t.Context(), threadstore.ComposerDraftMutation{
		EndpointID: owner.EndpointID, OwnerUserHash: owner.OwnerUserHash, ScopeID: scopeID,
		HolderID: "surface_recovery", LeaseID: lease.Draft.LeaseID, ExpectedRevision: lease.Draft.Revision,
		Value: raw, NowUnixMs: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	return draft
}

func composerDraftOwnerForServiceTest(t *testing.T) (*Service, UploadOwner) {
	t.Helper()
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	owner, err := NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
	if err != nil {
		t.Fatal(err)
	}
	return svc, owner
}

func TestPrepareComposerDraftThreadReplaysBoundTargetAndDurableCreate(t *testing.T) {
	svc, owner := composerDraftOwnerForServiceTest(t)
	meta := testSendTurnMeta()
	const scopeID = "__new_thread__"
	const turnID = "turn_prepare_draft_thread"
	draft := seedStaleAdmissionDraftForServiceTest(t, svc, owner, scopeID, turnID, "")
	targetThreadID, err := NewThreadID()
	if err != nil {
		t.Fatal(err)
	}
	bound, err := svc.threadsDB.BindComposerDraftTargetThread(t.Context(), owner.EndpointID, owner.OwnerUserHash, scopeID, draft.Revision, turnID, targetThreadID, time.Now().UnixMilli())
	if err != nil {
		t.Fatal(err)
	}

	request := ComposerDraftThreadRequest{
		ExpectedDraftRevision: draft.Revision,
		TurnID:                turnID,
		Create:                CreateThreadRequest{Title: "Recovered draft thread"},
	}
	prepared, err := svc.PrepareComposerDraftThread(t.Context(), meta, owner, scopeID, request)
	if err != nil {
		t.Fatal(err)
	}
	if prepared.ThreadID != targetThreadID || prepared.DraftRevision != bound.Revision {
		t.Fatalf("prepared=%#v, bound=%#v", prepared, bound)
	}
	settings, err := svc.threadsDB.GetThreadSettings(t.Context(), owner.EndpointID, targetThreadID)
	if err != nil || settings == nil {
		t.Fatalf("durable thread settings=%#v err=%v", settings, err)
	}
	replayed, err := svc.PrepareComposerDraftThread(t.Context(), meta, owner, scopeID, request)
	if err != nil {
		t.Fatal(err)
	}
	if replayed != prepared {
		t.Fatalf("replayed=%#v, want %#v", replayed, prepared)
	}
}

func TestPrepareComposerDraftThreadRejectsAttachmentAdmissionBeforeBindingOrCreate(t *testing.T) {
	svc, owner := composerDraftOwnerForServiceTest(t)
	meta := testSendTurnMeta()
	const (
		scopeID  = "__new_thread__"
		turnID   = "turn_prepare_invalid_attachment"
		uploadID = "upl_aaaaaaaaaaaaaaaaaaaaaaaa"
	)
	capability := svc.AttachmentCapabilities(t.Context(), "openai/gpt-5-mini")
	if attachmentRouteForTest(t, capability, "text/plain; charset=utf-8") == "unsupported" {
		t.Fatal("test model must accept UTF-8 text attachments")
	}
	if err := svc.threadsDB.InsertUpload(t.Context(), threadstore.UploadRecord{
		UploadID: uploadID, EndpointID: owner.EndpointID,
		OwnerScopeKind: threadstore.UploadOwnerScopeUser, OwnerUserHash: owner.OwnerUserHash,
		StorageRelPath: "draft-admission.txt", Name: "draft admission.txt",
		DetectedMediaType: "text/plain; charset=utf-8", SizeBytes: 5,
		ContentSHA256: strings.Repeat("a", 64), Source: threadstore.UploadSourceFile,
		State: threadstore.UploadStateStaged, CreatedAtUnixMs: time.Now().UnixMilli(),
	}); err != nil {
		t.Fatal(err)
	}
	if err := svc.threadsDB.BindUserUploadsToDraft(
		t.Context(), owner.EndpointID, owner.OwnerUserHash, scopeID, []string{uploadID}, time.Now().UnixMilli(),
	); err != nil {
		t.Fatal(err)
	}
	lease, err := svc.threadsDB.AcquireComposerDraftLease(
		t.Context(), owner.EndpointID, owner.OwnerUserHash, scopeID, "surface_invalid_attachment", false, time.Now().UnixMilli(),
	)
	if err != nil {
		t.Fatal(err)
	}
	value, err := json.Marshal(map[string]any{
		"text":                "send attachment",
		"model_id":            "openai/gpt-5-mini",
		"mode":                threadstore.ComposerDraftModeAdmissionInFlight,
		"admission_started":   true,
		"proposed_turn_id":    turnID,
		"capability_revision": strings.Repeat("f", 64),
		"attachments": []any{map[string]any{
			"local_id": "local_invalid_attachment", "source": "file",
			"staged": map[string]any{"attachment_id": uploadID},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	draft, err := svc.threadsDB.MutateComposerDraft(t.Context(), threadstore.ComposerDraftMutation{
		EndpointID: owner.EndpointID, OwnerUserHash: owner.OwnerUserHash, ScopeID: scopeID,
		HolderID: "surface_invalid_attachment", LeaseID: lease.Draft.LeaseID,
		ExpectedRevision: lease.Draft.Revision, Value: value, NowUnixMs: time.Now().UnixMilli(),
	})
	if err != nil {
		t.Fatal(err)
	}

	_, err = svc.PrepareComposerDraftThread(t.Context(), meta, owner, scopeID, ComposerDraftThreadRequest{
		ExpectedDraftRevision: draft.Revision,
		TurnID:                turnID,
		Create:                CreateThreadRequest{Title: "Must not be created"},
	})
	if err == nil || !strings.Contains(err.Error(), "attachment capability changed") {
		t.Fatalf("PrepareComposerDraftThread error=%v, want attachment capability rejection", err)
	}
	after, err := svc.threadsDB.GetComposerDraft(t.Context(), owner.EndpointID, owner.OwnerUserHash, scopeID, time.Now().UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision != draft.Revision || string(after.Value) != string(draft.Value) || strings.Contains(string(after.Value), `"target_thread_id"`) {
		t.Fatalf("rejected admission mutated draft: before=%#v after=%#v", draft, after)
	}
	settings, _, hasMore, err := svc.threadsDB.ListThreadSettingsForRecoveryPage(t.Context(), threadstore.ThreadSettingsRecoveryCursor{}, 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(settings) != 0 || hasMore {
		t.Fatalf("rejected admission created thread settings: %#v", settings)
	}
	operations, err := svc.threadsDB.ListPendingThreadCreateOperations(t.Context(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(operations) != 0 {
		t.Fatalf("rejected admission reached Floret thread creation: %#v", operations)
	}
}

func TestStaleComposerDraftAdmissionReconcilesExactPendingTurn(t *testing.T) {
	svc, owner := composerDraftOwnerForServiceTest(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Pending recovery", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	const turnID = "turn_pending_recovery"
	if _, _, _, err := svc.threadsDB.CreateFollowup(t.Context(), threadstore.QueuedTurn{
		QueueID: "queue_pending_recovery", EndpointID: owner.EndpointID, ThreadID: thread.ThreadID,
		ChannelID: owner.ChannelID, Lane: threadstore.FollowupLaneQueued, TurnID: turnID, RunID: "run_pending_recovery",
	}); err != nil {
		t.Fatal(err)
	}
	seedStaleAdmissionDraftForServiceTest(t, svc, owner, thread.ThreadID, turnID, "")

	if err := svc.reconcileStaleComposerDraftAdmission(t.Context(), svc.threadsDB, owner, thread.ThreadID); err != nil {
		t.Fatal(err)
	}
	got, err := svc.threadsDB.GetComposerDraft(t.Context(), owner.EndpointID, owner.OwnerUserHash, thread.ThreadID, time.Now().UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	if got.Revision != 0 || strings.Contains(string(got.Value), turnID) {
		t.Fatalf("accepted pending admission retained draft=%#v", got)
	}
}

func TestStaleComposerDraftAdmissionReconcilesExactCanonicalTurn(t *testing.T) {
	svc, owner := composerDraftOwnerForServiceTest(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Canonical recovery", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	const turnID = "turn_canonical_recovery"
	seedStaleAdmissionDraftForServiceTest(t, svc, owner, thread.ThreadID, turnID, "")
	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "accepted")
	if _, err := host.RunTurn(t.Context(), flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: flruntime.TurnID(turnID),
		RunID: "run_canonical_recovery", Input: flruntime.TurnInput{Text: "accepted"},
	}); err != nil {
		t.Fatal(err)
	}

	if err := svc.reconcileStaleComposerDraftAdmission(t.Context(), svc.threadsDB, owner, thread.ThreadID); err != nil {
		t.Fatal(err)
	}
	got, err := svc.threadsDB.GetComposerDraft(t.Context(), owner.EndpointID, owner.OwnerUserHash, thread.ThreadID, time.Now().UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	if got.Revision != 0 || strings.Contains(string(got.Value), turnID) {
		t.Fatalf("accepted canonical admission retained draft=%#v", got)
	}
}

func TestStaleComposerDraftAdmissionResetsAfterExactCanonicalMiss(t *testing.T) {
	svc, owner := composerDraftOwnerForServiceTest(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Rejected recovery", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	const turnID = "turn_missing_recovery"
	seeded := seedStaleAdmissionDraftForServiceTest(t, svc, owner, thread.ThreadID, turnID, "")
	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "other")
	if _, err := host.RunTurn(t.Context(), flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_other_recovery",
		RunID: "run_other_recovery", Input: flruntime.TurnInput{Text: "other"},
	}); err != nil {
		t.Fatal(err)
	}

	if err := svc.reconcileStaleComposerDraftAdmission(t.Context(), svc.threadsDB, owner, thread.ThreadID); err != nil {
		t.Fatal(err)
	}
	got, err := svc.threadsDB.GetComposerDraft(t.Context(), owner.EndpointID, owner.OwnerUserHash, thread.ThreadID, time.Now().UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	if got.Revision != seeded.Revision+1 || strings.Contains(string(got.Value), `"admission_started":true`) || strings.Contains(string(got.Value), turnID) {
		t.Fatalf("rejected admission was not reset=%#v", got)
	}
}

func TestStaleComposerDraftAdmissionKeepsDraftWhenCanonicalReadIsUncertain(t *testing.T) {
	svc, owner := composerDraftOwnerForServiceTest(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Uncertain recovery", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	const turnID = "turn_uncertain_recovery"
	seeded := seedStaleAdmissionDraftForServiceTest(t, svc, owner, thread.ThreadID, turnID, "")
	uncertain := errors.New("canonical store temporarily unavailable")
	svc.floretReads = &floretReadCapabilities{thread: func(context.Context, flruntime.ThreadID) (floretThreadReadHost, error) {
		return nil, uncertain
	}}

	err = svc.reconcileStaleComposerDraftAdmission(t.Context(), svc.threadsDB, owner, thread.ThreadID)
	if !errors.Is(err, uncertain) {
		t.Fatalf("reconcile error=%v, want %v", err, uncertain)
	}
	got, readErr := svc.threadsDB.GetComposerDraft(t.Context(), owner.EndpointID, owner.OwnerUserHash, thread.ThreadID, time.Now().UnixMilli())
	if readErr != nil {
		t.Fatal(readErr)
	}
	if got.Revision != seeded.Revision || string(got.Value) != string(seeded.Value) {
		t.Fatalf("uncertain reconciliation changed draft=%#v, want %#v", got, seeded)
	}
}

func TestBackgroundComposerAdmissionRecoveryContinuesPastUncertainDraft(t *testing.T) {
	svc, owner := composerDraftOwnerForServiceTest(t)
	meta := testSendTurnMeta()
	uncertainThread, err := svc.CreateThread(t.Context(), meta, "Uncertain background recovery", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	pendingThread, err := svc.CreateThread(t.Context(), meta, "Pending background recovery", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	const uncertainTurnID = "turn_background_uncertain"
	const pendingTurnID = "turn_background_pending"
	uncertainDraft := seedStaleAdmissionDraftForServiceTest(t, svc, owner, uncertainThread.ThreadID, uncertainTurnID, "")
	seedStaleAdmissionDraftForServiceTest(t, svc, owner, pendingThread.ThreadID, pendingTurnID, "")
	if _, _, _, err := svc.threadsDB.CreateFollowup(t.Context(), threadstore.QueuedTurn{
		QueueID: "queue_background_pending", EndpointID: owner.EndpointID, ThreadID: pendingThread.ThreadID,
		ChannelID: owner.ChannelID, Lane: threadstore.FollowupLaneQueued, TurnID: pendingTurnID, RunID: "run_background_pending",
	}); err != nil {
		t.Fatal(err)
	}
	uncertain := errors.New("canonical store temporarily unavailable")
	svc.floretReads = &floretReadCapabilities{thread: func(context.Context, flruntime.ThreadID) (floretThreadReadHost, error) {
		return nil, uncertain
	}}

	reconciled, err := svc.reconcileStaleComposerDraftAdmissions(t.Context(), svc.threadsDB, 50)
	if reconciled != 1 || !errors.Is(err, uncertain) {
		t.Fatalf("background reconcile count=%d err=%v", reconciled, err)
	}
	pending, err := svc.threadsDB.GetComposerDraft(t.Context(), owner.EndpointID, owner.OwnerUserHash, pendingThread.ThreadID, time.Now().UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	if pending.Revision != 0 || strings.Contains(string(pending.Value), pendingTurnID) {
		t.Fatalf("accepted pending draft remains=%#v", pending)
	}
	retained, err := svc.threadsDB.GetComposerDraft(t.Context(), owner.EndpointID, owner.OwnerUserHash, uncertainThread.ThreadID, time.Now().UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	if retained.Revision != uncertainDraft.Revision || string(retained.Value) != string(uncertainDraft.Value) {
		t.Fatalf("uncertain draft changed=%#v, want %#v", retained, uncertainDraft)
	}
}

func TestBackgroundComposerAdmissionRecoveryScansPastFullUncertainBatch(t *testing.T) {
	svc, owner := composerDraftOwnerForServiceTest(t)
	const batchSize = 50
	const acceptedScopeID = "thread_background_recovery_050"
	const acceptedTurnID = "turn_background_recovery_050"
	for index := 0; index <= batchSize; index++ {
		scopeID := fmt.Sprintf("thread_background_recovery_%03d", index)
		turnID := fmt.Sprintf("turn_background_recovery_%03d", index)
		if err := svc.threadsDB.CreateThreadSettings(t.Context(), threadstore.ThreadSettings{
			EndpointID: owner.EndpointID, ThreadID: scopeID, PermissionType: "approval_required",
		}); err != nil {
			t.Fatal(err)
		}
		seedStaleAdmissionDraftForServiceTest(t, svc, owner, scopeID, turnID, "")
	}
	if _, _, _, err := svc.threadsDB.CreateFollowup(t.Context(), threadstore.QueuedTurn{
		QueueID: "queue_background_recovery_050", EndpointID: owner.EndpointID, ThreadID: acceptedScopeID,
		ChannelID: owner.ChannelID, Lane: threadstore.FollowupLaneQueued,
		TurnID: acceptedTurnID, RunID: "run_background_recovery_050",
	}); err != nil {
		t.Fatal(err)
	}
	uncertain := errors.New("canonical store remains unavailable")
	svc.floretReads = &floretReadCapabilities{thread: func(context.Context, flruntime.ThreadID) (floretThreadReadHost, error) {
		return nil, uncertain
	}}

	reconciled, err := svc.reconcileStaleComposerDraftAdmissions(t.Context(), svc.threadsDB, batchSize)
	if reconciled != 1 || !errors.Is(err, uncertain) {
		t.Fatalf("background reconcile count=%d err=%v", reconciled, err)
	}
	accepted, err := svc.threadsDB.GetComposerDraft(t.Context(), owner.EndpointID, owner.OwnerUserHash, acceptedScopeID, time.Now().UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	if accepted.Revision != 0 || strings.Contains(string(accepted.Value), acceptedTurnID) {
		t.Fatalf("candidate after uncertain first batch was not reconciled: %#v", accepted)
	}
	for index := 0; index < batchSize; index++ {
		scopeID := fmt.Sprintf("thread_background_recovery_%03d", index)
		retained, err := svc.threadsDB.GetComposerDraft(t.Context(), owner.EndpointID, owner.OwnerUserHash, scopeID, time.Now().UnixMilli())
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(retained.Value), fmt.Sprintf("turn_background_recovery_%03d", index)) {
			t.Fatalf("uncertain draft %q was changed: %#v", scopeID, retained)
		}
	}
}
