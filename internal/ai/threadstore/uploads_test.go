package threadstore

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestStore_DeleteThreadResources_RespectsSharedUploadRefs(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	for _, threadID := range []string{"th_1", "th_2"} {
		if err := s.CreateThread(ctx, Thread{ThreadID: threadID, EndpointID: "env_1", Title: threadID}); err != nil {
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
		if err := s.BindUploadsToRef(ctx, "env_1", threadID, UploadRefKindTurn, messageID, []string{"upl_shared"}, 1000); err != nil {
			t.Fatalf("BindUploadsToRef(%s): %v", threadID, err)
		}
	}
	appendWithUpload("th_1", "msg_1")
	appendWithUpload("th_2", "msg_2")

	result, err := s.DeleteThreadResources(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("DeleteThreadResources first: %v", err)
	}
	if len(result.UploadsToDelete) != 0 {
		t.Fatalf("first delete uploads=%v, want none for shared upload", result.UploadsToDelete)
	}
	if refs := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = ?`, "env_1", "upl_shared"); refs != 1 {
		t.Fatalf("remaining refs=%d, want 1", refs)
	}

	result, err = s.DeleteThreadResources(ctx, "env_1", "th_2")
	if err != nil {
		t.Fatalf("DeleteThreadResources second: %v", err)
	}
	if len(result.UploadsToDelete) != 1 || result.UploadsToDelete[0].UploadID != "upl_shared" {
		t.Fatalf("second delete uploads=%v, want shared upload", result.UploadsToDelete)
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
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "followup"}); err != nil {
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

func TestStore_CommitPendingTurnAdmissionAtomicallyTransfersUploadRefs(t *testing.T) {
	t.Parallel()

	s := openStoreForTest(t)
	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_admission", EndpointID: "env_1", Title: "admission"}); err != nil {
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
	if err := s.CommitPendingTurnAdmission(ctx, "env_1", "th_admission", command.QueueID, command.TurnID, 300); err != nil {
		t.Fatalf("CommitPendingTurnAdmission: %v", err)
	}
	if count := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_queued_turns WHERE queue_id = ?`, command.QueueID); count != 0 {
		t.Fatalf("pending command rows=%d, want 0", count)
	}
	if count := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE upload_id = ? AND ref_kind = ? AND ref_id = ?`, "upl_admission", UploadRefKindQueuedTurn, command.QueueID); count != 0 {
		t.Fatalf("queued upload refs=%d, want 0", count)
	}
	if count := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE upload_id = ? AND ref_kind = ? AND ref_id = ?`, "upl_admission", UploadRefKindTurn, command.TurnID); count != 1 {
		t.Fatalf("turn upload refs=%d, want 1", count)
	}
	if err := s.CommitPendingTurnAdmission(ctx, "env_1", "th_admission", command.QueueID, command.TurnID, 400); err != nil {
		t.Fatalf("idempotent CommitPendingTurnAdmission: %v", err)
	}
}

func TestStore_CommitPendingTurnAdmissionRejectsIdentityMismatchWithoutMutation(t *testing.T) {
	t.Parallel()

	s := openStoreForTest(t)
	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_admission_mismatch", EndpointID: "env_1", Title: "admission"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	command, _, _, err := s.CreateFollowup(ctx, QueuedTurn{
		QueueID: "command_admission_mismatch", EndpointID: "env_1", ThreadID: "th_admission_mismatch", ChannelID: "ch_1",
		Lane: FollowupLaneQueued, TurnID: "turn_expected", RunID: "run_expected", TextContent: "keep me",
	})
	if err != nil {
		t.Fatalf("CreateFollowup: %v", err)
	}
	if err := s.CommitPendingTurnAdmission(ctx, "env_1", "th_admission_mismatch", command.QueueID, "turn_other", 300); err == nil {
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
