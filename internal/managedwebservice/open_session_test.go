package managedwebservice

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestOpenSessionPreservesAppliedInstanceAndRetriesHook(t *testing.T) {
	spec := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{
		StartScript:      `exec sleep 60`,
		AfterStartScript: `printf 'http://127.0.0.1:%s/?token=secret-token\n' "$REDEVEN_SERVICE_PORT" > "$REDEVEN_SERVICE_RUN_DIR/open-url"`,
		OpenScript:       `cat "$REDEVEN_SERVICE_RUN_DIR/open-url"`,
	}}
	manager, registry, service, template := newRuntimeResolutionTestService(t, spec, ReleaseIdentity{Kind: "none"}, "stopped")
	manager.healthCheck = func(context.Context, *pfregistry.ManagedService) error { return nil }
	driver := manager.host.(*hostScriptDriver)
	identity, err := driver.Start(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = killManagedProcessPID(hostPIDFromIdentity(identity)) })
	driver.removeOpenSession(service)
	ready, err := manager.OpenSession(context.Background(), service.ServiceID, OpenSessionRequest{RequestID: "retry-opening-hook"})
	if err != nil || ready.State != "ready" || ready.AppPath != "/?token=secret-token" {
		t.Fatalf("OpenSession=%+v err=%v", ready, err)
	}
	// A newer template must not execute against this existing application.
	spec.Host.OpenScript = "exit 99"
	template.SpecJSON, template.SpecSHA256, err = canonicalTemplateSpec(spec)
	if err != nil {
		t.Fatal(err)
	}
	template.Revision++
	if err := registry.UpdateManagedTemplate(context.Background(), template); err != nil {
		t.Fatal(err)
	}
	ready, err = manager.OpenSession(context.Background(), service.ServiceID, OpenSessionRequest{RequestID: "open-pending-template"})
	if err != nil || ready.AppPath != "/?token=secret-token" {
		t.Fatalf("pending template OpenSession=%+v err=%v", ready, err)
	}
	stored, err := registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil || stored.RuntimeIdentity != identity || !managedProcessRunning(hostPIDFromIdentity(identity)) {
		t.Fatal("Open changed the running application")
	}
	active, err := registry.GetActiveManagedOperation(context.Background(), service.ServiceID)
	if err != nil || active != nil {
		t.Fatal("Open created a lifecycle operation")
	}
}

func TestConcurrentOpenSharesOneHook(t *testing.T) {
	spec := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{
		StartScript: "exec sleep 60",
		OpenScript:  `printf 'invocation\n' >> "$REDEVEN_SERVICE_RUN_DIR/open-count"; sleep 0.2; printf 'http://127.0.0.1:%s/\n' "$REDEVEN_SERVICE_PORT"`,
	}}
	manager, _, service, _ := newRuntimeResolutionTestService(t, spec, ReleaseIdentity{Kind: "none"}, "stopped")
	manager.healthCheck = func(context.Context, *pfregistry.ManagedService) error { return nil }
	driver := manager.host.(*hostScriptDriver)
	identity, err := driver.Start(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = killManagedProcessPID(hostPIDFromIdentity(identity)) })
	countPath := filepath.Join(driver.runDirectory(service), "open-count")
	if err := os.WriteFile(countPath, nil, 0600); err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 16)
	for i := 0; i < 16; i++ {
		go func() {
			<-start
			session, err := manager.OpenSession(context.Background(), service.ServiceID, OpenSessionRequest{RequestID: "concurrent-open"})
			if err == nil && session.AppPath != "/" {
				err = errors.New("unexpected opening path")
			}
			results <- err
		}()
	}
	close(start)
	for i := 0; i < 16; i++ {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile(countPath)
	if err != nil || string(raw) != "invocation\n" {
		t.Fatalf("concurrent opens executed %q, err=%v", raw, err)
	}
}

type staticOpeningTestDriver struct{ inspectionTestDriver }

func (d staticOpeningTestDriver) Start(_ context.Context, s *pfregistry.ManagedService) (string, error) {
	return s.RuntimeIdentity, nil
}

func TestContainerAndComposeOpenPreserveAppliedNonRootPath(t *testing.T) {
	for _, kind := range []Deployment{DeploymentContainer, DeploymentCompose} {
		t.Run(string(kind), func(t *testing.T) {
			spec := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: kind, Endpoint: WebEndpointSpec{Scheme: "http", Path: "/dashboard?tab=initial#panel", ContainerPort: 3000}}
			release := ReleaseIdentity{Kind: "none"}
			if kind == DeploymentContainer {
				spec.Container = &ContainerTemplateSpec{Image: "example.invalid/app:1"}
				release = ReleaseIdentity{Kind: "oci", Source: "example.invalid/app", Tag: "1", Digest: "sha256:" + strings.Repeat("a", 64)}
			} else {
				spec.Compose = &ComposeTemplateSpec{MainService: "web", YAML: "services:\n  web:\n    image: example.invalid/app@sha256:" + strings.Repeat("b", 64) + "\n"}
			}
			manager, registry, service, template := newRuntimeResolutionTestService(t, spec, release, "running")
			manager.healthCheck = func(context.Context, *pfregistry.ManagedService) error { return nil }
			identity := "verified-instance"
			resolved, err := manager.resolveCurrentRuntime(context.Background(), service)
			if err != nil {
				t.Fatal(err)
			}
			service.RuntimeIdentity, service.RuntimeSpecSHA256 = identity, resolved.RuntimeSpecSHA256
			if err := registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{RuntimeIdentity: &identity, RuntimeSpecSHA256: &service.RuntimeSpecSHA256}); err != nil {
				t.Fatal(err)
			}
			driver := staticOpeningTestDriver{inspectionTestDriver{deploymentDriver: manager.driver(kind), inspect: func(context.Context, *pfregistry.ManagedService) (bool, error) { return true, nil }}}
			if kind == DeploymentContainer {
				manager.container = driver
			} else {
				manager.compose = driver
			}
			if _, err := manager.startRuntime(context.Background(), service, driver); err != nil {
				t.Fatal(err)
			}
			spec.Endpoint.Path = "/changed"
			updateRuntimeResolutionTestTemplate(t, registry, template, spec)
			session, err := manager.OpenSession(context.Background(), service.ServiceID, OpenSessionRequest{RequestID: "applied-static-opening"})
			if err != nil || session.AppPath != "/dashboard?tab=initial#panel" {
				t.Fatalf("applied path=%+v err=%v", session, err)
			}
			if err := os.WriteFile(manager.staticOpeningPath(service), []byte(`{"schema_version":99}`), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := manager.OpenSession(context.Background(), service.ServiceID, OpenSessionRequest{RequestID: "corrupt-static-opening"}); managedErrorCode(err) != "SERVICE_OPEN_TARGET_INVALID" {
				t.Fatalf("corrupt record was replaced from a changed template: %v", err)
			}
		})
	}
}
