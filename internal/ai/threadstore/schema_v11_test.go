package threadstore

import (
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func TestConversationPreferencesV11MigrationPreservesSettingsAndRollsBack(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "preserves", true: "rollback"}[fail], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "product.sqlite")
			createReviewedVersionDatabaseForTest(t, path, 10)
			raw, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := raw.Exec(`INSERT INTO ai_thread_settings(thread_id, endpoint_id, namespace_public_id, model_id, permission_type, working_dir, settings_created_at_unix_ms, settings_updated_at_unix_ms) VALUES('kept', 'env', 'ns', 'provider/kept', 'readonly', '/kept', 10, 11)`); err != nil {
				t.Fatal(err)
			}
			_ = raw.Close()
			spec := threadstoreSchemaSpec()
			injected := errors.New("injected v11 migration failure")
			if fail {
				for i, migration := range spec.Migrations {
					if migration.FromVersion == 10 {
						spec.Migrations[i].Apply = func(tx *sql.Tx) error {
							if err := migrateThreadstoreV10ToV11(tx); err != nil {
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
				if err := verifyProductSchemaVersion(tx, 10); err != nil {
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

func TestConversationPreferencesConcurrentWritersHaveOneWinner(t *testing.T) {
	path := filepath.Join(t.TempDir(), "product.sqlite")
	first, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	scope := ConversationPreferenceScope{NamespacePublicID: "ns", EndpointID: "env", UserPublicID: "alice"}
	start := make(chan struct{})
	results := make(chan error, 2)
	for i, store := range []*Store{first, second} {
		go func(i int, store *Store) {
			<-start
			model := []string{"provider/a", "provider/b"}[i]
			_, err := store.PatchConversationPreferences(t.Context(), scope, ConversationPreferencePatch{ExpectedRevision: 0, ModelID: &model})
			results <- err
		}(i, store)
	}
	close(start)
	successes, conflicts := 0, 0
	for i := 0; i < 2; i++ {
		err := <-results
		if err == nil {
			successes++
		} else if errors.Is(err, ErrConversationPreferenceConflict) {
			conflicts++
		} else {
			t.Fatalf("unexpected write error=%v", err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("success=%d conflict=%d", successes, conflicts)
	}
	got, err := first.GetConversationPreferences(t.Context(), scope)
	if err != nil || got.Revision != 1 {
		t.Fatalf("concurrent revision=%+v %v", got, err)
	}
}
