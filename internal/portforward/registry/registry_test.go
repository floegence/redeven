package registry

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func TestOpenCreatesFreshRegistryV2Baseline(t *testing.T) {
	registry, err := Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()

	var version int
	if err := registry.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != registryCurrentSchemaVersion {
		t.Fatalf("user_version = %d, want %d", version, registryCurrentSchemaVersion)
	}
	var kind string
	if err := registry.db.QueryRow(`SELECT db_kind FROM __redeven_db_meta WHERE singleton=1`).Scan(&kind); err != nil {
		t.Fatal(err)
	}
	if kind != "portforward_registry_v2" {
		t.Fatalf("db_kind = %q, want portforward_registry_v2", kind)
	}

	tx := mustBegin(t, registry.db)
	columns, err := sqliteutil.TableColumnNamesTx(tx, "managed_web_services")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"service_id", "template_id", "workspace_path", "workspace_ownership", "configuration_json",
		"configuration_revision", "configuration_sha256", "release_identity_json", "release_identity_sha256",
		"runtime_binding_json", "runtime_binding_sha256", "desired_state", "observed_state", "forward_id",
		"runtime_identity", "runtime_spec_sha256", "runtime_manifest_json", "runtime_port", "artifact_reference",
		"last_error_code", "last_error_message", "created_at_unix_ms", "updated_at_unix_ms",
	}
	if !slices.Equal(columns, want) {
		t.Fatalf("managed_web_services columns = %v, want %v", columns, want)
	}
}

func TestManagedServiceCRUDPersistsCurrentRuntimeIdentity(t *testing.T) {
	registry, err := Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()

	configuration := `{"schema_version":2}`
	release := `{"schema_version":1,"kind":"oci"}`
	binding := `{"schema_version":2,"service_family_id":"fictional-family","deployment":"container","container":{"name":"redeven-mws-test"}}`
	runtimeSpecDigest := digest(`{"kind":"container","image":"example.invalid/app:1"}`)
	service := ManagedService{
		ServiceID: "mws_test", TemplateID: "fictional-template", WorkspacePath: "/workspace", WorkspaceOwnership: "user_selected",
		ConfigurationJSON: configuration, ConfigurationSHA256: digest(configuration), ReleaseIdentityJSON: release,
		ReleaseIdentitySHA256: digest(release), RuntimeBindingJSON: binding, RuntimeBindingSHA256: digest(binding),
		DesiredState: "stopped", ObservedState: "installing", ForwardID: "pf-test", RuntimeSpecSHA256: runtimeSpecDigest,
	}
	operation := ManagedOperation{
		OperationID: "mop_install", ServiceID: service.ServiceID, RequestID: "req_install", RequestFingerprint: "install",
		Action: "install", State: "failed", Stage: "failed", ErrorCode: "TEST_FAILURE",
	}
	forward := Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:3080", AccessMode: AccessModeUnifiedProxy}
	if err := registry.CreateManagedServiceWithOperation(context.Background(), service, forward, operation); err != nil {
		t.Fatal(err)
	}
	got, err := registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.TemplateID != service.TemplateID || got.RuntimeBindingJSON != binding || got.RuntimeSpecSHA256 != runtimeSpecDigest {
		t.Fatalf("managed service = %#v", got)
	}

	nextDigest := digest(`{"kind":"container","image":"example.invalid/app:2"}`)
	if err := registry.UpdateManagedService(context.Background(), service.ServiceID, ManagedServicePatch{RuntimeSpecSHA256: &nextDigest}); err != nil {
		t.Fatal(err)
	}
	got, err = registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil || got == nil || got.RuntimeSpecSHA256 != nextDigest {
		t.Fatalf("updated managed service = %#v, err = %v", got, err)
	}

	retry := ManagedOperation{
		OperationID: "mop_retry", ServiceID: service.ServiceID, RequestID: "req_retry", RequestFingerprint: "retry",
		RetryOfOperationID: operation.OperationID, Action: "retry_install", State: "pending", Stage: "queued",
	}
	if err := registry.CreateManagedOperation(context.Background(), retry); err != nil {
		t.Fatal(err)
	}
	gotRetry, err := registry.GetManagedOperation(context.Background(), retry.OperationID)
	if err != nil || gotRetry == nil || gotRetry.RetryOfOperationID != operation.OperationID {
		t.Fatalf("retry operation = %#v, err = %v", gotRetry, err)
	}
}

