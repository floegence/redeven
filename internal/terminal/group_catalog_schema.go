package terminal

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	terminalGroupCatalogSchemaKind           = "terminal_group_catalog"
	terminalGroupCatalogCurrentSchemaVersion = 1
)

func terminalGroupCatalogSchemaSpec(home string) sqliteutil.Spec {
	initialize := func(tx *sql.Tx) error {
		return migrateTerminalGroupCatalogToV1(tx, strings.TrimSpace(home))
	}
	return sqliteutil.Spec{
		Kind:           terminalGroupCatalogSchemaKind,
		CurrentVersion: terminalGroupCatalogCurrentSchemaVersion,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`},
		Initialize:     initialize,
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: initialize},
		},
		Verify: verifyTerminalGroupCatalogSchema,
	}
}

func migrateTerminalGroupCatalogToV1(tx *sql.Tx, home string) error {
	if _, err := tx.Exec(`
CREATE TABLE terminal_group_catalog (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0)
);
CREATE TABLE terminal_groups (
  group_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  default_working_dir TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX terminal_groups_name_nocase_idx ON terminal_groups(lower(name));
CREATE UNIQUE INDEX terminal_groups_sort_order_idx ON terminal_groups(sort_order);
INSERT INTO terminal_group_catalog(singleton_id, revision) VALUES (1, 1);
`); err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	if _, err := tx.Exec(
		`INSERT INTO terminal_groups(group_id, name, default_working_dir, sort_order, created_at_unix_ms, updated_at_unix_ms) VALUES (?, 'Default', ?, 0, ?, ?)`,
		DefaultTerminalGroupID,
		home,
		now,
		now,
	); err != nil {
		return err
	}
	return nil
}

func verifyTerminalGroupCatalogSchema(tx *sql.Tx) error {
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	if !slices.Equal(tables, []string{"terminal_group_catalog", "terminal_groups"}) {
		return fmt.Errorf("terminal group catalog table set mismatch: got %v", tables)
	}
	expectedColumns := map[string][]string{
		"terminal_group_catalog": {"singleton_id", "revision"},
		"terminal_groups":        {"group_id", "name", "default_working_dir", "sort_order", "created_at_unix_ms", "updated_at_unix_ms"},
	}
	for tableName, expected := range expectedColumns {
		columns, columnErr := sqliteutil.TableColumnNamesTx(tx, tableName)
		if columnErr != nil {
			return columnErr
		}
		if !slices.Equal(columns, expected) {
			return fmt.Errorf("terminal group catalog %s column mismatch: got %v, want %v", tableName, columns, expected)
		}
	}
	indexes, err := sqliteutil.ListUserIndexesTx(tx)
	if err != nil {
		return err
	}
	if !slices.Equal(indexes, []string{"terminal_groups_name_nocase_idx", "terminal_groups_sort_order_idx"}) {
		return fmt.Errorf("terminal group catalog index mismatch: got %v", indexes)
	}
	var catalogRows int
	var revision uint64
	if err := tx.QueryRow(`SELECT COUNT(*), COALESCE(MAX(revision), 0) FROM terminal_group_catalog WHERE singleton_id = 1`).Scan(&catalogRows, &revision); err != nil {
		return err
	}
	if catalogRows != 1 || revision < 1 {
		return fmt.Errorf("terminal group catalog singleton invariant is invalid")
	}
	rows, err := tx.Query(`SELECT group_id, name, default_working_dir, sort_order, created_at_unix_ms, updated_at_unix_ms FROM terminal_groups`)
	if err != nil {
		return err
	}
	defer rows.Close()
	groupCount := 0
	defaultCount := 0
	for rows.Next() {
		var groupID, name, defaultWorkingDir string
		var sortOrder int
		var createdAtMs, updatedAtMs int64
		if err := rows.Scan(&groupID, &name, &defaultWorkingDir, &sortOrder, &createdAtMs, &updatedAtMs); err != nil {
			return err
		}
		groupCount++
		if groupID != strings.TrimSpace(groupID) || groupID == "" ||
			name != strings.TrimSpace(name) || name == "" || utf8.RuneCountInString(name) > 64 ||
			defaultWorkingDir != strings.TrimSpace(defaultWorkingDir) || !filepath.IsAbs(defaultWorkingDir) ||
			sortOrder < 0 || createdAtMs <= 0 || updatedAtMs <= 0 {
			return fmt.Errorf("terminal group %q data invariant is invalid", groupID)
		}
		if groupID == DefaultTerminalGroupID {
			defaultCount++
			if name != "Default" || sortOrder != 0 {
				return fmt.Errorf("default terminal group invariant is invalid")
			}
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if groupCount < 1 || defaultCount != 1 {
		return fmt.Errorf("terminal group catalog requires exactly one Default group")
	}
	return nil
}
