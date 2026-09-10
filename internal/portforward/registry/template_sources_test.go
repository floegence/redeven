package registry

import (
	"context"
	"database/sql"
	"errors"
	"github.com/floegence/redeven/internal/persistence/sqliteutil"
	"path/filepath"
	"strings"
	"testing"
)

func TestTemplateSourcesMigrationPreservesV4AndRollsBack(t *testing.T) {
	for _, rollback := range []bool{false, true} {
		t.Run(map[bool]string{false: "upgrade", true: "rollback"}[rollback], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "registry.sqlite")
			db, err := sqliteutil.Open(path, sqliteutil.Spec{Kind: registrySchemaKind, CurrentVersion: 4, MinimumVersion: 4, Initialize: func(tx *sql.Tx) error {
				if err := initializeRegistryV1(tx); err != nil {
					return err
				}
				if _, err := tx.Exec(addDefaultAppPath); err != nil {
					return err
				}
				return applyManagementSchema(tx)
			}, Verify: func(tx *sql.Tx) error { return verifyRegistryVersion(tx, 4) }})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`INSERT INTO port_forwards(forward_id,target_url,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms) VALUES('retained','http://127.0.0.1:3080',1,1,0)`); err != nil {
				t.Fatal(err)
			}
			db.Close()
			spec := registrySchemaSpec()
			if spec.CurrentVersion != 5 {
				t.Fatal("source migration must append version 5")
			}
			if rollback {
				spec.Migrations[len(spec.Migrations)-1].Apply = func(tx *sql.Tx) error {
					if err := applyTemplateSourcesSchema(tx); err != nil {
						return err
					}
					return errors.New("injected source migration failure")
				}
			}
			next, err := sqliteutil.Open(path, spec)
			if rollback {
				if err == nil {
					next.Close()
					t.Fatal("failed migration committed")
				}
				next, err = sql.Open("sqlite", path)
			}
			if err != nil {
				t.Fatal(err)
			}
			defer next.Close()
			tx, _ := next.Begin()
			defer func() { _ = tx.Rollback() }()
			version := 5
			if rollback {
				version = 4
			}
			if err := verifyRegistryVersion(tx, version); err != nil {
				t.Fatal(err)
			}
			var target string
			if err := tx.QueryRow(`SELECT target_url FROM port_forwards WHERE forward_id='retained'`).Scan(&target); err != nil || target != "http://127.0.0.1:3080" {
				t.Fatal("user record changed", err)
			}
		})
	}
}

func TestTemplateSourceCommitIsAtomicAndIdempotent(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	ctx := context.Background()
	source := ManagedTemplateSource{TemplateID: "git_example", Repository: "owner/repo", RepositoryID: 1, Ref: "develop", Path: "templates/example", CommitSHA: strings.Repeat("a", 40), SHA256: strings.Repeat("b", 64), Directory: "source_example", DocumentTemplateID: "example", DocumentFamilyID: "example", Deployment: "host", Revision: 1, Name: "Example", DefaultLocale: "en-US"}
	req := ManagedTemplateRequest{RequestID: "source-request", RequestFingerprint: "fingerprint", TemplateID: source.TemplateID, Action: "source-confirm"}
	if err := r.CommitManagedTemplateSource(ctx, source, "", req); err != nil {
		t.Fatal(err)
	}
	if err := r.CommitManagedTemplateSource(ctx, source, "", req); err != nil {
		t.Fatal("retry was not idempotent", err)
	}
	source.Directory = "source_changed"
	source.SHA256 = strings.Repeat("c", 64)
	req.RequestID = "stale-request"
	if err := r.CommitManagedTemplateSource(ctx, source, "wrong", req); !errors.Is(err, ErrManagedTemplateSourceChanged) {
		t.Fatal("stale confirmation accepted", err)
	}
	current, err := r.GetManagedTemplateSource(ctx, source.TemplateID)
	if err != nil || current.Directory != "source_example" {
		t.Fatal("failed commit changed active source", err)
	}
	if row, _ := r.GetManagedTemplateRequest(ctx, req.RequestID); row != nil {
		t.Fatal("failed commit left a receipt")
	}
	if row, _ := r.GetManagedTemplate(ctx, source.TemplateID); row != nil {
		t.Fatal("source import persisted an execution projection")
	}
}

func TestTemplateSourceCommitRollsBackWhenReceiptFails(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	ctx := context.Background()
	source := ManagedTemplateSource{TemplateID: "git_example", Repository: "owner/repo", RepositoryID: 1, Ref: "develop", CommitSHA: strings.Repeat("a", 40), SHA256: strings.Repeat("b", 64), Directory: "source_original", DocumentTemplateID: "example", DocumentFamilyID: "example", Deployment: "host", Revision: 1, Name: "Example", DefaultLocale: "en-US"}
	if err := r.CommitManagedTemplateSource(ctx, source, "", ManagedTemplateRequest{RequestID: "source-initial", RequestFingerprint: "initial", TemplateID: source.TemplateID}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.db.Exec(`CREATE TRIGGER reject_source_receipt BEFORE INSERT ON managed_web_service_template_requests BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END`); err != nil {
		t.Fatal(err)
	}
	source.Directory = "source_candidate"
	source.SHA256 = strings.Repeat("c", 64)
	if err := r.CommitManagedTemplateSource(ctx, source, strings.Repeat("b", 64), ManagedTemplateRequest{RequestID: "source-failed", RequestFingerprint: "failed", TemplateID: source.TemplateID}); err == nil {
		t.Fatal("receipt failure committed the candidate")
	}
	current, err := r.GetManagedTemplateSource(ctx, source.TemplateID)
	if err != nil || current.Directory != "source_original" || current.SHA256 != strings.Repeat("b", 64) {
		t.Fatal("partial source transaction escaped rollback", err)
	}
	if receipt, _ := r.GetManagedTemplateRequest(ctx, "source-failed"); receipt != nil {
		t.Fatal("failed transaction left an idempotency receipt")
	}
}
