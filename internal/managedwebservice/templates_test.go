package managedwebservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	servicetemplates "github.com/floegence/redeven-service-templates"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestBuiltinCatalogRejectsUntrustedOrUnsupportedBundle(t *testing.T) {
	t.Parallel()
	raw := servicetemplates.Bundle()
	validDigest := sha256.Sum256(raw)
	tests := []struct {
		name    string
		raw     []byte
		version string
		digest  string
	}{
		{name: "digest mismatch", raw: raw, version: servicetemplates.Version, digest: strings.Repeat("0", 64)},
		{name: "future catalog version", raw: raw, version: "v999.0.0", digest: hex.EncodeToString(validDigest[:])},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := loadBuiltinCatalog(test.raw, test.version, test.digest); err == nil {
				t.Fatal("untrusted catalog was accepted")
			}
		})
	}

	var drifted map[string]any
	if err := json.Unmarshal(raw, &drifted); err != nil {
		t.Fatal(err)
	}
	drifted["unexpected"] = true
	driftedRaw, err := json.Marshal(drifted)
	if err != nil {
		t.Fatal(err)
	}
	driftedDigest := sha256.Sum256(driftedRaw)
	if _, err := loadBuiltinCatalog(driftedRaw, servicetemplates.Version, hex.EncodeToString(driftedDigest[:])); err == nil {
		t.Fatal("schema-drifted catalog was accepted")
	}
}

