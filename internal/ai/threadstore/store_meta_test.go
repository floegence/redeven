package threadstore

import (
	"bytes"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
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

func TestStoreOpenRejectsUnsupportedDatabaseWithoutMutation(t *testing.T) {
	tests := []struct {
		name          string
		mutate        func(*testing.T, *sql.DB)
		wantWrongKind bool
	}{
		{
			name: "legacy kind",
			mutate: func(t *testing.T, db *sql.DB) {
				t.Helper()
				if _, err := db.Exec("UPDATE __redeven_db_meta SET db_kind = 'ai_threadstore_product_v2' WHERE singleton = 1"); err != nil {
					t.Fatal(err)
				}
			},
			wantWrongKind: true,
		},
		{
			name: "schema drift",
			mutate: func(t *testing.T, db *sql.DB) {
				t.Helper()
				if _, err := db.Exec("ALTER TABLE ai_thread_settings ADD COLUMN shadow TEXT NOT NULL DEFAULT ''"); err != nil {
					t.Fatal(err)
				}
			},
		},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "threads.sqlite")
			store, err := Open(path)
			if err != nil {
				t.Fatal(err)
			}
			if err := store.Close(); err != nil {
				t.Fatal(err)
			}
			raw, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			testCase.mutate(t, raw)
			if err := raw.Close(); err != nil {
				t.Fatal(err)
			}

			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			infoBefore, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			walBefore, walExistsBefore := readOptionalFileForTest(t, path+"-wal")
			shmBefore, shmExistsBefore := readOptionalFileForTest(t, path+"-shm")

			_, openErr := Open(path)
			if openErr == nil {
				t.Fatal("Open succeeded")
			}
			if testCase.wantWrongKind {
				var wrongKind *sqliteutil.WrongDatabaseKindError
				if !errors.As(openErr, &wrongKind) {
					t.Fatalf("error=%v, want WrongDatabaseKindError", openErr)
				}
			}

			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			infoAfter, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(before, after) || infoBefore.Size() != infoAfter.Size() || !infoBefore.ModTime().Equal(infoAfter.ModTime()) {
				t.Fatal("unsupported database changed during rejection")
			}
			walAfter, walExistsAfter := readOptionalFileForTest(t, path+"-wal")
			shmAfter, shmExistsAfter := readOptionalFileForTest(t, path+"-shm")
			if walExistsBefore != walExistsAfter || !bytes.Equal(walBefore, walAfter) || shmExistsBefore != shmExistsAfter || !bytes.Equal(shmBefore, shmAfter) {
				t.Fatal("SQLite sidecars changed during rejection")
			}
		})
	}
}

func readOptionalFileForTest(t *testing.T, path string) ([]byte, bool) {
	t.Helper()
	body, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, false
	}
	if err != nil {
		t.Fatal(err)
	}
	return body, true
}
