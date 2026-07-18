package threadstore

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestStoreOpenRejectsLegacyProductColumns(t *testing.T) {
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
	if _, err := raw.Exec(`ALTER TABLE ai_thread_settings ADD COLUMN last_context_run_id TEXT NOT NULL DEFAULT ''`); err != nil {
		_ = raw.Close()
		t.Fatalf("add legacy column: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close raw database: %v", err)
	}

	if _, err = Open(dbPath); err == nil {
		t.Fatal("Open succeeded, want schema verification error")
	}
}
