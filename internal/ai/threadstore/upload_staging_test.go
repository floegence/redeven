package threadstore

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func createProductV7DatabaseForStagingTest(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`
CREATE TABLE __redeven_db_meta (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1), db_kind TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0, last_migrated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_migrated_from_version INTEGER NOT NULL DEFAULT 0, last_migrated_to_version INTEGER NOT NULL DEFAULT 0
);
INSERT INTO __redeven_db_meta VALUES(1, 'ai_threadstore_product_v2', 1, 1, 7, 7);
`); err != nil {
		t.Fatal(err)
	}
	if err := createThreadstoreSchemaV7(tx); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`PRAGMA user_version=7`); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return db
}

func stagingScopeForTest(endpointID, threadID, ownerHash, scopeID string) UploadStagingScope {
	capabilityHash := sha256.Sum256([]byte(scopeID))
	return UploadStagingScope{
		StagingScopeID: scopeID, EndpointID: endpointID, OwnerUserHash: ownerHash, ThreadID: threadID,
		CapabilityHash: fmt.Sprintf("%x", capabilityHash), CreatedAtUnixMs: 10, ExpiresAtUnixMs: time.Now().Add(time.Hour).UnixMilli(),
	}
}

func attachmentAdmissionForTest(ownerHash, revision string, routes map[string]string) AttachmentAdmission {
	return AttachmentAdmission{
		OwnerUserHash: ownerHash, CapabilityRevision: revision,
		MaxCount: AttachmentAdmissionMaxCount, MaxTurnBytes: AttachmentAdmissionMaxTurnBytes,
		SupportsLongText: true, Routes: routes,
	}
}

func TestUploadStagingAuthorizationAndInitialTurnFreeze(t *testing.T) {
	store := openStoreForTest(t)
	ctx := t.Context()
	const endpointID = "env_staging"
	const threadID = "th_123456789012345678901234"
	const scopeID = "ustg_scope"
	const uploadID = "upl_123456789012345678901234"
	ownerHash := strings.Repeat("a", 64)
	scope := stagingScopeForTest(endpointID, threadID, ownerHash, scopeID)
	if err := store.CreateUploadStagingScope(ctx, scope); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AuthorizeUploadStagingScope(ctx, endpointID, ownerHash, scopeID, scope.CapabilityHash, 20); err != nil {
		t.Fatalf("authorize exact scope: %v", err)
	}
	if _, err := store.AuthorizeUploadStagingScope(ctx, endpointID, ownerHash, scopeID, strings.Repeat("d", 64), 20); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("wrong capability error=%v", err)
	}
	if err := store.InsertUpload(ctx, UploadRecord{
		UploadID: uploadID, EndpointID: endpointID, OwnerScopeKind: UploadOwnerScopeUser, OwnerUserHash: ownerHash,
		StorageRelPath: uploadID + ".data", Name: "notes.txt", DetectedMediaType: "text/plain",
		SizeBytes: 5, ContentSHA256: strings.Repeat("d", 64), Source: UploadSourceFile, State: UploadStateStaged, CreatedAtUnixMs: 10,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms) VALUES(?, ?, ?, ?, ?, ?)`, endpointID, uploadID, threadID, UploadRefKindStaging, stagingUploadRefID(ownerHash, scopeID), 10); err != nil {
		t.Fatal(err)
	}
	settings := ThreadSettings{
		ThreadID: threadID, EndpointID: endpointID, PermissionType: "approval_required", WorkingDir: "/tmp",
		SettingsCreatedAtUnixMs: 10, SettingsUpdatedAtUnixMs: 10,
	}
	rec := QueuedTurn{
		QueueID: "qt_initial", EndpointID: endpointID, ThreadID: threadID, ChannelID: "channel_1", Lane: FollowupLaneQueued,
		TurnID: "turn_initial", RunID: "run_initial", ModelID: "openai/model", TextContent: "hello",
		AttachmentsJSON: `[{"attachment_id":"` + uploadID + `"}]`, OptionsJSON: `{}`, SessionMetaJSON: `{}`, CreatedAtUnixMs: 10,
	}
	admission := attachmentAdmissionForTest(ownerHash, strings.Repeat("b", 64), map[string]string{"text/plain": "tool_read"})
	operation, queued, err := store.PrepareThreadCreateWithInitialTurn(ctx, PrepareThreadCreateRequest{Settings: settings}, rec, []string{uploadID}, 10, admission, &scope)
	if err != nil {
		t.Fatal(err)
	}
	if operation.Status != ThreadCreateOperationPending || queued.RunID != rec.RunID {
		t.Fatalf("operation=%#v queued=%#v", operation, queued)
	}
	if got := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_thread_settings WHERE thread_id = ?`, threadID); got != 0 {
		t.Fatalf("visible settings existed before Floret create: %d", got)
	}
	if got := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE upload_id = ? AND ref_kind = ? AND ref_id = ?`, uploadID, UploadRefKindStaging, stagingUploadRefID(ownerHash, scopeID)); got != 0 {
		t.Fatalf("staging claim remained: %d", got)
	}
	if got := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE upload_id = ? AND ref_kind = ? AND ref_id = ?`, uploadID, UploadRefKindQueuedTurn, rec.QueueID); got != 1 {
		t.Fatalf("queued claim count=%d", got)
	}
	if replayOperation, replayQueued, replayErr := store.PrepareThreadCreateWithInitialTurn(ctx, PrepareThreadCreateRequest{Settings: settings}, rec, []string{uploadID}, 10, admission, &scope); replayErr != nil || replayOperation.OperationID != operation.OperationID || replayQueued.RunID != rec.RunID {
		t.Fatalf("replay operation=%#v queued=%#v err=%v", replayOperation, replayQueued, replayErr)
	}
}

