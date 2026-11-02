package terminal

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

var (
	errInvalidView  = errors.New("invalid terminal view")
	errViewConflict = errors.New("terminal view changed; reload before saving")
	errViewNotFound = errors.New("terminal view not found")
)

type TerminalView struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	LayoutJSON  string `json:"layout_json"`
	Revision    uint64 `json:"revision"`
	CreatedAtMs int64  `json:"created_at_ms"`
	UpdatedAtMs int64  `json:"updated_at_ms"`
}
type TerminalViewSnapshot struct {
	Revision uint64         `json:"revision"`
	Views    []TerminalView `json:"views"`
}

type viewCatalog struct {
	mu       sync.Mutex
	db       *sql.DB
	revision uint64
	views    map[string]TerminalView
}

func newMemoryViewCatalog() *viewCatalog {
	return &viewCatalog{revision: 1, views: make(map[string]TerminalView)}
}

// Validate the serialized published SplitWorkspace contract; placement mechanics remain upstream.
func validateView(view TerminalView) error {
	if strings.TrimSpace(view.ID) != view.ID || view.ID == "" || len(view.ID) > 128 || strings.TrimSpace(view.Name) != view.Name || view.Name == "" || utf8.RuneCountInString(view.Name) > 64 || len(view.LayoutJSON) > 65536 {
		return errInvalidView
	}
	seen := map[string]bool{}
	panes := 0
	var visit func(json.RawMessage, int) error
	visit = func(raw json.RawMessage, depth int) error {
		if depth > 16 {
			return errInvalidView
		}
		var node struct {
			Empty  json.RawMessage `json:"empty"`
			Type   string          `json:"type"`
			ID     string          `json:"id"`
			Axis   string          `json:"axis"`
			Ratio  *float64        `json:"ratio"`
			First  json.RawMessage `json:"first"`
			Second json.RawMessage `json:"second"`
		}
		decoder := json.NewDecoder(strings.NewReader(string(raw)))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&node) != nil || decoder.Decode(new(any)) != io.EOF || node.ID == "" || len(node.ID) > 128 || seen[node.ID] {
			return errInvalidView
		}
		seen[node.ID] = true
		switch node.Type {
		case "pane":
			panes++
			if (len(node.Empty) > 0 && string(node.Empty) != "true") || panes > 32 || node.Axis != "" || node.Ratio != nil || node.First != nil || node.Second != nil {
				return errInvalidView
			}
		case "split":
			if len(node.Empty) > 0 || (node.Axis != "x" && node.Axis != "y") || node.Ratio == nil || *node.Ratio <= 0 || *node.Ratio >= 1 {
				return errInvalidView
			}
			if err := visit(node.First, depth+1); err != nil {
				return err
			}
			return visit(node.Second, depth+1)
		default:
			return errInvalidView
		}
		return nil
	}
	return visit(json.RawMessage(view.LayoutJSON), 0)
}

