package terminal

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
)

func TestTerminalViewsPersistIndependentlyAndRejectStaleWrites(t *testing.T) {
	path := filepath.Join(t.TempDir(), "views.sqlite")
	c, err := openViewCatalog(path)
	if err != nil {
		t.Fatal(err)
	}
	layout := `{"type":"split","id":"split-a","axis":"x","ratio":0.4,"first":{"type":"pane","id":"one"},"second":{"type":"pane","id":"two"}}`
	first, err := c.Put(TerminalView{ID: "view-one", Name: "Services", LayoutJSON: layout}, 0)
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.Put(TerminalView{ID: "view-two", Name: "Logs", LayoutJSON: `{"type":"pane","id":"three"}`}, 0)
	if err != nil {
		t.Fatal(err)
	}
	first.Name = "Renamed"
	if _, err = c.Put(first, 0); !errors.Is(err, errViewConflict) {
		t.Fatalf("stale put: %v", err)
	}
	if err = c.Delete(first.ID, 0); !errors.Is(err, errViewConflict) {
		t.Fatalf("stale delete: %v", err)
	}
	if _, err = c.Put(first, first.Revision); err != nil {
		t.Fatal(err)
	}
	if err = c.Close(); err != nil {
		t.Fatal(err)
	}
	c, err = openViewCatalog(path)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	snapshot := c.Snapshot()
	if len(snapshot.Views) != 2 || snapshot.Views[0].Name != "Renamed" || snapshot.Views[0].LayoutJSON != layout {
		t.Fatalf("reopen: %#v", snapshot)
	}
	if err = c.Delete(snapshot.Views[0].ID, snapshot.Views[0].Revision); err != nil {
		t.Fatal(err)
	}
	if got := c.Snapshot(); len(got.Views) != 1 || got.Views[0].ID != "view-two" {
		t.Fatalf("delete affected another view: %#v", got)
	}
}

func TestTerminalViewsRejectMalformedLayoutsWithoutMutation(t *testing.T) {
	c := newMemoryViewCatalog()
	for _, layout := range []string{`{"type":"split","id":"s","axis":"x","ratio":2,"first":{"type":"pane","id":"one"},"second":{"type":"pane","id":"two"}}`, `{"type":"split","id":"s","axis":"x","ratio":0.5,"first":{"type":"pane","id":"one"},"second":{"type":"pane","id":"one"}}`, `{"type":"pane","id":""}`, "null"} {
		if _, err := c.Put(TerminalView{ID: "bad", Name: "Bad", LayoutJSON: layout}, 0); !errors.Is(err, errInvalidView) {
			t.Fatalf("accepted %s: %v", layout, err)
		}
	}
	if got := c.Snapshot(); len(got.Views) != 0 || got.Revision != 1 {
		t.Fatalf("invalid write mutated catalog: %#v", got)
	}
}

