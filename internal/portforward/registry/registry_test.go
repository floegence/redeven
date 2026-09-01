package registry

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func TestOpen_CreatesV9SchemaForFreshDB(t *testing.T) {
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
	if v != 9 {
		t.Fatalf("user_version = %d, want 9", v)
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
		"access_mode",
	}
	for _, c := range want {
		if !slices.Contains(cols, c) {
			t.Fatalf("missing column %q in %+v", c, cols)
		}
	}
	managedColumns, err := tableColumns(r.db, "managed_web_services")
	if err != nil {
		t.Fatal(err)
	}
	for _, column := range []string{"configuration_revision", "configuration_sha256", "release_identity_json", "release_identity_sha256"} {
		if !slices.Contains(managedColumns, column) {
			t.Fatalf("missing managed service column %q in %v", column, managedColumns)
		}
	}
	operationColumns, err := tableColumns(r.db, "managed_web_service_operations")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(operationColumns, "progress_detail_json") {
		t.Fatalf("missing managed operation progress detail column in %v", operationColumns)
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
	if err := r.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != 9 {
		t.Fatalf("migrated version=%d, err=%v", version, err)
	}
}

func TestOpen_MigratesV3AccessModesAndPreservesRecords(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV3TestSpec())
	if err != nil {
		t.Fatal(err)
	}
	for _, forwardID := range []string{"pf_deepseek", "pf_webtop", "pf_plain"} {
		if _, err := db.Exec(`INSERT INTO port_forwards(forward_id,target_url,name,description,health_path,insecure_skip_verify,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms) VALUES(?, 'http://127.0.0.1:3080', ?, '', '', 0, 1, 2, 3)`, forwardID, forwardID); err != nil {
			_ = db.Close()
			t.Fatal(err)
		}
	}
	services := []struct {
		serviceID, templateID, familyID, forwardID, artifact, snapshot string
	}{
		{"mws_deepseek", "deepseek-harness-container", "deepseek-harness", "pf_deepseek", "ghcr.io/example/deepseek@sha256:" + strings.Repeat("a", 64), `{"schema_version":1,"kind":"container","endpoint":{"scheme":"http","container_port":3080},"container":{"image":"ghcr.io/example/deepseek@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}`},
		{"mws_webtop", "linuxserver-webtop-ubuntu-kde", "linuxserver-webtop-ubuntu-kde", "pf_webtop", "lscr.io/linuxserver/webtop@sha256:" + strings.Repeat("b", 64), `{"schema_version":1,"kind":"container","endpoint":{"scheme":"http","container_port":3000},"container":{"image":"lscr.io/linuxserver/webtop@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}`},
	}
	for _, service := range services {
		digest := sha256.Sum256([]byte(service.snapshot))
		if _, err := db.Exec(`INSERT INTO managed_web_services(service_id,template_id,template_source,template_revision,template_snapshot_json,template_snapshot_sha256,service_family_id,deployment,workspace_path,configuration_json,version,desired_state,observed_state,forward_id,runtime_identity,runtime_manifest_json,runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms) VALUES(?,?,'builtin',1,?,?,?,'container','/workspace','{}','1','running','stopped',?,'','{}',3080,?,'','',4,5)`, service.serviceID, service.templateID, service.snapshot, hex.EncodeToString(digest[:]), service.familyID, service.forwardID, service.artifact); err != nil {
			_ = db.Close()
			t.Fatal(err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	r, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = r.Close() })
	for forwardID, wantMode := range map[string]string{
		"pf_deepseek": AccessModeDesktopLoopback,
		"pf_webtop":   AccessModeUnifiedProxy,
		"pf_plain":    AccessModeUnifiedProxy,
	} {
		forward, err := r.GetForward(context.Background(), forwardID)
		if err != nil || forward == nil || forward.AccessMode != wantMode || forward.Name != forwardID {
			t.Fatalf("forward %s = %+v, err=%v, want mode %s", forwardID, forward, err, wantMode)
		}
	}
}

func TestOpen_RejectsV3SchemaDriftWithoutPartialMigration(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV3TestSpec())
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
		t.Fatal("Open accepted drifted v3 schema")
	}
	raw, err := sql.Open("sqlite", p)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var version int
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	columns, err := tableColumns(raw, "managed_web_services")
	if err != nil {
		t.Fatal(err)
	}
	forwardColumns, err := tableColumns(raw, "port_forwards")
	if err != nil {
		t.Fatal(err)
	}
	if version != 3 || !slices.Contains(columns, "unexpected") || slices.Contains(forwardColumns, "access_mode") {
		t.Fatalf("failed migration changed v3 database: version=%d service_columns=%v forward_columns=%v", version, columns, forwardColumns)
	}
}

func TestOpen_RollsBackFailedV3ToV4Migration(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV3TestSpec())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO port_forwards(forward_id,target_url,name,description,health_path,insecure_skip_verify,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms) VALUES('pf_keep','http://127.0.0.1:3080','Keep','','',0,1,2,3)`); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}

	spec := registrySchemaSpec()
	original := spec.Migrations[3].Apply
	spec.Migrations[3].Apply = func(tx *sql.Tx) error {
		if err := original(tx); err != nil {
			return err
		}
		return errors.New("injected migration failure")
	}
	if _, err := sqliteutil.Open(p, spec); err == nil {
		t.Fatal("migration unexpectedly succeeded")
	}
	after, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(after, before) {
		t.Fatal("failed migration changed the registry database bytes")
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
	if err := raw.QueryRow(`SELECT COUNT(1) FROM port_forwards WHERE forward_id='pf_keep'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	columns, err := tableColumns(raw, "port_forwards")
	if err != nil {
		t.Fatal(err)
	}
	if version != 3 || count != 1 || slices.Contains(columns, "access_mode") {
		t.Fatalf("failed migration was not atomic: version=%d forward_count=%d columns=%v", version, count, columns)
	}
}

