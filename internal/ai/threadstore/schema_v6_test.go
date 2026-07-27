package threadstore

import (
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func createProductV5DatabaseForTest(t *testing.T, path string) *sql.DB {
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
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  db_kind TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_migrated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_migrated_from_version INTEGER NOT NULL DEFAULT 0,
  last_migrated_to_version INTEGER NOT NULL DEFAULT 0
);
INSERT INTO __redeven_db_meta(singleton, db_kind, last_migrated_from_version, last_migrated_to_version)
VALUES(1, 'ai_threadstore_product_v2', 5, 5);
`); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := createThreadstoreSchemaV5(tx); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if _, err := tx.Exec(`PRAGMA user_version=5`); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestThreadstoreMigratesV5ThroughV8AndRemovesObsoleteDraftClaims(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV5DatabaseForTest(t, path)
	ownerHash := strings.Repeat("a", 64)
	contentHash := strings.Repeat("b", 64)
	if _, err := raw.Exec(`
INSERT INTO ai_thread_settings(
  thread_id, endpoint_id, namespace_public_id, model_id, permission_type,
  working_dir, settings_created_at_unix_ms, settings_updated_at_unix_ms
) VALUES('thread_v5', 'env_v5', 'namespace_v5', 'openai/gpt-5', 'approval_required', '/workspace', 10, 11);
INSERT INTO ai_uploads(
  upload_id, endpoint_id, owner_scope_kind, owner_user_hash, storage_relpath, name,
  declared_media_type, detected_media_type, size_bytes, content_sha256, source, state,
  created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms
) VALUES('upload_v5', 'env_v5', 'user', ?, 'upload_v5.data', 'notes.txt',
  'text/plain', 'text/plain', 7, ?, 'uploaded_file', 'staged', 12, 0, 0);
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
VALUES('env_v5', 'upload_v5', '', 'draft', 'legacy_draft', 13);
`, ownerHash, contentHash); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	var version int
	if err := store.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != threadstoreCurrentSchemaVersion {
		t.Fatalf("user_version=%d, want %d", version, threadstoreCurrentSchemaVersion)
	}
	settings, err := store.GetThreadSettings(t.Context(), "env_v5", "thread_v5")
	if err != nil {
		t.Fatal(err)
	}
	if settings.ModelID != "openai/gpt-5" || settings.WorkingDir != "/workspace" || settings.NamespacePublicID != "namespace_v5" {
		t.Fatalf("migrated settings=%#v", settings)
	}
	upload, err := store.GetUpload(t.Context(), "env_v5", "upload_v5")
	if err != nil {
		t.Fatal(err)
	}
	if upload.Name != "notes.txt" || upload.SizeBytes != 7 || upload.ContentSHA256 != contentHash || upload.State != UploadStateDeleting {
		t.Fatalf("migrated upload=%#v", upload)
	}
	if got := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = 'env_v5' AND upload_id = 'upload_v5'`); got != 0 {
		t.Fatalf("obsolete draft ref count=%d", got)
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'ai_composer_drafts'`) != 0 {
		t.Fatal("v5 migration retained composer draft storage")
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM __redeven_db_meta WHERE singleton = 1 AND last_migrated_from_version = 5 AND last_migrated_to_version = 8`) != 1 {
		t.Fatal("v5 through v8 migration metadata was not committed")
	}
}

func TestThreadstoreMigratesV5QuarantinedDraftRefWithoutInventingOwner(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV5DatabaseForTest(t, path)
	if _, err := raw.Exec(`
INSERT INTO ai_uploads(
  upload_id, endpoint_id, owner_scope_kind, owner_user_hash, storage_relpath, name,
  declared_media_type, detected_media_type, size_bytes, content_sha256, source, state,
  created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms
) VALUES('upload_v5_quarantine', 'env_v5_quarantine', 'legacy_staged_quarantine', NULL,
  'upload_v5_quarantine.data', 'legacy.txt', 'text/plain', 'text/plain', 7, '',
  'uploaded_file', 'staged', 12, 0, 0);
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
VALUES('env_v5_quarantine', 'upload_v5_quarantine', '', 'draft', 'legacy_draft_scope', 13);
`); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	upload, err := store.GetUpload(t.Context(), "env_v5_quarantine", "upload_v5_quarantine")
	if err != nil {
		t.Fatal(err)
	}
	if upload.OwnerScopeKind != UploadOwnerScopeLegacyStagedQuarantine || upload.OwnerUserHash != "" || upload.State != UploadStateDeleting {
		t.Fatalf("migrated quarantine upload=%#v", upload)
	}
	if got := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = 'env_v5_quarantine' AND upload_id = 'upload_v5_quarantine'`); got != 0 {
		t.Fatalf("quarantined upload retained %d obsolete draft refs", got)
	}
}

func TestFreshThreadstoreV8HasStagingScopesWithoutComposerDrafts(t *testing.T) {
	t.Parallel()
	store := openStoreForTest(t)

	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'ai_composer_drafts'`) != 0 {
		t.Fatal("fresh v8 schema retained composer drafts")
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'ai_upload_staging_scopes'`) != 1 {
		t.Fatal("fresh v8 schema is missing upload staging scopes")
	}
	var indexColumns string
	if err := store.db.QueryRow(`
SELECT group_concat(name, ',')
FROM (
  SELECT info.name
	  FROM pragma_index_info('idx_ai_upload_staging_scopes_expiry') info
	  ORDER BY info.seqno
)
`).Scan(&indexColumns); err != nil {
		t.Fatal(err)
	}
	if indexColumns != "expires_at_unix_ms,staging_scope_id" {
		t.Fatalf("expiry index columns=%q", indexColumns)
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM pragma_table_info('ai_upload_staging_scopes')`) != 8 {
		t.Fatal("fresh staging scope table has an unexpected column contract")
	}
}

