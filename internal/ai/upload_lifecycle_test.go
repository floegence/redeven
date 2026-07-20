package ai

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

func testUploadMeta() *session.Meta {
	return &session.Meta{
		ChannelID:         "ch_test",
		EndpointID:        "env_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		NamespacePublicID: "ns_test",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}
}

func TestService_DeleteThreadRemovesOwnedUploadArtifacts(t *testing.T) {
	t.Parallel()

	svc := newTestService(t, nil)
	meta := testUploadMeta()
	ctx := context.Background()

	thread, err := svc.CreateThread(ctx, meta, "upload cleanup", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	upload, err := svc.SaveUpload(ctx, meta.EndpointID, strings.NewReader("cleanup"), "cleanup.txt", "text/plain", 0)
	if err != nil {
		t.Fatalf("SaveUpload: %v", err)
	}
	uploadID := parseUploadIDFromURL(upload.URL)
	if uploadID == "" {
		t.Fatalf("missing upload_id in URL %q", upload.URL)
	}
	if err := svc.threadsDB.BindUploadsToRef(ctx, meta.EndpointID, thread.ThreadID, threadstore.UploadRefKindThread, thread.ThreadID, []string{uploadID}, time.Now().UnixMilli()); err != nil {
		t.Fatalf("BindUploadsToRef: %v", err)
	}

	dataPath := filepath.Join(svc.uploadsDir, uploadID+".data")
	if _, err := os.Stat(dataPath); err != nil {
		t.Fatalf("stat dataPath: %v", err)
	}

	if _, err := svc.DeleteThread(ctx, meta, thread.ThreadID, false); err != nil {
		t.Fatalf("DeleteThread: %v", err)
	}
	if _, err := os.Stat(dataPath); !os.IsNotExist(err) {
		t.Fatalf("dataPath err=%v, want not exist", err)
	}
	if _, err := svc.threadsDB.GetUpload(ctx, meta.EndpointID, uploadID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("GetUpload err=%v, want %v", err, sql.ErrNoRows)
	}
}

func TestService_DeleteThreadKeepsSharedUploadUntilLastThread(t *testing.T) {
	t.Parallel()

	svc := newTestService(t, nil)
	meta := testUploadMeta()
	ctx := context.Background()

	threadA, err := svc.CreateThread(ctx, meta, "thread A", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread A: %v", err)
	}
	threadB, err := svc.CreateThread(ctx, meta, "thread B", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread B: %v", err)
	}
	upload, err := svc.SaveUpload(ctx, meta.EndpointID, strings.NewReader("shared"), "shared.txt", "text/plain", 0)
	if err != nil {
		t.Fatalf("SaveUpload: %v", err)
	}
	uploadID := parseUploadIDFromURL(upload.URL)
	dataPath := filepath.Join(svc.uploadsDir, uploadID+".data")

	for _, threadID := range []string{threadA.ThreadID, threadB.ThreadID} {
		if err := svc.threadsDB.BindUploadsToRef(ctx, meta.EndpointID, threadID, threadstore.UploadRefKindThread, threadID, []string{uploadID}, time.Now().UnixMilli()); err != nil {
			t.Fatalf("BindUploadsToRef(%s): %v", threadID, err)
		}
	}

	if _, err := svc.DeleteThread(ctx, meta, threadA.ThreadID, false); err != nil {
		t.Fatalf("DeleteThread first: %v", err)
	}
	if _, err := os.Stat(dataPath); err != nil {
		t.Fatalf("shared upload should remain after first delete: %v", err)
	}
	if _, err := svc.threadsDB.GetUpload(ctx, meta.EndpointID, uploadID); err != nil {
		t.Fatalf("GetUpload after first delete: %v", err)
	}

	if _, err := svc.DeleteThread(ctx, meta, threadB.ThreadID, false); err != nil {
		t.Fatalf("DeleteThread second: %v", err)
	}
	if _, err := os.Stat(dataPath); !os.IsNotExist(err) {
		t.Fatalf("dataPath err=%v, want not exist after last delete", err)
	}
}

func TestService_DeleteFollowupRemovesUploadArtifacts(t *testing.T) {
	t.Parallel()

	svc := newTestService(t, nil)
	meta := testUploadMeta()
	ctx := context.Background()

	thread, err := svc.CreateThread(ctx, meta, "followup upload", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	upload, err := svc.SaveUpload(ctx, meta.EndpointID, strings.NewReader("followup"), "followup.txt", "text/plain", 0)
	if err != nil {
		t.Fatalf("SaveUpload: %v", err)
	}
	uploadID := parseUploadIDFromURL(upload.URL)
	queued, _, err := svc.enqueueQueuedTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: thread.ThreadID,
		Input: RunInput{
			Text:        "queued",
			Attachments: []RunAttachmentIn{{URL: upload.URL}},
		},
	})
	if err != nil {
		t.Fatalf("enqueueQueuedTurn: %v", err)
	}

	if err := svc.DeleteFollowup(ctx, meta, thread.ThreadID, queued.QueueID); err != nil {
		t.Fatalf("DeleteFollowup: %v", err)
	}
	if _, err := os.Stat(filepath.Join(svc.uploadsDir, uploadID+".data")); !os.IsNotExist(err) {
		t.Fatalf("data file err=%v, want not exist", err)
	}
	if _, err := svc.threadsDB.GetUpload(ctx, meta.EndpointID, uploadID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("GetUpload err=%v, want %v", err, sql.ErrNoRows)
	}
}

func TestQueuedTurnMissingAttachmentPreservesCommandAndOwnership(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, meta, "queued attachment failure", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	upload, err := svc.SaveUpload(ctx, meta.EndpointID, strings.NewReader("queued"), "queued.txt", "text/plain", 0)
	if err != nil {
		t.Fatal(err)
	}
	uploadID := parseUploadIDFromURL(upload.URL)
	queued, _, err := svc.enqueueQueuedTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: thread.ThreadID,
		Input: RunInput{Text: "inspect queued attachment", Attachments: []RunAttachmentIn{{
			Name: "queued.txt", MimeType: "text/plain", URL: upload.URL,
		}}},
	})
	if err != nil {
		t.Fatal(err)
	}

	db, err := sql.Open("sqlite", "file:"+filepath.Join(svc.stateDir, "ai", "threads.sqlite")+"?_pragma=busy_timeout(3000)")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	defer func() { _ = db.Close() }()
	missingAttachments := `[{"name":"missing.txt","mime_type":"text/plain","url":"/_redeven_proxy/api/ai/uploads/upl_missing"}]`
	if _, err := db.ExecContext(ctx, `UPDATE ai_queued_turns SET attachments_json = ? WHERE queue_id = ?`, missingAttachments, queued.QueueID); err != nil {
		t.Fatal(err)
	}

	actor := svc.threadMgr.Get(meta.EndpointID, thread.ThreadID)
	if actor == nil {
		t.Fatal("thread actor is unavailable")
	}
	if err := actor.handleMaybeStartQueuedTurn(ctx); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("handleMaybeStartQueuedTurn error=%v, want %v", err, sql.ErrNoRows)
	}
	stored, err := svc.threadsDB.GetQueuedTurn(ctx, meta.EndpointID, thread.ThreadID, queued.QueueID)
	if err != nil || stored == nil {
		t.Fatalf("queued command=%#v err=%v, want preserved", stored, err)
	}
	owned, err := svc.threadsDB.GetQueuedTurnOwnedUpload(ctx, meta.EndpointID, thread.ThreadID, queued.QueueID, uploadID)
	if err != nil || owned == nil {
		t.Fatalf("queued upload ownership=%#v err=%v, want preserved", owned, err)
	}
	if svc.HasActiveThreadForEndpoint(meta.EndpointID, thread.ThreadID) {
		t.Fatal("attachment failure registered an active run")
	}
	host, err := svc.openFloretThreadReadHost(ctx, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	overview, err := host.ReadThreadOverview(ctx, flruntime.ThreadID(thread.ThreadID))
	if err != nil {
		t.Fatal(err)
	}
	if overview.LatestTurn != nil {
		t.Fatalf("attachment failure admitted canonical turn: %#v", overview.LatestTurn)
	}
}

