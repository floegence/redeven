package sqliteutil

import (
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const metaTableName = "__redeven_db_meta"

type Migration struct {
	FromVersion int
	ToVersion   int
	Apply       func(tx *sql.Tx) error
}

// LegacyKindMigration converts one explicitly versioned older schema kind into
// the current schema before normal version migrations run.
type LegacyKindMigration struct {
	FromKind    string
	FromVersion int
	ToKind      string
	ToVersion   int
	Apply       func(tx *sql.Tx) error
}

type Spec struct {
	Kind                 string
	CurrentVersion       int
	Pragmas              []string
	Migrations           []Migration
	LegacyKindMigrations []LegacyKindMigration
	Verify               func(tx *sql.Tx) error
}

type DatabaseTooNewError struct {
	Kind           string
	Version        int
	CurrentVersion int
}

func (e *DatabaseTooNewError) Error() string {
	if e == nil {
		return "database version is newer than supported"
	}
	return fmt.Sprintf("database kind %q is at version %d, but this binary only supports up to %d", e.Kind, e.Version, e.CurrentVersion)
}

type DatabaseTooOldError struct {
	Kind           string
	Version        int
	MinimumVersion int
}

func (e *DatabaseTooOldError) Error() string {
	if e == nil {
		return "database version is older than supported"
	}
	return fmt.Sprintf("database kind %q is at version %d, but this binary supports from version %d", e.Kind, e.Version, e.MinimumVersion)
}

type WrongDatabaseKindError struct {
	ExpectedKind string
	ActualKind   string
	Existing     []string
}

func (e *WrongDatabaseKindError) Error() string {
	if e == nil {
		return "wrong database kind"
	}
	if strings.TrimSpace(e.ActualKind) != "" {
		return fmt.Sprintf("wrong database kind: expected %q, got %q", e.ExpectedKind, e.ActualKind)
	}
	if len(e.Existing) > 0 {
		return fmt.Sprintf("database does not look like %q (found tables: %s)", e.ExpectedKind, strings.Join(e.Existing, ", "))
	}
	return fmt.Sprintf("wrong database kind: expected %q", e.ExpectedKind)
}

type InvalidMigrationChainError struct {
	Kind   string
	Reason string
}

func (e *InvalidMigrationChainError) Error() string {
	if e == nil {
		return "invalid migration chain"
	}
	if strings.TrimSpace(e.Reason) == "" {
		return fmt.Sprintf("invalid migration chain for %q", e.Kind)
	}
	return fmt.Sprintf("invalid migration chain for %q: %s", e.Kind, e.Reason)
}

type SchemaVerifyError struct {
	Kind string
	Err  error
}

func (e *SchemaVerifyError) Error() string {
	if e == nil {
		return "schema verify failed"
	}
	return fmt.Sprintf("schema verify failed for %q: %v", e.Kind, e.Err)
}

func (e *SchemaVerifyError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func Open(path string, spec Spec) (*sql.DB, error) {
	p := filepath.Clean(strings.TrimSpace(path))
	if p == "" {
		return nil, errors.New("missing sqlite path")
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", immediateDSN(p))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err := ensureSchema(db, spec); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

func ensureSchema(db *sql.DB, spec Spec) error {
	if db == nil {
		return errors.New("nil db")
	}
	if err := validateSpec(spec); err != nil {
		return err
	}
	for _, pragma := range spec.Pragmas {
		stmt := strings.TrimSpace(pragma)
		if stmt == "" {
			continue
		}
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("apply pragma %q: %w", stmt, err)
		}
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	currentVersion, err := readUserVersionTx(tx)
	if err != nil {
		return err
	}
	startedAt := time.Now().UnixMilli()
	startedVersion := currentVersion
	hasMetaTable, err := TableExistsTx(tx, metaTableName)
	if err != nil {
		return err
	}
	tables, err := ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	if !hasMetaTable {
		if len(tables) > 0 || currentVersion != 0 {
			return &WrongDatabaseKindError{ExpectedKind: spec.Kind, Existing: tables}
		}
		if err := createMetaTableTx(tx); err != nil {
			return err
		}
		if err := insertMetaTx(tx, spec.Kind, currentVersion); err != nil {
			return err
		}
	} else if err := verifyMetaTableTx(tx); err != nil {
		return err
	}
	metaKind, err := readMetaKindTx(tx)
	if err != nil {
		return err
	}
	legacyMigration, isLegacy, err := findLegacyKindMigration(spec, metaKind, currentVersion)
	if err != nil {
		return err
	}
	if isLegacy {
		if legacyMigration.Apply == nil {
			return &InvalidMigrationChainError{Kind: spec.Kind, Reason: fmt.Sprintf("legacy migration from %q has nil apply", legacyMigration.FromKind)}
		}
		if err := legacyMigration.Apply(tx); err != nil {
			return fmt.Errorf("migrate %s from legacy kind %q: %w", spec.Kind, legacyMigration.FromKind, err)
		}
		if err := setUserVersionTx(tx, legacyMigration.ToVersion); err != nil {
			return err
		}
		currentVersion = legacyMigration.ToVersion
	} else {
		if metaKind != spec.Kind {
			minimum, maximum, known := legacyVersionRange(spec, metaKind)
			if known && currentVersion < minimum {
				return &DatabaseTooOldError{Kind: metaKind, Version: currentVersion, MinimumVersion: minimum}
			}
			if known && currentVersion > maximum {
				return &DatabaseTooNewError{Kind: metaKind, Version: currentVersion, CurrentVersion: maximum}
			}
			if known {
				return &InvalidMigrationChainError{Kind: spec.Kind, Reason: fmt.Sprintf("missing legacy migration from kind %q version %d", metaKind, currentVersion)}
			}
			return &WrongDatabaseKindError{ExpectedKind: spec.Kind, ActualKind: metaKind, Existing: tables}
		}
	}
	if currentVersion > spec.CurrentVersion {
		return &DatabaseTooNewError{Kind: spec.Kind, Version: currentVersion, CurrentVersion: spec.CurrentVersion}
	}

	for currentVersion < spec.CurrentVersion {
		migration := findMigration(spec.Migrations, currentVersion)
		if migration == nil {
			return &InvalidMigrationChainError{Kind: spec.Kind, Reason: fmt.Sprintf("missing migration from version %d", currentVersion)}
		}
		if migration.Apply == nil {
			return &InvalidMigrationChainError{Kind: spec.Kind, Reason: fmt.Sprintf("migration %d -> %d has nil apply", migration.FromVersion, migration.ToVersion)}
		}
		if err := migration.Apply(tx); err != nil {
			return fmt.Errorf("migrate %s from v%d to v%d: %w", spec.Kind, migration.FromVersion, migration.ToVersion, err)
		}
		if err := setUserVersionTx(tx, migration.ToVersion); err != nil {
			return err
		}
		currentVersion = migration.ToVersion
	}

	if spec.Verify != nil {
		if err := spec.Verify(tx); err != nil {
			return &SchemaVerifyError{Kind: spec.Kind, Err: err}
		}
	}
	if err := updateMetaTx(tx, spec.Kind, startedAt, startedVersion, currentVersion); err != nil {
		return err
	}
	return tx.Commit()
}

func validateSpec(spec Spec) error {
	kind := strings.TrimSpace(spec.Kind)
	if kind == "" {
		return errors.New("missing sqlite schema kind")
	}
	if spec.CurrentVersion <= 0 {
		return &InvalidMigrationChainError{Kind: kind, Reason: "current version must be positive"}
	}
	if len(spec.Migrations) == 0 && spec.CurrentVersion != 0 {
		return &InvalidMigrationChainError{Kind: kind, Reason: "missing migrations"}
	}
	legacySources := make(map[string]struct{}, len(spec.LegacyKindMigrations))
	for _, migration := range spec.LegacyKindMigrations {
		fromKind := strings.TrimSpace(migration.FromKind)
		if fromKind == "" {
			return &InvalidMigrationChainError{Kind: kind, Reason: "legacy migration has empty source kind"}
		}
		if fromKind == kind {
			return &InvalidMigrationChainError{Kind: kind, Reason: "legacy migration source kind matches current kind"}
		}
		if migration.FromVersion < 0 {
			return &InvalidMigrationChainError{Kind: kind, Reason: fmt.Sprintf("legacy migration from %q has invalid source version %d", migration.FromKind, migration.FromVersion)}
		}
		if migration.Apply == nil {
			return &InvalidMigrationChainError{Kind: kind, Reason: fmt.Sprintf("legacy migration from %q has nil apply", migration.FromKind)}
		}
		if strings.TrimSpace(migration.ToKind) != kind {
			return &InvalidMigrationChainError{Kind: kind, Reason: fmt.Sprintf("legacy migration from %q targets kind %q", migration.FromKind, migration.ToKind)}
		}
		if migration.ToVersion < 0 || migration.ToVersion > spec.CurrentVersion {
			return &InvalidMigrationChainError{Kind: kind, Reason: fmt.Sprintf("legacy migration from %q targets invalid version %d", migration.FromKind, migration.ToVersion)}
		}
		key := fmt.Sprintf("%s\x00%d", fromKind, migration.FromVersion)
		if _, exists := legacySources[key]; exists {
			return &InvalidMigrationChainError{Kind: kind, Reason: fmt.Sprintf("duplicate legacy migration from kind %q version %d", fromKind, migration.FromVersion)}
		}
		legacySources[key] = struct{}{}
	}
	expectedFrom := 0
	for _, migration := range spec.Migrations {
		if migration.FromVersion != expectedFrom {
			return &InvalidMigrationChainError{Kind: kind, Reason: fmt.Sprintf("expected migration from version %d, got %d", expectedFrom, migration.FromVersion)}
		}
		if migration.ToVersion != migration.FromVersion+1 {
			return &InvalidMigrationChainError{Kind: kind, Reason: fmt.Sprintf("migration %d -> %d must advance exactly one version", migration.FromVersion, migration.ToVersion)}
		}
		expectedFrom = migration.ToVersion
	}
	if expectedFrom != spec.CurrentVersion {
		return &InvalidMigrationChainError{Kind: kind, Reason: fmt.Sprintf("migration chain ends at version %d, want %d", expectedFrom, spec.CurrentVersion)}
	}
	return nil
}

func readUserVersionTx(tx *sql.Tx) (int, error) {
	var version int
	if err := tx.QueryRow(`PRAGMA user_version;`).Scan(&version); err != nil {
		return 0, fmt.Errorf("pragma user_version: %w", err)
	}
	return version, nil
}

func findMigration(migrations []Migration, fromVersion int) *Migration {
	for i := range migrations {
		if migrations[i].FromVersion == fromVersion {
			return &migrations[i]
		}
	}
	return nil
}

func findLegacyKindMigration(spec Spec, metaKind string, currentVersion int) (*LegacyKindMigration, bool, error) {
	if strings.TrimSpace(metaKind) == strings.TrimSpace(spec.Kind) {
		return nil, false, nil
	}
	for index := range spec.LegacyKindMigrations {
		migration := &spec.LegacyKindMigrations[index]
		if strings.TrimSpace(metaKind) != strings.TrimSpace(migration.FromKind) {
			continue
		}
		if migration.FromVersion != currentVersion {
			continue
		}
		return migration, true, nil
	}
	return nil, false, nil
}

func legacyVersionRange(spec Spec, kind string) (int, int, bool) {
	kind = strings.TrimSpace(kind)
	minimum, maximum := 0, 0
	found := false
	for _, migration := range spec.LegacyKindMigrations {
		if strings.TrimSpace(migration.FromKind) != kind {
			continue
		}
		if !found || migration.FromVersion < minimum {
			minimum = migration.FromVersion
		}
		if !found || migration.FromVersion > maximum {
			maximum = migration.FromVersion
		}
		found = true
	}
	return minimum, maximum, found
}

func immediateDSN(path string) string {
	u := url.URL{Scheme: "file", Path: path}
	query := u.Query()
	query.Set("_txlock", "immediate")
	u.RawQuery = query.Encode()
	return u.String()
}

func createMetaTableTx(tx *sql.Tx) error {
	if tx == nil {
		return errors.New("nil tx")
	}
	_, err := tx.Exec(`
CREATE TABLE __redeven_db_meta (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  db_kind TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_migrated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_migrated_from_version INTEGER NOT NULL DEFAULT 0,
  last_migrated_to_version INTEGER NOT NULL DEFAULT 0
);
`)
	return err
}

func verifyMetaTableTx(tx *sql.Tx) error {
	rows, err := tx.Query(`PRAGMA table_info(__redeven_db_meta)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	type column struct {
		name       string
		columnType string
		notNull    int
		defaultVal string
		primaryKey int
	}
	expected := []column{
		{name: "singleton", columnType: "INTEGER", primaryKey: 1},
		{name: "db_kind", columnType: "TEXT", notNull: 1},
		{name: "created_at_unix_ms", columnType: "INTEGER", notNull: 1, defaultVal: "0"},
		{name: "last_migrated_at_unix_ms", columnType: "INTEGER", notNull: 1, defaultVal: "0"},
		{name: "last_migrated_from_version", columnType: "INTEGER", notNull: 1, defaultVal: "0"},
		{name: "last_migrated_to_version", columnType: "INTEGER", notNull: 1, defaultVal: "0"},
	}
	actual := make([]column, 0, len(expected))
	for rows.Next() {
		var cid int
		var item column
		var defaultValue sql.NullString
		if err := rows.Scan(&cid, &item.name, &item.columnType, &item.notNull, &defaultValue, &item.primaryKey); err != nil {
			return err
		}
		item.columnType = strings.ToUpper(strings.TrimSpace(item.columnType))
		item.defaultVal = strings.TrimSpace(defaultValue.String)
		actual = append(actual, item)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if !slices.Equal(actual, expected) {
		return fmt.Errorf("invalid %s schema", metaTableName)
	}
	var tableSQL string
	if err := tx.QueryRow(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`, metaTableName).Scan(&tableSQL); err != nil {
		return err
	}
	compactSQL := strings.ToLower(strings.Join(strings.Fields(tableSQL), ""))
	if !strings.Contains(compactSQL, "check(singleton=1)") {
		return fmt.Errorf("invalid %s singleton constraint", metaTableName)
	}
	var unexpectedObjects int
	if err := tx.QueryRow(`
SELECT COUNT(1)
FROM sqlite_master
WHERE tbl_name = ?
  AND name <> ?
  AND name NOT LIKE 'sqlite_autoindex_%'
`, metaTableName, metaTableName).Scan(&unexpectedObjects); err != nil {
		return err
	}
	if unexpectedObjects != 0 {
		return fmt.Errorf("invalid %s contains %d unexpected schema objects", metaTableName, unexpectedObjects)
	}
	return nil
}

func readMetaKindTx(tx *sql.Tx) (string, error) {
	var rowCount int
	if err := tx.QueryRow(`SELECT COUNT(1) FROM __redeven_db_meta`).Scan(&rowCount); err != nil {
		return "", err
	}
	if rowCount != 1 {
		return "", fmt.Errorf("invalid %s row count %d", metaTableName, rowCount)
	}
	var kind string
	err := tx.QueryRow(`SELECT db_kind FROM __redeven_db_meta WHERE singleton = 1`).Scan(&kind)
	if err != nil {
		return "", err
	}
	kind = strings.TrimSpace(kind)
	if kind == "" {
		return "", fmt.Errorf("invalid empty database kind in %s", metaTableName)
	}
	return kind, nil
}

func insertMetaTx(tx *sql.Tx, kind string, version int) error {
	now := time.Now().UnixMilli()
	_, err := tx.Exec(`
INSERT INTO __redeven_db_meta(
  singleton, db_kind, created_at_unix_ms, last_migrated_at_unix_ms,
  last_migrated_from_version, last_migrated_to_version
)
VALUES(1, ?, ?, ?, ?, ?)
`, kind, now, now, version, version)
	return err
}

func updateMetaTx(tx *sql.Tx, kind string, startedAt int64, fromVersion int, toVersion int) error {
	now := time.Now().UnixMilli()
	if startedAt <= 0 {
		startedAt = now
	}
	result, err := tx.Exec(`
UPDATE __redeven_db_meta
SET db_kind = ?,
    created_at_unix_ms = CASE WHEN created_at_unix_ms > 0 THEN created_at_unix_ms ELSE ? END,
    last_migrated_at_unix_ms = ?,
    last_migrated_from_version = ?,
    last_migrated_to_version = ?
WHERE singleton = 1
`, kind, startedAt, now, fromVersion, toVersion)
	if err != nil {
		return err
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if updated != 1 {
		return fmt.Errorf("update %s affected %d rows, want 1", metaTableName, updated)
	}
	return nil
}

func setUserVersionTx(tx *sql.Tx, version int) error {
	if tx == nil {
		return errors.New("nil tx")
	}
	if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version=%d;`, version)); err != nil {
		return fmt.Errorf("set user_version: %w", err)
	}
	return nil
}
