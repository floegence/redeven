package threadstore

import (
	"bytes"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func seedV9ExecutionAuthorities(t *testing.T, path string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, mode := range []string{"readonly", "approval_required", "full_access"} {
		if _, err := db.Exec(`INSERT INTO ai_thread_settings(thread_id, endpoint_id, namespace_public_id, permission_type, working_dir, settings_created_at_unix_ms, settings_updated_at_unix_ms) VALUES(?, 'env', 'ns', ?, '/kept', 10, 11)`, mode, mode); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`INSERT INTO ai_flower_execution_authority(request_key, thread_id, turn_id, endpoint_id, namespace_public_id, channel_id, user_public_id, user_email, created_at_unix_ms) VALUES(?, ?, ?, 'env', 'ns', 'channel', 'user', 'user@example.test', 12)`, mode, mode, "turn-"+mode); err != nil {
			t.Fatal(err)
		}
	}
}

func TestExecutionPermissionV9MigrationFreezesAuthorityAndIsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	createReviewedVersionDatabaseForTest(t, path, 9)
	seedV9ExecutionAuthorities(t, path)
	for attempt := 0; attempt < 2; attempt++ {
		store, err := Open(path)
		if err != nil {
			t.Fatal(err)
		}
		for _, mode := range []string{"readonly", "approval_required", "full_access"} {
			authority, err := store.GetExecutionAuthority(t.Context(), mode)
			want := &ExecutionAuthority{RequestKey: mode, ThreadID: mode, TurnID: "turn-" + mode, EndpointID: "env", NamespacePublicID: "ns", ChannelID: "channel", UserPublicID: "user", UserEmail: "user@example.test", PermissionType: mode, CreatedAtUnixMs: 12}
			if err != nil || !reflect.DeepEqual(authority, want) {
				t.Fatalf("authority=%+v want=%+v err=%v", authority, want, err)
			}
			if attempt == 0 {
				settings, err := store.GetThreadSettings(t.Context(), "env", mode)
				if err != nil || settings.PermissionType != mode || settings.WorkingDir != "/kept" || settings.SettingsUpdatedAtUnixMs != 11 {
					t.Fatalf("migration changed settings: %+v %v", settings, err)
				}
				if err := store.UpdateThreadPermissionType(t.Context(), "env", mode, "approval_required"); err != nil {
					t.Fatal(err)
				}
			}
		}
		if err := store.Close(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestExecutionPermissionMigrationRollsBackAndRejectsInvalidSources(t *testing.T) {
	for _, test := range []struct {
		name, mutation string
		injectFailure  bool
	}{
		{name: "failure after migration", injectFailure: true},
		{name: "missing settings", mutation: `DELETE FROM ai_thread_settings WHERE thread_id = 'readonly'`},
		{name: "foreign endpoint", mutation: `UPDATE ai_thread_settings SET endpoint_id = 'foreign' WHERE thread_id = 'readonly'`},
		{name: "foreign namespace", mutation: `UPDATE ai_thread_settings SET namespace_public_id = 'foreign' WHERE thread_id = 'readonly'`},
		{name: "invalid permission", mutation: `UPDATE ai_thread_settings SET permission_type = 'unknown' WHERE thread_id = 'readonly'`},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "threads.sqlite")
			createReviewedVersionDatabaseForTest(t, path, 9)
			seedV9ExecutionAuthorities(t, path)
			raw, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			if test.mutation != "" {
				if _, err := raw.Exec(test.mutation); err != nil {
					t.Fatal(err)
				}
			}
			_ = raw.Close()
			spec := threadstoreSchemaSpec()
			injected := errors.New("injected failure after authority backfill")
			if test.injectFailure {
				spec.Migrations[len(spec.Migrations)-1].Apply = func(tx *sql.Tx) error {
					if err := migrateThreadstoreV9ToV10(tx); err != nil {
						return err
					}
					return injected
				}
			}
			db, err := sqliteutil.Open(path, spec)
			if db != nil {
				db.Close()
				t.Fatal("failed migration returned database")
			}
			if err == nil || (test.injectFailure && !errors.Is(err, injected)) {
				t.Fatalf("migration error=%v", err)
			}
			raw, err = sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			defer raw.Close()
			tx, err := raw.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = tx.Rollback() }()
			actual, err := inspectReviewedSchemaTx(tx)
			if err != nil {
				t.Fatal(err)
			}
			expected, err := reviewedProductSchemaContract(9)
			if err != nil {
				t.Fatal(err)
			}
			if err := compareReviewedSchemas(actual, expected); err != nil {
				t.Fatal(err)
			}
			var count int
			if err := tx.QueryRow(`SELECT COUNT(*) FROM ai_flower_execution_authority WHERE created_at_unix_ms = 12 AND user_email = 'user@example.test'`).Scan(&count); err != nil || count != 3 {
				t.Fatalf("lost historical records: %d %v", count, err)
			}
		})
	}
}

func TestExecutionPermissionMigrationRejectsDriftAndFutureVersionWithoutMutation(t *testing.T) {
	for _, mutation := range []string{
		`ALTER TABLE ai_flower_execution_authority ADD COLUMN shadow TEXT`,
		fmt.Sprintf(`PRAGMA user_version = %d`, threadstoreCurrentSchemaVersion+1),
	} {
		t.Run(mutation, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "threads.sqlite")
			createReviewedVersionDatabaseForTest(t, path, 9)
			seedV9ExecutionAuthorities(t, path)
			raw, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := raw.Exec(mutation); err != nil {
				t.Fatal(err)
			}
			if err := raw.Close(); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if store, err := Open(path); err == nil {
				store.Close()
				t.Fatal("accepted unsupported schema")
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatalf("unsupported schema changed: %v", err)
			}
		})
	}
}