func TestTerminalViewDatabaseRejectsFutureAndDriftUnchanged(t *testing.T) {
	for _, statement := range []string{"PRAGMA user_version=4", "ALTER TABLE terminal_views ADD COLUMN drift TEXT", "CREATE INDEX drift ON terminal_views(name)"} {
		t.Run(statement, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "views.sqlite")
			c, err := openViewCatalog(path)
			if err != nil {
				t.Fatal(err)
			}
			if err = c.Close(); err != nil {
				t.Fatal(err)
			}
			db, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = db.Exec(statement); err != nil {
				t.Fatal(err)
			}
			db.Close()
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if c, err = openViewCatalog(path); err == nil {
				c.Close()
				t.Fatal("accepted incompatible database")
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
func TestTerminalViewRPCPermissionAndNotification(t *testing.T) {
	m := newQuietTestManager(t, t.TempDir())
	defer m.Cleanup()
	router := sessionrpc.NewRouter()
	peer := newTestRPCPeer(router)
	var notified TerminalViewSnapshot
	notifications := 0
	peer.OnNotify(TypeID_TERMINAL_VIEWS_CHANGED, func(_ context.Context, raw json.RawMessage) { json.Unmarshal(raw, &notified); notifications++ })
	detach := m.RegisterWithAccessGate(router, &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}, peer, nil)
	defer detach()
	var snapshot TerminalViewSnapshot
	req := terminalViewPutReq{ID: "view-a", Name: "Services", LayoutJSON: "{\"type\":\"pane\",\"id\":\"session-a\"}"}
	if err := peer.Call(context.Background(), TypeID_TERMINAL_VIEW_PUT, req, &snapshot); err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Views) != 1 || len(notified.Views) != 1 {
		t.Fatalf("missing mutation/notification: %#v %#v", snapshot, notified)
	}
	before := notifications
	changes := terminalViewsUpdateReq{Changes: []terminalViewChange{
		{ID: "view-a", BaseRevision: snapshot.Views[0].Revision, Delete: true},
		{ID: "view-b", Name: "Moved", LayoutJSON: req.LayoutJSON},
	}}
	if err := peer.Call(context.Background(), TypeID_TERMINAL_VIEWS_UPDATE, changes, &snapshot); err != nil {
		t.Fatal(err)
	}
	if notifications != before+1 || len(notified.Views) != 1 || notified.Views[0].ID != "view-b" {
		t.Fatalf("atomic notification: %#v", notified)
	}
	deniedRouter := sessionrpc.NewRouter()
	denied := newTestRPCPeer(deniedRouter)
	detachDenied := m.RegisterWithAccessGate(deniedRouter, &session.Meta{CanRead: true, CanWrite: true}, denied, nil)
	defer detachDenied()
	if err := denied.Call(context.Background(), TypeID_TERMINAL_VIEW_PUT, terminalViewPutReq{ID: "blocked", Name: "Blocked", LayoutJSON: req.LayoutJSON}, &snapshot); err == nil {
		t.Fatal("mutation without execute permission")
	}
	if err := denied.Call(context.Background(), TypeID_TERMINAL_VIEWS_UPDATE, changes, &snapshot); err == nil {
		t.Fatal("batch mutation without execute permission")
	}
	if len(m.viewCatalog.Snapshot().Views) != 1 {
		t.Fatal("denied write mutated state")
	}
}

func TestTerminalViewsRejectConcurrentDatabaseOwner(t *testing.T) {
	path := filepath.Join(t.TempDir(), "views.sqlite")
	first, err := openViewCatalog(path)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	stale, err := openViewCatalog(path)
	if err != nil {
		t.Fatal(err)
	}
	defer stale.Close()
	original := TerminalView{ID: "shared", Name: "Original", LayoutJSON: "{\"type\":\"pane\",\"id\":\"a\"}"}
	if _, err = first.Put(original, 0); err != nil {
		t.Fatal(err)
	}
	original.Name = "Stale writer"
	if _, err = stale.Put(original, 0); !errors.Is(err, errViewConflict) {
		t.Fatalf("stale database write: %v", err)
	}
	reopened, err := openViewCatalog(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if got := reopened.Snapshot(); got.Views[0].Name != "Original" {
		t.Fatalf("lost update: %#v", got)
	}
}

func TestTerminalViewsRejectDuplicateSessionOwnership(t *testing.T) {
	c := newMemoryViewCatalog()
	first := TerminalView{ID: "a", Name: "A", LayoutJSON: "{\"type\":\"pane\",\"id\":\"session\"}"}
	if _, err := c.Put(first, 0); err != nil {
		t.Fatal(err)
	}
	before := c.Snapshot()
	first.ID = "b"
	if _, err := c.Put(first, 0); !errors.Is(err, errViewConflict) {
		t.Fatalf("duplicate ownership accepted: %v", err)
	}
	if got := c.Snapshot(); len(got.Views) != 1 || got.Revision != before.Revision {
		t.Fatalf("rejected write changed catalog: %#v", got)
	}
}

func TestTerminalViewVacanciesPersistWithoutOwningSessions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "views.sqlite")
	c, err := openViewCatalog(path)
	if err != nil {
		t.Fatal(err)
	}
	vacant := TerminalView{ID: "empty", Name: "Empty", LayoutJSON: "{\"type\":\"pane\",\"id\":\"session-a\",\"empty\":true}"}
	if _, err = c.Put(vacant, 0); err != nil {
		t.Fatal(err)
	}
	if _, err = c.Put(TerminalView{ID: "live", Name: "Live", LayoutJSON: "{\"type\":\"pane\",\"id\":\"session-a\"}"}, 0); err != nil {
		t.Fatal(err)
	}
	if err = c.Close(); err != nil {
		t.Fatal(err)
	}
	c, err = openViewCatalog(path)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if len(c.Snapshot().Views) != 2 {
		t.Fatal("vacant view was lost")
	}
}

