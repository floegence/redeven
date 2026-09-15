package threadstore

import (
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func seedComputerMigrationThread(t *testing.T, path string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`INSERT INTO ai_thread_settings(thread_id, endpoint_id, namespace_public_id, model_id, permission_type, working_dir, settings_created_at_unix_ms, settings_updated_at_unix_ms) VALUES('thread', 'env', 'ns', 'deepseek/vision', 'approval_required', '/project', 10, 11)`); err != nil {
		t.Fatal(err)
	}
}

func TestComputerTargetV6MigrationPreservesSettingsAndSelectionAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	createReviewedVersionDatabaseForTest(t, path, 6)
	seedComputerMigrationThread(t, path)
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	target, err := store.GetComputerTarget(t.Context(), "thread")
	if err != nil || target != "" {
		t.Fatalf("initial binding=%q err=%v", target, err)
	}
	if err := store.SetComputerTarget(t.Context(), "thread", "desktop-main"); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	target, err = reopened.GetComputerTarget(t.Context(), "thread")
	if err != nil || target != "desktop-main" {
		t.Fatalf("restored binding=%q err=%v", target, err)
	}
	settings, err := reopened.GetThreadSettings(t.Context(), "env", "thread")
	if err != nil || settings == nil || settings.PermissionType != "approval_required" || settings.WorkingDir != "/project" || settings.ModelID != "deepseek/vision" || settings.SettingsCreatedAtUnixMs != 10 || settings.SettingsUpdatedAtUnixMs != 11 {
		t.Fatalf("settings changed: %+v %v", settings, err)
	}
	if err := reopened.SetComputerTarget(t.Context(), "missing", "desktop-main"); err == nil {
		t.Fatal("binding created unknown thread")
	}
}

func TestComputerTargetMigrationFailureRollsBackColumnAndVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	createReviewedVersionDatabaseForTest(t, path, 6)
	seedComputerMigrationThread(t, path)
	spec := threadstoreSchemaSpec()
	failure := errors.New("injected migration failure")
	spec.Migrations[len(spec.Migrations)-1].Apply = func(tx *sql.Tx) error {
		if err := migrateThreadstoreV6ToV7(tx); err != nil {
			return err
		}
		return failure
	}
	db, err := sqliteutil.Open(path, spec)
	if db != nil {
		db.Close()
		t.Fatal("failed migration returned database")
	}
	if !errors.Is(err, failure) {
		t.Fatalf("migration=%v", err)
	}
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	tx, err := raw.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	actual, err := inspectReviewedSchemaTx(tx)
	if err != nil {
		t.Fatal(err)
	}
	expected, err := reviewedProductSchemaContract(6)
	if err != nil {
		t.Fatal(err)
	}
	if err := compareReviewedSchemas(actual, expected); err != nil {
		t.Fatal(err)
	}
	var workingDir string
	if err := tx.QueryRow(`SELECT working_dir FROM ai_thread_settings WHERE thread_id = 'thread'`).Scan(&workingDir); err != nil || workingDir != "/project" {
		t.Fatalf("source lost: %s %v", workingDir, err)
	}
}
