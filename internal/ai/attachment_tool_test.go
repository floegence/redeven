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

	"github.com/floegence/redeven/internal/session"
)

func TestAttachmentReadToolPagesUTF8AndRejectsCursorTampering(t *testing.T) {
	t.Parallel()
	body := []byte("alpha\r\n世界\nomega")
	sum := sha256.Sum256(body)
	digest := hex.EncodeToString(sum[:])
	points, lines := int64(14), int64(3)
	path := filepath.Join(t.TempDir(), "attachment.txt")
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	const attachmentID = "upl_bbbbbbbbbbbbbbbbbbbbbbbb"
	info := &UploadResponse{
		AttachmentID: attachmentID, Name: "notes.txt", DetectedMediaType: "text/plain; charset=utf-8",
		SizeBytes: int64(len(body)), ContentSHA256: digest, UnicodeCodePoints: &points, LogicalLineCount: &lines,
	}
	locator := logicalAttachmentLocator(attachmentID, info.Name)
	r := &run{id: "run_1", threadID: "thread_1", endpointID: "env_1", userPublicID: "user_1", channelID: "channel_1"}
	r.expectFloretRuntimeEventIdentity(r.id, r.threadID, "turn_1", true)
	r.host.openLiveAttachment = func(context.Context, UploadOwner, string) (openedCanonicalAttachment, error) {
		return openedCanonicalAttachment{
			Membership: CanonicalAttachmentMembership{
				ThreadID: r.threadID, TurnID: "turn_1", AttachmentID: attachmentID, ContentSHA256: digest,
				Name: info.Name, DetectedMediaType: info.DetectedMediaType, SizeBytes: info.SizeBytes,
			},
			Upload: &OpenUploadResult{Info: info, FilePath: path},
		}, nil
	}
	meta := &session.Meta{EndpointID: r.endpointID, UserPublicID: r.userPublicID, ChannelID: r.channelID, CanRead: true}
	args := attachmentReadArgs{Locator: locator, MaxBytes: 4, MaxLines: 1}
	var rebuilt strings.Builder
	var firstCursor string
	var sawMidLinePage bool
	for page := 0; page < 20; page++ {
		result, err := r.toolAttachmentRead(context.Background(), meta, args)
		if err != nil {
			t.Fatal(err)
		}
		rebuilt.WriteString(result["content"].(string))
		cursor := result["next_cursor"].(string)
		if page == 0 {
			firstCursor = cursor
			if result["start_line"] != 1 || result["end_line"] != 1 || result["starts_mid_line"] != false || result["ends_mid_line"] != true {
				t.Fatalf("first page boundaries=%#v", result)
			}
		}
		sawMidLinePage = sawMidLinePage || result["starts_mid_line"].(bool) || result["ends_mid_line"].(bool)
		if !result["truncated"].(bool) {
			break
		}
		args = attachmentReadArgs{Locator: locator, Cursor: cursor}
	}
	if rebuilt.String() != string(body) {
		t.Fatalf("rebuilt=%q, want %q", rebuilt.String(), body)
	}
	if firstCursor == "" {
		t.Fatal("first page did not return a cursor")
	}
	if !sawMidLinePage {
		t.Fatal("byte-bounded pagination never reported a split logical line")
	}
	verified, err := verifyAttachmentReadCursor(firstCursor)
	if err != nil || verified.KeyID == "" || verified.MaxLines != 1 {
		t.Fatalf("bound cursor=%#v error=%v", verified, err)
	}
	tampered := firstCursor[:len(firstCursor)-1] + "x"
	if _, err := r.toolAttachmentRead(context.Background(), meta, attachmentReadArgs{Locator: locator, Cursor: tampered}); err == nil {
		t.Fatal("tampered cursor was accepted")
	}
	replayA, err := r.toolAttachmentRead(context.Background(), meta, attachmentReadArgs{Locator: locator, Cursor: firstCursor})
	if err != nil {
		t.Fatal(err)
	}
	replayB, err := r.toolAttachmentRead(context.Background(), meta, attachmentReadArgs{Locator: locator, Cursor: firstCursor})
	if err != nil {
		t.Fatal(err)
	}
	if replayA["content"] != replayB["content"] || replayA["next_cursor"] != replayB["next_cursor"] {
		t.Fatalf("cursor replay is not deterministic: %#v %#v", replayA, replayB)
	}
	if _, err := r.toolAttachmentRead(context.Background(), meta, attachmentReadArgs{Locator: locator, Cursor: firstCursor, MaxLines: 2}); err == nil || !strings.Contains(err.Error(), "limits changed") {
		t.Fatalf("changed cursor limits error=%v", err)
	}
	wrongAudience := &run{id: "run_other", threadID: r.threadID, endpointID: r.endpointID, userPublicID: r.userPublicID, channelID: r.channelID}
	wrongAudience.expectFloretRuntimeEventIdentity(wrongAudience.id, wrongAudience.threadID, "turn_other", true)
	wrongAudience.host.openLiveAttachment = r.host.openLiveAttachment
	if _, err := wrongAudience.toolAttachmentRead(context.Background(), meta, attachmentReadArgs{Locator: locator, Cursor: firstCursor}); err == nil || !strings.Contains(err.Error(), "invalid attachment read cursor") {
		t.Fatalf("wrong cursor audience error=%v", err)
	}
}

