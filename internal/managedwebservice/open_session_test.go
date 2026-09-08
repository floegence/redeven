package managedwebservice

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

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

func waitForManagedOperationState(t *testing.T, registry *pfregistry.Registry, operationID, state string) *pfregistry.ManagedOperation {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		operation, err := registry.GetManagedOperation(context.Background(), operationID)
		if err != nil {
			t.Fatal(err)
		}
		if operation != nil && operation.State == state {
			return operation
		}
		if operation != nil && (operation.State == "failed" || operation.State == "cancelled" || operation.State == "interrupted") {
			t.Fatalf("operation %s ended in %s: %s %s", operationID, operation.State, operation.ErrorCode, operation.ErrorMessage)
		}
		time.Sleep(10 * time.Millisecond)
	}
	operation, _ := registry.GetManagedOperation(context.Background(), operationID)
	t.Fatalf("operation %s did not reach %q: %+v", operationID, state, operation)
	return nil
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
