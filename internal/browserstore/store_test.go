package browserstore

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func openTestStore(t *testing.T) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "browser.sqlite")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store, path
}

func mustProfile(t *testing.T, store *Store, owner, id string, kind SourceKind) {
	t.Helper()
	if err := store.PutProfile(context.Background(), owner, Profile{ID: id, Name: "Work", Kind: kind}); err != nil {
		t.Fatal(err)
	}
}

func TestLibraryRejectsAmbiguousIdentityBeforeReadingOrWriting(t *testing.T) {
	ctx := context.Background()
	store, _ := openTestStore(t)
	mustProfile(t, store, "owner", "profile", Managed)
	for _, scope := range [][2]string{{" owner", "profile"}, {"owner", "profile "}} {
		if _, err := store.Tabs(ctx, scope[0], scope[1]); err == nil {
			t.Fatal("noncanonical identity was accepted")
		}
		if err := store.PutBookmark(ctx, scope[0], scope[1], Entry{URL: "https://example.test/"}); err == nil {
			t.Fatal("noncanonical identity reached a write")
		}
	}
	if err := store.SaveTabs(ctx, "owner", "profile", []Tab{{URL: " https://example.test/page ", Selected: true}}); err != nil {
		t.Fatal(err)
	}
	tabs, err := store.Tabs(ctx, "owner", "profile")
	if err != nil || len(tabs) != 1 || tabs[0].URL != "https://example.test/page" {
		t.Fatalf("restore URL was not canonicalized: %v %v", tabs, err)
	}
}

func TestZoomUsesOneValidatedWebOriginForReadsAndWrites(t *testing.T) {
	ctx := context.Background()
	store, _ := openTestStore(t)
	mustProfile(t, store, "owner", "profile", Managed)
	for _, origin := range []string{"ftp://example.test", "https://example.test/path", "https://example.test?", "https://example.test#", "https://user@example.test", "https://:443"} {
		if err := store.SetZoom(ctx, "owner", "profile", origin, 1.25); err == nil {
			t.Errorf("invalid zoom origin accepted: %q", origin)
		}
		if _, err := store.Zoom(ctx, "owner", "profile", origin); err == nil {
			t.Errorf("invalid zoom origin read accepted: %q", origin)
		}
	}
	for _, zoom := range []float64{math.NaN(), math.Inf(1), 0, 5.1} {
		if err := store.SetZoom(ctx, "owner", "profile", "https://example.test", zoom); err == nil {
			t.Errorf("invalid zoom accepted: %v", zoom)
		}
	}
	if err := store.SetZoom(ctx, "owner", "profile", "https://EXAMPLE.test:443", 1.5); err != nil {
		t.Fatal(err)
	}
	zoom, err := store.Zoom(ctx, "owner", "profile", "https://example.test")
	if err != nil || zoom != 1.5 {
		t.Fatalf("same web origin did not share zoom: %v %v", zoom, err)
	}
}

func TestLibrarySurvivesReopenWithoutRuntimeAuthority(t *testing.T) {
	ctx := context.Background()
	store, path := openTestStore(t)
	mustProfile(t, store, "alice", "work", Managed)
	tabs := []Tab{{URL: "https://example.test/one#section", Title: "First", Pinned: true}, {URL: "about:blank", Selected: true}}
	if err := store.SaveTabs(ctx, "alice", "work", tabs); err != nil {
		t.Fatal(err)
	}
	entry := Entry{URL: "https://example.test/one#section", Title: "Reading"}
	if err := store.PutBookmark(ctx, "alice", "work", entry); err != nil {
		t.Fatal(err)
	}
	if err := store.Visit(ctx, "alice", "work", entry); err != nil {
		t.Fatal(err)
	}
	if err := store.SetZoom(ctx, "alice", "work", "https://example.test", 1.25); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	got, err := reopened.Tabs(ctx, "alice", "work")
	if err != nil || !reflect.DeepEqual(got, tabs) {
		t.Fatalf("tabs=%+v err=%v", got, err)
	}
	bookmarks, err := reopened.Bookmarks(ctx, "alice", "work")
	if err != nil || len(bookmarks) != 1 || bookmarks[0].URL != entry.URL || bookmarks[0].Title != entry.Title {
		t.Fatalf("bookmarks=%+v err=%v", bookmarks, err)
	}
	visits, err := reopened.History(ctx, "alice", "work", "Reading", 10)
	if err != nil || len(visits) != 1 || visits[0].Visits != 1 {
		t.Fatalf("history=%+v err=%v", visits, err)
	}
	zoom, err := reopened.Zoom(ctx, "alice", "work", "https://example.test")
	if err != nil || zoom != 1.25 {
		t.Fatalf("zoom=%v err=%v", zoom, err)
	}
	// A recovery record has only navigation metadata. Runtime target IDs,
	// controller leases, credentials, form values and POST bodies have no fields.
	columns, err := reopened.db.Query(`SELECT name FROM pragma_table_info('browser_tabs')`)
	if err != nil {
		t.Fatal(err)
	}
	defer columns.Close()
	var names []string
	for columns.Next() {
		var name string
		if err := columns.Scan(&name); err != nil {
			t.Fatal(err)
		}
		names = append(names, name)
	}
	if err := columns.Err(); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(names, []string{"owner_id", "profile_id", "position", "url", "title", "pinned", "selected"}) {
		t.Fatalf("recovery columns=%v", names)
	}
}

