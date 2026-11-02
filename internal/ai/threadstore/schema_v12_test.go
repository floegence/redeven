package threadstore

import (
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func TestExecutionConfigurationV12MigrationPreservesSettingsAndRollsBack(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "preserves", true: "rollback"}[fail], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "product.sqlite")
			createReviewedVersionDatabaseForTest(t, path, 11)
			raw, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := raw.Exec(`INSERT INTO ai_thread_settings(thread_id, endpoint_id, namespace_public_id, model_id, permission_type, working_dir, settings_created_at_unix_ms, settings_updated_at_unix_ms) VALUES('kept', 'env', 'ns', 'provider/kept', 'readonly', '/kept', 10, 11)`); err != nil {
				t.Fatal(err)
			}
			_ = raw.Close()
			spec := threadstoreSchemaSpec()
			injected := errors.New("injected v12 migration failure")
			if fail {
				for i, migration := range spec.Migrations {
					if migration.FromVersion == 11 {
						spec.Migrations[i].Apply = func(tx *sql.Tx) error {
							if err := migrateThreadstoreV11ToV12(tx); err != nil {
								return err
							}
							return injected
						}
					}
				}
			}
			db, err := sqliteutil.Open(path, spec)
			if fail {
				if db != nil {
					db.Close()
					t.Fatal("failed migration returned database")
				}
				if !errors.Is(err, injected) {
					t.Fatalf("failure=%v", err)
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
				defer tx.Rollback()
				if err := verifyProductSchemaVersion(tx, 11); err != nil {
					t.Fatal(err)
				}
				var model string
				if err := tx.QueryRow(`SELECT model_id FROM ai_thread_settings WHERE thread_id = 'kept'`).Scan(&model); err != nil || model != "provider/kept" {
					t.Fatalf("rollback data=%q %v", model, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			_ = db.Close()
			for attempt := 0; attempt < 2; attempt++ {
				store, err := Open(path)
				if err != nil {
					t.Fatal(err)
				}
				settings, err := store.GetThreadSettings(t.Context(), "env", "kept")
				if err != nil || settings.ModelID != "provider/kept" || settings.WorkingDir != "/kept" || settings.SettingsUpdatedAtUnixMs != 11 {
					t.Fatalf("changed historical settings: %+v %v", settings, err)
				}
				prefs, err := store.GetConversationPreferences(t.Context(), ConversationPreferenceScope{NamespacePublicID: "ns", EndpointID: "env", UserPublicID: "alice"})
				if err != nil || prefs.Revision != 0 || prefs.ModelID != "" {
					t.Fatalf("inferred preference from historical thread: %+v %v", prefs, err)
				}
				_ = store.Close()
			}
		})
	}
}