func viewCatalogSchemaSpec() sqliteutil.Spec {
	initialize := func(tx *sql.Tx) error {
		_, err := tx.Exec(`
 CREATE TABLE terminal_view_catalog (singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1), revision INTEGER NOT NULL CHECK(revision>=1));
 INSERT INTO terminal_view_catalog VALUES(1,1);
 CREATE TABLE terminal_views (id TEXT PRIMARY KEY, name TEXT NOT NULL, layout_json TEXT NOT NULL, revision INTEGER NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL);
 `)
		return err
	}
	verify := func(tx *sql.Tx) error {
		tables, err := sqliteutil.ListUserTablesTx(tx)
		if err != nil {
			return err
		}
		if !slices.Equal(tables, []string{"terminal_view_catalog", "terminal_views"}) {
			return fmt.Errorf("terminal view table set mismatch: %v", tables)
		}
		for table, expected := range map[string][]string{"terminal_view_catalog": {"singleton_id", "revision"}, "terminal_views": {"id", "name", "layout_json", "revision", "created_at_ms", "updated_at_ms"}} {
			cols, err := sqliteutil.TableColumnNamesTx(tx, table)
			if err != nil {
				return err
			}
			if !slices.Equal(cols, expected) {
				return fmt.Errorf("terminal view column mismatch: %s", table)
			}
		}
		indexes, err := sqliteutil.ListUserIndexesTx(tx)
		if err != nil {
			return err
		}
		if len(indexes) != 0 {
			return fmt.Errorf("terminal view index mismatch: %v", indexes)
		}
		var count int
		var revision uint64
		if err := tx.QueryRow("SELECT COUNT(*),COALESCE(MAX(revision),0) FROM terminal_view_catalog WHERE singleton_id=1").Scan(&count, &revision); err != nil {
			return err
		}
		if count != 1 || revision < 1 {
			return errors.New("invalid terminal view revision")
		}
		rows, err := tx.Query("SELECT id,name,layout_json,revision,created_at_ms,updated_at_ms FROM terminal_views")
		if err != nil {
			return err
		}
		defer rows.Close()
		count = 0
		for rows.Next() {
			var v TerminalView
			if err := rows.Scan(&v.ID, &v.Name, &v.LayoutJSON, &v.Revision, &v.CreatedAtMs, &v.UpdatedAtMs); err != nil {
				return err
			}
			count++
			if count > 64 || v.Revision < 1 || v.Revision > revision || v.CreatedAtMs < 1 || v.UpdatedAtMs < v.CreatedAtMs {
				return errInvalidView
			}
			if err := validateView(v); err != nil {
				return err
			}
		}
		return rows.Err()
	}
	return sqliteutil.Spec{Kind: "terminal_view_catalog", CurrentVersion: 3, Pragmas: []string{"PRAGMA journal_mode=WAL;", "PRAGMA busy_timeout=3000;"},
		Initialize: initialize,
		Migrations: []sqliteutil.Migration{{FromVersion: 0, ToVersion: 1, Apply: initialize}, {FromVersion: 1, ToVersion: 2, Apply: func(tx *sql.Tx) error {
			if err := verify(tx); err != nil {
				return err
			}
			return migrateViewOwnership(tx)
		}}, {FromVersion: 2, ToVersion: 3, Apply: verify}},
		Verify: func(tx *sql.Tx) error {
			if err := verify(tx); err != nil {
				return err
			}
			views, err := readViewsTx(tx)
			if err != nil {
				return err
			}
			return validateViewOwnership(views)
		},
	}
}
func openViewCatalog(path string) (*viewCatalog, error) {
	db, err := sqliteutil.Open(path, viewCatalogSchemaSpec())
	if err != nil {
		return nil, err
	}
	c := newMemoryViewCatalog()
	c.db = db
	if err = db.QueryRow("SELECT revision FROM terminal_view_catalog WHERE singleton_id=1").Scan(&c.revision); err != nil {
		db.Close()
		return nil, err
	}
	rows, err := db.Query("SELECT id,name,layout_json,revision,created_at_ms,updated_at_ms FROM terminal_views")
	if err != nil {
		db.Close()
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var v TerminalView
		if err = rows.Scan(&v.ID, &v.Name, &v.LayoutJSON, &v.Revision, &v.CreatedAtMs, &v.UpdatedAtMs); err != nil {
			db.Close()
			return nil, err
		}
		c.views[v.ID] = v
	}
	if err = rows.Err(); err != nil {
		db.Close()
		return nil, err
	}
	return c, nil
}
func (c *viewCatalog) Close() error {
	if c == nil || c.db == nil {
		return nil
	}
	return c.db.Close()
}
func (c *viewCatalog) Snapshot() TerminalViewSnapshot {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.snapshotLocked()
}
func (c *viewCatalog) snapshotLocked() TerminalViewSnapshot {
	views := make([]TerminalView, 0, len(c.views))
	for _, v := range c.views {
		views = append(views, v)
	}
	sort.Slice(views, func(i, j int) bool {
		if views[i].CreatedAtMs != views[j].CreatedAtMs {
			return views[i].CreatedAtMs < views[j].CreatedAtMs
		}
		return views[i].ID < views[j].ID
	})
	return TerminalViewSnapshot{c.revision, views}
}

type terminalViewChange struct {
	ID           string `json:"id"`
	Name         string `json:"name,omitempty"`
	LayoutJSON   string `json:"layout_json,omitempty"`
	BaseRevision uint64 `json:"base_revision"`
	Delete       bool   `json:"delete,omitempty"`
}

