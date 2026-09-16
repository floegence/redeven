package threadstore

import (
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"sync"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func createPinThread(t *testing.T, store *Store, endpoint, id string, created int64) {
	t.Helper()
	if err := store.CreateThreadSettings(t.Context(), ThreadSettings{ThreadID: id, EndpointID: endpoint, PermissionType: "approval_required", SettingsCreatedAtUnixMs: created}); err != nil {
		t.Fatal(err)
	}
}

func pinIDs(t *testing.T, store *Store, endpoint string) []string {
	t.Helper()
	var ids []string
	cursor := ThreadsCursor{}
	for {
		items, next, err := store.ListThreadSettings(t.Context(), endpoint, 37, cursor)
		if err != nil {
			t.Fatal(err)
		}
		for _, item := range items {
			if item.PinnedAtUnixMs > 0 {
				ids = append(ids, item.ThreadID)
			}
		}
		if next == "" {
			return ids
		}
		var ok bool
		cursor, ok = DecodeCursor(next)
		if !ok {
			t.Fatal("invalid returned cursor")
		}
	}
}

func TestPinnedOrderPersistsRelativeMovesAcrossPages(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	for i := range 205 {
		id := fmt.Sprintf("thread_%03d", i)
		createPinThread(t, store, "env", id, int64(i+1))
		if _, err := store.SetThreadPinned(t.Context(), "env", id, true); err != nil {
			t.Fatal(err)
		}
	}
	before, _ := store.GetThreadSettings(t.Context(), "env", "thread_204")
	legacyCursor := EncodeCursor(ThreadsCursor{ThreadID: before.ThreadID, PinnedAtUnixMs: before.PinnedAtUnixMs, SettingsCreatedAtUnixMs: before.SettingsCreatedAtUnixMs})
	changes, err := store.MovePinnedThread(t.Context(), "env", "thread_204", "thread_000", "after")
	if err != nil || len(changes) != 205 {
		t.Fatalf("move changes=%d error=%v", len(changes), err)
	}
	want := make([]string, 0, 205)
	for i := 203; i >= 0; i-- {
		want = append(want, fmt.Sprintf("thread_%03d", i))
	}
	want = append(want, "thread_204")
	if got := pinIDs(t, store, "env"); !reflect.DeepEqual(got, want) {
		t.Fatalf("paged order differs: %v", got)
	}
	after, _ := store.GetThreadSettings(t.Context(), "env", "thread_204")
	cursor, ok := DecodeCursor(legacyCursor)
	if !ok {
		t.Fatal("old cursor is no longer readable")
	}
	remaining, _, err := store.ListThreadSettings(t.Context(), "env", 200, cursor)
	if err != nil || len(remaining) != 0 {
		t.Fatalf("cursor did not follow its moved anchor: %d %v", len(remaining), err)
	}
	if after.PinnedAtUnixMs != before.PinnedAtUnixMs || after.SettingsUpdatedAtUnixMs <= before.SettingsUpdatedAtUnixMs {
		t.Fatal("move changed pin time or failed to advance settings revision")
	}
	if _, err := store.SetThreadPinned(t.Context(), "env", "thread_204", true); err != nil {
		t.Fatal(err)
	}
	if got := pinIDs(t, store, "env"); !reflect.DeepEqual(got, want) {
		t.Fatal("repeated pin reset manual order")
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := pinIDs(t, store, "env"); !reflect.DeepEqual(got, want) {
		t.Fatal("reopen lost pinned order")
	}
	if _, err := store.SetThreadPinned(t.Context(), "env", "thread_204", false); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetThreadPinned(t.Context(), "env", "thread_204", true); err != nil {
		t.Fatal(err)
	}
	if got := pinIDs(t, store, "env"); got[0] != "thread_204" {
		t.Fatal("new pin was not placed first")
	}
}

func TestPinnedMoveRejectsInvalidTargetsAndRollsBack(t *testing.T) {
	store := openStoreForTest(t)
	for _, id := range []string{"a", "b", "c", "regular"} {
		createPinThread(t, store, "env", id, 1)
		if id != "regular" {
			if _, err := store.SetThreadPinned(t.Context(), "env", id, true); err != nil {
				t.Fatal(err)
			}
		}
	}
	createPinThread(t, store, "foreign", "foreign", 1)
	before := pinIDs(t, store, "env")
	for _, tc := range []struct {
		source, target, placement string
		want                      error
	}{
		{"a", "regular", "before", ErrPinPositionConflict},
		{"regular", "a", "before", ErrPinPositionConflict},
		{"a", "missing", "before", sql.ErrNoRows},
		{"a", "foreign", "before", sql.ErrNoRows},
		{"a", "a", "before", nil},
		{"a", "b", "invalid", nil},
	} {
		_, err := store.MovePinnedThread(t.Context(), "env", tc.source, tc.target, tc.placement)
		if err == nil || (tc.want != nil && !errors.Is(err, tc.want)) {
			t.Fatalf("move %#v error=%v", tc, err)
		}
	}
	if _, err := store.db.Exec(`CREATE TRIGGER fail_pin_move BEFORE UPDATE OF pin_rank ON ai_thread_settings WHEN NEW.thread_id = 'b' BEGIN SELECT RAISE(ABORT, 'injected write failure'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.MovePinnedThread(t.Context(), "env", "a", "c", "before"); err == nil {
		t.Fatal("injected failure was ignored")
	}
	if got := pinIDs(t, store, "env"); !reflect.DeepEqual(got, before) {
		t.Fatal("partial order escaped rollback")
	}
}

func TestConcurrentPinMutationsKeepOneEndpointOrder(t *testing.T) {
	store := openStoreForTest(t)
	for _, id := range []string{"a", "b", "c"} {
		createPinThread(t, store, "env", id, 1)
		if _, err := store.SetThreadPinned(t.Context(), "env", id, true); err != nil {
			t.Fatal(err)
		}
	}
	var group sync.WaitGroup
	for i := 0; i < 20; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			if _, err := store.MovePinnedThread(t.Context(), "env", "a", "c", "before"); err != nil {
				t.Error(err)
			}
		}()
	}
	group.Wait()
	if got := pinIDs(t, store, "env"); !reflect.DeepEqual(got, []string{"a", "c", "b"}) {
		t.Fatalf("concurrent relative moves = %v", got)
	}
}

func TestRelativeMoveSerializesWithUnpinAndDeletion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	other, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	for _, id := range []string{"a", "b", "c", "d"} {
		createPinThread(t, store, "env", id, 1)
		if _, err := store.SetThreadPinned(t.Context(), "env", id, true); err != nil {
			t.Fatal(err)
		}
	}
	start := make(chan struct{})
	var group sync.WaitGroup
	for _, mutation := range []func() error{
		func() error {
			_, err := store.MovePinnedThread(t.Context(), "env", "a", "c", "before")
			if errors.Is(err, ErrPinPositionConflict) {
				return nil
			}
			return err
		},
		func() error { _, err := other.SetThreadPinned(t.Context(), "env", "c", false); return err },
		func() error { return other.DeleteThreadProductData(t.Context(), "env", "b") },
	} {
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			if err := mutation(); err != nil {
				t.Error(err)
			}
		}()
	}
	close(start)
	group.Wait()
	if got := pinIDs(t, store, "env"); !reflect.DeepEqual(got, []string{"d", "a"}) {
		t.Fatalf("concurrent order: %v", got)
	}
	unpinned, err := store.GetThreadSettings(t.Context(), "env", "c")
	if err != nil || unpinned.PinRank != 0 {
		t.Fatalf("unpin rank: %+v %v", unpinned, err)
	}
	deleted, err := store.GetThreadSettings(t.Context(), "env", "b")
	if err != nil || deleted != nil {
		t.Fatalf("deleted thread returned: %+v %v", deleted, err)
	}
}

func TestV7PinMigrationPreservesHistoricalOrder(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	createReviewedVersionDatabaseForTest(t, path, 7)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		id              string
		pinned, created int
	}{{"old", 10, 9}, {"new_a", 20, 5}, {"new_b", 20, 5}, {"regular", 0, 100}} {
		if _, err := db.Exec(`INSERT INTO ai_thread_settings(thread_id, endpoint_id, pinned_at_unix_ms, settings_created_at_unix_ms, settings_updated_at_unix_ms, working_dir) VALUES(?, 'env', ?, ?, 25, '/kept')`, item.id, item.pinned, item.created); err != nil {
			t.Fatal(err)
		}
	}
	_ = db.Close()
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if got := pinIDs(t, store, "env"); !reflect.DeepEqual(got, []string{"new_a", "new_b", "old"}) {
		t.Fatalf("migrated order = %v", got)
	}
	item, err := store.GetThreadSettings(t.Context(), "env", "old")
	if err != nil || item.WorkingDir != "/kept" || item.PinnedAtUnixMs != 10 || item.SettingsUpdatedAtUnixMs != 25 {
		t.Fatalf("migration changed user facts: %#v %v", item, err)
	}
}

func TestV8PinMigrationFailureRollsBackSchemaAndData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	createReviewedVersionDatabaseForTest(t, path, 7)
	seedComputerMigrationThread(t, path)
	spec := threadstoreSchemaSpec()
	failure := errors.New("injected rank migration failure")
	for index, migration := range spec.Migrations {
		if migration.FromVersion == 7 {
			spec.Migrations[index].Apply = func(tx *sql.Tx) error {
				if err := migrateThreadstoreV7ToV8(tx); err != nil {
					return err
				}
				return failure
			}
		}
	}
	db, err := sqliteutil.Open(path, spec)
	if db != nil {
		db.Close()
		t.Fatal("failed migration returned database")
	}
	if !errors.Is(err, failure) {
		t.Fatalf("migration error: %v", err)
	}
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	tx, err := raw.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	actual, err := inspectReviewedSchemaTx(tx)
	if err != nil {
		t.Fatal(err)
	}
	expected, err := reviewedProductSchemaContract(7)
	if err != nil {
		t.Fatal(err)
	}
	if err := compareReviewedSchemas(actual, expected); err != nil {
		t.Fatal(err)
	}
	var version int
	if err := tx.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != 7 {
		t.Fatalf("schema version changed: %d %v", version, err)
	}
	var dir string
	if err := tx.QueryRow(`SELECT working_dir FROM ai_thread_settings WHERE thread_id = 'thread'`).Scan(&dir); err != nil || dir != "/project" {
		t.Fatalf("user record changed: %q %v", dir, err)
	}
}
