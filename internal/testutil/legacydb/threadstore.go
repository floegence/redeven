package legacydb

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

func SeedUnsupportedThreadstore(dbPath string, kind string, version int) error {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o700); err != nil {
		return err
	}
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return err
	}
	defer func() { _ = raw.Close() }()
	_, err = raw.Exec(fmt.Sprintf(`
CREATE TABLE legacy_thread_data (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL
);
INSERT INTO legacy_thread_data(id, payload) VALUES('sentinel', 'preserve me');
CREATE TABLE __redeven_db_meta (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  db_kind TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_migrated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_migrated_from_version INTEGER NOT NULL DEFAULT 0,
  last_migrated_to_version INTEGER NOT NULL DEFAULT 0
);
INSERT INTO __redeven_db_meta(singleton, db_kind, last_migrated_from_version, last_migrated_to_version)
VALUES(1, %q, %d, %d);
PRAGMA user_version=%d;
`, kind, version, version, version))
	return err
}

func AddForbiddenAgentShadowTable(dbPath string) error {
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return err
	}
	defer func() { _ = raw.Close() }()

	_, err = raw.Exec(`
CREATE TABLE conversation_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL
);
`)
	return err
}
