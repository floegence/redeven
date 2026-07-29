package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	flruntime "github.com/floegence/floret/v2/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

func TestFloretLiveAttachmentAuthorityRecognizesExactLegacyCanonicalMembership(t *testing.T) {
	t.Parallel()
	const attachmentID = "upl_llllllllllllllllllllllll"
	legacyRef := legacyFloretUploadResourcePrefix + attachmentID
	authority := floretLiveAttachmentAuthority{threadID: "thread_legacy", host: attachmentAuthorityReadHost{page: flruntime.ThreadTurnsPage{
		ThreadID: "thread_legacy",
		Turns: []flruntime.ThreadTurnSnapshot{
			{TurnID: "turn_other", UserAttachments: []flruntime.MessageAttachment{{ResourceRef: legacyRef, Name: "wrong.txt", MIMEType: "text/plain", SizeBytes: 5}}},
			{TurnID: "turn_exact", UserAttachments: []flruntime.MessageAttachment{{ResourceRef: legacyRef, Name: "legacy.txt", MIMEType: "text/plain", SizeBytes: 6}}},
		},
	}}}

	membership, err := authority.ReadCanonicalAttachmentMembership(context.Background(), "thread_legacy", "turn_exact", attachmentID)
	if err != nil {
		t.Fatal(err)
	}
	if membership.TurnID != "turn_exact" || membership.ResourceRef != legacyRef || membership.ContentSHA256 != "" || membership.Name != "legacy.txt" {
		t.Fatalf("legacy membership=%#v", membership)
	}
}

