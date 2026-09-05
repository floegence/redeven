package threadstore

import (
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestThreadstoreSchemaSpecUsesCurrentLineage(t *testing.T) {
	spec := threadstoreSchemaSpec()
	if spec.Kind != threadstoreSchemaKind || spec.CurrentVersion != threadstoreCurrentSchemaVersion || spec.MinimumVersion != threadstoreMinimumSchemaVersion {
		t.Fatalf("schema lineage = %s v%d (minimum v%d)", spec.Kind, spec.CurrentVersion, spec.MinimumVersion)
	}
	if len(spec.Migrations) != threadstoreCurrentSchemaVersion-threadstoreMinimumSchemaVersion {
		t.Fatalf("migration count=%d, want %d", len(spec.Migrations), threadstoreCurrentSchemaVersion-threadstoreMinimumSchemaVersion)
	}
}

func TestEverySupportedThreadstoreVersionMigratesToV6(t *testing.T) {
	for version := 1; version < threadstoreCurrentSchemaVersion; version++ {
		version := version
		t.Run(fmt.Sprintf("v%d", version), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "threads.sqlite")
			createReviewedVersionDatabaseForTest(t, path, version)
			store, err := Open(path)
			if err != nil {
				t.Fatalf("migrate v%d: %v", version, err)
			}
			if err := store.Close(); err != nil {
				t.Fatal(err)
			}
			reopened, err := Open(path)
			if err != nil {
				t.Fatalf("reopen migrated v%d: %v", version, err)
			}
			defer reopened.Close()
			var current int
			if err := reopened.db.QueryRow(`PRAGMA user_version`).Scan(&current); err != nil {
				t.Fatal(err)
			}
			if current != threadstoreCurrentSchemaVersion {
				t.Fatalf("version=%d, want %d", current, threadstoreCurrentSchemaVersion)
			}
		})
	}
}

