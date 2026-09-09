package registry

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func legacyRegistryWithTemplate(t *testing.T, path, raw string) {
	t.Helper()
	db, err := sqliteutil.Open(path, sqliteutil.Spec{Kind: registrySchemaKind, CurrentVersion: 1, MinimumVersion: 1, Initialize: initializeRegistryV1, Verify: verifyRegistryV1})
	if err != nil {
		t.Fatal(err)
	}
	registry := &Registry{db: db}
	digest := sha256.Sum256([]byte(raw))
	if err := registry.CreateManagedTemplate(context.Background(), ManagedTemplate{TemplateID: "template-upgrade", Name: "Preserved custom service", Source: "custom", Deployment: "host", Revision: 7, SpecJSON: raw, SpecSHA256: hex.EncodeToString(digest[:]), ServiceFamilyID: "family-upgrade"}); err != nil {
		t.Fatal(err)
	}
	if err := registry.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestRegistryUpgradePreservesCustomTemplateAndConvertsLiteralPrefix(t *testing.T) {
	for _, prefix := range []string{"", "ready: ", `quoted'\t\\literal: `} {
		t.Run(prefix, func(t *testing.T) {
			host := map[string]any{"start_script": "exec example-server"}
			if prefix != "" {
				host["open_target"] = map[string]string{"mode": "startup_output_url", "line_prefix": prefix}
			}
			raw, _ := json.Marshal(map[string]any{"schema_version": 5, "kind": "host", "endpoint": map[string]string{"scheme": "http", "path": "/dashboard"}, "host": host})
			path := filepath.Join(t.TempDir(), "registry.sqlite")
			legacyRegistryWithTemplate(t, path, string(raw))
			registry, err := Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer registry.Close()
			template, err := registry.GetManagedTemplate(context.Background(), "template-upgrade")
			if err != nil || template.Revision != 7 || template.Name != "Preserved custom service" || template.ServiceFamilyID != "family-upgrade" {
				t.Fatalf("template metadata changed: %v", err)
			}
			var converted struct {
				SchemaVersion int `json:"schema_version"`
				Host          struct {
					Start      string `json:"start_script"`
					After      string `json:"after_start_script"`
					Open       string `json:"open_script"`
					OutputMode string `json:"output_mode"`
				} `json:"host"`
			}
			if err := json.Unmarshal([]byte(template.SpecJSON), &converted); err != nil {
				t.Fatal(err)
			}
			if converted.SchemaVersion != 6 || converted.Host.Start != "exec example-server" || strings.Contains(template.SpecJSON, "open_target") {
				t.Fatal("template was not mechanically converted")
			}
			if prefix == "" {
				if converted.Host.After != "" || converted.Host.Open != "" {
					t.Fatal("static template acquired a hook")
				}
				return
			}
			root := t.TempDir()
			output := filepath.Join(root, "output")
			const target = "http://127.0.0.1:39191/?token=private"
			if err := os.WriteFile(output, []byte(prefix+target+"\n"), 0600); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			cmd := exec.CommandContext(ctx, "/bin/sh", "-eu", "-c", converted.Host.After)
			cmd.Env = append(os.Environ(), "REDEVEN_SERVICE_RUN_DIR="+root, "REDEVEN_SERVICE_OUTPUT_FILE="+output)
			if err := cmd.Run(); err != nil {
				t.Fatal(err)
			}
			saved, err := os.ReadFile(filepath.Join(root, "open-url"))
			if err != nil || string(saved) != target+"\n" {
				t.Fatal("literal prefix changed during conversion")
			}
		})
	}
}

func TestRegistryHookMigrationFailureRollsBack(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.sqlite")
	raw := `{"schema_version":5,"kind":"host","endpoint":{"scheme":"http"},"host":{"start_script":"exec server","open_target":{"mode":"startup_output_url","line_prefix":"ready: "}}}`
	legacyRegistryWithTemplate(t, path, raw)
	spec := registrySchemaSpec()
	spec.Migrations[1].Apply = func(tx *sql.Tx) error {
		if err := migrateRegistryV2ToV3(tx); err != nil {
			return err
		}
		_, err := tx.Exec("INSERT INTO table_that_does_not_exist VALUES (1)")
		return err
	}
	if db, err := sqliteutil.Open(path, spec); err == nil {
		db.Close()
		t.Fatal("injected migration failure succeeded")
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var version int
	var retained string
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT spec_json FROM managed_web_service_templates").Scan(&retained); err != nil {
		t.Fatal(err)
	}
	if version != 1 || retained != raw {
		t.Fatal("failed migration did not roll back version and template together")
	}
	if registry, err := Open(path); err != nil {
		t.Fatal(err)
	} else {
		registry.Close()
	}
}

func TestTemplateHookMigrationRejectsUnknownOrMalformedContracts(t *testing.T) {
	for _, raw := range []string{
		`{"schema_version":5,"kind":"host","endpoint":{"scheme":"http","unknown":true},"host":{"start_script":"exec server"}}`,
		`{"schema_version":5,"kind":"host","endpoint":{"scheme":"http"},"host":{"start_script":"exec server","npm":{"package_name":42}}}`,
		`{"schema_version":5,"kind":"host","endpoint":{"scheme":"http"},"host":{"start_script":"exec server","environment":{"KEY":42}}}`,

		`{"schema_version":5,"kind":"host","unexpected":true,"host":{"start_script":"exec server"}}`,
		`{"schema_version":5,"kind":"host","host":{"start_script":"exec server","open_script":"echo unsafe"}}`,
		`{"schema_version":5,"kind":"container","host":{"start_script":"exec server"}}`,
		`{"schema_version":5,"kind":"host","host":{"start_script":42}}`,
		`{"schema_version":5,"kind":"host","host":{"start_script":"exec server","open_target":{"mode":"unknown","line_prefix":"ready: "}}}`,
	} {
		if _, err := migrateTemplateV5([]byte(raw)); err == nil {
			t.Fatal("migration accepted an invalid legacy contract")
		}
	}
}

func TestRegistryHookUpgradePreservesInstancesRoutesAndHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.sqlite")
	raw := `{"schema_version":5,"kind":"host","endpoint":{"scheme":"http"},"host":{"start_script":"exec server"}}`
	legacyRegistryWithTemplate(t, path, raw)
	db, err := sqliteutil.Open(path, sqliteutil.Spec{Kind: registrySchemaKind, CurrentVersion: 2, MinimumVersion: 1, Initialize: initializeCurrentRegistry, Migrations: []sqliteutil.Migration{{FromVersion: 1, ToVersion: 2, Apply: migrateRegistryV1ToV2}}, Verify: verifyRegistryV2})
	if err != nil {
		t.Fatal(err)
	}
	old := &Registry{db: db}
	binding := `{"schema_version":2,"service_family_id":"family-upgrade","deployment":"container","container":{"name":"redeven-mws-retained"}}`
	service := ManagedService{ServiceID: "mws_retained", TemplateID: "template-upgrade", WorkspacePath: "/workspace/retained", WorkspaceOwnership: "user_selected", RuntimeBindingJSON: binding, RuntimeBindingSHA256: digest(binding), DesiredState: "running", ObservedState: "error", RuntimeIdentity: "retained-process-identity", RuntimeSpecSHA256: digest("applied-v5-spec"), ForwardID: "pf-retained", LastErrorCode: "HOST_PROCESS_IDENTITY_MISMATCH", ConfigurationJSON: `{"schema_version":2,"parameters":{"MODE":"retained"}}`}
	operation := ManagedOperation{OperationID: "mop_retained", ServiceID: service.ServiceID, RequestID: "request-retained", Action: "start", State: "failed", Stage: "failed", ErrorCode: service.LastErrorCode}
	if err := old.CreateManagedServiceWithOperation(context.Background(), service, Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:3080/retained", AccessMode: AccessModeUnifiedProxy}, operation); err != nil {
		t.Fatal(err)
	}
	beforeService := &ManagedService{}
	if err := scanManagedService(old.db.QueryRow(`SELECT `+strings.TrimSuffix(managedServiceSelectColumns, ",management_state,archived_forward_json")+`,'active','{}' FROM managed_web_services WHERE service_id=?`, service.ServiceID), beforeService); err != nil {
		t.Fatal(err)
	}
	beforeForward, _ := old.GetForward(context.Background(), service.ForwardID)
	beforeOperation, _ := old.GetManagedOperation(context.Background(), operation.OperationID)
	if err := old.Close(); err != nil {
		t.Fatal(err)
	}
	current, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer current.Close()
	afterService, _ := current.GetManagedService(context.Background(), service.ServiceID)
	afterForward, _ := current.GetForward(context.Background(), service.ForwardID)
	afterOperation, _ := current.GetManagedOperation(context.Background(), operation.OperationID)
	beforeService.ManagementState, beforeService.ArchivedForwardJSON = "active", "{}"
	before, _ := json.Marshal([]any{beforeService, beforeForward, beforeOperation})
	after, _ := json.Marshal([]any{afterService, afterForward, afterOperation})
	if string(before) != string(after) || afterService.ConfigurationJSON != beforeService.ConfigurationJSON || afterService.RuntimeBindingJSON != beforeService.RuntimeBindingJSON {
		t.Fatal("template migration modified existing instance, route, configuration, or operation history")
	}
}