func TestPrepareThreadCreateWithInitialTurnReusesFirstFrozenIdentity(t *testing.T) {
	store := openStoreForTest(t)
	ctx := t.Context()
	settings := ThreadSettings{
		ThreadID: "th_123456789012345678901234", EndpointID: "env_initial_retry", NamespacePublicID: "ns_initial_retry",
		ModelID: "openai/gpt-5-mini", PermissionType: "approval_required", WorkingDir: "/tmp",
		CreatedByUserPublicID: "user_initial", CreatedByUserEmail: "initial@example.com",
		UpdatedByUserPublicID: "user_initial", UpdatedByUserEmail: "initial@example.com",
		SettingsCreatedAtUnixMs: 10, SettingsUpdatedAtUnixMs: 10,
	}
	first := QueuedTurn{
		QueueID: "qt_first", EndpointID: settings.EndpointID, ThreadID: settings.ThreadID, ChannelID: "channel_initial", Lane: FollowupLaneQueued,
		TurnID: "turn_initial", RunID: "run_first", ModelID: settings.ModelID, TextContent: "hello",
		AttachmentsJSON: `[]`, ContextActionJSON: "", OptionsJSON: `{"permission_type":"approval_required"}`,
		SessionMetaJSON: `{"channel_id":"channel_initial"}`, CreatedByUserPublicID: "user_initial", CreatedByUserEmail: "initial@example.com",
		CreatedAtUnixMs: 10, UpdatedAtUnixMs: 10,
	}
	admission := attachmentAdmissionForTest(strings.Repeat("a", 64), strings.Repeat("b", 64), nil)
	operation, frozen, err := store.PrepareThreadCreateWithInitialTurn(ctx, PrepareThreadCreateRequest{Settings: settings}, first, nil, 10, admission, nil)
	if err != nil {
		t.Fatal(err)
	}

	retry := first
	retry.QueueID = "qt_retry"
	retry.RunID = "run_retry"
	retry.SortIndex = 99
	retry.AdmissionState = PendingTurnAdmissionInFlight
	retry.CreatedAtUnixMs = 20
	retry.UpdatedAtUnixMs = 20
	replayedOperation, replayed, err := store.PrepareThreadCreateWithInitialTurn(ctx, PrepareThreadCreateRequest{Settings: settings}, retry, nil, 20, admission, nil)
	if err != nil {
		t.Fatal(err)
	}
	if replayedOperation.OperationID != operation.OperationID || replayed.QueueID != frozen.QueueID || replayed.RunID != frozen.RunID {
		t.Fatalf("operation=%#v queued=%#v, want first operation=%#v queued=%#v", replayedOperation, replayed, operation, frozen)
	}

	conflicts := []struct {
		name   string
		mutate func(*QueuedTurn)
	}{
		{name: "model", mutate: func(rec *QueuedTurn) { rec.ModelID = "openai/gpt-4o-mini" }},
		{name: "text", mutate: func(rec *QueuedTurn) { rec.TextContent = "different" }},
		{name: "attachments", mutate: func(rec *QueuedTurn) { rec.AttachmentsJSON = `[{"attachment_id":"upl_other"}]` }},
		{name: "context action", mutate: func(rec *QueuedTurn) { rec.ContextActionJSON = `{"schema_version":1}` }},
		{name: "options", mutate: func(rec *QueuedTurn) { rec.OptionsJSON = `{"permission_type":"full_access"}` }},
		{name: "session", mutate: func(rec *QueuedTurn) { rec.SessionMetaJSON = `{"channel_id":"other"}` }},
		{name: "channel", mutate: func(rec *QueuedTurn) { rec.ChannelID = "other" }},
	}
	for _, testCase := range conflicts {
		t.Run(testCase.name, func(t *testing.T) {
			changed := retry
			testCase.mutate(&changed)
			if _, _, err := store.PrepareThreadCreateWithInitialTurn(ctx, PrepareThreadCreateRequest{Settings: settings}, changed, nil, 20, admission, nil); !errors.Is(err, ErrFollowupReplacementConflict) {
				t.Fatalf("error=%v, want %v", err, ErrFollowupReplacementConflict)
			}
		})
	}
}