func TestThreadstoreV5ToV6PreservesCurrentFactsAndDropsRetiredState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	createReviewedVersionDatabaseForTest(t, path, 5)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	ownerHash := strings.Repeat("a", 64)
	activeCapability := strings.Repeat("b", 64)
	releasedCapability := strings.Repeat("c", 64)
	expiredCapability := strings.Repeat("d", 64)
	future := time.Now().Add(time.Hour).UnixMilli()
	past := time.Now().Add(-time.Hour).UnixMilli()
	activeRef := stagingUploadRefID(ownerHash, "scope_active")
	releasedRef := stagingUploadRefID(ownerHash, "scope_released")
	expiredRef := stagingUploadRefID(ownerHash, "scope_expired")
	statements := []struct {
		query string
		args  []any
	}{
		{query: `INSERT INTO ai_thread_settings(thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json, permission_type, working_dir, pinned_at_unix_ms, created_by_user_public_id, created_by_user_email, updated_by_user_public_id, updated_by_user_email, settings_created_at_unix_ms, settings_updated_at_unix_ms) VALUES('thread_v5', 'env_v5', 'ns_v5', 'openai/gpt-5-mini', '{}', 'approval_required', '/tmp', 7, 'creator', 'creator@example.com', 'updater', 'updater@example.com', 10, 11)`},
		{query: `INSERT INTO ai_flower_execution_authority(request_key, thread_id, turn_id, endpoint_id, namespace_public_id, channel_id, user_public_id, user_email, created_at_unix_ms) VALUES('request_v5', 'thread_v5', 'turn_v5', 'env_v5', 'ns_v5', 'channel_v5', 'user_v5', 'user@example.com', 12)`},
		{`INSERT INTO ai_uploads(upload_id, endpoint_id, owner_scope_kind, owner_user_hash, storage_relpath, name, declared_media_type, detected_media_type, size_bytes, content_sha256, unicode_code_points, logical_line_count, source, state, created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms) VALUES('upload_v5', 'env_v5', 'user', ?, 'upload_v5.data', 'v5.txt', 'text/plain', 'text/plain; charset=utf-8', 3, ?, 3, 1, 'uploaded_file', 'staged', 13, 14, 15)`, []any{ownerHash, strings.Repeat("e", 64)}},
		{query: `INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms) VALUES('env_v5', 'upload_v5', 'thread_v5', 'thread', 'thread_v5', 16)`},
		{`INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms) VALUES('env_v5', 'upload_v5', 'thread_v5', 'staging', ?, 17)`, []any{activeRef}},
		{`INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms) VALUES('env_v5', 'upload_v5', 'thread_v5', 'staging', ?, 18)`, []any{releasedRef}},
		{`INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms) VALUES('env_v5', 'upload_v5', 'thread_v5', 'staging', ?, 19)`, []any{expiredRef}},
		{`INSERT INTO ai_upload_staging_scopes(staging_scope_id, endpoint_id, owner_user_hash, target_id, capability_hash, created_at_unix_ms, expires_at_unix_ms, released_at_unix_ms) VALUES('scope_active', 'env_v5', ?, 'thread_v5', ?, 17, ?, 0)`, []any{ownerHash, activeCapability, future}},
		{`INSERT INTO ai_upload_staging_scopes(staging_scope_id, endpoint_id, owner_user_hash, target_id, capability_hash, created_at_unix_ms, expires_at_unix_ms, released_at_unix_ms) VALUES('scope_released', 'env_v5', ?, 'thread_v5', ?, 17, ?, 18)`, []any{ownerHash, releasedCapability, future}},
		{`INSERT INTO ai_upload_staging_scopes(staging_scope_id, endpoint_id, owner_user_hash, target_id, capability_hash, created_at_unix_ms, expires_at_unix_ms, released_at_unix_ms) VALUES('scope_expired', 'env_v5', ?, 'thread_v5', ?, 17, ?, 0)`, []any{ownerHash, expiredCapability, past}},
		{query: `INSERT INTO provider_capabilities(provider_id, model_name, capability_json, updated_at_unix_ms) VALUES('openai', 'gpt-5-mini', '{}', 1)`},
		{query: `INSERT INTO ai_flower_thread_routing(endpoint_id, thread_id, primary_target_id) VALUES('env_v5', 'thread_v5', 'target_v5')`},
		{query: `INSERT INTO ai_thread_delete_authority(endpoint_id, thread_id, deleted_at_unix_ms) VALUES('env_v5', 'deleted_v5', 1)`},
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement.query, statement.args...); err != nil {
			_ = db.Close()
			t.Fatalf("seed v5: %v", err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(path)
	if err != nil {
		t.Fatalf("migrate v5: %v", err)
	}
	defer store.Close()
	settings, err := store.GetThreadSettings(t.Context(), "env_v5", "thread_v5")
	if err != nil || settings == nil || settings.ModelID != "openai/gpt-5-mini" || settings.PinnedAtUnixMs != 7 {
		t.Fatalf("settings=%#v err=%v", settings, err)
	}
	upload, err := store.GetUpload(t.Context(), "env_v5", "upload_v5")
	if err != nil || upload == nil || upload.Name != "v5.txt" || upload.DetectedMediaType != "text/plain; charset=utf-8" {
		t.Fatalf("upload=%#v err=%v", upload, err)
	}
	authority, err := store.GetExecutionAuthority(t.Context(), "request_v5")
	if err != nil || authority == nil || authority.TurnID != "turn_v5" {
		t.Fatalf("authority=%#v err=%v", authority, err)
	}
	if got := countRowsForTest(t, store.db, `SELECT COUNT(*) FROM ai_upload_refs WHERE target_id = 'thread_v5'`); got != 2 {
		t.Fatalf("migrated refs=%d, want thread and active staging refs", got)
	}
	if got := countRowsForTest(t, store.db, `SELECT COUNT(*) FROM ai_upload_refs WHERE ref_id IN (?, ?)`, releasedRef, expiredRef); got != 0 {
		t.Fatalf("retired scope refs=%d, want 0", got)
	}
	if got := countRowsForTest(t, store.db, `SELECT COUNT(*) FROM ai_upload_staging_scopes WHERE staging_scope_id = 'scope_active'`); got != 1 {
		t.Fatalf("active scopes=%d, want 1", got)
	}
	if got := countRowsForTest(t, store.db, `SELECT COUNT(*) FROM ai_upload_staging_scopes WHERE staging_scope_id IN ('scope_released', 'scope_expired')`); got != 0 {
		t.Fatalf("retired scopes=%d, want 0", got)
	}
	for _, table := range []string{"provider_capabilities", "ai_flower_thread_routing", "ai_thread_delete_authority"} {
		if got := countRowsForTest(t, store.db, `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, table); got != 0 {
			t.Fatalf("retired table %s remains", table)
		}
	}
}

func TestThreadstoreV5ToV6MalformedRetiredScopeRollsBack(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	createReviewedVersionDatabaseForTest(t, path, 5)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`PRAGMA ignore_check_constraints=ON`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO ai_upload_staging_scopes(staging_scope_id, endpoint_id, owner_user_hash, target_id, capability_hash, created_at_unix_ms, expires_at_unix_ms, released_at_unix_ms) VALUES('scope_bad', 'env_v5', 'bad', 'thread_v5', ?, 1, 2, 1)`, strings.Repeat("f", 64)); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	store, err := Open(path)
	if store != nil {
		_ = store.Close()
		t.Fatal("malformed v5 scope returned a store")
	}
	if err == nil {
		t.Fatal("malformed v5 scope migrated")
	}
	db, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var version int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 5 {
		t.Fatalf("version after rollback=%d, want 5", version)
	}
	var scopeID string
	if err := db.QueryRow(`SELECT staging_scope_id FROM ai_upload_staging_scopes WHERE staging_scope_id='scope_bad'`).Scan(&scopeID); err != nil && !errors.Is(err, sql.ErrNoRows) {
		t.Fatal(err)
	}
	if scopeID != "scope_bad" {
		t.Fatal("v5 source row did not survive rollback")
	}
}