func TestAttachmentReadToolRejectsNonTextAndRegistrationWithoutAuthority(t *testing.T) {
	t.Parallel()
	const attachmentID = "upl_cccccccccccccccccccccccc"
	path := filepath.Join(t.TempDir(), "document.pdf")
	if err := os.WriteFile(path, []byte("%PDF"), 0o600); err != nil {
		t.Fatal(err)
	}
	r := &run{id: "run_2", threadID: "thread_2", endpointID: "env_2", userPublicID: "user_2", channelID: "channel_2"}
	r.expectFloretRuntimeEventIdentity(r.id, r.threadID, "turn_2", true)
	r.host.openLiveAttachment = func(context.Context, UploadOwner, string) (openedCanonicalAttachment, error) {
		info := &UploadResponse{
			AttachmentID: attachmentID, Name: "document.pdf", DetectedMediaType: "application/pdf", SizeBytes: 4,
		}
		return openedCanonicalAttachment{
			Membership: CanonicalAttachmentMembership{
				ThreadID: r.threadID, TurnID: "turn_2", AttachmentID: attachmentID,
				Name: info.Name, DetectedMediaType: info.DetectedMediaType, SizeBytes: info.SizeBytes,
			},
			Upload: &OpenUploadResult{Info: info, FilePath: path},
		}, nil
	}
	meta := &session.Meta{EndpointID: r.endpointID, UserPublicID: r.userPublicID, ChannelID: r.channelID, CanRead: true}
	if _, err := r.toolAttachmentRead(context.Background(), meta, attachmentReadArgs{Locator: logicalAttachmentLocator(attachmentID, "document.pdf")}); err == nil || !strings.Contains(err.Error(), "strict UTF-8") {
		t.Fatalf("binary attachment error=%v", err)
	}

	registry := NewInMemoryToolRegistry()
	withoutAuthority := &run{attachmentToolReadEnabled: true}
	if err := registerBuiltInTools(registry, withoutAuthority); err != nil {
		t.Fatal(err)
	}
	for _, def := range registry.Snapshot() {
		if def.Name == "attachment.read" {
			t.Fatal("attachment.read registered without canonical authority")
		}
	}

	registry = NewInMemoryToolRegistry()
	withAuthorityButUnsupportedModel := &run{}
	withAuthorityButUnsupportedModel.host.openLiveAttachment = r.host.openLiveAttachment
	if err := registerBuiltInTools(registry, withAuthorityButUnsupportedModel); err != nil {
		t.Fatal(err)
	}
	for _, def := range registry.Snapshot() {
		if def.Name == "attachment.read" {
			t.Fatal("attachment.read registered for a model without tool fallback support")
		}
	}

	registry = NewInMemoryToolRegistry()
	r.attachmentToolReadEnabled = true
	if err := registerBuiltInTools(registry, r); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, def := range registry.Snapshot() {
		found = found || def.Name == "attachment.read"
	}
	if !found {
		t.Fatal("attachment.read was not registered with canonical authority and model tool support")
	}
}

