package threadstore

import (
	"context"
	"database/sql"
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
