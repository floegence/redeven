package ai

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

func attachmentAdmissionContractForTest(t *testing.T, svc *Service, ownerHash, modelID string) threadstore.AttachmentAdmission {
	t.Helper()
	svc.mu.Lock()
	cfg := svc.cfg
	svc.mu.Unlock()
	resolved, err := svc.resolveRunModel(context.Background(), cfg, modelID, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	capability := svc.AttachmentCapabilities(context.Background(), resolved.ID)
	routes := make(map[string]string, len(capability.MediaTypes))
	for _, route := range capability.MediaTypes {
		routes[strings.ToLower(strings.TrimSpace(route.MediaType))] = route.Mode
	}
	return threadstore.AttachmentAdmission{
		OwnerUserHash: ownerHash, CapabilityRevision: capability.Revision,
		MaxCount: capability.MaxCount, MaxTurnBytes: capability.MaxTurnBytes,
		SupportsLongText: capability.SupportsLongText, Routes: routes,
	}
}

func saveTestUpload(t *testing.T, svc *Service, meta *session.Meta, body string, name string, mimeType string) *UploadResponse {
	t.Helper()
	owner, err := NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte(body))
	nameDigest := sha256.Sum256([]byte(name))
	out, err := svc.SaveUpload(context.Background(), SaveUploadRequest{
		Owner: owner, Reader: strings.NewReader(body), DisplayName: name, DeclaredMediaType: mimeType,
		Source: threadstore.UploadSourceFile, UploadRequestID: "req_" + name, DraftID: "draft_" + name,
		ExpectedContentSHA256: fmt.Sprintf("%x", digest[:]), ExpectedSizeBytes: int64(len(body)),
		DisplayNameSHA256: fmt.Sprintf("%x", nameDigest[:]),
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestStartupInterruptsReceivingUploadAttemptsWithoutRecoveryDelay(t *testing.T) {
	t.Parallel()
	svc := newTestService(t, nil)
	owner, err := NewUploadOwner("env_startup_upload", "user_startup_upload", "channel_startup_upload")
	if err != nil {
		t.Fatal(err)
	}
	body := []byte("renamed before crash")
	req := uploadRequestForTest(t, owner, "request_startup_interrupted", body, threadstore.UploadSourceFile)
	uploadID, err := newUploadID()
	if err != nil {
		t.Fatal(err)
	}
	attempt := threadstore.UploadAttemptRecord{
		EndpointID: owner.EndpointID, OwnerUserHash: owner.OwnerUserHash,
		UploadRequestID: req.UploadRequestID, RequestFingerprint: uploadRequestFingerprint(req, req.DisplayName),
		UploadID: uploadID, CreatedAtUnixMs: time.Now().Add(-time.Second).UnixMilli(),
	}
	if _, created, err := svc.threadsDB.ReserveUploadAttempt(t.Context(), attempt); err != nil || !created {
		t.Fatalf("ReserveUploadAttempt created=%v err=%v", created, err)
	}
	for _, suffix := range []string{".data", ".data.tmp"} {
		if err := os.WriteFile(filepath.Join(svc.uploadsDir, uploadID+suffix), body, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	count, err := svc.interruptUploadAttemptsFromPreviousProcess(t.Context())
	if err != nil || count != 1 {
		t.Fatalf("startup recovery count=%d err=%v", count, err)
	}
	for _, suffix := range []string{".data", ".data.tmp"} {
		if _, err := os.Stat(filepath.Join(svc.uploadsDir, uploadID+suffix)); !os.IsNotExist(err) {
			t.Fatalf("interrupted artifact %s remains: %v", suffix, err)
		}
	}
	reserved, created, err := svc.threadsDB.ReserveUploadAttempt(t.Context(), attempt)
	if err != nil || created || reserved.Status != threadstore.UploadAttemptFailed {
		t.Fatalf("interrupted attempt=%#v created=%v err=%v", reserved, created, err)
	}
}

func stageTestDraftAttachment(t *testing.T, svc *Service, meta *session.Meta, draftID string, body string, name string, mimeType string) (*UploadResponse, int64) {
	t.Helper()
	return stageTestDraftAttachmentValue(t, svc, meta, draftID, "", threadstore.ComposerDraftModeOrdinary, "", "", body, name, mimeType)
}

func stageTestAdmissionDraftAttachment(t *testing.T, svc *Service, meta *session.Meta, draftID string, turnID string, text string, modelID string, body string, name string, mimeType string) (*UploadResponse, int64) {
	t.Helper()
	return stageTestDraftAttachmentValue(t, svc, meta, draftID, text, threadstore.ComposerDraftModeAdmissionInFlight, turnID, modelID, body, name, mimeType)
}

func stageTestDraftAttachmentValue(t *testing.T, svc *Service, meta *session.Meta, draftID string, text string, mode string, turnID string, modelID string, body string, name string, mimeType string) (*UploadResponse, int64) {
	t.Helper()
	svc.mu.Lock()
	cfg := svc.cfg
	svc.mu.Unlock()
	resolvedModel, err := svc.resolveRunModel(context.Background(), cfg, modelID, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	modelID = resolvedModel.ID
	capability := svc.AttachmentCapabilities(context.Background(), modelID)
	owner, err := NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte(body))
	nameDigest := sha256.Sum256([]byte(name))
	upload, err := svc.SaveUpload(context.Background(), SaveUploadRequest{
		Owner: owner, Reader: strings.NewReader(body), DisplayName: name, DeclaredMediaType: mimeType,
		Source: threadstore.UploadSourceFile, UploadRequestID: "req_" + draftID + "_" + name, DraftID: draftID,
		ExpectedContentSHA256: fmt.Sprintf("%x", digest[:]), ExpectedSizeBytes: int64(len(body)),
		DisplayNameSHA256: fmt.Sprintf("%x", nameDigest[:]),
	})
	if err != nil {
		t.Fatal(err)
	}
	holderID := "test_surface_" + draftID
	lease, err := svc.AcquireComposerDraftLease(context.Background(), owner, draftID, holderID, false)
	if err != nil || lease.State != "owned" || lease.Draft.LeaseID == "" {
		t.Fatalf("AcquireComposerDraftLease: result=%#v err=%v", lease, err)
	}
	draftValue := map[string]any{
		"text": text, "mode": mode, "model_id": modelID, "capability_revision": capability.Revision,
		"attachments": []map[string]any{{
			"local_id": "local_" + upload.AttachmentID, "source": "file", "ordinal": 1,
			"staged": map[string]any{
				"attachment_id": upload.AttachmentID, "name": upload.Name, "media_type": upload.MimeType,
				"size_bytes": upload.SizeBytes, "digest_sha256": upload.ContentSHA256,
				"locator": upload.LogicalLocator, "source": "file", "capability_revision": capability.Revision,
			},
		}},
	}
	if mode == threadstore.ComposerDraftModeAdmissionInFlight {
		draftValue["admission_started"] = true
		draftValue["proposed_turn_id"] = turnID
	}
	value, err := json.Marshal(draftValue)
	if err != nil {
		t.Fatal(err)
	}
	draft, err := svc.MutateComposerDraft(context.Background(), owner, ComposerDraftMutationRequest{
		ScopeID: draftID, HolderID: holderID, LeaseID: lease.Draft.LeaseID,
		ExpectedRevision: lease.Draft.Revision, Value: value,
	})
	if err != nil {
		t.Fatalf("MutateComposerDraft: %v", err)
	}
	return upload, draft.Revision
}

func enqueueTestAdmissionDraftAttachment(t *testing.T, svc *Service, meta *session.Meta, threadID string, draftID string, turnID string, text string, body string, name string, mimeType string) (*UploadResponse, threadstore.QueuedTurn) {
	t.Helper()
	upload, revision := stageTestAdmissionDraftAttachment(t, svc, meta, draftID, turnID, text, "", body, name, mimeType)
	queued, _, err := svc.enqueueQueuedTurn(context.Background(), meta, SendUserTurnRequest{
		ThreadID: threadID, DraftID: draftID, ExpectedDraftRevision: &revision,
		Input: RunInput{TurnID: turnID, Text: text, Attachments: []RunAttachmentIn{{AttachmentID: upload.AttachmentID}}},
	})
	if err != nil {
		t.Fatalf("enqueueQueuedTurn from composer draft: %v", err)
	}
	return upload, queued
}

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

	svc := newSendTurnTestService(t)
	meta := testUploadMeta()
	ctx := context.Background()

	thread, err := svc.CreateThread(ctx, meta, "upload cleanup", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	upload, queued := enqueueTestAdmissionDraftAttachment(t, svc, meta, thread.ThreadID, thread.ThreadID, "turn_cleanup", "cleanup", "cleanup", "cleanup.txt", "text/plain")
	uploadID := parseUploadIDFromURL(upload.URL)
	if uploadID == "" {
		t.Fatalf("missing upload_id in URL %q", upload.URL)
	}
	if err := svc.threadsDB.CommitPendingTurnAdmission(ctx, meta.EndpointID, thread.ThreadID, queued.QueueID, queued.TurnID, []string{uploadID}, time.Now().UnixMilli()); err != nil {
		t.Fatalf("CommitPendingTurnAdmission: %v", err)
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

	svc := newSendTurnTestService(t)
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
	upload, queued := enqueueTestAdmissionDraftAttachment(t, svc, meta, threadA.ThreadID, threadA.ThreadID, "turn_shared", "shared", "shared", "shared.txt", "text/plain")
	uploadID := parseUploadIDFromURL(upload.URL)
	dataPath := filepath.Join(svc.uploadsDir, uploadID+".data")

	if err := svc.threadsDB.CommitPendingTurnAdmission(ctx, meta.EndpointID, threadA.ThreadID, queued.QueueID, queued.TurnID, []string{uploadID}, time.Now().UnixMilli()); err != nil {
		t.Fatalf("CommitPendingTurnAdmission: %v", err)
	}
	if err := svc.threadsDB.BindUploadsToRef(ctx, meta.EndpointID, threadB.ThreadID, threadstore.UploadRefKindThread, threadB.ThreadID, []string{uploadID}, time.Now().UnixMilli()); err != nil {
		t.Fatalf("BindUploadsToRef(%s): %v", threadB.ThreadID, err)
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

	svc := newSendTurnTestService(t)
	meta := testUploadMeta()
	ctx := context.Background()

	thread, err := svc.CreateThread(ctx, meta, "followup upload", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	upload, queued := enqueueTestAdmissionDraftAttachment(t, svc, meta, thread.ThreadID, thread.ThreadID, "turn_followup", "queued", "followup", "followup.txt", "text/plain")
	uploadID := parseUploadIDFromURL(upload.URL)

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
	upload, queued := enqueueTestAdmissionDraftAttachment(t, svc, meta, thread.ThreadID, thread.ThreadID, "turn_queued_missing", "inspect queued attachment", "queued", "queued.txt", "text/plain")
	uploadID := parseUploadIDFromURL(upload.URL)

	db, err := sql.Open("sqlite", "file:"+filepath.Join(svc.stateDir, "ai", "threads.sqlite")+"?_pragma=busy_timeout(3000)")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	defer func() { _ = db.Close() }()
	missingAttachments := `[{"attachment_id":"upl_aaaaaaaaaaaaaaaaaaaaaaaa"}]`
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

	owner, err := NewUploadOwner("env_other", "u_other", "ch_other")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.OpenUpload(ctx, owner, "draft_cleanup", uploadID); err == nil {
		t.Fatal("OpenUpload unexpectedly accepted a mismatched owner")
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
