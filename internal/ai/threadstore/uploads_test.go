package threadstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestStore_ThreadDeleteOperationRespectsSharedUploadRefs(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	for _, threadID := range []string{"th_1", "th_2"} {
		if err := s.CreateThreadSettings(ctx, ThreadSettings{ThreadID: threadID, EndpointID: "env_1", PermissionType: "approval_required"}); err != nil {
			t.Fatalf("CreateThread(%s): %v", threadID, err)
		}
	}
	if err := s.InsertUpload(ctx, UploadRecord{
		UploadID:          "upl_shared",
		EndpointID:        "env_1",
		StorageRelPath:    "upl_shared.data",
		Name:              "shared.txt",
		MimeType:          "text/plain",
		SizeBytes:         6,
		State:             UploadStateStaged,
		CreatedAtUnixMs:   100,
		DeleteAfterUnixMs: 200,
	}); err != nil {
		t.Fatalf("InsertUpload: %v", err)
	}

	appendWithUpload := func(threadID string, messageID string) {
		t.Helper()
		if err := s.BindUploadsToRef(ctx, "env_1", threadID, UploadRefKindThread, threadID, []string{"upl_shared"}, 1000); err != nil {
			t.Fatalf("BindUploadsToRef(%s): %v", threadID, err)
		}
	}
	appendWithUpload("th_1", "msg_1")
	appendWithUpload("th_2", "msg_2")

	first, err := s.PrepareThreadDeleteOperation(ctx, "env_1", "th_1", false)
	if err != nil {
		t.Fatalf("PrepareThreadDeleteOperation first: %v", err)
	}
	if _, err := s.ConfirmThreadDeleteFloretDeleted(ctx, first.OperationID); err != nil {
		t.Fatalf("ConfirmThreadDeleteFloretDeleted first: %v", err)
	}
	if _, err := s.CommitThreadDeleteProductData(ctx, first.OperationID); err != nil {
		t.Fatalf("CommitThreadDeleteProductData first: %v", err)
	}
	if refs := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = ?`, "env_1", "upl_shared"); refs != 1 {
		t.Fatalf("remaining refs=%d, want 1", refs)
	}
	shared, err := s.GetUpload(ctx, "env_1", "upl_shared")
	if err != nil || shared == nil || shared.State != UploadStateLive {
		t.Fatalf("shared upload after first delete=%#v err=%v", shared, err)
	}

	second, err := s.PrepareThreadDeleteOperation(ctx, "env_1", "th_2", false)
	if err != nil {
		t.Fatalf("PrepareThreadDeleteOperation second: %v", err)
	}
	if _, err := s.ConfirmThreadDeleteFloretDeleted(ctx, second.OperationID); err != nil {
		t.Fatalf("ConfirmThreadDeleteFloretDeleted second: %v", err)
	}
	if _, err := s.CommitThreadDeleteProductData(ctx, second.OperationID); err != nil {
		t.Fatalf("CommitThreadDeleteProductData second: %v", err)
	}
	shared, err = s.GetUpload(ctx, "env_1", "upl_shared")
	if err != nil || shared == nil || shared.State != UploadStateDeleting {
		t.Fatalf("shared upload after second delete=%#v err=%v", shared, err)
	}
}

func TestStore_ThreadDeleteOperationReleasesSameScopeDraftRefsWithoutDeletingSharedUploads(t *testing.T) {
	t.Parallel()

	store := openStoreForTest(t)
	ctx := t.Context()
	const endpointID = "env_delete_drafts"
	const deletedThreadID = "thread_delete_drafts"
	const retainingThreadID = "thread_retain_shared"
	const otherDraftID = "thread_other_draft"
	ownerHash := strings.Repeat("f", 64)
	for _, threadID := range []string{deletedThreadID, retainingThreadID} {
		if err := store.CreateThreadSettings(ctx, ThreadSettings{ThreadID: threadID, EndpointID: endpointID, PermissionType: "approval_required"}); err != nil {
			t.Fatal(err)
		}
	}

	for _, uploadID := range []string{"upload_draft_only", "upload_draft_pending", "upload_shared_thread", "upload_other_draft"} {
		if err := store.InsertUpload(ctx, composerDraftUploadForTest(endpointID, ownerHash, uploadID)); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.BindUserUploadsToDraft(ctx, endpointID, ownerHash, deletedThreadID, []string{"upload_draft_only", "upload_shared_thread"}, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
	VALUES(?, 'upload_draft_pending', ?, ?, ?, 1)
	`, endpointID, deletedThreadID, UploadRefKindDraftPending, composerDraftUploadRefID(ownerHash, deletedThreadID)); err != nil {
		t.Fatal(err)
	}
	if err := store.BindUserUploadsToDraft(ctx, endpointID, ownerHash, otherDraftID, []string{"upload_other_draft"}, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE ai_uploads SET state = ?, claimed_at_unix_ms = 2 WHERE endpoint_id = ? AND upload_id = 'upload_shared_thread'`, UploadStateLive, endpointID); err != nil {
		t.Fatal(err)
	}
	if err := store.BindUploadsToRef(ctx, endpointID, retainingThreadID, UploadRefKindThread, retainingThreadID, []string{"upload_shared_thread"}, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AcquireComposerDraftLease(ctx, endpointID, ownerHash, deletedThreadID, "surface_deleted", false, 1_000); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AcquireComposerDraftLease(ctx, endpointID, ownerHash, otherDraftID, "surface_other", false, 1_000); err != nil {
		t.Fatal(err)
	}

	operation, err := store.PrepareThreadDeleteOperation(ctx, endpointID, deletedThreadID, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(operation.Snapshot.UploadCleanupIDs) != 3 {
		t.Fatalf("cleanup snapshot=%v, want three same-scope uploads", operation.Snapshot.UploadCleanupIDs)
	}
	if _, err := store.ConfirmThreadDeleteFloretDeleted(ctx, operation.OperationID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CommitThreadDeleteProductData(ctx, operation.OperationID); err != nil {
		t.Fatal(err)
	}

	if count := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_composer_drafts WHERE endpoint_id = ? AND scope_id = ?`, endpointID, deletedThreadID); count != 0 {
		t.Fatalf("deleted-scope composer drafts=%d, want 0", count)
	}
	if count := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND thread_id = ? AND ref_kind IN (?, ?)`, endpointID, deletedThreadID, UploadRefKindDraft, UploadRefKindDraftPending); count != 0 {
		t.Fatalf("deleted-scope draft refs=%d, want 0", count)
	}
	for _, uploadID := range []string{"upload_draft_only", "upload_draft_pending"} {
		record, err := store.GetUpload(ctx, endpointID, uploadID)
		if err != nil || record.State != UploadStateDeleting {
			t.Fatalf("unshared upload %q=%#v err=%v, want deleting", uploadID, record, err)
		}
	}
	shared, err := store.GetUpload(ctx, endpointID, "upload_shared_thread")
	if err != nil || shared.State != UploadStateLive {
		t.Fatalf("shared upload=%#v err=%v, want live", shared, err)
	}
	if count := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = 'upload_shared_thread' AND ref_kind = ? AND ref_id = ?`, endpointID, UploadRefKindThread, retainingThreadID); count != 1 {
		t.Fatalf("retaining thread refs=%d, want 1", count)
	}
	other, err := store.GetUpload(ctx, endpointID, "upload_other_draft")
	if err != nil || other.State != UploadStateStaged {
		t.Fatalf("other-scope draft upload=%#v err=%v, want staged", other, err)
	}
	if count := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_composer_drafts WHERE endpoint_id = ? AND scope_id = ?`, endpointID, otherDraftID); count != 1 {
		t.Fatalf("other-scope composer drafts=%d, want 1", count)
	}
}

func TestStoreThreadDeleteIntentRejectsLateComposerAndUploadClaims(t *testing.T) {
	t.Parallel()

	store := openStoreForTest(t)
	ctx := t.Context()
	const endpointID = "env_delete_claim_race"
	const threadID = "thread_delete_claim_race"
	ownerHash := strings.Repeat("a", 64)
	if err := store.CreateThreadSettings(ctx, ThreadSettings{
		ThreadID: threadID, EndpointID: endpointID, PermissionType: "approval_required",
	}); err != nil {
		t.Fatal(err)
	}
	lease, err := store.AcquireComposerDraftLease(ctx, endpointID, ownerHash, threadID, "surface_delete_race", false, 1_000)
	if err != nil {
		t.Fatal(err)
	}
	lateUpload := composerDraftUploadForTest(endpointID, ownerHash, "upload_after_delete_intent")
	if err := store.InsertUpload(ctx, lateUpload); err != nil {
		t.Fatal(err)
	}
	attempt := UploadAttemptRecord{
		EndpointID: endpointID, OwnerUserHash: ownerHash, UploadRequestID: "request_after_delete_intent",
		RequestFingerprint: strings.Repeat("b", 64), UploadID: "upload_attempt_after_delete", CreatedAtUnixMs: 1_001,
	}
	if _, created, err := store.ReserveUploadAttempt(ctx, attempt); err != nil || !created {
		t.Fatalf("ReserveUploadAttempt created=%t err=%v", created, err)
	}

	operation, err := store.PrepareThreadDeleteOperation(ctx, endpointID, threadID, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(operation.Snapshot.UploadCleanupIDs) != 0 {
		t.Fatalf("initial cleanup snapshot=%v, want empty", operation.Snapshot.UploadCleanupIDs)
	}

	checks := []struct {
		name string
		run  func() error
	}{
		{name: "acquire", run: func() error {
			_, err := store.AcquireComposerDraftLease(ctx, endpointID, ownerHash, threadID, "surface_late", true, 1_002)
			return err
		}},
		{name: "renew", run: func() error {
			_, err := store.RenewComposerDraftLease(ctx, endpointID, ownerHash, threadID, "surface_delete_race", lease.Draft.LeaseID, 1_002)
			return err
		}},
		{name: "mutate", run: func() error {
			_, err := store.MutateComposerDraft(ctx, ComposerDraftMutation{
				EndpointID: endpointID, OwnerUserHash: ownerHash, ScopeID: threadID,
				HolderID: "surface_delete_race", LeaseID: lease.Draft.LeaseID, ExpectedRevision: lease.Draft.Revision,
				Value: json.RawMessage(`{"text":"late","attachments":[],"mode":"ordinary"}`), NowUnixMs: 1_002,
			})
			return err
		}},
		{name: "bind draft claim", run: func() error {
			return store.BindUserUploadsToDraft(ctx, endpointID, ownerHash, threadID, []string{lateUpload.UploadID}, 1_002)
		}},
		{name: "complete upload claim", run: func() error {
			rec := composerDraftUploadForTest(endpointID, ownerHash, attempt.UploadID)
			return store.CompleteUploadAttempt(ctx, attempt, rec, threadID)
		}},
	}
	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			if err := check.run(); !errors.Is(err, ErrThreadIDRetired) {
				t.Fatalf("error=%v, want %v", err, ErrThreadIDRetired)
			}
		})
	}
	if refs := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); refs != 0 {
		t.Fatalf("late draft refs=%d, want 0", refs)
	}
	if uploads := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_uploads WHERE endpoint_id = ? AND upload_id = ?`, endpointID, attempt.UploadID); uploads != 0 {
		t.Fatalf("late completed uploads=%d, want 0", uploads)
	}
	if _, err := store.ConfirmThreadDeleteFloretDeleted(ctx, operation.OperationID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CommitThreadDeleteProductData(ctx, operation.OperationID); err != nil {
		t.Fatal(err)
	}
	if drafts := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_composer_drafts WHERE endpoint_id = ? AND scope_id = ?`, endpointID, threadID); drafts != 0 {
		t.Fatalf("retired composer drafts=%d, want 0", drafts)
	}
}

func TestStoreThreadDeleteSnapshotSerializesConcurrentComposerClaims(t *testing.T) {
	type claimFixture struct {
		operation string
		uploadID  string
		claim     func(context.Context) error
	}
	type prepareResult struct {
		operation ThreadDeleteOperation
		err       error
	}

	waitForBlockedTransaction := func(t *testing.T, store *Store, previousWaitCount int64, release chan struct{}) {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for store.db.Stats().WaitCount <= previousWaitCount {
			if time.Now().After(deadline) {
				close(release)
				t.Fatal("competing transaction did not block behind the transaction barrier")
			}
			time.Sleep(time.Millisecond)
		}
	}
	containsUpload := func(uploadIDs []string, uploadID string) bool {
		for _, candidate := range uploadIDs {
			if candidate == uploadID {
				return true
			}
		}
		return false
	}

	for _, claimKind := range []string{"complete", "bind", "mutate"} {
		claimKind := claimKind
		for _, firstOperation := range []string{"claim", "snapshot"} {
			firstOperation := firstOperation
			t.Run(claimKind+"_before_"+map[string]string{"claim": "snapshot", "snapshot": "claim"}[firstOperation], func(t *testing.T) {
				store := openStoreForTest(t)
				ctx := t.Context()
				endpointID := "env_delete_snapshot_race_" + claimKind + "_" + firstOperation
				threadID := "thread_delete_snapshot_race_" + claimKind + "_" + firstOperation
				ownerHash := strings.Repeat("d", 64)
				if err := store.CreateThreadSettings(ctx, ThreadSettings{
					ThreadID: threadID, EndpointID: endpointID, PermissionType: "approval_required",
				}); err != nil {
					t.Fatal(err)
				}

				fixture := claimFixture{uploadID: "upload_delete_snapshot_race_" + claimKind + "_" + firstOperation}
				switch claimKind {
				case "complete":
					attempt := UploadAttemptRecord{
						EndpointID: endpointID, OwnerUserHash: ownerHash,
						UploadRequestID: "request_delete_snapshot_race", RequestFingerprint: strings.Repeat("e", 64),
						UploadID: fixture.uploadID, CreatedAtUnixMs: 1_001,
					}
					if _, created, err := store.ReserveUploadAttempt(ctx, attempt); err != nil || !created {
						t.Fatalf("ReserveUploadAttempt created=%t err=%v", created, err)
					}
					fixture.operation = "complete_upload_attempt"
					fixture.claim = func(claimCtx context.Context) error {
						return store.CompleteUploadAttempt(claimCtx, attempt, composerDraftUploadForTest(endpointID, ownerHash, fixture.uploadID), threadID)
					}
				case "bind":
					if err := store.InsertUpload(ctx, composerDraftUploadForTest(endpointID, ownerHash, fixture.uploadID)); err != nil {
						t.Fatal(err)
					}
					fixture.operation = "bind_user_uploads_to_draft"
					fixture.claim = func(claimCtx context.Context) error {
						return store.BindUserUploadsToDraft(claimCtx, endpointID, ownerHash, threadID, []string{fixture.uploadID}, 1_002)
					}
				case "mutate":
					if err := store.InsertUpload(ctx, composerDraftUploadForTest(endpointID, ownerHash, fixture.uploadID)); err != nil {
						t.Fatal(err)
					}
					if err := store.BindUserUploadsToDraft(ctx, endpointID, ownerHash, threadID, []string{fixture.uploadID}, 1_002); err != nil {
						t.Fatal(err)
					}
					lease, err := store.AcquireComposerDraftLease(ctx, endpointID, ownerHash, threadID, "surface_delete_snapshot_race", false, 1_003)
					if err != nil {
						t.Fatal(err)
					}
					fixture.operation = "mutate_composer_draft"
					fixture.claim = func(claimCtx context.Context) error {
						_, err := store.MutateComposerDraft(claimCtx, ComposerDraftMutation{
							EndpointID: endpointID, OwnerUserHash: ownerHash, ScopeID: threadID,
							HolderID: "surface_delete_snapshot_race", LeaseID: lease.Draft.LeaseID,
							ExpectedRevision: lease.Draft.Revision,
							Value:            composerDraftValueForTest("concurrent mutation", ComposerDraftModeOrdinary, fixture.uploadID),
							NowUnixMs:        1_004,
						})
						return err
					}
				default:
					t.Fatalf("unsupported claim fixture %q", claimKind)
				}

				entered := make(chan struct{})
				release := make(chan struct{})
				barrierFor := fixture.operation
				if firstOperation == "snapshot" {
					barrierFor = "prepare_thread_delete"
				}
				barrierCtx := context.WithValue(ctx, storeTransactionObserverContextKey{}, storeTransactionObserver(func(operation string) {
					if operation != barrierFor {
						return
					}
					close(entered)
					<-release
				}))

				claimDone := make(chan error, 1)
				prepareDone := make(chan prepareResult, 1)
				if firstOperation == "claim" {
					go func() { claimDone <- fixture.claim(barrierCtx) }()
				} else {
					go func() {
						operation, err := store.PrepareThreadDeleteOperation(barrierCtx, endpointID, threadID, false)
						prepareDone <- prepareResult{operation: operation, err: err}
					}()
				}
				select {
				case <-entered:
				case <-time.After(5 * time.Second):
					t.Fatal("first transaction did not reach the transaction barrier")
				}

				previousWaitCount := store.db.Stats().WaitCount
				if firstOperation == "claim" {
					go func() {
						operation, err := store.PrepareThreadDeleteOperation(ctx, endpointID, threadID, false)
						prepareDone <- prepareResult{operation: operation, err: err}
					}()
				} else {
					go func() { claimDone <- fixture.claim(ctx) }()
				}
				waitForBlockedTransaction(t, store, previousWaitCount, release)
				close(release)

				claimErr := <-claimDone
				prepared := <-prepareDone
				if prepared.err != nil {
					t.Fatalf("PrepareThreadDeleteOperation: %v", prepared.err)
				}
				if firstOperation == "claim" {
					if claimErr != nil {
						t.Fatalf("claim committed before snapshot: %v", claimErr)
					}
					if !containsUpload(prepared.operation.Snapshot.UploadCleanupIDs, fixture.uploadID) {
						t.Fatalf("snapshot cleanup ids=%v, want committed claim %q", prepared.operation.Snapshot.UploadCleanupIDs, fixture.uploadID)
					}
				} else if !errors.Is(claimErr, ErrThreadIDRetired) {
					t.Fatalf("claim after snapshot error=%v, want %v", claimErr, ErrThreadIDRetired)
				}

				if _, err := store.ConfirmThreadDeleteFloretDeleted(ctx, prepared.operation.OperationID); err != nil {
					t.Fatal(err)
				}
				if _, err := store.CommitThreadDeleteProductData(ctx, prepared.operation.OperationID); err != nil {
					t.Fatal(err)
				}
				if refs := countRowsForTest(t, store.db, `
SELECT COUNT(1) FROM ai_upload_refs
WHERE endpoint_id = ? AND thread_id = ? AND ref_kind IN (?, ?)
`, endpointID, threadID, UploadRefKindDraft, UploadRefKindDraftPending); refs != 0 {
					t.Fatalf("draft claims escaped thread deletion: %d", refs)
				}
				if drafts := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_composer_drafts WHERE endpoint_id = ? AND scope_id = ?`, endpointID, threadID); drafts != 0 {
					t.Fatalf("composer draft escaped thread deletion: %d", drafts)
				}
				if firstOperation == "claim" {
					upload, err := store.GetUpload(ctx, endpointID, fixture.uploadID)
					if err != nil || upload.State != UploadStateDeleting {
						t.Fatalf("snapshotted upload=%#v err=%v, want deleting after claim cleanup", upload, err)
					}
				}
			})
		}
	}
}

