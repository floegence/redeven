package managedwebservice

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func hostTestService(t *testing.T, root string, spec TemplateSpec) *pfregistry.ManagedService {
	t.Helper()
	snapshot, digest, err := canonicalTemplateSpec(spec)
	if err != nil {
		t.Fatal(err)
	}
	configuration, configurationDigest, err := canonicalServiceConfiguration(newServiceConfiguration(nil, nil))
	if err != nil {
		t.Fatal(err)
	}
	return &pfregistry.ManagedService{
		ServiceID: "mws_host_test", TemplateSource: "custom", ServiceFamilyID: "family_host_test", Deployment: string(DeploymentHost), WorkspacePath: root, RuntimePort: 39191,
		TemplateSnapshotJSON: snapshot, TemplateSnapshotSHA256: digest, ConfigurationJSON: configuration, ConfigurationRevision: 1, ConfigurationSHA256: configurationDigest,
	}
}

func setLegacyDeepSeekReleaseIdentity(t *testing.T, service *pfregistry.ManagedService) {
	t.Helper()
	service.Version = DeepSeekHarnessVersion
	raw, digest, err := canonicalReleaseIdentity(ReleaseIdentity{
		Kind: "npm", Source: "@deepseek-ai/dsh", Version: service.Version,
		Integrity: "sha512-reviewed", ArtifactReference: service.ArtifactReference, Trust: "redeven_reviewed_legacy",
	})
	if err != nil {
		t.Fatal(err)
	}
	service.ReleaseIdentityJSON, service.ReleaseIdentitySHA256 = raw, digest
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
	driver := &hostScriptDriver{manager: &Manager{stateDir: root}, processes: map[string]hostProcess{}}
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
	service := hostTestService(t, root, TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http", HealthPath: "/"},
		Host: &HostTemplateSpec{StartScript: `exec sleep 60`},
	})
	first := &hostScriptDriver{manager: &Manager{stateDir: root}, processes: map[string]hostProcess{}}
	identity, err := first.Start(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	service.RuntimeIdentity = identity
	second := &hostScriptDriver{manager: &Manager{stateDir: root}, processes: map[string]hostProcess{}}
	recovered, err := second.Start(context.Background(), service)
	if err != nil {
		t.Fatalf("Start() after Runtime restart error = %v", err)
	}
	if recovered != identity || !strings.HasPrefix(recovered, "host:v2:") {
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
	service := hostTestService(t, root, TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http", HealthPath: "/"},
		Host: &HostTemplateSpec{StartScript: `exec sleep 60`},
	})
	first := &hostScriptDriver{manager: &Manager{stateDir: root}, processes: map[string]hostProcess{}}
	identity, err := first.Start(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = killManagedProcessPID(hostPIDFromIdentity(identity)) })
	service.RuntimeIdentity = strings.TrimSuffix(identity, parseHostIdentity(identity).fingerprint) + strings.Repeat("0", 64)
	second := &hostScriptDriver{manager: &Manager{stateDir: root}, processes: map[string]hostProcess{}}
	if _, err := second.Start(context.Background(), service); managedErrorCode(err) != "HOST_PROCESS_IDENTITY_MISMATCH" {
		t.Fatalf("changed process fingerprint error = %v", err)
	}
	service.RuntimeIdentity = strings.Replace(identity, service.ServiceID, "mws_other", 1)
	if _, err := second.Start(context.Background(), service); managedErrorCode(err) != "HOST_PROCESS_IDENTITY_MISMATCH" {
		t.Fatalf("changed process service identity error = %v", err)
	}
	service.RuntimeIdentity = fmt.Sprintf("native:%s:legacy:%d", service.ServiceID, hostPIDFromIdentity(identity))
	if err := first.Stop(context.Background(), service); managedErrorCode(err) != "RUNTIME_IDENTITY_MISMATCH" {
		t.Fatalf("in-memory process accepted a substituted legacy identity: %v", err)
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
	root := filepath.Join(t.TempDir(), "state-file")
	if err := os.WriteFile(root, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := hostTestService(t, t.TempDir(), TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http", HealthPath: "/"},
		Host: &HostTemplateSpec{StartScript: `exec sleep 60`},
	})
	driver := &hostScriptDriver{manager: &Manager{stateDir: root}, processes: map[string]hostProcess{}}
	if _, err := driver.Start(context.Background(), service); managedErrorCode(err) != "HOST_RUNTIME_PREPARE_FAILED" {
		t.Fatalf("managed directory failure = %v", err)
	}
}

