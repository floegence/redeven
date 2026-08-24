package threadreadstate

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()

	store, err := Open(filepath.Join(t.TempDir(), "thread_read_state.sqlite"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})
	return store
}

func TestStore_EnsureFlowerSeedsMissingBaselineAndAdvanceIsMonotonic(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openTestStore(t)

	records, err := store.EnsureFlower(ctx, "env_1", "user_1", map[string]FlowerSnapshot{
		"th_1": {
			ActivityRevision:    130,
			LastMessageAtUnixMs: 120,
			ActivitySignature:   "status:waiting_user\u001factivity:130\u001fprompt:prompt_1",
			WaitingPromptID:     "prompt_1",
		},
	})
	if err != nil {
		t.Fatalf("EnsureFlower: %v", err)
	}

	record := records["th_1"]
	if record.ScopeID != "user_1" {
		t.Fatalf("ScopeID=%q, want user_1", record.ScopeID)
	}
	if record.LastReadMessageAtUnixMs != 120 {
		t.Fatalf("LastReadMessageAtUnixMs=%d, want=120", record.LastReadMessageAtUnixMs)
	}
	if record.LastSeenActivityRevision != 130 {
		t.Fatalf("LastSeenActivityRevision=%d, want=130", record.LastSeenActivityRevision)
	}
	if record.LastSeenActivitySignature != "status:waiting_user\u001factivity:130\u001fprompt:prompt_1" {
		t.Fatalf("LastSeenActivitySignature=%q, want seeded signature", record.LastSeenActivitySignature)
	}
	if record.LastSeenWaitingPromptID != "prompt_1" {
		t.Fatalf("LastSeenWaitingPromptID=%q, want=prompt_1", record.LastSeenWaitingPromptID)
	}

	record, err = store.AdvanceFlower(ctx, "env_1", "user_1", "th_1", FlowerSnapshot{
		ActivityRevision:    125,
		LastMessageAtUnixMs: 100,
	})
	if err != nil {
		t.Fatalf("AdvanceFlower(regress): %v", err)
	}
	if record.LastReadMessageAtUnixMs != 120 {
		t.Fatalf("LastReadMessageAtUnixMs=%d after regress, want=120", record.LastReadMessageAtUnixMs)
	}
	if record.LastSeenActivityRevision != 130 {
		t.Fatalf("LastSeenActivityRevision=%d after regress, want=130", record.LastSeenActivityRevision)
	}
	if record.LastSeenActivitySignature != "status:waiting_user\u001factivity:130\u001fprompt:prompt_1" {
		t.Fatalf("LastSeenActivitySignature=%q after regress, want seeded signature", record.LastSeenActivitySignature)
	}
	if record.LastSeenWaitingPromptID != "prompt_1" {
		t.Fatalf("LastSeenWaitingPromptID=%q after regress, want=prompt_1", record.LastSeenWaitingPromptID)
	}

	record, err = store.AdvanceFlower(ctx, "env_1", "user_1", "th_1", FlowerSnapshot{
		ActivityRevision:    130,
		LastMessageAtUnixMs: 120,
		ActivitySignature:   "status:waiting_user\u001factivity:130\u001fprompt:prompt_2",
		WaitingPromptID:     "prompt_2",
	})
	if err != nil {
		t.Fatalf("AdvanceFlower(same revision): %v", err)
	}
	if record.LastSeenActivitySignature != "status:waiting_user\u001factivity:130\u001fprompt:prompt_1" {
		t.Fatalf("LastSeenActivitySignature=%q after same revision, want seeded signature", record.LastSeenActivitySignature)
	}
	if record.LastSeenWaitingPromptID != "prompt_1" {
		t.Fatalf("LastSeenWaitingPromptID=%q after same revision, want=prompt_1", record.LastSeenWaitingPromptID)
	}

	record, err = store.AdvanceFlower(ctx, "env_1", "user_1", "th_1", FlowerSnapshot{
		ActivityRevision:    200,
		LastMessageAtUnixMs: 180,
		ActivitySignature:   "status:success\u001factivity:200",
		WaitingPromptID:     "prompt_2",
	})
	if err != nil {
		t.Fatalf("AdvanceFlower(progress): %v", err)
	}
	if record.LastReadMessageAtUnixMs != 180 {
		t.Fatalf("LastReadMessageAtUnixMs=%d after progress, want=180", record.LastReadMessageAtUnixMs)
	}
	if record.LastSeenActivityRevision != 200 {
		t.Fatalf("LastSeenActivityRevision=%d after progress, want=200", record.LastSeenActivityRevision)
	}
	if record.LastSeenActivitySignature != "status:success\u001factivity:200" {
		t.Fatalf("LastSeenActivitySignature=%q after progress, want updated signature", record.LastSeenActivitySignature)
	}
	if record.LastSeenWaitingPromptID != "prompt_2" {
		t.Fatalf("LastSeenWaitingPromptID=%q after progress, want=prompt_2", record.LastSeenWaitingPromptID)
	}

	userRecords, err := store.EnsureFlower(ctx, "env_1", "user_1", map[string]FlowerSnapshot{
		"th_1": {
			ActivityRevision:    200,
			LastMessageAtUnixMs: 180,
			ActivitySignature:   "status:success\u001factivity:200",
			WaitingPromptID:     "prompt_2",
		},
	})
	if err != nil {
		t.Fatalf("EnsureFlower(user_1): %v", err)
	}
	if got := userRecords["th_1"].LastReadMessageAtUnixMs; got != 180 {
		t.Fatalf("user_1 LastReadMessageAtUnixMs=%d, want=180", got)
	}
}