func TestOpen_RejectsV4AccessModeConstraintDrift(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV3TestSpec())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE port_forwards ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'unified_proxy'; PRAGMA user_version=4;`); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	if _, err := Open(p); err == nil {
		t.Fatal("Open accepted a v4 access_mode column without its constraint")
	}
	raw, err := sql.Open("sqlite", p)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var version int
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	columns, err := tableColumns(raw, "port_forwards")
	if err != nil {
		t.Fatal(err)
	}
	if version != 4 || !slices.Contains(columns, "access_mode") {
		t.Fatalf("drifted v4 database changed: version=%d columns=%v", version, columns)
	}
}

func TestOpen_MigratesV4ManagedConfigurationAtomically(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV4TestSpec())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO port_forwards(forward_id,target_url,name,description,health_path,insecure_skip_verify,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms,access_mode) VALUES('pf_config','http://127.0.0.1:3080','Configured','','',0,1,2,3,'unified_proxy')`); err != nil {
		t.Fatal(err)
	}
	legacySpec := `{"schema_version":1,"kind":"container","endpoint":{"scheme":"http","container_port":3000},"container":{"image":"example.invalid/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","read_only_root":true,"mounts":[{"type":"volume","source":"data","target":"/data"}],"ports":[{"container_port":8080,"host_ip":"127.0.0.1"}],"devices":[{"host_path":"/dev/null","container_path":"/dev/null"}]}}`
	if _, err := db.Exec(`INSERT INTO managed_web_service_templates(template_id,name,description,source,deployment,version,revision,spec_json,spec_sha256,derived_from_template_id,derived_from_revision,service_family_id,created_at_unix_ms,updated_at_unix_ms) VALUES('template','Template','','custom','container','1',1,?,'','','0','family',1,1)`, legacySpec); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO managed_web_services(service_id,template_id,template_source,template_revision,template_snapshot_json,template_snapshot_sha256,service_family_id,deployment,workspace_path,configuration_json,version,desired_state,observed_state,forward_id,runtime_identity,runtime_manifest_json,runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms) VALUES('mws_config','template','custom',1,?,'','family','container','/workspace','{"parameters":{"TOKEN":"kept"},"accepted_notice_revisions":{"risk":2}}','1','stopped','stopped','pf_config','','{}',3080,'','','',4,5)`, legacySpec); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	r, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	service, err := r.GetManagedService(context.Background(), "mws_config")
	if err != nil {
		t.Fatal(err)
	}
	if service == nil || service.ConfigurationRevision != 1 || len(service.ConfigurationSHA256) != 64 || service.ConfigurationJSON != `{"schema_version":2,"parameters":{"TOKEN":"kept"},"accepted_notice_revisions":{"risk":2}}` {
		t.Fatalf("migrated service = %+v", service)
	}
	var snapshot map[string]any
	if err := json.Unmarshal([]byte(service.TemplateSnapshotJSON), &snapshot); err != nil {
		t.Fatal(err)
	}
	container := snapshot["container"].(map[string]any)
	for _, field := range []string{"mounts", "ports", "devices"} {
		item := container[field].([]any)[0].(map[string]any)
		if !strings.HasPrefix(fmt.Sprint(item["resource_id"]), "legacy-") {
			t.Fatalf("%s resource identity was not migrated: %v", field, item)
		}
	}
	snapshotDigest := sha256.Sum256([]byte(service.TemplateSnapshotJSON))
	if service.TemplateSnapshotSHA256 != hex.EncodeToString(snapshotDigest[:]) {
		t.Fatalf("migrated snapshot digest = %q, want exact document identity", service.TemplateSnapshotSHA256)
	}
	template, err := r.GetManagedTemplate(context.Background(), "template")
	if err != nil {
		t.Fatal(err)
	}
	if template == nil {
		t.Fatal("migrated custom template is missing")
	}
	templateDigest := sha256.Sum256([]byte(template.SpecJSON))
	if template.SpecSHA256 != hex.EncodeToString(templateDigest[:]) {
		t.Fatalf("migrated custom template digest = %q, want exact document identity", template.SpecSHA256)
	}
	resources, err := r.ListManagedServiceResources(context.Background(), service.ServiceID)
	if err != nil || len(resources) != 0 {
		t.Fatalf("resources=%v err=%v", resources, err)
	}
}

func TestOpen_MigratesV5OperationDetailsWithoutRewritingManagedData(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV5TestSpec())
	if err != nil {
		t.Fatal(err)
	}
	configuration := `{"schema_version":2,"parameters":{"TOKEN":"kept"}}`
	configurationDigest := sha256.Sum256([]byte(configuration))
	snapshot := `{"schema_version":1,"kind":"container","endpoint":{"scheme":"http","container_port":3000},"container":{"image":"example.invalid/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}`
	snapshotDigest := sha256.Sum256([]byte(snapshot))
	secretsPath := filepath.Join(filepath.Dir(p), "mws_keep.secrets.json")
	secrets := []byte(`{"schema_version":1,"values":{"TOKEN":"preserved-secret"}}`)
	if err := os.WriteFile(secretsPath, secrets, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO port_forwards(forward_id,target_url,name,description,health_path,insecure_skip_verify,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms,access_mode) VALUES('pf_keep','http://127.0.0.1:3080','Keep','','',0,1,2,3,'unified_proxy')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO managed_web_services(service_id,template_id,template_source,template_revision,template_snapshot_json,template_snapshot_sha256,service_family_id,deployment,workspace_path,configuration_json,version,desired_state,observed_state,forward_id,runtime_identity,runtime_manifest_json,runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms,configuration_revision,configuration_sha256) VALUES('mws_keep','template','custom',4,?,?, 'family','container','/workspace',?,'1','stopped','error','pf_keep','container-1','{"kind":"managed_service_reconfigure_v1"}',3080,'example.invalid/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','IMAGE_PULL_FAILED','The image could not be pulled.',4,5,7,?)`, snapshot, hex.EncodeToString(snapshotDigest[:]), configuration, hex.EncodeToString(configurationDigest[:])); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO managed_web_service_templates(template_id,name,description,source,deployment,version,revision,spec_json,spec_sha256,derived_from_template_id,derived_from_revision,service_family_id,created_at_unix_ms,updated_at_unix_ms) VALUES('template','Preserved template','Description','custom','container','1',4,?,?,'',0,'family',6,7)`, snapshot, hex.EncodeToString(snapshotDigest[:])); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO managed_web_service_resources(service_id,resource_id,kind,engine_identity,created_at_unix_ms) VALUES('mws_keep','resource-keep','container','container-1',8)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO managed_web_service_operations(operation_id,service_id,request_id,request_fingerprint,action,delete_data,state,stage,progress_current,progress_total,cancel_requested,error_code,error_message,created_at_unix_ms,updated_at_unix_ms,finished_at_unix_ms) VALUES('mop_keep','mws_keep','request-keep','fingerprint','install',0,'failed','pulling',2,7,0,'IMAGE_PULL_FAILED','The image could not be pulled.',10,11,12)`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	r, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	service, err := r.GetManagedService(context.Background(), "mws_keep")
	if err != nil {
		t.Fatal(err)
	}
	if service == nil || service.ConfigurationJSON != configuration || service.ConfigurationSHA256 != hex.EncodeToString(configurationDigest[:]) || service.ConfigurationRevision != 7 || service.RuntimeManifestJSON != `{"kind":"managed_service_reconfigure_v1"}` || service.LastErrorCode != "IMAGE_PULL_FAILED" {
		t.Fatalf("migrated service changed: %+v", service)
	}
	assertRegistryTemplateSpecVersion(t, service.TemplateSnapshotJSON, service.TemplateSnapshotSHA256, 2)
	operation, err := r.GetManagedOperation(context.Background(), "mop_keep")
	if err != nil {
		t.Fatal(err)
	}
	if operation == nil || operation.Action != "install" || operation.Stage != "pulling" || operation.ErrorCode != "IMAGE_PULL_FAILED" || operation.CreatedAtUnixMs != 10 || operation.FinishedAtUnixMs != 12 || operation.ProgressDetail == nil || operation.ProgressDetail.SchemaVersion != 1 || operation.ProgressDetail.Transfer != nil {
		t.Fatalf("migrated operation changed: %+v", operation)
	}
	template, err := r.GetManagedTemplate(context.Background(), "template")
	if err != nil || template == nil || template.Name != "Preserved template" {
		t.Fatalf("migrated template=%+v err=%v", template, err)
	}
	assertRegistryTemplateSpecVersion(t, template.SpecJSON, template.SpecSHA256, 2)
	resources, err := r.ListManagedServiceResources(context.Background(), "mws_keep")
	if err != nil || len(resources) != 1 || resources[0].ResourceID != "resource-keep" || resources[0].EngineIdentity != "container-1" {
		t.Fatalf("migrated resources=%+v err=%v", resources, err)
	}
	gotSecrets, err := os.ReadFile(secretsPath)
	if err != nil || !slices.Equal(gotSecrets, secrets) {
		t.Fatalf("managed service secrets changed: %q err=%v", gotSecrets, err)
	}
}

func TestOpen_MigratesV6DeepSeekFamiliesWithoutRewritingManagedData(t *testing.T) {
	tests := []struct {
		name       string
		templateID string
		deployment string
		snapshot   string
	}{
		{
			name:       "host",
			templateID: "deepseek-harness-host",
			deployment: "native",
			snapshot:   `{"schema_version":1,"kind":"host","endpoint":{"scheme":"http"},"host":{"start_script":"exec service"}}`,
		},
		{
			name:       "container",
			templateID: "deepseek-harness-container",
			deployment: "docker",
			snapshot:   `{"schema_version":1,"kind":"container","endpoint":{"scheme":"http","container_port":3080},"container":{"image":"example.invalid/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","read_only_root":true}}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := filepath.Join(t.TempDir(), "registry.sqlite")
			db, err := sqliteutil.Open(p, registryV6TestSpec())
			if err != nil {
				t.Fatal(err)
			}
			configuration := `{"schema_version":2,"parameters":{"TOKEN":"kept"}}`
			configurationDigest := sha256.Sum256([]byte(configuration))
			snapshotDigest := sha256.Sum256([]byte(tt.snapshot))
			if _, err := db.Exec(`INSERT INTO port_forwards(forward_id,target_url,name,description,health_path,insecure_skip_verify,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms,access_mode) VALUES('pf_keep','http://127.0.0.1:3080','Keep','Description','/health',0,1,2,3,'desktop_loopback')`); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`INSERT INTO managed_web_services(service_id,template_id,template_source,template_revision,template_snapshot_json,template_snapshot_sha256,service_family_id,deployment,workspace_path,configuration_json,version,desired_state,observed_state,forward_id,runtime_identity,runtime_manifest_json,runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms,configuration_revision,configuration_sha256) VALUES('mws_keep',?,'builtin',1,?,?,'deepseek-harness',?,'/preserved/workspace',?,'0.1.1-rc.2','stopped','error','pf_keep','runtime-identity','{"kind":"managed_service_reconfigure_v1"}',3080,'artifact-reference','START_FAILED','Preserved failure.',4,5,7,?)`, tt.templateID, tt.snapshot, hex.EncodeToString(snapshotDigest[:]), tt.deployment, configuration, hex.EncodeToString(configurationDigest[:])); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`INSERT INTO managed_web_service_resources(service_id,resource_id,kind,engine_identity,created_at_unix_ms) VALUES('mws_keep','resource-keep','volume','engine-resource',8)`); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`INSERT INTO managed_web_service_operations(operation_id,service_id,request_id,request_fingerprint,action,delete_data,state,stage,progress_current,progress_total,cancel_requested,error_code,error_message,created_at_unix_ms,updated_at_unix_ms,finished_at_unix_ms,progress_detail_json) VALUES('mop_keep','mws_keep','request-keep','fingerprint','start',0,'failed','starting',4,7,0,'START_FAILED','Preserved failure.',10,11,12,'{"schema_version":1}')`); err != nil {
				t.Fatal(err)
			}
			if err := db.Close(); err != nil {
				t.Fatal(err)
			}

			r, err := Open(p)
			if err != nil {
				t.Fatal(err)
			}
			defer r.Close()
			service, err := r.GetManagedService(context.Background(), "mws_keep")
			if err != nil {
				t.Fatal(err)
			}
			if service == nil || service.ServiceFamilyID != tt.templateID || service.TemplateID != tt.templateID || service.WorkspacePath != "/preserved/workspace" || service.ConfigurationJSON != configuration || service.ConfigurationSHA256 != hex.EncodeToString(configurationDigest[:]) || service.RuntimeManifestJSON != `{"kind":"managed_service_reconfigure_v1"}` || service.UpdatedAtUnixMs != 5 {
				t.Fatalf("migrated service changed: %+v", service)
			}
			wantSchema := 2
			if tt.deployment == "native" {
				wantSchema = 3
			}
			assertRegistryTemplateSpecVersion(t, service.TemplateSnapshotJSON, service.TemplateSnapshotSHA256, wantSchema)
			if tt.deployment == "native" && service.Deployment != "host" {
				t.Fatalf("migrated host deployment = %q", service.Deployment)
			}
			if tt.deployment == "docker" && service.Deployment != "container" {
				t.Fatalf("migrated container deployment = %q", service.Deployment)
			}
			forward, err := r.GetForward(context.Background(), "pf_keep")
			if err != nil || forward == nil || forward.Description != "Description" || forward.LastOpenedAtUnixMs != 3 {
				t.Fatalf("migrated forward=%+v err=%v", forward, err)
			}
			operation, err := r.GetManagedOperation(context.Background(), "mop_keep")
			if err != nil || operation == nil || operation.ErrorCode != "START_FAILED" || operation.FinishedAtUnixMs != 12 || operation.ProgressDetail == nil || operation.ProgressDetail.SchemaVersion != 1 {
				t.Fatalf("migrated operation=%+v err=%v", operation, err)
			}
			resources, err := r.ListManagedServiceResources(context.Background(), "mws_keep")
			if err != nil || len(resources) != 1 || resources[0].EngineIdentity != "engine-resource" {
				t.Fatalf("migrated resources=%+v err=%v", resources, err)
			}
			var version int
			if err := r.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != 9 {
				t.Fatalf("migrated version=%d err=%v", version, err)
			}
		})
	}
}