func TestService_OpenUploadRejectsMismatchedEndpoint(t *testing.T) {
	t.Parallel()

	svc := newTestService(t, nil)
	ctx := context.Background()
	uploadID := "upl_endpoint_scoped"
	dataPath := filepath.Join(svc.uploadsDir, uploadID+".data")
	now := time.Now().UnixMilli()
	if err := os.WriteFile(dataPath, []byte("scoped"), 0o600); err != nil {
		t.Fatalf("WriteFile data: %v", err)
	}
	if err := svc.threadsDB.InsertUpload(ctx, threadstore.UploadRecord{
		UploadID:          uploadID,
		EndpointID:        "env_owner",
		StorageRelPath:    uploadID + ".data",
		Name:              "scoped.txt",
		MimeType:          "text/plain",
		SizeBytes:         6,
		State:             threadstore.UploadStateLive,
		CreatedAtUnixMs:   now,
		DeleteAfterUnixMs: 0,
	}); err != nil {
		t.Fatalf("InsertUpload: %v", err)
	}

	if _, _, err := svc.OpenUpload(ctx, "env_other", uploadID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("OpenUpload err=%v, want %v", err, sql.ErrNoRows)
	}
}

func TestService_SweepPendingUploadsRemovesExpiredStagedUploads(t *testing.T) {
	t.Parallel()

	svc := newTestService(t, nil)
	stopTestServiceMaintenance(t, svc)
	meta := testUploadMeta()
	ctx := context.Background()
	now := time.Now().UnixMilli()

	uploadID := "upl_expired_staged"
	dataPath := filepath.Join(svc.uploadsDir, uploadID+".data")
	if err := os.WriteFile(dataPath, []byte("draft"), 0o600); err != nil {
		t.Fatalf("WriteFile data: %v", err)
	}
	if err := svc.threadsDB.InsertUpload(ctx, threadstore.UploadRecord{
		UploadID:          uploadID,
		EndpointID:        meta.EndpointID,
		StorageRelPath:    uploadID + ".data",
		Name:              "draft.txt",
		MimeType:          "text/plain",
		SizeBytes:         5,
		State:             threadstore.UploadStateStaged,
		CreatedAtUnixMs:   now - 10_000,
		DeleteAfterUnixMs: now - 1,
	}); err != nil {
		t.Fatalf("InsertUpload: %v", err)
	}

	n, err := svc.sweepPendingUploads(ctx)
	if err != nil {
		t.Fatalf("sweepPendingUploads: %v", err)
	}
	if n != 1 {
		t.Fatalf("sweep count=%d, want 1", n)
	}
	if _, err := os.Stat(dataPath); !os.IsNotExist(err) {
		t.Fatalf("dataPath err=%v, want not exist", err)
	}
	if _, err := svc.threadsDB.GetUpload(ctx, meta.EndpointID, uploadID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("GetUpload err=%v, want %v", err, sql.ErrNoRows)
	}
}