// Apply all affected views atomically, including membership transfers. A stale
// source revision or a conflicting owner rejects the entire operation.
func (c *viewCatalog) Update(changes []terminalViewChange) (TerminalViewSnapshot, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.updateLocked(changes)
}
func (c *viewCatalog) updateLocked(changes []terminalViewChange) (TerminalViewSnapshot, error) {
	if len(changes) == 0 || len(changes) > 64 {
		return TerminalViewSnapshot{}, errInvalidView
	}
	next := make(map[string]TerminalView, len(c.views))
	for id, view := range c.views {
		next[id] = view
	}
	seen := map[string]bool{}
	now := time.Now().UnixMilli()
	for _, change := range changes {
		if change.ID == "" || seen[change.ID] {
			return TerminalViewSnapshot{}, errInvalidView
		}
		seen[change.ID] = true
		previous, exists := c.views[change.ID]
		if (exists && previous.Revision != change.BaseRevision) || (!exists && change.BaseRevision != 0) {
			return TerminalViewSnapshot{}, errViewConflict
		}
		if change.Delete {
			if !exists {
				return TerminalViewSnapshot{}, errViewNotFound
			}
			delete(next, change.ID)
			continue
		}
		view := TerminalView{ID: change.ID, Name: change.Name, LayoutJSON: change.LayoutJSON, Revision: c.revision + 1, CreatedAtMs: now, UpdatedAtMs: now}
		if exists {
			view.CreatedAtMs = previous.CreatedAtMs
		}
		if err := validateView(view); err != nil {
			return TerminalViewSnapshot{}, err
		}
		next[view.ID] = view
	}
	if len(next) > 64 {
		return TerminalViewSnapshot{}, errInvalidView
	}
	if err := validateViewOwnership(next); err != nil {
		return TerminalViewSnapshot{}, err
	}
	if c.db != nil {
		tx, err := c.db.Begin()
		if err != nil {
			return TerminalViewSnapshot{}, err
		}
		defer tx.Rollback()
		if err = c.advanceRevisionTx(tx); err != nil {
			return TerminalViewSnapshot{}, err
		}
		for _, change := range changes {
			if change.Delete {
				_, err = tx.Exec("DELETE FROM terminal_views WHERE id=?", change.ID)
			} else {
				err = writeViewTx(tx, next[change.ID])
			}
			if err != nil {
				return TerminalViewSnapshot{}, err
			}
		}
		if err = tx.Commit(); err != nil {
			return TerminalViewSnapshot{}, err
		}
	}
	c.revision++
	c.views = next
	return c.snapshotLocked(), nil
}
func (c *viewCatalog) Put(view TerminalView, base uint64) (TerminalView, error) {
	snapshot, err := c.Update([]terminalViewChange{{ID: view.ID, Name: view.Name, LayoutJSON: view.LayoutJSON, BaseRevision: base}})
	if err != nil {
		return TerminalView{}, err
	}
	for _, v := range snapshot.Views {
		if v.ID == view.ID {
			return v, nil
		}
	}
	return TerminalView{}, errViewNotFound
}
func (c *viewCatalog) Delete(id string, base uint64) error {
	_, err := c.Update([]terminalViewChange{{ID: id, BaseRevision: base, Delete: true}})
	return err
}
func writeViewTx(tx *sql.Tx, view TerminalView) error {
	_, err := tx.Exec("INSERT INTO terminal_views(id,name,layout_json,revision,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,layout_json=excluded.layout_json,revision=excluded.revision,updated_at_ms=excluded.updated_at_ms", view.ID, view.Name, view.LayoutJSON, view.Revision, view.CreatedAtMs, view.UpdatedAtMs)
	return err
}

// Fail closed if another process changed the persisted catalog after startup.
func (c *viewCatalog) advanceRevisionTx(tx *sql.Tx) error {
	result, err := tx.Exec("UPDATE terminal_view_catalog SET revision=? WHERE singleton_id=1 AND revision=?", c.revision+1, c.revision)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return errViewConflict
	}
	return nil
}