func TestOpen_MigratesV7ReleaseIdentityAndTemplateSpecAtomically(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV7TestSpec())
	if err != nil {
		t.Fatal(err)
	}
	snapshot := `{"schema_version":1,"kind":"host","endpoint":{"scheme":"http","path":"/","health_path":"/"},"host":{"start_script":"exec service","runtime_bundle":"deepseek-harness-0.1.1-rc.2-node-24.19.0"}}`
	snapshotDigest := sha256.Sum256([]byte(snapshot))
	configuration := `{"schema_version":2,"parameters":{}}`
	configurationDigest := sha256.Sum256([]byte(configuration))
	if _, err := db.Exec(`INSERT INTO port_forwards(forward_id,target_url,name,description,health_path,insecure_skip_verify,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms,access_mode) VALUES('pf_v7','http://127.0.0.1:3080','Keep','','/',0,1,2,3,'desktop_loopback')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO managed_web_services(service_id,template_id,template_source,template_revision,template_snapshot_json,template_snapshot_sha256,service_family_id,deployment,workspace_path,configuration_json,version,desired_state,observed_state,forward_id,runtime_identity,runtime_manifest_json,runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms,configuration_revision,configuration_sha256) VALUES('mws_v7','deepseek-harness-host','builtin',2,?,?,'deepseek-harness-host','host','/preserved/workspace',?,'0.1.1-rc.2','stopped','stopped','pf_v7','','{}',3080,'/managed/releases/current/bin/managed-service','','',4,5,2,?)`, snapshot, hex.EncodeToString(snapshotDigest[:]), configuration, hex.EncodeToString(configurationDigest[:])); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	r, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	service, err := r.GetManagedService(context.Background(), "mws_v7")
	if err != nil || service == nil {
		t.Fatalf("service=%+v err=%v", service, err)
	}
	assertRegistryTemplateSpecVersion(t, service.TemplateSnapshotJSON, service.TemplateSnapshotSHA256, 3)
	if service.WorkspacePath != "/preserved/workspace" || service.ConfigurationJSON != configuration || service.UpdatedAtUnixMs != 5 {
		t.Fatalf("v7 user data changed: %+v", service)
	}
	var identity registryReleaseIdentityV1
	if err := json.Unmarshal([]byte(service.ReleaseIdentityJSON), &identity); err != nil {
		t.Fatal(err)
	}
	if identity.Kind != "npm" || identity.Source != "@deepseek-ai/dsh" || identity.Version != "0.1.1-rc.2" || identity.Integrity == "" {
		t.Fatalf("unexpected migrated release identity: %+v", identity)
	}
	if err := verifyRegistryDocumentDigest("managed Web Service release identity", service.ServiceID, service.ReleaseIdentityJSON, service.ReleaseIdentitySHA256); err != nil {
		t.Fatal(err)
	}
}

