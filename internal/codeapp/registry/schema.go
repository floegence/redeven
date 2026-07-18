package registry

import (
	"database/sql"
	"fmt"
	"slices"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	registrySchemaKind           = "codeapp_registry"
	registryLegacySchemaKind     = "codeapp_registry_legacy"
	registryCurrentSchemaVersion = 1
)

var (
	registryCurrentColumns = []string{"code_space_id", "workspace_path", "name", "description", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms"}
	registryLegacyColumns  = []string{"code_space_id", "workspace_path", "code_port", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms"}
)

func registrySchemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           registrySchemaKind,
		CurrentVersion: registryCurrentSchemaVersion,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: migrateRegistryToV1},
		},
		LegacyKindMigrations: []sqliteutil.LegacyKindMigration{{
			FromKind:    registryLegacySchemaKind,
			FromVersion: 1,
			ToKind:      registrySchemaKind,
			ToVersion:   registryCurrentSchemaVersion,
			Apply:       migrateLegacyRegistryV1,
		}},
		Verify: verifyRegistrySchema,
	}
}

func migrateRegistryToV1(tx *sql.Tx) error {
	_, err := tx.Exec(`
	CREATE TABLE code_spaces (
	  code_space_id TEXT PRIMARY KEY,
	  workspace_path TEXT NOT NULL,
	  name TEXT NOT NULL DEFAULT '',
	  description TEXT NOT NULL DEFAULT '',
	  created_at_unix_ms INTEGER NOT NULL,
	  updated_at_unix_ms INTEGER NOT NULL,
	  last_opened_at_unix_ms INTEGER NOT NULL
	);
	`)
	return err
}

func migrateLegacyRegistryV1(tx *sql.Tx) error {
	if err := verifyRegistryShape(tx, registryLegacyColumns); err != nil {
		return fmt.Errorf("verify legacy codeapp registry v1: %w", err)
	}
	if _, err := tx.Exec(`
	ALTER TABLE code_spaces RENAME TO code_spaces_legacy_v1;
	CREATE TABLE code_spaces (
	  code_space_id TEXT PRIMARY KEY,
	  workspace_path TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
	  last_opened_at_unix_ms INTEGER NOT NULL
	);
	INSERT INTO code_spaces(code_space_id, workspace_path, name, description, created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms)
	SELECT code_space_id, workspace_path, '', '', created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms
	FROM code_spaces_legacy_v1;
	DROP TABLE code_spaces_legacy_v1;
	`); err != nil {
		return fmt.Errorf("convert legacy codeapp registry v1: %w", err)
	}
	return nil
}

func verifyRegistrySchema(tx *sql.Tx) error {
	return verifyRegistryShape(tx, registryCurrentColumns)
}

func verifyRegistryShape(tx *sql.Tx, expectedColumns []string) error {
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	if !slices.Equal(tables, []string{"code_spaces"}) {
		return fmt.Errorf("codeapp registry table set mismatch: got %v", tables)
	}
	rows, err := tx.Query(`PRAGMA table_info(code_spaces)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	columns := make([]string, 0, len(expectedColumns))
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		columns = append(columns, name)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if !slices.Equal(columns, expectedColumns) {
		return fmt.Errorf("codeapp registry column mismatch: got %v, want %v", columns, expectedColumns)
	}
	indexes, err := sqliteutil.ListUserIndexesTx(tx)
	if err != nil {
		return err
	}
	if len(indexes) != 0 {
		return fmt.Errorf("codeapp registry has unexpected indexes %v", indexes)
	}
	return nil
}
