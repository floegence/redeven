package threadstore

import (
	"bytes"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func TestOpenMigratesWALOnlyV4AndPreservesRecords(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	writer := createWALOnlyV4ThreadstoreForTest(t, path, func(db *sql.DB) {
		if _, err := db.Exec(`INSERT INTO ai_upload_refs(id, endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms) VALUES(41, 'env_wal', 'upload_wal', 'thread_wal', 'thread', 'message_wal', 1234)`); err != nil {
			t.Fatal(err)
		}
	})
	assertMainFileHasNoWALStateForTest(t, path)

	store, err := Open(path)
	if err != nil {
		t.Fatalf("migrate WAL-only v4 threadstore: %v", err)
	}
	assertWALRecordMigratedForTest(t, store.db)
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatalf("reopen migrated threadstore: %v", err)
	}
	defer reopened.Close()
	assertWALRecordMigratedForTest(t, reopened.db)
}

func TestOpenRejectsUnsupportedWALStateWithoutMutation(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*testing.T, *sql.DB)
		check  func(*testing.T, error)
	}{
		{
			name: "wrong kind",
			mutate: func(t *testing.T, db *sql.DB) {
				if _, err := db.Exec(`UPDATE __redeven_db_meta SET db_kind = 'other_product' WHERE singleton = 1`); err != nil {
					t.Fatal(err)
				}
			},
			check: func(t *testing.T, err error) {
				var target *sqliteutil.WrongDatabaseKindError
				if !errors.As(err, &target) {
					t.Fatalf("error=%v, want WrongDatabaseKindError", err)
				}
			},
		},
		{
			name: "future version",
			mutate: func(t *testing.T, db *sql.DB) {
				if _, err := db.Exec(`PRAGMA user_version = 7`); err != nil {
					t.Fatal(err)
				}
			},
			check: func(t *testing.T, err error) {
				var target *sqliteutil.DatabaseTooNewError
				if !errors.As(err, &target) {
					t.Fatalf("error=%v, want DatabaseTooNewError", err)
				}
			},
		},
		{
			name: "schema drift",
			mutate: func(t *testing.T, db *sql.DB) {
				if _, err := db.Exec(`ALTER TABLE ai_thread_settings ADD COLUMN shadow TEXT NOT NULL DEFAULT ''`); err != nil {
					t.Fatal(err)
				}
			},
			check: func(t *testing.T, err error) {
				var target *sqliteutil.SchemaVerifyError
				if !errors.As(err, &target) {
					t.Fatalf("error=%v, want SchemaVerifyError", err)
				}
			},
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			dir := t.TempDir()
			sourcePath := filepath.Join(dir, "source.sqlite")
			writer := createWALOnlyV4ThreadstoreForTest(t, sourcePath, func(db *sql.DB) {
				testCase.mutate(t, db)
			})
			assertMainFileHasNoWALStateForTest(t, sourcePath)
			path := filepath.Join(dir, "threads.sqlite")
			for _, suffix := range []string{"", "-wal", "-shm"} {
				copyFileForTest(t, sourcePath+suffix, path+suffix)
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			before := captureSQLiteFilesForTest(t, path)

			store, err := Open(path)
			if store != nil {
				_ = store.Close()
				t.Fatal("unsupported WAL state returned a store")
			}
			if err == nil {
				t.Fatal("unsupported WAL state was accepted")
			}
			testCase.check(t, err)
			assertSQLiteFilesEqualForTest(t, path, before)
		})
	}
}

