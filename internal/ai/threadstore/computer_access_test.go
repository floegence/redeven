package threadstore

import (
	"database/sql"
	"errors"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func TestComputerAccessV8MigrationAndRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	createReviewedVersionDatabaseForTest(t, path, 8)
	seedComputerMigrationThread(t, path)
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = raw.Exec(`UPDATE ai_thread_settings SET pin_rank = 4, pinned_at_unix_ms = 7, computer_target_id = 'chosen-tab' WHERE thread_id = 'thread'`)
	_ = raw.Close()
	if err != nil {
		t.Fatal(err)
	}
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	initial, err := store.GetComputerAccess(t.Context(), "thread")
	if err != nil || !reflect.DeepEqual(initial, ComputerAccess{}) {
		t.Fatalf("migration default: %+v %v", initial, err)
	}
	want := ComputerAccess{Origins: []string{"https://example.test", "http://127.0.0.1:3000"}, Apps: []string{"com.example.Editor"}, AllowForeground: true}
	if err := store.SetComputerAccess(t.Context(), "thread", want); err != nil {
		t.Fatal(err)
	}
	settings, err := store.GetThreadSettings(t.Context(), "env", "thread")
	if err != nil || settings.WorkingDir != "/project" || settings.SettingsUpdatedAtUnixMs != 11 || settings.PinRank != 4 || settings.PinnedAtUnixMs != 7 {
		t.Fatalf("migration changed settings: %+v %v", settings, err)
	}
	target, err := store.GetComputerTarget(t.Context(), "thread")
	if err != nil || target != "chosen-tab" {
		t.Fatalf("migration changed target: %q %v", target, err)
	}
	// New product settings, including a fork's settings, cannot inherit grants
	// by copying the normal ThreadSettings projection.
	child := *settings
	child.ThreadID = "fork"
	if err := store.CreateThreadSettings(t.Context(), child); err != nil {
		t.Fatal(err)
	}
	access, err := store.GetComputerAccess(t.Context(), child.ThreadID)
	if err != nil || !reflect.DeepEqual(access, ComputerAccess{}) {
		t.Fatalf("grants escaped to fork: %+v %v", access, err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	access, err = reopened.GetComputerAccess(t.Context(), "thread")
	if err != nil || !reflect.DeepEqual(access, want) {
		t.Fatalf("restart: %+v %v", access, err)
	}
	if err := reopened.SetComputerAccess(t.Context(), "missing", want); err == nil {
		t.Fatal("granted access to an unknown thread")
	}
}

func TestComputerAccessMigrationFailurePreservesExactV8(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	createReviewedVersionDatabaseForTest(t, path, 8)
	seedComputerMigrationThread(t, path)
	spec := threadstoreSchemaSpec()
	failure := errors.New("injected failure after computer grant migration")
	spec.Migrations[len(spec.Migrations)-1].Apply = func(tx *sql.Tx) error {
		if err := migrateThreadstoreV8ToV9(tx); err != nil {
			return err
		}
		return failure
	}
	db, err := sqliteutil.Open(path, spec)
	if db != nil {
		db.Close()
		t.Fatal("failed migration returned a database")
	}
	if !errors.Is(err, failure) {
		t.Fatal(err)
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
	defer func() { _ = tx.Rollback() }()
	actual, err := inspectReviewedSchemaTx(tx)
	if err != nil {
		t.Fatal(err)
	}
	expected, err := reviewedProductSchemaContract(8)
	if err != nil {
		t.Fatal(err)
	}
	if err := compareReviewedSchemas(actual, expected); err != nil {
		t.Fatal(err)
	}
}

func TestComputerAccessRejectsUnscopedOrAmbiguousGrants(t *testing.T) {
	for _, access := range []ComputerAccess{
		{Origins: []string{"*"}}, {Origins: []string{"file:///tmp"}}, {Origins: []string{"https://name:password@example.test"}},
		{Origins: []string{"https://example.test/"}}, {Origins: []string{"https://example.test?scope=all"}},
		{Origins: []string{"https://example.test", "https://example.test"}}, {Apps: []string{"../app"}},
		{Apps: []string{"com.example.App", "com.example.App"}},
	} {
		if access.Validate() == nil {
			t.Fatalf("accepted %+v", access)
		}
	}
}
