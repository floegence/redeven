package registry

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"slices"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func TestOpen_CreatesV3SchemaForFreshDB(t *testing.T) {
	t.Parallel()

	p := filepath.Join(t.TempDir(), "registry.sqlite")
	r, err := Open(p)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	var v int
	if err := r.db.QueryRow(`PRAGMA user_version;`).Scan(&v); err != nil {
		t.Fatalf("PRAGMA user_version: %v", err)
	}
	if v != 3 {
		t.Fatalf("user_version = %d, want 3", v)
	}

	cols, err := tableColumns(r.db, "port_forwards")
	if err != nil {
		t.Fatalf("tableColumns: %v", err)
	}
	want := []string{
		"forward_id",
		"target_url",
		"name",
		"description",
		"health_path",
		"insecure_skip_verify",
		"created_at_unix_ms",
		"updated_at_unix_ms",
		"last_opened_at_unix_ms",
	}
	for _, c := range want {
		if !slices.Contains(cols, c) {
			t.Fatalf("missing column %q in %+v", c, cols)
		}
	}
}

func TestOpen_MigratesV1AndPreservesForwards(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV1TestSpec())
	if err != nil {
		t.Fatalf("create v1 registry: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO port_forwards(forward_id,target_url,name,description,health_path,insecure_skip_verify,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms) VALUES('keep','http://127.0.0.1:3000','Keep','','',0,1,2,3)`); err != nil {
		_ = db.Close()
		t.Fatalf("seed v1 forward: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	r, err := Open(p)
	if err != nil {
		t.Fatalf("migrate v1 registry: %v", err)
	}
	defer r.Close()
	forward, err := r.GetForward(context.Background(), "keep")
	if err != nil || forward == nil || forward.TargetURL != "http://127.0.0.1:3000" || forward.LastOpenedAtUnixMs != 3 {
		t.Fatalf("preserved forward = %+v, err=%v", forward, err)
	}
	var version int
	if err := r.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != 3 {
		t.Fatalf("migrated version=%d, err=%v", version, err)
	}
}

func TestOpen_MigratesV2AndPreservesManagedService(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV2TestSpec())
	if err != nil {
		t.Fatalf("create v2 registry: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO port_forwards(forward_id,target_url,name,description,health_path,insecure_skip_verify,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms) VALUES('pf_keep','http://127.0.0.1:3080','DeepSeek Harness','','',0,1,2,3)`); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO managed_web_services(service_id,template_id,deployment,workspace_path,version,desired_state,observed_state,forward_id,runtime_identity,runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms) VALUES('mws_keep','deepseek-harness','docker','/workspace','0.1.1-rc.2','running','stopped','pf_keep','container:one',3080,'image@sha256:one','','',4,5)`); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	r, err := Open(p)
	if err != nil {
		t.Fatalf("migrate v2 registry: %v", err)
	}
	defer r.Close()
	service, err := r.GetManagedService(context.Background(), "mws_keep")
	if err != nil {
		t.Fatal(err)
	}
	if service == nil || service.TemplateID != "deepseek-harness-container" || service.TemplateSource != "builtin" || service.TemplateRevision != 1 || service.ServiceFamilyID != "deepseek-harness" || service.ForwardID != "pf_keep" {
		t.Fatalf("migrated service = %+v", service)
	}
	forward, err := r.GetForward(context.Background(), "pf_keep")
	if err != nil || forward == nil || forward.LastOpenedAtUnixMs != 3 {
		t.Fatalf("migrated forward = %+v, err=%v", forward, err)
	}
}

func TestOpen_RejectsV1SchemaDriftWithoutPartialMigration(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV1TestSpec())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE port_forwards ADD COLUMN unexpected TEXT NOT NULL DEFAULT ''`); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO port_forwards(forward_id,target_url,name,description,health_path,insecure_skip_verify,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms,unexpected) VALUES('keep','http://127.0.0.1:3000','','','',0,1,1,0,'drift')`); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	if _, err := Open(p); err == nil {
		t.Fatal("Open accepted drifted v1 schema")
	}
	raw, err := sql.Open("sqlite", p)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var version, managedTables int
	var drift string
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := raw.QueryRow(`SELECT unexpected FROM port_forwards WHERE forward_id='keep'`).Scan(&drift); err != nil {
		t.Fatal(err)
	}
	if err := raw.QueryRow(`SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name LIKE 'managed_web_service%'`).Scan(&managedTables); err != nil {
		t.Fatal(err)
	}
	if version != 1 || drift != "drift" || managedTables != 0 {
		t.Fatalf("failed migration changed v1 database: version=%d drift=%q managed_tables=%d", version, drift, managedTables)
	}
}

func TestOpen_RejectsV2SchemaDriftWithoutPartialMigration(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV2TestSpec())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE managed_web_services ADD COLUMN unexpected TEXT NOT NULL DEFAULT ''`); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	if _, err := Open(p); err == nil {
		t.Fatal("Open accepted drifted v2 schema")
	}
	raw, err := sql.Open("sqlite", p)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var version, templateTables int
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := raw.QueryRow(`SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name IN ('managed_web_service_templates','managed_web_service_template_requests')`).Scan(&templateTables); err != nil {
		t.Fatal(err)
	}
	columns, err := tableColumns(raw, "managed_web_services")
	if err != nil {
		t.Fatal(err)
	}
	if version != 2 || templateTables != 0 || !slices.Contains(columns, "unexpected") {
		t.Fatalf("failed migration changed v2 database: version=%d template_tables=%d columns=%v", version, templateTables, columns)
	}
}

func TestOpen_RollsBackFailedV2ToV3Migration(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV2TestSpec())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO port_forwards(forward_id,target_url,name,description,health_path,insecure_skip_verify,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms) VALUES('pf_keep','http://127.0.0.1:3080','','','',0,1,2,3)`); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO managed_web_services(service_id,template_id,deployment,workspace_path,version,desired_state,observed_state,forward_id,runtime_identity,runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms) VALUES('mws_keep','deepseek-harness','native','/workspace','0.1.1-rc.2','running','stopped','pf_keep','',3080,'','','',4,5)`); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	spec := registrySchemaSpec()
	original := spec.Migrations[2].Apply
	spec.Migrations[2].Apply = func(tx *sql.Tx) error {
		if err := original(tx); err != nil {
			return err
		}
		return errors.New("injected migration failure")
	}
	if _, err := sqliteutil.Open(p, spec); err == nil {
		t.Fatal("migration unexpectedly succeeded")
	}
	raw, err := sql.Open("sqlite", p)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var version, services, templateTables int
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := raw.QueryRow(`SELECT COUNT(1) FROM managed_web_services WHERE service_id='mws_keep' AND template_id='deepseek-harness'`).Scan(&services); err != nil {
		t.Fatal(err)
	}
	if err := raw.QueryRow(`SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name IN ('managed_web_service_templates','managed_web_service_template_requests')`).Scan(&templateTables); err != nil {
		t.Fatal(err)
	}
	if version != 2 || services != 1 || templateTables != 0 {
		t.Fatalf("failed migration was not atomic: version=%d services=%d template_tables=%d", version, services, templateTables)
	}
}

func TestOpen_RejectsFutureVersionWithoutChangingIt(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	r, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.CreateForward(context.Background(), Forward{ForwardID: "keep", TargetURL: "http://127.0.0.1:3000"}); err != nil {
		_ = r.Close()
		t.Fatal(err)
	}
	if _, err := r.db.Exec(`PRAGMA user_version=4`); err != nil {
		_ = r.Close()
		t.Fatal(err)
	}
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(p); err == nil {
		t.Fatal("Open accepted future registry version")
	}
	raw, err := sql.Open("sqlite", p)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var version, count int
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := raw.QueryRow(`SELECT COUNT(1) FROM port_forwards WHERE forward_id='keep'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if version != 4 || count != 1 {
		t.Fatalf("future database changed: version=%d forward_count=%d", version, count)
	}
}