func TestOpen_MigratesV8HostEnvironmentAndRestoresAutomaticRecoveryIntent(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV8TestSpec())
	if err != nil {
		t.Fatal(err)
	}
	hostSnapshot := `{"schema_version":2,"kind":"host","endpoint":{"scheme":"http","path":"/","health_path":"/"},"host":{"start_script":"exec service","npm":{"package_name":"@deepseek-ai/dsh","version":"0.1.1-rc.2","registry_url":"https://registry.npmjs.org/","executable":"dsh"}}}`
	containerSnapshot := `{"schema_version":2,"kind":"container","endpoint":{"scheme":"http","container_port":3080},"container":{"image":"ghcr.io/runzhliu/deepseek-harness:0.1.1-rc.2@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","read_only_root":true}}`
	customSnapshot := `{"schema_version":2,"kind":"host","endpoint":{"scheme":"http","path":"/","health_path":"/"},"host":{"install_script":"printf custom-install","start_script":"exec custom-start","stop_script":"printf custom-stop","uninstall_script":"printf custom-uninstall"}}`
	configuration := `{"schema_version":2}`
	configurationDigest := sha256.Sum256([]byte(configuration))
	hostRelease := `{"schema_version":1,"kind":"npm","source":"@deepseek-ai/dsh","version":"0.1.1-rc.2","integrity":"sha512-UP1UIh6q3Gme/yXRn/QL2P8IsVlv8Shpg22TRJIZPsCRWLm4CBiA1MUvXmJAfsOEETBMLAl+xWPtFw6ICsN3wg==","artifact_reference":"/managed/deepseek/bin/dsh","trust":"redeven_reviewed_legacy"}`
	containerRelease := `{"schema_version":1,"kind":"oci","source":"ghcr.io/runzhliu/deepseek-harness","tag":"0.1.1-rc.2","digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","artifact_reference":"ghcr.io/runzhliu/deepseek-harness:0.1.1-rc.2@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`
	fixtures := []struct {
		id, templateID, deployment, snapshot, release, artifact, runtimeIdentity string
	}{
		{id: "recover", templateID: "deepseek-harness-host", deployment: "host", snapshot: hostSnapshot, release: hostRelease, artifact: "/managed/deepseek/bin/dsh", runtimeIdentity: "native:legacy:nonce:42"},
		{id: "user_stopped", templateID: "deepseek-harness-container", deployment: "container", snapshot: containerSnapshot, release: containerRelease, artifact: "ghcr.io/runzhliu/deepseek-harness:0.1.1-rc.2@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", runtimeIdentity: "container-legacy"},
	}
	for _, fixture := range fixtures {
		id := fixture.id
		if _, err := db.Exec(`INSERT INTO port_forwards(forward_id,target_url,name,description,health_path,insecure_skip_verify,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms,access_mode) VALUES(?, 'http://127.0.0.1:3080','Keep','','/',0,1,2,3,'desktop_loopback')`, "pf_"+id); err != nil {
			t.Fatal(err)
		}
		serviceID := "mws_" + id
		snapshotDigest := sha256.Sum256([]byte(fixture.snapshot))
		releaseDigest := sha256.Sum256([]byte(fixture.release))
		if _, err := db.Exec(`INSERT INTO managed_web_services(service_id,template_id,template_source,template_revision,template_snapshot_json,template_snapshot_sha256,service_family_id,deployment,workspace_path,configuration_json,version,desired_state,observed_state,forward_id,runtime_identity,runtime_manifest_json,runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms,configuration_revision,configuration_sha256,release_identity_json,release_identity_sha256) VALUES(?,?, 'builtin',3,?,?,?,?,'/preserved/workspace',?,'0.1.1-rc.2','stopped','error',?,?,'{}',3080,?,'MANAGED_WEB_SERVICE_INTERNAL','preserved failure',4,5,2,?,?,?)`, serviceID, fixture.templateID, fixture.snapshot, hex.EncodeToString(snapshotDigest[:]), fixture.templateID, fixture.deployment, configuration, "pf_"+id, fixture.runtimeIdentity, fixture.artifact, hex.EncodeToString(configurationDigest[:]), fixture.release, hex.EncodeToString(releaseDigest[:])); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`INSERT INTO managed_web_service_operations(operation_id,service_id,request_id,request_fingerprint,action,state,stage,error_code,error_message,created_at_unix_ms,updated_at_unix_ms,finished_at_unix_ms,progress_detail_json) VALUES(?,?,?,?, 'start','failed','failed','MANAGED_WEB_SERVICE_INTERNAL','preserved failure',10,11,11,'{"schema_version":1}')`, "mop_recovery_"+id, serviceID, "runtime-recovery-"+serviceID+"-10", "fingerprint-"+id); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`INSERT INTO managed_web_service_operations(operation_id,service_id,request_id,request_fingerprint,action,state,stage,created_at_unix_ms,updated_at_unix_ms,finished_at_unix_ms,progress_detail_json) VALUES('mop_user_stop','mws_user_stopped','request-user-stop','fingerprint-user-stop','stop','succeeded','completed',12,13,13,'{"schema_version":1}')`); err != nil {
		t.Fatal(err)
	}
	customDigest := sha256.Sum256([]byte(customSnapshot))
	if _, err := db.Exec(`INSERT INTO managed_web_service_templates(template_id,name,description,source,deployment,version,revision,spec_json,spec_sha256,derived_from_template_id,derived_from_revision,service_family_id,created_at_unix_ms,updated_at_unix_ms) VALUES('custom-preserved','Custom preserved','','custom','host','1.0.0',4,?,?,'',0,'custom-preserved',20,21)`, customSnapshot, hex.EncodeToString(customDigest[:])); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	r, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	recovered, err := r.GetManagedService(context.Background(), "mws_recover")
	if err != nil || recovered == nil {
		t.Fatalf("recovered service=%+v err=%v", recovered, err)
	}
	if recovered.DesiredState != "running" || recovered.ObservedState != "error" || recovered.LastErrorCode != "MANAGED_WEB_SERVICE_INTERNAL" {
		t.Fatalf("automatic recovery intent was not restored: %+v", recovered)
	}
	if recovered.WorkspacePath != "/preserved/workspace" || recovered.ConfigurationJSON != configuration || recovered.ReleaseIdentityJSON != hostRelease || recovered.UpdatedAtUnixMs != 5 {
		t.Fatalf("v8 user data changed: %+v", recovered)
	}
	var document registryTemplateSpecDocument
	if err := json.Unmarshal([]byte(recovered.TemplateSnapshotJSON), &document); err != nil {
		t.Fatal(err)
	}
	if document.SchemaVersion != 3 || document.Host == nil || document.Host.Environment["DSH_HOME"] != "${REDEVEN_SERVICE_DATA_DIR}" || document.Host.Environment["HOME"] != "${REDEVEN_WORKSPACE}" {
		t.Fatalf("migrated DeepSeek Host environment = %+v", document.Host)
	}
	userStopped, err := r.GetManagedService(context.Background(), "mws_user_stopped")
	if err != nil || userStopped == nil || userStopped.DesiredState != "stopped" {
		t.Fatalf("later user stop was overwritten: service=%+v err=%v", userStopped, err)
	}
	if userStopped.TemplateSnapshotJSON != containerSnapshot {
		t.Fatalf("unrelated built-in container snapshot was rewritten: %s", userStopped.TemplateSnapshotJSON)
	}
	custom, err := r.GetManagedTemplate(context.Background(), "custom-preserved")
	if err != nil || custom == nil {
		t.Fatalf("custom template=%+v err=%v", custom, err)
	}
	if custom.SpecJSON != customSnapshot || custom.SpecSHA256 != hex.EncodeToString(customDigest[:]) {
		t.Fatalf("custom template document was rewritten: %+v", custom)
	}
}

