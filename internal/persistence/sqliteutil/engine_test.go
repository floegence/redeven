package sqliteutil

import (
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
)

func TestOpen_CreatesFreshDatabaseAndMeta(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "toy.sqlite")
	db, err := Open(dbPath, toySpec("toy_a"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = db.Close() }()

	var version int
	if err := db.QueryRow(`PRAGMA user_version;`).Scan(&version); err != nil {
		t.Fatalf("PRAGMA user_version: %v", err)
	}
	if version != 1 {
		t.Fatalf("user_version=%d, want 1", version)
	}

	var metaKind string
	if err := db.QueryRow(`SELECT db_kind FROM __redeven_db_meta WHERE singleton = 1`).Scan(&metaKind); err != nil {
		t.Fatalf("read meta kind: %v", err)
	}
	if metaKind != "toy_a" {
		t.Fatalf("meta kind=%q, want %q", metaKind, "toy_a")
	}
}

func TestOpen_RejectsFutureVersion(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "future.sqlite")
	db, err := Open(dbPath, toySpec("toy_a"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close db: %v", err)
	}

	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	if _, err := raw.Exec(`PRAGMA user_version=2;`); err != nil {
		_ = raw.Close()
		t.Fatalf("set future version: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close raw: %v", err)
	}

	_, err = Open(dbPath, toySpec("toy_a"))
	if err == nil {
		t.Fatalf("Open succeeded, want future version error")
	}
	var tooNew *DatabaseTooNewError
	if !errors.As(err, &tooNew) {
		t.Fatalf("error=%v, want DatabaseTooNewError", err)
	}
}

func TestOpen_RejectsWrongDatabaseKind(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "wrong-kind.sqlite")
	db, err := Open(dbPath, toySpec("toy_a"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close db: %v", err)
	}

	_, err = Open(dbPath, toySpec("toy_b"))
	if err == nil {
		t.Fatalf("Open succeeded, want wrong kind error")
	}
	var wrongKind *WrongDatabaseKindError
	if !errors.As(err, &wrongKind) {
		t.Fatalf("error=%v, want WrongDatabaseKindError", err)
	}
}

func TestOpen_AppliesLegacyKindMigrationAtomically(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "legacy-kind.sqlite")
	db, err := Open(dbPath, toySpec("toy_a"))
	if err != nil {
		t.Fatalf("Open legacy: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO toy_data(id, name) VALUES(1, 'keep')`); err != nil {
		_ = db.Close()
		t.Fatalf("seed legacy data: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close legacy: %v", err)
	}

	spec := toySpec("toy_b")
	spec.LegacyKindMigrations = []LegacyKindMigration{
		{
			FromKind:    "toy_a",
			FromVersion: 1,
			ToKind:      "toy_b",
			ToVersion:   1,
			Apply: func(tx *sql.Tx) error {
				if _, err := tx.Exec(`ALTER TABLE toy_data RENAME TO legacy_toy_data`); err != nil {
					return err
				}
				if _, err := tx.Exec(`CREATE TABLE toy_data(id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '')`); err != nil {
					return err
				}
				_, err := tx.Exec(`INSERT INTO toy_data(id, name) SELECT id, name FROM legacy_toy_data`)
				return err
			},
		},
	}

	db, err = Open(dbPath, spec)
	if err != nil {
		t.Fatalf("Open migrated: %v", err)
	}
	defer func() { _ = db.Close() }()

	var name string
	if err := db.QueryRow(`SELECT name FROM toy_data WHERE id = 1`).Scan(&name); err != nil {
		t.Fatalf("read migrated data: %v", err)
	}
	if name != "keep" {
		t.Fatalf("migrated name=%q, want keep", name)
	}
	var kind string
	if err := db.QueryRow(`SELECT db_kind FROM __redeven_db_meta WHERE singleton = 1`).Scan(&kind); err != nil {
		t.Fatalf("read migrated kind: %v", err)
	}
	if kind != "toy_b" {
		t.Fatalf("migrated kind=%q, want toy_b", kind)
	}
}

func TestOpen_RollsBackFailedLegacyKindMigration(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "legacy-kind-failure.sqlite")
	db, err := Open(dbPath, toySpec("toy_a"))
	if err != nil {
		t.Fatalf("Open legacy: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO toy_data(id, name) VALUES(1, 'keep')`); err != nil {
		_ = db.Close()
		t.Fatalf("seed legacy data: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close legacy: %v", err)
	}

	spec := toySpec("toy_b")
	spec.LegacyKindMigrations = []LegacyKindMigration{{
		FromKind:    "toy_a",
		FromVersion: 1,
		ToKind:      "toy_b",
		ToVersion:   1,
		Apply: func(tx *sql.Tx) error {
			if _, err := tx.Exec(`ALTER TABLE toy_data RENAME TO legacy_toy_data`); err != nil {
				return err
			}
			return errors.New("deliberate migration failure")
		},
	}}
	if _, err := Open(dbPath, spec); err == nil {
		t.Fatal("Open succeeded, want failed legacy migration")
	}

	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("reopen raw database: %v", err)
	}
	defer func() { _ = raw.Close() }()
	var kind string
	if err := raw.QueryRow(`SELECT db_kind FROM __redeven_db_meta WHERE singleton = 1`).Scan(&kind); err != nil {
		t.Fatalf("read rolled-back kind: %v", err)
	}
	if kind != "toy_a" {
		t.Fatalf("rolled-back kind=%q, want toy_a", kind)
	}
	var name string
	if err := raw.QueryRow(`SELECT name FROM toy_data WHERE id = 1`).Scan(&name); err != nil {
		t.Fatalf("read rolled-back data: %v", err)
	}
	if name != "keep" {
		t.Fatalf("rolled-back name=%q, want keep", name)
	}
	var staged int
	if err := raw.QueryRow(`SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'legacy_toy_data'`).Scan(&staged); err != nil {
		t.Fatalf("check staged table: %v", err)
	}
	if staged != 0 {
		t.Fatalf("staged table count=%d, want 0", staged)
	}
}

func TestOpen_RejectsInvalidMigrationChain(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "invalid.sqlite")
	_, err := Open(dbPath, Spec{
		Kind:           "broken",
		CurrentVersion: 2,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`},
		Migrations: []Migration{
			{FromVersion: 0, ToVersion: 1, Apply: func(tx *sql.Tx) error {
				_, err := tx.Exec(`CREATE TABLE IF NOT EXISTS toy_data(id INTEGER PRIMARY KEY)`)
				return err
			}},
		},
	})
	if err == nil {
		t.Fatalf("Open succeeded, want invalid migration chain error")
	}
	var invalid *InvalidMigrationChainError
	if !errors.As(err, &invalid) {
		t.Fatalf("error=%v, want InvalidMigrationChainError", err)
	}
}

func toySpec(kind string) Spec {
	return Spec{
		Kind:           kind,
		CurrentVersion: 1,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`},
		Migrations: []Migration{
			{FromVersion: 0, ToVersion: 1, Apply: func(tx *sql.Tx) error {
				_, err := tx.Exec(`CREATE TABLE IF NOT EXISTS toy_data(id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '')`)
				return err
			}},
		},
		Verify: func(tx *sql.Tx) error {
			exists, err := TableExistsTx(tx, "toy_data")
			if err != nil {
				return err
			}
			if !exists {
				return errors.New("missing toy_data")
			}
			return nil
		},
	}
}
