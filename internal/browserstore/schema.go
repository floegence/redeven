package browserstore

import (
	"database/sql"
	"fmt"
	"slices"
	"strings"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	schemaKind           = "browser_product_v1"
	currentSchemaVersion = 2
)

func schemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:             schemaKind,
		CurrentVersion:   currentSchemaVersion,
		MinimumVersion:   1,
		Pragmas:          []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA foreign_keys=ON;`},
		ValidateExisting: validateExisting,
		Initialize:       createSchema,
		Migrations: []sqliteutil.Migration{{FromVersion: 1, ToVersion: 2, Apply: func(tx *sql.Tx) error {
			if err := verifySchemaVersion(tx, 1); err != nil {
				return err
			}
			if err := createPreferences(tx); err != nil {
				return err
			}
			return verifySchemaVersion(tx, 2)
		}}},
		Verify: verifySchema,
	}
}

func validateExisting(tx *sql.Tx) error {
	var kind string
	if err := tx.QueryRow(`SELECT db_kind FROM __redeven_db_meta WHERE singleton=1`).Scan(&kind); err != nil || kind != schemaKind {
		return &sqliteutil.WrongDatabaseKindError{ExpectedKind: schemaKind, ActualKind: kind}
	}
	var version int
	if err := tx.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return err
	}
	if version > currentSchemaVersion {
		return &sqliteutil.DatabaseTooNewError{Kind: kind, Version: version, CurrentVersion: currentSchemaVersion}
	}
	if version < 1 {
		return &sqliteutil.DatabaseTooOldError{Kind: kind, Version: version, MinimumVersion: 1}
	}
	if err := verifySchemaVersion(tx, version); err != nil {
		return &sqliteutil.SchemaVerifyError{Kind: kind, Err: err}
	}
	return nil
}

func createSchema(tx *sql.Tx) error {
	if err := createSchemaV1(tx); err != nil {
		return err
	}
	return createPreferences(tx)
}

func createPreferences(tx *sql.Tx) error {
	_, err := tx.Exec(`CREATE TABLE browser_preferences (
 owner_id TEXT PRIMARY KEY NOT NULL,
 profile_id TEXT NOT NULL,
 installation_id TEXT NOT NULL,
 FOREIGN KEY(owner_id, profile_id) REFERENCES browser_profiles(owner_id, profile_id) ON DELETE CASCADE
 );`)
	return err
}

// Version one remains the reviewed historical migration input.
func createSchemaV1(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE browser_profiles (
  owner_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('managed','cdp','extension')),
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY(owner_id, profile_id)
);
CREATE TABLE browser_tabs (
  owner_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position >= 0),
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  pinned INTEGER NOT NULL CHECK(pinned IN (0,1)),
  selected INTEGER NOT NULL CHECK(selected IN (0,1)),
  PRIMARY KEY(owner_id, profile_id, position),
  FOREIGN KEY(owner_id, profile_id) REFERENCES browser_profiles(owner_id, profile_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX browser_tabs_selected
  ON browser_tabs(owner_id, profile_id)
  WHERE selected = 1;
CREATE TABLE browser_bookmarks (
  owner_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY(owner_id, profile_id, url),
  FOREIGN KEY(owner_id, profile_id) REFERENCES browser_profiles(owner_id, profile_id) ON DELETE CASCADE
);
CREATE TABLE browser_history (
  owner_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  visits INTEGER NOT NULL CHECK(visits > 0),
  last_visited_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY(owner_id, profile_id, url),
  FOREIGN KEY(owner_id, profile_id) REFERENCES browser_profiles(owner_id, profile_id) ON DELETE CASCADE
);
CREATE INDEX browser_history_recent
  ON browser_history(owner_id, profile_id, last_visited_at_unix_ms DESC, url ASC);
CREATE TABLE browser_zoom (
  owner_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  zoom REAL NOT NULL CHECK(zoom >= 0.25 AND zoom <= 5),
  PRIMARY KEY(owner_id, profile_id, origin),
  FOREIGN KEY(owner_id, profile_id) REFERENCES browser_profiles(owner_id, profile_id) ON DELETE CASCADE
);
`)
	return err
}

// Verify the complete reviewed DDL, not just object and column names. A changed
// constraint, column type or index definition is an incompatible store.
func verifySchema(tx *sql.Tx) error { return verifySchemaVersion(tx, currentSchemaVersion) }

func verifySchemaVersion(tx *sql.Tx, version int) error {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		return err
	}
	defer db.Close()
	expected, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = expected.Rollback() }()
	if err := createSchemaV1(expected); err != nil {
		return err
	}
	if version >= 2 {
		if err := createPreferences(expected); err != nil {
			return err
		}
	}
	read := func(source *sql.Tx) ([]string, error) {
		rows, err := source.Query(`SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name <> '__redeven_db_meta' ORDER BY type, name`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var result []string
		for rows.Next() {
			var kind, name, ddl string
			if err := rows.Scan(&kind, &name, &ddl); err != nil {
				return nil, err
			}
			result = append(result, kind+":"+name+":"+strings.Join(strings.Fields(ddl), " "))
		}
		return result, rows.Err()
	}
	want, err := read(expected)
	if err != nil {
		return err
	}
	got, err := read(tx)
	if err != nil {
		return err
	}
	if !slices.Equal(got, want) {
		return fmt.Errorf("browser schema version %d has incompatible definitions", currentSchemaVersion)
	}
	return nil
}