func TestFreshRegistryRejectsNonRouteSafeForwardIdentity(t *testing.T) {
	registry, err := Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	err = registry.CreateForward(context.Background(), Forward{ForwardID: "pf_invalid_identity", TargetURL: "http://127.0.0.1:3000", AccessMode: AccessModeUnifiedProxy})
	if err == nil {
		t.Fatal("non-route-safe forward identity was accepted")
	}
}

func TestOpenRejectsEveryOldV1VersionWithoutChangingDatabase(t *testing.T) {
	for version := 1; version <= 5; version++ {
		t.Run(fmt.Sprintf("version-%d", version), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "registry.sqlite")
			createForeignRegistry(t, path, "portforward_registry_v1", version)
			before := mustRead(t, path)
			_, err := Open(path)
			var wrongKind *sqliteutil.WrongDatabaseKindError
			if !errors.As(err, &wrongKind) {
				t.Fatalf("Open() error = %v, want WrongDatabaseKindError", err)
			}
			if after := mustRead(t, path); !slices.Equal(before, after) {
				t.Fatal("old v1 registry was modified")
			}
		})
	}
}

func TestOpenRejectsUnknownKindWithoutChangingDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.sqlite")
	createForeignRegistry(t, path, "unknown_registry", 1)
	before := mustRead(t, path)
	_, err := Open(path)
	var wrongKind *sqliteutil.WrongDatabaseKindError
	if !errors.As(err, &wrongKind) {
		t.Fatalf("Open() error = %v, want WrongDatabaseKindError", err)
	}
	if after := mustRead(t, path); !slices.Equal(before, after) {
		t.Fatal("unknown registry was modified")
	}
}

func TestOpenRejectsFutureVersionWithoutChangingDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.sqlite")
	createForeignRegistry(t, path, registrySchemaKind, registryCurrentSchemaVersion+1)
	before := mustRead(t, path)
	_, err := Open(path)
	var tooNew *sqliteutil.DatabaseTooNewError
	if !errors.As(err, &tooNew) {
		t.Fatalf("Open() error = %v, want DatabaseTooNewError", err)
	}
	if after := mustRead(t, path); !slices.Equal(before, after) {
		t.Fatal("future registry was modified")
	}
}

