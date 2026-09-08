package sqliteutil

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestSQLiteSnapshotCrashWriter(t *testing.T) {
	path := os.Getenv("REDEVEN_SNAPSHOT_WRITER_PATH")
	if path == "" {
		t.Skip("subprocess fixture writer")
	}
	db, err := Open(path, toySpec("snapshot_test"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO toy_data(name) VALUES ('committed only in WAL')`); err != nil {
		t.Fatal(err)
	}
	// Model a process exit without a SQLite close/checkpoint.
	os.Exit(0)
}

func TestSQLiteBackupIncludesCommittedWALAndPreservesSource(t *testing.T) {
	source := filepath.Join(t.TempDir(), "source.sqlite")
	command := exec.Command(os.Args[0], "-test.run=^TestSQLiteSnapshotCrashWriter$")
	command.Env = append(os.Environ(), "REDEVEN_SNAPSHOT_WRITER_PATH="+source)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("writer: %v %s", err, output)
	}
	original, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	wal, err := os.ReadFile(source + "-wal")
	if err != nil || len(wal) == 0 {
		t.Fatalf("WAL fixture: %v", err)
	}
	destination := filepath.Join(t.TempDir(), "snapshot.sqlite")
	if err = Backup(context.Background(), source, destination, toySpec("snapshot_test")); err != nil {
		t.Fatal(err)
	}
	if after, err := os.ReadFile(source); err != nil || !bytes.Equal(original, after) {
		t.Fatalf("source database changed: %v", err)
	}
	if after, err := os.ReadFile(source + "-wal"); err != nil || !bytes.Equal(wal, after) {
		t.Fatalf("source WAL changed: %v", err)
	}
	db, err := sql.Open("sqlite", readOnlyDSN(destination))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var name string
	if err = db.QueryRow(`SELECT name FROM toy_data`).Scan(&name); err != nil || name != "committed only in WAL" {
		t.Fatalf("snapshot=%q %v", name, err)
	}
	if err = Backup(context.Background(), source, destination, toySpec("snapshot_test")); !errors.Is(err, os.ErrExist) {
		t.Fatalf("overwrote snapshot: %v", err)
	}
}

func TestSQLiteBackupDoesNotLeaveReadOnlySidecars(t *testing.T) {
	source := filepath.Join(t.TempDir(), "source.sqlite")
	db, err := Open(source, toySpec("snapshot_test"))
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(t.TempDir(), "snapshot.sqlite")
	if err = Backup(t.Context(), source, destination, toySpec("snapshot_test")); err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{"-wal", "-shm", "-journal"} {
		if _, err = os.Stat(source + suffix); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("read-only backup left %s: %v", suffix, err)
		}
	}
}