func TestRegistry_ManagedTemplateCRUDAndDuplicateSource(t *testing.T) {
	t.Parallel()
	r, err := Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = r.Close() })
	ctx := context.Background()
	template := ManagedTemplate{
		TemplateID: "tmpl_source", Name: "Source", Description: "A host service", Source: "custom", Deployment: "host", Version: "1.0.0", Revision: 1,
		SpecJSON: `{"kind":"host"}`, SpecSHA256: "source-hash", ServiceFamilyID: "family_source",
	}
	if err := r.CreateManagedTemplate(ctx, template); err != nil {
		t.Fatalf("CreateManagedTemplate: %v", err)
	}
	template.Name, template.Description, template.Revision, template.SpecJSON, template.SpecSHA256 = "Source updated", "Updated", 2, `{"kind":"host","start":"serve"}`, "updated-hash"
	if err := r.UpdateManagedTemplate(ctx, template); err != nil {
		t.Fatalf("UpdateManagedTemplate: %v", err)
	}
	duplicate := ManagedTemplate{
		TemplateID: "tmpl_copy", Name: "Source copy", Description: template.Description, Source: "custom", Deployment: template.Deployment, Version: template.Version, Revision: 1,
		SpecJSON: template.SpecJSON, SpecSHA256: template.SpecSHA256, DerivedFromTemplateID: template.TemplateID, DerivedFromRevision: template.Revision, ServiceFamilyID: "family_copy",
	}
	if err := r.CreateManagedTemplate(ctx, duplicate); err != nil {
		t.Fatalf("Create duplicate template: %v", err)
	}
	got, err := r.GetManagedTemplate(ctx, duplicate.TemplateID)
	if err != nil || got == nil || got.DerivedFromTemplateID != template.TemplateID || got.DerivedFromRevision != 2 || got.ServiceFamilyID == template.ServiceFamilyID {
		t.Fatalf("duplicate = %+v, err=%v", got, err)
	}
	items, err := r.ListManagedTemplates(ctx)
	if err != nil || len(items) != 2 || items[0].Name != "Source copy" || items[1].Name != "Source updated" {
		t.Fatalf("templates = %+v, err=%v", items, err)
	}
	if err := r.DeleteManagedTemplate(ctx, template.TemplateID); err != nil {
		t.Fatalf("DeleteManagedTemplate: %v", err)
	}
	if got, err := r.GetManagedTemplate(ctx, template.TemplateID); err != nil || got != nil {
		t.Fatalf("template after delete = %+v, err=%v", got, err)
	}
}