func TestLibraryScopesRecordsAndKeepsSourceKindImmutable(t *testing.T) {
	ctx := context.Background()
	store, _ := openTestStore(t)
	mustProfile(t, store, "alice", "work", Managed)
	mustProfile(t, store, "bob", "work", Extension)
	if err := store.PutBookmark(ctx, "alice", "work", Entry{URL: "https://private.test", Title: "Private"}); err != nil {
		t.Fatal(err)
	}
	if err := store.Visit(ctx, "alice", "work", Entry{URL: "https://private.test", Title: "Private"}); err != nil {
		t.Fatal(err)
	}
	if err := store.PutProfile(ctx, "alice", Profile{ID: "work", Name: "Changed", Kind: CDP}); !errors.Is(err, ErrSourceChanged) {
		t.Fatalf("source kind changed: %v", err)
	}
	profiles, err := store.Profiles(ctx, "alice")
	if err != nil || len(profiles) != 1 || profiles[0].Kind != Managed || profiles[0].Name != "Work" {
		t.Fatalf("profiles=%+v err=%v", profiles, err)
	}
	bookmarks, err := store.Bookmarks(ctx, "bob", "work")
	if err != nil || len(bookmarks) != 0 {
		t.Fatalf("other owner's bookmarks=%+v err=%v", bookmarks, err)
	}
	visits, err := store.History(ctx, "bob", "work", "", 10)
	if err != nil || len(visits) != 0 {
		t.Fatalf("other owner's history=%+v err=%v", visits, err)
	}
	if err := store.PutBookmark(ctx, "eve", "work", Entry{URL: "https://example.test"}); !errors.Is(err, ErrProfileMissing) {
		t.Fatalf("missing owner profile: %v", err)
	}
	if err := store.ClearHistory(ctx, "bob", "work"); err != nil {
		t.Fatal(err)
	}
	visits, err = store.History(ctx, "alice", "work", "", 10)
	if err != nil || len(visits) != 1 {
		t.Fatalf("other owner's clear altered history: %+v %v", visits, err)
	}
}

func TestOnlyManagedProfilesHaveRestorableTabs(t *testing.T) {
	ctx := context.Background()
	store, _ := openTestStore(t)
	for _, kind := range []SourceKind{CDP, Extension} {
		mustProfile(t, store, "alice", string(kind), kind)
		if err := store.SaveTabs(ctx, "alice", string(kind), []Tab{{URL: "https://example.test", Selected: true}}); !errors.Is(err, ErrExternalRestore) {
			t.Fatalf("external restore %s: %v", kind, err)
		}
		if _, err := store.Tabs(ctx, "alice", string(kind)); !errors.Is(err, ErrExternalRestore) {
			t.Fatalf("external read %s: %v", kind, err)
		}
	}
}

func TestRejectedSnapshotsAndFailedWritesPreservePreviousTabs(t *testing.T) {
	ctx := context.Background()
	store, _ := openTestStore(t)
	mustProfile(t, store, "alice", "work", Managed)
	original := []Tab{{URL: "https://example.test/retained", Selected: true}}
	if err := store.SaveTabs(ctx, "alice", "work", original); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range [][]Tab{
		{{URL: "javascript:alert(1)", Selected: true}},
		{{URL: "data:text/html,private", Selected: true}},
		{{URL: "file:///etc/passwd", Selected: true}},
		{{URL: "https://user:password@example.test", Selected: true}},
		{{URL: "https://example.test"}},
		{{URL: "https://one.test", Selected: true}, {URL: "https://two.test", Selected: true}},
	} {
		if err := store.SaveTabs(ctx, "alice", "work", invalid); err == nil {
			t.Fatalf("accepted invalid snapshot %+v", invalid)
		}
		got, err := store.Tabs(ctx, "alice", "work")
		if err != nil || !reflect.DeepEqual(got, original) {
			t.Fatalf("lost snapshot: %+v %v", got, err)
		}
	}
	if _, err := store.db.Exec(`CREATE TRIGGER fail_tab BEFORE INSERT ON browser_tabs WHEN NEW.position=1 BEGIN SELECT RAISE(ABORT,'fixture write failure'); END`); err != nil {
		t.Fatal(err)
	}
	err := store.SaveTabs(ctx, "alice", "work", []Tab{{URL: "https://first.test", Selected: true}, {URL: "https://second.test"}})
	if err == nil {
		t.Fatal("expected injected write failure")
	}
	got, err := store.Tabs(ctx, "alice", "work")
	if err != nil || !reflect.DeepEqual(got, original) {
		t.Fatalf("partial replacement committed: %+v %v", got, err)
	}
}

