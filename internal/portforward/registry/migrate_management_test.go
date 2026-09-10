package registry

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func TestManagementMigrationV3PreservesDocumentsAndAllowsArchivedTemplate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(path, sqliteutil.Spec{Kind: registrySchemaKind, CurrentVersion: 3, MinimumVersion: 3, Initialize: func(tx *sql.Tx) error {
		if err := initializeRegistryV1(tx); err != nil {
			return err
		}
		_, err := tx.Exec(addDefaultAppPath)
		return err
	}, Verify: verifyRegistryV3})
	if err != nil {
		t.Fatal(err)
	}
	old := &Registry{db: db}
	binding := `{"schema_version":2,"service_family_id":"family-retained","deployment":"host","host":{"install_root":"instances/mws_retained/install","data_root":"families/family-retained/data","log_path":"instances/mws_retained/logs/service.log"}}`
	service := ManagedService{ServiceID: "mws_retained", TemplateID: "retained", WorkspacePath: "/retained", WorkspaceOwnership: "user_selected", RuntimeBindingJSON: binding, RuntimeBindingSHA256: digest(binding), ForwardID: "pf-retained", DesiredState: "running", ObservedState: "unknown", RuntimeIdentity: "saved-identity", RuntimeManifestJSON: "{}"}
	if err := old.CreateManagedService(context.Background(), service, Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:38001"}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO managed_web_service_resources(service_id,resource_id,kind,engine_identity,created_at_unix_ms) VALUES(?,?,?,?,?)`, service.ServiceID, "data", "volume", "legacy-name", 123); err != nil {
		t.Fatal(err)
	}
	if err := old.Close(); err != nil {
		t.Fatal(err)
	}
	current, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer current.Close()
	stored, err := current.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	resources, err := current.ListManagedServiceResources(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.RuntimeBindingJSON != binding || stored.RuntimeIdentity != service.RuntimeIdentity || stored.ManagementState != "active" || resources[0].EngineIdentity != "legacy-name" || resources[0].Ownership != "unverified" {
		t.Fatalf("migration changed binding or claimed legacy data: %+v %+v", stored, resources)
	}
	requestCtx, release, err := current.ForwardAccessContext(context.Background(), stored.ForwardID)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if err := current.ArchiveManagedService(context.Background(), *stored, "detached"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-requestCtx.Done():
	case <-time.After(time.Second):
		t.Fatal("detaching left an authorized proxy stream alive")
	}
	archived, err := current.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	var forward Forward
	if err := json.Unmarshal([]byte(archived.ArchivedForwardJSON), &forward); err != nil || forward.TargetURL != "http://127.0.0.1:38001" {
		t.Fatalf("saved route=%+v %v", forward, err)
	}
	next := service
	next.ServiceID = "mws_next"
	next.ForwardID = "pf-next"
	next.RuntimeBindingJSON = `{"schema_version":2,"service_family_id":"family-retained","deployment":"container","container":{"name":"redeven-mws-next"}}`
	next.RuntimeBindingSHA256 = digest(next.RuntimeBindingJSON)
	if err := current.CreateManagedService(context.Background(), next, Forward{ForwardID: next.ForwardID, TargetURL: "http://127.0.0.1:38002"}); err != nil {
		t.Fatal("archive blocked a new active installation", err)
	}
	forward.ForwardID = "pf-restored"
	if err := current.ActivateManagedService(context.Background(), *archived, forward); err == nil {
		t.Fatal("restore replaced another active instance")
	}
	if leaked, _ := current.GetForward(context.Background(), forward.ForwardID); leaked != nil {
		t.Fatal("failed restore leaked a route")
	}
}

func TestManagementMigrationRejectsDriftWithoutChanges(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(path, sqliteutil.Spec{Kind: registrySchemaKind, CurrentVersion: 3, MinimumVersion: 3, Initialize: func(tx *sql.Tx) error {
		if err := initializeRegistryV1(tx); err != nil {
			return err
		}
		_, err := tx.Exec(addDefaultAppPath)
		return err
	}, Verify: verifyRegistryV3})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TRIGGER reject_new_management BEFORE INSERT ON port_forwards BEGIN SELECT RAISE(ABORT,'fixture'); END`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if r, err := Open(path); err == nil {
		r.Close()
		t.Fatal("drifted schema was accepted")
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("rejected drift changed the database")
	}
}

func TestManagementMigrationFailureRollsBackRebuiltTables(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(path, sqliteutil.Spec{Kind: registrySchemaKind, CurrentVersion: 3, MinimumVersion: 3, Initialize: func(tx *sql.Tx) error {
		if err := initializeRegistryV1(tx); err != nil {
			return err
		}
		_, err := tx.Exec(addDefaultAppPath)
		return err
	}, Verify: verifyRegistryV3})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO port_forwards(forward_id,target_url,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms) VALUES('retained','http://127.0.0.1:3080',1,1,0)`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	spec := registrySchemaSpec()
	spec.Migrations[2].Apply = func(tx *sql.Tx) error {
		if err := applyManagementSchema(tx); err != nil {
			return err
		}
		return errors.New("injected failure after rebuild")
	}
	if reopened, err := sqliteutil.Open(path, spec); err == nil {
		reopened.Close()
		t.Fatal("injected migration failure was ignored")
	}
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var version int
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != 3 {
		t.Fatalf("version=%d err=%v", version, err)
	}
	tx, err := raw.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := verifyRegistryV3(tx); err != nil {
		t.Fatal("rollback did not restore exact v3", err)
	}
	var target string
	if err := tx.QueryRow(`SELECT target_url FROM port_forwards WHERE forward_id='retained'`).Scan(&target); err != nil || target != "http://127.0.0.1:3080" {
		t.Fatal("rollback lost user record", err)
	}
}
