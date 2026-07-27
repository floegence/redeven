package threadstore

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func composerDraftUploadForTest(endpointID, ownerHash, uploadID string) UploadRecord {
	return UploadRecord{
		UploadID:          uploadID,
		EndpointID:        endpointID,
		OwnerScopeKind:    UploadOwnerScopeUser,
		OwnerUserHash:     ownerHash,
		StorageRelPath:    uploadID + ".data",
		Name:              uploadID + ".txt",
		DeclaredMediaType: "text/plain",
		DetectedMediaType: "text/plain",
		SizeBytes:         4,
		ContentSHA256:     strings.Repeat("c", 64),
		Source:            UploadSourceFile,
		State:             UploadStateStaged,
		CreatedAtUnixMs:   1,
	}
}

func composerDraftValueForTest(text, mode string, uploadIDs ...string) json.RawMessage {
	attachments := make([]map[string]any, 0, len(uploadIDs))
	for index, uploadID := range uploadIDs {
		attachments = append(attachments, map[string]any{
			"local_id": "local_" + uploadID,
			"source":   "file",
			"staged": map[string]any{
				"attachment_id": uploadID,
				"name":          uploadID + ".txt",
				"media_type":    "text/plain",
				"size_bytes":    4,
			},
			"ordinal": index + 1,
		})
	}
	value, err := json.Marshal(map[string]any{
		"text":        text,
		"attachments": attachments,
		"references":  []any{},
		"mode":        mode,
	})
	if err != nil {
		panic(err)
	}
	return value
}

func TestNormalizeComposerDraftValueValidatesReferencesStrictly(t *testing.T) {
	t.Parallel()

	base := func() map[string]any {
		return map[string]any{
			"text": "review these paths", "attachments": []any{}, "mode": ComposerDraftModeOrdinary,
			"references": []any{
				map[string]any{"local_id": "ref_file", "kind": "file", "label": "main.go", "path": "/workspace/main.go"},
				map[string]any{"local_id": "ref_dir", "kind": "directory", "label": "src", "path": "/workspace/src"},
			},
		}
	}
	encode := func(value map[string]any) json.RawMessage {
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	canonical, err := normalizeComposerDraftValue(encode(base()))
	if err != nil {
		t.Fatal(err)
	}
	var decoded composerDraftAdmissionValue
	if err := json.Unmarshal(canonical, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.References) != 2 || decoded.References[0].Path != "/workspace/main.go" || decoded.References[1].Kind != "directory" {
		t.Fatalf("references=%#v", decoded.References)
	}
	if _, err := normalizeComposerDraftValue(append(encode(base()), []byte(" trailing")...)); err == nil {
		t.Fatal("composer draft accepted trailing non-JSON content")
	}

	tests := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{name: "missing references", mutate: func(value map[string]any) { delete(value, "references") }},
		{name: "non array references", mutate: func(value map[string]any) { value["references"] = map[string]any{} }},
		{name: "unknown reference field", mutate: func(value map[string]any) { value["references"].([]any)[0].(map[string]any)["unknown"] = true }},
		{name: "invalid kind", mutate: func(value map[string]any) { value["references"].([]any)[0].(map[string]any)["kind"] = "text" }},
		{name: "trimmed path", mutate: func(value map[string]any) {
			value["references"].([]any)[0].(map[string]any)["path"] = " /workspace/main.go "
		}},
		{name: "label is not path derived", mutate: func(value map[string]any) { value["references"].([]any)[0].(map[string]any)["label"] = "forged.go" }},
		{name: "duplicate local identity", mutate: func(value map[string]any) { value["references"].([]any)[1].(map[string]any)["local_id"] = "ref_file" }},
		{name: "duplicate semantic path", mutate: func(value map[string]any) {
			items := value["references"].([]any)
			items[1] = map[string]any{"local_id": "ref_duplicate", "kind": "file", "label": "main.go", "path": "/workspace/main.go"}
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			value := base()
			test.mutate(value)
			if _, err := normalizeComposerDraftValue(encode(value)); err == nil {
				t.Fatal("invalid composer draft reference was accepted")
			}
		})
	}
}

