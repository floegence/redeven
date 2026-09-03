package registry

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func TestOpenCreatesFreshRegistryV4(t *testing.T) {
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
	tx := mustBegin(t, registry.db)
	columns, err := sqliteutil.TableColumnNamesTx(tx, "managed_web_services")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(columns, "runtime_binding_json") || !slices.Contains(columns, "runtime_binding_sha256") {
		t.Fatalf("runtime binding columns are missing: %v", columns)
	}
	if !slices.Contains(columns, "workspace_ownership") {
		t.Fatalf("workspace ownership column is missing: %v", columns)
	}
	operationColumns, err := sqliteutil.TableColumnNamesTx(tx, "managed_web_service_operations")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(operationColumns, "delete_workspace") {
		t.Fatalf("workspace deletion column is missing: %v", operationColumns)
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
		Kind: registrySchemaKind, CurrentVersion: registryCurrentSchemaVersion + 1, MinimumVersion: registryCurrentSchemaVersion + 1,
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
		Deployment: "container", WorkspacePath: "/workspace", WorkspaceOwnership: "user_selected", ConfigurationJSON: configuration, ConfigurationSHA256: digest(configuration),
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

func TestOpenMigratesRegistryV1ToV5WithoutChangingServiceIdentity(t *testing.T) {
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
	if _, err := legacy.Exec(`INSERT INTO managed_web_service_operations(operation_id,service_id,request_id,request_fingerprint,action,delete_data,state,stage,progress_total,created_at_unix_ms,updated_at_unix_ms,progress_detail_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
		"mop-one", "mws-one", "request-one", "fingerprint-one", "uninstall", 1, "failed", "failed", 7, 1, 1, `{"schema_version":1}`); err != nil {
		t.Fatal(err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}
	legacy, err = sqliteutil.Open(path, sqliteutil.Spec{
		Kind: registrySchemaKind, CurrentVersion: 3,
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: initializeRegistryV1},
			{FromVersion: 1, ToVersion: 2, Apply: migrateRegistryV1ToV2},
			{FromVersion: 2, ToVersion: 3, Apply: migrateRegistryV2ToV3},
		},
		Verify: verifyRegistryV3,
	})
	if err != nil {
		t.Fatal(err)
	}
	releaseCheckV1 := `{"schema_version":1,"latest_stable_release":{"schema_version":1,"kind":"oci","source":"example.invalid/app","tag":"1.0.0","digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}`
	if _, err := legacy.Exec(`INSERT INTO managed_web_service_release_checks(service_id,summary_json,summary_sha256,checked_at_unix_ms,next_check_at_unix_ms,stale,last_error_code,updated_at_unix_ms) VALUES(?,?,?,?,?,?,?,?)`, "mws-one", releaseCheckV1, digest(releaseCheckV1), 10, 20, 0, "", 10); err != nil {
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
	if service.WorkspaceOwnership != "user_selected" {
		t.Fatalf("workspace ownership = %q, want user_selected", service.WorkspaceOwnership)
	}
	operation, err := registry.GetManagedOperation(context.Background(), "mop-one")
	if err != nil {
		t.Fatal(err)
	}
	if operation == nil || !operation.DeleteData || operation.DeleteWorkspace {
		t.Fatalf("migrated operation = %#v", operation)
	}
	var migratedSpec string
	if err := registry.db.QueryRow(`SELECT template_snapshot_json FROM managed_web_services WHERE service_id='mws-one'`).Scan(&migratedSpec); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(migratedSpec, `"schema_version":5`) || strings.Contains(migratedSpec, "release_policy") {
		t.Fatalf("migrated TemplateSpec = %s", migratedSpec)
	}
	if operation.ProgressDetail == nil || operation.ProgressDetail.SchemaVersion != 2 {
		t.Fatalf("migrated operation progress = %#v", operation.ProgressDetail)
	}
	tx := mustBegin(t, registry.db)
	columns, err := sqliteutil.TableColumnNamesTx(tx, "managed_web_services")
	if err != nil {
		t.Fatal(err)
	}
	if slices.Contains(columns, "version") {
		t.Fatalf("legacy version column remains: %v", columns)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	check, err := registry.GetManagedReleaseCheck(context.Background(), "mws-one")
	if err != nil {
		t.Fatal(err)
	}
	if check == nil || !check.Stale || check.CheckedAtUnixMs != 10 || check.NextCheckAtUnixMs != 20 {
		t.Fatalf("migrated release check = %#v", check)
	}
	var releaseCheckV2 struct {
		SchemaVersion       int               `json:"schema_version"`
		CatalogStatus       string            `json:"catalog_status"`
		Candidates          []json.RawMessage `json:"candidates"`
		LatestStableRelease json.RawMessage   `json:"latest_stable_release"`
	}
	if err := json.Unmarshal([]byte(check.SummaryJSON), &releaseCheckV2); err != nil {
		t.Fatal(err)
	}
	if releaseCheckV2.SchemaVersion != 2 || releaseCheckV2.CatalogStatus != "stale" || releaseCheckV2.Candidates == nil || len(releaseCheckV2.LatestStableRelease) == 0 {
		t.Fatalf("migrated release summary = %s", check.SummaryJSON)
	}
}

func TestOpenMigratesRegistryV2ToV3WithConservativeWorkspaceOwnership(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.sqlite")
	legacy, err := sqliteutil.Open(path, sqliteutil.Spec{
		Kind: registrySchemaKind, CurrentVersion: 2, MinimumVersion: 0,
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: initializeRegistryV1},
			{FromVersion: 1, ToVersion: 2, Apply: migrateRegistryV1ToV2},
		},
		Verify: verifyRegistryV2,
	})
	if err != nil {
		t.Fatal(err)
	}
	spec := `{"schema_version":4,"kind":"host","endpoint":{"scheme":"http"},"host":{"start_script":"true"}}`
	configuration := `{"schema_version":2}`
	release := `{"schema_version":1,"kind":"none"}`
	binding := `{"schema_version":1,"deployment":"host","host":{"install_dir":"/managed/install","data_dir":"/managed/data","log_path":"/managed/log"}}`
	if _, err := legacy.Exec(`INSERT INTO port_forwards(forward_id,target_url,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms,access_mode) VALUES('pf-v2','http://127.0.0.1:3000',1,1,0,'unified_proxy')`); err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(`INSERT INTO managed_web_services(service_id,template_id,template_source,template_revision,template_snapshot_json,template_snapshot_sha256,service_family_id,deployment,workspace_path,configuration_json,configuration_revision,configuration_sha256,release_identity_json,release_identity_sha256,runtime_binding_json,runtime_binding_sha256,desired_state,observed_state,forward_id,created_at_unix_ms,updated_at_unix_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		"mws-v2", "custom-v2", "custom", 1, spec, digest(spec), "family-v2", "host", "/existing-workspace", configuration, 1, digest(configuration), release, digest(release), binding, digest(binding), "stopped", "stopped", "pf-v2", 1, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(`INSERT INTO managed_web_service_operations(operation_id,service_id,request_id,request_fingerprint,action,delete_data,state,stage,progress_total,created_at_unix_ms,updated_at_unix_ms,progress_detail_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
		"mop-v2", "mws-v2", "request-v2", "fingerprint-v2", "uninstall", 1, "failed", "failed", 7, 1, 1, `{"schema_version":1}`); err != nil {
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
	service, err := registry.GetManagedService(context.Background(), "mws-v2")
	if err != nil {
		t.Fatal(err)
	}
	operation, err := registry.GetManagedOperation(context.Background(), "mop-v2")
	if err != nil {
		t.Fatal(err)
	}
	if service == nil || service.WorkspacePath != "/existing-workspace" || service.WorkspaceOwnership != "user_selected" {
		t.Fatalf("migrated v2 service = %#v", service)
	}
	if operation == nil || !operation.DeleteData || operation.DeleteWorkspace {
		t.Fatalf("migrated v2 operation = %#v", operation)
	}
}

func TestRegistryV3ToV4MigrationRollsBackAnInvalidReleaseSummary(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.sqlite")
	registry, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	seedReleaseCheckService(t, registry)
	if err := registry.Close(); err != nil {
		t.Fatal(err)
	}
	invalid := `{"schema_version":99}`
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`UPDATE managed_web_service_release_checks SET summary_json=?,summary_sha256=? WHERE service_id='mws-release-check'; PRAGMA user_version=3;`, invalid, digest(invalid)); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	if _, err := Open(path); err == nil {
		t.Fatal("invalid v3 release summary was migrated")
	}
	raw, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var version int
	var summary string
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := raw.QueryRow(`SELECT summary_json FROM managed_web_service_release_checks WHERE service_id='mws-release-check'`).Scan(&summary); err != nil {
		t.Fatal(err)
	}
	if version != 3 || summary != invalid {
		t.Fatalf("failed migration changed registry: version=%d summary=%s", version, summary)
	}
}

func TestOpenMigratesRegistryV4ToV5WithOperationProgressAndIdentityPreserved(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.sqlite")
	registry, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	seedReleaseCheckService(t, registry)
	if err := registry.Close(); err != nil {
		t.Fatal(err)
	}
	progressV1 := `{"schema_version":1,"stage_started_at_unix_ms":11,"updated_at_unix_ms":12,"transfer":{"phase":"pulling","artifact_reference":"example.invalid/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","artifact_index":1,"artifact_total":1,"completed_layers":2,"total_layers":3}}`
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`UPDATE managed_web_service_operations SET progress_detail_json=? WHERE operation_id='mop-release-check'; PRAGMA user_version=4;`, progressV1); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	registry, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	service, err := registry.GetManagedService(context.Background(), "mws-release-check")
	if err != nil {
		t.Fatal(err)
	}
	if service == nil || !strings.Contains(service.TemplateSnapshotJSON, `"schema_version":5`) || service.TemplateID != "fictional-release-check" || service.RuntimeBindingJSON == "" {
		t.Fatalf("migrated service = %#v", service)
	}
	if got := digest(service.TemplateSnapshotJSON); got != service.TemplateSnapshotSHA256 {
		t.Fatalf("migrated template digest = %q, want %q", service.TemplateSnapshotSHA256, got)
	}
	operation, err := registry.GetManagedOperation(context.Background(), "mop-release-check")
	if err != nil {
		t.Fatal(err)
	}
	if operation == nil || operation.ProgressDetail == nil || operation.ProgressDetail.SchemaVersion != 2 || operation.ProgressDetail.StageStartedAtUnixMs != 11 || operation.ProgressDetail.Transfer == nil || operation.ProgressDetail.Transfer.CompletedLayers != 2 {
		t.Fatalf("migrated operation = %#v", operation)
	}
}

func TestRegistryV4ToV5MigrationRollsBackInvalidDocuments(t *testing.T) {
	for _, test := range []struct {
		name           string
		template       string
		progressDetail string
	}{
		{name: "template", template: `{"schema_version":99}`, progressDetail: `{"schema_version":1}`},
		{name: "progress detail", template: `{"schema_version":4,"kind":"container","endpoint":{"scheme":"http"},"container":{"image":"example.invalid/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","read_only_root":true}}`, progressDetail: `{"schema_version":99}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "registry.sqlite")
			registry, err := Open(path)
			if err != nil {
				t.Fatal(err)
			}
			seedReleaseCheckService(t, registry)
			if err := registry.Close(); err != nil {
				t.Fatal(err)
			}
			raw, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := raw.Exec(`UPDATE managed_web_services SET template_snapshot_json=?,template_snapshot_sha256=? WHERE service_id='mws-release-check'`, test.template, digest(test.template)); err != nil {
				t.Fatal(err)
			}
			if _, err := raw.Exec(`UPDATE managed_web_service_operations SET progress_detail_json=? WHERE operation_id='mop-release-check'`, test.progressDetail); err != nil {
				t.Fatal(err)
			}
			if _, err := raw.Exec(`PRAGMA user_version=4`); err != nil {
				t.Fatal(err)
			}
			if err := raw.Close(); err != nil {
				t.Fatal(err)
			}

			if _, err := Open(path); err == nil {
				t.Fatal("invalid v4 document was migrated")
			}
			raw, err = sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			defer raw.Close()
			var version int
			var template, progress string
			if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
				t.Fatal(err)
			}
			if err := raw.QueryRow(`SELECT template_snapshot_json FROM managed_web_services WHERE service_id='mws-release-check'`).Scan(&template); err != nil {
				t.Fatal(err)
			}
			if err := raw.QueryRow(`SELECT progress_detail_json FROM managed_web_service_operations WHERE operation_id='mop-release-check'`).Scan(&progress); err != nil {
				t.Fatal(err)
			}
			if version != 4 || template != test.template || progress != test.progressDetail {
				t.Fatalf("failed migration changed registry: version=%d template=%s progress=%s", version, template, progress)
			}
		})
	}
}

func TestOpenRejectsV5ReleaseSummaryDriftWithoutChangingDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.sqlite")
	registry, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	seedReleaseCheckService(t, registry)
	if err := registry.Close(); err != nil {
		t.Fatal(err)
	}
	invalid := `{"schema_version":99}`
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`UPDATE managed_web_service_release_checks SET summary_json=?,summary_sha256=? WHERE service_id='mws-release-check'`, invalid, digest(invalid)); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	before := mustRead(t, path)
	_, err = Open(path)
	var verifyError *sqliteutil.SchemaVerifyError
	if !errors.As(err, &verifyError) {
		t.Fatalf("Open() error = %v, want SchemaVerifyError", err)
	}
	if after := mustRead(t, path); !slices.Equal(before, after) {
		t.Fatal("drifted release summary was modified")
	}
}

func TestOpenRejectsV5NestedReleaseCandidateDriftWithoutChangingDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.sqlite")
	registry, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	seedReleaseCheckService(t, registry)
	if err := registry.Close(); err != nil {
		t.Fatal(err)
	}
	invalid := `{"schema_version":2,"source_fingerprint":"source","catalog_status":"complete","candidates":[{"schema_version":2,"candidate_id":"","source_kind":"oci","source":"example.invalid/app","channel":"stable","trust":"registry","selectable":true,"relation":"newer","verification_status":"verified","unexpected":true}]}`
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`UPDATE managed_web_service_release_checks SET summary_json=?,summary_sha256=? WHERE service_id='mws-release-check'`, invalid, digest(invalid)); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	before := mustRead(t, path)
	_, err = Open(path)
	var verifyError *sqliteutil.SchemaVerifyError
	if !errors.As(err, &verifyError) {
		t.Fatalf("Open() error = %v, want SchemaVerifyError", err)
	}
	if after := mustRead(t, path); !slices.Equal(before, after) {
		t.Fatal("drifted nested release candidate was modified")
	}
}

func seedReleaseCheckService(t *testing.T, registry *Registry) {
	t.Helper()
	snapshot := `{"schema_version":4,"kind":"container","endpoint":{"scheme":"http"},"container":{"image":"example.invalid/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","read_only_root":true}}`
	configuration := `{"schema_version":2}`
	release := `{"schema_version":1,"kind":"oci"}`
	binding := `{"schema_version":1,"deployment":"container","container":{"name":"redeven-mws-release-check"}}`
	service := ManagedService{
		ServiceID: "mws-release-check", TemplateID: "fictional-release-check", TemplateSource: "custom", TemplateRevision: 1,
		TemplateSnapshotJSON: snapshot, TemplateSnapshotSHA256: digest(snapshot), ServiceFamilyID: "fictional-release-check",
		Deployment: "container", WorkspacePath: "/workspace", WorkspaceOwnership: "user_selected", ConfigurationJSON: configuration, ConfigurationSHA256: digest(configuration),
		ReleaseIdentityJSON: release, ReleaseIdentitySHA256: digest(release), RuntimeBindingJSON: binding, RuntimeBindingSHA256: digest(binding),
		DesiredState: "stopped", ObservedState: "stopped", ForwardID: "pf-release-check",
	}
	forward := Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:3080", AccessMode: AccessModeUnifiedProxy}
	operation := ManagedOperation{OperationID: "mop-release-check", ServiceID: service.ServiceID, RequestID: "req-release-check", RequestFingerprint: "install", Action: "install", State: "succeeded", Stage: "completed"}
	if err := registry.CreateManagedServiceWithOperation(context.Background(), service, forward, operation); err != nil {
		t.Fatal(err)
	}
	summary := `{"schema_version":2,"source_fingerprint":"source","catalog_status":"complete","candidates":[]}`
	if err := registry.UpsertManagedReleaseCheck(context.Background(), ManagedReleaseCheck{ServiceID: service.ServiceID, SummaryJSON: summary, SummarySHA256: digest(summary), CheckedAtUnixMs: 10, NextCheckAtUnixMs: 20}); err != nil {
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
