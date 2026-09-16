package managedwebservice

import (
	"context"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/containerengine"
)

func TestContainerSharedMemoryResolvesAfterInstanceOverrides(t *testing.T) {
	const mib = int64(1024 * 1024)
	zero, explicit := int64(0), 128*mib
	host, shared, private := "host", "container:other", "private"
	tests := []struct {
		name, profile, ipc string
		size               int64
		override           *containerSettingsOverride
		want               int64
	}{
		{name: "ordinary default", want: 64 * mib},
		{name: "private default", ipc: private, want: 64 * mib},
		{name: "explicit", size: explicit, want: explicit},
		{name: "desktop default", profile: ContainerRuntimeProfileInteractiveDesktop, want: 1024 * mib},
		{name: "desktop explicit", profile: ContainerRuntimeProfileInteractiveDesktop, size: explicit, want: explicit},
		{name: "zero override", size: explicit, override: &containerSettingsOverride{ShmSizeBytes: &zero}, want: 64 * mib},
		{name: "desktop zero override", profile: ContainerRuntimeProfileInteractiveDesktop, override: &containerSettingsOverride{ShmSizeBytes: &zero}, want: 64 * mib},
		{name: "positive override", override: &containerSettingsOverride{ShmSizeBytes: &explicit}, want: explicit},
		{name: "host IPC", ipc: host},
		{name: "shared IPC", ipc: shared},
		{name: "desktop host IPC", profile: ContainerRuntimeProfileInteractiveDesktop, ipc: host},
		{name: "host IPC override", override: &containerSettingsOverride{IPCMode: &host}},
		{name: "desktop shared IPC override", profile: ContainerRuntimeProfileInteractiveDesktop, override: &containerSettingsOverride{IPCMode: &shared}},
		{name: "private IPC override", ipc: host, override: &containerSettingsOverride{IPCMode: &private}, want: 64 * mib},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spec := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentContainer,
				Endpoint:  WebEndpointSpec{Scheme: "http", ContainerPort: 3000},
				Container: &ContainerTemplateSpec{Image: "example.invalid/app:1", RuntimeProfile: tt.profile, IPCMode: tt.ipc, ShmSizeBytes: tt.size}}
			config := newServiceConfiguration(nil, nil)
			config.Container = tt.override
			for range 2 {
				effective, err := applyServiceConfiguration(spec, config, "custom")
				if err != nil {
					t.Fatal(err)
				}
				if effective.Container.ShmSizeBytes != tt.want {
					t.Fatalf("effective shared memory = %d, want %d", effective.Container.ShmSizeBytes, tt.want)
				}
				request := containerCreateRequest(uninstallContainerService(), effective, spec.Container.Image, nil, nil)
				if request.ShmSizeBytes != tt.want {
					t.Fatalf("creation does not use the resolved size: %d", request.ShmSizeBytes)
				}
			}
			if spec.Container.ShmSizeBytes != tt.size || spec.Container.IPCMode != tt.ipc {
				t.Fatal("resolution mutated the template baseline")
			}
		})
	}
}

func TestContainerConfigurationDiagnosticsContainOnlyFieldNames(t *testing.T) {
	actual := containerengine.RuntimeSummary{User: "/private/secret-user", SecurityOpts: []string{"secret-value"}, Privileged: true, RestartPolicy: "no"}
	err := compareContainerRuntime(actual, ContainerRuntimeSettings{}, true)
	wrapped := serviceError("CONTAINER_CONFIGURATION_MISMATCH", "safe summary", 409, false, err)
	if got := safeManagedFailureCause(wrapped); got != "container configuration mismatch: privileged, user, security_opts" || strings.Contains(got, "secret") {
		t.Fatalf("unexpected diagnostics: %s", got)
	}
	for _, ipc := range []string{"host", "container:owner"} {
		actual := containerengine.RuntimeSummary{IPCMode: ipc, ShmSizeBytes: 123456, RestartPolicy: "no"}
		if err := compareContainerRuntime(actual, ContainerRuntimeSettings{IPCMode: ipc}, true); err != nil {
			t.Fatalf("shared IPC must not impose a private memory size: %v", err)
		}
		actual.IPCMode = "private"
		if err := compareContainerRuntime(actual, ContainerRuntimeSettings{IPCMode: ipc}, true); err == nil {
			t.Fatal("shared IPC identity drift was accepted")
		}
	}
}

