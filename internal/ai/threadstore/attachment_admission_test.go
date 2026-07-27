package threadstore

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func attachmentAdmissionForTest(ownerHash, revision string, routes map[string]string) AttachmentAdmission {
	return AttachmentAdmission{
		OwnerUserHash: ownerHash, CapabilityRevision: revision,
		MaxCount: AttachmentAdmissionMaxCount, MaxTurnBytes: AttachmentAdmissionMaxTurnBytes,
		SupportsLongText: true, Routes: routes,
	}
}

func queuedTurnForAttachmentAdmission(endpointID, threadID, queueID string) QueuedTurn {
	return QueuedTurn{
		QueueID: queueID, EndpointID: endpointID, ThreadID: threadID, ChannelID: "channel_admission",
		Lane: FollowupLaneQueued, TurnID: "turn_" + queueID, RunID: "run_" + queueID,
		ModelID: "openai/model", AttachmentsJSON: "[]", CreatedAtUnixMs: 10,
	}
}

func TestAttachmentAdmissionEnforcesCountBytesAndModelRoutesBeforeMutation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		count     int
		size      int64
		mediaType string
		routes    map[string]string
		wantError string
	}{
		{name: "count boundary", count: 10, size: 1, mediaType: "text/plain; charset=utf-8", routes: map[string]string{"text/plain; charset=utf-8": "tool_read"}},
		{name: "count exceeded", count: 11, size: 1, mediaType: "text/plain; charset=utf-8", routes: map[string]string{"text/plain; charset=utf-8": "tool_read"}, wantError: "count"},
		{name: "byte boundary", count: 1, size: AttachmentAdmissionMaxTurnBytes, mediaType: "text/plain; charset=utf-8", routes: map[string]string{"text/plain; charset=utf-8": "tool_read"}},
		{name: "bytes exceeded", count: 1, size: AttachmentAdmissionMaxTurnBytes + 1, mediaType: "text/plain; charset=utf-8", routes: map[string]string{"text/plain; charset=utf-8": "tool_read"}, wantError: "bytes"},
		{name: "aggregate bytes exceeded", count: 2, size: 13 << 20, mediaType: "text/plain; charset=utf-8", routes: map[string]string{"text/plain; charset=utf-8": "tool_read"}, wantError: "bytes"},
		{name: "model route rejected", count: 1, size: 1, mediaType: "application/pdf", routes: map[string]string{"application/pdf": "unsupported"}, wantError: "route"},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			store := openStoreForTest(t)
			ctx := t.Context()
			endpointID := "env_" + strings.ReplaceAll(testCase.name, " ", "_")
			threadID := "thread_" + strings.ReplaceAll(testCase.name, " ", "_")
			ownerHash := strings.Repeat("a", 64)
			if err := store.CreateThreadSettings(ctx, ThreadSettings{EndpointID: endpointID, ThreadID: threadID, PermissionType: "approval_required"}); err != nil {
				t.Fatal(err)
			}
			uploadIDs := make([]string, 0, testCase.count)
			for index := 0; index < testCase.count; index++ {
				uploadID := fmt.Sprintf("upl_admission_%02d", index)
				uploadIDs = append(uploadIDs, uploadID)
				if err := store.InsertUpload(ctx, UploadRecord{
					UploadID: uploadID, EndpointID: endpointID, OwnerScopeKind: UploadOwnerScopeUser, OwnerUserHash: ownerHash,
					StorageRelPath: uploadID + ".data", Name: uploadID + ".txt", DetectedMediaType: testCase.mediaType,
					SizeBytes: testCase.size, ContentSHA256: strings.Repeat("d", 64), Source: UploadSourceFile,
					State: UploadStateLive, CreatedAtUnixMs: 1,
				}); err != nil {
					t.Fatal(err)
				}
			}
			_, _, _, err := store.CreateFollowupWithAttachmentAdmission(
				ctx, queuedTurnForAttachmentAdmission(endpointID, threadID, "queue_test"), uploadIDs, 10,
				attachmentAdmissionForTest(ownerHash, strings.Repeat("b", 64), testCase.routes),
			)
			if testCase.wantError == "" {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), testCase.wantError) {
				t.Fatalf("error=%v, want %q rejection", err, testCase.wantError)
			}
			if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_queued_turns WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID) != 0 {
				t.Fatal("failed attachment admission inserted a queued turn")
			}
			if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND ref_kind = ?`, endpointID, UploadRefKindQueuedTurn) != 0 {
				t.Fatal("failed attachment admission inserted upload refs")
			}
		})
	}
}

func TestAttachmentAdmissionRejectsReplacementWithoutRemovingSource(t *testing.T) {
	t.Parallel()
	store := openStoreForTest(t)
	ctx := t.Context()
	const endpointID = "env_replace_admission"
	const threadID = "thread_replace_admission"
	ownerHash := strings.Repeat("a", 64)
	if err := store.CreateThreadSettings(ctx, ThreadSettings{EndpointID: endpointID, ThreadID: threadID, PermissionType: "approval_required"}); err != nil {
		t.Fatal(err)
	}
	source, _, _, err := store.CreateFollowup(ctx, queuedTurnForAttachmentAdmission(endpointID, threadID, "queue_source"))
	if err != nil {
		t.Fatal(err)
	}
	uploadID := "upl_replace_unsupported"
	if err := store.InsertUpload(ctx, UploadRecord{
		UploadID: uploadID, EndpointID: endpointID, OwnerScopeKind: UploadOwnerScopeUser, OwnerUserHash: ownerHash,
		StorageRelPath: uploadID + ".data", Name: "document.pdf", DetectedMediaType: "application/pdf",
		SizeBytes: 10, ContentSHA256: strings.Repeat("d", 64), Source: UploadSourceFile,
		State: UploadStateLive, CreatedAtUnixMs: 1,
	}); err != nil {
		t.Fatal(err)
	}
	_, err = store.ReplaceFollowupWithAttachmentAdmission(
		ctx, source.QueueID, queuedTurnForAttachmentAdmission(endpointID, threadID, "queue_replacement"), []string{uploadID}, 10,
		attachmentAdmissionForTest(ownerHash, strings.Repeat("b", 64), map[string]string{"application/pdf": "unsupported"}),
	)
	if err == nil || !strings.Contains(err.Error(), "route") {
		t.Fatalf("replacement error=%v, want route rejection", err)
	}
	stored, getErr := store.GetQueuedTurn(ctx, endpointID, threadID, source.QueueID)
	if getErr != nil || stored == nil || stored.QueueID != source.QueueID {
		t.Fatalf("source after rejected replacement=%#v err=%v", stored, getErr)
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = ? AND ref_kind = ?`, endpointID, uploadID, UploadRefKindQueuedTurn) != 0 {
		t.Fatal("rejected replacement inserted an upload ref")
	}
}