func TestPrepareThreadCreateWithInitialTurnConcurrentRetryReturnsOneIdentity(t *testing.T) {
	store := openStoreForTest(t)
	settings := ThreadSettings{
		ThreadID: "th_123456789012345678901245", EndpointID: "env_initial_concurrent", NamespacePublicID: "ns_initial_concurrent",
		ModelID: "openai/gpt-5-mini", PermissionType: "approval_required", WorkingDir: "/tmp",
		SettingsCreatedAtUnixMs: 10, SettingsUpdatedAtUnixMs: 10,
	}
	base := QueuedTurn{
		EndpointID: settings.EndpointID, ThreadID: settings.ThreadID, ChannelID: "channel_initial", Lane: FollowupLaneQueued,
		TurnID: "turn_initial_concurrent", ModelID: settings.ModelID, TextContent: "same intent",
		AttachmentsJSON: `[]`, OptionsJSON: `{}`, SessionMetaJSON: `{}`, CreatedAtUnixMs: 10,
	}
	admission := attachmentAdmissionForTest(strings.Repeat("a", 64), strings.Repeat("b", 64), nil)
	type result struct {
		operation ThreadCreateOperation
		queued    QueuedTurn
		err       error
	}
	results := make([]result, 2)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for index := range results {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			rec := base
			rec.QueueID = fmt.Sprintf("qt_concurrent_%d", index)
			rec.RunID = fmt.Sprintf("run_concurrent_%d", index)
			<-start
			results[index].operation, results[index].queued, results[index].err = store.PrepareThreadCreateWithInitialTurn(
				context.Background(), PrepareThreadCreateRequest{Settings: settings}, rec, nil, 10, admission, nil,
			)
		}(index)
	}
	close(start)
	wg.Wait()
	for index, result := range results {
		if result.err != nil {
			t.Fatalf("result %d: %v", index, result.err)
		}
	}
	if results[0].operation.OperationID != results[1].operation.OperationID ||
		results[0].queued.QueueID != results[1].queued.QueueID || results[0].queued.RunID != results[1].queued.RunID {
		t.Fatalf("results=%#v", results)
	}
	if got := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_thread_create_operations WHERE endpoint_id = ? AND thread_id = ?`, settings.EndpointID, settings.ThreadID); got != 1 {
		t.Fatalf("operation count=%d, want 1", got)
	}
	if got := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_queued_turns WHERE endpoint_id = ? AND thread_id = ?`, settings.EndpointID, settings.ThreadID); got != 1 {
		t.Fatalf("command count=%d, want 1", got)
	}
}

func TestReleaseExpiredUploadStagingScopesReleasesClaimsAndPreservesActiveScopes(t *testing.T) {
	store := openStoreForTest(t)
	ctx := t.Context()
	ownerHash := strings.Repeat("a", 64)
	expired := stagingScopeForTest("env_expiry", "th_123456789012345678901234", ownerHash, "scope_expired")
	expired.ExpiresAtUnixMs = 20
	active := stagingScopeForTest("env_expiry", "th_123456789012345678901234", ownerHash, "scope_active")
	active.ExpiresAtUnixMs = 40
	for _, scope := range []UploadStagingScope{expired, active} {
		if err := store.CreateUploadStagingScope(ctx, scope); err != nil {
			t.Fatal(err)
		}
	}
	for index, item := range []struct {
		uploadID string
		scope    UploadStagingScope
	}{{"upl_expired_123456789012345678", expired}, {"upl_active_12345678901234567890", active}} {
		if err := store.InsertUpload(ctx, UploadRecord{
			UploadID: item.uploadID, EndpointID: item.scope.EndpointID, OwnerScopeKind: UploadOwnerScopeUser, OwnerUserHash: ownerHash,
			StorageRelPath: item.uploadID + ".data", Name: "notes.txt", DetectedMediaType: "text/plain",
			SizeBytes: 5, ContentSHA256: strings.Repeat("d", 64), Source: UploadSourceFile, State: UploadStateStaged, CreatedAtUnixMs: int64(index + 1),
		}); err != nil {
			t.Fatal(err)
		}
		if _, err := store.db.ExecContext(ctx, `INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms) VALUES(?, ?, ?, ?, ?, ?)`, item.scope.EndpointID, item.uploadID, item.scope.ThreadID, UploadRefKindStaging, stagingUploadRefID(ownerHash, item.scope.StagingScopeID), index+1); err != nil {
			t.Fatal(err)
		}
	}
	cleanup, released, err := store.ReleaseExpiredUploadStagingScopes(ctx, 20, 10)
	if err != nil {
		t.Fatal(err)
	}
	if released != 1 || len(cleanup) != 1 || cleanup[0].UploadID != "upl_expired_123456789012345678" || cleanup[0].State != UploadStateDeleting {
		t.Fatalf("released=%d cleanup=%#v", released, cleanup)
	}
	if _, err := store.GetStagingOwnedUpload(ctx, active.EndpointID, ownerHash, active.StagingScopeID, "upl_active_12345678901234567890"); err != nil {
		t.Fatalf("active scope upload unavailable: %v", err)
	}
	if _, err := store.AuthorizeUploadStagingScope(ctx, expired.EndpointID, ownerHash, expired.StagingScopeID, expired.CapabilityHash, 19); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("released expired scope authorization error=%v", err)
	}
}

