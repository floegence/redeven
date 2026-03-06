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

func TestOpen_RejectsInvalidMigrationChain(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "invalid.sqlite")
	_, err := Open(dbPath, Spec{
		Kind:           "broken",
		CurrentVersion: 2,
		LegacyMarkers:  []string{"toy_data"},
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
		LegacyMarkers:  []string{"toy_data"},
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