func prepareLongTextDraftForAdmissionTest(t *testing.T, store *Store, suffix string) (string, string, string, string, int64, AttachmentAdmission) {
	t.Helper()
	ctx := t.Context()
	endpointID := "env_long_" + suffix
	threadID := "thread_long_" + suffix
	ownerHash := strings.Repeat("c", 64)
	revision := strings.Repeat("e", 64)
	uploadID := "upl_long_" + suffix
	text := strings.Repeat("😀\r\n", 16_667)
	digest, sizeBytes, codePoints, lines := composerDraftTextStats(text)
	if codePoints <= composerDraftInlineTextCodePointLimit {
		t.Fatalf("test long text has %d code points", codePoints)
	}
	if err := store.CreateThreadSettings(ctx, ThreadSettings{EndpointID: endpointID, ThreadID: threadID, PermissionType: "approval_required"}); err != nil {
		t.Fatal(err)
	}
	if err := store.InsertUpload(ctx, UploadRecord{
		UploadID: uploadID, EndpointID: endpointID, OwnerScopeKind: UploadOwnerScopeUser, OwnerUserHash: ownerHash,
		StorageRelPath: uploadID + ".data", Name: "long text.txt", DetectedMediaType: "text/plain; charset=utf-8",
		SizeBytes: sizeBytes, ContentSHA256: digest, UnicodeCodePoints: &codePoints, LogicalLineCount: &lines,
		Source: UploadSourceLongText, State: UploadStateStaged, CreatedAtUnixMs: 1,
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.BindUserUploadsToDraft(ctx, endpointID, ownerHash, threadID, []string{uploadID}, 2); err != nil {
		t.Fatal(err)
	}
	lease, err := store.AcquireComposerDraftLease(ctx, endpointID, ownerHash, threadID, "surface_long", false, 3)
	if err != nil {
		t.Fatal(err)
	}
	value, _ := json.Marshal(map[string]any{
		"text": text, "mode": ComposerDraftModeAdmissionInFlight, "model_id": "openai/model",
		"references":          []any{},
		"capability_revision": revision, "proposed_turn_id": "turn_long_" + suffix, "admission_started": true,
		"prepared_long_text_attachment_id": uploadID,
		"attachments": []any{map[string]any{
			"local_id": "local_long", "source": "long_text",
			"staged": map[string]any{
				"attachment_id": uploadID, "name": "long text.txt", "mime_type": "text/plain; charset=utf-8",
				"size_bytes": sizeBytes, "digest_sha256": digest,
				"locator": "attachment://v1/" + uploadID + "/" + url.PathEscape(filepath.Base("long text.txt")),
				"source":  "long_text", "capability_revision": revision,
				"text_stats": map[string]any{"code_points": codePoints, "lines": lines},
			},
		}},
	})
	draft, err := store.MutateComposerDraft(ctx, ComposerDraftMutation{
		EndpointID: endpointID, OwnerUserHash: ownerHash, ScopeID: threadID,
		HolderID: "surface_long", LeaseID: lease.Draft.LeaseID, ExpectedRevision: lease.Draft.Revision,
		Value: value, NowUnixMs: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	return endpointID, threadID, ownerHash, uploadID, draft.Revision, attachmentAdmissionForTest(
		ownerHash, revision, map[string]string{"text/plain; charset=utf-8": "tool_read"},
	)
}

func TestPreparedLongTextAdmissionRecomputesExactDraftTextWithoutSideEffectsOnMismatch(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		tamper func(*testing.T, *Store, string, string, string)
	}{
		{name: "digest", tamper: func(t *testing.T, store *Store, endpointID, _, uploadID string) {
			_, err := store.db.Exec(`UPDATE ai_uploads SET content_sha256 = ? WHERE endpoint_id = ? AND upload_id = ?`, strings.Repeat("f", 64), endpointID, uploadID)
			if err != nil {
				t.Fatal(err)
			}
		}},
		{name: "bytes", tamper: func(t *testing.T, store *Store, endpointID, _, uploadID string) {
			_, err := store.db.Exec(`UPDATE ai_uploads SET size_bytes = size_bytes + 1 WHERE endpoint_id = ? AND upload_id = ?`, endpointID, uploadID)
			if err != nil {
				t.Fatal(err)
			}
		}},
		{name: "code points", tamper: func(t *testing.T, store *Store, endpointID, _, uploadID string) {
			_, err := store.db.Exec(`UPDATE ai_uploads SET unicode_code_points = unicode_code_points - 1 WHERE endpoint_id = ? AND upload_id = ?`, endpointID, uploadID)
			if err != nil {
				t.Fatal(err)
			}
		}},
		{name: "CRLF lines", tamper: func(t *testing.T, store *Store, endpointID, _, uploadID string) {
			_, err := store.db.Exec(`UPDATE ai_uploads SET logical_line_count = logical_line_count + 1 WHERE endpoint_id = ? AND upload_id = ?`, endpointID, uploadID)
			if err != nil {
				t.Fatal(err)
			}
		}},
		{name: "staged metadata", tamper: func(t *testing.T, store *Store, endpointID, threadID, _ string) {
			var raw string
			if err := store.db.QueryRow(`SELECT value_json FROM ai_composer_drafts WHERE endpoint_id = ? AND scope_id = ?`, endpointID, threadID).Scan(&raw); err != nil {
				t.Fatal(err)
			}
			var value map[string]any
			if err := json.Unmarshal([]byte(raw), &value); err != nil {
				t.Fatal(err)
			}
			attachments := value["attachments"].([]any)
			attachments[0].(map[string]any)["staged"].(map[string]any)["digest_sha256"] = strings.Repeat("0", 64)
			next, _ := json.Marshal(value)
			if _, err := store.db.Exec(`UPDATE ai_composer_drafts SET value_json = ? WHERE endpoint_id = ? AND scope_id = ?`, string(next), endpointID, threadID); err != nil {
				t.Fatal(err)
			}
		}},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			store := openStoreForTest(t)
			endpointID, threadID, ownerHash, uploadID, revision, contract := prepareLongTextDraftForAdmissionTest(t, store, strings.ReplaceAll(testCase.name, " ", "_"))
			testCase.tamper(t, store, endpointID, threadID, uploadID)
			rec := queuedTurnForAttachmentAdmission(endpointID, threadID, "queue_long")
			rec.TurnID = "turn_long_" + strings.ReplaceAll(testCase.name, " ", "_")
			_, _, _, err := store.CreateFollowupFromComposerDraft(t.Context(), rec, []string{uploadID}, 10, ComposerDraftAdmission{
				OwnerUserHash: ownerHash, DraftID: threadID, ExpectedRevision: revision, Attachment: contract,
			})
			if err == nil {
				t.Fatal("tampered prepared long text was admitted")
			}
			if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_queued_turns WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID) != 0 ||
				countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_composer_drafts WHERE endpoint_id = ? AND owner_user_hash = ? AND scope_id = ?`, endpointID, ownerHash, threadID) != 1 ||
				countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = ? AND ref_kind = ?`, endpointID, uploadID, UploadRefKindDraft) != 1 {
				t.Fatal("failed long-text admission had transactional side effects")
			}
		})
	}
}

