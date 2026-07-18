package registry

import (
	"database/sql"
	"fmt"
	"slices"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	registrySchemaKind           = "portforward_registry"
	registryCurrentSchemaVersion = 1
)

func registrySchemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           registrySchemaKind,
		CurrentVersion: registryCurrentSchemaVersion,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: migrateRegistryToV1},
		},
		Verify: verifyRegistrySchema,
	}
}

func migrateRegistryToV1(tx *sql.Tx) error {
	_, err := tx.Exec(`
	CREATE TABLE port_forwards (
  forward_id TEXT PRIMARY KEY,
  target_url TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  health_path TEXT NOT NULL DEFAULT '',
  insecure_skip_verify INTEGER NOT NULL DEFAULT 0,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  last_opened_at_unix_ms INTEGER NOT NULL
);
`)
	return err
}

func verifyRegistrySchema(tx *sql.Tx) error {
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	if !slices.Equal(tables, []string{"port_forwards"}) {
		return fmt.Errorf("port forward registry table set mismatch: got %v", tables)
	}
	expectedColumns := []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms"}
	columns, err := sqliteutil.TableColumnNamesTx(tx, "port_forwards")
	if err != nil {
		return err
	}
	if !slices.Equal(columns, expectedColumns) {
		return fmt.Errorf("port forward registry column mismatch: got %v, want %v", columns, expectedColumns)
	}
	indexes, err := sqliteutil.ListUserIndexesTx(tx)
	if err != nil {
		return err
	}
	if len(indexes) != 0 {
		return fmt.Errorf("port forward registry has unexpected indexes %v", indexes)
	}
	return nil
}