func TestThreadstoreV5ToV6MigrationFailureRollsBackAtomically(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV5DatabaseForTest(t, path)
	if _, err := raw.Exec(`
INSERT INTO ai_thread_settings(thread_id, endpoint_id, permission_type, settings_created_at_unix_ms, settings_updated_at_unix_ms)
VALUES('thread_atomic', 'env_atomic', 'approval_required', 1, 1)
`); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	injected := errors.New("injected post-migration verification failure")
	spec := threadstoreSchemaSpec()
	for index := range spec.Migrations {
		if spec.Migrations[index].FromVersion != 5 {
			continue
		}
		spec.Migrations[index].Apply = func(tx *sql.Tx) error {
			if err := migrateProductV5ToV6(tx); err != nil {
				return err
			}
			return injected
		}
	}
	if db, err := sqliteutil.Open(path, spec); !errors.Is(err, injected) {
		if db != nil {
			_ = db.Close()
		}
		t.Fatalf("Open error=%v, want injected failure", err)
	}

	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var version int
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 5 {
		t.Fatalf("failed migration changed user_version to %d", version)
	}
	if countRowsForTest(t, raw, `SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'ai_composer_drafts'`) != 0 {
		t.Fatal("failed migration left ai_composer_drafts behind")
	}
	if countRowsForTest(t, raw, `SELECT COUNT(1) FROM ai_thread_settings WHERE thread_id = 'thread_atomic' AND endpoint_id = 'env_atomic'`) != 1 {
		t.Fatal("failed migration changed existing product records")
	}
	if countRowsForTest(t, raw, `SELECT COUNT(1) FROM __redeven_db_meta WHERE singleton = 1 AND last_migrated_from_version = 5 AND last_migrated_to_version = 5`) != 1 {
		t.Fatal("failed migration changed migration metadata")
	}
}

