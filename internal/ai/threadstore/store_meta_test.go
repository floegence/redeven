package threadstore

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestStoreOpenRepairsLegacyProductColumns(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	if _, err := raw.Exec(`ALTER TABLE ai_threads ADD COLUMN last_context_run_id TEXT NOT NULL DEFAULT ''`); err != nil {
		_ = raw.Close()
		t.Fatalf("add legacy column: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close raw database: %v", err)
	}

	store, err = Open(dbPath)
	if err != nil {
		t.Fatalf("Open repaired store: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close repaired store: %v", err)
	}

	raw, err = sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("reopen raw database: %v", err)
	}
	defer raw.Close()
	tx, err := raw.Begin()
	if err != nil {
		t.Fatalf("begin verification transaction: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	if has, err := columnExists(tx, "ai_threads", "last_context_run_id"); err != nil {
		t.Fatalf("check legacy column: %v", err)
	} else if has {
		t.Fatal("legacy column remains after schema repair")
	}
	var version int
	if err := tx.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatalf("read schema version: %v", err)
	}
	if version != CurrentSchemaVersion() {
		t.Fatalf("schema version=%d, want %d", version, CurrentSchemaVersion())
	}
}
