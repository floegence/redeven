package ai

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

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
	if _, _, err := svc.persistUserMessage(ctx, meta, meta.EndpointID, thread.ThreadID, RunInput{
		Text:        "please keep the file",
		Attachments: []RunAttachmentIn{{URL: upload.URL}},
	}); err != nil {
		t.Fatalf("persistUserMessage: %v", err)
	}

	dataPath := filepath.Join(svc.uploadsDir, uploadID+".data")
	metaPath := filepath.Join(svc.uploadsDir, uploadID+".json")
	if _, err := os.Stat(dataPath); err != nil {
		t.Fatalf("stat dataPath: %v", err)
	}
	if _, err := os.Stat(metaPath); err != nil {
		t.Fatalf("stat metaPath: %v", err)
	}

	if err := svc.DeleteThread(ctx, meta, thread.ThreadID, false); err != nil {
		t.Fatalf("DeleteThread: %v", err)
	}
	if _, err := os.Stat(dataPath); !os.IsNotExist(err) {
		t.Fatalf("dataPath err=%v, want not exist", err)
	}
	if _, err := os.Stat(metaPath); !os.IsNotExist(err) {
		t.Fatalf("metaPath err=%v, want not exist", err)
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
		if _, _, err := svc.persistUserMessage(ctx, meta, meta.EndpointID, threadID, RunInput{
			Text:        "shared upload",
			Attachments: []RunAttachmentIn{{URL: upload.URL}},
		}); err != nil {
			t.Fatalf("persistUserMessage(%s): %v", threadID, err)
		}
	}

	if err := svc.DeleteThread(ctx, meta, threadA.ThreadID, false); err != nil {
		t.Fatalf("DeleteThread first: %v", err)
	}
	if _, err := os.Stat(dataPath); err != nil {
		t.Fatalf("shared upload should remain after first delete: %v", err)
	}
	if _, err := svc.threadsDB.GetUpload(ctx, meta.EndpointID, uploadID); err != nil {
		t.Fatalf("GetUpload after first delete: %v", err)
	}

	if err := svc.DeleteThread(ctx, meta, threadB.ThreadID, false); err != nil {
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

func TestService_OpenUploadAdoptsLegacySidecar(t *testing.T) {
	t.Parallel()

	svc := newTestService(t, nil)
	meta := testUploadMeta()
	ctx := context.Background()

	uploadID := "upl_legacy_sidecar"
	dataPath := filepath.Join(svc.uploadsDir, uploadID+".data")
	metaPath := filepath.Join(svc.uploadsDir, uploadID+".json")
	now := time.Now().UnixMilli()
	if err := os.WriteFile(dataPath, []byte("legacy payload"), 0o600); err != nil {
		t.Fatalf("WriteFile data: %v", err)
	}
	if err := os.WriteFile(metaPath, []byte(`{"id":"`+uploadID+`","name":"legacy.txt","size":14,"mime_type":"text/plain","created_at_unix_ms":`+strconv.FormatInt(now, 10)+`}`+"\n"), 0o600); err != nil {
		t.Fatalf("WriteFile meta: %v", err)
	}

	info, resolvedPath, err := svc.OpenUpload(ctx, meta.EndpointID, uploadID)
	if err != nil {
		t.Fatalf("OpenUpload: %v", err)
	}
	if resolvedPath != dataPath {
		t.Fatalf("resolvedPath=%q, want %q", resolvedPath, dataPath)
	}
	if info == nil || info.Name != "legacy.txt" || info.MimeType != "text/plain" || info.Size != 14 {
		t.Fatalf("unexpected upload info: %#v", info)
	}
	rec, err := svc.threadsDB.GetUpload(ctx, meta.EndpointID, uploadID)
	if err != nil {
		t.Fatalf("GetUpload: %v", err)
	}
	if rec.StorageRelPath != uploadID+".data" {
		t.Fatalf("storage_relpath=%q, want %q", rec.StorageRelPath, uploadID+".data")
	}
	if rec.State != threadstore.UploadStateStaged {
		t.Fatalf("state=%q, want %q", rec.State, threadstore.UploadStateStaged)
	}
}

func TestService_OpenUploadRejectsMismatchedEndpoint(t *testing.T) {
	t.Parallel()

	svc := newTestService(t, nil)
	ctx := context.Background()
	uploadID := "upl_endpoint_scoped"
	dataPath := filepath.Join(svc.uploadsDir, uploadID+".data")
	metaPath := filepath.Join(svc.uploadsDir, uploadID+".json")
	now := time.Now().UnixMilli()
	if err := os.WriteFile(dataPath, []byte("scoped"), 0o600); err != nil {
		t.Fatalf("WriteFile data: %v", err)
	}
	if err := os.WriteFile(metaPath, []byte(`{"id":"`+uploadID+`","name":"scoped.txt","size":6,"mime_type":"text/plain","created_at_unix_ms":`+strconv.FormatInt(now, 10)+`}`+"\n"), 0o600); err != nil {
		t.Fatalf("WriteFile meta: %v", err)
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
	meta := testUploadMeta()
	ctx := context.Background()
	now := time.Now().UnixMilli()

	uploadID := "upl_expired_staged"
	dataPath := filepath.Join(svc.uploadsDir, uploadID+".data")
	metaPath := filepath.Join(svc.uploadsDir, uploadID+".json")
	if err := os.WriteFile(dataPath, []byte("draft"), 0o600); err != nil {
		t.Fatalf("WriteFile data: %v", err)
	}
	if err := os.WriteFile(metaPath, []byte(`{"id":"`+uploadID+`","name":"draft.txt","size":5,"mime_type":"text/plain","created_at_unix_ms":`+strconv.FormatInt(now-10_000, 10)+`}`+"\n"), 0o600); err != nil {
		t.Fatalf("WriteFile meta: %v", err)
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
	if err := os.WriteFile(filepath.Join(svc.uploadsDir, uploadID+".json"), []byte(`{"id":"`+uploadID+`"}`+"\n"), 0o600); err != nil {
		t.Fatalf("WriteFile meta: %v", err)
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