func TestLegacyQueuedAttachmentRequiresExactClaimAndFreezesDigest(t *testing.T) {
	r, store, uploadsDir := newFloretAttachmentTestRun(t)
	const uploadID = "upl_qqqqqqqqqqqqqqqqqqqqqqqq"
	body := []byte("legacy queued body")
	storageName := uploadID + ".data"
	if err := os.WriteFile(filepath.Join(uploadsDir, storageName), body, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := store.InsertUpload(context.Background(), threadstore.UploadRecord{
		UploadID: uploadID, EndpointID: r.endpointID,
		OwnerScopeKind: threadstore.UploadOwnerScopeLegacyThread,
		StorageRelPath: storageName, Name: "legacy.txt",
		DeclaredMediaType: "text/plain", DetectedMediaType: "text/plain", MimeType: "text/plain",
		SizeBytes: int64(len(body)), Source: threadstore.UploadSourceFile, State: threadstore.UploadStateLive,
		CreatedAtUnixMs: 1, ClaimedAtUnixMs: 1,
	}); err != nil {
		t.Fatal(err)
	}
	const commandID = "queue_legacy_attachment"
	if _, _, _, err := store.CreateFollowupWithUploadRefs(context.Background(), threadstore.QueuedTurn{
		QueueID: commandID, EndpointID: r.endpointID, ThreadID: r.threadID, ChannelID: "channel_legacy_attachment",
		Lane: threadstore.FollowupLaneQueued, TurnID: r.turnID, RunID: r.id, TextContent: "inspect legacy attachment",
	}, []string{uploadID}, time.Now().UnixMilli()); err != nil {
		t.Fatal(err)
	}
	r.setPendingTurnCommand(commandID)

	input, err := r.floretTurnInput(context.Background(), RunInput{Attachments: []RunAttachmentIn{{AttachmentID: uploadID}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(body)
	digest := hex.EncodeToString(sum[:])
	wantRef, err := immutableFloretUploadResourceRef(uploadID, digest)
	if err != nil {
		t.Fatal(err)
	}
	if len(input.Attachments) != 1 || input.Attachments[0].ResourceRef != wantRef {
		t.Fatalf("canonical legacy queued input=%#v, want resource %q", input, wantRef)
	}

	r.setPendingTurnCommand("queue_without_claim")
	if _, err := r.floretTurnInput(context.Background(), RunInput{Attachments: []RunAttachmentIn{{AttachmentID: uploadID}}}, nil); err == nil || !strings.Contains(err.Error(), "load attachment") {
		t.Fatalf("missing exact queued claim error=%v", err)
	}

	r.setPendingTurnCommand(commandID)
	tampered := append([]byte(nil), body...)
	tampered[0] ^= 1
	if err := os.WriteFile(filepath.Join(uploadsDir, storageName), tampered, 0o600); err != nil {
		t.Fatal(err)
	}
	provider := newFloretProviderAdapter(nil, DesktopModelSourceProviderType, "legacy-test", ProviderControls{}, TurnBudgets{}, "",
		withFloretAttachmentResolver(nil, false, true))
	if _, _, err := r.preflightFloretTurnAttachments(context.Background(), input, provider); err == nil || !strings.Contains(err.Error(), "content differs") {
		t.Fatalf("same-size queued artifact tamper error=%v", err)
	}
}

func TestLegacyCanonicalTextSupportsToolOnlyLocatorAndContinuationWithoutHistoryRewrite(t *testing.T) {
	r, store, uploadsDir := newFloretAttachmentTestRun(t)
	const uploadID = "upl_mmmmmmmmmmmmmmmmmmmmmmmm"
	body := []byte("alpha\r\n世界\nomega\nlast")
	storageName := uploadID + ".data"
	if err := os.WriteFile(filepath.Join(uploadsDir, storageName), body, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := store.InsertUpload(context.Background(), threadstore.UploadRecord{
		UploadID: uploadID, EndpointID: r.endpointID,
		OwnerScopeKind: threadstore.UploadOwnerScopeLegacyThread,
		StorageRelPath: storageName, Name: "legacy-notes.txt",
		DeclaredMediaType: "text/plain", DetectedMediaType: "text/plain", MimeType: "text/plain",
		SizeBytes: int64(len(body)), Source: threadstore.UploadSourceFile, State: threadstore.UploadStateLive,
		CreatedAtUnixMs: 1, ClaimedAtUnixMs: 1,
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.BindUploadsToRef(context.Background(), r.endpointID, r.threadID, threadstore.UploadRefKindThread, r.threadID, []string{uploadID}, 1); err != nil {
		t.Fatal(err)
	}

	legacyRef := legacyFloretUploadResourcePrefix + uploadID
	canonicalPage := flruntime.ThreadTurnsPage{
		ThreadID: flruntime.ThreadID(r.threadID),
		Turns: []flruntime.ThreadTurnSnapshot{{
			TurnID: flruntime.TurnID(r.turnID),
			UserAttachments: []flruntime.MessageAttachment{{
				ResourceRef: legacyRef, Name: "legacy-notes.txt", MIMEType: "text/plain", SizeBytes: int64(len(body)),
			}},
		}},
	}
	svc := &Service{threadsDB: store, uploadsDir: uploadsDir}
	svc.floretReads = &floretReadCapabilities{thread: func(context.Context, flruntime.ThreadID) (floretThreadReadHost, error) {
		return attachmentAuthorityReadHost{page: canonicalPage}, nil
	}}
	r.host.openLiveAttachment = func(ctx context.Context, owner UploadOwner, attachmentID string) (openedCanonicalAttachment, error) {
		return svc.openCanonicalLiveAttachment(ctx, owner, r.threadID, attachmentID)
	}

	canonicalAttachment := canonicalPage.Turns[0].UserAttachments[0]
	toolOnlyProvider := &floretProviderAdapter{supportsAttachmentToolRead: true}
	if !attachmentUsesToolRead(toolOnlyProvider, canonicalAttachment) {
		t.Fatal("legacy canonical text without historical TextStats did not select tool-read")
	}
	manifest, err := r.resolveFloretAttachmentManifest(context.Background(), canonicalAttachment)
	if err != nil {
		t.Fatalf("resolve legacy tool-only manifest: %v", err)
	}
	locator := logicalAttachmentLocator(uploadID, canonicalAttachment.Name)
	if manifest.Type != "attachment_manifest" || !strings.Contains(manifest.Text, locator) {
		t.Fatalf("legacy manifest=%#v, want locator %q", manifest, locator)
	}

	meta := &session.Meta{
		EndpointID: r.endpointID, UserPublicID: r.userPublicID, ChannelID: r.channelID, CanRead: true,
	}
	args := attachmentReadArgs{Locator: locator, MaxBytes: 7, MaxLines: 1}
	var rebuilt strings.Builder
	for page := 0; page < 20; page++ {
		result, err := r.toolAttachmentRead(context.Background(), meta, args)
		if err != nil {
			t.Fatalf("read legacy attachment page %d: %v", page, err)
		}
		if result["locator"] != locator {
			t.Fatalf("page %d locator=%#v", page, result["locator"])
		}
		rebuilt.WriteString(result["content"].(string))
		if !result["truncated"].(bool) {
			break
		}
		nextCursor, _ := result["next_cursor"].(string)
		if nextCursor == "" {
			t.Fatalf("page %d omitted continuation cursor", page)
		}
		args = attachmentReadArgs{Locator: locator, Cursor: nextCursor}
	}
	if rebuilt.String() != string(body) {
		t.Fatalf("rebuilt legacy body=%q, want %q", rebuilt.String(), body)
	}
	sealed, err := store.GetThreadOwnedUpload(context.Background(), r.endpointID, r.threadID, uploadID)
	if err != nil || sealed.ContentSHA256 == "" || sealed.UnicodeCodePoints == nil || *sealed.UnicodeCodePoints != int64(utf8.RuneCount(body)) ||
		sealed.LogicalLineCount == nil || *sealed.LogicalLineCount != 4 {
		t.Fatalf("sealed legacy text metadata=%#v err=%v", sealed, err)
	}
	if canonicalPage.Turns[0].UserAttachments[0].ResourceRef != legacyRef || canonicalPage.Turns[0].UserAttachments[0].TextStats != nil {
		t.Fatalf("canonical Floret history was rewritten: %#v", canonicalPage.Turns[0].UserAttachments[0])
	}
}