func TestThreadstoreV4ToV5RebuildFailureRollsBackAtomically(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV4DatabaseForTest(t, path)
	if _, err := raw.Exec(`
UPDATE __redeven_db_meta
SET created_at_unix_ms = 7, last_migrated_at_unix_ms = 8
WHERE singleton = 1;
INSERT INTO ai_uploads(
  upload_id, endpoint_id, storage_relpath, name, mime_type, size_bytes, state,
  created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms
) VALUES('upload_v4_atomic', 'env_v4_atomic', 'upload_v4_atomic.data', 'atomic.txt',
         'text/plain', 17, 'live', 101, 102, 103);
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
VALUES('env_v4_atomic', 'upload_v4_atomic', 'thread_v4_atomic', 'thread', 'thread_v4_atomic', 104);
`); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	injected := errors.New("injected v4 upload rebuild failure")
	spec := threadstoreSchemaSpec()
	for index := range spec.Migrations {
		if spec.Migrations[index].FromVersion != 4 {
			continue
		}
		spec.Migrations[index].Apply = func(tx *sql.Tx) error {
			if err := migrateProductV4ToV5(tx); err != nil {
				return err
			}
			return injected
		}
	}
	if db, err := sqliteutil.Open(path, spec); !errors.Is(err, injected) {
		if db != nil {
			_ = db.Close()
		}
		t.Fatalf("Open error=%v, want injected v4 rebuild failure", err)
	}

	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var version int
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 4 {
		t.Fatalf("failed migration changed user_version to %d", version)
	}
	var kind string
	var createdAt, migratedAt int64
	var migratedFrom, migratedTo int
	if err := raw.QueryRow(`
SELECT db_kind, created_at_unix_ms, last_migrated_at_unix_ms,
       last_migrated_from_version, last_migrated_to_version
FROM __redeven_db_meta WHERE singleton = 1
`).Scan(&kind, &createdAt, &migratedAt, &migratedFrom, &migratedTo); err != nil {
		t.Fatal(err)
	}
	if kind != threadstoreSchemaKind || createdAt != 7 || migratedAt != 8 || migratedFrom != 4 || migratedTo != 4 {
		t.Fatalf("failed migration changed metadata: kind=%q created=%d migrated=%d from=%d to=%d",
			kind, createdAt, migratedAt, migratedFrom, migratedTo)
	}
	var uploadID, endpointID, storageRelPath, name, mediaType, state string
	var sizeBytes, createdUploadAt, claimedAt, deleteAfter int64
	if err := raw.QueryRow(`
SELECT upload_id, endpoint_id, storage_relpath, name, mime_type, size_bytes, state,
       created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms
FROM ai_uploads WHERE upload_id = 'upload_v4_atomic'
`).Scan(&uploadID, &endpointID, &storageRelPath, &name, &mediaType, &sizeBytes, &state,
		&createdUploadAt, &claimedAt, &deleteAfter); err != nil {
		t.Fatal(err)
	}
	if uploadID != "upload_v4_atomic" || endpointID != "env_v4_atomic" ||
		storageRelPath != "upload_v4_atomic.data" || name != "atomic.txt" || mediaType != "text/plain" ||
		sizeBytes != 17 || state != "live" || createdUploadAt != 101 || claimedAt != 102 || deleteAfter != 103 {
		t.Fatalf("failed migration changed v4 upload: id=%q endpoint=%q path=%q name=%q mime=%q size=%d state=%q timestamps=%d/%d/%d",
			uploadID, endpointID, storageRelPath, name, mediaType, sizeBytes, state, createdUploadAt, claimedAt, deleteAfter)
	}
	var refEndpointID, refUploadID, threadID, refKind, refID string
	var refCreatedAt int64
	if err := raw.QueryRow(`
SELECT endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms
FROM ai_upload_refs WHERE upload_id = 'upload_v4_atomic'
`).Scan(&refEndpointID, &refUploadID, &threadID, &refKind, &refID, &refCreatedAt); err != nil {
		t.Fatal(err)
	}
	if refEndpointID != "env_v4_atomic" || refUploadID != "upload_v4_atomic" ||
		threadID != "thread_v4_atomic" || refKind != "thread" || refID != "thread_v4_atomic" || refCreatedAt != 104 {
		t.Fatalf("failed migration changed v4 ref: endpoint=%q upload=%q thread=%q kind=%q ref=%q created=%d",
			refEndpointID, refUploadID, threadID, refKind, refID, refCreatedAt)
	}
	for _, object := range []string{
		"product_v4_ai_uploads",
		"ai_upload_attempts",
		"idx_ai_uploads_endpoint_owner_created",
		"idx_ai_upload_attempts_status_updated",
	} {
		if countRowsForTest(t, raw, `SELECT COUNT(1) FROM sqlite_master WHERE name = ?`, object) != 0 {
			t.Fatalf("failed migration left v5 object %q behind", object)
		}
	}
	for _, index := range []string{"idx_ai_uploads_endpoint_created", "idx_ai_uploads_state_delete_after"} {
		if countRowsForTest(t, raw, `SELECT COUNT(1) FROM sqlite_master WHERE type = 'index' AND name = ?`, index) != 1 {
			t.Fatalf("failed migration did not restore v4 index %q", index)
		}
	}
	if countRowsForTest(t, raw, `SELECT COUNT(1) FROM pragma_table_info('ai_uploads') WHERE name = 'owner_scope_kind'`) != 0 {
		t.Fatal("failed migration retained v5 ai_uploads columns")
	}
}

func TestThreadstoreRejectsDriftedV5WithoutMutation(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV5DatabaseForTest(t, path)
	if _, err := raw.Exec(`ALTER TABLE ai_upload_attempts ADD COLUMN unexpected_draft_state TEXT NOT NULL DEFAULT ''`); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	if _, err := Open(path); err == nil || !strings.Contains(err.Error(), "contract mismatch") {
		t.Fatalf("Open error=%v, want v5 schema drift rejection", err)
	}
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var version int
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 5 || countRowsForTest(t, raw, `SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'ai_composer_drafts'`) != 0 {
		t.Fatalf("drift rejection mutated v5 schema: version=%d", version)
	}
}

func TestThreadstoreRejectsFutureV9WithoutMutation(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`
INSERT INTO ai_upload_staging_scopes(
  staging_scope_id, endpoint_id, owner_user_hash, thread_id, capability_hash,
  created_at_unix_ms, expires_at_unix_ms
) VALUES('scope_future', 'env_future', ?, 'thread_future', ?, 1, 3);
PRAGMA user_version=9;
`, strings.Repeat("f", 64), strings.Repeat("c", 64)); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	if _, err := Open(path); err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("Open error=%v, want future version rejection", err)
	}
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var version int
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 9 || countRowsForTest(t, raw, `SELECT COUNT(1) FROM ai_upload_staging_scopes WHERE endpoint_id = 'env_future' AND staging_scope_id = 'scope_future'`) != 1 {
		t.Fatalf("future version rejection mutated database: version=%d", version)
	}
}