func TestDuplicateTemplateCreatesIndependentEditableDefinition(t *testing.T) {
	t.Parallel()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	scope, stateDir := newManagedServiceTestScope(t)
	manager := &Manager{
		registry:  registry,
		scope:     scope,
		stateDir:  stateDir,
		downloads: defaultPackageDownloadClient(),
	}
	source, err := manager.CreateTemplate(context.Background(), TemplateWriteRequest{
		RequestID: "request-template-source",
		Name:      "Local preview",
		Spec: TemplateSpec{
			SchemaVersion: templateSpecSchemaVersion,
			Kind:          DeploymentHost,
			Endpoint:      WebEndpointSpec{Scheme: "http", HealthPath: "/health"},
			Host:          &HostTemplateSpec{StartScript: `exec preview --port "$REDEVEN_SERVICE_PORT"`},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	copy, err := manager.DuplicateTemplate(context.Background(), source.TemplateID, TemplateDuplicateRequest{RequestID: "request-template-copy", Name: "Local preview copy"})
	if err != nil {
		t.Fatal(err)
	}
	if copy.Source != "custom" || !copy.Editable || copy.DerivedFromTemplateID != source.TemplateID || copy.DerivedFromRevision != source.Revision || copy.ServiceFamilyID == source.ServiceFamilyID {
		t.Fatalf("duplicate = %+v, source = %+v", copy, source)
	}
	if source.DefaultWorkspacePath == "" || copy.DefaultWorkspacePath == "" || source.DefaultWorkspacePath == copy.DefaultWorkspacePath {
		t.Fatalf("independent template workspaces = %q, %q", source.DefaultWorkspacePath, copy.DefaultWorkspacePath)
	}
	if filepath.Base(source.DefaultWorkspacePath) != source.TemplateID || filepath.Base(copy.DefaultWorkspacePath) != copy.TemplateID {
		t.Fatalf("template-specific workspace suffixes = %q, %q", source.DefaultWorkspacePath, copy.DefaultWorkspacePath)
	}
	if copy.Spec == nil || copy.Spec.Host == nil || copy.Spec.Host.StartScript != source.Spec.Host.StartScript {
		t.Fatalf("duplicate definition = %+v", copy.Spec)
	}
	replayed, err := manager.DuplicateTemplate(context.Background(), source.TemplateID, TemplateDuplicateRequest{RequestID: "request-template-copy", Name: "Local preview copy"})
	if err != nil || replayed.TemplateID != copy.TemplateID {
		t.Fatalf("duplicate idempotent replay = %+v, err=%v", replayed, err)
	}
}

func TestHostLifecyclePlanUsesRuntimeCommandsWithoutPersistingProjection(t *testing.T) {
	t.Parallel()
	spec := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"},
		Host: &HostTemplateSpec{
			StartScript: `exec "$REDEVEN_INSTALL_EXECUTABLE" serve --host "$REDEVEN_SERVICE_HOST" --port "$REDEVEN_SERVICE_PORT" --no-open`,
			NPM:         &NPMHostPackageSpec{PackageName: "example-service", Version: "1.2.3", RegistryURL: "https://registry.npmjs.org/", Executable: "example-service"},
		},
	}
	plan := hostLifecyclePlan(spec)
	if plan == nil || plan.SchemaVersion != hostLifecyclePlanSchemaVersion || plan.Driver != "npm_host" || plan.RuntimeBundle != "node-"+nodeVersion || plan.Package == nil || plan.NPM == nil {
		t.Fatalf("npm Host lifecycle plan = %+v", plan)
	}
	if len(plan.Install.Steps) != 6 || !strings.Contains(plan.Install.Steps[2].CommandTemplate, "install example-service@1.2.3") || !strings.Contains(plan.Install.Steps[2].CommandTemplate, "--package-lock=false --ignore-scripts") || !strings.Contains(plan.Install.Steps[4].CommandTemplate, "rebuild --dangerously-allow-all-scripts") {
		t.Fatalf("npm Host install plan = %+v", plan.Install)
	}
	if !strings.Contains(plan.Start.Steps[0].CommandTemplate, "--no-open") || !strings.Contains(spec.Host.StartScript, "--no-open") {
		t.Fatalf("npm Host start plan=%+v script=%q", plan.Start, spec.Host.StartScript)
	}
	if len(plan.Uninstall.Steps) != 4 || plan.Uninstall.Steps[0].Kind != "terminate_managed_process_group" || plan.Uninstall.Steps[1].Kind != "remove_managed_installation" || plan.Uninstall.Steps[2].Kind != "remove_managed_logs" || plan.Uninstall.Steps[3].Kind != "remove_managed_data_on_request" {
		t.Fatalf("npm Host uninstall plan = %+v", plan.Uninstall)
	}
	encoded, err := json.Marshal(spec)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "lifecycle_plan") {
		t.Fatalf("persistent template spec contains lifecycle projection: %s", encoded)
	}
}

func TestHostLifecyclePlanSeparatesManagedWorkFromTemplateHooks(t *testing.T) {
	t.Parallel()
	spec := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion,
		Kind:          DeploymentHost,
		Endpoint:      WebEndpointSpec{Scheme: "http"},
		Host: &HostTemplateSpec{
			Artifact:        &HostArtifactSpec{DownloadURL: "https://downloads.example.invalid/service.tar.gz", SizeBytes: 1024, SHA256: strings.Repeat("a", 64), ExecutableRelPath: "bin/service"},
			InstallScript:   `curl "https://private.example.invalid/install?token=must-not-leak"`,
			StartScript:     `exec /Users/alice/private/bin/service`,
			StopScript:      `service stop --credential must-not-leak`,
			UninstallScript: `service clean /Users/alice/private`,
		},
	}
	plan := hostLifecyclePlan(spec)
	if plan == nil || plan.Driver != "host_script" || plan.Install.Ownership != "redeven_with_template_hook" || plan.Start.Ownership != "template" {
		t.Fatalf("host lifecycle plan = %+v", plan)
	}
	if got := plan.Install.Steps[len(plan.Install.Steps)-1]; got.Kind != "run_template_script" || got.CommandTemplate != "<after-install-hook>" {
		t.Fatalf("install hook step = %+v", got)
	}
	if got := plan.Stop.Steps[0]; got.Kind != "run_template_script" || got.CommandTemplate != "<before-stop-hook>" {
		t.Fatalf("stop hook step = %+v", got)
	}
	if got := plan.Uninstall.Steps[0]; got.Kind != "run_template_script" || got.CommandTemplate != "<before-stop-hook>" {
		t.Fatalf("uninstall stop hook step = %+v", got)
	}
	if got := plan.Uninstall.Steps[2]; got.Kind != "run_template_script" || got.CommandTemplate != "<before-uninstall-hook>" {
		t.Fatalf("uninstall hook step = %+v", got)
	}
	encoded, err := json.Marshal(plan)
	if err != nil {
		t.Fatal(err)
	}
	for _, privateValue := range []string{spec.Host.InstallScript, spec.Host.StopScript, spec.Host.UninstallScript} {
		if strings.Contains(string(encoded), privateValue) {
			t.Fatalf("lifecycle plan leaked template script %q: %s", privateValue, encoded)
		}
	}
}

