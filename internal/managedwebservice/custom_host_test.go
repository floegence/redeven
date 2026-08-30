package managedwebservice

import (
	"context"
	"runtime"
	"testing"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestHostStopScriptFailureStillCleansManagedProcess(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("custom host lifecycle is Unix-only")
	}
	root := t.TempDir()
	spec := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion,
		Kind:          DeploymentHost,
		Endpoint:      WebEndpointSpec{Scheme: "http", HealthPath: "/"},
		Host: &HostTemplateSpec{
			StartScript: `exec sleep 60`,
			StopScript:  `false`,
		},
	}
	snapshot, digest, err := canonicalTemplateSpec(spec)
	if err != nil {
		t.Fatal(err)
	}
	configuration, configurationDigest, err := canonicalServiceConfiguration(newServiceConfiguration(nil, nil))
	if err != nil {
		t.Fatal(err)
	}
	service := &pfregistry.ManagedService{
		ServiceID: "mws_host_cleanup", ServiceFamilyID: "family_host_cleanup", WorkspacePath: root, RuntimePort: 39191,
		TemplateSnapshotJSON: snapshot, TemplateSnapshotSHA256: digest, ConfigurationJSON: configuration, ConfigurationRevision: 1, ConfigurationSHA256: configurationDigest,
	}
	driver := &hostScriptDriver{manager: &Manager{stateDir: root}, processes: map[string]nativeProcess{}}
	if _, _, err := driver.Install(context.Background(), service, catalogPayload{}, func(string, int64) {}); err != nil {
		t.Fatal(err)
	}
	identity, err := driver.Start(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	service.RuntimeIdentity = identity
	pid := hostPIDFromIdentity(identity)
	if pid <= 0 || !managedProcessAlive(pid) {
		t.Fatalf("managed process did not start: identity=%q", identity)
	}
	err = driver.Stop(context.Background(), service)
	if managedErrorCode(err) != "STOP_SCRIPT_FAILED" {
		t.Fatalf("Stop() error = %v", err)
	}
	if managedProcessAlive(pid) {
		t.Fatalf("managed process %d remained alive after stop script failure", pid)
	}
	driver.processMu.Lock()
	_, retained := driver.processes[service.ServiceID]
	driver.processMu.Unlock()
	if retained {
		t.Fatal("managed process ownership remained after cleanup")
	}
}
