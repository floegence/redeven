package threadstore

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func quotaUploadRecord(ownerHash string, uploadID string, size int64) UploadRecord {
	return UploadRecord{
		UploadID: uploadID, EndpointID: "env_quota", OwnerScopeKind: UploadOwnerScopeUser, OwnerUserHash: ownerHash,
		StorageRelPath: uploadID + ".data", Name: uploadID + ".txt", DetectedMediaType: "text/plain; charset=utf-8",
		SizeBytes: size, ContentSHA256: strings.Repeat("d", 64), Source: UploadSourceFile,
		State: UploadStateStaged, CreatedAtUnixMs: 1, DeleteAfterUnixMs: 2,
	}
}

func completeUploadAttemptForTest(t *testing.T, store *Store, attempt UploadAttemptRecord, rec UploadRecord) UploadStagingScope {
	t.Helper()
	now := time.Now()
	capabilityHash := sha256.Sum256([]byte(rec.UploadID))
	scope := UploadStagingScope{
		StagingScopeID:  "scope_" + rec.UploadID,
		EndpointID:      rec.EndpointID,
		OwnerUserHash:   rec.OwnerUserHash,
		TargetID:        "thread_" + rec.UploadID,
		CapabilityHash:  fmt.Sprintf("%x", capabilityHash),
		CreatedAtUnixMs: now.Add(-time.Minute).UnixMilli(),
		ExpiresAtUnixMs: now.Add(time.Hour).UnixMilli(),
	}
	if err := store.CreateUploadStagingScope(t.Context(), scope); err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteUploadAttemptToStaging(t.Context(), attempt, rec, scope); err != nil {
		t.Fatal(err)
	}
	return scope
}

func TestUploadAttemptReservationAndCompletionAreOwnerScopedAndIdempotent(t *testing.T) {
	t.Parallel()
	store, err := Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ownerHash := strings.Repeat("a", 64)
	attempt := UploadAttemptRecord{
		EndpointID: "env_1", OwnerUserHash: ownerHash, UploadRequestID: "request_1",
		RequestFingerprint: strings.Repeat("b", 64), UploadID: "upl_123456789012345678901234", CreatedAtUnixMs: 1,
	}
	reserved, created, err := store.ReserveUploadAttempt(context.Background(), attempt)
	if err != nil || !created || reserved.UploadID != attempt.UploadID {
		t.Fatalf("reserve=(%#v,%t,%v)", reserved, created, err)
	}
	replayed, created, err := store.ReserveUploadAttempt(context.Background(), attempt)
	if err != nil || created || replayed.UploadID != attempt.UploadID || replayed.Status != UploadAttemptReceiving {
		t.Fatalf("replay=(%#v,%t,%v)", replayed, created, err)
	}
	conflict := attempt
	conflict.RequestFingerprint = strings.Repeat("c", 64)
	if _, _, err := store.ReserveUploadAttempt(context.Background(), conflict); !errors.Is(err, ErrUploadIdempotencyConflict) {
		t.Fatalf("conflict error=%v", err)
	}
	rec := UploadRecord{
		UploadID: attempt.UploadID, EndpointID: attempt.EndpointID,
		OwnerScopeKind: UploadOwnerScopeUser, OwnerUserHash: ownerHash,
		StorageRelPath: attempt.UploadID + ".data", Name: "notes.txt", DetectedMediaType: "text/plain; charset=utf-8",
		SizeBytes: 4, ContentSHA256: strings.Repeat("d", 64), Source: UploadSourceFile,
		State: UploadStateStaged, CreatedAtUnixMs: 2, DeleteAfterUnixMs: 3,
	}
	completeUploadAttemptForTest(t, store, attempt, rec)
	completed, created, err := store.ReserveUploadAttempt(context.Background(), attempt)
	if err != nil || created || completed.Status != UploadAttemptComplete {
		t.Fatalf("completed=(%#v,%t,%v)", completed, created, err)
	}
	stored, err := store.GetUserOwnedUpload(context.Background(), attempt.EndpointID, ownerHash, attempt.UploadID)
	if err != nil || stored.ContentSHA256 != rec.ContentSHA256 {
		t.Fatalf("stored=%#v err=%v", stored, err)
	}
	if _, err := store.GetUserOwnedUpload(context.Background(), attempt.EndpointID, strings.Repeat("e", 64), attempt.UploadID); err == nil {
		t.Fatal("different owner read completed upload")
	}
}