func TestStore_FlowerRevisionDoesNotDeriveFromLastMessageAt(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openTestStore(t)

	records, err := store.EnsureFlower(ctx, "env_1", "user_1", map[string]FlowerSnapshot{
		"th_1": {
			ActivityRevision:    2,
			LastMessageAtUnixMs: 5000,
			ActivitySignature:   "activity:2\u001flast_message:5000",
		},
	})
	if err != nil {
		t.Fatalf("EnsureFlower: %v", err)
	}
	if got := records["th_1"].LastSeenActivityRevision; got != 2 {
		t.Fatalf("seed LastSeenActivityRevision=%d, want 2", got)
	}
	if got := records["th_1"].LastReadMessageAtUnixMs; got != 5000 {
		t.Fatalf("seed LastReadMessageAtUnixMs=%d, want 5000", got)
	}

	record, err := store.AdvanceFlower(ctx, "env_1", "user_1", "th_1", FlowerSnapshot{
		ActivityRevision:    3,
		LastMessageAtUnixMs: 6000,
		ActivitySignature:   "activity:3\u001flast_message:6000",
	})
	if err != nil {
		t.Fatalf("AdvanceFlower: %v", err)
	}
	if record.LastSeenActivityRevision != 3 {
		t.Fatalf("advance LastSeenActivityRevision=%d, want 3", record.LastSeenActivityRevision)
	}
	if record.LastReadMessageAtUnixMs != 6000 {
		t.Fatalf("advance LastReadMessageAtUnixMs=%d, want 6000", record.LastReadMessageAtUnixMs)
	}
}

