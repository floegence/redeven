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

func TestOpen_CreatesV2SchemaForFreshDB(t *testing.T) {
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
	if v != 2 {
		t.Fatalf("user_version = %d, want 2", v)
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
	if err := r.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != 2 {
		t.Fatalf("migrated version=%d, err=%v", version, err)
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
	if _, err := r.db.Exec(`PRAGMA user_version=3`); err != nil {
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
	if version != 3 || count != 1 {
		t.Fatalf("future database changed: version=%d forward_count=%d", version, count)
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