func TestOpen_RollsBackFailedV8ToV9Migration(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV8TestSpec())
	if err != nil {
		t.Fatal(err)
	}
	snapshot := `{"schema_version":2,"kind":"host","endpoint":{"scheme":"http","path":"/","health_path":"/"},"host":{"start_script":"exec service","npm":{"package_name":"@deepseek-ai/dsh","version":"0.1.1-rc.2","registry_url":"https://registry.npmjs.org/","executable":"dsh"}}}`
	digest := sha256.Sum256([]byte(snapshot))
	if _, err := db.Exec(`INSERT INTO managed_web_service_templates(template_id,name,description,source,deployment,version,revision,spec_json,spec_sha256,derived_from_template_id,derived_from_revision,service_family_id,created_at_unix_ms,updated_at_unix_ms) VALUES('deepseek-harness-host','DeepSeek Harness','','builtin','host','0.1.1-rc.2',3,?,?,'',0,'deepseek-harness-host',1,1)`, snapshot, hex.EncodeToString(digest[:])); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	spec := registrySchemaSpec()
	original := spec.Migrations[8].Apply
	spec.Migrations[8].Apply = func(tx *sql.Tx) error {
		if err := original(tx); err != nil {
			return err
		}
		return errors.New("injected v9 migration failure")
	}
	if _, err := sqliteutil.Open(p, spec); err == nil {
		t.Fatal("migration unexpectedly succeeded")
	}
	after, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(before, after) {
		t.Fatal("failed v8 to v9 migration changed the database bytes")
	}
}

func TestOpen_RejectsV8TemplateSpecDriftWithoutModification(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV8TestSpec())
	if err != nil {
		t.Fatal(err)
	}
	snapshot := `{"schema_version":2,"kind":"host","endpoint":{"scheme":"http"},"host":{"start_script":"exec service"},"future_policy":true}`
	digest := sha256.Sum256([]byte(snapshot))
	if _, err := db.Exec(`INSERT INTO managed_web_service_templates(template_id,name,description,source,deployment,version,revision,spec_json,spec_sha256,derived_from_template_id,derived_from_revision,service_family_id,created_at_unix_ms,updated_at_unix_ms) VALUES('drifted-v8','Drifted','','custom','host','1.0.0',1,?,?,'',0,'drifted-v8',1,1)`, snapshot, hex.EncodeToString(digest[:])); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Open(p); err == nil {
		t.Fatal("drifted v8 template unexpectedly migrated")
	}
	after, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(before, after) {
		t.Fatal("rejected v8 template drift changed the database bytes")
	}
}

func TestOpen_RollsBackFailedV7ToV8Migration(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV7TestSpec())
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	spec := registrySchemaSpec()
	original := spec.Migrations[7].Apply
	spec.Migrations[7].Apply = func(tx *sql.Tx) error {
		if err := original(tx); err != nil {
			return err
		}
		return errors.New("injected v8 migration failure")
	}
	if _, err := sqliteutil.Open(p, spec); err == nil {
		t.Fatal("migration unexpectedly succeeded")
	}
	after, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(before, after) {
		t.Fatal("failed v7 to v8 migration changed the database bytes")
	}
}

func TestOpen_RejectsV7TemplateSpecDriftWithoutModification(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV7TestSpec())
	if err != nil {
		t.Fatal(err)
	}
	snapshot := `{"schema_version":1,"kind":"host","endpoint":{"scheme":"http"},"host":{"start_script":"exec service"},"future_policy":true}`
	digest := sha256.Sum256([]byte(snapshot))
	if _, err := db.Exec(`INSERT INTO managed_web_service_templates(template_id,name,description,source,deployment,version,revision,spec_json,spec_sha256,derived_from_template_id,derived_from_revision,service_family_id,created_at_unix_ms,updated_at_unix_ms) VALUES('drifted','Drifted','','custom','host','1.0.0',1,?,?,'',0,'drifted',1,1)`, snapshot, hex.EncodeToString(digest[:])); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Open(p); err == nil {
		t.Fatal("Open accepted a drifted v7 template spec")
	}
	after, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(before, after) {
		t.Fatal("failed v7 template migration changed the database bytes")
	}
}

func TestOpen_RejectsUnrecognizedV7LegacyDeploymentWithoutModification(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV7TestSpec())
	if err != nil {
		t.Fatal(err)
	}
	snapshot := `{"schema_version":1,"kind":"host","endpoint":{"scheme":"http"},"host":{"start_script":"exec service"}}`
	snapshotDigest := sha256.Sum256([]byte(snapshot))
	configuration := `{"schema_version":2,"parameters":{}}`
	configurationDigest := sha256.Sum256([]byte(configuration))
	if _, err := db.Exec(`INSERT INTO port_forwards(forward_id,target_url,name,description,health_path,insecure_skip_verify,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms,access_mode) VALUES('pf_legacy','http://127.0.0.1:3080','Legacy','','/',0,1,2,3,'desktop_loopback')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO managed_web_services(service_id,template_id,template_source,template_revision,template_snapshot_json,template_snapshot_sha256,service_family_id,deployment,workspace_path,configuration_json,version,desired_state,observed_state,forward_id,runtime_identity,runtime_manifest_json,runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms,configuration_revision,configuration_sha256) VALUES('mws_legacy','unrecognized-native','custom',1,?,?,'unrecognized-native','native','/workspace',?,'1.0.0','stopped','stopped','pf_legacy','','{}',3080,'/managed/bin/service','','',4,5,1,?)`, snapshot, hex.EncodeToString(snapshotDigest[:]), configuration, hex.EncodeToString(configurationDigest[:])); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Open(p); err == nil {
		t.Fatal("Open accepted an unrecognized legacy deployment")
	}
	after, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(before, after) {
		t.Fatal("failed legacy deployment migration changed the database bytes")
	}
}

