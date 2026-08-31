package containerengine

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

type containerServiceTestRunner struct {
	mu           sync.Mutex
	calls        []string
	restartCalls int
	restartError func(int) error
}

func (r *containerServiceTestRunner) Run(_ context.Context, name string, args ...string) ([]byte, error) {
	key := strings.TrimSpace(name + " " + strings.Join(args, " "))
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, key)
	switch {
	case key == "docker context ls --format {{json .}}":
		return []byte(`{"Name":"default","Current":true,"DockerEndpoint":"unix:///var/run/docker.sock"}` + "\n"), nil
	case key == "docker --context default version --format {{json .}}":
		return []byte(`{"Client":{"Version":"27.1.0"},"Server":{"Version":"27.1.0"}}`), nil
	case key == "docker desktop status --format json":
		return nil, errors.New("desktop CLI unavailable")
	case key == "systemctl --user show --property=LoadState --value docker.service":
		return []byte("loaded\n"), nil
	case strings.HasPrefix(key, "dockerd --validate --config-file "):
		return nil, nil
	case key == "systemctl --user --no-ask-password restart docker.service":
		r.restartCalls++
		if r.restartError != nil {
			return nil, r.restartError(r.restartCalls)
		}
		return nil, nil
	case key == "podman system connection list --format json":
		return nil, ErrCLIUnavailable
	default:
		return nil, errFakeCommandNotFound(key)
	}
}