func TestHostLifecyclePlanRedactsArtifactURLQuery(t *testing.T) {
	t.Parallel()
	spec := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion,
		Kind:          DeploymentHost,
		Endpoint:      WebEndpointSpec{Scheme: "http"},
		Host: &HostTemplateSpec{
			Artifact: &HostArtifactSpec{
				DownloadURL:       "https://downloads.example.invalid/service.tar.gz?token=must-not-leak",
				SizeBytes:         1024,
				SHA256:            strings.Repeat("a", 64),
				ExecutableRelPath: "bin/service",
			},
			StartScript: "exec service",
		},
	}
	plan := hostLifecyclePlan(spec)
	if plan == nil || plan.Package == nil || strings.Contains(plan.Package.Reference, "token") || plan.Package.Reference != "service.tar.gz@sha256:"+strings.Repeat("a", 64) {
		t.Fatalf("artifact lifecycle plan = %+v", plan)
	}
}

func TestHostLifecyclePlanDescribesPureScriptRuntimeOwnership(t *testing.T) {
	t.Parallel()
	spec := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion,
		Kind:          DeploymentHost,
		Endpoint:      WebEndpointSpec{Scheme: "http"},
		Host:          &HostTemplateSpec{StartScript: "exec service"},
	}
	plan := hostLifecyclePlan(spec)
	if plan == nil || plan.Install.Ownership != lifecycleOwnershipRedeven || len(plan.Install.Steps) != 1 || plan.Install.Steps[0].Kind != "prepare_managed_directories" {
		t.Fatalf("pure-script install plan = %+v", plan)
	}
	if len(plan.Uninstall.Steps) != 4 || plan.Uninstall.Steps[0].Kind != "terminate_managed_process_group" || plan.Uninstall.Steps[1].Kind != "remove_managed_installation" || plan.Uninstall.Steps[2].Kind != "remove_managed_logs" || plan.Uninstall.Steps[3].Kind != "remove_managed_data_on_request" {
		t.Fatalf("pure-script uninstall plan = %+v", plan.Uninstall)
	}
}

func TestDuplicateBuiltInHostRetainsDeclaredRuntime(t *testing.T) {
	t.Parallel()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	scope, stateDir := newManagedServiceTestScope(t)
	catalog, err := LoadBuiltinCatalog()
	if err != nil {
		t.Fatal(err)
	}
	manager := &Manager{registry: registry, scope: scope, stateDir: stateDir, downloads: defaultPackageDownloadClient(), catalog: catalog}
	templates, err := manager.Catalog(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var source *Template
	for index := range templates {
		if templates[index].Deployment == DeploymentHost && templates[index].Spec != nil && templates[index].Spec.Host != nil {
			source = &templates[index]
			break
		}
	}
	if source == nil {
		t.Fatal("released catalog has no Host template")
	}
	copy, err := manager.DuplicateTemplate(context.Background(), source.TemplateID, TemplateDuplicateRequest{
		RequestID: "request-duplicate-builtin-host",
		Name:      "Catalog Host copy",
	})
	if err != nil {
		t.Fatal(err)
	}
	if copy.Source != "custom" || copy.Spec == nil || copy.Spec.Host == nil || copy.Spec.Host.StartScript != source.Spec.Host.StartScript {
		t.Fatalf("duplicated built-in host = %+v", copy)
	}
	if copy.HostLifecyclePlan == nil || copy.HostLifecyclePlan.Start.Steps[0].CommandTemplate != source.Spec.Host.StartScript {
		t.Fatalf("duplicated built-in host lifecycle plan = %+v", copy.HostLifecyclePlan)
	}
}

func TestValidateComposeYAMLRejectsHostEscapeCapabilities(t *testing.T) {
	t.Parallel()
	tests := map[string]string{
		"published port": `services:
  app:
    image: example.invalid/app:1
    ports: ["8080:8080"]`,
		"container socket": `services:
  app:
    image: example.invalid/app:1
    volumes: ["/var/run/docker.sock:/var/run/docker.sock"]`,
		"external volume": `services:
  app:
    image: example.invalid/app:1
volumes:
  data:
    external: true`,
		"host bind": `services:
  app:
    image: example.invalid/app:1
    volumes: ["/etc:/host-etc:ro"]`,
		"privileged": `services:
  app:
    image: example.invalid/app:1
    privileged: true`,
		"capability add": `services:
  app:
    image: example.invalid/app:1
    cap_add: [SYS_ADMIN]`,
		"host env file": `services:
  app:
    image: example.invalid/app:1
    env_file: /etc/environment`,
		"interpolated host bind": `services:
  app:
    image: example.invalid/app:1
    volumes: ["${HOME}:/host-home:ro"]`,
		"volume driver options": `services:
  app:
    image: example.invalid/app:1
    volumes: ["data:/data"]
volumes:
  data:
    driver_opts:
      type: none
      device: /etc
      o: bind`,
	}
	for name, document := range tests {
		document := document
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			err := validateComposeYAML(document, "app")
			var managedErr *Error
			if !errors.As(err, &managedErr) || managedErr.Code != "TEMPLATE_COMPOSE_POLICY_REJECTED" {
				t.Fatalf("validateComposeYAML() error = %v", err)
			}
		})
	}
}

