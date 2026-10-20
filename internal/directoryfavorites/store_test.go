package directoryfavorites

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
)

func TestFavoritesPersistenceIsolationAndIdempotency(t *testing.T) {
	path := filepath.Join(t.TempDir(), "favorites.sqlite")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	scope := Scope{"namespace", "environment", "user"}
	for _, p := range []string{"/a", "/b", "/a/"} {
		if _, err = s.Set(ctx, scope, p, true); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.Snapshot(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	if got.Revision != 2 || !reflect.DeepEqual(got.Paths, []string{"/b", "/a"}) {
		t.Fatalf("unexpected snapshot: %+v", got)
	}
	for _, other := range []Scope{{"other", "environment", "user"}, {"namespace", "other", "user"}, {"namespace", "environment", "other"}} {
		out, e := s.Snapshot(ctx, other)
		if e != nil || len(out.Paths) != 0 {
			t.Fatalf("scope leaked: %+v %v", out, e)
		}
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	reopened, err := s.Snapshot(ctx, scope)
	if err != nil || !reflect.DeepEqual(got, reopened) {
		t.Fatalf("restart changed favorites: %+v %v", reopened, err)
	}
	removed, err := s.Set(ctx, scope, "/missing", false)
	if err != nil || removed.Revision != 2 {
		t.Fatalf("no-op removal changed revision: %+v %v", removed, err)
	}
	removed, err = s.Set(ctx, scope, "/a", false)
	if err != nil || removed.Revision != 3 {
		t.Fatalf("remove: %+v %v", removed, err)
	}
}
func TestConcurrentChangesAndRollback(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "favorites.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	scope := Scope{"n", "e", "u"}
	var wg sync.WaitGroup
	for i := range 30 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, e := s.Set(ctx, scope, fmt.Sprintf("/folder-%d", i), true); e != nil {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	got, err := s.Snapshot(ctx, scope)
	if err != nil || len(got.Paths) != 30 || got.Revision != 30 {
		t.Fatalf("lost concurrent changes: %+v %v", got, err)
	}
	_, err = s.db.Exec(`CREATE TRIGGER fail_insert BEFORE INSERT ON directory_favorites BEGIN SELECT RAISE(ABORT,'injected failure'); END`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Set(ctx, scope, "/fail", true); err == nil {
		t.Fatal("expected failure")
	}
	after, err := s.Snapshot(ctx, scope)
	if err != nil || !reflect.DeepEqual(after, got) {
		t.Fatalf("transaction did not rollback: %+v %v", after, err)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err = s.Set(canceled, scope, "/canceled", true); err == nil {
		t.Fatal("expected cancellation")
	}
}
func TestRejectInvalidAndFutureSchema(t *testing.T) {
	for _, mutation := range []string{`PRAGMA user_version=2`, `INSERT INTO favorite_scopes VALUES(' n','e','u',0)`, `PRAGMA foreign_keys=OFF; INSERT INTO directory_favorites VALUES('n','e','u','/orphan',1)`, `ALTER TABLE directory_favorites ADD COLUMN unsupported TEXT`, `CREATE TRIGGER unexpected AFTER INSERT ON favorite_scopes BEGIN SELECT 1; END`} {
		t.Run(mutation, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "favorites.sqlite")
			s, err := Open(path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = s.db.Exec(mutation); err != nil {
				t.Fatal(err)
			}
			s.Close()
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if reopened, err := Open(path); err == nil {
				reopened.Close()
				t.Fatal("accepted invalid schema")
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("rejected schema was mutated")
			}
		})
	}
	s, err := Open(filepath.Join(t.TempDir(), "favorites.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, p := range []string{"relative", "", "/a\x00b"} {
		if _, err = s.Set(context.Background(), Scope{"n", "e", "u"}, p, true); err == nil {
			t.Fatalf("accepted %q", p)
		}
	}
	if _, err = s.Snapshot(context.Background(), Scope{}); err == nil {
		t.Fatal("accepted empty scope")
	}
}
