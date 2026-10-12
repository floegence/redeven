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
	driver.removeOpenSession(service)
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

func (d staticOpeningTestDriver) OpeningLaunch(_ context.Context, s *pfregistry.ManagedService) (serviceOpeningLaunch, error) {
	return serviceOpeningLaunch{Generation: s.RuntimeIdentity, Port: s.RuntimePort}, nil
}

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
			if err := manager.waitHealthy(context.Background(), service); err != nil {
				t.Fatal(err)
			}
			manager.prepareSuccessfulOpening(context.Background(), service)
			spec.Endpoint.Path = "/changed"
			updateRuntimeResolutionTestTemplate(t, registry, template, spec)
			session, err := manager.OpenSession(context.Background(), service.ServiceID, OpenSessionRequest{RequestID: "applied-static-opening"})
			if err != nil || session.AppPath != "/dashboard?tab=initial#panel" {
				t.Fatalf("applied path=%+v err=%v", session, err)
			}
			session, err = manager.OpenSession(context.Background(), service.ServiceID, OpenSessionRequest{RequestID: "refresh-fixed-opening", Refresh: true})
			if err != nil || session.AppPath != "/dashboard?tab=initial#panel" {
				t.Fatal("refresh replaced an applied fixed path", err)
			}
			if err := os.Remove(manager.staticOpeningPath(service)); err != nil {
				t.Fatal(err)
			}
			if _, err := manager.OpenSession(context.Background(), service.ServiceID, OpenSessionRequest{RequestID: "lost-fixed-record"}); managedErrorCode(err) != "SERVICE_OPEN_TARGET_UNAVAILABLE" {
				t.Fatal("missing record reconstructed a changed fixed entrance", err)
			}
			if err := os.WriteFile(manager.staticOpeningPath(service), []byte(`{"schema_version":99}`), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := manager.OpenSession(context.Background(), service.ServiceID, OpenSessionRequest{RequestID: "corrupt-static-opening"}); managedErrorCode(err) != "SERVICE_OPEN_TARGET_INVALID" {
				t.Fatalf("corrupt record was replaced from a changed template: %v", err)
			}
			// A lifecycle-authorized new launch can replace its unusable cache.
			manager.prepareSuccessfulOpening(context.Background(), service)
			session, err = manager.OpenSession(context.Background(), service.ServiceID, OpenSessionRequest{RequestID: "new-launch-after-corrupt-cache"})
			if err != nil || session.AppPath != "/changed" {
				t.Fatal("new launch could not recover its private cache", err)
			}
		})
	}
}

func TestStaticEntranceIsSavedAfterLifecycleIdentityCommit(t *testing.T) {
	ctx := context.Background()
	spec := TemplateSpec{SchemaVersion: 7, Kind: DeploymentContainer, Endpoint: WebEndpointSpec{Scheme: "http", Path: "/dashboard?tab=initial#panel", ContainerPort: 3000}, Container: &ContainerTemplateSpec{Image: "example.invalid/app:1"}}
	manager, registry, service, _ := newRuntimeResolutionTestService(t, spec, ReleaseIdentity{Kind: "oci", Source: "example.invalid/app", Tag: "1", Digest: "sha256:" + strings.Repeat("a", 64)}, "stopped")
	resolved, err := manager.resolveCurrentRuntime(ctx, service)
	if err != nil {
		t.Fatal(err)
	}
	secrets, err := manager.serviceSecretDocument(service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	legacy := cloneTemplateSpec(resolved.Spec)
	legacy.SchemaVersion = 6
	old, err := runtimeSpecDigestDocument(1, legacy, resolved.Configuration, resolved.Release, resolved.Binding, secrets, service)
	if err != nil {
		t.Fatal(err)
	}
	resolved.MatchesApplied = true
	identity, blank := "verified-instance", old
	service.RuntimeIdentity, service.RuntimeSpecSHA256 = identity, blank
	if err := registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{RuntimeIdentity: &identity, RuntimeSpecSHA256: &blank}); err != nil {
		t.Fatal(err)
	}
	driver := staticOpeningTestDriver{inspectionTestDriver{deploymentDriver: manager.container, inspect: func(context.Context, *pfregistry.ManagedService) (bool, error) { return false, nil }}}
	manager.container = driver
	manager.healthCheck = func(context.Context, *pfregistry.ManagedService) error { return nil }
	if err := manager.runStart(ctx, service, &pfregistry.ManagedOperation{Action: "start"}, driver, resolved); err != nil {
		t.Fatal(err)
	}
	cached, err := manager.readOpeningState(service)
	if err != nil || cached.AppPath != spec.Endpoint.Path {
		t.Fatal("healthy launch did not save its applied static entrance", err)
	}
}
