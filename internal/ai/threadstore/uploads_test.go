package threadstore

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestStore_MigrateFromV20AddsUploadTables(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	if _, err := raw.Exec(`DROP TABLE IF EXISTS ai_upload_refs`); err != nil {
		t.Fatalf("drop ai_upload_refs: %v", err)
	}
	if _, err := raw.Exec(`DROP TABLE IF EXISTS ai_uploads`); err != nil {
		t.Fatalf("drop ai_uploads: %v", err)
	}
	if _, err := raw.Exec(`PRAGMA user_version=20;`); err != nil {
		t.Fatalf("set user_version: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close raw db: %v", err)
	}

	s, err = Open(dbPath)
	if err != nil {
		t.Fatalf("Open after v20 seed: %v", err)
	}
	defer func() { _ = s.Close() }()

	if !tableExistsForTest(t, s.db, "ai_uploads") {
		t.Fatalf("ai_uploads should exist after migration")
	}
	if !tableExistsForTest(t, s.db, "ai_upload_refs") {
		t.Fatalf("ai_upload_refs should exist after migration")
	}

	var autoVacuum int64
	if err := s.db.QueryRow(`PRAGMA auto_vacuum;`).Scan(&autoVacuum); err != nil {
		t.Fatalf("PRAGMA auto_vacuum: %v", err)
	}
	if autoVacuum != sqliteAutoVacuumIncremental {
		t.Fatalf("auto_vacuum=%d, want %d", autoVacuum, sqliteAutoVacuumIncremental)
	}
}

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
		if _, err := s.AppendMessageWithUploadRefs(ctx, "env_1", threadID, Message{
			ThreadID:           threadID,
			EndpointID:         "env_1",
			MessageID:          messageID,
			Role:               "user",
			Status:             "complete",
			CreatedAtUnixMs:    1000,
			UpdatedAtUnixMs:    1000,
			TextContent:        "see attachment",
			MessageJSON:        `{"id":"` + messageID + `"}`,
			AuthorUserPublicID: "u1",
			AuthorUserEmail:    "u1@example.com",
		}, "u1", "u1@example.com", []string{"upl_shared"}, 1000); err != nil {
			t.Fatalf("AppendMessageWithUploadRefs(%s): %v", threadID, err)
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
		MessageID:             "msg_followup",
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
