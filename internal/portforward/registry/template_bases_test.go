package registry

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func TestPersonalTemplateBaseMigrationIsAtomic(t *testing.T) {
	for _, rollback := range []bool{false, true} {
		t.Run(map[bool]string{false: "commit", true: "rollback"}[rollback], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "registry.sqlite")
			spec := registrySchemaSpec()
			spec.CurrentVersion = 7
			spec.MinimumVersion = 7
			spec.Migrations = nil
			spec.Initialize = func(tx *sql.Tx) error {
				if err := initializeRegistryV1(tx); err != nil {
					return err
				}
				if _, err := tx.Exec(addDefaultAppPath); err != nil {
					return err
				}
				if err := applyManagementSchema(tx); err != nil {
					return err
				}
				if err := applyTemplateSourcesSchema(tx); err != nil {
					return err
				}
				return applyTemplateVersionsSchema(tx)
			}
			spec.Verify = func(tx *sql.Tx) error { return verifyRegistryVersion(tx, 7) }
			db, err := sqliteutil.Open(path, spec)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`INSERT INTO port_forwards(forward_id,target_url,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms) VALUES('retained','http://127.0.0.1:3080',1,1,0)`); err != nil {
				t.Fatal(err)
			}
			db.Close()
			upgrade := registrySchemaSpec()
			if rollback {
				upgrade.Migrations[6].Apply = func(tx *sql.Tx) error {
					if err := migrateRegistryV7ToV8(tx); err != nil {
						return err
					}
					return errors.New("injected base migration failure")
				}
			}
			migrated, err := sqliteutil.Open(path, upgrade)
			if rollback {
				if err == nil {
					migrated.Close()
					t.Fatal("failed migration committed")
				}
				migrated, err = sql.Open("sqlite", path)
			}
			if err != nil {
				t.Fatal(err)
			}
			defer migrated.Close()
			var version int
			migrated.QueryRow(`PRAGMA user_version`).Scan(&version)
			want := 8
			if rollback {
				want = 7
			}
			if version != want {
				t.Fatal("migration version", version)
			}
			tx, _ := migrated.Begin()
			defer tx.Rollback()
			if err := verifyRegistryVersion(tx, want); err != nil {
				t.Fatal(err)
			}
			var target string
			if err := tx.QueryRow(`SELECT target_url FROM port_forwards WHERE forward_id='retained'`).Scan(&target); err != nil || target != "http://127.0.0.1:3080" {
				t.Fatal("migration changed user record", err)
			}
		})
	}
}
func TestPersonalTemplateBaseReceiptFailureRollsBackEverything(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if _, err := r.db.Exec(`CREATE TRIGGER reject_personal_receipt BEFORE INSERT ON managed_web_service_template_requests BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END`); err != nil {
		t.Fatal(err)
	}
	source := ManagedTemplateSource{TemplateID: "git_example", Repository: "owner/repo", RepositoryID: 1, Ref: "main", CommitSHA: strings.Repeat("a", 40), SHA256: strings.Repeat("b", 64), Directory: "source_personal", DocumentTemplateID: "example", DocumentFamilyID: "example", Deployment: "host", Revision: 1, Name: "Example", DefaultLocale: "en-US"}
	value := ManagedTemplate{TemplateID: "tmpl_personal", Name: "Personal", Source: "custom", Deployment: "host", Revision: 1, SpecJSON: "{}", ServiceFamilyID: "family_personal"}
	req := ManagedTemplateRequest{RequestID: "personal-request", RequestFingerprint: "personal", TemplateID: value.TemplateID, Action: "duplicate"}
	if err := r.CreateManagedTemplateWithBase(context.Background(), value, req, &source); err == nil {
		t.Fatal("receipt failure accepted")
	}
	for _, table := range []string{"managed_web_service_templates", "managed_web_service_source_versions", "managed_web_service_template_bases", "managed_web_service_template_requests"} {
		var count int
		if err := r.db.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&count); err != nil || count != 0 {
			t.Fatal("partial personal copy", table, count, err)
		}
	}
}