func TestTerminalSessionClosePreservesViewGeometryAndVacancyAfterReopen(t *testing.T) {
	m := newQuietTestManager(t, t.TempDir())
	t.Cleanup(m.Cleanup)
	path := filepath.Join(t.TempDir(), "views.sqlite")
	if err := m.EnablePersistentViews(path); err != nil {
		t.Fatal(err)
	}
	a, err := m.createSession("A", "")
	if err != nil {
		t.Fatal(err)
	}
	b, err := m.createSession("B", "")
	if err != nil {
		t.Fatal(err)
	}
	root := viewLayoutNode{Type: "split", ID: "split", Axis: "y", Ratio: 0.37,
		First: &viewLayoutNode{Type: "pane", ID: a.ID}, Second: &viewLayoutNode{Type: "pane", ID: b.ID}}
	raw, _ := json.Marshal(root)
	original, err := m.viewCatalog.Put(TerminalView{ID: "view", Name: "Services", LayoutJSON: string(raw)}, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{a.ID, b.ID} {
		if err := m.DeleteSession(id); err != nil {
			t.Fatal(err)
		}
	}
	got := m.viewCatalog.Snapshot()
	if len(got.Views) != 1 || got.Views[0].Name != original.Name || got.Views[0].CreatedAtMs != original.CreatedAtMs {
		t.Fatalf("close removed or changed view identity: %#v", got)
	}
	var layout viewLayoutNode
	if err := json.Unmarshal([]byte(got.Views[0].LayoutJSON), &layout); err != nil {
		t.Fatal(err)
	}
	if layout.ID != root.ID || layout.Axis != root.Axis || layout.Ratio != root.Ratio || !layout.First.Empty || !layout.Second.Empty {
		t.Fatalf("close changed geometry or failed to vacate: %#v", layout)
	}
	if layout.First.ID == a.ID || layout.Second.ID == b.ID || layout.First.ID == layout.Second.ID {
		t.Fatal("vacancy reused a runtime identity")
	}
	unchanged, changed, err := m.viewCatalog.VacateSession(a.ID)
	if err != nil || changed || !reflect.DeepEqual(unchanged, got) {
		t.Fatal("repeated closure was not idempotent", err)
	}
	reopened, err := openViewCatalog(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if !reflect.DeepEqual(got, reopened.Snapshot()) {
		t.Fatal("empty slots did not persist")
	}
}

func TestTerminalViewVacancyRejectsInvalidMetadataUnchanged(t *testing.T) {
	c := newMemoryViewCatalog()
	for _, layout := range []string{
		"{\"type\":\"pane\",\"id\":\"slot\",\"empty\":false}",
		"{\"type\":\"pane\",\"id\":\"slot\",\"empty\":null}",
		"{\"type\":\"pane\",\"id\":\"slot\",\"empty\":\"true\"}",
		"{\"type\":\"split\",\"id\":\"s\",\"axis\":\"x\",\"ratio\":0.5,\"empty\":true,\"first\":{\"type\":\"pane\",\"id\":\"a\"},\"second\":{\"type\":\"pane\",\"id\":\"b\"}}",
	} {
		before := c.Snapshot()
		if _, err := c.Put(TerminalView{ID: "bad", Name: "Bad", LayoutJSON: layout}, 0); !errors.Is(err, errInvalidView) {
			t.Fatalf("accepted invalid occupancy: %s: %v", layout, err)
		}
		if !reflect.DeepEqual(before, c.Snapshot()) {
			t.Fatal("invalid occupancy changed catalog")
		}
	}
}

func TestTerminalViewVacancyMigrationPreservesVersionTwoRecords(t *testing.T) {
	path := filepath.Join(t.TempDir(), "views.sqlite")
	c, err := openViewCatalog(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = c.Put(TerminalView{ID: "existing", Name: "Existing", LayoutJSON: `{"type":"pane","id":"session"}`}, 0); err != nil {
		t.Fatal(err)
	}
	before := c.Snapshot()
	if _, err = c.db.Exec("PRAGMA user_version=2"); err != nil {
		t.Fatal(err)
	}
	if err = c.Close(); err != nil {
		t.Fatal(err)
	}
	c, err = openViewCatalog(path)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if !reflect.DeepEqual(before, c.Snapshot()) {
		t.Fatal("v2 migration rewrote existing views")
	}
	var version int
	if err = c.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 3 {
		t.Fatalf("migration version: %d, %v", version, err)
	}
}