func TestHistorySearchIsLiteralAndClearingPreservesBookmarks(t *testing.T) {
	ctx := context.Background()
	store, _ := openTestStore(t)
	mustProfile(t, store, "alice", "work", Managed)
	for _, entry := range []Entry{{URL: "https://example.test/one", Title: "100%_done"}, {URL: "https://example.test/two", Title: "News"}} {
		if err := store.Visit(ctx, "alice", "work", entry); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.Visit(ctx, "alice", "work", Entry{URL: "https://example.test/two", Title: "Updated news"}); err != nil {
		t.Fatal(err)
	}
	visits, err := store.History(ctx, "alice", "work", "%_", 10)
	if err != nil || len(visits) != 1 || visits[0].Title != "100%_done" {
		t.Fatalf("literal search=%+v err=%v", visits, err)
	}
	visits, err = store.History(ctx, "alice", "work", "NEWS", 10)
	if err != nil || len(visits) != 1 || visits[0].Visits != 2 || visits[0].Title != "Updated news" {
		t.Fatalf("visit updates=%+v err=%v", visits, err)
	}
	if err := store.PutBookmark(ctx, "alice", "work", Entry{URL: "https://example.test/two", Title: "Saved"}); err != nil {
		t.Fatal(err)
	}
	if err := store.ClearHistory(ctx, "alice", "work"); err != nil {
		t.Fatal(err)
	}
	visits, err = store.History(ctx, "alice", "work", "", 10)
	if err != nil || len(visits) != 0 {
		t.Fatalf("clear=%+v err=%v", visits, err)
	}
	bookmarks, err := store.Bookmarks(ctx, "alice", "work")
	if err != nil || len(bookmarks) != 1 {
		t.Fatalf("saved bookmark removed: %+v %v", bookmarks, err)
	}
}

func TestIncompatibleDatabaseIsRejectedWithoutChangingFiles(t *testing.T) {
	for _, mutation := range []string{
		`PRAGMA user_version=99`,
		`UPDATE __redeven_db_meta SET db_kind='unknown'`,
		`ALTER TABLE browser_profiles ADD COLUMN surprise TEXT`,
		`DROP INDEX browser_tabs_selected`,
		`DROP INDEX browser_history_recent; CREATE INDEX browser_history_recent ON browser_history(profile_id)`,
		`PRAGMA writable_schema=ON; UPDATE sqlite_master SET sql=replace(sql, 'zoom REAL', 'zoom TEXT') WHERE name='browser_zoom'; PRAGMA writable_schema=OFF`,
		`PRAGMA writable_schema=ON; UPDATE sqlite_master SET sql=replace(sql, 'CHECK(visits > 0)', 'CHECK(visits >= 0)') WHERE name='browser_history'; PRAGMA writable_schema=OFF`,
		`CREATE VIEW surprise AS SELECT * FROM browser_profiles`,
		`CREATE TRIGGER surprise AFTER INSERT ON browser_tabs BEGIN DELETE FROM browser_bookmarks; END`,
	} {
		t.Run(mutation, func(t *testing.T) {
			store, path := openTestStore(t)
			mustProfile(t, store, "alice", "work", Managed)
			if _, err := store.db.Exec(mutation); err != nil {
				t.Fatal(err)
			}
			if err := store.Close(); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if opened, err := Open(path); err == nil {
				_ = opened.Close()
				t.Fatal("accepted incompatible database")
			}
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, after) {
				t.Fatal("rejected database changed")
			}
			for _, suffix := range []string{"-wal", "-shm"} {
				if _, err := os.Stat(path + suffix); !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("created sidecar %s: %v", suffix, err)
				}
			}
		})
	}
}

func TestZoomPreservesSupportedBoundaryValues(t *testing.T) {
	store, _ := openTestStore(t)
	mustProfile(t, store, "alice", "work", Managed)
	for _, factor := range []float64{0.25, 1, 5} {
		if err := store.SetZoom(t.Context(), "alice", "work", "https://example.test", factor); err != nil {
			t.Fatalf("save supported zoom %v: %v", factor, err)
		}
		got, err := store.Zoom(t.Context(), "alice", "work", "https://example.test")
		if err != nil || got != factor {
			t.Fatalf("zoom=%v err=%v, want %v", got, err, factor)
		}
	}
}

func TestInitializationAndVerificationCommitAtomically(t *testing.T) {
	path := filepath.Join(t.TempDir(), "browser.sqlite")
	spec := schemaSpec()
	spec.Verify = func(*sql.Tx) error { return errors.New("fixture verification failure") }
	if db, err := sqliteutil.Open(path, spec); err == nil {
		_ = db.Close()
		t.Fatal("expected failed initialization")
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var tables, version int
	if err := db.QueryRow(`SELECT count(*) FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'`).Scan(&tables); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if tables != 0 || version != 0 {
		t.Fatalf("partial initialization tables=%d version=%d", tables, version)
	}
}