func TestStore_CommitPendingTurnAdmissionRejectsInvalidPersistedLane(t *testing.T) {
	t.Parallel()

	store := openStoreForTest(t)
	ctx := context.Background()
	if err := store.CreateThreadSettings(ctx, ThreadSettings{ThreadID: "thread_lane", EndpointID: "env_lane", PermissionType: "approval_required"}); err != nil {
		t.Fatal(err)
	}
	if err := store.InsertUpload(ctx, UploadRecord{
		UploadID: "upload_lane", EndpointID: "env_lane", StorageRelPath: "upload_lane.data",
		Name: "lane.txt", MimeType: "text/plain", SizeBytes: 4, CreatedAtUnixMs: 1,
	}); err != nil {
		t.Fatal(err)
	}
	command, _, _, err := store.CreateFollowupWithUploadRefs(ctx, QueuedTurn{
		QueueID: "queue_lane", EndpointID: "env_lane", ThreadID: "thread_lane", ChannelID: "channel_lane",
		Lane: FollowupLaneQueued, TurnID: "turn_lane", RunID: "run_lane", TextContent: "queued",
	}, []string{"upload_lane"}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE ai_queued_turns SET lane = 'legacy_pending' WHERE queue_id = ?`, command.QueueID); err != nil {
		t.Fatal(err)
	}
	if err := store.CommitPendingTurnAdmission(ctx, "env_lane", "thread_lane", command.QueueID, command.TurnID, []string{"upload_lane"}, 3); err == nil || !strings.Contains(err.Error(), "invalid followup lane") {
		t.Fatalf("CommitPendingTurnAdmission error=%v, want invalid lane", err)
	}
	if count := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_queued_turns WHERE queue_id = ?`, command.QueueID); count != 1 {
		t.Fatalf("queued commands=%d, want 1", count)
	}
	if count := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE upload_id = ? AND ref_kind = ? AND ref_id = ?`, "upload_lane", UploadRefKindQueuedTurn, command.QueueID); count != 1 {
		t.Fatalf("queued upload refs=%d, want 1", count)
	}
	if count := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE upload_id = ? AND ref_kind = ?`, "upload_lane", UploadRefKindThread); count != 0 {
		t.Fatalf("thread upload refs=%d, want 0", count)
	}
}

