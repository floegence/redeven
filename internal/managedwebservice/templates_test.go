package managedwebservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

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
		Version:   "1",
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
	if copy.Spec == nil || copy.Spec.Host == nil || copy.Spec.Host.StartScript != source.Spec.Host.StartScript {
		t.Fatalf("duplicate definition = %+v", copy.Spec)
	}
	replayed, err := manager.DuplicateTemplate(context.Background(), source.TemplateID, TemplateDuplicateRequest{RequestID: "request-template-copy", Name: "Local preview copy"})
	if err != nil || replayed.TemplateID != copy.TemplateID {
		t.Fatalf("duplicate idempotent replay = %+v, err=%v", replayed, err)
	}
}

func TestDuplicateBuiltInHostRetainsReleaseLockedRuntime(t *testing.T) {
	t.Parallel()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	scope, stateDir := newManagedServiceTestScope(t)
	manager := &Manager{registry: registry, scope: scope, stateDir: stateDir, downloads: defaultPackageDownloadClient()}
	copy, err := manager.DuplicateTemplate(context.Background(), DeepSeekHarnessHostTemplateID, TemplateDuplicateRequest{
		RequestID: "request-duplicate-builtin-host",
		Name:      "DeepSeek Harness host copy",
	})
	if err != nil {
		t.Fatal(err)
	}
	if copy.Source != "custom" || copy.Spec == nil || copy.Spec.Host == nil || copy.Spec.Host.RuntimeBundle != deepSeekRuntimeBundleID || copy.Spec.Host.Artifact != nil {
		t.Fatalf("duplicated built-in host = %+v", copy)
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

func TestTemplateSpecFromServiceAcceptsMigratedWebtopSnapshots(t *testing.T) {
	t.Parallel()
	for _, templateID := range []string{WebtopUbuntuKDETemplateID, WebtopDebianXFCETemplateID} {
		templateID := templateID
		t.Run(templateID, func(t *testing.T) {
			t.Parallel()
			artifact, ok := auditedWebtopArtifact(templateID, "linux-amd64")
			if !ok {
				t.Fatal("reviewed Webtop artifact is unavailable")
			}
			spec := webtopTemplateSpec(templateID, artifact)
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
			loaded, err := templateSpecFromService(&pfregistry.ManagedService{TemplateSnapshotJSON: string(persisted), TemplateSnapshotSHA256: hex.EncodeToString(sum[:])})
			if err != nil {
				t.Fatalf("migrated Webtop snapshot error = %v", err)
			}
			if loaded.Container == nil || loaded.Container.Image != spec.Container.Image || loaded.Container.RuntimeProfile != ContainerRuntimeProfileInteractiveDesktop {
				t.Fatalf("loaded Webtop snapshot = %+v", loaded)
			}
		})
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
