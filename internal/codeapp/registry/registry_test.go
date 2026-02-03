package registry

import (
	"context"
	"database/sql"
	"path/filepath"
	"slices"
	"testing"
)

func TestOpen_CreatesV1SchemaForFreshDB(t *testing.T) {
	t.Parallel()

	p := filepath.Join(t.TempDir(), "registry.sqlite")
	r, err := Open(p)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	var v int
	if err := r.db.QueryRow(`PRAGMA user_version;`).Scan(&v); err != nil {
		t.Fatalf("PRAGMA user_version: %v", err)
	}
	if v != 1 {
		t.Fatalf("user_version = %d, want 1", v)
	}

	cols, err := tableColumns(r.db, "code_spaces")
	if err != nil {
		t.Fatalf("tableColumns: %v", err)
	}
	want := []string{
		"code_space_id",
		"workspace_path",
		"name",
		"description",
		"created_at_unix_ms",
		"updated_at_unix_ms",
		"last_opened_at_unix_ms",
	}
	for _, c := range want {
		if !slices.Contains(cols, c) {
			t.Fatalf("missing column %q in %+v", c, cols)
		}
	}
	if slices.Contains(cols, "code_port") {
		t.Fatalf("unexpected code_port column in %+v", cols)
	}
}

func TestOpen_MigratesV0ToV1(t *testing.T) {
	t.Parallel()

	p := filepath.Join(t.TempDir(), "registry.sqlite")

	// Create a v0 database on disk.
	db, err := sql.Open("sqlite", p)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	_, _ = db.Exec(`PRAGMA journal_mode=WAL;`)
	if _, err := db.Exec(`PRAGMA user_version=0;`); err != nil {
		_ = db.Close()
		t.Fatalf("set user_version: %v", err)
	}
	if _, err := db.Exec(`
CREATE TABLE IF NOT EXISTS code_spaces (
  code_space_id TEXT PRIMARY KEY,
  workspace_path TEXT NOT NULL,
  code_port INTEGER NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  last_opened_at_unix_ms INTEGER NOT NULL
);
`); err != nil {
		_ = db.Close()
		t.Fatalf("create v0 table: %v", err)
	}
	const (
		created = 1700000000000
		updated = 1700000001000
		opened  = 1700000002000
	)
	if _, err := db.Exec(`
INSERT INTO code_spaces(code_space_id, workspace_path, code_port, created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms)
VALUES(?, ?, ?, ?, ?, ?)
`, "abc", "/tmp", 23333, created, updated, opened); err != nil {
		_ = db.Close()
		t.Fatalf("insert v0 row: %v", err)
	}
	_ = db.Close()

	r, err := Open(p)
	if err != nil {
		t.Fatalf("Open(migrate): %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	var v int
	if err := r.db.QueryRow(`PRAGMA user_version;`).Scan(&v); err != nil {
		t.Fatalf("PRAGMA user_version: %v", err)
	}
	if v != 1 {
		t.Fatalf("user_version = %d, want 1", v)
	}

	cols, err := tableColumns(r.db, "code_spaces")
	if err != nil {
		t.Fatalf("tableColumns: %v", err)
	}
	if slices.Contains(cols, "code_port") {
		t.Fatalf("code_port should be removed after migration, got %+v", cols)
	}
	if !slices.Contains(cols, "name") || !slices.Contains(cols, "description") {
		t.Fatalf("name/description should exist after migration, got %+v", cols)
	}

	s, err := r.GetSpace(context.Background(), "abc")
	if err != nil {
		t.Fatalf("GetSpace: %v", err)
	}
	if s == nil {
		t.Fatalf("GetSpace returned nil")
	}
	if s.WorkspacePath != "/tmp" {
		t.Fatalf("workspace_path = %q, want %q", s.WorkspacePath, "/tmp")
	}
	if s.Name != "" || s.Description != "" {
		t.Fatalf("name/description = %q/%q, want empty strings", s.Name, s.Description)
	}
	if s.CreatedAtUnixMs != created || s.UpdatedAtUnixMs != updated || s.LastOpenedAtUnixMs != opened {
		t.Fatalf("timestamps = %d/%d/%d, want %d/%d/%d", s.CreatedAtUnixMs, s.UpdatedAtUnixMs, s.LastOpenedAtUnixMs, created, updated, opened)
	}
}

func tableColumns(db *sql.DB, table string) ([]string, error) {
	rows, err := db.Query(`PRAGMA table_info(` + table + `);`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cols []string
	for rows.Next() {
		var (
			cid        int
			name       string
			typ        string
			notnull    int
			dfltValue  any
			primaryKey int
		)
		if err := rows.Scan(&cid, &name, &typ, &notnull, &dfltValue, &primaryKey); err != nil {
			return nil, err
		}
		cols = append(cols, name)
	}
	return cols, rows.Err()
}
