package browserstore

import (
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func versionOneStore(t *testing.T) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "browser.sqlite")
	spec := schemaSpec()
	spec.CurrentVersion = 1
	spec.Migrations = nil
	spec.Initialize = createSchemaV1
	spec.Verify = func(tx *sql.Tx) error { return verifySchemaVersion(tx, 1) }
	db, err := sqliteutil.Open(path, spec)
	if err != nil {
		t.Fatal(err)
	}
	return &Store{db: db}, path
}

func TestBrowserPreferenceMigrationPreservesLibraryAndOwnerIsolation(t *testing.T) {
	old, path := versionOneStore(t)
	mustProfile(t, old, "alice", "work", Managed)
	if err := old.SaveTabs(t.Context(), "alice", "work", []Tab{{URL: "https://example.test/", Selected: true}}); err != nil {
		t.Fatal(err)
	}
	if err := old.PutBookmark(t.Context(), "alice", "work", Entry{URL: "https://example.test/"}); err != nil {
		t.Fatal(err)
	}
	old.Close()
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if tabs, err := store.Tabs(t.Context(), "alice", "work"); err != nil || len(tabs) != 1 {
		t.Fatalf("tabs: %v %v", tabs, err)
	}
	if marks, err := store.Bookmarks(t.Context(), "alice", "work"); err != nil || len(marks) != 1 {
		t.Fatalf("bookmarks: %v %v", marks, err)
	}
	if p, err := store.Preference(t.Context(), "alice"); err != nil || p != nil {
		t.Fatalf("migration invented a selection: %v %v", p, err)
	}
	want := Preference{ProfileID: "work"}
	if err := store.SetPreference(t.Context(), "alice", want); err != nil {
		t.Fatal(err)
	}
	if p, err := store.Preference(t.Context(), "alice"); err != nil || p == nil || *p != want {
		t.Fatalf("preference: %v %v", p, err)
	}
	if p, err := store.Preference(t.Context(), "bob"); err != nil || p != nil {
		t.Fatal("preference crossed owner boundary")
	}
	if err := store.SetPreference(t.Context(), "bob", want); !errors.Is(err, ErrProfileMissing) {
		t.Fatal(err)
	}
}

func TestBrowserPreferenceMigrationRollsBackAsOneTransaction(t *testing.T) {
	old, path := versionOneStore(t)
	mustProfile(t, old, "alice", "work", Managed)
	old.Close()
	spec := schemaSpec()
	apply := spec.Migrations[0].Apply
	spec.Migrations[0].Apply = func(tx *sql.Tx) error {
		if err := apply(tx); err != nil {
			return err
		}
		return errors.New("fixture migration failure")
	}
	if db, err := sqliteutil.Open(path, spec); err == nil {
		db.Close()
		t.Fatal("migration failure accepted")
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var version, count int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 1 {
		t.Fatalf("version: %d %v", version, err)
	}
	if err := db.QueryRow("SELECT count(*) FROM sqlite_master WHERE name='browser_preferences'").Scan(&count); err != nil || count != 0 {
		t.Fatal("partial migration retained")
	}
	if err := db.QueryRow("SELECT count(*) FROM browser_profiles WHERE owner_id='alice'").Scan(&count); err != nil || count != 1 {
		t.Fatal("user profile lost")
	}
}
