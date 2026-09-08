package managedwebservice

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/filesystemscope"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func hostTestService(t *testing.T, root string, spec TemplateSpec) (*Manager, *pfregistry.ManagedService) {
	t.Helper()
	root, resolveErr := filepath.EvalSymlinks(root)
	if resolveErr != nil {
		t.Fatal(resolveErr)
	}
	specJSON, specDigest, err := canonicalTemplateSpec(spec)
	if err != nil {
		t.Fatal(err)
	}
	registry, err := pfregistry.Open(filepath.Join(root, "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = registry.Close() })
	catalog, err := LoadBuiltinCatalog()
	if err != nil {
		t.Fatal(err)
	}
	scope, err := filesystemscope.NewDefaultRegistry(root)
	if err != nil {
		t.Fatal(err)
	}
	const templateID = "template-host-test"
	const familyID = "family-host-test"
	if err := registry.CreateManagedTemplate(context.Background(), pfregistry.ManagedTemplate{
		TemplateID: templateID, Name: "Host test", Source: "custom", Deployment: string(DeploymentHost), Revision: 1,
		SpecJSON: specJSON, SpecSHA256: specDigest, ServiceFamilyID: familyID,
	}); err != nil {
		t.Fatal(err)
	}
	configuration, configurationDigest, err := canonicalServiceConfiguration(newServiceConfiguration(nil, nil))
	if err != nil {
		t.Fatal(err)
	}
	releaseIdentity := ReleaseIdentity{Kind: "none"}
	if spec.Host != nil && spec.Host.NPM != nil {
		releaseIdentity = ReleaseIdentity{
			Kind: "npm", Source: spec.Host.NPM.PackageName, Registry: normalizedRegistryURL(spec.Host.NPM.RegistryURL),
			Version: spec.Host.NPM.Version, Platform: currentPlatformKey(),
		}
	}
	release, releaseDigest, err := canonicalReleaseIdentity(releaseIdentity)
	if err != nil {
		t.Fatal(err)
	}
	service := &pfregistry.ManagedService{
		ServiceID: "mws_host_test", TemplateID: templateID, WorkspacePath: root, WorkspaceOwnership: workspaceOwnershipUserSelected, RuntimePort: 39191,
		ConfigurationJSON: configuration, ConfigurationRevision: 1, ConfigurationSHA256: configurationDigest,
		ReleaseIdentityJSON: release, ReleaseIdentitySHA256: releaseDigest,
	}
	raw, digest, err := newRuntimeBinding(service.ServiceID, familyID, DeploymentHost)
	if err != nil {
		t.Fatal(err)
	}
	service.RuntimeBindingJSON, service.RuntimeBindingSHA256 = raw, digest
	service.ForwardID = "pf-host-test"
	if err := registry.CreateManagedService(context.Background(), *service, pfregistry.Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:39191"}); err != nil {
		t.Fatal(err)
	}
	return &Manager{stateDir: root, registry: registry, catalog: catalog, scope: scope}, service
}

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
	manager, service := hostTestService(t, root, spec)
	driver := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
	if _, _, err := driver.Install(context.Background(), service, discardOperationProgress); err != nil {
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

func TestHostRuntimeRestartAdoptsExactProcessIdentity(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("custom host lifecycle is Unix-only")
	}
	root := t.TempDir()
	manager, service := hostTestService(t, root, TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http", HealthPath: "/"},
		Host: &HostTemplateSpec{StartScript: `exec sleep 60`},
	})
	first := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
	identity, err := first.Start(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	service.RuntimeIdentity = identity
	second := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
	recovered, err := second.Start(context.Background(), service)
	if err != nil {
		t.Fatalf("Start() after Runtime restart error = %v", err)
	}
	if recovered != identity || !strings.HasPrefix(recovered, "host:v3:") {
		t.Fatalf("recovered identity = %q, want %q", recovered, identity)
	}
	if err := second.Stop(context.Background(), service); err != nil {
		t.Fatalf("Stop() recovered process error = %v", err)
	}
	if managedProcessAlive(hostPIDFromIdentity(identity)) {
		t.Fatal("recovered Host process remained alive")
	}
}

func TestHostRuntimeRestartRejectsChangedProcessFingerprint(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("custom host lifecycle is Unix-only")
	}
	root := t.TempDir()
	manager, service := hostTestService(t, root, TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http", HealthPath: "/"},
		Host: &HostTemplateSpec{StartScript: `exec sleep 60`},
	})
	first := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
	identity, err := first.Start(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = killManagedProcessPID(hostPIDFromIdentity(identity)) })
	service.RuntimeIdentity = strings.TrimSuffix(identity, parseHostIdentity(identity).fingerprint) + strings.Repeat("0", 64)
	second := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
	if _, err := second.Start(context.Background(), service); managedErrorCode(err) != "HOST_PROCESS_IDENTITY_MISMATCH" {
		t.Fatalf("changed process fingerprint error = %v", err)
	}
	service.RuntimeIdentity = strings.Replace(identity, service.ServiceID, "mws_other", 1)
	if _, err := second.Start(context.Background(), service); managedErrorCode(err) != "HOST_PROCESS_IDENTITY_MISMATCH" {
		t.Fatalf("changed process service identity error = %v", err)
	}
	service.RuntimeIdentity = fmt.Sprintf("host:v1:%s:invalid:%d", service.ServiceID, hostPIDFromIdentity(identity))
	if err := first.Stop(context.Background(), service); managedErrorCode(err) != "RUNTIME_IDENTITY_MISMATCH" {
		t.Fatalf("in-memory process accepted a substituted non-v2 identity: %v", err)
	}
	if !managedProcessRunning(hostPIDFromIdentity(identity)) {
		t.Fatal("identity mismatch stopped the managed Host process")
	}
	service.RuntimeIdentity = identity
	if err := first.Stop(context.Background(), service); err != nil {
		t.Fatalf("cleanup Host process: %v", err)
	}
}