func TestService_ProcessUploadCleanupCandidatesReschedulesDeleteFailures(t *testing.T) {
	t.Parallel()

	svc := newTestService(t, nil)
	meta := testUploadMeta()
	ctx := context.Background()
	now := time.Now().UnixMilli()

	uploadID := "upl_delete_retry"
	dataDir := filepath.Join(svc.uploadsDir, uploadID+".data")
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		t.Fatalf("MkdirAll dataDir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "nested.txt"), []byte("nested"), 0o600); err != nil {
		t.Fatalf("WriteFile nested: %v", err)
	}
	if err := svc.threadsDB.InsertUpload(ctx, threadstore.UploadRecord{
		UploadID:          uploadID,
		EndpointID:        meta.EndpointID,
		StorageRelPath:    uploadID + ".data",
		Name:              "retry.txt",
		MimeType:          "text/plain",
		SizeBytes:         6,
		State:             threadstore.UploadStateDeleting,
		CreatedAtUnixMs:   now - 10_000,
		DeleteAfterUnixMs: now - 1,
	}); err != nil {
		t.Fatalf("InsertUpload: %v", err)
	}

	n, err := svc.processUploadCleanupCandidates(ctx, []threadstore.UploadRecord{{
		UploadID:          uploadID,
		EndpointID:        meta.EndpointID,
		StorageRelPath:    uploadID + ".data",
		Name:              "retry.txt",
		MimeType:          "text/plain",
		SizeBytes:         6,
		State:             threadstore.UploadStateDeleting,
		CreatedAtUnixMs:   now - 10_000,
		DeleteAfterUnixMs: now - 1,
	}})
	if err != nil {
		t.Fatalf("processUploadCleanupCandidates: %v", err)
	}
	if n != 0 {
		t.Fatalf("finalized=%d, want 0 on delete failure", n)
	}
	rec, err := svc.threadsDB.GetUpload(ctx, meta.EndpointID, uploadID)
	if err != nil {
		t.Fatalf("GetUpload: %v", err)
	}
	if rec.State != threadstore.UploadStateDeleting {
		t.Fatalf("state=%q, want deleting", rec.State)
	}
	if rec.DeleteAfterUnixMs <= now {
		t.Fatalf("delete_after=%d, want rescheduled into the future", rec.DeleteAfterUnixMs)
	}
}