func TestAttachmentAdmissionSerializesConcurrentClaims(t *testing.T) {
	store := openStoreForTest(t)
	endpointID, threadID, ownerHash, uploadID, revision, contract := prepareLongTextDraftForAdmissionTest(t, store, "concurrent")
	start := make(chan struct{})
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for index := range errs {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			<-start
			rec := queuedTurnForAttachmentAdmission(endpointID, threadID, fmt.Sprintf("queue_concurrent_%d", index))
			rec.TurnID = "turn_long_concurrent"
			_, _, _, errs[index] = store.CreateFollowupFromComposerDraft(t.Context(), rec, []string{uploadID}, 10, ComposerDraftAdmission{
				OwnerUserHash: ownerHash, DraftID: threadID, ExpectedRevision: revision, Attachment: contract,
			})
		}(index)
	}
	close(start)
	wg.Wait()
	successes := 0
	for _, err := range errs {
		if err == nil {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("concurrent admissions errors=%v, want exactly one success", errs)
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_queued_turns WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID) != 1 ||
		countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_composer_drafts WHERE endpoint_id = ? AND owner_user_hash = ? AND scope_id = ?`, endpointID, ownerHash, threadID) != 0 {
		t.Fatal("concurrent draft claim did not commit exactly once")
	}
}

func TestComposerDraftTextStatsUseExactUTF8BytesCodePointsAndCRLFLines(t *testing.T) {
	t.Parallel()
	text := "😀\r\n二\r三\n"
	digest, sizeBytes, codePoints, lines := composerDraftTextStats(text)
	wantDigest := sha256.Sum256([]byte(text))
	if digest != hex.EncodeToString(wantDigest[:]) || sizeBytes != int64(len([]byte(text))) || codePoints != 7 || lines != 4 {
		t.Fatalf("stats=(%s,%d,%d,%d)", digest, sizeBytes, codePoints, lines)
	}
}
