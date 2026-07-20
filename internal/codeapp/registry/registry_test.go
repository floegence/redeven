package registry

import (
	"context"
	"database/sql"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestOpen_CreatesV2SchemaForFreshDB(t *testing.T) {
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
	if v != 2 {
		t.Fatalf("user_version = %d, want 2", v)
	}

	cols, err := tableColumns(r.db, "code_spaces")
	if err != nil {
		t.Fatalf("tableColumns: %v", err)
	}
	if !slices.Equal(cols, registryCurrentColumns) {
		t.Fatalf("columns = %v, want %v", cols, registryCurrentColumns)
	}
}

func TestOpen_MigratesCanonicalV1WithoutChangingData(t *testing.T) {
	t.Parallel()

	p := filepath.Join(t.TempDir(), "registry.sqlite")
	createV1Registry(t, p, registryCurrentColumns, nil, "/tmp/workspace")

	r, err := Open(p)
	if err != nil {
		t.Fatalf("Open(migrate): %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	assertRegistryV2(t, r.db)
	assertSeededSpace(t, r)
}

func TestOpen_MigratesReorderedV1WithoutChangingData(t *testing.T) {
	t.Parallel()

	p := filepath.Join(t.TempDir(), "registry.sqlite")
	createV1Registry(t, p, registryReorderedV1Columns, nil, "/tmp/workspace")

	r, err := Open(p)
	if err != nil {
		t.Fatalf("Open(migrate): %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	assertRegistryV2(t, r.db)
	assertSeededSpace(t, r)
}

func TestOpen_MigratesRenamedCanonicalV1WithoutChangingData(t *testing.T) {
	t.Parallel()

	p := filepath.Join(t.TempDir(), "registry.sqlite")
	createV1Registry(t, p, registryCurrentColumns, nil, "/tmp/workspace")
	db, err := sql.Open("sqlite", p)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	if _, err := db.Exec(`
ALTER TABLE code_spaces RENAME TO code_spaces_v1;
ALTER TABLE code_spaces_v1 RENAME TO code_spaces;
`); err != nil {
		_ = db.Close()
		t.Fatalf("recreate historical rename shape: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close fixture: %v", err)
	}

	r, err := Open(p)
	if err != nil {
		t.Fatalf("Open(migrate): %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	assertRegistryV2(t, r.db)
	assertSeededSpace(t, r)
	var tableSQL string
	if err := r.db.QueryRow(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'code_spaces'`).Scan(&tableSQL); err != nil {
		t.Fatalf("read migrated table SQL: %v", err)
	}
	if strings.Contains(tableSQL, `"code_spaces"`) {
		t.Fatalf("migrated table SQL still contains historical quoted name: %s", tableSQL)
	}
}

func TestOpen_MigratesExplicitLegacyV1(t *testing.T) {
	t.Parallel()

	p := filepath.Join(t.TempDir(), "registry.sqlite")

	// Create an explicitly identified legacy v1 database on disk.
	db, err := sql.Open("sqlite", p)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	_, _ = db.Exec(`PRAGMA journal_mode=WAL;`)
	if _, err := db.Exec(`PRAGMA user_version=1;`); err != nil {
		_ = db.Close()
		t.Fatalf("set user_version: %v", err)
	}
	if _, err := db.Exec(`
	CREATE TABLE code_spaces (
  code_space_id TEXT PRIMARY KEY,
  workspace_path TEXT NOT NULL,
  code_port INTEGER NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  last_opened_at_unix_ms INTEGER NOT NULL
	);
	CREATE TABLE __redeven_db_meta (
	  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
	  db_kind TEXT NOT NULL,
	  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
	  last_migrated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
	  last_migrated_from_version INTEGER NOT NULL DEFAULT 0,
	  last_migrated_to_version INTEGER NOT NULL DEFAULT 0
	);
	INSERT INTO __redeven_db_meta(singleton, db_kind, last_migrated_from_version, last_migrated_to_version)
	VALUES(1, 'codeapp_registry_legacy', 1, 1);
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
	if v != 2 {
		t.Fatalf("user_version = %d, want 2", v)
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

func TestOpen_RejectsUnknownV1ShapeWithoutChangingData(t *testing.T) {
	t.Parallel()

	p := filepath.Join(t.TempDir(), "registry.sqlite")
	unknownColumns := []string{"code_space_id", "workspace_path", "name", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms"}
	createV1Registry(t, p, unknownColumns, nil, "/tmp/workspace")

	if _, err := Open(p); err == nil {
		t.Fatal("Open succeeded, want unsupported v1 shape error")
	} else if !strings.Contains(err.Error(), "unsupported codeapp registry v1 table definition") {
		t.Fatalf("Open error = %v, want unsupported v1 shape", err)
	}

	db, err := sql.Open("sqlite", p)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	assertRegistryV1Unchanged(t, db, unknownColumns)
}

func TestOpen_RejectsCanonicalV1WithInvalidDefinitionWithoutChangingData(t *testing.T) {
	t.Parallel()

	p := filepath.Join(t.TempDir(), "registry.sqlite")
	createV1Registry(t, p, registryCurrentColumns, map[string]string{"workspace_path": "workspace_path TEXT"}, nil)

	if _, err := Open(p); err == nil {
		t.Fatal("Open succeeded, want invalid v1 definition error")
	} else if !strings.Contains(err.Error(), "unsupported codeapp registry v1 table definition") {
		t.Fatalf("Open error = %v, want unsupported v1 schema", err)
	}

	db, err := sql.Open("sqlite", p)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	assertRegistryV1Unchanged(t, db, registryCurrentColumns)

	var workspacePath any
	if err := db.QueryRow(`SELECT workspace_path FROM code_spaces WHERE code_space_id = 'space-1'`).Scan(&workspacePath); err != nil {
		t.Fatalf("read original row: %v", err)
	}
	if workspacePath != nil {
		t.Fatalf("workspace_path = %#v, want nil", workspacePath)
	}
}

func TestOpen_RejectsUnknownV1ConstraintsWithoutChangingData(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name                string
		workspaceDefinition string
	}{
		{name: "check", workspaceDefinition: "workspace_path TEXT NOT NULL CHECK(length(workspace_path) > 0)"},
		{name: "unique", workspaceDefinition: "workspace_path TEXT NOT NULL UNIQUE"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			p := filepath.Join(t.TempDir(), "registry.sqlite")
			createV1Registry(t, p, registryCurrentColumns, map[string]string{"workspace_path": test.workspaceDefinition}, "/tmp/workspace")

			if _, err := Open(p); err == nil {
				t.Fatal("Open succeeded, want unsupported v1 schema error")
			} else if !strings.Contains(err.Error(), "codeapp registry") {
				t.Fatalf("Open error = %v, want codeapp registry schema error", err)
			}

			db, err := sql.Open("sqlite", p)
			if err != nil {
				t.Fatalf("sql.Open: %v", err)
			}
			t.Cleanup(func() { _ = db.Close() })
			assertRegistryV1Unchanged(t, db, registryCurrentColumns)
		})
	}
}

func TestOpen_RejectsV1SQLTokenCollisionWithoutChangingData(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name      string
		overrides map[string]string
	}{
		{name: "type_token_boundary", overrides: map[string]string{"workspace_path": "workspace_path T EXT NOT NULL"}},
		{name: "quoted_literal_space", overrides: map[string]string{"name": "name TEXT NOT NULL DEFAULT ' '"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			p := filepath.Join(t.TempDir(), "registry.sqlite")
			createV1Registry(t, p, registryCurrentColumns, test.overrides, "/tmp/workspace")

			if _, err := Open(p); err == nil {
				t.Fatal("Open succeeded, want SQL token mismatch")
			} else if !strings.Contains(err.Error(), "unsupported codeapp registry v1 table definition") {
				t.Fatalf("Open error = %v, want unsupported table definition", err)
			}

			db, err := sql.Open("sqlite", p)
			if err != nil {
				t.Fatalf("sql.Open: %v", err)
			}
			t.Cleanup(func() { _ = db.Close() })
			assertRegistryV1Unchanged(t, db, registryCurrentColumns)
		})
	}
}

func TestOpen_RejectsUnknownV1SchemaObjectsWithoutChangingData(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name       string
		objectName string
		objectSQL  string
	}{
		{name: "index", objectName: "code_spaces_name_idx", objectSQL: `CREATE INDEX code_spaces_name_idx ON code_spaces(name);`},
		{name: "trigger", objectName: "code_spaces_touch", objectSQL: `CREATE TRIGGER code_spaces_touch AFTER UPDATE ON code_spaces BEGIN SELECT 1; END;`},
		{name: "meta_named_trigger", objectName: "__redeven_db_meta", objectSQL: `CREATE TRIGGER __redeven_db_meta AFTER UPDATE ON code_spaces BEGIN SELECT 1; END;`},
		{name: "view", objectName: "code_space_names", objectSQL: `CREATE VIEW code_space_names AS SELECT name FROM code_spaces;`},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			p := filepath.Join(t.TempDir(), "registry.sqlite")
			createV1Registry(t, p, registryCurrentColumns, nil, "/tmp/workspace")
			db, err := sql.Open("sqlite", p)
			if err != nil {
				t.Fatalf("sql.Open: %v", err)
			}
			if _, err := db.Exec(test.objectSQL); err != nil {
				_ = db.Close()
				t.Fatalf("create unknown schema object: %v", err)
			}
			if err := db.Close(); err != nil {
				t.Fatalf("close fixture: %v", err)
			}

			if _, err := Open(p); err == nil {
				t.Fatal("Open succeeded, want schema object error")
			} else if !strings.Contains(err.Error(), "codeapp registry schema object mismatch") {
				t.Fatalf("Open error = %v, want schema object mismatch", err)
			}

			db, err = sql.Open("sqlite", p)
			if err != nil {
				t.Fatalf("reopen fixture: %v", err)
			}
			t.Cleanup(func() { _ = db.Close() })
			assertRegistryV1Unchanged(t, db, registryCurrentColumns)
			var objects int
			if err := db.QueryRow(`SELECT COUNT(1) FROM sqlite_master WHERE name = ? AND type <> 'table'`, test.objectName).Scan(&objects); err != nil {
				t.Fatalf("count original schema object: %v", err)
			}
			if objects != 1 {
				t.Fatalf("original schema object count = %d, want 1", objects)
			}
		})
	}
}

func TestMigrateRegistryToV2_RollbackLeavesV1Unchanged(t *testing.T) {
	t.Parallel()

	p := filepath.Join(t.TempDir(), "registry.sqlite")
	createV1Registry(t, p, registryReorderedV1Columns, nil, "/tmp/workspace")
	db, err := sql.Open("sqlite", p)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := migrateRegistryToV2(tx); err != nil {
		_ = tx.Rollback()
		t.Fatalf("migrateRegistryToV2: %v", err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatalf("Rollback: %v", err)
	}
	assertRegistryV1Unchanged(t, db, registryReorderedV1Columns)
}

func createV1Registry(t *testing.T, path string, columns []string, definitionOverrides map[string]string, workspacePath any) {
	t.Helper()

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer func() { _ = db.Close() }()
	if _, err := db.Exec(`PRAGMA user_version=1;`); err != nil {
		t.Fatalf("set user_version: %v", err)
	}

	definitions := map[string]string{
		"code_space_id":          "code_space_id TEXT PRIMARY KEY",
		"workspace_path":         "workspace_path TEXT NOT NULL",
		"name":                   "name TEXT NOT NULL DEFAULT ''",
		"description":            "description TEXT NOT NULL DEFAULT ''",
		"created_at_unix_ms":     "created_at_unix_ms INTEGER NOT NULL",
		"updated_at_unix_ms":     "updated_at_unix_ms INTEGER NOT NULL",
		"last_opened_at_unix_ms": "last_opened_at_unix_ms INTEGER NOT NULL",
	}
	for column, definition := range definitionOverrides {
		definitions[column] = definition
	}
	columnDefinitions := make([]string, 0, len(columns))
	for _, column := range columns {
		definition, ok := definitions[column]
		if !ok {
			t.Fatalf("missing test column definition for %q", column)
		}
		columnDefinitions = append(columnDefinitions, definition)
	}
	if _, err := db.Exec(`CREATE TABLE code_spaces (` + strings.Join(columnDefinitions, ", ") + `);`); err != nil {
		t.Fatalf("create code_spaces: %v", err)
	}
	if _, err := db.Exec(`
	CREATE TABLE __redeven_db_meta (
	  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
	  db_kind TEXT NOT NULL,
	  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
	  last_migrated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
	  last_migrated_from_version INTEGER NOT NULL DEFAULT 0,
	  last_migrated_to_version INTEGER NOT NULL DEFAULT 0
	);
	INSERT INTO __redeven_db_meta(singleton, db_kind, last_migrated_from_version, last_migrated_to_version)
	VALUES(1, 'codeapp_registry', 1, 1);
	`); err != nil {
		t.Fatalf("create metadata: %v", err)
	}

	values := map[string]any{
		"code_space_id":          "space-1",
		"workspace_path":         workspacePath,
		"name":                   "Workspace name",
		"description":            "Workspace description",
		"created_at_unix_ms":     int64(1700000000000),
		"updated_at_unix_ms":     int64(1700000001000),
		"last_opened_at_unix_ms": int64(1700000002000),
	}
	args := make([]any, 0, len(columns))
	for _, column := range columns {
		args = append(args, values[column])
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(columns)), ",")
	if _, err := db.Exec(`INSERT INTO code_spaces(`+strings.Join(columns, ",")+`) VALUES(`+placeholders+`)`, args...); err != nil {
		t.Fatalf("seed code_spaces: %v", err)
	}
}

func assertRegistryV2(t *testing.T, db *sql.DB) {
	t.Helper()

	var version int
	if err := db.QueryRow(`PRAGMA user_version;`).Scan(&version); err != nil {
		t.Fatalf("PRAGMA user_version: %v", err)
	}
	if version != 2 {
		t.Fatalf("user_version = %d, want 2", version)
	}
	columns, err := tableColumns(db, "code_spaces")
	if err != nil {
		t.Fatalf("tableColumns: %v", err)
	}
	if !slices.Equal(columns, registryCurrentColumns) {
		t.Fatalf("columns = %v, want %v", columns, registryCurrentColumns)
	}
}

func assertSeededSpace(t *testing.T, registry *Registry) {
	t.Helper()

	space, err := registry.GetSpace(context.Background(), "space-1")
	if err != nil {
		t.Fatalf("GetSpace: %v", err)
	}
	if space == nil {
		t.Fatal("GetSpace returned nil")
	}
	if space.WorkspacePath != "/tmp/workspace" || space.Name != "Workspace name" || space.Description != "Workspace description" {
		t.Fatalf("space text fields = %#v", space)
	}
	if space.CreatedAtUnixMs != 1700000000000 || space.UpdatedAtUnixMs != 1700000001000 || space.LastOpenedAtUnixMs != 1700000002000 {
		t.Fatalf("space timestamps = %#v", space)
	}
}

func assertRegistryV1Unchanged(t *testing.T, db *sql.DB, wantColumns []string) {
	t.Helper()

	var version int
	if err := db.QueryRow(`PRAGMA user_version;`).Scan(&version); err != nil {
		t.Fatalf("PRAGMA user_version: %v", err)
	}
	if version != 1 {
		t.Fatalf("user_version = %d, want 1", version)
	}
	columns, err := tableColumns(db, "code_spaces")
	if err != nil {
		t.Fatalf("tableColumns: %v", err)
	}
	if !slices.Equal(columns, wantColumns) {
		t.Fatalf("columns = %v, want %v", columns, wantColumns)
	}
	var rows int
	if err := db.QueryRow(`SELECT COUNT(1) FROM code_spaces WHERE code_space_id = 'space-1'`).Scan(&rows); err != nil {
		t.Fatalf("count code_spaces: %v", err)
	}
	if rows != 1 {
		t.Fatalf("seed row count = %d, want 1", rows)
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