func TestOpenRejectsWALWithoutLeavingNewSHM(t *testing.T) {
	sourcePath := filepath.Join(t.TempDir(), "source.sqlite")
	writer := createWALOnlyV4ThreadstoreForTest(t, sourcePath, func(db *sql.DB) {
		if _, err := db.Exec(`UPDATE __redeven_db_meta SET db_kind = 'other_product' WHERE singleton = 1`); err != nil {
			t.Fatal(err)
		}
	})

	targetPath := filepath.Join(t.TempDir(), "threads.sqlite")
	copyFileForTest(t, sourcePath, targetPath)
	copyFileForTest(t, sourcePath+"-wal", targetPath+"-wal")
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(targetPath + "-shm"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("target SHM exists before preflight: %v", err)
	}
	before := captureSQLiteFilesForTest(t, targetPath)

	store, err := Open(targetPath)
	if store != nil {
		_ = store.Close()
		t.Fatal("wrong-kind WAL state returned a store")
	}
	var wrongKind *sqliteutil.WrongDatabaseKindError
	if !errors.As(err, &wrongKind) {
		t.Fatalf("error=%v, want WrongDatabaseKindError", err)
	}
	assertSQLiteFilesEqualForTest(t, targetPath, before)
}

func createWALOnlyV4ThreadstoreForTest(t *testing.T, path string, mutate func(*sql.DB)) *sql.DB {
	t.Helper()
	writer, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	writer.SetMaxOpenConns(1)
	if _, err := writer.Exec(`PRAGMA journal_mode=WAL`); err != nil {
		_ = writer.Close()
		t.Fatal(err)
	}
	if _, err := writer.Exec(`PRAGMA wal_autocheckpoint=0`); err != nil {
		_ = writer.Close()
		t.Fatal(err)
	}
	createReviewedVersionOnConnectionForTest(t, writer, 4)
	if mutate != nil {
		mutate(writer)
	}
	wal, exists := readOptionalFileForTest(t, path+"-wal")
	if !exists || len(wal) == 0 {
		_ = writer.Close()
		t.Fatal("fixture has no WAL content")
	}
	return writer
}

func assertMainFileHasNoWALStateForTest(t *testing.T, path string) {
	t.Helper()
	u := url.URL{Scheme: "file", Path: path}
	query := u.Query()
	query.Set("mode", "ro")
	query.Set("immutable", "1")
	u.RawQuery = query.Encode()
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var version, tables int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'`).Scan(&tables); err != nil {
		t.Fatal(err)
	}
	if version != 0 || tables != 0 {
		t.Fatalf("main file sees version=%d tables=%d, want empty v0", version, tables)
	}
}

func assertWALRecordMigratedForTest(t *testing.T, db *sql.DB) {
	t.Helper()
	var version int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != threadstoreCurrentSchemaVersion {
		t.Fatalf("version=%d, want %d", version, threadstoreCurrentSchemaVersion)
	}
	var endpointID, uploadID, targetID, refKind, refID string
	if err := db.QueryRow(`SELECT endpoint_id, upload_id, target_id, ref_kind, ref_id FROM ai_upload_refs WHERE upload_id = 'upload_wal'`).Scan(&endpointID, &uploadID, &targetID, &refKind, &refID); err != nil {
		t.Fatal(err)
	}
	if endpointID != "env_wal" || targetID != "thread_wal" || refKind != "thread" || refID != "message_wal" {
		t.Fatalf("migrated WAL record=(%q, %q, %q, %q, %q)", endpointID, uploadID, targetID, refKind, refID)
	}
}

type sqliteFilesForTest map[string]struct {
	body   []byte
	exists bool
}

func captureSQLiteFilesForTest(t *testing.T, path string) sqliteFilesForTest {
	t.Helper()
	files := sqliteFilesForTest{}
	for _, suffix := range []string{"", "-wal", "-shm"} {
		body, exists := readOptionalFileForTest(t, path+suffix)
		files[suffix] = struct {
			body   []byte
			exists bool
		}{body: body, exists: exists}
	}
	return files
}

func assertSQLiteFilesEqualForTest(t *testing.T, path string, before sqliteFilesForTest) {
	t.Helper()
	after := captureSQLiteFilesForTest(t, path)
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if before[suffix].exists != after[suffix].exists || !bytes.Equal(before[suffix].body, after[suffix].body) {
			t.Fatalf("SQLite file %q changed during rejection", path+suffix)
		}
	}
}

func copyFileForTest(t *testing.T, source string, target string) {
	t.Helper()
	body, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, body, 0o600); err != nil {
		t.Fatal(err)
	}
}
