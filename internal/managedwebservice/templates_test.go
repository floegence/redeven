package managedwebservice

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/filesystemscope"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestDuplicateTemplateCreatesIndependentEditableDefinition(t *testing.T) {
	t.Parallel()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"invalid":true}`)) }))
	defer server.Close()
	manager := &Manager{
		registry: registry,
		scope:    &filesystemscope.Registry{},
		catalog:  &catalogClient{client: server.Client(), catalogURL: server.URL},
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
	if copy.Spec == nil || copy.Spec.Host == nil || copy.Spec.Host.StartScript != source.Spec.Host.StartScript {
		t.Fatalf("duplicate definition = %+v", copy.Spec)
	}
	replayed, err := manager.DuplicateTemplate(context.Background(), source.TemplateID, TemplateDuplicateRequest{RequestID: "request-template-copy", Name: "Local preview copy"})
	if err != nil || replayed.TemplateID != copy.TemplateID {
		t.Fatalf("duplicate idempotent replay = %+v, err=%v", replayed, err)
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