func TestStore_MigratesV1ReadStateAndEnforcesV2Retirement(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "thread_read_state.sqlite")
	v1Spec := schemaSpec()
	v1Spec.CurrentVersion = 1
	v1Spec.Migrations = v1Spec.Migrations[:1]
	v1Spec.Verify = nil
	v1DB, err := sqliteutil.Open(dbPath, v1Spec)
	if err != nil {
		t.Fatalf("open v1 store: %v", err)
	}
	if _, err := v1DB.ExecContext(ctx, `
INSERT INTO thread_read_state (
  endpoint_id, scope_id, surface, thread_id,
  last_seen_activity_revision, last_read_message_at_unix_ms,
  last_seen_waiting_prompt_id, last_read_updated_at_unix_s,
  last_seen_activity_signature, updated_at_unix_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, "env_1", "user_1", string(SurfaceFlower), "thread_1", 17, 23, "prompt_1", 0, "activity:17", 29); err != nil {
		_ = v1DB.Close()
		t.Fatalf("insert v1 read state: %v", err)
	}
	if err := v1DB.Close(); err != nil {
		t.Fatalf("close v1 store: %v", err)
	}

	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("migrate v1 store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	records, err := store.EnsureFlower(ctx, "env_1", "user_1", map[string]FlowerSnapshot{
		"thread_1": {
			ActivityRevision:    17,
			LastMessageAtUnixMs: 23,
			WaitingPromptID:     "prompt_1",
			ActivitySignature:   "activity:17",
		},
	})
	if err != nil {
		t.Fatalf("load migrated read state: %v", err)
	}
	if got := records["thread_1"]; got.LastSeenActivityRevision != 17 || got.LastReadMessageAtUnixMs != 23 || got.LastSeenWaitingPromptID != "prompt_1" || got.LastSeenActivitySignature != "activity:17" {
		t.Fatalf("migrated read state = %+v", got)
	}
	if err := store.RetireFlowerThreadReadState(ctx, "env_1", "thread_1"); err != nil {
		t.Fatalf("retire migrated thread: %v", err)
	}
	if _, err := store.EnsureFlower(ctx, "env_1", "user_1", map[string]FlowerSnapshot{
		"thread_1": {ActivityRevision: 18},
	}); !errors.Is(err, ErrThreadRetired) {
		t.Fatalf("EnsureFlower after migration retirement error = %v, want %v", err, ErrThreadRetired)
	}
}

func TestStore_MigratesV2AndRemovesCodexRows(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "thread_read_state.sqlite")
	v2Spec := schemaSpec()
	v2Spec.CurrentVersion = 2
	v2Spec.Migrations = v2Spec.Migrations[:2]
	v2Spec.Verify = nil
	v2DB, err := sqliteutil.Open(dbPath, v2Spec)
	if err != nil {
		t.Fatalf("open v2 store: %v", err)
	}
	_, err = v2DB.ExecContext(ctx, `
INSERT INTO thread_read_state (
  endpoint_id, scope_id, surface, thread_id,
  last_seen_activity_revision, last_read_message_at_unix_ms,
  last_seen_waiting_prompt_id, last_read_updated_at_unix_s,
  last_seen_activity_signature, updated_at_unix_ms
) VALUES
  ('env_1', 'user_1', 'flower', 'flower_1', 4, 5, 'prompt', 0, 'flower', 6),
  ('env_1', 'user_1', 'codex', 'codex_1', 0, 0, '', 9, 'codex', 10);
INSERT INTO thread_read_state_retirements(endpoint_id, surface, thread_id, retired_at_unix_ms)
VALUES ('env_1', 'codex', 'codex_retired', 11);
`)
	if err != nil {
		_ = v2DB.Close()
		t.Fatalf("insert v2 rows: %v", err)
	}
	if err := v2DB.Close(); err != nil {
		t.Fatalf("close v2 store: %v", err)
	}

	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("migrate v2 store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	var flowerRows, codexRows, codexRetirements int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(1) FROM thread_read_state WHERE surface = 'flower'`).Scan(&flowerRows); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(1) FROM thread_read_state WHERE surface = 'codex'`).Scan(&codexRows); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(1) FROM thread_read_state_retirements WHERE surface = 'codex'`).Scan(&codexRetirements); err != nil {
		t.Fatal(err)
	}
	if flowerRows != 1 || codexRows != 0 || codexRetirements != 0 {
		t.Fatalf("migrated rows flower=%d codex=%d codex_retirements=%d", flowerRows, codexRows, codexRetirements)
	}
}

func TestStore_CodexMigrationRollsBackOnSchemaDrift(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "thread_read_state.sqlite")
	v2Spec := schemaSpec()
	v2Spec.CurrentVersion = 2
	v2Spec.Migrations = v2Spec.Migrations[:2]
	v2Spec.Verify = nil
	v2DB, err := sqliteutil.Open(dbPath, v2Spec)
	if err != nil {
		t.Fatalf("open v2 store: %v", err)
	}
	if _, err := v2DB.ExecContext(ctx, `
INSERT INTO thread_read_state (
  endpoint_id, scope_id, surface, thread_id,
  last_seen_activity_revision, last_read_message_at_unix_ms,
  last_seen_waiting_prompt_id, last_read_updated_at_unix_s,
  last_seen_activity_signature, updated_at_unix_ms
) VALUES ('env_1', 'user_1', 'codex', 'codex_1', 0, 0, '', 9, 'codex', 10);
CREATE TABLE unexpected_schema_drift(id INTEGER PRIMARY KEY);
`); err != nil {
		_ = v2DB.Close()
		t.Fatalf("seed drifted v2 store: %v", err)
	}
	if err := v2DB.Close(); err != nil {
		t.Fatalf("close v2 store: %v", err)
	}

	if _, err := Open(dbPath); err == nil {
		t.Fatal("Open succeeded, want schema verification failure")
	}
	raw, err := sqliteutil.Open(dbPath, v2Spec)
	if err != nil {
		t.Fatalf("reopen rolled-back v2 store: %v", err)
	}
	t.Cleanup(func() { _ = raw.Close() })
	var rows int
	if err := raw.QueryRowContext(ctx, `SELECT COUNT(1) FROM thread_read_state WHERE surface = 'codex'`).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Fatalf("codex rows after failed migration = %d, want 1", rows)
	}
}

