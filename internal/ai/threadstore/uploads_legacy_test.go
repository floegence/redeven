package threadstore

import (
	"context"
	"strings"
	"testing"
)

func TestSealLegacyUploadDigestIsIdempotentAndScopeClosed(t *testing.T) {
	t.Parallel()
	store := openStoreForTest(t)
	ctx := context.Background()
	const endpointID = "env_legacy_digest"
	const uploadID = "upl_llllllllllllllllllllllll"
	digest := strings.Repeat("a", 64)
	if err := store.InsertUpload(ctx, UploadRecord{
		UploadID: uploadID, EndpointID: endpointID, OwnerScopeKind: UploadOwnerScopeLegacyThread,
		StorageRelPath: uploadID + ".data", Name: "legacy.txt", DetectedMediaType: "text/plain",
		SizeBytes: 6, Source: UploadSourceFile, State: UploadStateLive, CreatedAtUnixMs: 1,
	}); err != nil {
		t.Fatal(err)
	}

	for attempt := 0; attempt < 2; attempt++ {
		sealed, err := store.SealLegacyUploadDigest(ctx, endpointID, uploadID, digest)
		if err != nil || sealed != digest {
			t.Fatalf("attempt %d sealed=%q err=%v", attempt, sealed, err)
		}
	}
	if _, err := store.SealLegacyUploadDigest(ctx, endpointID, uploadID, strings.Repeat("b", 64)); err == nil || !strings.Contains(err.Error(), "digest changed") {
		t.Fatalf("competing digest error=%v", err)
	}
	record, err := store.GetUpload(ctx, endpointID, uploadID)
	if err != nil || record.ContentSHA256 != digest {
		t.Fatalf("sealed record=%#v err=%v", record, err)
	}

	for _, fixture := range []UploadRecord{
		{UploadID: "upl_qqqqqqqqqqqqqqqqqqqqqqqq", OwnerScopeKind: UploadOwnerScopeLegacyStagedQuarantine, State: UploadStateLive},
		{UploadID: "upl_ssssssssssssssssssssssss", OwnerScopeKind: UploadOwnerScopeLegacyThread, State: UploadStateStaged},
	} {
		fixture.EndpointID = endpointID
		fixture.StorageRelPath = fixture.UploadID + ".data"
		fixture.Name = "closed.txt"
		fixture.DetectedMediaType = "text/plain"
		fixture.SizeBytes = 1
		fixture.Source = UploadSourceFile
		fixture.CreatedAtUnixMs = 1
		if err := store.InsertUpload(ctx, fixture); err != nil {
			t.Fatal(err)
		}
		if _, err := store.SealLegacyUploadDigest(ctx, endpointID, fixture.UploadID, digest); err == nil {
			t.Fatalf("sealed out-of-scope fixture=%#v", fixture)
		}
	}
}

func TestSealLegacyTextUploadMetadataIsAtomicAndImmutable(t *testing.T) {
	t.Parallel()
	store := openStoreForTest(t)
	ctx := context.Background()
	const endpointID = "env_legacy_text_metadata"
	const uploadID = "upl_tttttttttttttttttttttttt"
	digest := strings.Repeat("c", 64)
	if err := store.InsertUpload(ctx, UploadRecord{
		UploadID: uploadID, EndpointID: endpointID, OwnerScopeKind: UploadOwnerScopeLegacyThread,
		StorageRelPath: uploadID + ".data", Name: "legacy.txt", DetectedMediaType: "text/plain",
		SizeBytes: 12, Source: UploadSourceFile, State: UploadStateLive, CreatedAtUnixMs: 1,
	}); err != nil {
		t.Fatal(err)
	}

	for attempt := 0; attempt < 2; attempt++ {
		sealed, err := store.SealLegacyTextUploadMetadata(ctx, endpointID, uploadID, digest, 8, 3)
		if err != nil || sealed != digest {
			t.Fatalf("attempt %d sealed=%q err=%v", attempt, sealed, err)
		}
	}
	if _, err := store.SealLegacyTextUploadMetadata(ctx, endpointID, uploadID, digest, 9, 3); err == nil || !strings.Contains(err.Error(), "metadata changed") {
		t.Fatalf("competing text stats error=%v", err)
	}
	if _, err := store.SealLegacyTextUploadMetadata(ctx, endpointID, uploadID, strings.Repeat("d", 64), 8, 3); err == nil || !strings.Contains(err.Error(), "metadata changed") {
		t.Fatalf("competing digest error=%v", err)
	}
	record, err := store.GetUpload(ctx, endpointID, uploadID)
	if err != nil || record.ContentSHA256 != digest || record.UnicodeCodePoints == nil || *record.UnicodeCodePoints != 8 ||
		record.LogicalLineCount == nil || *record.LogicalLineCount != 3 {
		t.Fatalf("sealed record=%#v err=%v", record, err)
	}
}