func TestProductV7AdmissionPreflightUsesExactTurnAndRollsBackUncertainReads(t *testing.T) {
	for _, testCase := range []struct {
		name        string
		preflight   func(context.Context, LegacyComposerAdmission) (LegacyComposerAdmissionDecision, error)
		wantFailure bool
	}{
		{name: "exact missing", preflight: func(_ context.Context, admission LegacyComposerAdmission) (LegacyComposerAdmissionDecision, error) {
			if admission.ThreadID != "th_123456789012345678901234" || admission.TurnID != "turn_v7" {
				t.Fatalf("admission=%#v", admission)
			}
			return LegacyComposerAdmissionDecision{State: LegacyComposerAdmissionMissing}, nil
		}},
		{name: "uncertain read", preflight: func(context.Context, LegacyComposerAdmission) (LegacyComposerAdmissionDecision, error) {
			return LegacyComposerAdmissionDecision{}, errors.New("floret store unavailable")
		}, wantFailure: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "threads.sqlite")
			raw := createProductV7DatabaseForStagingTest(t, path)
			value := `{"text":"hello","attachments":[],"references":[],"mode":"admission_in_flight","model_id":"openai/model","proposed_turn_id":"turn_v7","admission_started":true,"target_thread_id":"th_123456789012345678901234"}`
			if _, err := raw.Exec(`INSERT INTO ai_composer_drafts(endpoint_id, owner_user_hash, scope_id, revision, value_json, created_at_unix_ms, updated_at_unix_ms, expires_at_unix_ms) VALUES(?, ?, ?, 1, ?, 1, 1, 2)`, "env_v7", strings.Repeat("a", 64), "__new_thread__", value); err != nil {
				t.Fatal(err)
			}
			if err := raw.Close(); err != nil {
				t.Fatal(err)
			}
			store, err := Open(path, WithLegacyComposerAdmissionPreflight(t.TempDir(), testCase.preflight))
			if testCase.wantFailure {
				if err == nil || !strings.Contains(err.Error(), "floret store unavailable") {
					t.Fatalf("Open error=%v", err)
				}
				check, openErr := sql.Open("sqlite", path)
				if openErr != nil {
					t.Fatal(openErr)
				}
				defer check.Close()
				if got := countRowsForTest(t, check, `SELECT COUNT(1) FROM ai_composer_drafts`); got != 1 {
					t.Fatalf("rollback draft count=%d", got)
				}
				var version int
				if err := check.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != 7 {
					t.Fatalf("version=%d err=%v", version, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer store.Close()
			if got := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name='ai_composer_drafts'`); got != 0 {
				t.Fatalf("legacy table count=%d", got)
			}
		})
	}
}

func seedProductV7ComposerAttachmentForMigrationTest(
	t *testing.T,
	db *sql.DB,
	endpointID string,
	ownerHash string,
	scopeID string,
	threadID string,
	turnID string,
	uploadID string,
	uploadsDir string,
) {
	t.Helper()
	body := []byte("legacy-attachment")
	digest := sha256.Sum256(body)
	if err := os.MkdirAll(uploadsDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(uploadsDir, uploadID+".data"), body, 0o600); err != nil {
		t.Fatal(err)
	}
	value := fmt.Sprintf(`{"text":"hello","attachments":[{"staged":{"attachment_id":%q}}],"references":[],"mode":"admission_in_flight","model_id":"openai/model","proposed_turn_id":%q,"admission_started":true,"target_thread_id":%q}`, uploadID, turnID, threadID)
	if _, err := db.Exec(`
INSERT INTO ai_uploads(
  upload_id, endpoint_id, owner_scope_kind, owner_user_hash, storage_relpath, name,
  detected_media_type, size_bytes, content_sha256, source, state, created_at_unix_ms
) VALUES(?, ?, 'user', ?, ?, 'notes.txt', 'text/plain', 17, ?, 'uploaded_file', 'staged', 10)
`, uploadID, endpointID, ownerHash, uploadID+".data", hex.EncodeToString(digest[:])); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
VALUES
  (?, ?, '', 'draft', ?, 11),
  (?, ?, 'shared_thread', 'thread', 'shared_thread', 12)
`, endpointID, uploadID, legacyComposerDraftUploadRefID(ownerHash, scopeID), endpointID, uploadID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
INSERT INTO ai_composer_drafts(
  endpoint_id, owner_user_hash, scope_id, revision, value_json,
  created_at_unix_ms, updated_at_unix_ms, expires_at_unix_ms
) VALUES(?, ?, ?, 1, ?, 1, 1, 2)
`, endpointID, ownerHash, scopeID, value); err != nil {
		t.Fatal(err)
	}
}

func admittedLegacyComposerDecision(admission LegacyComposerAdmission) LegacyComposerAdmissionDecision {
	attachments := make([]LegacyComposerCanonicalAttachment, 0, len(admission.Attachments))
	for _, attachment := range admission.Attachments {
		attachments = append(attachments, LegacyComposerCanonicalAttachment{
			UploadID:      attachment.UploadID,
			ResourceRef:   "redeven-upload:v1:" + attachment.UploadID + ":sha256:" + attachment.ContentSHA256,
			Name:          attachment.Name,
			MIMEType:      attachment.DetectedMediaType,
			SizeBytes:     attachment.SizeBytes,
			ContentSHA256: attachment.ContentSHA256,
		})
	}
	return LegacyComposerAdmissionDecision{State: LegacyComposerAdmissionAdmitted, Attachments: attachments}
}

func assertProductV7ComposerAttachmentMigrated(
	t *testing.T,
	store *Store,
	endpointID string,
	ownerHash string,
	uploadID string,
	targetRefKind string,
	targetRefID string,
	threadID string,
) {
	t.Helper()
	upload, err := store.GetUpload(t.Context(), endpointID, uploadID)
	if err != nil {
		t.Fatal(err)
	}
	if upload.OwnerScopeKind != UploadOwnerScopeUser || upload.OwnerUserHash != ownerHash || len(upload.ContentSHA256) != 64 || upload.SizeBytes != 17 || upload.State != UploadStateLive {
		t.Fatalf("migrated upload=%#v", upload)
	}
	if got := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = ? AND thread_id = ? AND ref_kind = ? AND ref_id = ?`, endpointID, uploadID, threadID, targetRefKind, targetRefID); got != 1 {
		t.Fatalf("target ref count=%d", got)
	}
	if got := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = ? AND ref_kind = 'thread' AND ref_id = 'shared_thread'`, endpointID, uploadID); got != 1 {
		t.Fatalf("shared ref count=%d", got)
	}
	if got := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = ? AND ref_kind IN ('draft', 'draft_pending')`, endpointID, uploadID); got != 0 {
		t.Fatalf("legacy draft ref count=%d", got)
	}
}

func TestProductV7MigrationTransfersAdmittedComposerAttachmentToThread(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV7DatabaseForStagingTest(t, path)
	const endpointID = "env_v7_admitted"
	const scopeID = "__new_thread__"
	const threadID = "th_v7_admitted_123456789012"
	const turnID = "turn_v7_admitted"
	const uploadID = "upl_v7_admitted_123456789012"
	ownerHash := strings.Repeat("a", 64)
	uploadsDir := t.TempDir()
	seedProductV7ComposerAttachmentForMigrationTest(t, raw, endpointID, ownerHash, scopeID, threadID, turnID, uploadID, uploadsDir)
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	store, err := Open(path, WithLegacyComposerAdmissionPreflight(uploadsDir, func(_ context.Context, admission LegacyComposerAdmission) (LegacyComposerAdmissionDecision, error) {
		if admission.EndpointID != endpointID || admission.OwnerUserHash != ownerHash || admission.ScopeID != scopeID || admission.ThreadID != threadID || admission.TurnID != turnID || len(admission.Attachments) != 1 || admission.Attachments[0].UploadID != uploadID {
			t.Fatalf("admission=%#v", admission)
		}
		return admittedLegacyComposerDecision(admission), nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	assertProductV7ComposerAttachmentMigrated(t, store, endpointID, ownerHash, uploadID, UploadRefKindThread, threadID, threadID)
}

func TestProductV7MigrationPreservesExistingCanonicalThreadAttachmentRef(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV7DatabaseForStagingTest(t, path)
	const endpointID = "env_v7_existing_ref"
	const scopeID = "th_v7_existing_ref_123456789"
	const threadID = scopeID
	const turnID = "turn_v7_existing_ref"
	const uploadID = "upl_v7_existing_ref_123456789"
	ownerHash := strings.Repeat("d", 64)
	uploadsDir := t.TempDir()
	seedProductV7ComposerAttachmentForMigrationTest(t, raw, endpointID, ownerHash, scopeID, threadID, turnID, uploadID, uploadsDir)
	if _, err := raw.Exec("INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms) VALUES(?, ?, ?, 'thread', ?, 13)", endpointID, uploadID, threadID, threadID); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	store, err := Open(path, WithLegacyComposerAdmissionPreflight(uploadsDir, func(_ context.Context, admission LegacyComposerAdmission) (LegacyComposerAdmissionDecision, error) {
		return admittedLegacyComposerDecision(admission), nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	assertProductV7ComposerAttachmentMigrated(t, store, endpointID, ownerHash, uploadID, UploadRefKindThread, threadID, threadID)
	if got := countRowsForTest(t, store.db, "SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = ? AND ref_kind = 'thread' AND ref_id = ?", endpointID, uploadID, threadID); got != 1 {
		t.Fatalf("canonical thread ref count=%d", got)
	}
}

func TestProductV7AdmissionPreflightFailsClosedOnAttachmentDrift(t *testing.T) {
	for _, testCase := range []struct {
		name     string
		mutate   func(*testing.T, *sql.DB, string, string, string)
		decision func(LegacyComposerAdmission) LegacyComposerAdmissionDecision
		want     string
	}{
		{
			name: "canonical membership",
			decision: func(admission LegacyComposerAdmission) LegacyComposerAdmissionDecision {
				decision := admittedLegacyComposerDecision(admission)
				decision.Attachments = nil
				return decision
			},
			want: "canonical attachment membership changed",
		},
		{
			name: "canonical MIME",
			decision: func(admission LegacyComposerAdmission) LegacyComposerAdmissionDecision {
				decision := admittedLegacyComposerDecision(admission)
				decision.Attachments[0].MIMEType = "application/pdf"
				return decision
			},
			want: "canonical attachment membership changed",
		},
		{
			name: "canonical size",
			decision: func(admission LegacyComposerAdmission) LegacyComposerAdmissionDecision {
				decision := admittedLegacyComposerDecision(admission)
				decision.Attachments[0].SizeBytes++
				return decision
			},
			want: "canonical attachment membership changed",
		},
		{
			name: "owner mismatch",
			mutate: func(t *testing.T, db *sql.DB, endpointID, uploadID, _ string) {
				t.Helper()
				if _, err := db.Exec("UPDATE ai_uploads SET owner_user_hash = ? WHERE endpoint_id = ? AND upload_id = ?", strings.Repeat("f", 64), endpointID, uploadID); err != nil {
					t.Fatal(err)
				}
			},
			want: "owner mismatch",
		},
		{
			name: "missing bytes",
			mutate: func(t *testing.T, _ *sql.DB, _, uploadID, uploadsDir string) {
				t.Helper()
				if err := os.Remove(filepath.Join(uploadsDir, uploadID+".data")); err != nil {
					t.Fatal(err)
				}
			},
			want: "bytes unavailable",
		},
		{
			name: "digest drift",
			mutate: func(t *testing.T, _ *sql.DB, _, uploadID, uploadsDir string) {
				t.Helper()
				if err := os.WriteFile(filepath.Join(uploadsDir, uploadID+".data"), []byte("legacy-attachmenx"), 0o600); err != nil {
					t.Fatal(err)
				}
			},
			want: "bytes do not match stored size and digest",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "threads.sqlite")
			raw := createProductV7DatabaseForStagingTest(t, path)
			const endpointID = "env_v7_preflight_drift"
			const scopeID = "__new_thread__"
			const threadID = "th_v7_preflight_drift_123456"
			const turnID = "turn_v7_preflight_drift"
			const uploadID = "upl_v7_preflight_drift_123456"
			ownerHash := strings.Repeat("e", 64)
			uploadsDir := t.TempDir()
			seedProductV7ComposerAttachmentForMigrationTest(t, raw, endpointID, ownerHash, scopeID, threadID, turnID, uploadID, uploadsDir)
			if testCase.mutate != nil {
				testCase.mutate(t, raw, endpointID, uploadID, uploadsDir)
			}
			if err := raw.Close(); err != nil {
				t.Fatal(err)
			}
			decision := testCase.decision
			if decision == nil {
				decision = admittedLegacyComposerDecision
			}
			store, err := Open(path, WithLegacyComposerAdmissionPreflight(uploadsDir, func(_ context.Context, admission LegacyComposerAdmission) (LegacyComposerAdmissionDecision, error) {
				return decision(admission), nil
			}))
			if store != nil {
				_ = store.Close()
			}
			if err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("Open error=%v, want %q", err, testCase.want)
			}
			check, openErr := sql.Open("sqlite", path)
			if openErr != nil {
				t.Fatal(openErr)
			}
			defer check.Close()
			var version int
			if err := check.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 7 {
				t.Fatalf("version=%d err=%v", version, err)
			}
			if got := countRowsForTest(t, check, "SELECT COUNT(1) FROM ai_composer_drafts WHERE endpoint_id = ? AND scope_id = ?", endpointID, scopeID); got != 1 {
				t.Fatalf("draft count after failed preflight=%d", got)
			}
			if got := countRowsForTest(t, check, "SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = ? AND ref_kind = 'draft'", endpointID, uploadID); got != 1 {
				t.Fatalf("draft ref count after failed preflight=%d", got)
			}
		})
	}
}

func TestProductV7AdmissionPreflightCompletesAllRowsBeforeMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV7DatabaseForStagingTest(t, path)
	uploadsDir := t.TempDir()
	ownerHash := strings.Repeat("a", 64)
	seedProductV7ComposerAttachmentForMigrationTest(
		t, raw, "env_a", ownerHash, "__new_thread__", "th_v7_multi_a_123456789012", "turn_v7_multi_a",
		"upl_v7_multi_a_123456789012", uploadsDir,
	)
	seedProductV7ComposerAttachmentForMigrationTest(
		t, raw, "env_b", ownerHash, "__new_thread__", "th_v7_multi_b_123456789012", "turn_v7_multi_b",
		"upl_v7_multi_b_123456789012", uploadsDir,
	)
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	seen := 0
	store, err := Open(path, WithLegacyComposerAdmissionPreflight(uploadsDir, func(_ context.Context, admission LegacyComposerAdmission) (LegacyComposerAdmissionDecision, error) {
		seen++
		if admission.EndpointID == "env_b" {
			return LegacyComposerAdmissionDecision{}, errors.New("second canonical read failed")
		}
		return admittedLegacyComposerDecision(admission), nil
	}))
	if store != nil {
		_ = store.Close()
	}
	if err == nil || !strings.Contains(err.Error(), "second canonical read failed") || seen != 2 {
		t.Fatalf("Open error=%v seen=%d", err, seen)
	}
	check, openErr := sql.Open("sqlite", path)
	if openErr != nil {
		t.Fatal(openErr)
	}
	defer check.Close()
	var version int
	if err := check.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 7 {
		t.Fatalf("version=%d err=%v", version, err)
	}
	if got := countRowsForTest(t, check, "SELECT COUNT(1) FROM ai_composer_drafts"); got != 2 {
		t.Fatalf("draft count after failed multi-row preflight=%d", got)
	}
	if got := countRowsForTest(t, check, "SELECT COUNT(1) FROM ai_upload_refs WHERE ref_kind = 'draft'"); got != 2 {
		t.Fatalf("draft ref count after failed multi-row preflight=%d", got)
	}
}

func TestProductV7MigrationRollsBackEarlierRowsWhenLaterFrozenAdmissionDrifts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV7DatabaseForStagingTest(t, path)
	uploadsDir := t.TempDir()
	ownerHash := strings.Repeat("a", 64)
	const firstUploadID = "upl_v7_sql_rollback_a_123456"
	const secondUploadID = "upl_v7_sql_rollback_b_123456"
	seedProductV7ComposerAttachmentForMigrationTest(
		t, raw, "env_a", ownerHash, "__new_thread__", "th_v7_sql_rollback_a_123456", "turn_v7_sql_rollback_a",
		firstUploadID, uploadsDir,
	)
	seedProductV7ComposerAttachmentForMigrationTest(
		t, raw, "env_b", ownerHash, "__new_thread__", "th_v7_sql_rollback_b_123456", "turn_v7_sql_rollback_b",
		secondUploadID, uploadsDir,
	)
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	store, err := Open(path, WithLegacyComposerAdmissionPreflight(uploadsDir, func(_ context.Context, admission LegacyComposerAdmission) (LegacyComposerAdmissionDecision, error) {
		decision := admittedLegacyComposerDecision(admission)
		if admission.EndpointID != "env_b" {
			return decision, nil
		}
		writer, openErr := sql.Open("sqlite", path)
		if openErr != nil {
			t.Fatal(openErr)
		}
		defer writer.Close()
		if _, updateErr := writer.Exec("UPDATE ai_uploads SET name = 'changed-after-preflight.txt' WHERE endpoint_id = ? AND upload_id = ?", admission.EndpointID, secondUploadID); updateErr != nil {
			t.Fatal(updateErr)
		}
		return decision, nil
	}))
	if store != nil {
		_ = store.Close()
	}
	if err == nil || !strings.Contains(err.Error(), "changed after preflight") {
		t.Fatalf("Open error=%v", err)
	}
	check, openErr := sql.Open("sqlite", path)
	if openErr != nil {
		t.Fatal(openErr)
	}
	defer check.Close()
	var version int
	if err := check.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 7 {
		t.Fatalf("version=%d err=%v", version, err)
	}
	if got := countRowsForTest(t, check, "SELECT COUNT(1) FROM ai_composer_drafts"); got != 2 {
		t.Fatalf("draft count after SQL rollback=%d", got)
	}
	if got := countRowsForTest(t, check, "SELECT COUNT(1) FROM ai_upload_refs WHERE ref_kind = 'draft'"); got != 2 {
		t.Fatalf("draft ref count after SQL rollback=%d", got)
	}
	if got := countRowsForTest(t, check, "SELECT COUNT(1) FROM ai_upload_refs WHERE ref_kind = 'thread' AND ref_id IN (?, ?)", "th_v7_sql_rollback_a_123456", "th_v7_sql_rollback_b_123456"); got != 0 {
		t.Fatalf("rolled back canonical thread ref count=%d", got)
	}
	var firstState string
	if err := check.QueryRow("SELECT state FROM ai_uploads WHERE endpoint_id = 'env_a' AND upload_id = ?", firstUploadID).Scan(&firstState); err != nil || firstState != UploadStateStaged {
		t.Fatalf("first upload state=%q err=%v", firstState, err)
	}
}

func TestProductV7MigrationTransfersExactQueuedComposerAttachment(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV7DatabaseForStagingTest(t, path)
	const endpointID = "env_v7_queued"
	const scopeID = "th_v7_queued_12345678901234"
	const threadID = scopeID
	const turnID = "turn_v7_queued"
	const queueID = "queue_v7_exact"
	const uploadID = "upl_v7_queued_12345678901234"
	ownerHash := strings.Repeat("b", 64)
	uploadsDir := t.TempDir()
	seedProductV7ComposerAttachmentForMigrationTest(t, raw, endpointID, ownerHash, scopeID, threadID, turnID, uploadID, uploadsDir)
	if _, err := raw.Exec(`
INSERT INTO ai_queued_turns(
  queue_id, endpoint_id, thread_id, turn_id, run_id, model_id, text_content,
  attachments_json, context_action_json, created_at_unix_ms
) VALUES(?, ?, ?, ?, 'run_v7_queued', 'openai/model', 'hello', ?, '', 20)
`, queueID, endpointID, threadID, turnID, fmt.Sprintf(`[{"attachment_id":%q}]`, uploadID)); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	store, err := Open(path, WithLegacyComposerAdmissionPreflight(uploadsDir, nil))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	assertProductV7ComposerAttachmentMigrated(t, store, endpointID, ownerHash, uploadID, UploadRefKindQueuedTurn, queueID, threadID)
}

func TestProductV7QueuedAdmissionFailsClosedOnAttachmentDrift(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		mutate func(*testing.T, *sql.DB, string, string, string)
		want   string
	}{
		{
			name: "owner mismatch",
			mutate: func(t *testing.T, db *sql.DB, endpointID, uploadID, _ string) {
				t.Helper()
				if _, err := db.Exec("UPDATE ai_uploads SET owner_user_hash = ? WHERE endpoint_id = ? AND upload_id = ?", strings.Repeat("f", 64), endpointID, uploadID); err != nil {
					t.Fatal(err)
				}
			},
			want: "owner mismatch",
		},
		{
			name: "missing bytes",
			mutate: func(t *testing.T, _ *sql.DB, _, uploadID, uploadsDir string) {
				t.Helper()
				if err := os.Remove(filepath.Join(uploadsDir, uploadID+".data")); err != nil {
					t.Fatal(err)
				}
			},
			want: "bytes unavailable",
		},
		{
			name: "digest drift",
			mutate: func(t *testing.T, _ *sql.DB, _, uploadID, uploadsDir string) {
				t.Helper()
				if err := os.WriteFile(filepath.Join(uploadsDir, uploadID+".data"), []byte("legacy-attachmenx"), 0o600); err != nil {
					t.Fatal(err)
				}
			},
			want: "bytes do not match stored size and digest",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "threads.sqlite")
			raw := createProductV7DatabaseForStagingTest(t, path)
			const endpointID = "env_v7_queued_drift"
			const scopeID = "th_v7_queued_drift_123456789"
			const threadID = scopeID
			const turnID = "turn_v7_queued_drift"
			const queueID = "queue_v7_queued_drift"
			const uploadID = "upl_v7_queued_drift_12345678"
			ownerHash := strings.Repeat("b", 64)
			uploadsDir := t.TempDir()
			seedProductV7ComposerAttachmentForMigrationTest(t, raw, endpointID, ownerHash, scopeID, threadID, turnID, uploadID, uploadsDir)
			if _, err := raw.Exec("INSERT INTO ai_queued_turns(queue_id, endpoint_id, thread_id, turn_id, run_id, model_id, text_content, attachments_json, context_action_json, created_at_unix_ms) VALUES(?, ?, ?, ?, 'run_v7_queued_drift', 'openai/model', 'hello', ?, '', 20)", queueID, endpointID, threadID, turnID, fmt.Sprintf("[{\"attachment_id\":%q}]", uploadID)); err != nil {
				t.Fatal(err)
			}
			testCase.mutate(t, raw, endpointID, uploadID, uploadsDir)
			if err := raw.Close(); err != nil {
				t.Fatal(err)
			}
			store, err := Open(path, WithLegacyComposerAdmissionPreflight(uploadsDir, nil))
			if store != nil {
				_ = store.Close()
			}
			if err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("Open error=%v, want %q", err, testCase.want)
			}
			check, openErr := sql.Open("sqlite", path)
			if openErr != nil {
				t.Fatal(openErr)
			}
			defer check.Close()
			var version int
			if err := check.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 7 {
				t.Fatalf("version=%d err=%v", version, err)
			}
			if got := countRowsForTest(t, check, "SELECT COUNT(1) FROM ai_queued_turns WHERE queue_id = ?", queueID); got != 1 {
				t.Fatalf("queued row count after failed preflight=%d", got)
			}
			if got := countRowsForTest(t, check, "SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = ? AND ref_kind = 'draft'", endpointID, uploadID); got != 1 {
				t.Fatalf("draft ref count after failed preflight=%d", got)
			}
		})
	}
}