func TestTemplateSpecFromServiceRejectsSnapshotIdentityDrift(t *testing.T) {
	t.Parallel()
	spec := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion,
		Kind:          DeploymentHost,
		Endpoint:      WebEndpointSpec{Scheme: "http", HealthPath: "/health"},
		Host:          &HostTemplateSpec{StartScript: `exec preview --port "$REDEVEN_SERVICE_PORT"`},
	}
	encoded, digest, err := canonicalTemplateSpec(spec)
	if err != nil {
		t.Fatal(err)
	}
	service := &pfregistry.ManagedService{TemplateSnapshotJSON: encoded, TemplateSnapshotSHA256: digest}
	if _, err := templateSpecFromService(service); err != nil {
		t.Fatalf("valid snapshot error = %v", err)
	}
	service.TemplateSnapshotSHA256 = "tampered"
	_, err = templateSpecFromService(service)
	var managedErr *Error
	if !errors.As(err, &managedErr) || managedErr.Code != "TEMPLATE_SNAPSHOT_IDENTITY_MISMATCH" {
		t.Fatalf("identity drift error = %v", err)
	}
	service.TemplateSnapshotJSON = encoded + "\n"
	service.TemplateSnapshotSHA256 = digest
	_, err = templateSpecFromService(service)
	if !errors.As(err, &managedErr) || managedErr.Code != "TEMPLATE_SNAPSHOT_IDENTITY_MISMATCH" {
		t.Fatalf("raw document identity drift error = %v", err)
	}
}

func TestVerifiedTemplateSpecRejectsNonCurrentSchema(t *testing.T) {
	t.Parallel()
	raw := `{"schema_version":2,"kind":"host","endpoint":{"scheme":"http","health_path":"/health"},"host":{"start_script":"exec preview --port $REDEVEN_SERVICE_PORT","npm":{"package_name":"example-package","version":"1.0.0","registry_url":"https://registry.npmjs.org/","executable":"preview"}}}`
	digest := sha256.Sum256([]byte(raw))
	if _, err := verifiedTemplateSpec(raw, hex.EncodeToString(digest[:])); err == nil {
		t.Fatal("non-current TemplateSpec unexpectedly accepted")
	}
}

func TestTemplateSpecFromServiceAcceptsPersistedDocumentIdentity(t *testing.T) {
	t.Parallel()
	spec := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion,
		Kind:          DeploymentHost,
		Endpoint:      WebEndpointSpec{Scheme: "http", HealthPath: "/health"},
		Host:          &HostTemplateSpec{StartScript: `exec preview --port "$REDEVEN_SERVICE_PORT"`},
	}
	canonical, _, err := canonicalTemplateSpec(spec)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal([]byte(canonical), &document); err != nil {
		t.Fatal(err)
	}
	persisted, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	if string(persisted) == canonical {
		t.Fatal("test fixture must use a different valid JSON field order")
	}
	sum := sha256.Sum256(persisted)
	service := &pfregistry.ManagedService{TemplateSnapshotJSON: string(persisted), TemplateSnapshotSHA256: hex.EncodeToString(sum[:])}
	loaded, err := templateSpecFromService(service)
	if err != nil {
		t.Fatalf("migrated snapshot error = %v", err)
	}
	if loaded.Kind != DeploymentHost || loaded.Host == nil || loaded.Host.StartScript != spec.Host.StartScript {
		t.Fatalf("loaded migrated snapshot = %+v", loaded)
	}
}

func TestTemplateSpecFromServiceRejectsInvalidHashedDocument(t *testing.T) {
	t.Parallel()
	tests := map[string]string{
		"unknown field":  `{"schema_version":1,"kind":"host","endpoint":{"scheme":"http"},"host":{"start_script":"exec preview"},"future":true}`,
		"invalid policy": `{"schema_version":1,"kind":"host","endpoint":{"scheme":"http"},"host":{"start_script":""}}`,
	}
	for name, raw := range tests {
		raw := raw
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			sum := sha256.Sum256([]byte(raw))
			_, err := templateSpecFromService(&pfregistry.ManagedService{TemplateSnapshotJSON: raw, TemplateSnapshotSHA256: hex.EncodeToString(sum[:])})
			var managedErr *Error
			if !errors.As(err, &managedErr) || managedErr.Code != "TEMPLATE_SNAPSHOT_INVALID" {
				t.Fatalf("invalid hashed snapshot error = %v", err)
			}
		})
	}
}