func TestStore_DeleteFollowupResources_ReturnsUploadCandidate(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThreadSettings(ctx, ThreadSettings{ThreadID: "th_1", EndpointID: "env_1", PermissionType: "approval_required"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := s.InsertUpload(ctx, UploadRecord{
		UploadID:          "upl_followup",
		EndpointID:        "env_1",
		StorageRelPath:    "upl_followup.data",
		Name:              "followup.txt",
		MimeType:          "text/plain",
		SizeBytes:         8,
		State:             UploadStateStaged,
		CreatedAtUnixMs:   100,
		DeleteAfterUnixMs: 200,
	}); err != nil {
		t.Fatalf("InsertUpload: %v", err)
	}
	queued, _, _, err := s.CreateFollowupWithUploadRefs(ctx, QueuedTurn{
		QueueID:               "fu_1",
		EndpointID:            "env_1",
		ThreadID:              "th_1",
		ChannelID:             "ch_1",
		Lane:                  FollowupLaneQueued,
		TurnID:                "turn_followup",
		RunID:                 "run_followup",
		ModelID:               "openai/gpt-5-mini",
		TextContent:           "queued followup",
		AttachmentsJSON:       `[{"url":"/_redeven_proxy/api/ai/uploads/upl_followup"}]`,
		CreatedByUserPublicID: "u1",
		CreatedByUserEmail:    "u1@example.com",
		CreatedAtUnixMs:       1000,
		UpdatedAtUnixMs:       1000,
	}, []string{"upl_followup"}, 1000)
	if err != nil {
		t.Fatalf("CreateFollowupWithUploadRefs: %v", err)
	}

	result, err := s.DeleteFollowupResources(ctx, "env_1", "th_1", queued.QueueID)
	if err != nil {
		t.Fatalf("DeleteFollowupResources: %v", err)
	}
	if result.Revision <= 0 {
		t.Fatalf("revision=%d, want > 0", result.Revision)
	}
	if len(result.UploadsToDelete) != 1 || result.UploadsToDelete[0].UploadID != "upl_followup" {
		t.Fatalf("uploads=%v, want queued upload", result.UploadsToDelete)
	}
	if count := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_queued_turns WHERE endpoint_id = ? AND thread_id = ?`, "env_1", "th_1"); count != 0 {
		t.Fatalf("queued turn count=%d, want 0", count)
	}
}

func TestStore_ReplaceFollowupWithUploadRefsIsAtomicAndStrict(t *testing.T) {
	t.Parallel()

	s := openStoreForTest(t)
	ctx := context.Background()
	const endpointID = "env_replace"
	const threadID = "thread_replace"
	if err := s.CreateThreadSettings(ctx, ThreadSettings{ThreadID: threadID, EndpointID: endpointID, PermissionType: "approval_required"}); err != nil {
		t.Fatal(err)
	}
	for _, uploadID := range []string{"upload_keep", "upload_drop"} {
		if err := s.InsertUpload(ctx, UploadRecord{
			UploadID: uploadID, EndpointID: endpointID, StorageRelPath: uploadID + ".data",
			Name: uploadID + ".txt", MimeType: "text/plain", SizeBytes: 4, CreatedAtUnixMs: 1,
		}); err != nil {
			t.Fatal(err)
		}
	}
	source, _, beforeRevision, err := s.CreateFollowupWithUploadRefs(ctx, QueuedTurn{
		QueueID: "queue_source", EndpointID: endpointID, ThreadID: threadID, ChannelID: "channel_replace",
		Lane: FollowupLaneQueued, TurnID: "turn_source", RunID: "run_source", TextContent: "source",
	}, []string{"upload_keep", "upload_drop"}, 2)
	if err != nil {
		t.Fatal(err)
	}

	replacement, err := s.ReplaceFollowupWithUploadRefs(ctx, source.QueueID, QueuedTurn{
		QueueID: "queue_destination", EndpointID: endpointID, ThreadID: threadID, ChannelID: "channel_replace",
		Lane: FollowupLaneQueued, TurnID: "turn_destination", RunID: "run_destination", TextContent: "replacement",
	}, []string{"upload_keep"}, 3)
	if err != nil {
		t.Fatal(err)
	}
	if replacement.Revision != beforeRevision+1 {
		t.Fatalf("revision=%d, want %d", replacement.Revision, beforeRevision+1)
	}
	if replacement.Queued.QueueID != "queue_destination" || replacement.Position != 1 {
		t.Fatalf("replacement=%+v", replacement)
	}
	if len(replacement.UploadsToDelete) != 1 || replacement.UploadsToDelete[0].UploadID != "upload_drop" {
		t.Fatalf("cleanup candidates=%#v, want upload_drop", replacement.UploadsToDelete)
	}
	if stored, getErr := s.GetQueuedTurn(ctx, endpointID, threadID, source.QueueID); !errors.Is(getErr, sql.ErrNoRows) || stored != nil {
		t.Fatalf("source remains after replacement: stored=%#v err=%v", stored, getErr)
	}
	if stored, getErr := s.GetQueuedTurn(ctx, endpointID, threadID, replacement.Queued.QueueID); getErr != nil || stored == nil || stored.TextContent != "replacement" {
		t.Fatalf("destination missing after replacement: stored=%#v err=%v", stored, getErr)
	}
	if count := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = ? AND ref_kind = ? AND ref_id = ?`, endpointID, "upload_keep", UploadRefKindQueuedTurn, replacement.Queued.QueueID); count != 1 {
		t.Fatalf("replacement upload refs=%d, want 1", count)
	}
	if count := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_queued_turns WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); count != 1 {
		t.Fatalf("queued row count=%d, want 1", count)
	}

	_, err = s.ReplaceFollowupWithUploadRefs(ctx, source.QueueID, QueuedTurn{
		QueueID: "queue_retry", EndpointID: endpointID, ThreadID: threadID, ChannelID: "channel_replace",
		Lane: FollowupLaneQueued, TurnID: "turn_retry", RunID: "run_retry", TextContent: "must not duplicate",
	}, nil, 4)
	if !errors.Is(err, ErrFollowupReplacementConflict) {
		t.Fatalf("replacement retry error=%v, want %v", err, ErrFollowupReplacementConflict)
	}
	if count := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_queued_turns WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); count != 1 {
		t.Fatalf("queued row count after retry=%d, want 1", count)
	}
}

