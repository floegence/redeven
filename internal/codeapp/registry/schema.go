package registry

import (
	"database/sql"
	"fmt"

	"github.com/floegence/redeven-agent/internal/persistence/sqliteutil"
)

const (
	registrySchemaKind           = "codeapp_registry"
	registryCurrentSchemaVersion = 1
)

func initSchema(db *sql.DB) error {
	return sqliteutil.EnsureSchema(db, registrySchemaSpec())
}

func registrySchemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           registrySchemaKind,
		CurrentVersion: registryCurrentSchemaVersion,
		LegacyMarkers:  []string{"code_spaces"},
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: migrateRegistryToV1},
		},
		Verify: verifyRegistrySchema,
	}
}

func migrateRegistryToV1(tx *sql.Tx) error {
	exists, err := sqliteutil.TableExistsTx(tx, "code_spaces")
	if err != nil {
		return err
	}
	if !exists {
		_, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS code_spaces (
  code_space_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  workspace_path TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  last_opened_at_unix_ms INTEGER NOT NULL
);
`)
		return err
	}

	hasName, err := sqliteutil.ColumnExistsTx(tx, "code_spaces", "name")
	if err != nil {
		return err
	}
	hasDescription, err := sqliteutil.ColumnExistsTx(tx, "code_spaces", "description")
	if err != nil {
		return err
	}
	hasCodePort, err := sqliteutil.ColumnExistsTx(tx, "code_spaces", "code_port")
	if err != nil {
		return err
	}
	if hasName && hasDescription && !hasCodePort {
		return nil
	}

	if _, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS code_spaces_v1 (
  code_space_id TEXT PRIMARY KEY,
  workspace_path TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  last_opened_at_unix_ms INTEGER NOT NULL
);
`); err != nil {
		return fmt.Errorf("create table code_spaces_v1: %w", err)
	}
	if _, err := tx.Exec(`
INSERT INTO code_spaces_v1(code_space_id, workspace_path, name, description, created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms)
SELECT code_space_id, workspace_path, '', '', created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms
FROM code_spaces
`); err != nil {
		return fmt.Errorf("copy code_spaces: %w", err)
	}
	if _, err := tx.Exec(`DROP TABLE code_spaces;`); err != nil {
		return fmt.Errorf("drop old code_spaces: %w", err)
	}
	if _, err := tx.Exec(`ALTER TABLE code_spaces_v1 RENAME TO code_spaces;`); err != nil {
		return fmt.Errorf("rename code_spaces_v1: %w", err)
	}
	return nil
}

func verifyRegistrySchema(tx *sql.Tx) error {
	exists, err := sqliteutil.TableExistsTx(tx, "code_spaces")
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("missing table %q", "code_spaces")
	}
	for _, columnName := range []string{"code_space_id", "workspace_path", "name", "description", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms"} {
		has, err := sqliteutil.ColumnExistsTx(tx, "code_spaces", columnName)
		if err != nil {
			return err
		}
		if !has {
			return fmt.Errorf("missing column %q on %q", columnName, "code_spaces")
		}
	}
	return nil
}
