package threadstore

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func createAdmissionDraftForRecoveryTest(
	t *testing.T,
	store *Store,
	endpointID, ownerHash, scopeID, turnID, holderID string,
	nowUnixMs int64,
	uploadIDs ...string,
) ComposerDraftRecord {
	t.Helper()
	lease, err := store.AcquireComposerDraftLease(t.Context(), endpointID, ownerHash, scopeID, holderID, false, nowUnixMs-1)
	if err != nil {
		t.Fatal(err)
	}
	value := composerDraftValueForTest("recover me", ComposerDraftModeAdmissionInFlight, uploadIDs...)
	var decoded map[string]any
	if err := json.Unmarshal(value, &decoded); err != nil {
		t.Fatal(err)
	}
	decoded["admission_started"] = true
	decoded["proposed_turn_id"] = turnID
	value, err = json.Marshal(decoded)
	if err != nil {
		t.Fatal(err)
	}
	draft, err := store.MutateComposerDraft(t.Context(), ComposerDraftMutation{
		EndpointID: endpointID, OwnerUserHash: ownerHash, ScopeID: scopeID,
		HolderID: holderID, LeaseID: lease.Draft.LeaseID, ExpectedRevision: lease.Draft.Revision,
		Value: value, NowUnixMs: nowUnixMs,
	})
	if err != nil {
		t.Fatal(err)
	}
	return draft
}

func TestBindComposerDraftTargetThreadIsIdempotentForExactAdmission(t *testing.T) {
	store := openStoreForTest(t)
	ctx := t.Context()
	const endpointID = "env_draft_target"
	const scopeID = "__new_thread__"
	const turnID = "turn_draft_target"
	ownerHash := strings.Repeat("e", 64)
	draft := createAdmissionDraftForRecoveryTest(t, store, endpointID, ownerHash, scopeID, turnID, "surface_target", 1_000)

	bound, err := store.BindComposerDraftTargetThread(ctx, endpointID, ownerHash, scopeID, draft.Revision, turnID, "th_first_target", 1_001)
	if err != nil {
		t.Fatal(err)
	}
	if bound.Revision != draft.Revision+1 || !strings.Contains(string(bound.Value), `"target_thread_id":"th_first_target"`) {
		t.Fatalf("bound draft=%#v", bound)
	}
	replayed, err := store.BindComposerDraftTargetThread(ctx, endpointID, ownerHash, scopeID, draft.Revision, turnID, "th_different_target", 1_002)
	if err != nil {
		t.Fatal(err)
	}
	if replayed.Revision != bound.Revision || string(replayed.Value) != string(bound.Value) {
		t.Fatalf("replayed binding=%#v, want original=%#v", replayed, bound)
	}
	if _, err := store.BindComposerDraftTargetThread(ctx, endpointID, ownerHash, scopeID, bound.Revision, "turn_other", "th_other_target", 1_003); err == nil || !strings.Contains(err.Error(), "admission identity changed") {
		t.Fatalf("different TurnID binding error=%v", err)
	}
}