func TestAttachmentReadCursorAcceptsPreviousRotationKeyWithinTTL(t *testing.T) {
	t.Parallel()
	now := time.Now()
	cursor := attachmentReadCursor{
		Version: 1, KeyID: attachmentReadKeyID(now.Add(-attachmentReadCursorTTL)),
		AttachmentID: "upl_rrrrrrrrrrrrrrrrrrrrrrrr", Digest: strings.Repeat("a", 64),
		ThreadID: "thread_rotation", RunID: "run_rotation", Offset: 4,
		MaxBytes: 1024, MaxLines: 10, ExpiresAtMS: now.Add(time.Minute).UnixMilli(),
	}
	raw, err := signAttachmentReadCursor(cursor)
	if err != nil {
		t.Fatal(err)
	}
	verified, err := verifyAttachmentReadCursor(raw)
	if err != nil || verified.KeyID != cursor.KeyID {
		t.Fatalf("previous rotation key cursor=%#v error=%v", verified, err)
	}
}

func TestAttachmentReadToolReportsEmptyAndTrailingLineBoundaries(t *testing.T) {
	t.Parallel()
	testCases := []struct {
		name      string
		body      []byte
		lineCount int64
		startLine int
		endLine   int
	}{
		{name: "empty", body: nil, lineCount: 0, startLine: 0, endLine: 0},
		{name: "trailing empty line", body: []byte("one\n"), lineCount: 2, startLine: 1, endLine: 1},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "attachment.txt")
			if err := os.WriteFile(path, testCase.body, 0o600); err != nil {
				t.Fatal(err)
			}
			sum := sha256.Sum256(testCase.body)
			digest := hex.EncodeToString(sum[:])
			points := int64(len(testCase.body))
			const attachmentID = "upl_dddddddddddddddddddddddd"
			info := &UploadResponse{
				AttachmentID: attachmentID, Name: "lines.txt", DetectedMediaType: "text/plain; charset=utf-8",
				SizeBytes: int64(len(testCase.body)), ContentSHA256: digest, UnicodeCodePoints: &points, LogicalLineCount: &testCase.lineCount,
			}
			r := &run{id: "run_lines", threadID: "thread_lines", endpointID: "env_lines", userPublicID: "user_lines", channelID: "channel_lines"}
			r.expectFloretRuntimeEventIdentity(r.id, r.threadID, "turn_lines", true)
			r.host.openLiveAttachment = func(context.Context, UploadOwner, string) (openedCanonicalAttachment, error) {
				return openedCanonicalAttachment{
					Membership: CanonicalAttachmentMembership{
						ThreadID: r.threadID, TurnID: "turn_lines", AttachmentID: attachmentID, ContentSHA256: digest,
						Name: info.Name, DetectedMediaType: info.DetectedMediaType, SizeBytes: info.SizeBytes,
					},
					Upload: &OpenUploadResult{Info: info, FilePath: path},
				}, nil
			}
			meta := &session.Meta{EndpointID: r.endpointID, UserPublicID: r.userPublicID, ChannelID: r.channelID, CanRead: true}
			result, err := r.toolAttachmentRead(context.Background(), meta, attachmentReadArgs{Locator: logicalAttachmentLocator(attachmentID, info.Name)})
			if err != nil {
				t.Fatal(err)
			}
			if result["start_line"] != testCase.startLine || result["end_line"] != testCase.endLine || result["starts_mid_line"] != false || result["ends_mid_line"] != false {
				t.Fatalf("line boundaries=%#v", result)
			}
		})
	}
}
