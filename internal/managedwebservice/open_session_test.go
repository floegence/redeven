package managedwebservice

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestOpenSessionRestartsStaleDynamicHostAndJoinsPreparation(t *testing.T) {
	if testing.Short() {
		t.Skip("starts a local managed process")
	}
	spec := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion,
		Kind:          DeploymentHost,
		Endpoint:      WebEndpointSpec{Scheme: "http", HealthPath: "/", StartupTimeout: 5},
		Host: &HostTemplateSpec{
			StartScript: `printf 'dsh web: http://127.0.0.1:%s/?token=secret-token\n' "$REDEVEN_SERVICE_PORT"; exec sleep 60`,
			OpenTarget:  &HostOpenTargetSpec{Mode: "startup_output_url", LinePrefix: "dsh web: "},
		},
	}
	manager, registry, service, _ := newRuntimeResolutionTestService(t, spec, ReleaseIdentity{Kind: "none"}, "running")
	staleDigest := strings.Repeat("0", 64)
	if err := registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{RuntimeSpecSHA256: &staleDigest}); err != nil {
		t.Fatal(err)
	}

	healthStarted := make(chan struct{})
	healthRelease := make(chan struct{})
	var healthOnce sync.Once
	manager.healthCheck = func(context.Context, *pfregistry.ManagedService) error {
		healthOnce.Do(func() { close(healthStarted) })
		<-healthRelease
		return nil
	}

	first, err := manager.OpenSession(context.Background(), service.ServiceID, OpenSessionRequest{RequestID: "open-stale-runtime"})
	if err != nil || first.State != "preparing" || first.Operation == nil || first.Forward != nil || first.AppPath != "" {
		t.Fatalf("first OpenSession() = %+v, err=%v", first, err)
	}
	select {
	case <-healthStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("automatic restart did not reach its health check")
	}
	joined, err := manager.OpenSession(context.Background(), service.ServiceID, OpenSessionRequest{RequestID: "open-join-restart"})
	if err != nil || joined.State != "preparing" || joined.Operation == nil || joined.Operation.OperationID != first.Operation.OperationID {
		t.Fatalf("joined OpenSession() = %+v, err=%v", joined, err)
	}
	close(healthRelease)
	waitForManagedOperationState(t, registry, first.Operation.OperationID, "succeeded")

	ready, err := manager.OpenSession(context.Background(), service.ServiceID, OpenSessionRequest{RequestID: "open-ready-runtime"})
	if err != nil || ready.State != "ready" || ready.Forward == nil || ready.Forward.ForwardID != service.ForwardID || ready.AppPath != "/?token=secret-token" || ready.Operation != nil {
		t.Fatalf("ready OpenSession() = %+v, err=%v", ready, err)
	}
	stored, err := registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := manager.resolveCurrentRuntime(context.Background(), stored)
	if err != nil {
		t.Fatal(err)
	}
	if stored.RuntimeSpecSHA256 != resolved.RuntimeSpecSHA256 || stored.RuntimeIdentity == "" {
		t.Fatalf("applied runtime identity = %+v, resolved digest = %q", stored, resolved.RuntimeSpecSHA256)
	}

	driver := manager.host.(*hostScriptDriver)
	driver.removeOpenSession(stored)
	recapture, err := manager.OpenSession(context.Background(), service.ServiceID, OpenSessionRequest{RequestID: "open-recapture-target"})
	if err != nil || recapture.State != "preparing" || recapture.Operation == nil || recapture.Operation.OperationID == first.Operation.OperationID {
		t.Fatalf("missing-target OpenSession() = %+v, err=%v", recapture, err)
	}
	waitForManagedOperationState(t, registry, recapture.Operation.OperationID, "succeeded")
	recaptured, err := manager.OpenSession(context.Background(), service.ServiceID, OpenSessionRequest{RequestID: "open-recaptured-target"})
	if err != nil || recaptured.State != "ready" || recaptured.AppPath != "/?token=secret-token" {
		t.Fatalf("recaptured OpenSession() = %+v, err=%v", recaptured, err)
	}

	stored, err = registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	driver.removeOpenSession(stored)
	active := pfregistry.ManagedOperation{
		OperationID: "mop-unrelated-open-conflict", ServiceID: service.ServiceID, RequestID: "unrelated-open-conflict", RequestFingerprint: "stop",
		Action: string(ActionStop), State: "running", Stage: "stopping", ProgressTotal: operationProgressTotal,
	}
	if err := registry.CreateManagedOperation(context.Background(), active); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.OpenSession(context.Background(), service.ServiceID, OpenSessionRequest{RequestID: "open-operation-conflict"}); managedErrorCode(err) != "OPERATION_CONFLICT" {
		t.Fatalf("OpenSession() unrelated-operation error = %v", err)
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