func TestTemplateFromRecordAcceptsPersistedDocumentIdentity(t *testing.T) {
	t.Parallel()
	spec := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion,
		Kind:          DeploymentHost,
		Endpoint:      WebEndpointSpec{Scheme: "http", HealthPath: "/health"},
		Host:          &HostTemplateSpec{StartScript: `exec preview --port "$REDEVEN_SERVICE_PORT"`},
	}
	canonical, _, err := canonicalTemplateSpec(spec)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal([]byte(canonical), &document); err != nil {
		t.Fatal(err)
	}
	persisted, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(persisted)
	scope, stateDir := newManagedServiceTestScope(t)
	manager := &Manager{scope: scope, stateDir: stateDir, downloads: defaultPackageDownloadClient()}
	loaded, err := manager.templateFromRecord(context.Background(), pfregistry.ManagedTemplate{
		TemplateID:      "managed-template-migrated",
		Name:            "Migrated host template",
		Deployment:      string(DeploymentHost),
		Revision:        1,
		ServiceFamilyID: "migrated-host-template",
		SpecJSON:        string(persisted),
		SpecSHA256:      hex.EncodeToString(sum[:]),
	})
	if err != nil {
		t.Fatalf("migrated custom template error = %v", err)
	}
	if loaded.Spec == nil || loaded.Spec.Host == nil || loaded.Spec.Host.StartScript != spec.Host.StartScript {
		t.Fatalf("loaded migrated custom template = %+v", loaded)
	}
	if loaded.EffectiveSpec == nil || loaded.EffectiveSpec.Host == nil || loaded.EffectiveSpec.Host.StartScript != spec.Host.StartScript {
		t.Fatalf("effective migrated custom template = %+v", loaded.EffectiveSpec)
	}
	if loaded.HostLifecyclePlan == nil || loaded.HostLifecyclePlan.Start.Steps[0].CommandTemplate != spec.Host.StartScript || loaded.Spec.Host.StartScript != spec.Host.StartScript {
		t.Fatalf("custom template lifecycle projection = %+v", loaded.HostLifecyclePlan)
	}
}

func TestEffectiveTemplateSpecAppliesRuntimeDefaultsWithoutChangingRawSpec(t *testing.T) {
	t.Parallel()
	raw := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion,
		Kind:          DeploymentContainer,
		Endpoint:      WebEndpointSpec{Scheme: "http", ContainerPort: 3000},
		Container:     &ContainerTemplateSpec{Image: "example.invalid/dashboard:1"},
	}
	effective, err := effectiveTemplateSpec(raw)
	if err != nil {
		t.Fatal(err)
	}
	if raw.Container.RestartPolicy != "" || raw.Container.NetworkMode != "" || raw.Container.PIDsLimit != 0 || raw.Container.ReadOnlyRoot || len(raw.Container.CapDrop) != 0 || len(raw.Container.SecurityOpts) != 0 {
		t.Fatalf("raw template was changed: %+v", raw.Container)
	}
	if effective.Container == raw.Container {
		t.Fatal("effective template must not alias the raw container definition")
	}
	if effective.Container.RestartPolicy != "no" || effective.Container.NetworkMode != "bridge" || effective.Container.PIDsLimit != 512 || !effective.Container.ReadOnlyRoot {
		t.Fatalf("effective defaults = %+v", effective.Container)
	}
	if !slices.Equal(effective.Container.CapDrop, []string{"ALL"}) || !slices.Equal(effective.Container.SecurityOpts, []string{"no-new-privileges:true"}) {
		t.Fatalf("effective security defaults = %+v", effective.Container)
	}
}

func TestValidateComposeYAMLAcceptsManagedWorkspaceAndNamedVolume(t *testing.T) {
	t.Parallel()
	document := `services:
  app:
    image: example.invalid/app:1
    volumes:
      - ${REDEVEN_WORKSPACE}:/workspace:ro
      - data:/var/lib/app
volumes:
  data: {}`
	if err := validateComposeYAML(document, "app"); err != nil {
		t.Fatalf("validateComposeYAML() error = %v", err)
	}
}