func TestComposerDraftLeaseAndRevisionCAS(t *testing.T) {
	t.Parallel()
	store := openStoreForTest(t)
	ctx := t.Context()
	const endpointID = "env_draft_lease"
	const scopeID = "thread_draft_lease"
	ownerHash := strings.Repeat("a", 64)

	first, err := store.AcquireComposerDraftLease(ctx, endpointID, ownerHash, scopeID, "surface_a", false, 1_000)
	if err != nil {
		t.Fatal(err)
	}
	if first.State != "owned" || first.Draft.Revision != 0 || first.Draft.LeaseID == "" || first.Draft.LeaseHolderID != "surface_a" {
		t.Fatalf("first lease=%#v", first)
	}
	if first.Draft.LeaseExpiresAtUnixMs != 1_000+composerDraftLeaseDuration.Milliseconds() {
		t.Fatalf("lease expiry=%d", first.Draft.LeaseExpiresAtUnixMs)
	}
	if first.Draft.ExpiresAtUnixMs != 1_000+composerDraftRetention.Milliseconds() {
		t.Fatalf("draft expiry=%d", first.Draft.ExpiresAtUnixMs)
	}

	conflict, err := store.AcquireComposerDraftLease(ctx, endpointID, ownerHash, scopeID, "surface_b", false, 1_001)
	if err != nil {
		t.Fatal(err)
	}
	if conflict.State != "conflict" || conflict.Holder != "surface_a" {
		t.Fatalf("conflicting lease=%#v", conflict)
	}
	taken, err := store.AcquireComposerDraftLease(ctx, endpointID, ownerHash, scopeID, "surface_b", true, 1_002)
	if err != nil {
		t.Fatal(err)
	}
	if taken.State != "owned" || taken.Draft.LeaseHolderID != "surface_b" || taken.Draft.LeaseID == first.Draft.LeaseID {
		t.Fatalf("taken lease=%#v", taken)
	}

	if _, err := store.MutateComposerDraft(ctx, ComposerDraftMutation{
		EndpointID: endpointID, OwnerUserHash: ownerHash, ScopeID: scopeID,
		HolderID: "surface_a", LeaseID: first.Draft.LeaseID, ExpectedRevision: 0,
		Value: composerDraftValueForTest("stale holder", ComposerDraftModeOrdinary), NowUnixMs: 1_003,
	}); !errors.Is(err, ErrComposerDraftLeaseLost) {
		t.Fatalf("stale holder mutation error=%v", err)
	}
	updated, err := store.MutateComposerDraft(ctx, ComposerDraftMutation{
		EndpointID: endpointID, OwnerUserHash: ownerHash, ScopeID: scopeID,
		HolderID: "surface_b", LeaseID: taken.Draft.LeaseID, ExpectedRevision: 0,
		Value: composerDraftValueForTest("saved", ComposerDraftModeOrdinary), NowUnixMs: 1_004,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Revision != 1 || !strings.Contains(string(updated.Value), `"text":"saved"`) {
		t.Fatalf("updated draft=%#v", updated)
	}
	if _, err := store.MutateComposerDraft(ctx, ComposerDraftMutation{
		EndpointID: endpointID, OwnerUserHash: ownerHash, ScopeID: scopeID,
		HolderID: "surface_b", LeaseID: taken.Draft.LeaseID, ExpectedRevision: 0,
		Value: composerDraftValueForTest("lost update", ComposerDraftModeOrdinary), NowUnixMs: 1_005,
	}); !errors.Is(err, ErrComposerDraftRevisionConflict) {
		t.Fatalf("stale revision mutation error=%v", err)
	}
	stored, err := store.GetComposerDraft(ctx, endpointID, ownerHash, scopeID, 1_005)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Revision != 1 || !strings.Contains(string(stored.Value), `"text":"saved"`) {
		t.Fatalf("stored draft after stale mutation=%#v", stored)
	}
}

func TestComposerDraftMutationPromotesPendingRefsAndRollsBackTogether(t *testing.T) {
	t.Parallel()
	store := openStoreForTest(t)
	ctx := t.Context()
	const endpointID = "env_draft_refs"
	const scopeID = "thread_draft_refs"
	ownerHash := strings.Repeat("b", 64)
	draftRefID := composerDraftUploadRefID(ownerHash, scopeID)
	lease, err := store.AcquireComposerDraftLease(ctx, endpointID, ownerHash, scopeID, "surface_refs", false, 1_000)
	if err != nil {
		t.Fatal(err)
	}
	for _, uploadID := range []string{"upload_keep", "upload_discard", "upload_stale", "upload_unclaimed"} {
		if err := store.InsertUpload(ctx, composerDraftUploadForTest(endpointID, ownerHash, uploadID)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.db.Exec(`
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
VALUES
	  (?, 'upload_keep', ?, ?, ?, 1),
	  (?, 'upload_discard', ?, ?, ?, 1)
	`, endpointID, scopeID, UploadRefKindDraftPending, draftRefID, endpointID, scopeID, UploadRefKindDraftPending, draftRefID); err != nil {
		t.Fatal(err)
	}

	updated, err := store.MutateComposerDraft(ctx, ComposerDraftMutation{
		EndpointID: endpointID, OwnerUserHash: ownerHash, ScopeID: scopeID,
		HolderID: "surface_refs", LeaseID: lease.Draft.LeaseID, ExpectedRevision: 0,
		Value: composerDraftValueForTest("with attachment", ComposerDraftModeOrdinary, "upload_keep"), NowUnixMs: 1_001,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Revision != 1 {
		t.Fatalf("revision=%d, want 1", updated.Revision)
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = 'upload_keep' AND ref_kind = ? AND ref_id = ?`, endpointID, UploadRefKindDraft, draftRefID) != 1 {
		t.Fatal("pending upload was not promoted to an exact draft ref")
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND ref_kind = ? AND ref_id = ?`, endpointID, UploadRefKindDraftPending, draftRefID) != 0 {
		t.Fatal("successful mutation retained draft_pending refs")
	}
	discarded, err := store.GetUpload(ctx, endpointID, "upload_discard")
	if err != nil {
		t.Fatal(err)
	}
	if discarded.State != UploadStateDeleting {
		t.Fatalf("discarded upload state=%q", discarded.State)
	}

	if _, err := store.db.Exec(`
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
	VALUES(?, 'upload_stale', ?, ?, ?, 2)
	`, endpointID, scopeID, UploadRefKindDraftPending, draftRefID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.MutateComposerDraft(ctx, ComposerDraftMutation{
		EndpointID: endpointID, OwnerUserHash: ownerHash, ScopeID: scopeID,
		HolderID: "surface_refs", LeaseID: lease.Draft.LeaseID, ExpectedRevision: 0,
		Value: composerDraftValueForTest("stale", ComposerDraftModeOrdinary, "upload_stale"), NowUnixMs: 1_002,
	}); !errors.Is(err, ErrComposerDraftRevisionConflict) {
		t.Fatalf("stale mutation error=%v", err)
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = 'upload_stale' AND ref_kind = ? AND ref_id = ?`, endpointID, UploadRefKindDraftPending, draftRefID) != 1 {
		t.Fatal("failed CAS changed pending refs")
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = 'upload_keep' AND ref_kind = ? AND ref_id = ?`, endpointID, UploadRefKindDraft, draftRefID) != 1 {
		t.Fatal("failed CAS changed committed draft refs")
	}

	if _, err := store.MutateComposerDraft(ctx, ComposerDraftMutation{
		EndpointID: endpointID, OwnerUserHash: ownerHash, ScopeID: scopeID,
		HolderID: "surface_refs", LeaseID: lease.Draft.LeaseID, ExpectedRevision: 1,
		Value: composerDraftValueForTest("invalid claim", ComposerDraftModeOrdinary, "upload_unclaimed"), NowUnixMs: 1_003,
	}); err == nil || !strings.Contains(err.Error(), "claim changed") {
		t.Fatalf("unclaimed attachment mutation error=%v", err)
	}
	stored, err := store.GetComposerDraft(ctx, endpointID, ownerHash, scopeID, 1_003)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Revision != 1 || !strings.Contains(string(stored.Value), "upload_keep") {
		t.Fatalf("failed ref reconciliation changed draft=%#v", stored)
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = 'upload_stale' AND ref_kind = ? AND ref_id = ?`, endpointID, UploadRefKindDraftPending, draftRefID) != 1 {
		t.Fatal("failed ref reconciliation changed unrelated pending refs")
	}
}

func TestComposerDraftMutationCanonicalizesStagedUploadMetadata(t *testing.T) {
	t.Parallel()
	store := openStoreForTest(t)
	ctx := t.Context()
	const endpointID = "env_draft_canonical_metadata"
	const scopeID = "thread_draft_canonical_metadata"
	const uploadID = "upload_canonical_metadata"
	ownerHash := strings.Repeat("e", 64)
	codePoints := int64(4)
	lines := int64(2)
	rec := composerDraftUploadForTest(endpointID, ownerHash, uploadID)
	rec.Name = "canonical notes.txt"
	rec.DetectedMediaType = "text/plain; charset=utf-8"
	rec.MimeType = rec.DetectedMediaType
	rec.SizeBytes = 17
	rec.ContentSHA256 = strings.Repeat("d", 64)
	rec.UnicodeCodePoints = &codePoints
	rec.LogicalLineCount = &lines
	rec.CreatedAtUnixMs = 777
	if err := store.InsertUpload(ctx, rec); err != nil {
		t.Fatal(err)
	}
	if err := store.BindUserUploadsToDraft(ctx, endpointID, ownerHash, scopeID, []string{uploadID}, 1); err != nil {
		t.Fatal(err)
	}
	lease, err := store.AcquireComposerDraftLease(ctx, endpointID, ownerHash, scopeID, "surface_metadata", false, 1_000)
	if err != nil {
		t.Fatal(err)
	}
	value := map[string]any{
		"text": "", "mode": ComposerDraftModeOrdinary, "capability_revision": "capability-canonical",
		"references": []any{},
		"attachments": []any{map[string]any{
			"local_id": "local_metadata", "source": "drop", "name": "forged.txt", "mime_type": "image/png", "size_bytes": 999,
			"staged": map[string]any{
				"attachment_id": uploadID, "name": "forged.txt", "mime_type": "image/png", "size_bytes": 999,
				"digest_sha256": strings.Repeat("0", 64), "locator": "attachment://forged", "source": "long_text",
				"capability_revision": "capability-forged", "text_stats": map[string]any{"code_points": 999, "lines": 999},
			},
		}},
	}
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	updated, err := store.MutateComposerDraft(ctx, ComposerDraftMutation{
		EndpointID: endpointID, OwnerUserHash: ownerHash, ScopeID: scopeID,
		HolderID: "surface_metadata", LeaseID: lease.Draft.LeaseID, ExpectedRevision: 0,
		Value: raw, NowUnixMs: 1_001,
	})
	if err != nil {
		t.Fatal(err)
	}
	var canonical struct {
		CapabilityRevision string `json:"capability_revision"`
		Attachments        []struct {
			Source    string `json:"source"`
			Name      string `json:"name"`
			MimeType  string `json:"mime_type"`
			SizeBytes int64  `json:"size_bytes"`
			Staged    struct {
				Name               string `json:"name"`
				MimeType           string `json:"mime_type"`
				SizeBytes          int64  `json:"size_bytes"`
				Digest             string `json:"digest_sha256"`
				Locator            string `json:"locator"`
				Source             string `json:"source"`
				CapabilityRevision string `json:"capability_revision"`
				CreatedAtUnixMs    int64  `json:"created_at_unix_ms"`
				TextStats          struct {
					CodePoints int64 `json:"code_points"`
					Lines      int64 `json:"lines"`
				} `json:"text_stats"`
			} `json:"staged"`
		} `json:"attachments"`
	}
	if err := json.Unmarshal(updated.Value, &canonical); err != nil {
		t.Fatal(err)
	}
	if len(canonical.Attachments) != 1 {
		t.Fatalf("canonical draft=%s", updated.Value)
	}
	attachment := canonical.Attachments[0]
	if canonical.CapabilityRevision != "capability-canonical" || attachment.Source != "drop" ||
		attachment.Name != rec.Name || attachment.MimeType != rec.DetectedMediaType || attachment.SizeBytes != rec.SizeBytes ||
		attachment.Staged.Name != rec.Name || attachment.Staged.MimeType != rec.DetectedMediaType || attachment.Staged.SizeBytes != rec.SizeBytes ||
		attachment.Staged.Digest != rec.ContentSHA256 || attachment.Staged.Source != "drop" ||
		attachment.Staged.CapabilityRevision != canonical.CapabilityRevision || attachment.Staged.CreatedAtUnixMs != rec.CreatedAtUnixMs ||
		attachment.Staged.TextStats.CodePoints != codePoints || attachment.Staged.TextStats.Lines != lines {
		t.Fatalf("canonical metadata=%#v", canonical)
	}
	if attachment.Staged.Locator != "attachment://v1/"+uploadID+"/canonical%20notes.txt" {
		t.Fatalf("canonical locator=%q", attachment.Staged.Locator)
	}
}

func TestSweepExpiredComposerDraftsReleasesRefsAndSkipsAdmission(t *testing.T) {
	t.Parallel()
	store := openStoreForTest(t)
	ctx := t.Context()
	const endpointID = "env_draft_expiry"
	ownerHash := strings.Repeat("d", 64)

	createDraft := func(scopeID, uploadID, holderID string, admissionStarted bool) {
		t.Helper()
		if err := store.InsertUpload(ctx, composerDraftUploadForTest(endpointID, ownerHash, uploadID)); err != nil {
			t.Fatal(err)
		}
		if err := store.BindUserUploadsToDraft(ctx, endpointID, ownerHash, scopeID, []string{uploadID}, 1); err != nil {
			t.Fatal(err)
		}
		lease, err := store.AcquireComposerDraftLease(ctx, endpointID, ownerHash, scopeID, holderID, false, 1_000)
		if err != nil {
			t.Fatal(err)
		}
		value := composerDraftValueForTest("saved", ComposerDraftModeOrdinary, uploadID)
		if admissionStarted {
			var decoded map[string]any
			if err := json.Unmarshal(value, &decoded); err != nil {
				t.Fatal(err)
			}
			decoded["mode"] = ComposerDraftModeAdmissionInFlight
			decoded["admission_started"] = true
			decoded["proposed_turn_id"] = "turn_" + scopeID
			value, err = json.Marshal(decoded)
			if err != nil {
				t.Fatal(err)
			}
		}
		if _, err := store.MutateComposerDraft(ctx, ComposerDraftMutation{
			EndpointID: endpointID, OwnerUserHash: ownerHash, ScopeID: scopeID,
			HolderID: holderID, LeaseID: lease.Draft.LeaseID, ExpectedRevision: 0,
			Value: value, NowUnixMs: 1_001,
		}); err != nil {
			t.Fatal(err)
		}
		if _, err := store.db.Exec(`UPDATE ai_composer_drafts SET expires_at_unix_ms = 2_000 WHERE endpoint_id = ? AND owner_user_hash = ? AND scope_id = ?`, endpointID, ownerHash, scopeID); err != nil {
			t.Fatal(err)
		}
	}
	createDraft("scope_expired", "upload_expired", "surface_expired", false)
	createDraft("scope_admission", "upload_admission", "surface_admission", true)

	result, err := store.SweepExpiredComposerDrafts(ctx, 3_000, 10)
	if err != nil {
		t.Fatal(err)
	}
	if result.DraftsDeleted != 1 || len(result.UploadsToDelete) != 1 || result.UploadsToDelete[0].UploadID != "upload_expired" {
		t.Fatalf("sweep result=%#v", result)
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_composer_drafts WHERE endpoint_id = ? AND scope_id = 'scope_expired'`, endpointID) != 0 {
		t.Fatal("expired draft row remains")
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = 'upload_expired'`, endpointID) != 0 {
		t.Fatal("expired draft upload ref remains")
	}
	expiredUpload, err := store.GetUpload(ctx, endpointID, "upload_expired")
	if err != nil {
		t.Fatal(err)
	}
	if expiredUpload.State != UploadStateDeleting || expiredUpload.DeleteAfterUnixMs != 3_000 {
		t.Fatalf("expired upload=%#v", expiredUpload)
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_composer_drafts WHERE endpoint_id = ? AND scope_id = 'scope_admission'`, endpointID) != 1 {
		t.Fatal("sweep deleted admission-in-flight draft")
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = 'upload_admission' AND ref_kind = ? AND ref_id = ?`, endpointID, UploadRefKindDraft, composerDraftUploadRefID(ownerHash, "scope_admission")) != 1 {
		t.Fatal("sweep released admission-in-flight upload ref")
	}
	admissionUpload, err := store.GetUpload(ctx, endpointID, "upload_admission")
	if err != nil {
		t.Fatal(err)
	}
	if admissionUpload.State != UploadStateStaged {
		t.Fatalf("admission upload state=%q", admissionUpload.State)
	}
}

func TestComposerDraftRefsIsolateUsersSharingEndpointAndScope(t *testing.T) {
	t.Parallel()

	store := openStoreForTest(t)
	ctx := t.Context()
	const endpointID = "env_shared_scope"
	const scopeID = "thread_shared_scope"
	ownerA := strings.Repeat("a", 64)
	ownerB := strings.Repeat("b", 64)
	for _, fixture := range []struct {
		ownerHash string
		uploadID  string
		holderID  string
	}{
		{ownerHash: ownerA, uploadID: "upload_owner_a", holderID: "surface_a"},
		{ownerHash: ownerB, uploadID: "upload_owner_b", holderID: "surface_b"},
	} {
		if err := store.InsertUpload(ctx, composerDraftUploadForTest(endpointID, fixture.ownerHash, fixture.uploadID)); err != nil {
			t.Fatal(err)
		}
		if err := store.BindUserUploadsToDraft(ctx, endpointID, fixture.ownerHash, scopeID, []string{fixture.uploadID}, 1); err != nil {
			t.Fatal(err)
		}
		lease, err := store.AcquireComposerDraftLease(ctx, endpointID, fixture.ownerHash, scopeID, fixture.holderID, false, 1_000)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.MutateComposerDraft(ctx, ComposerDraftMutation{
			EndpointID: endpointID, OwnerUserHash: fixture.ownerHash, ScopeID: scopeID,
			HolderID: fixture.holderID, LeaseID: lease.Draft.LeaseID, ExpectedRevision: 0,
			Value: composerDraftValueForTest(fixture.uploadID, ComposerDraftModeOrdinary, fixture.uploadID), NowUnixMs: 1_001,
		}); err != nil {
			t.Fatal(err)
		}
	}

	refA := composerDraftUploadRefID(ownerA, scopeID)
	refB := composerDraftUploadRefID(ownerB, scopeID)
	if refA == refB || refA == scopeID || refB == scopeID {
		t.Fatalf("draft ref identities are not owner-bound: a=%q b=%q", refA, refB)
	}
	if _, err := store.GetDraftOwnedUpload(ctx, endpointID, ownerA, scopeID, "upload_owner_b"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("owner A read owner B upload: %v", err)
	}
	if _, err := store.db.ExecContext(ctx, `
UPDATE ai_composer_drafts
SET expires_at_unix_ms = CASE owner_user_hash WHEN ? THEN 2_000 ELSE 5_000 END
WHERE endpoint_id = ? AND scope_id = ?
`, ownerA, endpointID, scopeID); err != nil {
		t.Fatal(err)
	}
	result, err := store.SweepExpiredComposerDrafts(ctx, 3_000, 10)
	if err != nil {
		t.Fatal(err)
	}
	if result.DraftsDeleted != 1 || len(result.UploadsToDelete) != 1 || result.UploadsToDelete[0].UploadID != "upload_owner_a" {
		t.Fatalf("sweep result=%#v, want only owner A", result)
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_composer_drafts WHERE endpoint_id = ? AND owner_user_hash = ? AND scope_id = ?`, endpointID, ownerB, scopeID) != 1 {
		t.Fatal("owner A expiry deleted owner B draft")
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = 'upload_owner_b' AND ref_kind = ? AND ref_id = ?`, endpointID, UploadRefKindDraft, refB) != 1 {
		t.Fatal("owner A expiry deleted owner B draft ref")
	}
	ownerBUpload, err := store.GetDraftOwnedUpload(ctx, endpointID, ownerB, scopeID, "upload_owner_b")
	if err != nil || ownerBUpload.State != UploadStateStaged {
		t.Fatalf("owner B upload=%#v err=%v, want staged", ownerBUpload, err)
	}
}