func TestComposeSharedMemoryUsesResolvedConfiguration(t *testing.T) {
	zero := int64(0)
	for _, tt := range []struct {
		name, fields string
		override     *containerSettingsOverride
		want         int64
	}{
		{name: "default", want: 64 * 1024 * 1024},
		{name: "explicit", fields: "    shm_size: 134217728\n", want: 128 * 1024 * 1024},
		{name: "zero override", fields: "    shm_size: 134217728\n", override: &containerSettingsOverride{ShmSizeBytes: &zero}, want: 64 * 1024 * 1024},
		{name: "host IPC", fields: "    ipc: host\n"},
		{name: "shared IPC", fields: "    ipc: container:other\n"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			spec := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentCompose,
				Endpoint: WebEndpointSpec{Scheme: "http", ContainerPort: 3000},
				Compose:  &ComposeTemplateSpec{MainService: "web", YAML: "services:\n  web:\n    image: example.invalid/app:1\n" + tt.fields}}
			config := newServiceConfiguration(nil, nil)
			if tt.override != nil {
				config.Compose = map[string]containerSettingsOverride{"web": *tt.override}
			}
			effective, err := applyServiceConfiguration(spec, config, "custom")
			if err != nil {
				t.Fatal(err)
			}
			settings, err := composeBaselineSettings(effective)
			if err != nil || settings["web"].ShmSizeBytes != tt.want {
				t.Fatalf("resolved Compose size = %d, want %d: %v", settings["web"].ShmSizeBytes, tt.want, err)
			}
		})
	}
}

func TestContainerVerificationAcceptsDockerDefaultsAndRejectsDrift(t *testing.T) {
	m, service, engine := managementFixture(t)
	service.RuntimePort = 43123
	spec, err := effectiveTemplateSpec(TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentContainer,
		Endpoint: WebEndpointSpec{Scheme: "http", ContainerPort: 3000}, Container: &ContainerTemplateSpec{Image: service.ArtifactReference}})
	if err != nil {
		t.Fatal(err)
	}
	engine.container.Runtime = containerengine.RuntimeInput{Labels: map[string]string{managedServiceLabel: service.ServiceID},
		NetworkMode: "bridge", IPCMode: "private", RestartPolicy: "no", ReadOnlyRoot: true, PIDsLimit: 512,
		ShmSizeBytes: 64 * 1024 * 1024, CapDrop: []string{"ALL"}, SecurityOpts: []string{"no-new-privileges:true"}}
	engine.container.Ports = []containerengine.PortSummary{{Protocol: "tcp", HostIP: "127.0.0.1", HostPort: 43123, Port: 3000}}
	driver := m.container.(*containerTemplateDriver)
	if err := driver.VerifyRuntime(context.Background(), service, spec); err != nil {
		t.Fatalf("Docker defaults must pass verification: %v", err)
	}
	for _, size := range []int64{0, 128 * 1024 * 1024} {
		engine.container.Runtime.ShmSizeBytes = size
		if err := driver.VerifyRuntime(context.Background(), service, spec); managedErrorCode(err) != "CONTAINER_CONFIGURATION_MISMATCH" {
			t.Fatalf("shared memory drift %d was accepted: %v", size, err)
		}
	}
	engine.container.Runtime.ShmSizeBytes = 64 * 1024 * 1024
	engine.container.Runtime.Privileged = true
	if err := driver.VerifyRuntime(context.Background(), service, spec); managedErrorCode(err) != "CONTAINER_CONFIGURATION_MISMATCH" {
		t.Fatalf("privileged drift was accepted: %v", err)
	}
}

func TestContainerPortsIgnoreUnpublishedImageMetadata(t *testing.T) {
	actual := []containerengine.PortSummary{{Protocol: "tcp", Port: 3000, HostIP: "127.0.0.1", HostPort: 43123}, {Protocol: "tcp", Port: 6080}}
	if !composePortsMatch(actual, nil, true, 43123, 3000) {
		t.Fatal("an image EXPOSE without a host binding must not be treated as an extra published port")
	}
	actual[1].HostPort, actual[1].HostIP = 6080, "0.0.0.0"
	if composePortsMatch(actual, nil, true, 43123, 3000) {
		t.Fatal("an unreviewed published port must be rejected")
	}
	actual = actual[:1]
	actual[0].Protocol = "udp"
	if composePortsMatch(actual, nil, true, 43123, 3000) {
		t.Fatal("a UDP binding must not satisfy a TCP endpoint")
	}
	actual[0].HostPort = 0
	if composePortsMatch(actual, []ContainerPortSpec{{ContainerPort: 3000, Protocol: "udp"}}, false, 0, 0) {
		t.Fatal("an image EXPOSE must not satisfy a dynamically allocated host binding")
	}
}
