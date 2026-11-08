package tessiven

import (
	"database/sql"
	"fmt"
	"strings"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const schemaKind = "tessiven_canvas_library"
const schemaVersion = 3

const canvasSchemaV1 = `CREATE TABLE canvases (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, latest_version INTEGER NOT NULL CHECK(latest_version > 0), archived INTEGER NOT NULL CHECK(archived IN (0,1)), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`

const flowerThreadsSchema = `CREATE TABLE flower_threads (thread_id TEXT PRIMARY KEY, canvas_id TEXT NOT NULL REFERENCES canvases(id), created_at INTEGER NOT NULL)`

var schemaStatements = []string{
	`CREATE TABLE canvases (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, latest_version INTEGER NOT NULL CHECK(latest_version > 0), archived INTEGER NOT NULL CHECK(archived IN (0,1)), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, flower_thread_id TEXT NOT NULL DEFAULT '')`,
	`CREATE TABLE versions (canvas_id TEXT NOT NULL REFERENCES canvases(id), number INTEGER NOT NULL CHECK(number > 0), document_yaml TEXT NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL, source TEXT NOT NULL, summary TEXT NOT NULL, PRIMARY KEY(canvas_id,number))`,
	`CREATE TABLE requests (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result_json TEXT NOT NULL)`,
	`CREATE TRIGGER versions_immutable_update BEFORE UPDATE ON versions BEGIN SELECT RAISE(ABORT, 'Tessiven versions are immutable'); END`,
	`CREATE TRIGGER versions_immutable_delete BEFORE DELETE ON versions BEGIN SELECT RAISE(ABORT, 'Tessiven versions are immutable'); END`,
	flowerThreadsSchema,
}

func schemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{Kind: schemaKind, CurrentVersion: schemaVersion, MinimumVersion: 1, Pragmas: []string{"PRAGMA journal_mode=WAL", "PRAGMA foreign_keys=ON", "PRAGMA busy_timeout=3000"}, ValidateExisting: validateExistingSchema, Initialize: initializeSchema, Migrations: []sqliteutil.Migration{{FromVersion: 1, ToVersion: 2, Apply: migrateToV2}, {FromVersion: 2, ToVersion: 3, Apply: migrateToV3}}, Verify: verifySchema}
}
func migrateToV2(tx *sql.Tx) error {
	if err := verifySchemaVersion(tx, 1); err != nil {
		return err
	}
	if _, err := tx.Exec(`ALTER TABLE canvases ADD COLUMN flower_thread_id TEXT NOT NULL DEFAULT ''`); err != nil {
		return err
	}
	return verifySchemaVersion(tx, 2)
}
func migrateToV3(tx *sql.Tx) error {
	if err := verifySchemaVersion(tx, 2); err != nil {
		return err
	}
	if _, err := tx.Exec(flowerThreadsSchema); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO flower_threads(thread_id,canvas_id,created_at) SELECT flower_thread_id,id,created_at FROM canvases WHERE flower_thread_id<>''`); err != nil {
		return err
	}
	return verifySchemaVersion(tx, 3)
}
func initializeSchema(tx *sql.Tx) error {
	for _, statement := range schemaStatements {
		if _, err := tx.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}
func validateExistingSchema(tx *sql.Tx) error {
	var kind string
	var version int
	if err := tx.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return err
	}
	if err := tx.QueryRow(`SELECT db_kind FROM __redeven_db_meta WHERE singleton=1`).Scan(&kind); err != nil {
		return &sqliteutil.WrongDatabaseKindError{ExpectedKind: schemaKind}
	}
	if kind != schemaKind {
		return &sqliteutil.WrongDatabaseKindError{ExpectedKind: schemaKind, ActualKind: kind}
	}
	if version > schemaVersion {
		return &sqliteutil.DatabaseTooNewError{Kind: schemaKind, Version: version, CurrentVersion: schemaVersion}
	}
	if version < 1 {
		return &sqliteutil.DatabaseTooOldError{Kind: schemaKind, Version: version, MinimumVersion: 1}
	}
	return verifySchemaVersion(tx, version)
}
func verifySchema(tx *sql.Tx) error {
	return verifySchemaVersion(tx, schemaVersion)
}
func verifySchemaVersion(tx *sql.Tx, version int) error {
	expected := map[string]bool{}
	for index, statement := range schemaStatements {
		if statement == flowerThreadsSchema && version < 3 {
			continue
		}
		if index == 0 && version == 1 {
			statement = canvasSchemaV1
		}
		expected[strings.Join(strings.Fields(statement), " ")] = true
	}
	rows, err := tx.Query(`SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name <> '__redeven_db_meta' ORDER BY name`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var objectType, name string
		var statement sql.NullString
		if err = rows.Scan(&objectType, &name, &statement); err != nil {
			rows.Close()
			return err
		}
		key := strings.Join(strings.Fields(statement.String), " ")
		if !expected[key] {
			rows.Close()
			return fmt.Errorf("unsupported Tessiven v%d schema object: %s %q", version, objectType, name)
		}
		delete(expected, key)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if len(expected) != 0 {
		return fmt.Errorf("missing Tessiven v%d schema objects", version)
	}
	var integrity string
	if err = tx.QueryRow(`PRAGMA quick_check`).Scan(&integrity); err != nil {
		return err
	}
	if integrity != "ok" {
		return fmt.Errorf("tessiven integrity check failed: %s", integrity)
	}
	var invalid int
	if err = tx.QueryRow(`SELECT COUNT(*) FROM canvases c WHERE latest_version <> (SELECT COALESCE(MAX(number),0) FROM versions v WHERE v.canvas_id=c.id) OR latest_version <> (SELECT COUNT(*) FROM versions v WHERE v.canvas_id=c.id)`).Scan(&invalid); err != nil {
		return err
	}
	if invalid != 0 {
		return fmt.Errorf("tessiven version lineage is inconsistent")
	}
	if err = tx.QueryRow(`SELECT COUNT(*) FROM versions v LEFT JOIN canvases c ON c.id=v.canvas_id WHERE c.id IS NULL`).Scan(&invalid); err != nil {
		return err
	}
	if invalid != 0 {
		return fmt.Errorf("tessiven version owner is missing")
	}
	if version >= 3 {
		if err := tx.QueryRow(`SELECT COUNT(*) FROM canvases c LEFT JOIN flower_threads f ON f.thread_id=c.flower_thread_id AND f.canvas_id=c.id WHERE c.flower_thread_id<>'' AND f.thread_id IS NULL`).Scan(&invalid); err != nil {
			return err
		}
		if invalid != 0 {
			return fmt.Errorf("tessiven conversation ownership is inconsistent")
		}
		if err := tx.QueryRow(`SELECT COUNT(*) FROM flower_threads f LEFT JOIN canvases c ON c.id=f.canvas_id WHERE c.id IS NULL OR trim(f.thread_id)=''`).Scan(&invalid); err != nil {
			return err
		}
		if invalid != 0 {
			return fmt.Errorf("tessiven conversation owner is missing")
		}
	}
	return nil
}
