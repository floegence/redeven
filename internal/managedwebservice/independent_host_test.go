package managedwebservice

import (
	"context"
	"testing"
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestRuntimeClosePreservesRunningHostAndItsOpeningInformation(t *testing.T) {
	root := t.TempDir()
	m, service := hostTestService(t, root, TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost,
		Endpoint: WebEndpointSpec{Scheme: "http", Path: "/", HealthPath: "/"},
		Host:     &HostTemplateSpec{StartScript: "exec sleep 60"},
	})
	service.DesiredState, service.ObservedState = "running", "running"
	if err := m.registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{DesiredState: &service.DesiredState, ObservedState: &service.ObservedState}); err != nil {
		t.Fatal(err)
	}
	driver := &hostScriptDriver{manager: m, processes: map[string]hostProcess{}}
	m.host = driver
	identity, err := driver.Start(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	service.RuntimeIdentity = identity
	t.Cleanup(func() { _ = killManagedProcessPID(hostPIDFromIdentity(identity)) })
	if err := m.registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{RuntimeIdentity: &identity}); err != nil {
		t.Fatal(err)
	}
	if err := driver.writeOpenSession(service, identity, "/?token=private-test"); err != nil {
		t.Fatal(err)
	}
	if err := m.Close(); err != nil {
		t.Fatal(err)
	}
	if !managedProcessRunning(hostPIDFromIdentity(identity)) {
		t.Fatal("Runtime close stopped its independent Host service")
	}
	if _, err := driver.readOpenSession(service, identity); err != nil {
		t.Fatalf("Runtime close discarded private opening information: %v", err)
	}
	stored, err := m.registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil || stored.DesiredState != "running" || stored.ObservedState != "running" {
		t.Fatalf("Runtime close changed service state: %v", err)
	}
}

func TestRuntimeCloseDuringStartHealthCheckPreservesApplicationAndIntent(t *testing.T) {
	manager, registry, service, _ := newRuntimeResolutionTestService(t, TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60"}}, ReleaseIdentity{Kind: "none"}, "stopped")
	started := make(chan struct{})
	manager.healthCheck = func(ctx context.Context, _ *pfregistry.ManagedService) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}
	operation, err := manager.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: "close-during-start", Action: ActionStart})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("start did not reach health check")
	}
	stored, err := registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	identity := stored.RuntimeIdentity
	t.Cleanup(func() { _ = killManagedProcessPID(hostPIDFromIdentity(identity)) })
	if err := manager.Close(); err != nil {
		t.Fatal(err)
	}
	if !managedProcessRunning(hostPIDFromIdentity(identity)) {
		t.Fatal("Runtime shutdown cancellation killed the application")
	}
	stored, err = registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil || stored.DesiredState != "running" || stored.RuntimeIdentity != identity {
		t.Fatal("shutdown changed launch intent")
	}
	final, err := registry.GetManagedOperation(context.Background(), operation.OperationID)
	if err != nil || final.State != "interrupted" {
		t.Fatalf("shutdown operation state=%+v err=%v", final, err)
	}
}

type inspectionTestDriver struct {
	deploymentDriver
	inspect func(context.Context, *pfregistry.ManagedService) (bool, error)
}

func (d inspectionTestDriver) Observe(ctx context.Context, s *pfregistry.ManagedService) (bool, error) {
	return d.inspect(ctx, s)
}

func TestObservationCannotOverwriteANewerLaunch(t *testing.T) {
	manager, registry, service, _ := newRuntimeResolutionTestService(t, TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60"}}, ReleaseIdentity{Kind: "none"}, "running")
	newer := "newer-launch"
	manager.host = inspectionTestDriver{deploymentDriver: manager.host, inspect: func(ctx context.Context, _ *pfregistry.ManagedService) (bool, error) {
		if err := registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{RuntimeIdentity: &newer}); err != nil {
			t.Fatal(err)
		}
		return false, nil
	}}
	if _, err := manager.observe(context.Background(), service); err != pfregistry.ErrManagedServiceRuntimeChanged {
		t.Fatalf("stale observation accepted: %v", err)
	}
	stored, err := registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil || stored.RuntimeIdentity != newer || stored.ObservedState != "running" || stored.DesiredState != "running" {
		t.Fatal("observation overwrote current launch")
	}
}