func TestRegistry_CRUD(t *testing.T) {
	t.Parallel()

	p := filepath.Join(t.TempDir(), "registry.sqlite")
	r, err := Open(p)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	ctx := context.Background()

	if err := r.CreateForward(ctx, Forward{
		ForwardID:          "f1",
		TargetURL:          "http://127.0.0.1:3000",
		Name:               "Demo",
		Description:        "demo forward",
		HealthPath:         "",
		InsecureSkipVerify: false,
	}); err != nil {
		t.Fatalf("CreateForward: %v", err)
	}

	f, err := r.GetForward(ctx, "f1")
	if err != nil {
		t.Fatalf("GetForward: %v", err)
	}
	if f == nil {
		t.Fatalf("GetForward returned nil")
	}
	if f.ForwardID != "f1" || f.TargetURL != "http://127.0.0.1:3000" {
		t.Fatalf("unexpected forward: %+v", *f)
	}
	if f.CreatedAtUnixMs <= 0 || f.UpdatedAtUnixMs <= 0 {
		t.Fatalf("expected timestamps to be set: %+v", *f)
	}

	// Update meta.
	newName := "Demo 2"
	if err := r.UpdateForward(ctx, "f1", UpdateForwardPatch{
		Name:            &newName,
		UpdatedAtUnixMs: 0,
	}); err != nil {
		t.Fatalf("UpdateForward: %v", err)
	}

	updated, err := r.GetForward(ctx, "f1")
	if err != nil {
		t.Fatalf("GetForward(updated): %v", err)
	}
	if updated == nil || updated.Name != newName {
		t.Fatalf("unexpected updated forward: %+v", updated)
	}

	// Touch last opened.
	if err := r.TouchLastOpened(ctx, "f1"); err != nil {
		t.Fatalf("TouchLastOpened: %v", err)
	}
	touched, err := r.GetForward(ctx, "f1")
	if err != nil {
		t.Fatalf("GetForward(touched): %v", err)
	}
	if touched == nil || touched.LastOpenedAtUnixMs <= 0 {
		t.Fatalf("expected last_opened_at_unix_ms to be set: %+v", touched)
	}

	// List.
	list, err := r.ListForwards(ctx)
	if err != nil {
		t.Fatalf("ListForwards: %v", err)
	}
	if len(list) != 1 || list[0].ForwardID != "f1" {
		t.Fatalf("unexpected list: %+v", list)
	}

	// Delete.
	if err := r.DeleteForward(ctx, "f1"); err != nil {
		t.Fatalf("DeleteForward: %v", err)
	}
	after, err := r.GetForward(ctx, "f1")
	if err != nil {
		t.Fatalf("GetForward(after delete): %v", err)
	}
	if after != nil {
		t.Fatalf("expected deleted forward to be nil, got %+v", after)
	}
}

