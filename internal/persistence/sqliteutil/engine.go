package sqliteutil

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
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

type Spec struct {
	Kind           string
	CurrentVersion int
	LegacyMarkers  []string
	Pragmas        []string
	Migrations     []Migration
	Verify         func(tx *sql.Tx) error
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

	db, err := sql.Open("sqlite", p)
	if err != nil {
		return nil, err
	}
	if err := EnsureSchema(db, spec); err != nil {
		_ = db.Close()
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	return db, nil
}

func EnsureSchema(db *sql.DB, spec Spec) error {
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

	currentVersion, err := readUserVersion(db)
	if err != nil {
		return err
	}
	if currentVersion > spec.CurrentVersion {
		return &DatabaseTooNewError{Kind: spec.Kind, Version: currentVersion, CurrentVersion: spec.CurrentVersion}
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	startedAt := time.Now().UnixMilli()
	startedVersion := currentVersion
	if err := ensureMetaOwnershipTx(tx, spec, currentVersion); err != nil {
		return err
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
	if err := upsertMetaTx(tx, spec.Kind, startedAt, startedVersion, currentVersion); err != nil {
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
	if len(spec.Migrations) == 0 {
		return &InvalidMigrationChainError{Kind: kind, Reason: "missing migrations"}
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

func readUserVersion(db *sql.DB) (int, error) {
	var version int
	if err := db.QueryRow(`PRAGMA user_version;`).Scan(&version); err != nil {
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

func ensureMetaOwnershipTx(tx *sql.Tx, spec Spec, currentVersion int) error {
	if err := createMetaTableTx(tx); err != nil {
		return err
	}

	metaKind, hasMeta, err := readMetaKindTx(tx)
	if err != nil {
		return err
	}
	if hasMeta {
		if metaKind != spec.Kind {
			tables, listErr := ListUserTablesTx(tx)
			if listErr != nil {
				return &WrongDatabaseKindError{ExpectedKind: spec.Kind, ActualKind: metaKind}
			}
			return &WrongDatabaseKindError{ExpectedKind: spec.Kind, ActualKind: metaKind, Existing: tables}
		}
		return nil
	}

	tables, err := ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	if len(tables) > 0 && !matchesLegacyMarkers(tables, spec.LegacyMarkers) {
		return &WrongDatabaseKindError{ExpectedKind: spec.Kind, Existing: tables}
	}
	return insertMetaTx(tx, spec.Kind, currentVersion)
}

func matchesLegacyMarkers(existing []string, markers []string) bool {
	if len(existing) == 0 {
		return true
	}
	if len(markers) == 0 {
		return false
	}
	markerSet := make(map[string]struct{}, len(markers))
	for _, marker := range markers {
		marker = strings.TrimSpace(marker)
		if marker == "" {
			continue
		}
		markerSet[strings.ToLower(marker)] = struct{}{}
	}
	for _, table := range existing {
		if _, ok := markerSet[strings.ToLower(strings.TrimSpace(table))]; ok {
			return true
		}
	}
	return false
}

func createMetaTableTx(tx *sql.Tx) error {
	if tx == nil {
		return errors.New("nil tx")
	}
	_, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS __redeven_db_meta (
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

func readMetaKindTx(tx *sql.Tx) (string, bool, error) {
	var kind string
	err := tx.QueryRow(`SELECT db_kind FROM __redeven_db_meta WHERE singleton = 1`).Scan(&kind)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", false, nil
		}
		return "", false, err
	}
	return strings.TrimSpace(kind), true, nil
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

func upsertMetaTx(tx *sql.Tx, kind string, startedAt int64, fromVersion int, toVersion int) error {
	now := time.Now().UnixMilli()
	if startedAt <= 0 {
		startedAt = now
	}
	_, err := tx.Exec(`
INSERT INTO __redeven_db_meta(
  singleton, db_kind, created_at_unix_ms, last_migrated_at_unix_ms,
  last_migrated_from_version, last_migrated_to_version
)
VALUES(1, ?, ?, ?, ?, ?)
ON CONFLICT(singleton) DO UPDATE SET
  db_kind = excluded.db_kind,
  last_migrated_at_unix_ms = excluded.last_migrated_at_unix_ms,
  last_migrated_from_version = excluded.last_migrated_from_version,
  last_migrated_to_version = excluded.last_migrated_to_version
`, kind, startedAt, now, fromVersion, toVersion)
	return err
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