func TestStartupObservationPreservesIntentWithoutRetryingFailures(t *testing.T) {
	for _, test := range []struct {
		name, desired, failure string
		unavailable            bool
	}{
		{name: "user stopped", desired: "stopped"},
		{name: "inspection unavailable", desired: "running", unavailable: true},
		{name: "previous operation failed", desired: "running", failure: "START_FAILED"},
	} {
		t.Run(test.name, func(t *testing.T) {
			manager, registry, service, _ := newRuntimeResolutionTestService(t, TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60"}}, ReleaseIdentity{Kind: "none"}, test.desired)
			if test.failure != "" {
				if err := registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{LastErrorCode: &test.failure}); err != nil {
					t.Fatal(err)
				}
			}
			manager.host = inspectionTestDriver{deploymentDriver: manager.host, inspect: func(context.Context, *pfregistry.ManagedService) (bool, error) {
				if test.unavailable {
					return false, serviceError("HOST_PROCESS_IDENTITY_UNAVAILABLE", "Inspection unavailable.", 503, true, nil)
				}
				return false, nil
			}}
			manager.Start(context.Background())
			if err := manager.Close(); err != nil {
				t.Fatal(err)
			}
			stored, err := registry.GetManagedService(context.Background(), service.ServiceID)
			if err != nil || stored.DesiredState != test.desired || stored.LastErrorCode != test.failure || stored.RuntimeIdentity != "" {
				t.Fatal("recovery changed user intent or started an application")
			}
			if test.unavailable && stored.ObservedState != "unknown" {
				t.Fatal("unavailable inspection was treated as stopped")
			}
			latest, err := registry.GetLatestManagedOperation(context.Background(), service.ServiceID)
			if err != nil || latest != nil {
				t.Fatalf("recovery scheduled an unexpected operation: %+v %v", latest, err)
			}
		})
	}
}

func TestExplicitStartIntentSurvivesUnavailableInspection(t *testing.T) {
	manager, registry, service, _ := newRuntimeResolutionTestService(t, TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60"}}, ReleaseIdentity{Kind: "none"}, "stopped")
	driver := inspectionTestDriver{deploymentDriver: manager.host, inspect: func(context.Context, *pfregistry.ManagedService) (bool, error) {
		return false, serviceError("HOST_PROCESS_IDENTITY_UNAVAILABLE", "Inspection unavailable.", 503, true, nil)
	}}
	resolved, err := manager.resolveCurrentRuntime(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.runStart(context.Background(), service, &pfregistry.ManagedOperation{}, driver, resolved); managedErrorCode(err) != "HOST_PROCESS_IDENTITY_UNAVAILABLE" {
		t.Fatalf("inspection failure=%v", err)
	}
	stored, err := registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil || stored.DesiredState != "running" {
		t.Fatal("failed inspection lost the explicit Start intent")
	}
}

type interruptedStopTestDriver struct{ deploymentDriver }

func (d interruptedStopTestDriver) Stop(context.Context, *pfregistry.ManagedService) error {
	return context.Canceled
}
func TestInterruptedRestartRetainsRunningIntent(t *testing.T) {
	manager, registry, service, _ := newRuntimeResolutionTestService(t, TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60"}}, ReleaseIdentity{Kind: "none"}, "running")
	operation := &pfregistry.ManagedOperation{Action: string(ActionRestart)}
	if err := manager.runStop(context.Background(), service, operation, interruptedStopTestDriver{manager.host}); err != context.Canceled {
		t.Fatalf("stop interruption=%v", err)
	}
	stored, err := registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil || stored.DesiredState != "running" {
		t.Fatal("restart's intermediate stop overwrote the user's running intent")
	}
}