func TestComposerDraftAdmissionReconcileUsesExactPendingTurnID(t *testing.T) {
	store := openStoreForTest(t)
	ctx := t.Context()
	const endpointID = "env_draft_pending"
	const scopeID = "thread_draft_pending"
	const turnID = "turn_draft_pending"
	ownerHash := strings.Repeat("f", 64)
	if err := store.CreateThreadSettings(ctx, ThreadSettings{EndpointID: endpointID, ThreadID: scopeID, PermissionType: "approval_required"}); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := store.CreateFollowup(ctx, QueuedTurn{
		QueueID: "queue_other", EndpointID: endpointID, ThreadID: scopeID, ChannelID: "channel_pending",
		Lane: FollowupLaneQueued, TurnID: "turn_other", RunID: "run_other",
	}); err != nil {
		t.Fatal(err)
	}
	if accepted, err := store.HasPendingTurnID(ctx, endpointID, scopeID, turnID); err != nil || accepted {
		t.Fatalf("different pending TurnID accepted=%v err=%v", accepted, err)
	}
	if _, _, _, err := store.CreateFollowup(ctx, QueuedTurn{
		QueueID: "queue_exact", EndpointID: endpointID, ThreadID: scopeID, ChannelID: "channel_pending",
		Lane: FollowupLaneQueued, TurnID: turnID, RunID: "run_exact",
	}); err != nil {
		t.Fatal(err)
	}
	accepted, err := store.HasPendingTurnID(ctx, endpointID, scopeID, turnID)
	if err != nil || !accepted {
		t.Fatalf("exact pending TurnID accepted=%v err=%v", accepted, err)
	}
	createAdmissionDraftForRecoveryTest(t, store, endpointID, ownerHash, scopeID, turnID, "surface_pending", 1_000)
	result, err := store.ReconcileComposerDraftAdmission(ctx, endpointID, ownerHash, scopeID, turnID, accepted, 2_000)
	if err != nil {
		t.Fatal(err)
	}
	if result.Draft != nil {
		t.Fatalf("accepted admission returned a retained draft: %#v", result.Draft)
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_composer_drafts WHERE endpoint_id = ? AND owner_user_hash = ? AND scope_id = ?`, endpointID, ownerHash, scopeID) != 0 {
		t.Fatal("accepted exact pending TurnID retained the composer draft")
	}
}

func TestComposerDraftAdmissionReconcileResetsOnlyTheExactRejectedAdmission(t *testing.T) {
	store := openStoreForTest(t)
	ctx := t.Context()
	const endpointID = "env_draft_rejected"
	const scopeID = "thread_draft_rejected"
	const turnID = "turn_draft_rejected"
	ownerHash := strings.Repeat("1", 64)
	for _, uploadID := range []string{"upload_original", "upload_generated_long_text"} {
		if err := store.InsertUpload(ctx, composerDraftUploadForTest(endpointID, ownerHash, uploadID)); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.BindUserUploadsToDraft(ctx, endpointID, ownerHash, scopeID, []string{"upload_original", "upload_generated_long_text"}, 1); err != nil {
		t.Fatal(err)
	}
	draft := createAdmissionDraftForRecoveryTest(t, store, endpointID, ownerHash, scopeID, turnID, "surface_rejected", 1_000, "upload_original", "upload_generated_long_text")
	var value map[string]any
	if err := json.Unmarshal(draft.Value, &value); err != nil {
		t.Fatal(err)
	}
	value["prepared_long_text_attachment_id"] = "upload_generated_long_text"
	value["prepared_long_text_local_id"] = "local_upload_generated_long_text"
	preparedValue, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE ai_composer_drafts SET value_json = ? WHERE endpoint_id = ? AND owner_user_hash = ? AND scope_id = ?`, string(preparedValue), endpointID, ownerHash, scopeID); err != nil {
		t.Fatal(err)
	}

	if _, err := store.ReconcileComposerDraftAdmission(ctx, endpointID, ownerHash, scopeID, "turn_other", false, 2_000); !errors.Is(err, ErrComposerDraftRevisionConflict) {
		t.Fatalf("different admission identity error=%v", err)
	}
	result, err := store.ReconcileComposerDraftAdmission(ctx, endpointID, ownerHash, scopeID, turnID, false, 2_001)
	if err != nil {
		t.Fatal(err)
	}
	if result.Draft == nil || result.Draft.Revision != draft.Revision+1 || result.Draft.LeaseID != "" {
		t.Fatalf("reset draft=%#v", result.Draft)
	}
	var resetValue map[string]any
	if err := json.Unmarshal(result.Draft.Value, &resetValue); err != nil {
		t.Fatal(err)
	}
	if resetValue["mode"] != ComposerDraftModeOrdinary || resetValue["admission_started"] != nil || resetValue["proposed_turn_id"] != nil {
		t.Fatalf("reset value=%#v", resetValue)
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = 'upload_original' AND ref_kind = ? AND ref_id = ?`, endpointID, UploadRefKindDraft, composerDraftUploadRefID(ownerHash, scopeID)) != 1 {
		t.Fatal("reset released the original user attachment")
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = 'upload_generated_long_text'`, endpointID) != 0 {
		t.Fatal("reset retained the generated long-text attachment ref")
	}
	generated, err := store.GetUpload(ctx, endpointID, "upload_generated_long_text")
	if err != nil {
		t.Fatal(err)
	}
	if generated.State != UploadStateDeleting {
		t.Fatalf("generated upload state=%q, want deleting", generated.State)
	}
}
