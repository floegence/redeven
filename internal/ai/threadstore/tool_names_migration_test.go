package threadstore

import (
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/floegence/redeven/internal/persistence/sqliteutil"
	"path/filepath"
	"testing"
)

func TestToolNameMigrationPreservesExactNonTargetConfiguration(t *testing.T) {
	raw := `{"Model":"terminal.exec","Options":{"tool_allowlist":["terminal.exec","read_file","plugin.custom"],"description":"read_file","max_output_tokens":123},"Other":{"name":"ask_user"}}`
	out, err := migrateToolAllowlist(raw)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	_ = json.Unmarshal([]byte(out), &got)
	opts := got["Options"].(map[string]any)
	names := opts["tool_allowlist"].([]any)
	if names[0] != "terminal_exec" || names[1] != "file_read" || names[2] != "plugin.custom" || got["Model"] != "terminal.exec" || opts["description"] != "read_file" {
		t.Fatalf("changed unrelated content: %s", out)
	}
	again, err := migrateToolAllowlist(out)
	if err != nil || again != out {
		t.Fatal("migration not idempotent", err)
	}
	for _, bad := range []string{`null`, `{`, `{"Options":{"tool_allowlist":[1]}}`} {
		if _, err := migrateToolAllowlist(bad); err == nil {
			t.Fatalf("accepted %s", bad)
		}
	}
}

func TestToolNameMigrationStartupAndRollback(t *testing.T) {
	for _, invalid := range []bool{false, true} {
		t.Run(map[bool]string{false: "valid", true: "invalid"}[invalid], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "threads.sqlite")
			db := createReviewedSchemaDatabaseForTest(t, path)
			raw := `{"Options":{"tool_allowlist":["terminal.exec","ask_user"]},"keep":"terminal.exec"}`
			if invalid {
				raw = `{"Options":{"tool_allowlist":[1]}}`
			}
			_, err := db.Exec(`INSERT INTO ai_flower_execution_authority(request_key,thread_id,endpoint_id,user_public_id,permission_type,execution_config_json,created_at_unix_ms) VALUES('key','thread','env','user','readonly',?,1)`, raw)
			if err != nil {
				t.Fatal(err)
			}
			_, err = db.Exec("PRAGMA user_version = 12")
			if err != nil {
				t.Fatal(err)
			}
			store, err := Open(path)
			if invalid {
				if err == nil {
					store.Close()
					t.Fatal("invalid migration succeeded")
				}
				var version int
				var saved string
				_ = db.QueryRow("PRAGMA user_version").Scan(&version)
				_ = db.QueryRow("SELECT execution_config_json FROM ai_flower_execution_authority").Scan(&saved)
				if version != 12 || saved != raw {
					t.Fatal("failed migration changed source")
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				a, err := store.GetExecutionAuthority(t.Context(), "key")
				if err != nil {
					t.Fatal(err)
				}
				want, _ := migrateToolAllowlist(raw)
				if a.ExecutionConfigJSON != want {
					t.Fatalf("got %s", a.ExecutionConfigJSON)
				}
				store.Close()
				store, err = Open(path)
				if err != nil {
					t.Fatal(err)
				}
				store.Close()
			}
			db.Close()
		})
	}
}

func TestToolNameMigrationRollsBackAfterWrites(t *testing.T) {
	for _, mode := range []string{"error", "panic", "write_failure"} {
		t.Run(mode, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "threads.sqlite")
			createReviewedVersionDatabaseForTest(t, path, 12)
			raw, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			defer raw.Close()
			const source = `{"Options":{"tool_allowlist":["read_file"]}}`
			if _, err := raw.Exec(`INSERT INTO ai_flower_execution_authority(request_key,thread_id,endpoint_id,user_public_id,permission_type,execution_config_json,created_at_unix_ms) VALUES('key','thread','env','user','readonly',?,1)`, source); err != nil {
				t.Fatal(err)
			}
			spec := threadstoreSchemaSpec()
			injected := errors.New("injected after migration")
			for i := range spec.Migrations {
				if spec.Migrations[i].FromVersion == 12 {
					spec.Migrations[i].Apply = func(tx *sql.Tx) error {
						if err := migrateThreadstoreV12ToV13(tx); err != nil {
							return err
						}
						if mode == "panic" {
							panic(injected)
						}
						if mode == "write_failure" {
							_, err := tx.Exec(`UPDATE ai_flower_execution_authority SET endpoint_id = NULL`)
							return err
						}
						return injected
					}
				}
			}
			func() {
				defer func() {
					if value := recover(); value != nil && mode != "panic" {
						t.Fatalf("unexpected panic: %v", value)
					}
				}()
				db, err := sqliteutil.Open(path, spec)
				if db != nil {
					db.Close()
				}
				if err == nil {
					t.Fatal("injected failure succeeded")
				}
			}()
			var version int
			var saved string
			if err := raw.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
				t.Fatal(err)
			}
			if err := raw.QueryRow("SELECT execution_config_json FROM ai_flower_execution_authority WHERE request_key = 'key'").Scan(&saved); err != nil {
				t.Fatal(err)
			}
			if version != 12 || saved != source {
				t.Fatalf("partial migration: version=%d data=%s", version, saved)
			}
			store, err := Open(path)
			if err != nil {
				t.Fatal(err)
			}
			store.Close()
		})
	}
}