func TestHostServiceEnvironmentRemovesInheritedRegistryToken(t *testing.T) {
	t.Setenv("HOST_AUTH_TOKEN", "must-not-reach-lifecycle-script")
	root := t.TempDir()
	service := hostTestService(t, root, TemplateSpec{
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
	driver := &hostScriptDriver{manager: &Manager{stateDir: root}}
	environment, err := driver.serviceEnvironment(service, "/managed/executable")
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range environment {
		if strings.HasPrefix(item, "HOST_AUTH_TOKEN=") || strings.Contains(item, "must-not-reach-lifecycle-script") {
			t.Fatalf("registry token reached Host lifecycle environment: %q", item)
		}
	}
}

func TestMigratedDeepSeekHostUsesLegacyDataAndLogLayout(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("custom host lifecycle is Unix-only")
	}
	root := t.TempDir()
	workspace := t.TempDir()
	executable := filepath.Join(root, DeepSeekHarnessProductID, "native", "0.1.1-rc.2", currentPlatformKey(), "bin", "dsh")
	if err := os.MkdirAll(filepath.Dir(executable), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(executable, []byte("#!/bin/sh\nexec sleep 60\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	spec := deepSeekHostTemplateSpec()
	spec.Host.StartScript = `printf '%s\n%s\n' "$DSH_HOME" "$HOME" > "$REDEVEN_WORKSPACE/runtime-env"; exec "$REDEVEN_INSTALL_EXECUTABLE"`
	service := hostTestService(t, workspace, spec)
	service.TemplateID = DeepSeekHarnessHostTemplateID
	service.TemplateSource = "builtin"
	service.ServiceFamilyID = DeepSeekHarnessHostTemplateID
	service.ArtifactReference = executable
	if driver := (&hostScriptDriver{manager: &Manager{stateDir: root}}); driver.legacyDeepSeekLayout(service) {
		t.Fatal("legacy layout accepted an unverified release identity")
	}
	setLegacyDeepSeekReleaseIdentity(t, service)
	driver := &hostScriptDriver{manager: &Manager{stateDir: root}, processes: map[string]hostProcess{}}
	identity, err := driver.Start(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	service.RuntimeIdentity = identity
	t.Cleanup(func() { _ = driver.Stop(context.Background(), service) })
	var values []byte
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		values, err = os.ReadFile(filepath.Join(workspace, "runtime-env"))
		if err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(root, DeepSeekHarnessProductID, "data") + "\n" + workspace + "\n"
	if string(values) != want {
		t.Fatalf("legacy Host environment = %q, want %q", values, want)
	}
	if _, err := os.Stat(filepath.Join(root, DeepSeekHarnessProductID, "logs", "harness.log")); err != nil {
		t.Fatalf("legacy Host log was not prepared: %v", err)
	}
}

func TestMigratedDeepSeekHostAdoptsVerifiedLegacyProcess(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("custom host lifecycle is Unix-only")
	}
	root := t.TempDir()
	platformRoot := filepath.Join(root, DeepSeekHarnessProductID, "native", "0.1.1-rc.2", currentPlatformKey())
	executable := filepath.Join(platformRoot, "bin", "dsh")
	runtimeScript := filepath.Join(platformRoot, "app", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
	artifact, ok := auditedNativeArtifact(currentPlatformKey())
	if !ok {
		t.Skip("managed Node.js runtime is unavailable for this platform")
	}
	nodeSource, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable for the process recovery test")
	}
	nodePath := filepath.Join(platformRoot, filepath.FromSlash(artifact.NodeRelPath))
	for _, path := range []string{executable, runtimeScript, nodePath} {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(executable, []byte("#!/bin/sh\nexit 0\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(runtimeScript, []byte("setInterval(() => {}, 1000);\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(nodeSource, nodePath); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(nodePath, runtimeScript, "web", "--host", "127.0.0.1", "--port", "39191")
	configureManagedProcess(cmd)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = killManagedProcess(cmd); _, _ = cmd.Process.Wait() })
	service := hostTestService(t, root, deepSeekHostTemplateSpec())
	service.TemplateID = DeepSeekHarnessHostTemplateID
	service.TemplateSource = "builtin"
	service.ServiceFamilyID = DeepSeekHarnessHostTemplateID
	service.ArtifactReference = executable
	setLegacyDeepSeekReleaseIdentity(t, service)
	if legacyDeepSeekProcessCommandMatches(service, nodePath+" "+runtimeScript+" web --host 127.0.0.1 --port 1") {
		t.Fatal("legacy process validation accepted a different service port")
	}
	if legacyDeepSeekProcessCommandMatches(service, nodePath+" "+runtimeScript+" web --host 0.0.0.0 --port 39191") {
		t.Fatal("legacy process validation accepted a different service host")
	}
	service.RuntimeIdentity = fmt.Sprintf("native:%s:legacy:%d", service.ServiceID, cmd.Process.Pid)
	driver := &hostScriptDriver{manager: &Manager{stateDir: root}, processes: map[string]hostProcess{}}
	identity, err := driver.Start(context.Background(), service)
	if err != nil {
		t.Fatalf("Start() verified legacy process error = %v", err)
	}
	if !strings.HasPrefix(identity, "host:v2:") {
		t.Fatalf("legacy process identity was not upgraded: %q", identity)
	}
	service.RuntimeIdentity = identity
	if err := driver.Stop(context.Background(), service); err != nil {
		t.Fatalf("Stop() adopted legacy process error = %v", err)
	}
}
