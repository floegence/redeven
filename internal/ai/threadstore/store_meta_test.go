package threadstore

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

func TestStore_OpenCurrentSchemaWithoutMetaBackfillsMetadata(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	if _, err := raw.Exec(`DROP TABLE __redeven_db_meta;`); err != nil {
		_ = raw.Close()
		t.Fatalf("drop meta table: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close raw db: %v", err)
	}

	s, err = Open(dbPath)
	if err != nil {
		t.Fatalf("Open without meta: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	var kind string
	if err := s.db.QueryRowContext(ctx, `SELECT db_kind FROM __redeven_db_meta WHERE singleton = 1`).Scan(&kind); err != nil {
		t.Fatalf("read db kind: %v", err)
	}
	if kind != threadstoreSchemaKind {
		t.Fatalf("db kind=%q, want %q", kind, threadstoreSchemaKind)
	}
}