func TestStore_CommitPendingTurnAdmissionAtomicallyTransfersUploadRefs(t *testing.T) {
	t.Parallel()

	s := openStoreForTest(t)
	ctx := context.Background()
	if err := s.CreateThreadSettings(ctx, ThreadSettings{ThreadID: "th_admission", EndpointID: "env_1", PermissionType: "approval_required"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := s.InsertUpload(ctx, UploadRecord{
		UploadID: "upl_admission", EndpointID: "env_1", StorageRelPath: "upl_admission.data",
		Name: "admission.txt", MimeType: "text/plain", State: UploadStateStaged, CreatedAtUnixMs: 100,
	}); err != nil {
		t.Fatalf("InsertUpload: %v", err)
	}
	command, _, _, err := s.CreateFollowupWithUploadRefs(ctx, QueuedTurn{
		QueueID: "command_admission", EndpointID: "env_1", ThreadID: "th_admission", ChannelID: "ch_1",
		Lane: FollowupLaneQueued, TurnID: "turn_admission", RunID: "run_admission",
		TextContent: "persist only before admission", AttachmentsJSON: "[]", CreatedAtUnixMs: 200,
	}, []string{"upl_admission"}, 200)
	if err != nil {
		t.Fatalf("CreateFollowupWithUploadRefs: %v", err)
	}
	if err := s.BeginPendingTurnAdmission(ctx, "env_1", "th_admission", command.QueueID, command.TurnID, command.RunID); err != nil {
		t.Fatalf("BeginPendingTurnAdmission: %v", err)
	}
	if err := s.CommitPendingTurnAdmission(ctx, "env_1", "th_admission", command.QueueID, command.TurnID, nil, 300); err != nil {
		t.Fatalf("CommitPendingTurnAdmission: %v", err)
	}
	if count := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_queued_turns WHERE queue_id = ?`, command.QueueID); count != 0 {
		t.Fatalf("pending command rows=%d, want 0", count)
	}
	if count := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE upload_id = ? AND ref_kind = ? AND ref_id = ?`, "upl_admission", UploadRefKindQueuedTurn, command.QueueID); count != 0 {
		t.Fatalf("queued upload refs=%d, want 0", count)
	}
	if count := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE upload_id = ? AND ref_kind = ? AND ref_id = ?`, "upl_admission", UploadRefKindThread, "th_admission"); count != 1 {
		t.Fatalf("thread upload refs=%d, want 1", count)
	}
	if err := s.CommitPendingTurnAdmission(ctx, "env_1", "th_admission", command.QueueID, command.TurnID, nil, 400); err == nil || !strings.Contains(err.Error(), "missing during admission settlement") {
		t.Fatalf("second CommitPendingTurnAdmission error=%v, want missing command failure", err)
	}
}

func TestStore_InFlightPendingTurnRejectsUserMutation(t *testing.T) {
	t.Parallel()

	s := openStoreForTest(t)
	ctx := context.Background()
	const endpointID = "env_in_flight"
	const threadID = "thread_in_flight"
	if err := s.CreateThreadSettings(ctx, ThreadSettings{ThreadID: threadID, EndpointID: endpointID, PermissionType: "approval_required"}); err != nil {
		t.Fatal(err)
	}
	command, _, revision, err := s.CreateFollowup(ctx, QueuedTurn{
		QueueID: "queue_in_flight", EndpointID: endpointID, ThreadID: threadID, ChannelID: "channel_in_flight",
		Lane: FollowupLaneQueued, TurnID: "turn_in_flight", RunID: "run_in_flight", TextContent: "original",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.BeginPendingTurnAdmission(ctx, endpointID, threadID, command.QueueID, command.TurnID, command.RunID); err != nil {
		t.Fatal(err)
	}
	stored, err := s.GetQueuedTurn(ctx, endpointID, threadID, command.QueueID)
	if err != nil || stored.AdmissionState != PendingTurnAdmissionInFlight {
		t.Fatalf("stored=%#v err=%v", stored, err)
	}
	operations := []struct {
		name string
		run  func() error
	}{
		{name: "update followup", run: func() error {
			_, err := s.UpdateFollowupText(ctx, endpointID, threadID, command.QueueID, "changed")
			return err
		}},
		{name: "delete followup", run: func() error { _, err := s.DeleteFollowup(ctx, endpointID, threadID, command.QueueID); return err }},
		{name: "reorder followups", run: func() error {
			_, err := s.ReorderFollowups(ctx, endpointID, threadID, FollowupLaneQueued, []string{command.QueueID}, revision+1)
			return err
		}},
		{name: "legacy update", run: func() error { return s.UpdateQueuedTurn(ctx, endpointID, threadID, command.QueueID, "changed") }},
		{name: "legacy delete", run: func() error { return s.DeleteQueuedTurn(ctx, endpointID, threadID, command.QueueID) }},
		{name: "delete resources", run: func() error {
			_, err := s.DeleteFollowupResources(ctx, endpointID, threadID, command.QueueID)
			return err
		}},
	}
	for _, operation := range operations {
		t.Run(operation.name, func(t *testing.T) {
			if err := operation.run(); !errors.Is(err, ErrPendingTurnAdmissionInProgress) {
				t.Fatalf("error=%v, want %v", err, ErrPendingTurnAdmissionInProgress)
			}
		})
	}
	beforeRecoveryRevision, err := s.GetThreadFollowupsRevision(ctx, endpointID, threadID)
	if err != nil {
		t.Fatal(err)
	}
	recovered, recoveryRevision, err := s.RecoverQueuedTurnsToDrafts(ctx, endpointID, threadID)
	if err != nil {
		t.Fatal(err)
	}
	if len(recovered) != 0 {
		t.Fatalf("in-flight command recovered before admission resolved: %#v", recovered)
	}
	if recoveryRevision != beforeRecoveryRevision {
		t.Fatalf("in-flight-only recovery changed revision from %d to %d", beforeRecoveryRevision, recoveryRevision)
	}
	stored, err = s.GetQueuedTurn(ctx, endpointID, threadID, command.QueueID)
	if err != nil || stored.TextContent != "original" || stored.AdmissionState != PendingTurnAdmissionInFlight {
		t.Fatalf("in-flight command mutated: stored=%#v err=%v", stored, err)
	}
	if err := s.ReleasePendingTurnAdmission(ctx, endpointID, threadID, command.QueueID, command.TurnID, command.RunID, FollowupLaneDraft); err != nil {
		t.Fatal(err)
	}
	if stored, err := s.GetQueuedTurn(ctx, endpointID, threadID, command.QueueID); !errors.Is(err, sql.ErrNoRows) || stored != nil {
		t.Fatalf("released command remained queued: stored=%#v err=%v", stored, err)
	}
	drafts, err := s.ListFollowupsByLane(ctx, endpointID, threadID, FollowupLaneDraft, 10)
	if err != nil || len(drafts) != 1 || drafts[0].AdmissionState != PendingTurnAdmissionReady {
		t.Fatalf("released drafts=%#v err=%v", drafts, err)
	}
}

func TestStore_CommitPendingTurnAdmissionRejectsIdentityMismatchWithoutMutation(t *testing.T) {
	t.Parallel()

	s := openStoreForTest(t)
	ctx := context.Background()
	if err := s.CreateThreadSettings(ctx, ThreadSettings{ThreadID: "th_admission_mismatch", EndpointID: "env_1", PermissionType: "approval_required"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	command, _, _, err := s.CreateFollowup(ctx, QueuedTurn{
		QueueID: "command_admission_mismatch", EndpointID: "env_1", ThreadID: "th_admission_mismatch", ChannelID: "ch_1",
		Lane: FollowupLaneQueued, TurnID: "turn_expected", RunID: "run_expected", TextContent: "keep me",
	})
	if err != nil {
		t.Fatalf("CreateFollowup: %v", err)
	}
	if err := s.CommitPendingTurnAdmission(ctx, "env_1", "th_admission_mismatch", command.QueueID, "turn_other", nil, 300); err == nil {
		t.Fatal("CommitPendingTurnAdmission accepted a different turn identity")
	}
	stored, err := s.GetQueuedTurn(ctx, "env_1", "th_admission_mismatch", command.QueueID)
	if err != nil || stored == nil || stored.TextContent != "keep me" {
		t.Fatalf("pending command changed after rejected admission: %#v err=%v", stored, err)
	}
}

func TestStore_PrepareExpiredUploadsForDeletion_AndFinalize(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	now := time.Now().UnixMilli()
	if err := s.InsertUpload(ctx, UploadRecord{
		UploadID:          "upl_expired",
		EndpointID:        "env_1",
		StorageRelPath:    "upl_expired.data",
		Name:              "expired.txt",
		MimeType:          "text/plain",
		SizeBytes:         12,
		State:             UploadStateStaged,
		CreatedAtUnixMs:   now - 10_000,
		DeleteAfterUnixMs: now - 1,
	}); err != nil {
		t.Fatalf("InsertUpload: %v", err)
	}

	recs, err := s.PrepareExpiredUploadsForDeletion(ctx, now, 10)
	if err != nil {
		t.Fatalf("PrepareExpiredUploadsForDeletion: %v", err)
	}
	if len(recs) != 1 || recs[0].UploadID != "upl_expired" {
		t.Fatalf("expired records=%v, want upl_expired", recs)
	}
	if got, err := s.GetUpload(ctx, "env_1", "upl_expired"); err != nil {
		t.Fatalf("GetUpload after prepare: %v", err)
	} else if got.State != UploadStateDeleting {
		t.Fatalf("state=%q, want deleting", got.State)
	}
	if n, err := s.FinalizeDeletedUploads(ctx, []string{"upl_expired"}); err != nil {
		t.Fatalf("FinalizeDeletedUploads: %v", err)
	} else if n != 1 {
		t.Fatalf("finalized=%d, want 1", n)
	}
	if _, err := s.GetUpload(ctx, "env_1", "upl_expired"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("GetUpload err=%v, want %v", err, sql.ErrNoRows)
	}
}

func TestBuildSQLiteCompactionPlan_Thresholds(t *testing.T) {
	t.Parallel()

	noCompact := BuildSQLiteCompactionPlan(SQLitePageStats{
		PageSize:       4096,
		PageCount:      2000,
		FreelistCount:  100,
		AutoVacuumMode: sqliteAutoVacuumIncremental,
	})
	if noCompact.ShouldCompact {
		t.Fatalf("ShouldCompact=true below thresholds")
	}

	incremental := BuildSQLiteCompactionPlan(SQLitePageStats{
		PageSize:       4096,
		PageCount:      2000,
		FreelistCount:  1200,
		AutoVacuumMode: sqliteAutoVacuumIncremental,
	})
	if !incremental.ShouldCompact || !incremental.UseIncremental {
		t.Fatalf("incremental plan=%+v, want incremental compaction", incremental)
	}

	fallback := BuildSQLiteCompactionPlan(SQLitePageStats{
		PageSize:       4096,
		PageCount:      2000,
		FreelistCount:  1200,
		AutoVacuumMode: sqliteAutoVacuumNone,
	})
	if !fallback.ShouldCompact || fallback.UseIncremental {
		t.Fatalf("fallback plan=%+v, want VACUUM fallback", fallback)
	}
}