func TestRegistry_MissingMutationsReturnNotFound(t *testing.T) {
	t.Parallel()

	p := filepath.Join(t.TempDir(), "registry.sqlite")
	r, err := Open(p)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	ctx := context.Background()
	name := "Missing"
	if err := r.UpdateForward(ctx, "missing", UpdateForwardPatch{Name: &name}); !errors.Is(err, ErrForwardNotFound) {
		t.Fatalf("UpdateForward error = %v, want ErrForwardNotFound", err)
	}
	if err := r.TouchLastOpened(ctx, "missing"); !errors.Is(err, ErrForwardNotFound) {
		t.Fatalf("TouchLastOpened error = %v, want ErrForwardNotFound", err)
	}
	if err := r.DeleteForward(ctx, "missing"); !errors.Is(err, ErrForwardNotFound) {
		t.Fatalf("DeleteForward error = %v, want ErrForwardNotFound", err)
	}
}

func TestRegistry_ManagedServiceProtectsForwardAndDeletesAtomically(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	r, err := Open(p)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })
	service := ManagedService{ServiceID: "mws_one", TemplateID: "deepseek-harness", Deployment: "native", WorkspacePath: "/workspace", Version: "0.1.1-rc.2", DesiredState: "running", ObservedState: "running", ForwardID: "pf_one", RuntimePort: 3080}
	forward := Forward{ForwardID: "pf_one", TargetURL: "http://127.0.0.1:3080", Name: "DeepSeek Harness"}
	if err := r.CreateManagedService(context.Background(), service, forward); err != nil {
		t.Fatalf("CreateManagedService: %v", err)
	}
	if err := r.DeleteForward(context.Background(), "pf_one"); !errors.Is(err, ErrManagedForward) {
		t.Fatalf("DeleteForward error = %v, want ErrManagedForward", err)
	}
	op := ManagedOperation{OperationID: "mop_one", ServiceID: "mws_one", RequestID: "request-one", RequestFingerprint: "fingerprint", Action: "uninstall", State: "running", Stage: "uninstalling"}
	if err := r.CreateManagedOperation(context.Background(), op); err != nil {
		t.Fatalf("CreateManagedOperation: %v", err)
	}
	op.State, op.Stage, op.ProgressCurrent, op.ProgressTotal, op.FinishedAtUnixMs = "succeeded", "completed", 7, 7, 10
	if err := r.CompleteManagedServiceUninstall(context.Background(), "mws_one", op); err != nil {
		t.Fatalf("CompleteManagedServiceUninstall: %v", err)
	}
	forwardAfter, err := r.GetForward(context.Background(), "pf_one")
	if err != nil {
		t.Fatalf("GetForward: %v", err)
	}
	if forwardAfter != nil {
		t.Fatalf("managed forward survived uninstall: %+v", forwardAfter)
	}
	opAfter, err := r.GetManagedOperation(context.Background(), "mop_one")
	if err != nil {
		t.Fatalf("GetManagedOperation: %v", err)
	}
	if opAfter == nil || opAfter.State != "succeeded" || opAfter.Stage != "completed" {
		t.Fatalf("managed operation history after uninstall = %+v", opAfter)
	}
}

