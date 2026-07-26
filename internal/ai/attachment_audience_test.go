package ai

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

func insertAudienceUpload(t *testing.T, svc *Service, owner UploadOwner, uploadID string, body []byte, state string) *threadstore.UploadRecord {
	t.Helper()
	digest := sha256.Sum256(body)
	record := &threadstore.UploadRecord{
		UploadID: uploadID, EndpointID: owner.EndpointID,
		OwnerScopeKind: threadstore.UploadOwnerScopeUser, OwnerUserHash: owner.OwnerUserHash,
		StorageRelPath: uploadID + ".data", Name: uploadID + ".txt",
		DeclaredMediaType: "text/plain", DetectedMediaType: "text/plain", MimeType: "text/plain",
		SizeBytes: int64(len(body)), ContentSHA256: hex.EncodeToString(digest[:]),
		Source: threadstore.UploadSourceFile, State: state, CreatedAtUnixMs: 1,
	}
	if err := os.WriteFile(filepath.Join(svc.uploadsDir, record.StorageRelPath), body, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := svc.threadsDB.InsertUpload(context.Background(), *record); err != nil {
		t.Fatal(err)
	}
	return record
}

func requireUploadNotFound(t *testing.T, err error) {
	t.Helper()
	var uploadErr *UploadError
	if !errors.As(err, &uploadErr) || uploadErr.Code != UploadErrorNotFound {
		t.Fatalf("error=%v, want typed attachment_not_found", err)
	}
}

func requireUploadError(t *testing.T, err error, code string, retryable bool) {
	t.Helper()
	var uploadErr *UploadError
	if !errors.As(err, &uploadErr) || uploadErr.Code != code || uploadErr.Retryable != retryable {
		t.Fatalf("error=%v, want code=%q retryable=%v", err, code, retryable)
	}
}

func TestAttachmentAudienceRequiresExactDraftQueueAndCanonicalTurn(t *testing.T) {
	t.Parallel()

	svc := newTestService(t, nil)
	stopTestServiceMaintenance(t, svc)
	ctx := t.Context()
	owner, err := NewUploadOwner("env_audience", "user_owner", "channel_owner")
	if err != nil {
		t.Fatal(err)
	}
	other, err := NewUploadOwner("env_audience", "user_other", "channel_other")
	if err != nil {
		t.Fatal(err)
	}

	staged := insertAudienceUpload(t, svc, owner, "upl_aaaaaaaaaaaaaaaaaaaaaaaa", []byte("staged audience"), threadstore.UploadStateStaged)
	if err := svc.threadsDB.BindUserUploadsToDraft(ctx, owner.EndpointID, owner.OwnerUserHash, "draft_exact", []string{staged.UploadID}, 2); err != nil {
		t.Fatal(err)
	}
	if opened, err := svc.OpenUpload(ctx, owner, "draft_exact", staged.UploadID); err != nil || opened.Info.AttachmentID != staged.UploadID {
		t.Fatalf("exact staged audience opened=%#v err=%v", opened, err)
	}
	_, err = svc.OpenUpload(ctx, owner, "draft_other", staged.UploadID)
	requireUploadNotFound(t, err)
	_, err = svc.OpenUpload(ctx, other, "draft_exact", staged.UploadID)
	requireUploadNotFound(t, err)

	queued := insertAudienceUpload(t, svc, owner, "upl_bbbbbbbbbbbbbbbbbbbbbbbb", []byte("queued audience"), threadstore.UploadStateLive)
	if err := svc.threadsDB.BindUploadsToRef(ctx, owner.EndpointID, "thread_queue", threadstore.UploadRefKindQueuedTurn, "queue_exact", []string{queued.UploadID}, 2); err != nil {
		t.Fatal(err)
	}
	if opened, err := svc.OpenQueuedUpload(ctx, owner, "thread_queue", "queue_exact", queued.UploadID); err != nil || opened.Info.AttachmentID != queued.UploadID {
		stored, _ := svc.threadsDB.GetQueuedTurnOwnedUpload(ctx, owner.EndpointID, "thread_queue", "queue_exact", queued.UploadID)
		artifact, _ := os.ReadFile(filepath.Join(svc.uploadsDir, queued.StorageRelPath))
		t.Fatalf("exact queued audience opened=%#v err=%v stored=%#v artifact=%q", opened, err, stored, artifact)
	}
	for _, audience := range []struct {
		owner    UploadOwner
		threadID string
		queueID  string
	}{
		{owner: owner, threadID: "thread_other", queueID: "queue_exact"},
		{owner: owner, threadID: "thread_queue", queueID: "queue_other"},
		{owner: other, threadID: "thread_queue", queueID: "queue_exact"},
	} {
		_, err := svc.OpenQueuedUpload(ctx, audience.owner, audience.threadID, audience.queueID, queued.UploadID)
		requireUploadNotFound(t, err)
	}

	legacyQueuedID := "upl_llllllllllllllllllllllll"
	legacyQueuedBody := []byte("ownerless legacy queue")
	legacyQueued := threadstore.UploadRecord{
		UploadID: legacyQueuedID, EndpointID: owner.EndpointID,
		OwnerScopeKind: threadstore.UploadOwnerScopeLegacyThread,
		StorageRelPath: legacyQueuedID + ".data", Name: "legacy-queued.txt",
		DeclaredMediaType: "text/plain", DetectedMediaType: "text/plain", MimeType: "text/plain",
		SizeBytes: int64(len(legacyQueuedBody)), Source: threadstore.UploadSourceFile,
		State: threadstore.UploadStateLive, CreatedAtUnixMs: 1,
	}
	if err := os.WriteFile(filepath.Join(svc.uploadsDir, legacyQueued.StorageRelPath), legacyQueuedBody, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := svc.threadsDB.InsertUpload(ctx, legacyQueued); err != nil {
		t.Fatal(err)
	}
	if err := svc.threadsDB.BindUploadsToRef(ctx, owner.EndpointID, "thread_queue", threadstore.UploadRefKindQueuedTurn, "queue_legacy", []string{legacyQueuedID}, 2); err != nil {
		t.Fatal(err)
	}
	for _, candidate := range []UploadOwner{owner, other} {
		_, err := svc.OpenQueuedUpload(ctx, candidate, "thread_queue", "queue_legacy", legacyQueuedID)
		requireUploadNotFound(t, err)
	}

	canonical := insertAudienceUpload(t, svc, owner, "upl_cccccccccccccccccccccccc", []byte("canonical audience"), threadstore.UploadStateLive)
	if err := svc.threadsDB.BindUploadsToRef(ctx, owner.EndpointID, "thread_canonical", threadstore.UploadRefKindThread, "thread_canonical", []string{canonical.UploadID}, 2); err != nil {
		t.Fatal(err)
	}
	membership := CanonicalAttachmentMembership{
		ThreadID: "thread_canonical", TurnID: "turn_exact", AttachmentID: canonical.UploadID,
		ResourceRef: immutableAttachmentRefForTest(t, canonical.UploadID, []byte("canonical audience")), ContentSHA256: canonical.ContentSHA256,
		Name: canonical.Name, DetectedMediaType: canonical.DetectedMediaType, SizeBytes: canonical.SizeBytes,
	}
	if opened, err := svc.OpenLiveUpload(ctx, owner, membership.ThreadID, membership.TurnID, canonical.UploadID, &fakeLiveAttachmentAuthority{membership: membership}); err != nil || opened.Info.AttachmentID != canonical.UploadID {
		t.Fatalf("exact canonical audience opened=%#v err=%v", opened, err)
	}
	_, err = svc.OpenLiveUpload(ctx, owner, membership.ThreadID, membership.TurnID, canonical.UploadID, &fakeLiveAttachmentAuthority{err: sql.ErrNoRows})
	requireUploadNotFound(t, err)
	_, err = svc.OpenLiveUpload(ctx, owner, membership.ThreadID, membership.TurnID, canonical.UploadID, &fakeLiveAttachmentAuthority{err: errors.New("canonical authority corrupt")})
	requireUploadError(t, err, UploadErrorStoreUnavailable, true)
	wrongTurn := membership
	wrongTurn.TurnID = "turn_other"
	_, err = svc.OpenLiveUpload(ctx, owner, membership.ThreadID, membership.TurnID, canonical.UploadID, &fakeLiveAttachmentAuthority{membership: wrongTurn})
	requireUploadError(t, err, UploadErrorIntegrityMismatch, false)
	wrongThread := membership
	wrongThread.ThreadID = "thread_other"
	_, err = svc.OpenLiveUpload(ctx, owner, "thread_other", membership.TurnID, canonical.UploadID, &fakeLiveAttachmentAuthority{membership: wrongThread})
	requireUploadNotFound(t, err)
	_, err = svc.OpenLiveUpload(ctx, other, membership.ThreadID, membership.TurnID, canonical.UploadID, &fakeLiveAttachmentAuthority{membership: membership})
	requireUploadNotFound(t, err)

	svc.floretReads = &floretReadCapabilities{thread: func(context.Context, flruntime.ThreadID) (floretThreadReadHost, error) {
		return nil, errors.New("canonical store corrupt")
	}}
	_, err = svc.OpenCanonicalLiveAttachmentForTurn(ctx, owner, membership.ThreadID, membership.TurnID, canonical.UploadID)
	requireUploadError(t, err, UploadErrorStoreUnavailable, true)
}
