package threadreadstate

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"reflect"
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
	if record.LastSeenActivitySignature != "status:waiting_user\u001factivity:130\u001fprompt:prompt_2" {
		t.Fatalf("LastSeenActivitySignature=%q after same revision, want current signature", record.LastSeenActivitySignature)
	}
	if record.LastSeenWaitingPromptID != "prompt_2" {
		t.Fatalf("LastSeenWaitingPromptID=%q after same revision, want=prompt_2", record.LastSeenWaitingPromptID)
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

func TestStore_EnsureCodexSeedsMissingBaselineAndAdvanceIsMonotonic(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openTestStore(t)

	records, err := store.EnsureCodex(ctx, "env_1", "user_1", map[string]CodexSnapshot{
		"thread_1": {
			UpdatedAtUnixS:    42,
			ActivitySignature: "status:idle",
		},
	})
	if err != nil {
		t.Fatalf("EnsureCodex: %v", err)
	}

	record := records["thread_1"]
	if record.LastReadUpdatedAtUnixS != 42 {
		t.Fatalf("LastReadUpdatedAtUnixS=%d, want=42", record.LastReadUpdatedAtUnixS)
	}
	if record.LastSeenActivitySignature != "status:idle" {
		t.Fatalf("LastSeenActivitySignature=%q, want=status:idle", record.LastSeenActivitySignature)
	}

	record, err = store.AdvanceCodex(ctx, "env_1", "user_1", "thread_1", CodexSnapshot{
		UpdatedAtUnixS:    40,
		ActivitySignature: "",
	})
	if err != nil {
		t.Fatalf("AdvanceCodex(regress): %v", err)
	}
	if record.LastReadUpdatedAtUnixS != 42 {
		t.Fatalf("LastReadUpdatedAtUnixS=%d after regress, want=42", record.LastReadUpdatedAtUnixS)
	}
	if record.LastSeenActivitySignature != "status:idle" {
		t.Fatalf("LastSeenActivitySignature=%q after regress, want=status:idle", record.LastSeenActivitySignature)
	}

	record, err = store.AdvanceCodex(ctx, "env_1", "user_1", "thread_1", CodexSnapshot{
		UpdatedAtUnixS:    88,
		ActivitySignature: "status:waiting_user\u001frequest:req_1",
	})
	if err != nil {
		t.Fatalf("AdvanceCodex(progress): %v", err)
	}
	if record.LastReadUpdatedAtUnixS != 88 {
		t.Fatalf("LastReadUpdatedAtUnixS=%d after progress, want=88", record.LastReadUpdatedAtUnixS)
	}
	if record.LastSeenActivitySignature != "status:waiting_user\u001frequest:req_1" {
		t.Fatalf("LastSeenActivitySignature=%q after progress, want updated signature", record.LastSeenActivitySignature)
	}
}

func TestStore_DeleteThreadRemovesSurfaceRecordsAndRestoreRecords(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openTestStore(t)

	if _, err := store.EnsureFlower(ctx, "env_1", "user_1", map[string]FlowerSnapshot{
		"th_1": {
			LastMessageAtUnixMs: 120,
			WaitingPromptID:     "prompt_1",
		},
		"th_other": {
			LastMessageAtUnixMs: 90,
			WaitingPromptID:     "prompt_other",
		},
	}); err != nil {
		t.Fatalf("EnsureFlower(user_1 first): %v", err)
	}
	if _, err := store.EnsureFlower(ctx, "env_1", "user_1", map[string]FlowerSnapshot{
		"th_1": {
			LastMessageAtUnixMs: 130,
			WaitingPromptID:     "prompt_2",
		},
	}); err != nil {
		t.Fatalf("EnsureFlower(user_1 second): %v", err)
	}
	if _, err := store.EnsureFlower(ctx, "env_1", "user_2", map[string]FlowerSnapshot{
		"th_1": {
			LastMessageAtUnixMs: 140,
			WaitingPromptID:     "prompt_user_2",
		},
	}); err != nil {
		t.Fatalf("EnsureFlower(user_2): %v", err)
	}
	if _, err := store.EnsureCodex(ctx, "env_1", "user_1", map[string]CodexSnapshot{
		"th_1": {
			UpdatedAtUnixS:    42,
			ActivitySignature: "status:idle",
		},
	}); err != nil {
		t.Fatalf("EnsureCodex(user_1): %v", err)
	}

	deleted, err := store.DeleteThread(ctx, "env_1", SurfaceFlower, "th_1")
	if err != nil {
		t.Fatalf("DeleteThread(flower): %v", err)
	}
	if len(deleted) != 2 {
		t.Fatalf("len(deleted)=%d, want 2", len(deleted))
	}
	if deleted[0].ScopeID != "user_1" || deleted[1].ScopeID != "user_2" {
		t.Fatalf("deleted scopes=%+v, want user_1 and user_2", deleted)
	}

	redeleted, err := store.DeleteThread(ctx, "env_1", SurfaceFlower, "th_1")
	if err != nil {
		t.Fatalf("DeleteThread(flower, second): %v", err)
	}
	if len(redeleted) != 0 {
		t.Fatalf("len(redeleted)=%d, want 0", len(redeleted))
	}

	codexDeleted, err := store.DeleteThread(ctx, "env_1", SurfaceCodex, "th_1")
	if err != nil {
		t.Fatalf("DeleteThread(codex): %v", err)
	}
	if len(codexDeleted) != 1 {
		t.Fatalf("len(codexDeleted)=%d, want 1", len(codexDeleted))
	}

	if err := store.RestoreRecords(ctx, deleted); err != nil {
		t.Fatalf("RestoreRecords: %v", err)
	}
	restoredDeleted, err := store.DeleteThread(ctx, "env_1", SurfaceFlower, "th_1")
	if err != nil {
		t.Fatalf("DeleteThread(flower after restore): %v", err)
	}
	if !reflect.DeepEqual(restoredDeleted, deleted) {
		t.Fatalf("restoredDeleted=%+v, want %+v", restoredDeleted, deleted)
	}

	otherDeleted, err := store.DeleteThread(ctx, "env_1", SurfaceFlower, "th_other")
	if err != nil {
		t.Fatalf("DeleteThread(flower other): %v", err)
	}
	if len(otherDeleted) != 1 || otherDeleted[0].ScopeID != "user_1" {
		t.Fatalf("otherDeleted=%+v, want one user_1 scope record", otherDeleted)
	}
}

func TestStore_OpenResettingInvalidSchemaRebuildsCurrentDatabase(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "thread_read_state.sqlite")
	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if _, err := store.EnsureFlower(context.Background(), "env_1", "user_1", map[string]FlowerSnapshot{
		"th_old": {LastMessageAtUnixMs: 120},
	}); err != nil {
		_ = store.Close()
		t.Fatalf("EnsureFlower: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	if _, err := raw.Exec(`
DROP TABLE thread_read_state;
CREATE TABLE thread_read_state (
  endpoint_id TEXT NOT NULL,
  surface TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  last_seen_activity_revision INTEGER NOT NULL DEFAULT 0,
  last_read_message_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_seen_waiting_prompt_id TEXT NOT NULL DEFAULT '',
  last_read_updated_at_unix_s INTEGER NOT NULL DEFAULT 0,
  last_seen_activity_signature TEXT NOT NULL DEFAULT '',
  updated_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY (endpoint_id, surface, thread_id)
);
`); err != nil {
		_ = raw.Close()
		t.Fatalf("break thread_read_state schema: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close raw db: %v", err)
	}

	_, err = Open(dbPath)
	if err == nil {
		t.Fatalf("Open succeeded, want schema verify error")
	}
	var schemaErr *sqliteutil.SchemaVerifyError
	if !errors.As(err, &schemaErr) {
		t.Fatalf("Open error=%v, want SchemaVerifyError", err)
	}

	store, err = OpenResettingInvalidSchema(dbPath)
	if err != nil {
		t.Fatalf("OpenResettingInvalidSchema: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})
	if _, err := store.EnsureFlower(context.Background(), "env_1", "user_1", map[string]FlowerSnapshot{
		"th_new": {LastMessageAtUnixMs: 200},
	}); err != nil {
		t.Fatalf("EnsureFlower after rebuild: %v", err)
	}
	var count int
	if err := store.db.QueryRow(`SELECT COUNT(1) FROM thread_read_state WHERE thread_id = 'th_old'`).Scan(&count); err != nil {
		t.Fatalf("count old records: %v", err)
	}
	if count != 0 {
		t.Fatalf("old record count=%d, want reset database", count)
	}
}
