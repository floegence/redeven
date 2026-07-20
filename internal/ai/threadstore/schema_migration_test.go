package threadstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/ai/permissionsnapshot"
)

func createProductV2DatabaseForTest(t *testing.T, path string) *sql.DB {
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
VALUES(1, 'ai_threadstore_product_v2', 2, 2);
`); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := createThreadstoreSchemaV2(tx); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if _, err := tx.Exec(`PRAGMA user_version=2`); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestFreshThreadstoreCreatesCurrentSchemaDirectly(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "threads.sqlite")
	store, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = store.Close() }()
	var version int
	if err := store.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatalf("read user_version: %v", err)
	}
	if version != threadstoreCurrentSchemaVersion {
		t.Fatalf("user_version=%d, want %d", version, threadstoreCurrentSchemaVersion)
	}
	for _, table := range []string{"ai_threads", "product_v2_ai_threads", "product_v2_ai_upload_refs", "product_v2_ai_child_permission_snapshots"} {
		if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = ?`, table) != 0 {
			t.Fatalf("fresh schema retained legacy table %q", table)
		}
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM pragma_table_info('ai_child_permission_snapshots') WHERE name = 'subagent_id'`) != 0 {
		t.Fatal("fresh schema retained subagent_id")
	}
}

func TestProductV2HistoricalChildPermissionDDLIsStable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV2DatabaseForTest(t, path)
	defer raw.Close()
	var got string
	if err := raw.QueryRow(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ai_child_permission_snapshots'`).Scan(&got); err != nil {
		t.Fatal(err)
	}
	const want = `CREATE TABLE ai_child_permission_snapshots (
  child_snapshot_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  parent_snapshot_id TEXT NOT NULL DEFAULT '',
  spawn_tool_call_id TEXT NOT NULL DEFAULT '',
  parent_thread_id TEXT NOT NULL DEFAULT '',
  parent_run_id TEXT NOT NULL DEFAULT '',
  subagent_id TEXT NOT NULL DEFAULT '',
  child_thread_id TEXT NOT NULL DEFAULT '',
  child_run_id TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'provisional',
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  snapshot_hash TEXT NOT NULL DEFAULT '',
  registry_hash TEXT NOT NULL DEFAULT '',
  schema_hash TEXT NOT NULL DEFAULT '',
  presentation_hash TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  finalized_at_unix_ms INTEGER NOT NULL DEFAULT 0
)`
	if got != want {
		t.Fatalf("published v2 child permission DDL changed:\n%s", got)
	}
}

func TestThreadstoreRejectsDriftedV2BeforeMigratingTitles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV2DatabaseForTest(t, path)
	if _, err := raw.Exec(`
INSERT INTO ai_threads(thread_id, endpoint_id, title, created_at_unix_ms, updated_at_unix_ms)
VALUES('thread_drift', 'env_drift', 'Must not migrate', 1, 1);
ALTER TABLE ai_threads ADD COLUMN unexpected_agent_state TEXT NOT NULL DEFAULT '';
`); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	migrated := 0
	store, err := Open(path, WithLegacyThreadTitleMigrator(func(context.Context, LegacyThreadTitle) error {
		migrated++
		return nil
	}))
	if store != nil {
		_ = store.Close()
	}
	if err == nil || !strings.Contains(err.Error(), "schema v2 contract mismatch") {
		t.Fatalf("Open error=%v, want schema v2 contract mismatch", err)
	}
	if migrated != 0 {
		t.Fatalf("migrated titles=%d, want 0 before exact schema validation", migrated)
	}
}

