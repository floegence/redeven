package registry

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func TestOpenCreatesFreshRegistryV2(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.sqlite")
	registry, err := Open(path)
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
	if kind != registrySchemaKind {
		t.Fatalf("db_kind = %q, want %q", kind, registrySchemaKind)
	}
	columns, err := sqliteutil.TableColumnNamesTx(mustBegin(t, registry.db), "managed_web_services")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(columns, "runtime_binding_json") || !slices.Contains(columns, "runtime_binding_sha256") {
		t.Fatalf("runtime binding columns are missing: %v", columns)
	}
}

func TestFreshRegistryRejectsNonRouteSafeForwardIdentity(t *testing.T) {
	registry, err := Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()

	err = registry.CreateForward(context.Background(), Forward{
		ForwardID:  "pf_invalid_identity",
		TargetURL:  "http://127.0.0.1:3000",
		AccessMode: AccessModeUnifiedProxy,
	})
	if err == nil {
		t.Fatal("non-route-safe forward identity was accepted")
	}
	forwards, listErr := registry.ListForwards(context.Background())
	if listErr != nil {
		t.Fatal(listErr)
	}
	if len(forwards) != 0 {
		t.Fatalf("forwards = %#v, want none", forwards)
	}
}

func TestOpenRejectsOldKindWithoutChangingDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(path, sqliteutil.Spec{
		Kind: "portforward_registry", CurrentVersion: 9, MinimumVersion: 9,
		Initialize: func(tx *sql.Tx) error {
			_, err := tx.Exec(`CREATE TABLE old_registry_record(id TEXT PRIMARY KEY)`)
			return err
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	before := mustRead(t, path)
	_, err = Open(path)
	var wrongKind *sqliteutil.WrongDatabaseKindError
	if !errors.As(err, &wrongKind) {
		t.Fatalf("Open() error = %v, want WrongDatabaseKindError", err)
	}
	if after := mustRead(t, path); !slices.Equal(before, after) {
		t.Fatal("old registry was modified")
	}
}

func TestOpenRejectsFutureVersionWithoutChangingDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(path, sqliteutil.Spec{
		Kind: registrySchemaKind, CurrentVersion: 3, MinimumVersion: 3,
		Initialize: func(tx *sql.Tx) error {
			_, err := tx.Exec(`CREATE TABLE future_registry_record(id TEXT PRIMARY KEY)`)
			return err
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	before := mustRead(t, path)
	_, err = Open(path)
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

func TestManagedServicePersistsBindingAndRetryLineage(t *testing.T) {
	registry, err := Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()

	snapshot := `{"schema_version":4,"kind":"container","endpoint":{"scheme":"http"},"container":{"image":"example.invalid/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","read_only_root":true}}`
	configuration := `{"schema_version":2}`
	release := `{"schema_version":1,"kind":"oci"}`
	binding := `{"schema_version":1,"deployment":"container","container":{"name":"redeven-mws-test"}}`
	service := ManagedService{
		ServiceID: "mws_test", TemplateID: "fictional-template", TemplateSource: "builtin", TemplateRevision: 1,
		TemplateSnapshotJSON: snapshot, TemplateSnapshotSHA256: digest(snapshot), ServiceFamilyID: "fictional-family",
		Deployment: "container", WorkspacePath: "/workspace", ConfigurationJSON: configuration, ConfigurationSHA256: digest(configuration),
		ReleaseIdentityJSON: release, ReleaseIdentitySHA256: digest(release), RuntimeBindingJSON: binding, RuntimeBindingSHA256: digest(binding),
		DesiredState: "stopped", ObservedState: "installing", ForwardID: "pf-test",
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
	if got == nil || got.RuntimeBindingJSON != binding || got.RuntimeBindingSHA256 != digest(binding) {
		t.Fatalf("runtime binding = %#v", got)
	}
	retry := ManagedOperation{
		OperationID: "mop_retry", ServiceID: service.ServiceID, RequestID: "req_retry", RequestFingerprint: "retry",
		RetryOfOperationID: operation.OperationID, Action: "retry_install", State: "pending", Stage: "queued",
	}
	if err := registry.CreateManagedOperation(context.Background(), retry); err != nil {
		t.Fatal(err)
	}
	gotRetry, err := registry.GetManagedOperation(context.Background(), retry.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	if gotRetry == nil || gotRetry.RetryOfOperationID != operation.OperationID || gotRetry.Action != "retry_install" {
		t.Fatalf("retry operation = %#v", gotRetry)
	}
}

func TestOpenMigratesRegistryV1ToV2WithoutChangingServiceIdentity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.sqlite")
	legacy, err := sqliteutil.Open(path, sqliteutil.Spec{
		Kind: registrySchemaKind, CurrentVersion: 1,
		Migrations: []sqliteutil.Migration{{FromVersion: 0, ToVersion: 1, Apply: initializeRegistryV1}},
		Verify:     verifyRegistryV1,
	})
	if err != nil {
		t.Fatal(err)
	}
	spec := `{"schema_version":3,"kind":"container","endpoint":{"scheme":"http","container_port":3000},"container":{"image":"example.invalid/app:1.0.0@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","read_only_root":true,"release_policy":{"blocked_tag_prefixes":["private"]}}}`
	configuration := `{"schema_version":2}`
	release := `{"schema_version":1,"kind":"oci","source":"example.invalid/app","tag":"1.0.0","digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`
	binding := `{"schema_version":1,"deployment":"container","container":{"name":"redeven-mws-one"}}`
	if _, err := legacy.Exec(`INSERT INTO port_forwards(forward_id,target_url,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms) VALUES('pf-one','http://127.0.0.1:3000',1,1,0)`); err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(`INSERT INTO managed_web_service_templates(template_id,name,source,deployment,version,revision,spec_json,spec_sha256,service_family_id,created_at_unix_ms,updated_at_unix_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, "custom-one", "Custom", "custom", "container", "1.0.0", 1, spec, digest(spec), "family-one", 1, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(`INSERT INTO managed_web_services(service_id,template_id,template_source,template_revision,template_snapshot_json,template_snapshot_sha256,service_family_id,deployment,workspace_path,configuration_json,configuration_revision,configuration_sha256,release_identity_json,release_identity_sha256,runtime_binding_json,runtime_binding_sha256,version,desired_state,observed_state,forward_id,created_at_unix_ms,updated_at_unix_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		"mws-one", "custom-one", "custom", 1, spec, digest(spec), "family-one", "container", "/workspace", configuration, 1, digest(configuration), release, digest(release), binding, digest(binding), "1.0.0", "stopped", "stopped", "pf-one", 1, 1); err != nil {
		t.Fatal(err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}

	registry, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	service, err := registry.GetManagedService(context.Background(), "mws-one")
	if err != nil {
		t.Fatal(err)
	}
	if service == nil || service.ReleaseIdentityJSON != release || service.RuntimeBindingJSON != binding || service.ConfigurationJSON != configuration {
		t.Fatalf("migrated service = %#v", service)
	}
	var migratedSpec string
	if err := registry.db.QueryRow(`SELECT template_snapshot_json FROM managed_web_services WHERE service_id='mws-one'`).Scan(&migratedSpec); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(migratedSpec, `"schema_version":4`) || strings.Contains(migratedSpec, "release_policy") {
		t.Fatalf("migrated TemplateSpec = %s", migratedSpec)
	}
	columns, err := sqliteutil.TableColumnNamesTx(mustBegin(t, registry.db), "managed_web_services")
	if err != nil {
		t.Fatal(err)
	}
	if slices.Contains(columns, "version") {
		t.Fatalf("legacy version column remains: %v", columns)
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
