package terminal

import (
	"bytes"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func TestTerminalViewTransferIsAtomicAndPersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "views.sqlite")
	c, err := openViewCatalog(path)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	a, err := c.Put(TerminalView{ID: "a", Name: "A", LayoutJSON: `{"type":"pane","id":"one"}`}, 0)
	if err != nil {
		t.Fatal(err)
	}
	b, err := c.Put(TerminalView{ID: "b", Name: "B", LayoutJSON: `{"type":"pane","id":"two"}`}, 0)
	if err != nil {
		t.Fatal(err)
	}
	changes := []terminalViewChange{
		{ID: a.ID, BaseRevision: a.Revision, Delete: true},
		{ID: b.ID, Name: b.Name, BaseRevision: b.Revision, LayoutJSON: `{"type":"split","id":"s","axis":"x","ratio":0.5,"first":{"type":"pane","id":"one"},"second":{"type":"pane","id":"two"}}`},
	}
	before := c.Snapshot()
	for _, index := range []int{0, 1} {
		stale := append([]terminalViewChange(nil), changes...)
		stale[index].BaseRevision = 0
		if _, err = c.Update(stale); !errors.Is(err, errViewConflict) {
			t.Fatalf("stale %d: %v", index, err)
		}
		if !reflect.DeepEqual(before, c.Snapshot()) {
			t.Fatal("rejected transfer mutated catalog")
		}
	}
	moved, err := c.Update(changes)
	if err != nil {
		t.Fatal(err)
	}
	if len(moved.Views) != 1 || moved.Views[0].ID != "b" || moved.Revision != before.Revision+1 {
		t.Fatalf("transfer: %#v", moved)
	}
	reopened, err := openViewCatalog(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if !reflect.DeepEqual(moved, reopened.Snapshot()) {
		t.Fatal("transfer did not persist atomically")
	}
}

func TestTerminalViewOwnershipMigrationPreservesUniqueSessions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "views.sqlite")
	// The released v1 schema allowed session aliases across views.
	spec := viewCatalogSchemaSpec()
	spec.CurrentVersion = 1
	spec.Migrations = spec.Migrations[:1]
	spec.Verify = func(tx *sql.Tx) error { _, err := readViewsTx(tx); return err }
	db, err := sqliteutil.Open(path, spec)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range []TerminalView{
		{ID: "old", Name: "Old", LayoutJSON: `{"type":"split","id":"s","axis":"x","ratio":0.4,"first":{"type":"pane","id":"shared"},"second":{"type":"pane","id":"unique"}}`, Revision: 2, CreatedAtMs: 1, UpdatedAtMs: 2},
		{ID: "alias", Name: "Alias", LayoutJSON: `{"type":"pane","id":"shared"}`, Revision: 3, CreatedAtMs: 2, UpdatedAtMs: 3},
		{ID: "recent", Name: "Recent", LayoutJSON: `{"type":"pane","id":"shared"}`, Revision: 4, CreatedAtMs: 3, UpdatedAtMs: 4},
	} {
		if err = writeViewTx(tx, v); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = tx.Exec("UPDATE terminal_view_catalog SET revision=4"); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	db.Close()
	c, err := openViewCatalog(path)
	if err != nil {
		t.Fatal(err)
	}
	got := c.Snapshot()
	if got.Revision != 5 || len(got.Views) != 2 || got.Views[0].ID != "old" || got.Views[0].LayoutJSON != `{"type":"pane","id":"unique"}` || got.Views[1].ID != "recent" || got.Views[1].Revision != 4 {
		t.Fatalf("migration: %#v", got)
	}
	c.Close()
	c, err = openViewCatalog(path)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if !reflect.DeepEqual(got, c.Snapshot()) {
		t.Fatal("migration was not idempotent")
	}
}

func TestTerminalViewOwnershipMigrationRejectsInvalidV1Unchanged(t *testing.T) {
	path := filepath.Join(t.TempDir(), "views.sqlite")
	spec := viewCatalogSchemaSpec()
	spec.CurrentVersion = 1
	spec.Migrations = spec.Migrations[:1]
	spec.Verify = func(tx *sql.Tx) error { _, err := readViewsTx(tx); return err }
	db, err := sqliteutil.Open(path, spec)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO terminal_views VALUES(?,?,?,?,?,?)", "broken", "Broken", "null", 1, 1, 1); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if c, err := openViewCatalog(path); err == nil {
		c.Close()
		t.Fatal("accepted invalid v1 layout")
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("rejected migration changed the database")
	}
}