func TestHostStartClassifiesManagedDirectoryFailure(t *testing.T) {
	t.Parallel()
	manager, service := hostTestService(t, t.TempDir(), TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http", HealthPath: "/"},
		Host: &HostTemplateSpec{StartScript: `exec sleep 60`},
	})
	if err := os.WriteFile(filepath.Join(manager.stateDir, "instances"), []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	driver := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
	if _, err := driver.Start(context.Background(), service); managedErrorCode(err) != "HOST_RUNTIME_PREPARE_FAILED" {
		t.Fatalf("managed directory failure = %v", err)
	}
}

func TestHostServiceEnvironmentRemovesInheritedRegistryToken(t *testing.T) {
	t.Setenv("HOST_AUTH_TOKEN", "must-not-reach-lifecycle-script")
	root := t.TempDir()
	manager, service := hostTestService(t, root, TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion,
		Kind:          DeploymentHost,
		Endpoint:      WebEndpointSpec{Scheme: "http", HealthPath: "/"},
		Parameters:    []TemplateParameter{{Name: "HOST_AUTH_TOKEN", Type: "secret"}},
		Host: &HostTemplateSpec{
			StartScript: `exec sleep 60`,
			NPM: &NPMHostPackageSpec{
				PackageName: "@example/service", Version: "1.0.0", RegistryURL: "https://registry.npmjs.org/",
				AuthTokenParameter: "HOST_AUTH_TOKEN", Executable: "service",
			},
		},
	})
	driver := &hostScriptDriver{manager: manager}
	environment, err := driver.serviceEnvironment(context.Background(), service, "/managed/executable")
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range environment {
		if strings.HasPrefix(item, "HOST_AUTH_TOKEN=") || strings.Contains(item, "must-not-reach-lifecycle-script") {
			t.Fatalf("registry token reached Host lifecycle environment: %q", item)
		}
	}
}
