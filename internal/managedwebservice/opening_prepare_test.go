package managedwebservice

import (
	"context"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	templatecontract "github.com/floegence/redeven-service-templates/template"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

type dynamicOpeningTestDriver struct {
	staticOpeningTestDriver
	launch func(context.Context, *pfregistry.ManagedService) (serviceOpeningLaunch, error)
}

func (d dynamicOpeningTestDriver) OpeningLaunch(ctx context.Context, s *pfregistry.ManagedService) (serviceOpeningLaunch, error) {
	return d.launch(ctx, s)
}

func TestOpeningTracksCurrentLaunchWithoutLifecycleChanges(t *testing.T) {
	ctx := context.Background()
	spec := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentContainer, Endpoint: WebEndpointSpec{Scheme: "http", ContainerPort: 3080}, StartupURL: &templatecontract.StartupURLSpec{LinePrefix: "web: "}, Container: &ContainerTemplateSpec{Image: "example.invalid/app:1"}}
	m, registry, service, _ := newRuntimeResolutionTestService(t, spec, ReleaseIdentity{Kind: "oci", Source: "example.invalid/app", Tag: "1", Digest: "sha256:" + strings.Repeat("a", 64)}, "running")
	m.healthCheck = func(context.Context, *pfregistry.ManagedService) error { return nil }
	resolved, err := m.resolveCurrentRuntime(ctx, service)
	if err != nil {
		t.Fatal(err)
	}
	service.RuntimeIdentity = "same-container"
	service.RuntimeSpecSHA256 = resolved.RuntimeSpecSHA256
	if err := registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{RuntimeIdentity: &service.RuntimeIdentity, RuntimeSpecSHA256: &service.RuntimeSpecSHA256}); err != nil {
		t.Fatal(err)
	}
	generation, token := "first-start", "first-private"
	var reads atomic.Int32
	driver := dynamicOpeningTestDriver{staticOpeningTestDriver: staticOpeningTestDriver{inspectionTestDriver{deploymentDriver: m.container, inspect: func(context.Context, *pfregistry.ManagedService) (bool, error) { return true, nil }}}, launch: func(context.Context, *pfregistry.ManagedService) (serviceOpeningLaunch, error) {
		return serviceOpeningLaunch{Generation: generation, Port: 3080, ReadOutput: func(context.Context) ([]byte, error) {
			reads.Add(1)
			return []byte("web: http://127.0.0.1:3080/?token=" + token + " (LAN: http://172.17.0.2:3080/)\n"), nil
		}}, nil
	}}
	m.container = driver
	view, err := m.Inspect(ctx, service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if view.Actions.Recover.Available || view.Opening.State != "unprepared" {
		t.Fatal("healthy service recommended recovery or claimed an unprepared entrance was ready")
	}
	if _, err := os.Stat(m.openingStatePath(service)); !os.IsNotExist(err) {
		t.Fatal("inspection prepared an entrance")
	}
	for range 2 {
		session, err := m.OpenSession(ctx, service.ServiceID, OpenSessionRequest{RequestID: "read-current"})
		if err != nil || session.ManagedEntrance == nil || session.LaunchGeneration != generation || session.AppPath != "/?token="+token {
			t.Fatalf("current entrance unavailable: %v", err)
		}
	}
	if reads.Load() != 1 {
		t.Fatal("same launch did not reuse private entrance")
	}
	generation, token = "second-start", "second-private"
	session, err := m.OpenSession(ctx, service.ServiceID, OpenSessionRequest{RequestID: "read-restarted"})
	if err != nil || session.AppPath != "/?token="+token || reads.Load() != 2 {
		t.Fatalf("same-ID restart reused stale entrance: %v", err)
	}
	if _, err := m.OpenSession(ctx, service.ServiceID, OpenSessionRequest{RequestID: "refresh-current", Refresh: true}); err != nil || reads.Load() != 3 {
		t.Fatal("explicit reprepare did not read this launch again")
	}
	active, err := registry.GetActiveManagedOperation(ctx, service.ServiceID)
	if err != nil || active != nil {
		t.Fatal("opening created a lifecycle operation")
	}
	// Change generation between preparation and the final verification.
	var launches atomic.Int32
	m.container = dynamicOpeningTestDriver{staticOpeningTestDriver: driver.staticOpeningTestDriver, launch: func(context.Context, *pfregistry.ManagedService) (serviceOpeningLaunch, error) {
		gen := "before"
		if launches.Add(1) > 1 {
			gen = "after"
		}
		return serviceOpeningLaunch{Generation: gen, Port: 3080, ReadOutput: func(context.Context) ([]byte, error) {
			return []byte("web: http://127.0.0.1:3080/?token=private\n"), nil
		}}, nil
	}}
	if _, err := m.OpenSession(ctx, service.ServiceID, OpenSessionRequest{RequestID: "race-opening"}); managedErrorCode(err) != "RESOURCE_PLAN_STALE" {
		t.Fatalf("raced entrance was handed to browser: %v", err)
	}
}

func TestEntranceRangeRejectsUntrustedAddresses(t *testing.T) {
	endpoint := WebEndpointSpec{Scheme: "http"}
	for _, url := range []string{"http://evil.example:3080/?token=private", "http://127.0.0.1:3081/", "https://127.0.0.1:3080/", "http://user:private@127.0.0.1:3080/", "http://127.0.0.1:3080/%2f%2fevil", "http://127.0.0.1:3080/%5cevil"} {
		if _, err := parseServiceOpeningURL(url, endpoint, 3080); err == nil || strings.Contains(err.Error(), "private") {
			t.Fatal("unsafe URL accepted or disclosed")
		}
	}
}
