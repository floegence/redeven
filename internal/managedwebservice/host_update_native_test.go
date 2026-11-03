//go:build darwin || linux

package managedwebservice

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"testing"
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

// The package install boundary is deterministic; lifecycle, launch persistence,
// process replacement, loopback health and the model-visible view are real.
type nativeVerifiedHostUpdateDriver struct{ *hostScriptDriver }

func (d *nativeVerifiedHostUpdateDriver) Install(ctx context.Context, service *pfregistry.ManagedService, progress operationProgress) (string, string, error) {
	return (&verifiedHostUpdateDriver{}).Install(ctx, service, progress)
}

func TestHostUpdateHTTPHelper(t *testing.T) {
	if os.Getenv("UPDATE_HTTP_HELPER") != "1" {
		return
	}
	listener, err := net.Listen("tcp", "127.0.0.1:"+os.Getenv("REDEVEN_SERVICE_PORT"))
	if err != nil {
		t.Fatal(err)
	}
	if err := http.Serve(listener, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = fmt.Fprint(w, "healthy") })); err != nil {
		t.Fatal(err)
	}
}

func TestHostReleaseUpdateReplacesRealProcessAndOpensWithoutAnotherRestart(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	spec := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost,
		Endpoint: WebEndpointSpec{Scheme: "http", Path: "/", HealthPath: "/", StartupTimeout: 5},
		Host:     &HostTemplateSpec{StartScript: "exec \"$UPDATE_TEST_EXECUTABLE\" -test.run=^TestHostUpdateHTTPHelper$", Environment: map[string]string{"UPDATE_TEST_EXECUTABLE": executable, "UPDATE_HTTP_HELPER": "1"}, NPM: &NPMHostPackageSpec{PackageName: "example-service", Version: "1.0.0", RegistryURL: "https://registry.npmjs.org/", Executable: "example-service"}},
	}
	if err := validateTemplateSpec(spec); err != nil {
		t.Fatalf("invalid native fixture: %+v", err)
	}
	manager, service := hostTestService(t, t.TempDir(), spec)
	service.RuntimePort = port
	if err := manager.registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{RuntimePort: &port}); err != nil {
		t.Fatal(err)
	}
	driver := &nativeVerifiedHostUpdateDriver{&hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}}
	manager.host = driver
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	previous, err := driver.Start(ctx, service)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = killManagedProcessPID(hostPIDFromIdentity(previous))
		_ = killManagedProcessPID(hostPIDFromIdentity(service.RuntimeIdentity))
	})
	service.DesiredState, service.ObservedState = "running", "running"
	if err := manager.waitHealthy(ctx, service); err != nil {
		t.Fatal(err)
	}
	target, err := decodeReleaseIdentity(service.ReleaseIdentityJSON, service.ReleaseIdentitySHA256)
	if err != nil {
		t.Fatal(err)
	}
	target.Version, target.Integrity, target.Trust = "2.0.0", testNPMIntegrity("native-update"), "catalog_reviewed_source"
	operation := pfregistry.ManagedOperation{OperationID: "native-update", ServiceID: service.ServiceID, RequestID: "native-update-request", RequestFingerprint: "native-update", Action: "update", State: "running", ProgressTotal: 7}
	if err := manager.registry.CreateManagedOperation(ctx, operation); err != nil {
		t.Fatal(err)
	}
	if err := manager.runHostReleaseUpdate(ctx, service, &operation, nil, cachedReleaseCandidate{Identity: *target}, driver); err != nil {
		t.Fatal(err)
	}
	if previous == service.RuntimeIdentity || managedProcessRunning(hostPIDFromIdentity(previous)) {
		t.Fatal("update did not replace the previous process")
	}
	if !managedProcessRunning(hostPIDFromIdentity(service.RuntimeIdentity)) {
		t.Fatal("new process is not running")
	}
	operation.State, operation.Stage, operation.FinishedAtUnixMs = "succeeded", "completed", time.Now().UnixMilli()
	if err := manager.registry.FinalizeManagedOperation(ctx, operation, pfregistry.ManagedServicePatch{}); err != nil {
		t.Fatal(err)
	}
	view, err := manager.Inspect(ctx, service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if view.PendingChanges || !view.Actions.Open.Available || view.Status != "running" {
		t.Fatalf("incomplete update view: pending=%v open=%+v status=%s", view.PendingChanges, view.Actions.Open, view.Status)
	}
	stored, err := manager.registry.GetManagedService(ctx, service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := driver.readRunState(stored)
	if err != nil || state.RuntimeSpecSHA256 != stored.RuntimeSpecSHA256 {
		t.Fatalf("run and registry identity diverged: %+v %v", state, err)
	}
	if err := driver.Stop(ctx, stored); err != nil {
		t.Fatal(err)
	}
	if managedProcessRunning(hostPIDFromIdentity(service.RuntimeIdentity)) {
		t.Fatal("qualification process survived cleanup")
	}
}