func TestOpen_RollsBackFailedV6ToV7Migration(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV6TestSpec())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO port_forwards(forward_id,target_url,name,description,health_path,insecure_skip_verify,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms,access_mode) VALUES('pf_keep','http://127.0.0.1:3080','Keep','','',0,1,2,3,'desktop_loopback')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO managed_web_services(service_id,template_id,template_source,template_revision,template_snapshot_json,template_snapshot_sha256,service_family_id,deployment,workspace_path,configuration_json,version,desired_state,observed_state,forward_id,runtime_identity,runtime_manifest_json,runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms,configuration_revision,configuration_sha256) VALUES('mws_keep','deepseek-harness-host','builtin',1,'{}','','deepseek-harness','native','/workspace','{}','0.1.1-rc.2','stopped','stopped','pf_keep','','{}',3080,'','','',4,5,1,'')`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	spec := registrySchemaSpec()
	original := spec.Migrations[6].Apply
	spec.Migrations[6].Apply = func(tx *sql.Tx) error {
		if err := original(tx); err != nil {
			return err
		}
		return errors.New("injected migration failure")
	}
	if _, err := sqliteutil.Open(p, spec); err == nil {
		t.Fatal("migration unexpectedly succeeded")
	}
	after, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(after, before) {
		t.Fatal("failed migration changed the registry database bytes")
	}
	raw, err := sql.Open("sqlite", p)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var version int
	var family string
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := raw.QueryRow(`SELECT service_family_id FROM managed_web_services WHERE service_id='mws_keep'`).Scan(&family); err != nil {
		t.Fatal(err)
	}
	if version != 6 || family != "deepseek-harness" {
		t.Fatalf("failed migration changed registry state: version=%d family=%q", version, family)
	}
}

func TestOpen_RejectsV7DeepSeekFamilyDriftWithoutModification(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	r, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.db.Exec(`INSERT INTO port_forwards(forward_id,target_url,name,description,health_path,insecure_skip_verify,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms,access_mode) VALUES('pf_drift','http://127.0.0.1:3080','Drift','','',0,1,2,3,'desktop_loopback')`); err != nil {
		t.Fatal(err)
	}
	snapshot := `{}`
	snapshotDigest := sha256.Sum256([]byte(snapshot))
	configuration := `{"schema_version":2}`
	configurationDigest := sha256.Sum256([]byte(configuration))
	if _, err := r.db.Exec(`INSERT INTO managed_web_services(service_id,template_id,template_source,template_revision,template_snapshot_json,template_snapshot_sha256,service_family_id,deployment,workspace_path,configuration_json,version,desired_state,observed_state,forward_id,runtime_identity,runtime_manifest_json,runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms,configuration_revision,configuration_sha256) VALUES('mws_drift','deepseek-harness-host','builtin',1,?,?,'deepseek-harness','native','/workspace',?,'0.1.1-rc.2','stopped','stopped','pf_drift','','{}',3080,'','','',4,5,1,?)`, snapshot, hex.EncodeToString(snapshotDigest[:]), configuration, hex.EncodeToString(configurationDigest[:])); err != nil {
		t.Fatal(err)
	}
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Open(p); err == nil {
		t.Fatal("Open accepted mismatched DeepSeek Harness family identity")
	}
	after, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(before, after) {
		t.Fatal("failed v7 verification changed the database file")
	}
}

func TestOpen_RollsBackFailedV5ToV6Migration(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV5TestSpec())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO managed_web_service_operations(operation_id,service_id,request_id,request_fingerprint,action,delete_data,state,stage,progress_current,progress_total,cancel_requested,error_code,error_message,created_at_unix_ms,updated_at_unix_ms,finished_at_unix_ms) VALUES('mop_keep','mws_keep','request-keep','fingerprint','start',0,'failed','starting',4,7,0,'START_FAILED','Start failed.',10,11,12)`); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	spec := registrySchemaSpec()
	original := spec.Migrations[5].Apply
	spec.Migrations[5].Apply = func(tx *sql.Tx) error {
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
	var version, operations int
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := raw.QueryRow(`SELECT COUNT(1) FROM managed_web_service_operations WHERE operation_id='mop_keep' AND error_code='START_FAILED' AND finished_at_unix_ms=12`).Scan(&operations); err != nil {
		t.Fatal(err)
	}
	columns, err := tableColumns(raw, "managed_web_service_operations")
	if err != nil {
		t.Fatal(err)
	}
	if version != 5 || operations != 1 || slices.Contains(columns, "progress_detail_json") {
		t.Fatalf("failed migration changed v5 database: version=%d operations=%d columns=%v", version, operations, columns)
	}
}

func TestOpenRejectsCorruptV6OperationProgressDetail(t *testing.T) {
	t.Parallel()
	for name, detail := range map[string]string{
		"future schema":  `{"schema_version":999}`,
		"missing schema": `{}`,
		"unknown field":  `{"schema_version":1,"future":true}`,
	} {
		name, detail := name, detail
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			p := filepath.Join(t.TempDir(), "registry.sqlite")
			r, err := Open(p)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := r.db.Exec(`INSERT INTO managed_web_service_operations(operation_id,service_id,request_id,request_fingerprint,action,delete_data,state,stage,progress_current,progress_total,cancel_requested,error_code,error_message,created_at_unix_ms,updated_at_unix_ms,finished_at_unix_ms,progress_detail_json) VALUES('mop_optional','mws_optional','request','fingerprint','install',0,'failed','failed',2,7,0,'IMAGE_PULL_FAILED','Pull failed.',1,2,2,?)`, detail); err != nil {
				t.Fatal(err)
			}
			if err := r.Close(); err != nil {
				t.Fatal(err)
			}
			if reopened, err := Open(p); err == nil {
				_ = reopened.Close()
				t.Fatal("Open accepted a corrupt v6 progress detail")
			} else if !strings.Contains(err.Error(), "progress detail") {
				t.Fatalf("Open error = %v, want actionable progress detail diagnostic", err)
			}
		})
	}
}