func TestOpenRejectsSchemaDriftWithoutChangingDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.sqlite")
	registry, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE port_forwards ADD COLUMN unreviewed TEXT NOT NULL DEFAULT ''`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	before := mustRead(t, path)
	_, err = Open(path)
	var verifyError *sqliteutil.SchemaVerifyError
	if !errors.As(err, &verifyError) {
		t.Fatalf("Open() error = %v, want SchemaVerifyError", err)
	}
	if after := mustRead(t, path); !slices.Equal(before, after) {
		t.Fatal("drifted registry was modified")
	}
}

func TestOpenRejectsInvalidRuntimeBindingWithoutChangingDatabase(t *testing.T) {
	tests := []struct {
		name    string
		binding string
	}{
		{
			name:    "multiple deployment identities",
			binding: `{"schema_version":2,"service_family_id":"fictional-family","deployment":"container","host":{"install_root":"instances/test/install","data_root":"families/test/data","log_path":"instances/test/logs/service.log"},"container":{"name":"redeven-mws-test"}}`,
		},
		{
			name:    "wrong container name",
			binding: `{"schema_version":2,"service_family_id":"fictional-family","deployment":"container","container":{"name":"redeven-mws-another"}}`,
		},
		{
			name:    "wrong host paths",
			binding: `{"schema_version":2,"service_family_id":"fictional-family","deployment":"host","host":{"install_root":"instances/another/install","data_root":"families/fictional-family/data","log_path":"instances/another/logs/service.log"}}`,
		},
		{
			name:    "wrong compose config root",
			binding: `{"schema_version":2,"service_family_id":"fictional-family","deployment":"compose","compose":{"project_name":"redeven_mws_test","config_root":"instances/another/compose"}}`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "registry.sqlite")
			registry, err := Open(path)
			if err != nil {
				t.Fatal(err)
			}
			configuration := `{"schema_version":2}`
			release := `{"schema_version":1,"kind":"oci"}`
			service := ManagedService{
				ServiceID: "mws_test", TemplateID: "fictional-template", WorkspacePath: "/workspace", WorkspaceOwnership: "user_selected",
				ConfigurationJSON: configuration, ConfigurationRevision: 1, ConfigurationSHA256: digest(configuration),
				ReleaseIdentityJSON: release, ReleaseIdentitySHA256: digest(release),
				RuntimeBindingJSON: test.binding, RuntimeBindingSHA256: digest(test.binding),
				DesiredState: "stopped", ObservedState: "stopped", ForwardID: "pf-test", RuntimeManifestJSON: "{}",
			}
			if err := registry.CreateManagedService(context.Background(), service, Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:3080"}); err != nil {
				t.Fatal(err)
			}
			if err := registry.Close(); err != nil {
				t.Fatal(err)
			}
			before := mustRead(t, path)
			_, err = Open(path)
			var verifyError *sqliteutil.SchemaVerifyError
			if !errors.As(err, &verifyError) {
				t.Fatalf("Open() error = %v, want SchemaVerifyError", err)
			}
			if after := mustRead(t, path); !slices.Equal(before, after) {
				t.Fatal("registry with an invalid RuntimeBinding was modified")
			}
		})
	}
}

func createForeignRegistry(t *testing.T, path, kind string, version int) {
	t.Helper()
	db, err := sqliteutil.Open(path, sqliteutil.Spec{
		Kind: kind, CurrentVersion: version, MinimumVersion: version,
		Initialize: func(tx *sql.Tx) error {
			_, err := tx.Exec(`CREATE TABLE foreign_registry_record(id TEXT PRIMARY KEY)`)
			return err
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
}

func mustBegin(t *testing.T, db *sql.DB) *sql.Tx {
	t.Helper()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback() })
	return tx
}

func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func digest(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func createRegistryVersionOne(t *testing.T, path string) {
	t.Helper()
	db, err := sqliteutil.Open(path, sqliteutil.Spec{
		Kind: registrySchemaKind, CurrentVersion: 1,
		Migrations: []sqliteutil.Migration{{FromVersion: 0, ToVersion: 1, Apply: initializeRegistryV1}},
		Verify:     verifyRegistryV1,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`INSERT INTO port_forwards(forward_id,target_url,name,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms) VALUES('saved','http://localhost:3000','User service',1,2,3)`); err != nil {
		t.Fatal(err)
	}
}

func TestOpenMigratesDefaultAppPathAndPreservesRecords(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.sqlite")
	createRegistryVersionOne(t, path)
	reg, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reg.Close()
	f, err := reg.GetForward(context.Background(), "saved")
	if err != nil {
		t.Fatal(err)
	}
	if f == nil || f.DefaultAppPath != "/" || f.Name != "User service" || f.TargetURL != "http://localhost:3000" || f.CreatedAtUnixMs != 1 || f.UpdatedAtUnixMs != 2 || f.LastOpenedAtUnixMs != 3 {
		t.Fatalf("migrated record = %#v", f)
	}
	var version int
	if err := reg.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != registryCurrentSchemaVersion {
		t.Fatalf("version = %d", version)
	}
}

func TestDefaultAppPathMigrationRollsBackOnVerificationFailure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.sqlite")
	createRegistryVersionOne(t, path)
	spec := registrySchemaSpec()
	spec.Verify = func(tx *sql.Tx) error { return errors.New("injected final verification failure") }
	if db, err := sqliteutil.Open(path, spec); err == nil {
		db.Close()
		t.Fatal("migration unexpectedly succeeded")
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tx := mustBegin(t, db)
	if err := verifyRegistryV1(tx); err != nil {
		t.Fatalf("migration did not roll back: %v", err)
	}
	var version int
	if err := tx.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 1 {
		t.Fatalf("version = %d", version)
	}
	var name string
	if err := tx.QueryRow(`SELECT name FROM port_forwards WHERE forward_id='saved'`).Scan(&name); err != nil || name != "User service" {
		t.Fatalf("record = %q, %v", name, err)
	}
}

func TestOpenRejectsVersionOneConstraintDriftReadOnly(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.sqlite")
	createRegistryVersionOne(t, path)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`PRAGMA writable_schema=ON; UPDATE sqlite_master SET sql=replace(sql, "name TEXT NOT NULL DEFAULT ''", "name TEXT DEFAULT ''") WHERE name='port_forwards'; PRAGMA writable_schema=OFF;`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	before := mustRead(t, path)
	if reg, err := Open(path); err == nil {
		reg.Close()
		t.Fatal("accepted schema drift")
	}
	if !slices.Equal(before, mustRead(t, path)) {
		t.Fatal("drifted database was changed")
	}
}