func TestContainerServicesKeepEngineDetectionIndependent(t *testing.T) {
	runner := &runtimeDiscoveryRunner{
		outputs: map[string]string{
			"podman system connection list --format json": `[]`,
			"podman version --format {{json .}}":          `{"Client":{"Version":"5.4.0"},"Server":{"Version":"5.4.0"}}`,
			"podman info --format json":                   `{"host":{"security":{"rootless":true}}}`,
		},
		errors: map[string]error{"docker context ls --format {{json .}}": ErrCLIUnavailable},
	}
	client := &CLIClient{Runner: runner, UserConfigDir: func() (string, error) { return t.TempDir(), nil }}

	services, err := client.ContainerServices(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(services) != 2 || services[0].State != ContainerServiceStateNotInstalled {
		t.Fatalf("services = %+v", services)
	}
	if services[1].Implementation != ContainerServicePodmanLocal || services[1].State != ContainerServiceStateRunning || services[1].Rootless == nil || !*services[1].Rootless {
		t.Fatalf("Podman service = %+v", services[1])
	}
	if services[1].Capabilities.Start || services[1].ConfigurationAccess.Mode != ContainerServiceConfigurationEditable || services[1].ConfigurationAccess.Format != ContainerServiceConfigurationTOML {
		t.Fatalf("local Podman service = %+v", services[1])
	}
}

func TestContainerServicesUseOfficialDockerLifecycleWithoutElevation(t *testing.T) {
	runner := &runtimeDiscoveryRunner{outputs: map[string]string{
		"docker context ls --format {{json .}}":                             `{"Name":"default","Current":true,"DockerEndpoint":"unix:///var/run/docker.sock"}` + "\n",
		"docker --context default version --format {{json .}}":              `{"Client":{"Version":"27.1.0"},"Server":{"Version":"27.1.0"}}`,
		"systemctl --user show --property=LoadState --value docker.service": "loaded\n",
		"systemctl --user --no-ask-password stop docker.service":            "",
		"podman system connection list --format json":                       `[]`,
		"podman version --format {{json .}}":                                `{"Client":{"Version":"5.4.0"},"Server":{"Version":"5.4.0"}}`,
		"podman info --format json":                                         `{"host":{"security":{"rootless":true}}}`,
	}, errors: map[string]error{"docker desktop status --format json": errors.New("desktop CLI unavailable")}}
	client := &CLIClient{Runner: runner, GOOS: "linux", EffectiveUserID: func() int { return 1000 }, UserConfigDir: func() (string, error) { return t.TempDir(), nil }}
	services, err := client.ContainerServices(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	docker := services[0]
	if docker.Implementation != ContainerServiceDockerEngine || !docker.Capabilities.Stop {
		t.Fatalf("Docker service = %+v", docker)
	}
	if _, err := client.ContainerServiceAction(context.Background(), MethodContainerServicesStop, ContainerServiceActionRequest{Engine: EngineDocker, ServiceID: docker.ServiceID, ConfirmationName: docker.Name}); err != nil {
		t.Fatal(err)
	}
	if !runner.called("systemctl --user --no-ask-password stop docker.service") {
		t.Fatalf("lifecycle command not called: %v", runner.calls)
	}
	for _, call := range runner.calls {
		if strings.Contains(call, "sudo") || strings.Contains(call, "pkexec") {
			t.Fatalf("unexpected elevation command: %s", call)
		}
	}
}

func TestDockerDesktopNotRunningIsStopped(t *testing.T) {
	runner := &runtimeDiscoveryRunner{outputs: map[string]string{
		"docker desktop status --format json": `{"status":"not running"}`,
	}}
	client := &CLIClient{Runner: runner}

	state, ok := client.dockerDesktopState(context.Background())
	if !ok || state != ContainerServiceStateStopped {
		t.Fatalf("Docker Desktop state = %q, %v", state, ok)
	}
}

func TestDockerDesktopConfigurationIsOwnedByOfficialSettings(t *testing.T) {
	runner := &runtimeDiscoveryRunner{outputs: map[string]string{
		"docker context ls --format {{json .}}":                `{"Name":"default","Current":true,"DockerEndpoint":"unix:///var/run/docker.sock"}` + "\n",
		"docker --context default version --format {{json .}}": `{"Client":{"Version":"29.0.1"},"Server":{"Version":"29.0.1"}}`,
		"docker desktop status --format json":                  `{"status":"running"}`,
	}, errors: map[string]error{"podman system connection list --format json": ErrCLIUnavailable}}
	client := &CLIClient{Runner: runner}

	services, err := client.ContainerServices(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	docker := services[0]
	if docker.Implementation != ContainerServiceDockerDesktop || docker.ConfigurationAccess.Mode != ContainerServiceConfigurationExternal || docker.ConfigurationAccess.Owner != ContainerServiceConfigurationOwnerDockerDesktop {
		t.Fatalf("Docker Desktop service = %+v", docker)
	}
	if docker.ConfigurationAccess.Format != "" || len(docker.ConfigurationAccess.Sections) != 0 {
		t.Fatalf("Docker Desktop exposed a Redeven editor: %+v", docker.ConfigurationAccess)
	}
}

func TestDockerSystemdUnitRequiresLoadedState(t *testing.T) {
	runner := &runtimeDiscoveryRunner{outputs: map[string]string{
		"systemctl --user show --property=LoadState --value docker.service": "not-found\n",
	}}
	client := &CLIClient{Runner: runner, GOOS: "linux", EffectiveUserID: func() int { return 1000 }}

	if unit, userUnit := client.detectDockerSystemdUnit(context.Background()); unit != "" || userUnit {
		t.Fatalf("systemd unit = %q, user = %v", unit, userUnit)
	}
}

func TestPodmanMachineRequiresInspectAssociation(t *testing.T) {
	runner := &runtimeDiscoveryRunner{outputs: map[string]string{
		"podman system connection list --format json":  `[{"Name":"machine","Default":true,"ReadWrite":true,"URI":"ssh://core@127.0.0.1:51234/run/user/1000/podman/podman.sock"}]`,
		"podman machine list --format json":            `[{"Name":"machine","Running":false}]`,
		"podman machine inspect --format json machine": `[{"Name":"machine","SSHConfig":{"Port":51234,"RemoteUsername":"core"},"ConnectionInfo":{"PodmanSocket":{"Path":"/run/user/1000/podman/podman.sock"}}}]`,
	}, errors: map[string]error{
		"docker context ls --format {{json .}}":                   ErrCLIUnavailable,
		"podman --connection machine version --format {{json .}}": ErrDaemonStopped,
	}}
	client := &CLIClient{Runner: runner}
	services, err := client.ContainerServices(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got := services[1]; got.Implementation != ContainerServicePodmanMachine || got.State != ContainerServiceStateStopped || !got.Capabilities.Start || got.ConfigurationAccess.Mode != ContainerServiceConfigurationExternal || got.ConfigurationAccess.Owner != ContainerServiceConfigurationOwnerPodmanMachine {
		t.Fatalf("Podman Machine = %+v", got)
	}
}

func TestContainerServiceConfigurationMergeConflictAndSymlinkSafety(t *testing.T) {
	raw := []byte("{\n  \"log-level\": \"warn\",\n  \"proxies\": {\"http-proxy\": \"old\"}\n}\n")
	merged, err := mergeContainerServiceProxy(ContainerServiceConfigurationJSON, raw, "http://new", "", "localhost")
	if err != nil {
		t.Fatal(err)
	}
	text := string(merged)
	for _, want := range []string{`"log-level": "warn"`, `"http-proxy": "http://new"`, `"no-proxy": "localhost"`} {
		if !strings.Contains(text, want) {
			t.Fatalf("merged config = %s, want %s", text, want)
		}
	}

	directory := t.TempDir()
	path := filepath.Join(directory, "daemon.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := writeContainerServiceConfiguration(path, []byte("different"), merged); !errors.Is(err, ErrContainerServiceConfigConflict) {
		t.Fatalf("conflict error = %v", err)
	}
	linkedDirectory := filepath.Join(t.TempDir(), "linked")
	if err := os.Symlink(directory, linkedDirectory); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if safeConfigPath(filepath.Join(linkedDirectory, "daemon.json")) {
		t.Fatal("configuration path through symlink was accepted")
	}
}

func TestContainerServiceConfigurationSaveValidatesAndMarksRestartRequired(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "docker", "daemon.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	current := []byte("{\n  \"log-level\": \"warn\"\n}\n")
	if err := os.WriteFile(path, current, 0o600); err != nil {
		t.Fatal(err)
	}
	runner := &containerServiceTestRunner{}
	client := &CLIClient{Runner: runner, GOOS: "linux", EffectiveUserID: func() int { return 1000 }, UserConfigDir: func() (string, error) { return directory, nil }}
	services, err := client.ContainerServices(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	docker := services[0]
	result, err := client.UpdateContainerServiceConfiguration(context.Background(), ContainerServiceConfigurationUpdateRequest{
		Engine: EngineDocker, ServiceID: docker.ServiceID, BaseRevision: configurationRevision(current, true),
		Mode: ContainerServiceConfigurationProxy, ApplyMode: ContainerServiceSave, HTTPProxy: "http://proxy.example:3128",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.RestartRequired || result.Revision == "" {
		t.Fatalf("configuration result = %+v", result)
	}
	updated, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(updated), `"log-level": "warn"`) || !strings.Contains(string(updated), `"http-proxy": "http://proxy.example:3128"`) {
		t.Fatalf("updated configuration = %s", updated)
	}
}

func TestContainerServiceConfigurationRestoresPreviousContentAfterRestartFailure(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "docker", "daemon.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	current := []byte("{\n  \"log-level\": \"warn\"\n}\n")
	if err := os.WriteFile(path, current, 0o600); err != nil {
		t.Fatal(err)
	}
	runner := &containerServiceTestRunner{restartError: func(call int) error {
		if call == 1 {
			return errors.New("restart failed")
		}
		return nil
	}}
	client := &CLIClient{Runner: runner, GOOS: "linux", EffectiveUserID: func() int { return 1000 }, UserConfigDir: func() (string, error) { return directory, nil }}
	services, err := client.ContainerServices(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	docker := services[0]
	_, err = client.UpdateContainerServiceConfiguration(context.Background(), ContainerServiceConfigurationUpdateRequest{
		Engine: EngineDocker, ServiceID: docker.ServiceID, BaseRevision: configurationRevision(current, true),
		Mode: ContainerServiceConfigurationProxy, ApplyMode: ContainerServiceSaveAndRestart, HTTPProxy: "http://proxy.example:3128",
	})
	if err == nil || errors.Is(err, ErrContainerServiceRecoveryRequired) {
		t.Fatalf("restart error = %v", err)
	}
	restored, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(restored) != string(current) || runner.restartCalls != 2 {
		t.Fatalf("restored configuration = %s, restart calls = %d", restored, runner.restartCalls)
	}
}

func TestContainerServiceConfigurationReportsRecoveryRequired(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "docker", "daemon.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	current := []byte("{}\n")
	if err := os.WriteFile(path, current, 0o600); err != nil {
		t.Fatal(err)
	}
	runner := &containerServiceTestRunner{restartError: func(int) error { return errors.New("restart failed") }}
	client := &CLIClient{Runner: runner, GOOS: "linux", EffectiveUserID: func() int { return 1000 }, UserConfigDir: func() (string, error) { return directory, nil }}
	services, err := client.ContainerServices(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.UpdateContainerServiceConfiguration(context.Background(), ContainerServiceConfigurationUpdateRequest{
		Engine: EngineDocker, ServiceID: services[0].ServiceID, BaseRevision: configurationRevision(current, true),
		Mode: ContainerServiceConfigurationProxy, ApplyMode: ContainerServiceSaveAndRestart, HTTPProxy: "http://proxy.example:3128",
	})
	if !errors.Is(err, ErrContainerServiceRecoveryRequired) {
		t.Fatalf("recovery error = %v", err)
	}
}