func TestOpenRollsBackV5ToV6WhenManagedDocumentDigestIsInvalid(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, registryV5TestSpec())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO managed_web_service_templates(template_id,name,description,source,deployment,version,revision,spec_json,spec_sha256,derived_from_template_id,derived_from_revision,service_family_id,created_at_unix_ms,updated_at_unix_ms) VALUES('drifted','Drifted','','custom','host','1',1,'{"schema_version":1}',?,'',0,'drifted-family',1,1)`, strings.Repeat("0", 64)); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := Open(p); err == nil || !strings.Contains(err.Error(), "SHA-256 mismatch") {
		t.Fatalf("Open error=%v, want managed document digest diagnostic", err)
	}
	after, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(after, before) {
		t.Fatal("failed verification changed the registry database bytes")
	}
	raw, err := sql.Open("sqlite", p)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var version int
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	columns, err := tableColumns(raw, "managed_web_service_operations")
	if err != nil {
		t.Fatal(err)
	}
	if version != 5 || slices.Contains(columns, "progress_detail_json") {
		t.Fatalf("failed digest verification changed v5 database: version=%d columns=%v", version, columns)
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
	if _, err := db.Exec(`INSERT INTO managed_web_services(service_id,template_id,deployment,workspace_path,version,desired_state,observed_state,forward_id,runtime_identity,runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms) VALUES('mws_keep','deepseek-harness','docker','/workspace','0.1.1-rc.2','running','stopped','pf_keep','container:one',3080,?,'','',4,5)`, "ghcr.io/example/deepseek@sha256:"+strings.Repeat("a", 64)); err != nil {
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
	if service == nil || service.TemplateID != "deepseek-harness-container" || service.TemplateSource != "builtin" || service.TemplateRevision != 1 || service.ServiceFamilyID != "deepseek-harness-container" || service.ForwardID != "pf_keep" {
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
	if _, err := r.db.Exec(`PRAGMA user_version=10`); err != nil {
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
	if version != 10 || count != 1 {
		t.Fatalf("future database changed: version=%d forward_count=%d", version, count)
	}
}

func TestOpenRejectsWrongRegistryKindWithoutChangingIt(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "registry.sqlite")
	db, err := sqliteutil.Open(p, sqliteutil.Spec{
		Kind:           "other_registry",
		CurrentVersion: 1,
		Migrations: []sqliteutil.Migration{{FromVersion: 0, ToVersion: 1, Apply: func(tx *sql.Tx) error {
			_, err := tx.Exec(`CREATE TABLE other_records(record_id TEXT PRIMARY KEY)`)
			return err
		}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO other_records(record_id) VALUES('keep')`); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	if _, err := Open(p); err == nil || !strings.Contains(err.Error(), "wrong database kind") {
		t.Fatalf("Open error=%v, want wrong database kind", err)
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
	if err := raw.QueryRow(`SELECT COUNT(1) FROM other_records WHERE record_id='keep'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if version != 1 || count != 1 {
		t.Fatalf("wrong-kind database changed: version=%d records=%d", version, count)
	}
}

func TestOpenV8IsIdempotent(t *testing.T) {
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
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}

	for attempt := 0; attempt < 2; attempt++ {
		reopened, err := Open(p)
		if err != nil {
			t.Fatalf("Open attempt %d: %v", attempt+1, err)
		}
		forward, err := reopened.GetForward(context.Background(), "keep")
		if err != nil || forward == nil || forward.TargetURL != "http://127.0.0.1:3000" {
			_ = reopened.Close()
			t.Fatalf("Open attempt %d forward=%+v err=%v", attempt+1, forward, err)
		}
		columns, err := tableColumns(reopened.db, "managed_web_service_operations")
		progressDetailColumns := 0
		for _, column := range columns {
			if column == "progress_detail_json" {
				progressDetailColumns++
			}
		}
		if err != nil || progressDetailColumns != 1 {
			_ = reopened.Close()
			t.Fatalf("Open attempt %d operation columns=%v err=%v", attempt+1, columns, err)
		}
		if err := reopened.Close(); err != nil {
			t.Fatal(err)
		}
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

func TestFinalizeManagedOperationCommitsOperationAndServiceErrorAtomically(t *testing.T) {
	t.Parallel()
	r, err := Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = r.Close() })
	service := ManagedService{ServiceID: "mws_finalize", TemplateID: "template", TemplateSource: "custom", TemplateRevision: 1, ServiceFamilyID: "family", Deployment: "container", WorkspacePath: "/workspace", Version: "1", DesiredState: "running", ObservedState: "installing", ForwardID: "pf_finalize", RuntimePort: 3000}
	forward := Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:3000"}
	op := ManagedOperation{OperationID: "mop_finalize", ServiceID: service.ServiceID, RequestID: "request-finalize", RequestFingerprint: "fingerprint", Action: "install", State: "pending", Stage: "pulling", ProgressTotal: 7}
	if err := r.CreateManagedServiceWithOperation(context.Background(), service, forward, op); err != nil {
		t.Fatal(err)
	}
	if _, err := r.db.Exec(`CREATE TRIGGER reject_service_finalize BEFORE UPDATE ON managed_web_services BEGIN SELECT RAISE(ABORT, 'injected service update failure'); END`); err != nil {
		t.Fatal(err)
	}
	op.State, op.Stage, op.ErrorCode, op.ErrorMessage, op.FinishedAtUnixMs = "failed", "failed", "IMAGE_PULL_FAILED", "The image could not be pulled.", 12
	desired, observed := "stopped", "error"
	revision, snapshot, snapshotHash, version := int64(2), `{"revision":2}`, strings.Repeat("a", 64), "2"
	patch := ManagedServicePatch{TemplateRevision: &revision, TemplateSnapshotJSON: &snapshot, TemplateSnapshotSHA256: &snapshotHash, Version: &version, DesiredState: &desired, ObservedState: &observed, LastErrorCode: &op.ErrorCode, LastErrorMessage: &op.ErrorMessage}
	if err := r.FinalizeManagedOperation(context.Background(), op, patch); err == nil {
		t.Fatal("FinalizeManagedOperation unexpectedly ignored the service update failure")
	}
	storedOperation, err := r.GetManagedOperation(context.Background(), op.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	storedService, err := r.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if storedOperation == nil || storedOperation.State != "pending" || storedOperation.FinishedAtUnixMs != 0 || storedService == nil || storedService.TemplateRevision != 1 || storedService.Version != "1" || storedService.ObservedState != "installing" || storedService.LastErrorCode != "" {
		t.Fatalf("failed finalization partially committed: operation=%+v service=%+v", storedOperation, storedService)
	}
	if _, err := r.db.Exec(`DROP TRIGGER reject_service_finalize`); err != nil {
		t.Fatal(err)
	}
	if err := r.FinalizeManagedOperation(context.Background(), op, patch); err != nil {
		t.Fatal(err)
	}
	storedOperation, _ = r.GetManagedOperation(context.Background(), op.OperationID)
	storedService, _ = r.GetManagedService(context.Background(), service.ServiceID)
	if storedOperation == nil || storedOperation.State != "failed" || storedService == nil || storedService.TemplateRevision != 2 || storedService.TemplateSnapshotJSON != snapshot || storedService.TemplateSnapshotSHA256 != snapshotHash || storedService.Version != "2" || storedService.ObservedState != "error" || storedService.LastErrorCode != "IMAGE_PULL_FAILED" {
		t.Fatalf("successful finalization did not commit together: operation=%+v service=%+v", storedOperation, storedService)
	}
}

func TestUpdateManagedServiceCommitsTemplateAndRuntimeIdentityTogether(t *testing.T) {
	t.Parallel()
	r, err := Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = r.Close() })
	service := ManagedService{
		ServiceID: "mws_update", TemplateID: "template", TemplateSource: "builtin", TemplateRevision: 1,
		TemplateSnapshotJSON: `{"revision":1}`, TemplateSnapshotSHA256: "old-hash", ServiceFamilyID: "family",
		Deployment: "container", WorkspacePath: t.TempDir(), ConfigurationJSON: `{}`, Version: "1",
		DesiredState: "running", ObservedState: "running", ForwardID: "pf_update", RuntimeIdentity: "old-container",
		RuntimeManifestJSON: `{}`, RuntimePort: 43123, ArtifactReference: "image@sha256:old",
	}
	if err := r.CreateManagedService(context.Background(), service, Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:43123"}); err != nil {
		t.Fatal(err)
	}
	revision := int64(2)
	snapshot, hash, configuration, version := `{"revision":2}`, "new-hash", `{"accepted_notice_revisions":{"risk":2}}`, "2"
	runtimeID, artifact, manifest := "new-container", "image@sha256:new", `{}`
	if err := r.UpdateManagedService(context.Background(), service.ServiceID, ManagedServicePatch{
		TemplateRevision: &revision, TemplateSnapshotJSON: &snapshot, TemplateSnapshotSHA256: &hash,
		ConfigurationJSON: &configuration, Version: &version, RuntimeIdentity: &runtimeID,
		ArtifactReference: &artifact, RuntimeManifestJSON: &manifest,
	}); err != nil {
		t.Fatal(err)
	}
	got, err := r.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if got.TemplateRevision != revision || got.TemplateSnapshotJSON != snapshot || got.TemplateSnapshotSHA256 != hash || got.ConfigurationJSON != configuration || got.Version != version || got.RuntimeIdentity != runtimeID || got.ArtifactReference != artifact || got.RuntimeManifestJSON != manifest {
		t.Fatalf("updated managed service = %+v", got)
	}
}

func TestManagedServiceConfigurationUsesRevisionCASAndStableResources(t *testing.T) {
	t.Parallel()
	r, err := Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	service := ManagedService{ServiceID: "mws_config", TemplateID: "template", TemplateSource: "custom", TemplateRevision: 1, TemplateSnapshotJSON: `{}`, TemplateSnapshotSHA256: "snapshot", ServiceFamilyID: "family", Deployment: "container", WorkspacePath: t.TempDir(), ConfigurationJSON: `{"schema_version":2}`, DesiredState: "stopped", ObservedState: "stopped", ForwardID: "pf_config"}
	if err := r.CreateManagedService(context.Background(), service, Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:3080"}); err != nil {
		t.Fatal(err)
	}
	next := `{"schema_version":2,"parameters":{"PORT":"3000"}}`
	digestBytes := sha256.Sum256([]byte(next))
	digest := hex.EncodeToString(digestBytes[:])
	revision, err := r.UpdateManagedServiceConfiguration(context.Background(), service.ServiceID, 1, next, digest)
	if err != nil || revision != 2 {
		t.Fatalf("revision=%d err=%v", revision, err)
	}
	if _, err := r.UpdateManagedServiceConfiguration(context.Background(), service.ServiceID, 1, next, digest); err == nil {
		t.Fatal("stale configuration revision was accepted")
	}
	resource := ManagedServiceResource{ServiceID: service.ServiceID, ResourceID: "data", Kind: "volume", EngineIdentity: "redeven-data", CreatedAtUnixMs: 123}
	if err := r.PutManagedServiceResource(context.Background(), resource); err != nil {
		t.Fatal(err)
	}
	resources, err := r.ListManagedServiceResources(context.Background(), service.ServiceID)
	if err != nil || len(resources) != 1 || resources[0] != resource {
		t.Fatalf("resources=%v err=%v", resources, err)
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

func registryV3TestSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           registrySchemaKind,
		CurrentVersion: 3,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA foreign_keys=ON;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: migrateRegistryToV1},
			{FromVersion: 1, ToVersion: 2, Apply: migrateRegistryToV2},
			{FromVersion: 2, ToVersion: 3, Apply: migrateRegistryToV3},
		},
		Verify: func(tx *sql.Tx) error {
			return verifyRegistryShape(tx, []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms"}, "v3")
		},
	}
}

func registryV4TestSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind: registrySchemaKind, CurrentVersion: 4,
		Pragmas: []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA foreign_keys=ON;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: migrateRegistryToV1},
			{FromVersion: 1, ToVersion: 2, Apply: migrateRegistryToV2},
			{FromVersion: 2, ToVersion: 3, Apply: migrateRegistryToV3},
			{FromVersion: 3, ToVersion: 4, Apply: migrateRegistryToV4},
		},
		Verify: func(tx *sql.Tx) error {
			return verifyRegistryShape(tx, []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms", "access_mode"}, "v4")
		},
	}
}

func registryV5TestSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind: registrySchemaKind, CurrentVersion: 5,
		Pragmas: []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA foreign_keys=ON;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: migrateRegistryToV1},
			{FromVersion: 1, ToVersion: 2, Apply: migrateRegistryToV2},
			{FromVersion: 2, ToVersion: 3, Apply: migrateRegistryToV3},
			{FromVersion: 3, ToVersion: 4, Apply: migrateRegistryToV4},
			{FromVersion: 4, ToVersion: 5, Apply: migrateRegistryToV5},
		},
		Verify: func(tx *sql.Tx) error {
			return verifyRegistryShape(tx, []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms", "access_mode"}, "v5")
		},
	}
}

func registryV6TestSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind: registrySchemaKind, CurrentVersion: 6,
		Pragmas: []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA foreign_keys=ON;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: migrateRegistryToV1},
			{FromVersion: 1, ToVersion: 2, Apply: migrateRegistryToV2},
			{FromVersion: 2, ToVersion: 3, Apply: migrateRegistryToV3},
			{FromVersion: 3, ToVersion: 4, Apply: migrateRegistryToV4},
			{FromVersion: 4, ToVersion: 5, Apply: migrateRegistryToV5},
			{FromVersion: 5, ToVersion: 6, Apply: migrateRegistryToV6},
		},
		Verify: func(tx *sql.Tx) error {
			return verifyRegistryShape(tx, []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms", "access_mode"}, "v6")
		},
	}
}

func registryV7TestSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind: registrySchemaKind, CurrentVersion: 7,
		Pragmas: []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA foreign_keys=ON;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: migrateRegistryToV1},
			{FromVersion: 1, ToVersion: 2, Apply: migrateRegistryToV2},
			{FromVersion: 2, ToVersion: 3, Apply: migrateRegistryToV3},
			{FromVersion: 3, ToVersion: 4, Apply: migrateRegistryToV4},
			{FromVersion: 4, ToVersion: 5, Apply: migrateRegistryToV5},
			{FromVersion: 5, ToVersion: 6, Apply: migrateRegistryToV6},
			{FromVersion: 6, ToVersion: 7, Apply: migrateRegistryToV7},
		},
		Verify: func(tx *sql.Tx) error {
			return verifyRegistryShape(tx, []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms", "access_mode"}, "v7")
		},
	}
}

func registryV8TestSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind: registrySchemaKind, CurrentVersion: 8,
		Pragmas: []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA foreign_keys=ON;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: migrateRegistryToV1},
			{FromVersion: 1, ToVersion: 2, Apply: migrateRegistryToV2},
			{FromVersion: 2, ToVersion: 3, Apply: migrateRegistryToV3},
			{FromVersion: 3, ToVersion: 4, Apply: migrateRegistryToV4},
			{FromVersion: 4, ToVersion: 5, Apply: migrateRegistryToV5},
			{FromVersion: 5, ToVersion: 6, Apply: migrateRegistryToV6},
			{FromVersion: 6, ToVersion: 7, Apply: migrateRegistryToV7},
			{FromVersion: 7, ToVersion: 8, Apply: migrateRegistryToV8},
		},
		Verify: func(tx *sql.Tx) error {
			if err := verifyRegistryShape(tx, []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms", "access_mode"}, "v8"); err != nil {
				return err
			}
			return verifyRegistryV8Documents(tx)
		},
	}
}

func assertRegistryTemplateSpecVersion(t *testing.T, raw, digest string, wantVersion int) {
	t.Helper()
	var document struct {
		SchemaVersion int `json:"schema_version"`
	}
	if err := json.Unmarshal([]byte(raw), &document); err != nil {
		t.Fatalf("decode migrated template spec: %v", err)
	}
	if document.SchemaVersion != wantVersion {
		t.Fatalf("migrated template spec schema_version = %d, want %d", document.SchemaVersion, wantVersion)
	}
	sum := sha256.Sum256([]byte(raw))
	if digest != hex.EncodeToString(sum[:]) {
		t.Fatalf("migrated template spec digest = %q", digest)
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