func TestStagingUploadRefsProtectResourcesUntilScopeRelease(t *testing.T) {
	t.Parallel()
	store, err := Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ownerHash := strings.Repeat("a", 64)
	rec := UploadRecord{
		UploadID: "upl_123456789012345678901234", EndpointID: "env_1",
		OwnerScopeKind: UploadOwnerScopeUser, OwnerUserHash: ownerHash,
		StorageRelPath: "upl_123456789012345678901234.data", Name: "notes.txt",
		DetectedMediaType: "text/plain; charset=utf-8", SizeBytes: 4,
		ContentSHA256: strings.Repeat("d", 64), Source: UploadSourceLongText,
		State: UploadStateStaged, CreatedAtUnixMs: 1, DeleteAfterUnixMs: 2,
	}
	if err := store.InsertUpload(context.Background(), rec); err != nil {
		t.Fatal(err)
	}
	scope := stagingScopeForTest(rec.EndpointID, "thread_1", ownerHash, "scope_1")
	if err := store.CreateUploadStagingScope(t.Context(), scope); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms) VALUES(?, ?, ?, ?, ?, ?)`, rec.EndpointID, rec.UploadID, scope.TargetID, UploadRefKindStaging, stagingUploadRefID(ownerHash, scope.StagingScopeID), 3); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PrepareUserStagedUploadDeletion(context.Background(), rec.EndpointID, ownerHash, rec.UploadID, 5); err == nil {
		t.Fatal("deletion ignored an active staging ref")
	}
	cleanup, err := store.ReleaseUploadStagingScope(context.Background(), scope, 6)
	if err != nil || len(cleanup) != 1 || cleanup[0].State != UploadStateDeleting {
		t.Fatalf("release cleanup=%#v err=%v", cleanup, err)
	}
}

func TestStagedOwnerQuotaSerializesConcurrentCompletions(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ownerHash := strings.Repeat("a", 64)
	for index := 0; index < UploadStagedOwnerItemLimit-1; index++ {
		if err := store.InsertUpload(context.Background(), quotaUploadRecord(ownerHash, fmt.Sprintf("upl_existing_%03d", index), 1)); err != nil {
			t.Fatal(err)
		}
	}
	type candidate struct {
		attempt UploadAttemptRecord
		record  UploadRecord
	}
	candidates := make([]candidate, 2)
	for index := range candidates {
		attempt := UploadAttemptRecord{
			EndpointID: "env_quota", OwnerUserHash: ownerHash, UploadRequestID: fmt.Sprintf("request_%d", index),
			RequestFingerprint: fmt.Sprintf("fingerprint_%d", index), UploadID: fmt.Sprintf("upl_candidate_%d", index), CreatedAtUnixMs: 10,
		}
		reserved, created, err := store.ReserveUploadAttempt(context.Background(), attempt)
		if err != nil || !created {
			t.Fatalf("reserve=%#v created=%t err=%v", reserved, created, err)
		}
		candidates[index] = candidate{attempt: reserved, record: quotaUploadRecord(ownerHash, attempt.UploadID, 1)}
	}
	var wg sync.WaitGroup
	results := make(chan error, len(candidates))
	for _, item := range candidates {
		item := item
		wg.Add(1)
		go func() {
			defer wg.Done()
			now := time.Now()
			scope := UploadStagingScope{
				StagingScopeID: "scope_" + item.record.UploadID, EndpointID: item.record.EndpointID,
				OwnerUserHash: item.record.OwnerUserHash, TargetID: "thread_" + item.record.UploadID,
				CapabilityHash: fmt.Sprintf("%x", sha256.Sum256([]byte(item.record.UploadID))), CreatedAtUnixMs: now.Add(-time.Minute).UnixMilli(), ExpiresAtUnixMs: now.Add(time.Hour).UnixMilli(),
			}
			if err := store.CreateUploadStagingScope(context.Background(), scope); err != nil {
				results <- err
				return
			}
			results <- store.CompleteUploadAttemptToStaging(context.Background(), item.attempt, item.record, scope)
		}()
	}
	wg.Wait()
	close(results)
	var succeeded, rejected int
	for err := range results {
		switch {
		case err == nil:
			succeeded++
		case errors.Is(err, ErrUploadQuotaExceeded):
			rejected++
		default:
			t.Fatalf("completion error=%v", err)
		}
	}
	if succeeded != 1 || rejected != 1 {
		t.Fatalf("succeeded=%d rejected=%d", succeeded, rejected)
	}
	if got := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_uploads WHERE endpoint_id = ? AND owner_user_hash = ? AND state = ?`, "env_quota", ownerHash, UploadStateStaged); got != UploadStagedOwnerItemLimit {
		t.Fatalf("staged count=%d", got)
	}
}

