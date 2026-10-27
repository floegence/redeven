package containerengine

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
)

const stoppedDockerDesktopDiagnostic = "Could not retrieve status. Is Docker Desktop running?\nYou can start Docker Desktop by running 'docker desktop start'.\n"

func TestDockerDesktopStoppedCommandFailureClassification(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name   string
		args   []string
		detail string
		want   bool
	}{
		{name: "stopped desktop", args: []string{"desktop", "status", "--format", "json"}, detail: stoppedDockerDesktopDiagnostic, want: true},
		{name: "missing plugin", args: []string{"desktop", "status", "--format", "json"}, detail: "docker: 'desktop' is not a docker command"},
		{name: "unknown failure", args: []string{"desktop", "status", "--format", "json"}, detail: "failed to read private settings"},
		{name: "incomplete diagnostic", args: []string{"desktop", "status", "--format", "json"}, detail: "Could not retrieve status. Is Docker Desktop running?"},
		{name: "unrelated command", args: []string{"logs", "container_1"}, detail: stoppedDockerDesktopDiagnostic},
	} {
		t.Run(tt.name, func(t *testing.T) {
			err := classifyCommandFailure(tt.args, errors.New("exit status 1"), []byte(tt.detail))
			if errors.Is(err, ErrDaemonStopped) != tt.want {
				t.Fatalf("classification = %v, want stopped = %v", err, tt.want)
			}
			if strings.Contains(err.Error(), tt.detail) {
				t.Fatalf("classification exposed command diagnostics: %v", err)
			}
		})
	}
}

func TestDockerDesktopStatusErrorsDistinguishStoppedFromUnknown(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name string
		err  error
		want bool
	}{
		{name: "stopped", err: ErrDaemonStopped, want: true},
		{name: "missing CLI", err: ErrCLIUnavailable},
		{name: "unknown failure", err: errors.New("exit status 1")},
		{name: "permission denied", err: ErrPermissionDenied},
		{name: "timeout", err: ErrEngineTimeout},
		{name: "canceled", err: context.Canceled},
	} {
		t.Run(tt.name, func(t *testing.T) {
			client := &CLIClient{Runner: &runtimeDiscoveryRunner{errors: map[string]error{"docker desktop status --format json": tt.err}}}
			state, ok := client.dockerDesktopState(context.Background())
			if ok != tt.want || (ok && state != ContainerServiceStateStopped) {
				t.Fatalf("Desktop state = %q, %v; want identified stopped = %v", state, ok, tt.want)
			}
		})
	}
}

func TestDockerDesktopStoppedLifecyclePreservesServiceIdentity(t *testing.T) {
	t.Parallel()
	var mu sync.Mutex
	running := false
	var lifecycleCalls []string
	runner := CommandRunnerFunc(func(_ context.Context, name string, args ...string) ([]byte, error) {
		mu.Lock()
		defer mu.Unlock()
		command := name + " " + strings.Join(args, " ")
		switch command {
		case "docker context ls --format {{json .}}":
			return []byte(`{"Name":"desktop-linux","Current":true,"DockerEndpoint":"unix:///home/test/.docker/run/docker.sock"}`), nil
		case "docker --context desktop-linux version --format {{json .}}":
			if !running {
				return nil, ErrDaemonStopped
			}
			return []byte(`{"Client":{"Version":"29.0.1"},"Server":{"Version":"29.0.1"}}`), nil
		case "docker desktop status --format json":
			if !running {
				return nil, classifyCommandFailure(args, errors.New("exit status 1"), []byte(stoppedDockerDesktopDiagnostic))
			}
			return []byte(`{"Status":"running"}`), nil
		case "docker desktop start", "docker desktop stop":
			running = command == "docker desktop start"
			lifecycleCalls = append(lifecycleCalls, command)
			return nil, nil
		case "podman system connection list --format json":
			return nil, ErrCLIUnavailable
		default:
			t.Errorf("unexpected host command: %s", command)
			return nil, errFakeCommandNotFound(command)
		}
	})
	home := t.TempDir()
	client := &CLIClient{Runner: runner, GOOS: "darwin", UserHomeDir: func() (string, error) { return home, nil }}
	services, err := client.ContainerServices(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	desktop := services[0]
	if desktop.Implementation != ContainerServiceDockerDesktop || desktop.Name != "Docker Desktop" || desktop.State != ContainerServiceStateStopped || !desktop.Capabilities.Start || desktop.GuidanceCode != "" {
		t.Fatalf("stopped Desktop service = %+v", desktop)
	}
	if desktop.ConfigurationAccess.Mode != ContainerServiceConfigurationLocal {
		t.Fatalf("Desktop configuration = %+v", desktop.ConfigurationAccess)
	}
	for _, step := range []struct {
		method Method
		state  ContainerServiceState
	}{
		{MethodContainerServicesStart, ContainerServiceStateRunning},
		{MethodContainerServicesStop, ContainerServiceStateStopped},
		{MethodContainerServicesStart, ContainerServiceStateRunning},
	} {
		result, err := client.ContainerServiceAction(context.Background(), step.method, ContainerServiceActionRequest{Engine: EngineDocker, ServiceID: desktop.ServiceID, ConfirmationName: desktop.Name})
		if err != nil {
			t.Fatalf("%s: %v", step.method, err)
		}
		if result.ServiceID != desktop.ServiceID || result.State != step.state {
			t.Fatalf("%s result = %+v, want stable identity and %s", step.method, result, step.state)
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if got := strings.Join(lifecycleCalls, ","); got != "docker desktop start,docker desktop stop,docker desktop start" {
		t.Fatalf("lifecycle calls = %s", got)
	}
}
