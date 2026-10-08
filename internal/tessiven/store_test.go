package tessiven

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestVersionLifecycleAndConcurrency(t *testing.T) {
	path := filepath.Join(t.TempDir(), "canvases.sqlite")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	req := SaveRequest{RequestID: "create-1", DocumentYAML: exampleDocument, Summary: "Create canvas"}
	first, err := s.Save(ctx, req, "manual")
	if err != nil {
		t.Fatal(err)
	}
	retry, err := s.Save(ctx, req, "manual")
	if err != nil || retry.Version.Number != 1 || retry.Canvas.ID != first.Canvas.ID {
		t.Fatalf("retry: %+v %v", retry, err)
	}
	req.Summary = "different"
	if _, err = s.Save(ctx, req, "manual"); !errors.Is(err, ErrRequestConflict) {
		t.Fatalf("request mismatch: %v", err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, id := range []string{"writer-a", "writer-b"} {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			_, err := s.Save(ctx, SaveRequest{RequestID: id, CanvasID: first.Canvas.ID, ExpectedVersion: 1, DocumentYAML: exampleDocument}, "manual")
			results <- err
		}(id)
	}
	wg.Wait()
	close(results)
	success, conflict := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, ErrConflict) {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("lost update: %d %d", success, conflict)
	}
	if _, err = s.Save(ctx, SaveRequest{RequestID: "invalid", CanvasID: first.Canvas.ID, ExpectedVersion: 2, DocumentYAML: strings.Replace(exampleDocument, "to: assets", "to: missing", 1)}, "flower"); err == nil {
		t.Fatal("invalid save accepted")
	}
	restored, err := s.Restore(ctx, first.Canvas.ID, RevisionRequest{RequestID: "restore-1", ExpectedVersion: 2, Version: 1})
	if err != nil || restored.Version.Number != 3 {
		t.Fatalf("restore: %v", err)
	}
	restoredRetry, err := s.Restore(ctx, first.Canvas.ID, RevisionRequest{RequestID: "restore-1", ExpectedVersion: 2, Version: 1})
	if err != nil || restoredRetry.Version.Number != 3 {
		t.Fatalf("restore retry: %v", err)
	}
	copy, err := s.Duplicate(ctx, first.Canvas.ID, RevisionRequest{RequestID: "copy-1", Version: 1, Title: "Different business"})
	if err != nil || copy.Canvas.ID == first.Canvas.ID || copy.Version.Number != 1 {
		t.Fatalf("copy: %v", err)
	}
	if _, err = s.db.Exec(`UPDATE versions SET summary='overwrite'`); err == nil {
		t.Fatal("history can be overwritten")
	}
	if _, err = s.db.Exec(`DELETE FROM versions`); err == nil {
		t.Fatal("history can be removed")
	}
	if err = s.Archive(ctx, first.Canvas.ID, 3, true); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Save(ctx, SaveRequest{RequestID: "archived", CanvasID: first.Canvas.ID, ExpectedVersion: 3, DocumentYAML: exampleDocument}, "manual"); !errors.Is(err, ErrArchived) {
		t.Fatalf("archive: %v", err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	versions, err := s.Versions(ctx, first.Canvas.ID, 0)
	if err != nil || len(versions) != 3 {
		t.Fatalf("restart history: %v %d", err, len(versions))
	}
	historical, err := s.Version(ctx, first.Canvas.ID, 1)
	if err != nil || historical.DocumentYAML != exampleDocument {
		t.Fatalf("history changed: %v", err)
	}
	list, err := s.List(ctx, "Different", "", false)
	if err != nil || len(list.Canvases) != 1 {
		t.Fatalf("library: %+v %v", list, err)
	}
}

func TestFlowerSaveInvalidatesEveryCanvasClientAndSurvivesNoClients(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	created, err := s.Create(t.Context(), "multi-client-create", "Shared canvas")
	if err != nil {
		t.Fatal(err)
	}
	first, unsubscribeFirst := s.Subscribe()
	second, unsubscribeSecond := s.Subscribe()
	defer unsubscribeFirst()
	defer unsubscribeSecond()
	// A subscription starts with one invalidation so a newly opened client
	// reads the current snapshot, even when Flower saved while no client was
	// connected.
	drainInvalidation := func(name string, changes <-chan struct{}) {
		t.Helper()
		select {
		case <-changes:
		case <-time.After(time.Second):
			t.Fatalf("%s did not receive the initial canvas invalidation", name)
		}
	}
	drainInvalidation("first", first)
	drainInvalidation("second", second)

	_, err = s.Save(t.Context(), SaveRequest{
		RequestID:       "flower-update-1",
		CanvasID:        created.Canvas.ID,
		ExpectedVersion: created.Version.Number,
		DocumentYAML:    exampleDocument,
		Summary:         "Flower mapped the shared canvas",
	}, "flower")
	if err != nil {
		t.Fatal(err)
	}
	drainInvalidation("first", first)
	drainInvalidation("second", second)

	// Closing every client must not stop Flower's persisted work. A client
	// that opens after the save receives the current snapshot immediately.
	unsubscribeFirst()
	unsubscribeSecond()
	latest, err := s.Save(t.Context(), SaveRequest{
		RequestID:       "flower-update-2",
		CanvasID:        created.Canvas.ID,
		ExpectedVersion: created.Version.Number + 1,
		DocumentYAML:    exampleDocument,
		Summary:         "Flower completed the mapping",
	}, "flower")
	if err != nil {
		t.Fatal(err)
	}
	third, unsubscribeThird := s.Subscribe()
	defer unsubscribeThird()
	drainInvalidation("reopened client", third)
	view, err := s.Version(t.Context(), created.Canvas.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if view.Number != latest.Version.Number || view.Number != created.Version.Number+2 {
		t.Fatalf("reopened client did not converge to Flower's latest save: got %d, want %d", view.Number, latest.Version.Number)
	}
}

func TestIncompatibleDatabaseRemainsUnchanged(t *testing.T) {
	for _, tc := range []struct{ name, sql string }{
		{"future", `PRAGMA user_version=3`},
		{"wrong kind", `UPDATE __redeven_db_meta SET db_kind='other'`},
		{"drift", `ALTER TABLE canvases ADD COLUMN unexpected TEXT`},
		{"metadata drift", `ALTER TABLE __redeven_db_meta ADD COLUMN unexpected TEXT`},
		{"constraint drift", `DROP TRIGGER versions_immutable_update`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "canvases.sqlite")
			s, err := Open(path)
			if err != nil {
				t.Fatal(err)
			}
			_, err = s.Save(context.Background(), SaveRequest{RequestID: "seed", DocumentYAML: exampleDocument}, "manual")
			if err != nil {
				t.Fatal(err)
			}
			s.Close()
			db, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = db.Exec(tc.sql); err != nil {
				t.Fatal(err)
			}
			db.Close()
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if opened, err := Open(path); err == nil {
				opened.Close()
				t.Fatal("incompatible database accepted")
			}
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(before, after) {
				t.Fatal("rejected database was modified")
			}
		})
	}
}