func TestThreadstoreSchemaV3ContainsOnlyHostThreadSettings(t *testing.T) {
	store := openStoreForTest(t)
	for _, table := range []string{"ai_threads"} {
		if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = ?`, table) != 0 {
			t.Fatalf("legacy table %s exists", table)
		}
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'ai_thread_settings'`) != 1 {
		t.Fatal("ai_thread_settings is missing")
	}
	for _, column := range []string{"title", "title_source", "title_generated_at_unix_ms", "title_input_message_id", "title_model_id", "title_prompt_version"} {
		if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM pragma_table_info('ai_thread_settings') WHERE name = ?`, column) != 0 {
			t.Fatalf("canonical title column %s exists in host settings", column)
		}
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM pragma_table_info('ai_child_permission_snapshots') WHERE name = 'subagent_id'`) != 0 {
		t.Fatal("subagent_id compatibility column exists")
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM pragma_table_info('ai_thread_create_operations') WHERE name = 'floret_created_at_unix_ms'`) != 1 {
		t.Fatal("canonical create operation timestamp is missing")
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM pragma_table_info('ai_thread_create_operations') WHERE name = 'floret_ensured_at_unix_ms'`) != 0 {
		t.Fatal("implicit ensure operation timestamp exists")
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM pragma_table_info('ai_queued_turns') WHERE name = 'admission_state'`) != 1 {
		t.Fatal("durable queue admission state is missing")
	}
}

func TestThreadstoreMigratesV2TitlesAndOwnershipBeforeSchemaCommit(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV2DatabaseForTest(t, path)
	if _, err := raw.Exec(`
INSERT INTO ai_threads(thread_id, endpoint_id, title, title_source, followups_revision, created_at_unix_ms, updated_at_unix_ms)
VALUES('thread_product', 'env_product', 'Canonical title', 'user', 7, 100, 120);
INSERT INTO ai_uploads(upload_id, endpoint_id, storage_relpath, created_at_unix_ms) VALUES('upload_1', 'env_product', 'upload_1.data', 90);
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
VALUES
  ('env_product', 'upload_1', 'thread_product', 'turn', 'turn_1', 100),
  ('env_product', 'upload_1', 'thread_product', 'turn', 'turn_2', 110);
INSERT INTO ai_queued_turns(queue_id, endpoint_id, thread_id, channel_id, turn_id, run_id, text_content, created_at_unix_ms)
VALUES('queue_product', 'env_product', 'thread_product', 'channel_product', 'turn_product', 'run_product', 'queued', 115);
`); err != nil {
		t.Fatal(err)
	}
	v2JSON, v2Hash, v2Registry, v2Schema, v2Presentation := permissionSnapshotPayloadForTest(t, "v2", permissionsnapshot.PermissionApprovalRequired)
	if _, err := raw.Exec(`
INSERT INTO ai_permission_snapshots(
  snapshot_id, endpoint_id, owner_thread_id, owner_run_id, permission_type,
  snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash, created_at_unix_ms
) VALUES
  ('v1', 'env_product', 'thread_product', 'run_v1', 'approval_required', '{"version":1}', '', '', '', '', 90),
  ('v2', 'env_product', 'thread_product', 'run_v2', 'approval_required', ?, ?, ?, ?, ?, 100)
`, v2JSON, v2Hash, v2Registry, v2Schema, v2Presentation); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	var migrated []LegacyThreadTitle
	store, err := Open(path, WithLegacyThreadTitleMigrator(func(_ context.Context, title LegacyThreadTitle) error {
		migrated = append(migrated, title)
		return nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if len(migrated) != 1 || migrated[0].ThreadID != "thread_product" || migrated[0].Title != "Canonical title" {
		t.Fatalf("migrated titles=%#v", migrated)
	}
	settings, err := store.GetThreadSettings(context.Background(), "env_product", "thread_product")
	if err != nil || settings == nil || settings.QueueRevision != 7 {
		t.Fatalf("settings=%#v err=%v", settings, err)
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE upload_id = 'upload_1' AND ref_kind = 'thread' AND ref_id = 'thread_product'`) != 1 {
		t.Fatal("admitted upload ownership was not deduplicated to the thread")
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_permission_snapshots WHERE snapshot_id = 'v1'`) != 0 || countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_permission_snapshots WHERE snapshot_id = 'v2'`) != 1 {
		t.Fatal("permission snapshot version filtering is incorrect")
	}
	queued, err := store.GetQueuedTurn(context.Background(), "env_product", "thread_product", "queue_product")
	if err != nil || queued.AdmissionState != PendingTurnAdmissionReady {
		t.Fatalf("migrated queued command=%#v err=%v, want ready", queued, err)
	}
}