func TestProductV7MigrationRejectsMismatchedComposerAttachmentsAndRollsBack(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		mutate func(*testing.T, *sql.DB, string, string, string)
		want   string
	}{
		{
			name: "queued attachment mismatch",
			mutate: func(t *testing.T, db *sql.DB, endpointID, threadID, turnID string) {
				t.Helper()
				if _, err := db.Exec(`INSERT INTO ai_queued_turns(queue_id, endpoint_id, thread_id, turn_id, run_id, model_id, text_content, attachments_json, context_action_json, created_at_unix_ms) VALUES('queue_mismatch', ?, ?, ?, 'run_mismatch', 'openai/model', 'hello', '[{"attachment_id":"upl_other"}]', '', 20)`, endpointID, threadID, turnID); err != nil {
					t.Fatal(err)
				}
			},
			want: "conflicts with composer admission",
		},
		{
			name: "duplicate draft claims",
			mutate: func(t *testing.T, db *sql.DB, endpointID, _, _ string) {
				t.Helper()
				if _, err := db.Exec(`INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms) SELECT endpoint_id, upload_id, thread_id, 'draft_pending', ref_id, 13 FROM ai_upload_refs WHERE endpoint_id = ? AND ref_kind = 'draft'`, endpointID); err != nil {
					t.Fatal(err)
				}
			},
			want: "does not have one exact draft claim",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "threads.sqlite")
			raw := createProductV7DatabaseForStagingTest(t, path)
			const endpointID = "env_v7_rollback"
			const scopeID = "__new_thread__"
			const threadID = "th_v7_rollback_123456789012"
			const turnID = "turn_v7_rollback"
			const uploadID = "upl_v7_rollback_123456789012"
			ownerHash := strings.Repeat("c", 64)
			uploadsDir := t.TempDir()
			seedProductV7ComposerAttachmentForMigrationTest(t, raw, endpointID, ownerHash, scopeID, threadID, turnID, uploadID, uploadsDir)
			testCase.mutate(t, raw, endpointID, threadID, turnID)
			if err := raw.Close(); err != nil {
				t.Fatal(err)
			}
			store, err := Open(path, WithLegacyComposerAdmissionPreflight(uploadsDir, func(_ context.Context, admission LegacyComposerAdmission) (LegacyComposerAdmissionDecision, error) {
				return admittedLegacyComposerDecision(admission), nil
			}))
			if store != nil {
				_ = store.Close()
			}
			if err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("Open error=%v, want %q", err, testCase.want)
			}
			check, openErr := sql.Open("sqlite", path)
			if openErr != nil {
				t.Fatal(openErr)
			}
			defer check.Close()
			var version int
			if err := check.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != 7 {
				t.Fatalf("version=%d err=%v", version, err)
			}
			if got := countRowsForTest(t, check, `SELECT COUNT(1) FROM ai_composer_drafts WHERE endpoint_id = ? AND scope_id = ?`, endpointID, scopeID); got != 1 {
				t.Fatalf("rollback draft count=%d", got)
			}
			if got := countRowsForTest(t, check, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = ? AND ref_kind = 'thread' AND ref_id = ?`, endpointID, uploadID, threadID); got != 0 {
				t.Fatalf("rolled back target ref count=%d", got)
			}
			var state string
			if err := check.QueryRow(`SELECT state FROM ai_uploads WHERE endpoint_id = ? AND upload_id = ?`, endpointID, uploadID).Scan(&state); err != nil || state != UploadStateStaged {
				t.Fatalf("rollback upload state=%q err=%v", state, err)
			}
		})
	}
}