func TestRegistry_CreateManagedServiceWithOperationRollsBackTogether(t *testing.T) {
	t.Parallel()
	r, err := Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	existing := ManagedOperation{OperationID: "mop_existing", ServiceID: "removed_service", RequestID: "request-existing", RequestFingerprint: "fingerprint", Action: "uninstall", State: "succeeded", Stage: "completed"}
	if err := r.CreateManagedOperation(context.Background(), existing); err != nil {
		t.Fatalf("CreateManagedOperation: %v", err)
	}
	service := ManagedService{ServiceID: "mws_atomic", TemplateID: "deepseek-harness", Deployment: "native", WorkspacePath: "/workspace", Version: "0.1.1-rc.2", DesiredState: "running", ObservedState: "installing", ForwardID: "pf_atomic", RuntimePort: 3080}
	forward := Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:3080"}
	conflicting := existing
	conflicting.OperationID = "mop_atomic"
	conflicting.ServiceID = service.ServiceID
	if err := r.CreateManagedServiceWithOperation(context.Background(), service, forward, conflicting); err == nil {
		t.Fatal("CreateManagedServiceWithOperation unexpectedly accepted a duplicate request_id")
	}
	if got, err := r.GetManagedService(context.Background(), service.ServiceID); err != nil || got != nil {
		t.Fatalf("service after rollback = %+v, err=%v", got, err)
	}
	if got, err := r.GetForward(context.Background(), forward.ForwardID); err != nil || got != nil {
		t.Fatalf("forward after rollback = %+v, err=%v", got, err)
	}
}

func registryV1TestSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           registrySchemaKind,
		CurrentVersion: 1,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA foreign_keys=ON;`},
		Migrations:     []sqliteutil.Migration{{FromVersion: 0, ToVersion: 1, Apply: migrateRegistryToV1}},
		Verify: func(tx *sql.Tx) error {
			tables, err := sqliteutil.ListUserTablesTx(tx)
			if err != nil {
				return err
			}
			if !slices.Equal(tables, []string{"port_forwards"}) {
				return errors.New("unexpected v1 table set")
			}
			return nil
		},
	}
}

func registryV2TestSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           registrySchemaKind,
		CurrentVersion: 2,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA foreign_keys=ON;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: migrateRegistryToV1},
			{FromVersion: 1, ToVersion: 2, Apply: migrateRegistryToV2},
		},
		Verify: func(tx *sql.Tx) error {
			tables, err := sqliteutil.ListUserTablesTx(tx)
			if err != nil {
				return err
			}
			if !slices.Equal(tables, []string{"managed_web_service_operations", "managed_web_services", "port_forwards"}) {
				return errors.New("unexpected v2 table set")
			}
			return nil
		},
	}
}

func tableColumns(db *sql.DB, table string) ([]string, error) {
	rows, err := db.Query(`PRAGMA table_info(` + table + `);`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cols []string
	for rows.Next() {
		var (
			cid        int
			name       string
			typ        string
			notnull    int
			dfltValue  any
			primaryKey int
		)
		if err := rows.Scan(&cid, &name, &typ, &notnull, &dfltValue, &primaryKey); err != nil {
			return nil, err
		}
		cols = append(cols, name)
	}
	return cols, rows.Err()
}