func TestThreadstoreMigratesPendingV2ForkSnapshotToHostSettingsContract(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV2DatabaseForTest(t, path)
	legacySnapshot := productV2ForkSnapshot{
		SchemaVersion: ForkSnapshotSchemaVersion,
		Request: forkSnapshotRequest{
			EndpointID: "env_fork_migration", SourceThreadID: "source_fork_migration",
			DestinationThreadID: "destination_fork_migration", Title: "Canonical source title",
			CreatedByUserPublicID: "user_1", CreatedByUserEmail: "user@example.com", CreatedAtUnixMs: 200,
		},
		SourceThread: productV2Thread{
			ThreadID: "source_fork_migration", EndpointID: "env_fork_migration", NamespacePublicID: "namespace_1",
			ModelID: "openai/gpt-5", ReasoningSelectionJSON: `{"effort":"high"}`,
			PermissionType: "approval_required", WorkingDir: "/workspace", Title: "Canonical source title",
			TitleSource: "provider", PinnedAtUnixMs: 50, CreatedByUserPublicID: "user_1",
			CreatedByUserEmail: "user@example.com", UpdatedByUserPublicID: "user_2",
			UpdatedByUserEmail: "editor@example.com", CreatedAtUnixMs: 100, UpdatedAtUnixMs: 150,
		},
		UploadRefs: []forkSnapshotUploadRef{
			{UploadID: "upload_admitted", RefKind: "turn", RefID: "turn_1", CreatedAtUnixMs: 120},
			{UploadID: "upload_admitted", RefKind: "run", RefID: "run_1", CreatedAtUnixMs: 130},
			{UploadID: "upload_queued", RefKind: UploadRefKindQueuedTurn, RefID: "queue_1", CreatedAtUnixMs: 140},
		},
	}
	legacyJSON, err := json.Marshal(legacySnapshot)
	if err != nil {
		t.Fatal(err)
	}
	explicitSnapshot := legacySnapshot
	explicitSnapshot.Request.DestinationThreadID = "destination_fork_migration_explicit"
	explicitSnapshot.Request.Title = "Explicit fork title"
	explicitJSON, err := json.Marshal(explicitSnapshot)
	if err != nil {
		t.Fatal(err)
	}
	explicitRequestFingerprint, err := forkRequestFingerprint(ForkThreadRequest{
		OperationID: "fork_migration_explicit", EndpointID: "env_fork_migration",
		SourceThreadID: "source_fork_migration", DestinationThreadID: "destination_fork_migration_explicit",
		Title: "Explicit fork title", CreatedByUserPublicID: "user_1", CreatedByUserEmail: "user@example.com", CreatedAtUnixMs: 200,
	})
	if err != nil {
		t.Fatal(err)
	}
	requestFingerprint, err := forkRequestFingerprint(ForkThreadRequest{
		OperationID: "fork_migration", EndpointID: "env_fork_migration",
		SourceThreadID: "source_fork_migration", DestinationThreadID: "destination_fork_migration",
		CreatedByUserPublicID: "user_1", CreatedByUserEmail: "user@example.com", CreatedAtUnixMs: 200,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`
INSERT INTO ai_threads(
  thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json,
  permission_type, working_dir, title, title_source, pinned_at_unix_ms,
  created_by_user_public_id, created_by_user_email, updated_by_user_public_id,
  updated_by_user_email, created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
		"source_fork_migration", "env_fork_migration", "namespace_1", "openai/gpt-5", `{"effort":"high"}`,
		"approval_required", "/workspace", "Canonical source title", "provider", 50,
		"user_1", "user@example.com", "user_2", "editor@example.com", 100, 150,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`
INSERT INTO ai_thread_fork_operations(
  operation_id, endpoint_id, source_thread_id, destination_thread_id,
  request_fingerprint, status, snapshot_schema_version, snapshot_json,
  created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
`,
		"fork_migration", "env_fork_migration", "source_fork_migration", "destination_fork_migration",
		requestFingerprint, ForkSnapshotSchemaVersion, string(legacyJSON), 200, 200,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`
INSERT INTO ai_thread_fork_operations(
  operation_id, endpoint_id, source_thread_id, destination_thread_id,
  request_fingerprint, status, snapshot_schema_version, snapshot_json,
  created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
`,
		"fork_migration_explicit", "env_fork_migration", "source_fork_migration", "destination_fork_migration_explicit",
		explicitRequestFingerprint, ForkSnapshotSchemaVersion, string(explicitJSON), 200, 200,
	); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(path, WithLegacyThreadTitleMigrator(func(context.Context, LegacyThreadTitle) error { return nil }))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	operation, err := store.GetForkOperation(context.Background(), "fork_migration")
	if err != nil {
		t.Fatal(err)
	}
	if operation.RequestedTitle != "" {
		t.Fatalf("migrated requested title=%q, want no inferred title", operation.RequestedTitle)
	}
	explicitOperation, err := store.GetForkOperation(context.Background(), "fork_migration_explicit")
	if err != nil {
		t.Fatal(err)
	}
	if explicitOperation.RequestedTitle != "Explicit fork title" {
		t.Fatalf("migrated explicit title=%q", explicitOperation.RequestedTitle)
	}
	snapshot, err := decodeForkSnapshot(operation)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.SourceThread.SettingsCreatedAtUnixMs != 100 || snapshot.SourceThread.SettingsUpdatedAtUnixMs != 150 {
		t.Fatalf("migrated settings timestamps=%d/%d", snapshot.SourceThread.SettingsCreatedAtUnixMs, snapshot.SourceThread.SettingsUpdatedAtUnixMs)
	}
	if snapshot.SourceThread.ModelID != "openai/gpt-5" || snapshot.SourceThread.PermissionType != "approval_required" {
		t.Fatalf("migrated source settings=%#v", snapshot.SourceThread)
	}
	if len(snapshot.UploadRefs) != 1 || snapshot.UploadRefs[0].UploadID != "upload_admitted" || snapshot.UploadRefs[0].RefKind != UploadRefKindThread || snapshot.UploadRefs[0].RefID != "source_fork_migration" {
		t.Fatalf("migrated upload refs=%#v", snapshot.UploadRefs)
	}
	destination, err := store.CommitForkOperation(context.Background(), CommitForkOperationRequest{OperationID: operation.OperationID, UpdatedAtUnixMs: 300})
	if err != nil {
		t.Fatal(err)
	}
	if destination.ThreadID != "destination_fork_migration" || destination.ModelID != "openai/gpt-5" || destination.SettingsCreatedAtUnixMs != 200 {
		t.Fatalf("replayed destination settings=%#v", destination)
	}
}

func TestThreadstoreV2TitleMigrationFailureLeavesSchemaAtV2(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV2DatabaseForTest(t, path)
	if _, err := raw.Exec(`INSERT INTO ai_threads(thread_id, endpoint_id, title, created_at_unix_ms, updated_at_unix_ms) VALUES('thread_1', 'env_1', 'Title', 1, 1)`); err != nil {
		t.Fatal(err)
	}
	_ = raw.Close()
	want := errors.New("canonical title conflict")
	if _, err := Open(path, WithLegacyThreadTitleMigrator(func(context.Context, LegacyThreadTitle) error { return want })); !errors.Is(err, want) {
		t.Fatalf("Open error=%v", err)
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
	if version != 2 || countRowsForTest(t, raw, `SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'ai_threads'`) != 1 {
		t.Fatalf("failed migration changed schema version=%d", version)
	}
}

func TestThreadstoreV2MigrationRejectsUnknownUploadReferenceKindWithoutMutation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV2DatabaseForTest(t, path)
	if _, err := raw.Exec(`
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
VALUES('env_invalid_upload', 'upload_invalid', 'thread_invalid', 'mystery', 'mystery_1', 1)
`); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(path, WithLegacyThreadTitleMigrator(func(context.Context, LegacyThreadTitle) error { return nil })); err == nil || !strings.Contains(err.Error(), "unsupported kind") {
		t.Fatalf("Open error=%v, want unsupported upload reference kind", err)
	}
	assertProductV2SchemaUnchangedForTest(t, path)
}

func TestThreadstoreV2MigrationRejectsNonCanonicalUploadKindsBeforeTitleWrite(t *testing.T) {
	for _, refKind := range []string{"QUEUED_TURN", " queued_turn "} {
		t.Run(strings.ReplaceAll(refKind, " ", "_"), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "threads.sqlite")
			raw := createProductV2DatabaseForTest(t, path)
			if _, err := raw.Exec(`
INSERT INTO ai_threads(thread_id, endpoint_id, title, created_at_unix_ms, updated_at_unix_ms)
VALUES('thread_strict_ref', 'env_strict_ref', 'Must not migrate', 1, 1);
INSERT INTO ai_uploads(upload_id, endpoint_id, storage_relpath, created_at_unix_ms)
VALUES('upload_strict_ref', 'env_strict_ref', 'upload.data', 1);
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
VALUES('env_strict_ref', 'upload_strict_ref', 'thread_strict_ref', ?, 'queue_strict_ref', 1)
`, refKind); err != nil {
				t.Fatal(err)
			}
			if err := raw.Close(); err != nil {
				t.Fatal(err)
			}
			migratedTitles := 0
			_, err := Open(path, WithLegacyThreadTitleMigrator(func(context.Context, LegacyThreadTitle) error {
				migratedTitles++
				return nil
			}))
			if err == nil || !strings.Contains(err.Error(), "unsupported kind") {
				t.Fatalf("Open error=%v, want strict upload reference rejection", err)
			}
			if migratedTitles != 0 {
				t.Fatalf("title migrator calls=%d, want 0 before full v2 preflight", migratedTitles)
			}
			assertProductV2SchemaUnchangedForTest(t, path)
		})
	}
}

func TestThreadstoreV2MigrationRejectsInvalidPermissionOwnerBeforeTitleWrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV2DatabaseForTest(t, path)
	snapshotJSON, snapshotHash, registryHash, schemaHash, presentationHash := permissionSnapshotPayloadForTest(t, "invalid_owner", permissionsnapshot.PermissionApprovalRequired)
	if _, err := raw.Exec(`
INSERT INTO ai_threads(thread_id, endpoint_id, title, created_at_unix_ms, updated_at_unix_ms)
VALUES('thread_invalid_owner', 'env_invalid_owner', 'Must not migrate', 1, 1);
INSERT INTO ai_permission_snapshots(
  snapshot_id, endpoint_id, owner_thread_id, owner_run_id, permission_type,
  snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash, created_at_unix_ms
) VALUES('invalid_owner', 'env_invalid_owner', '', 'run_invalid_owner', 'approval_required', ?, ?, ?, ?, ?, 1)
`, snapshotJSON, snapshotHash, registryHash, schemaHash, presentationHash); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	migratedTitles := 0
	_, err := Open(path, WithLegacyThreadTitleMigrator(func(context.Context, LegacyThreadTitle) error {
		migratedTitles++
		return nil
	}))
	if err == nil || !strings.Contains(err.Error(), "invalid permission snapshot") {
		t.Fatalf("Open error=%v, want invalid permission owner rejection", err)
	}
	if migratedTitles != 0 {
		t.Fatalf("title migrator calls=%d, want 0 before full v2 preflight", migratedTitles)
	}
	assertProductV2SchemaUnchangedForTest(t, path)
}

func TestThreadstoreV2MigrationRejectsInvalidChildLifecycleMetadata(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV2DatabaseForTest(t, path)
	snapshotJSON, snapshotHash, registryHash, schemaHash, presentationHash := permissionSnapshotPayloadForTest(t, "invalid_child_state", permissionsnapshot.PermissionApprovalRequired)
	if _, err := raw.Exec(`
INSERT INTO ai_child_permission_snapshots(
  child_snapshot_id, endpoint_id, parent_snapshot_id, spawn_tool_call_id,
  parent_thread_id, parent_run_id, subagent_id, child_thread_id, child_run_id, state,
  snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash,
  created_at_unix_ms, finalized_at_unix_ms
) VALUES(
  'invalid_child_state', 'env_child_state', 'parent_snapshot', 'spawn_child_state',
  'parent_thread', 'parent_run', '', 'child_thread', 'child_run', 'unknown',
  ?, ?, ?, ?, ?, 1, 0
)
`, snapshotJSON, snapshotHash, registryHash, schemaHash, presentationHash); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(path); err == nil || !strings.Contains(err.Error(), "invalid child permission snapshot state") {
		t.Fatalf("Open error=%v, want invalid child lifecycle rejection", err)
	}
	assertProductV2SchemaUnchangedForTest(t, path)
}

func TestThreadstoreV2MigrationRejectsInvalidDeleteSnapshotBeforeTitleWrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	raw := createProductV2DatabaseForTest(t, path)
	if _, err := raw.Exec(`
INSERT INTO ai_threads(thread_id, endpoint_id, title, created_at_unix_ms, updated_at_unix_ms)
VALUES('thread_invalid_delete', 'env_invalid_delete', 'Must not migrate', 1, 1);
INSERT INTO ai_thread_delete_operations(
  operation_id, endpoint_id, thread_id, status, snapshot_schema_version,
  snapshot_json, read_state_required, created_at_unix_ms, updated_at_unix_ms
) VALUES(
  'delete_invalid_snapshot', 'env_invalid_delete', 'thread_invalid_delete', 'pending', 1,
  '{"schema_version":1,"upload_cleanup_ids":["bad/id"],"delete_flower_read_state":false}', 0, 1, 1
)
`); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	migratedTitles := 0
	_, err := Open(path, WithLegacyThreadTitleMigrator(func(context.Context, LegacyThreadTitle) error {
		migratedTitles++
		return nil
	}))
	if err == nil || !strings.Contains(err.Error(), "invalid product v2 snapshot contract") {
		t.Fatalf("Open error=%v, want invalid delete snapshot rejection", err)
	}
	if migratedTitles != 0 {
		t.Fatalf("title migrator calls=%d, want 0 before full v2 preflight", migratedTitles)
	}
	assertProductV2SchemaUnchangedForTest(t, path)
}

func TestThreadstoreV2MigrationRejectsEmptyNonCommittedForkBeforeTitleWrite(t *testing.T) {
	for _, status := range []string{string(ForkOperationPending), string(ForkOperationFailed)} {
		t.Run(status, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "threads.sqlite")
			raw := createProductV2DatabaseForTest(t, path)
			if _, err := raw.Exec(`
INSERT INTO ai_threads(thread_id, endpoint_id, title, created_at_unix_ms, updated_at_unix_ms)
VALUES('thread_empty_fork', 'env_empty_fork', 'Must not migrate', 1, 1);
INSERT INTO ai_thread_fork_operations(
  operation_id, endpoint_id, source_thread_id, destination_thread_id,
  request_fingerprint, status, snapshot_schema_version, snapshot_json,
  created_at_unix_ms, updated_at_unix_ms
) VALUES(
  'fork_empty_snapshot', 'env_empty_fork', 'thread_empty_fork', 'destination_empty_fork',
  'fingerprint', ?, 2, '', 1, 1
)
`, status); err != nil {
				t.Fatal(err)
			}
			if err := raw.Close(); err != nil {
				t.Fatal(err)
			}
			migratedTitles := 0
			_, err := Open(path, WithLegacyThreadTitleMigrator(func(context.Context, LegacyThreadTitle) error {
				migratedTitles++
				return nil
			}))
			if err == nil || !strings.Contains(err.Error(), "empty product v2 snapshot") {
				t.Fatalf("Open error=%v, want empty fork snapshot rejection", err)
			}
			if migratedTitles != 0 {
				t.Fatalf("title migrator calls=%d, want 0 before full v2 preflight", migratedTitles)
			}
			assertProductV2SchemaUnchangedForTest(t, path)
		})
	}
}

func TestThreadstoreV2MigrationRejectsIncompletePermissionMetadataWithoutMutation(t *testing.T) {
	for _, testCase := range []struct {
		name  string
		child bool
	}{
		{name: "root"},
		{name: "child", child: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "threads.sqlite")
			raw := createProductV2DatabaseForTest(t, path)
			snapshotJSON, _, registryHash, schemaHash, presentationHash := permissionSnapshotPayloadForTest(t, "metadata_"+testCase.name, permissionsnapshot.PermissionApprovalRequired)
			if testCase.child {
				if _, err := raw.Exec(`
INSERT INTO ai_child_permission_snapshots(
  child_snapshot_id, endpoint_id, parent_snapshot_id, spawn_tool_call_id, parent_thread_id, parent_run_id,
  subagent_id, child_thread_id, child_run_id, state, snapshot_json, snapshot_hash, registry_hash, schema_hash,
  presentation_hash, created_at_unix_ms, finalized_at_unix_ms
) VALUES(?, 'env_metadata', 'parent_snapshot', 'spawn_metadata', 'parent_thread', 'parent_run', '', 'child_thread', 'child_run',
         'finalized', ?, '', ?, ?, ?, 1, 1)
`, "metadata_"+testCase.name, snapshotJSON, registryHash, schemaHash, presentationHash); err != nil {
					t.Fatal(err)
				}
			} else if _, err := raw.Exec(`
INSERT INTO ai_permission_snapshots(
  snapshot_id, endpoint_id, owner_thread_id, owner_run_id, permission_type,
  snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash, created_at_unix_ms
) VALUES(?, 'env_metadata', 'thread_metadata', 'run_metadata', 'approval_required', ?, '', ?, ?, ?, 1)
`, "metadata_"+testCase.name, snapshotJSON, registryHash, schemaHash, presentationHash); err != nil {
				t.Fatal(err)
			}
			if err := raw.Close(); err != nil {
				t.Fatal(err)
			}
			if _, err := Open(path, WithLegacyThreadTitleMigrator(func(context.Context, LegacyThreadTitle) error { return nil })); err == nil || !strings.Contains(err.Error(), "invalid") {
				t.Fatalf("Open error=%v, want invalid permission metadata", err)
			}
			assertProductV2SchemaUnchangedForTest(t, path)
		})
	}
}

func assertProductV2SchemaUnchangedForTest(t *testing.T, path string) {
	t.Helper()
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var version int
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 2 || countRowsForTest(t, raw, `SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'ai_threads'`) != 1 {
		t.Fatalf("failed migration changed product v2 schema version=%d", version)
	}
}

func TestThreadstoreRejectsUnsupportedLegacyKindWithoutMutation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
CREATE TABLE __redeven_db_meta(singleton INTEGER PRIMARY KEY, db_kind TEXT NOT NULL, created_at_unix_ms INTEGER NOT NULL DEFAULT 0, last_migrated_at_unix_ms INTEGER NOT NULL DEFAULT 0, last_migrated_from_version INTEGER NOT NULL, last_migrated_to_version INTEGER NOT NULL);
INSERT INTO __redeven_db_meta VALUES(1, 'ai_threadstore_canonical', 0, 0, 40, 40);
CREATE TABLE sentinel(value TEXT);
PRAGMA user_version=40;
`); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()
	_, err = Open(path)
	if err == nil || !strings.Contains(err.Error(), "only") || !strings.Contains(err.Error(), "v2 and v3") {
		t.Fatalf("Open error=%v", err)
	}
	db, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if countRowsForTest(t, db, `SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'sentinel'`) != 1 {
		t.Fatal("unsupported database was modified")
	}
}
