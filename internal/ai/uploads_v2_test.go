package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

type fakeLiveAttachmentAuthority struct {
	membership CanonicalAttachmentMembership
	err        error
	calls      int
}

func (f *fakeLiveAttachmentAuthority) ReadCanonicalAttachmentMembership(_ context.Context, threadID string, turnID string, attachmentID string) (CanonicalAttachmentMembership, error) {
	f.calls++
	return f.membership, f.err
}

func uploadRequestForTest(t *testing.T, owner UploadOwner, requestID string, body []byte, source string) SaveUploadRequest {
	t.Helper()
	digest := sha256.Sum256(body)
	nameDigest := sha256.Sum256([]byte("notes.txt"))
	return SaveUploadRequest{
		Owner: owner, Reader: bytes.NewReader(body), DisplayName: "notes.txt", DeclaredMediaType: "text/plain; charset=UTF-8",
		Source: source, UploadRequestID: requestID, DraftID: requestID, ExpectedContentSHA256: fmt.Sprintf("%x", digest[:]),
		ExpectedSizeBytes: int64(len(body)), DisplayNameSHA256: fmt.Sprintf("%x", nameDigest[:]), MaxBytes: 10 << 20,
	}
}

func TestSaveUploadPersistsImmutableTextMetadataAndReplaysIdempotently(t *testing.T) {
	t.Parallel()
	svc := newTestService(t, nil)
	owner, err := NewUploadOwner("env_test", "user_test", "channel_test")
	if err != nil {
		t.Fatal(err)
	}
	body := []byte("a\r\nb\r")
	req := uploadRequestForTest(t, owner, "request_text_metadata", body, threadstore.UploadSourceLongText)
	first, err := svc.SaveUpload(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if first.AttachmentID == "" || first.SizeBytes != int64(len(body)) || first.DetectedMediaType != "text/plain; charset=utf-8" {
		t.Fatalf("upload response=%#v", first)
	}
	if first.UnicodeCodePoints == nil || *first.UnicodeCodePoints != 5 || first.LogicalLineCount == nil || *first.LogicalLineCount != 3 {
		t.Fatalf("text stats points=%v lines=%v", first.UnicodeCodePoints, first.LogicalLineCount)
	}
	req.Reader = bytes.NewReader(body)
	replayed, err := svc.SaveUpload(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if replayed.AttachmentID != first.AttachmentID || replayed.ContentSHA256 != first.ContentSHA256 {
		t.Fatalf("replayed=%#v first=%#v", replayed, first)
	}
	rec, err := svc.threadsDB.GetUserOwnedUpload(context.Background(), owner.EndpointID, owner.OwnerUserHash, first.AttachmentID)
	if err != nil {
		t.Fatal(err)
	}
	if rec.OwnerScopeKind != threadstore.UploadOwnerScopeUser || rec.OwnerUserHash != owner.OwnerUserHash || rec.Source != threadstore.UploadSourceLongText {
		t.Fatalf("record=%#v", rec)
	}
}

func TestSaveUploadRecoversFinalArtifactAfterMetadataCommitInterruption(t *testing.T) {
	t.Parallel()
	svc := newTestService(t, nil)
	owner, err := NewUploadOwner("env_recover_upload", "user_recover_upload", "channel_recover_upload")
	if err != nil {
		t.Fatal(err)
	}
	body := []byte("durable interrupted upload\n")
	req := uploadRequestForTest(t, owner, "request_interrupted_final", body, threadstore.UploadSourceLongText)
	uploadID, err := newUploadID()
	if err != nil {
		t.Fatal(err)
	}
	attempt := threadstore.UploadAttemptRecord{
		EndpointID: owner.EndpointID, OwnerUserHash: owner.OwnerUserHash,
		UploadRequestID: req.UploadRequestID, RequestFingerprint: uploadRequestFingerprint(req, req.DisplayName),
		UploadID: uploadID, CreatedAtUnixMs: time.Now().UnixMilli(),
	}
	if _, created, err := svc.threadsDB.ReserveUploadAttempt(t.Context(), attempt); err != nil || !created {
		t.Fatalf("ReserveUploadAttempt created=%v err=%v", created, err)
	}
	if err := os.WriteFile(filepath.Join(svc.uploadsDir, uploadID+".data"), body, 0o600); err != nil {
		t.Fatal(err)
	}
	req.Reader = bytes.NewReader(nil)
	recovered, err := svc.SaveUpload(t.Context(), req)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.AttachmentID != uploadID || recovered.ContentSHA256 != req.ExpectedContentSHA256 || recovered.SizeBytes != int64(len(body)) {
		t.Fatalf("recovered upload=%#v", recovered)
	}
	if complete, err := svc.threadsDB.HasCompletedOwnedUploadAttempt(t.Context(), owner.EndpointID, owner.OwnerUserHash, uploadID); err != nil || !complete {
		t.Fatalf("completed attempt=%v err=%v", complete, err)
	}
}

func TestSaveUploadFailsCorruptInterruptedFinalAndAllowsImmediateRetry(t *testing.T) {
	t.Parallel()
	svc := newTestService(t, nil)
	owner, _ := NewUploadOwner("env_retry_upload", "user_retry_upload", "channel_retry_upload")
	body := []byte("expected bytes")
	req := uploadRequestForTest(t, owner, "request_corrupt_final", body, threadstore.UploadSourceFile)
	uploadID, err := newUploadID()
	if err != nil {
		t.Fatal(err)
	}
	attempt := threadstore.UploadAttemptRecord{
		EndpointID: owner.EndpointID, OwnerUserHash: owner.OwnerUserHash,
		UploadRequestID: req.UploadRequestID, RequestFingerprint: uploadRequestFingerprint(req, req.DisplayName),
		UploadID: uploadID, CreatedAtUnixMs: time.Now().UnixMilli(),
	}
	if _, created, err := svc.threadsDB.ReserveUploadAttempt(t.Context(), attempt); err != nil || !created {
		t.Fatalf("ReserveUploadAttempt created=%v err=%v", created, err)
	}
	if err := os.WriteFile(filepath.Join(svc.uploadsDir, uploadID+".data"), []byte("corrupt"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveUpload(t.Context(), req); err == nil {
		t.Fatal("corrupt interrupted final unexpectedly recovered")
	} else {
		var uploadErr *UploadError
		if !errors.As(err, &uploadErr) || uploadErr.Code != UploadErrorIntegrityMismatch || !uploadErr.Retryable {
			t.Fatalf("recovery error=%#v", err)
		}
	}
	req.Reader = bytes.NewReader(body)
	retried, err := svc.SaveUpload(t.Context(), req)
	if err != nil {
		t.Fatal(err)
	}
	if retried.AttachmentID != uploadID || retried.ContentSHA256 != req.ExpectedContentSHA256 {
		t.Fatalf("retried upload=%#v", retried)
	}
}

func TestSaveUploadRejectsIdempotencyConflictAndInvalidLongText(t *testing.T) {
	t.Parallel()
	svc := newTestService(t, nil)
	owner, _ := NewUploadOwner("env_test", "user_test", "channel_test")
	first := uploadRequestForTest(t, owner, "request_conflict", []byte("first"), threadstore.UploadSourceFile)
	if _, err := svc.SaveUpload(context.Background(), first); err != nil {
		t.Fatal(err)
	}
	second := uploadRequestForTest(t, owner, "request_conflict", []byte("second"), threadstore.UploadSourceFile)
	if _, err := svc.SaveUpload(context.Background(), second); err == nil {
		t.Fatal("expected idempotency conflict")
	} else {
		var uploadErr *UploadError
		if !errors.As(err, &uploadErr) || uploadErr.Code != UploadErrorIdempotencyConflict {
			t.Fatalf("error=%v", err)
		}
	}
	invalid := uploadRequestForTest(t, owner, "request_invalid_utf8", []byte{0xff, 0xfe}, threadstore.UploadSourceLongText)
	if _, err := svc.SaveUpload(context.Background(), invalid); err == nil {
		t.Fatal("expected invalid text error")
	} else {
		var uploadErr *UploadError
		if !errors.As(err, &uploadErr) || uploadErr.Code != UploadErrorInvalidTextEncoding {
			t.Fatalf("error=%v", err)
		}
	}
}

func TestSaveUploadCanonicalizesActiveUTF8TextAsPlainText(t *testing.T) {
	t.Parallel()
	svc := newTestService(t, nil)
	owner, _ := NewUploadOwner("env_active_text", "user_active_text", "channel_active_text")
	body := []byte(`<!doctype html><script>globalThis.compromised = true</script>`)
	req := uploadRequestForTest(t, owner, "request_active_text", body, threadstore.UploadSourceFile)
	req.DeclaredMediaType = "text/html; charset=utf-8"
	upload, err := svc.SaveUpload(t.Context(), req)
	if err != nil {
		t.Fatal(err)
	}
	if upload.DetectedMediaType != "text/plain; charset=utf-8" || upload.MimeType != "text/plain; charset=utf-8" {
		t.Fatalf("active text media type=(%q,%q), want canonical plain text", upload.DetectedMediaType, upload.MimeType)
	}
}

func TestStagedUploadOwnerDraftReadAndDeleteBoundaries(t *testing.T) {
	t.Parallel()
	svc := newTestService(t, nil)
	owner, _ := NewUploadOwner("env_test", "user_owner", "channel_owner")
	other, _ := NewUploadOwner("env_test", "user_other", "channel_other")
	body := []byte("restorable long text")
	upload, err := svc.SaveUpload(context.Background(), uploadRequestForTest(t, owner, "request_restore", body, threadstore.UploadSourceLongText))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.OpenUpload(context.Background(), other, "draft_other", upload.AttachmentID); err == nil {
		t.Fatal("other user opened staged upload")
	}
	if _, err := svc.ReadStagedLongText(context.Background(), owner, "draft_1", upload.AttachmentID); err == nil {
		t.Fatal("long text read succeeded without a draft ref")
	}
	restored, err := svc.ReadStagedLongText(context.Background(), owner, "request_restore", upload.AttachmentID)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Text != string(body) || restored.ContentSHA256 != upload.ContentSHA256 {
		t.Fatalf("restored=%#v", restored)
	}
	if err := svc.DeleteStagedUpload(context.Background(), owner, upload.AttachmentID); err == nil {
		t.Fatal("delete succeeded while draft ref remained")
	}
	if err := svc.DeleteDraftUpload(context.Background(), owner, "request_restore", upload.AttachmentID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(svc.uploadsDir, upload.AttachmentID+".data")); !os.IsNotExist(err) {
		t.Fatalf("artifact error=%v", err)
	}
}

func TestOpenLiveUploadRequiresFreshExactCanonicalMembershipAndThreadClaim(t *testing.T) {
	t.Parallel()
	svc := newSendTurnTestService(t)
	owner, _ := NewUploadOwner("env_live", "user_owner", "channel_owner")
	other, _ := NewUploadOwner("env_live", "user_other", "channel_other")
	meta := &session.Meta{
		EndpointID: owner.EndpointID, UserPublicID: "user_owner", ChannelID: "channel_owner",
		CanRead: true, CanWrite: true, CanExecute: true,
	}
	body := []byte("canonical body")
	upload, draftRevision := stageTestAdmissionDraftAttachment(
		t, svc, meta, "thread_live", "turn_live", "", "",
		string(body), "notes.txt", "text/plain; charset=UTF-8",
	)
	if err := svc.threadsDB.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{ThreadID: "thread_live", EndpointID: owner.EndpointID, PermissionType: "approval_required"}); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := svc.threadsDB.CreateFollowupFromComposerDraft(context.Background(), threadstore.QueuedTurn{
		QueueID: "queue_live", EndpointID: owner.EndpointID, ThreadID: "thread_live", ChannelID: owner.ChannelID,
		Lane: threadstore.FollowupLaneQueued, TurnID: "turn_live", RunID: "run_live",
		AttachmentsJSON: `[{"attachment_id":"` + upload.AttachmentID + `"}]`, CreatedAtUnixMs: 1,
	}, []string{upload.AttachmentID}, 1, threadstore.ComposerDraftAdmission{
		OwnerUserHash: owner.OwnerUserHash, DraftID: "thread_live", ExpectedRevision: draftRevision,
		Attachment: attachmentAdmissionContractForTest(t, svc, owner.OwnerUserHash, ""),
	}); err != nil {
		t.Fatal(err)
	}
	if err := svc.threadsDB.BindUploadsToRef(context.Background(), owner.EndpointID, "thread_live", threadstore.UploadRefKindThread, "thread_live", []string{upload.AttachmentID}, 1); err != nil {
		t.Fatal(err)
	}
	membership := CanonicalAttachmentMembership{
		ThreadID: "thread_live", TurnID: "turn_live", AttachmentID: upload.AttachmentID,
		ResourceRef:   floretUploadResourcePrefix + upload.AttachmentID + floretUploadDigestMarker + upload.ContentSHA256,
		ContentSHA256: upload.ContentSHA256, Name: upload.DisplayName,
		DetectedMediaType: upload.DetectedMediaType, SizeBytes: upload.SizeBytes,
	}
	authority := &fakeLiveAttachmentAuthority{membership: membership}
	opened, err := svc.OpenLiveUpload(context.Background(), owner, "thread_live", "turn_live", upload.AttachmentID, authority)
	if err != nil || opened == nil || authority.calls != 1 {
		t.Fatalf("opened=%#v calls=%d err=%v", opened, authority.calls, err)
	}
	wrongTurn := &fakeLiveAttachmentAuthority{membership: membership}
	wrongTurn.membership.TurnID = "turn_other"
	if _, err := svc.OpenLiveUpload(context.Background(), owner, "thread_live", "turn_live", upload.AttachmentID, wrongTurn); err == nil {
		t.Fatal("live read accepted a mismatched canonical turn")
	}
	otherAuthority := &fakeLiveAttachmentAuthority{membership: membership}
	if _, err := svc.OpenLiveUpload(context.Background(), other, "thread_live", "turn_live", upload.AttachmentID, otherAuthority); err == nil {
		t.Fatal("live read accepted a different owner")
	}
	withoutClaim := uploadRequestForTest(t, owner, "request_live_unclaimed", []byte("unclaimed"), threadstore.UploadSourceFile)
	unclaimed, err := svc.SaveUpload(context.Background(), withoutClaim)
	if err != nil {
		t.Fatal(err)
	}
	unclaimedAuthority := &fakeLiveAttachmentAuthority{membership: CanonicalAttachmentMembership{
		ThreadID: "thread_live", TurnID: "turn_unclaimed", AttachmentID: unclaimed.AttachmentID,
		ResourceRef: floretUploadResourcePrefix + unclaimed.AttachmentID + floretUploadDigestMarker + unclaimed.ContentSHA256, ContentSHA256: unclaimed.ContentSHA256,
		Name: unclaimed.DisplayName, DetectedMediaType: unclaimed.DetectedMediaType, SizeBytes: unclaimed.SizeBytes,
	}}
	if _, err := svc.OpenLiveUpload(context.Background(), owner, "thread_live", "turn_unclaimed", unclaimed.AttachmentID, unclaimedAuthority); err == nil {
		t.Fatal("live read accepted canonical membership without a product retention claim")
	}
	if err := os.WriteFile(opened.FilePath, []byte("tampered body"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.OpenLiveUpload(context.Background(), owner, "thread_live", "turn_live", upload.AttachmentID, authority); err == nil {
		t.Fatal("live read accepted tampered resource bytes")
	}
}

func TestOpenLiveUploadValidatesLegacyThreadArtifactAgainstCanonicalDigest(t *testing.T) {
	t.Parallel()
	svc := newTestService(t, nil)
	stopTestServiceMaintenance(t, svc)
	owner, _ := NewUploadOwner("env_legacy_live", "user_owner", "channel_owner")
	body := []byte("legacy artifact")
	digest := sha256.Sum256(body)
	uploadID, err := newUploadID()
	if err != nil {
		t.Fatal(err)
	}
	storageName := uploadID + ".data"
	if err := os.WriteFile(filepath.Join(svc.uploadsDir, storageName), body, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := svc.threadsDB.InsertUpload(context.Background(), threadstore.UploadRecord{
		UploadID: uploadID, EndpointID: owner.EndpointID,
		OwnerScopeKind: threadstore.UploadOwnerScopeLegacyThread,
		StorageRelPath: storageName, Name: "legacy.txt",
		DeclaredMediaType: "text/plain", DetectedMediaType: "text/plain", MimeType: "text/plain",
		SizeBytes: int64(len(body)), Source: threadstore.UploadSourceFile, State: threadstore.UploadStateLive,
		CreatedAtUnixMs: 1, ClaimedAtUnixMs: 1,
	}); err != nil {
		t.Fatal(err)
	}
	if err := svc.threadsDB.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{ThreadID: "thread_legacy_live", EndpointID: owner.EndpointID, PermissionType: "approval_required"}); err != nil {
		t.Fatal(err)
	}
	if err := svc.threadsDB.BindUploadsToRef(context.Background(), owner.EndpointID, "thread_legacy_live", threadstore.UploadRefKindThread, "thread_legacy_live", []string{uploadID}, 1); err != nil {
		t.Fatal(err)
	}
	authority := &fakeLiveAttachmentAuthority{membership: CanonicalAttachmentMembership{
		ThreadID: "thread_legacy_live", TurnID: "turn_legacy_live", AttachmentID: uploadID,
		ResourceRef: legacyFloretUploadResourcePrefix + uploadID, Name: "legacy.txt",
		DetectedMediaType: "text/plain", SizeBytes: int64(len(body)),
	}}
	rec, err := svc.threadsDB.GetThreadOwnedUpload(context.Background(), owner.EndpointID, "thread_legacy_live", uploadID)
	if err != nil {
		t.Fatal(err)
	}
	if err := verifyUploadArtifactAgainstDigest(rec, filepath.Join(svc.uploadsDir, storageName), fmt.Sprintf("%x", digest[:])); err != nil {
		t.Fatalf("verify intact legacy fixture %#v: %v", rec, err)
	}
	wrongMembership := authority.membership
	wrongMembership.TurnID = "turn_other"
	if _, err := svc.OpenLiveUpload(context.Background(), owner, "thread_legacy_live", "turn_legacy_live", uploadID, &fakeLiveAttachmentAuthority{membership: wrongMembership}); err == nil {
		t.Fatal("legacy metadata was opened without exact canonical membership")
	}
	unsealed, err := svc.threadsDB.GetThreadOwnedUpload(context.Background(), owner.EndpointID, "thread_legacy_live", uploadID)
	if err != nil || unsealed.ContentSHA256 != "" || unsealed.UnicodeCodePoints != nil || unsealed.LogicalLineCount != nil {
		t.Fatalf("failed canonical membership partially sealed legacy metadata: %#v err=%v", unsealed, err)
	}
	opened, err := svc.OpenLiveUpload(context.Background(), owner, "thread_legacy_live", "turn_legacy_live", uploadID, authority)
	if err != nil {
		t.Fatalf("open intact legacy attachment: %v", err)
	}
	if opened.Info == nil || opened.Info.ContentSHA256 != fmt.Sprintf("%x", digest[:]) ||
		opened.Info.UnicodeCodePoints == nil || *opened.Info.UnicodeCodePoints != int64(len(body)) ||
		opened.Info.LogicalLineCount == nil || *opened.Info.LogicalLineCount != 1 {
		t.Fatalf("resolved legacy text metadata=%#v", opened.Info)
	}
	sealed, err := svc.threadsDB.GetThreadOwnedUpload(context.Background(), owner.EndpointID, "thread_legacy_live", uploadID)
	if err != nil || sealed.ContentSHA256 != fmt.Sprintf("%x", digest[:]) ||
		sealed.UnicodeCodePoints == nil || *sealed.UnicodeCodePoints != int64(len(body)) ||
		sealed.LogicalLineCount == nil || *sealed.LogicalLineCount != 1 {
		t.Fatalf("sealed legacy record=%#v err=%v", sealed, err)
	}
	tampered := []byte("tampered bytes!")
	if len(tampered) != len(body) {
		t.Fatalf("test fixture size mismatch: tampered=%d original=%d", len(tampered), len(body))
	}
	if err := os.WriteFile(filepath.Join(svc.uploadsDir, storageName), tampered, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.OpenLiveUpload(context.Background(), owner, "thread_legacy_live", "turn_legacy_live", uploadID, authority); err == nil {
		t.Fatal("live read accepted same-size tampering of a legacy attachment")
	} else {
		var uploadErr *UploadError
		if !errors.As(err, &uploadErr) || uploadErr.Code != UploadErrorIntegrityMismatch {
			t.Fatalf("same-size tamper error=%v", err)
		}
	}
}

func TestOpenLiveUploadRejectsInvalidLegacyTextWithoutPartialSeal(t *testing.T) {
	t.Parallel()
	svc := newTestService(t, nil)
	stopTestServiceMaintenance(t, svc)
	owner, _ := NewUploadOwner("env_legacy_invalid_text", "user_owner", "channel_owner")
	body := []byte{0xff, 0xfe, 'x'}
	const uploadID = "upl_iiiiiiiiiiiiiiiiiiiiiiii"
	storageName := uploadID + ".data"
	if err := os.WriteFile(filepath.Join(svc.uploadsDir, storageName), body, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := svc.threadsDB.InsertUpload(context.Background(), threadstore.UploadRecord{
		UploadID: uploadID, EndpointID: owner.EndpointID,
		OwnerScopeKind: threadstore.UploadOwnerScopeLegacyThread,
		StorageRelPath: storageName, Name: "invalid.txt",
		DeclaredMediaType: "text/plain", DetectedMediaType: "text/plain", MimeType: "text/plain",
		SizeBytes: int64(len(body)), Source: threadstore.UploadSourceFile, State: threadstore.UploadStateLive,
		CreatedAtUnixMs: 1, ClaimedAtUnixMs: 1,
	}); err != nil {
		t.Fatal(err)
	}
	if err := svc.threadsDB.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{
		ThreadID: "thread_legacy_invalid_text", EndpointID: owner.EndpointID, PermissionType: "approval_required",
	}); err != nil {
		t.Fatal(err)
	}
	if err := svc.threadsDB.BindUploadsToRef(context.Background(), owner.EndpointID, "thread_legacy_invalid_text", threadstore.UploadRefKindThread, "thread_legacy_invalid_text", []string{uploadID}, 1); err != nil {
		t.Fatal(err)
	}
	authority := &fakeLiveAttachmentAuthority{membership: CanonicalAttachmentMembership{
		ThreadID: "thread_legacy_invalid_text", TurnID: "turn_legacy_invalid_text", AttachmentID: uploadID,
		ResourceRef: legacyFloretUploadResourcePrefix + uploadID, Name: "invalid.txt",
		DetectedMediaType: "text/plain", SizeBytes: int64(len(body)),
	}}
	if _, err := svc.OpenLiveUpload(context.Background(), owner, authority.membership.ThreadID, authority.membership.TurnID, uploadID, authority); err == nil {
		t.Fatal("invalid legacy text was opened")
	} else {
		var uploadErr *UploadError
		if !errors.As(err, &uploadErr) || uploadErr.Code != UploadErrorIntegrityMismatch {
			t.Fatalf("invalid legacy text error=%v", err)
		}
	}
	stored, err := svc.threadsDB.GetThreadOwnedUpload(context.Background(), owner.EndpointID, authority.membership.ThreadID, uploadID)
	if err != nil || stored.ContentSHA256 != "" || stored.UnicodeCodePoints != nil || stored.LogicalLineCount != nil {
		t.Fatalf("invalid legacy text was partially sealed: %#v err=%v", stored, err)
	}
}