func TestStagedByteQuotaAndLastLiveRefReleaseCapacity(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	ownerHash := strings.Repeat("a", 64)
	fullStaged := quotaUploadRecord(ownerHash, "upl_staged_full", UploadStagedOwnerByteLimit)
	if err := store.InsertUpload(ctx, fullStaged); err != nil {
		t.Fatal(err)
	}
	attempt := UploadAttemptRecord{EndpointID: "env_quota", OwnerUserHash: ownerHash, UploadRequestID: "request_over_bytes", RequestFingerprint: "fingerprint", UploadID: "upl_over_bytes", CreatedAtUnixMs: 2}
	reserved, _, err := store.ReserveUploadAttempt(ctx, attempt)
	if err != nil {
		t.Fatal(err)
	}
	overScope := stagingScopeForTest("env_quota", "thread_over", ownerHash, "scope_over")
	if err := store.CreateUploadStagingScope(ctx, overScope); err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteUploadAttemptToStaging(ctx, reserved, quotaUploadRecord(ownerHash, attempt.UploadID, 1), overScope); !errors.Is(err, ErrUploadQuotaExceeded) {
		t.Fatalf("staged byte quota error=%v", err)
	}
	if _, err := store.db.Exec(`DELETE FROM ai_uploads WHERE upload_id = ?`, fullStaged.UploadID); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateThreadSettings(ctx, ThreadSettings{ThreadID: "thread_quota", EndpointID: "env_quota", PermissionType: "approval_required"}); err != nil {
		t.Fatal(err)
	}
	fullLive := quotaUploadRecord(ownerHash, "upl_live_full", UploadLiveOwnerByteLimit)
	fullLive.State = UploadStateLive
	if err := store.InsertUpload(ctx, fullLive); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms) VALUES(?, ?, ?, ?, ?, ?)`, "env_quota", fullLive.UploadID, "thread_quota", UploadRefKindThread, "thread_quota", 3); err != nil {
		t.Fatal(err)
	}
	next := quotaUploadRecord(ownerHash, "upl_live_next", 1)
	if err := store.InsertUpload(ctx, next); err != nil {
		t.Fatal(err)
	}
	nextScope := stagingScopeForTest("env_quota", "thread_quota", ownerHash, "scope_quota")
	if err := store.CreateUploadStagingScope(ctx, nextScope); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms) VALUES(?, ?, ?, ?, ?, ?)`, "env_quota", next.UploadID, nextScope.TargetID, UploadRefKindStaging, stagingUploadRefID(ownerHash, nextScope.StagingScopeID), 3); err != nil {
		t.Fatal(err)
	}
	bindNext := func(claimedAt int64) error {
		tx, err := store.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer func() { _ = tx.Rollback() }()
		if err := bindUploadsToRefTx(ctx, tx, "env_quota", "thread_quota", UploadRefKindThread, "thread_quota", []string{next.UploadID}, claimedAt, UploadRefKindStaging, stagingUploadRefID(ownerHash, nextScope.StagingScopeID), ownerHash); err != nil {
			return err
		}
		return tx.Commit()
	}
	if err := bindNext(4); !errors.Is(err, ErrUploadQuotaExceeded) {
		t.Fatalf("live quota error=%v", err)
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`DELETE FROM ai_upload_refs WHERE endpoint_id = ? AND upload_id = ?`, "env_quota", fullLive.UploadID); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	cleanup, err := collectUnreferencedUploadsTx(ctx, tx, "env_quota", []string{fullLive.UploadID}, 5)
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if len(cleanup) != 1 || cleanup[0].State != UploadStateDeleting {
		t.Fatalf("cleanup=%#v", cleanup)
	}
	if err := bindNext(6); err != nil {
		t.Fatalf("bind after last-ref release: %v", err)
	}
}
