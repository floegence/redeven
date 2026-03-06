package registry

import (
	"database/sql"
	"fmt"

	"github.com/floegence/redeven-agent/internal/persistence/sqliteutil"
)

const (
	registrySchemaKind           = "portforward_registry"
	registryCurrentSchemaVersion = 1
)

func initSchema(db *sql.DB) error {
	return sqliteutil.EnsureSchema(db, registrySchemaSpec())
}

func registrySchemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           registrySchemaKind,
		CurrentVersion: registryCurrentSchemaVersion,
		LegacyMarkers:  []string{"port_forwards"},
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: migrateRegistryToV1},
		},
		Verify: verifyRegistrySchema,
	}
}

func migrateRegistryToV1(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS port_forwards (
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
	exists, err := sqliteutil.TableExistsTx(tx, "port_forwards")
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("missing table %q", "port_forwards")
	}
	for _, columnName := range []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms"} {
		has, err := sqliteutil.ColumnExistsTx(tx, "port_forwards", columnName)
		if err != nil {
			return err
		}
		if !has {
			return fmt.Errorf("missing column %q on %q", columnName, "port_forwards")
		}
	}
	return nil
}