func TestStore_RejectsFutureVersionWithoutChangingCodexRows(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "thread_read_state.sqlite")
	v2Spec := schemaSpec()
	v2Spec.CurrentVersion = 2
	v2Spec.Migrations = v2Spec.Migrations[:2]
	v2Spec.Verify = nil
	v2DB, err := sqliteutil.Open(dbPath, v2Spec)
	if err != nil {
		t.Fatalf("open v2 store: %v", err)
	}
	if _, err := v2DB.ExecContext(ctx, `
INSERT INTO thread_read_state (
  endpoint_id, scope_id, surface, thread_id,
  last_seen_activity_revision, last_read_message_at_unix_ms,
  last_seen_waiting_prompt_id, last_read_updated_at_unix_s,
  last_seen_activity_signature, updated_at_unix_ms
) VALUES ('env_1', 'user_1', 'codex', 'codex_1', 0, 0, '', 9, 'codex', 10);
PRAGMA user_version = 4;
`); err != nil {
		_ = v2DB.Close()
		t.Fatalf("seed future v2 store: %v", err)
	}
	if err := v2DB.Close(); err != nil {
		t.Fatalf("close v2 store: %v", err)
	}

	if _, err := Open(dbPath); err == nil {
		t.Fatal("Open succeeded, want future version error")
	} else {
		var tooNew *sqliteutil.DatabaseTooNewError
		if !errors.As(err, &tooNew) {
			t.Fatalf("error = %v, want DatabaseTooNewError", err)
		}
	}
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("reopen future store: %v", err)
	}
	t.Cleanup(func() { _ = raw.Close() })
	var rows int
	if err := raw.QueryRowContext(ctx, `SELECT COUNT(1) FROM thread_read_state WHERE surface = 'codex'`).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Fatalf("codex rows after future rejection = %d, want 1", rows)
	}
}

func TestStore_RetireFlowerThreadRejectsFutureEnsureAndAdvance(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openTestStore(t)
	snapshot := FlowerSnapshot{ActivityRevision: 10, LastMessageAtUnixMs: 20, ActivitySignature: "activity:10"}
	if _, err := store.EnsureFlower(ctx, "env_retired", "user_1", map[string]FlowerSnapshot{"thread_retired": snapshot}); err != nil {
		t.Fatal(err)
	}
	if err := store.RetireFlowerThreadReadState(ctx, "env_retired", "thread_retired"); err != nil {
		t.Fatal(err)
	}
	if err := store.RetireFlowerThreadReadState(ctx, "env_retired", "thread_retired"); err != nil {
		t.Fatalf("idempotent retirement: %v", err)
	}
	if _, err := store.EnsureFlower(ctx, "env_retired", "user_2", map[string]FlowerSnapshot{"thread_retired": snapshot}); !errors.Is(err, ErrThreadRetired) {
		t.Fatalf("EnsureFlower error=%v, want %v", err, ErrThreadRetired)
	}
	if _, err := store.AdvanceFlower(ctx, "env_retired", "user_1", "thread_retired", snapshot); !errors.Is(err, ErrThreadRetired) {
		t.Fatalf("AdvanceFlower error=%v, want %v", err, ErrThreadRetired)
	}
	var records int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(1) FROM thread_read_state WHERE endpoint_id = ? AND surface = ? AND thread_id = ?`, "env_retired", string(SurfaceFlower), "thread_retired").Scan(&records); err != nil {
		t.Fatal(err)
	}
	if records != 0 {
		t.Fatalf("retired thread read-state rows=%d, want 0", records)
	}
}
