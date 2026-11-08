package registry

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func TestSourceBindingMigrationPreservesUnknownInstancesAtomically(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "commit", true: "rollback"}[fail], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "registry.sqlite")
			spec := registrySchemaSpec()
			spec.CurrentVersion = 6
			spec.MinimumVersion = 6
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
				return applyTemplateSourcesSchema(tx)
			}
			spec.Verify = func(tx *sql.Tx) error { return verifyRegistryVersion(tx, 6) }
			db, err := sqliteutil.Open(path, spec)
			if err != nil {
				t.Fatal(err)
			}
			r := &Registry{db: db}
			ctx := context.Background()
			_, err = db.Exec(`INSERT INTO managed_web_service_template_sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, "git_example", "owner/repo", 1, "main", "", strings.Repeat("a", 40), strings.Repeat("b", 64), "source_original", "example", "example", "host", 1, "Example", "Service", "en-US", 1, 2)
			if err != nil {
				t.Fatal(err)
			}
			service := ManagedService{ServiceID: "mws_old", TemplateID: "git_example", WorkspacePath: "/original", WorkspaceOwnership: "user_selected", RuntimeBindingJSON: `{"schema_version":2,"service_family_id":"example","deployment":"host","host":{"install_root":"instances/mws_old/install","data_root":"families/example/data","log_path":"instances/mws_old/logs/service.log"}}`, RuntimeBindingSHA256: strings.Repeat("c", 64), RuntimeIdentity: "original-runtime", ForwardID: "pf-old", RuntimeManifestJSON: "{}"}
			service.RuntimeBindingSHA256 = fmt.Sprintf("%x", sha256.Sum256([]byte(service.RuntimeBindingJSON)))
			if err := r.CreateManagedService(ctx, service, Forward{ForwardID: "pf-old", TargetURL: "http://127.0.0.1:1234"}); err != nil {
				t.Fatal(err)
			}
			db.Close()
			upgrade := registrySchemaSpec()
			if fail {
				upgrade.Migrations[5].Apply = func(tx *sql.Tx) error {
					if err := migrateRegistryV6ToV7(tx); err != nil {
						return err
					}
					return errors.New("injected migration failure")
				}
			}
			migrated, err := sqliteutil.Open(path, upgrade)
			if fail {
				if err == nil {
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
			want := 7
			if fail {
				want = 6
			}
			if version != want {
				t.Fatal("migration not atomic", version)
			}
			var identity, pathValue string
			if err := migrated.QueryRow(`SELECT runtime_identity,workspace_path FROM managed_web_services WHERE service_id='mws_old'`).Scan(&identity, &pathValue); err != nil || identity != "original-runtime" || pathValue != "/original" {
				t.Fatal("migration altered instance", err)
			}
			if !fail {
				r = &Registry{db: migrated}
				source, verified, err := r.GetServiceTemplateSource(ctx, "mws_old")
				if err != nil || source == nil || verified || source.Directory != "source_original" {
					t.Fatal("migration silently trusted unknown source", source, verified, err)
				}
			}
		})
	}
}
func TestAtomicMarketInstallRollsBackSourceWhenOperationFails(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	ctx := context.Background()
	source := ManagedTemplateSource{TemplateID: "git_example", Repository: "owner/repo", RepositoryID: 1, Ref: "main", CommitSHA: strings.Repeat("a", 40), SHA256: strings.Repeat("b", 64), Directory: "source_new", DocumentTemplateID: "example", DocumentFamilyID: "example", Deployment: "host", Revision: 1, Name: "Example", DefaultLocale: "en-US"}
	service := ManagedService{ServiceID: "mws_new", TemplateID: source.TemplateID, WorkspaceOwnership: "pending", RuntimeBindingJSON: `{"schema_version":2}`, RuntimeBindingSHA256: strings.Repeat("c", 64), ForwardID: "pf-new", RuntimeManifestJSON: "{}"}
	if _, err := r.db.Exec(`CREATE TRIGGER reject_market_operation BEFORE INSERT ON managed_web_service_operations BEGIN SELECT RAISE(ABORT,'receipt failed'); END`); err != nil {
		t.Fatal(err)
	}
	err = r.CreateManagedServiceFromSource(ctx, service, Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:1234"}, ManagedOperation{OperationID: "mop_new", ServiceID: service.ServiceID, RequestID: "new-install", Action: "install", State: "pending"}, source, "")
	if err == nil {
		t.Fatal("fault not injected")
	}
	for _, table := range []string{"managed_web_services", "port_forwards", "managed_web_service_template_sources", "managed_web_service_source_versions", "managed_web_service_source_bindings"} {
		var count int
		if err := r.db.QueryRow(`SELECT COUNT(1) FROM ` + table).Scan(&count); err != nil || count != 0 {
			t.Fatal("partial market transaction", table, count, err)
		}
	}
}

func TestRetainedSourcePreservesReviewedProfileWithoutTrustingCurrentIndex(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	ctx := context.Background()
	source := ManagedTemplateSource{TemplateID: "git_profile", Repository: "owner/templates", RepositoryID: 1, Ref: "main", Path: "templates/desktop", CommitSHA: strings.Repeat("a", 40), SHA256: strings.Repeat("b", 64), Directory: "source_reviewed", DocumentTemplateID: "desktop", DocumentFamilyID: "desktop", Deployment: "container", Revision: 1, Name: "Desktop", Description: "Reviewed desktop", DefaultLocale: "en-US", ReviewedRuntimeProfile: "interactive_desktop"}
	err = r.CommitManagedTemplateSource(ctx, source, "", ManagedTemplateRequest{RequestID: "profile-review", RequestFingerprint: "profile-review", TemplateID: source.TemplateID})
	if err != nil {
		t.Fatal(err)
	}
	retained, err := r.GetTemplateSourceVersion(ctx, source.TemplateID, source.SHA256)
	if err != nil || retained.ReviewedRuntimeProfile != source.ReviewedRuntimeProfile {
		t.Fatal("reviewed capability was not retained", err)
	}
	current, err := r.GetManagedTemplateSource(ctx, source.TemplateID)
	if err != nil || current.ReviewedRuntimeProfile != "" {
		t.Fatal("mutable index granted a capability", err)
	}
	source.SHA256 = strings.Repeat("c", 64)
	source.Directory = "source_new"
	source.Revision++
	source.ReviewedRuntimeProfile = ""
	if err = r.CommitManagedTemplateSource(ctx, source, retained.SHA256, ManagedTemplateRequest{RequestID: "new-source", RequestFingerprint: "new-source", TemplateID: source.TemplateID}); err != nil {
		t.Fatal(err)
	}
	next, _ := r.GetTemplateSourceVersion(ctx, source.TemplateID, source.SHA256)
	old, _ := r.GetTemplateSourceVersion(ctx, source.TemplateID, retained.SHA256)
	if next.ReviewedRuntimeProfile != "" || old.ReviewedRuntimeProfile != "interactive_desktop" {
		t.Fatal("capability crossed immutable source versions")
	}
}
