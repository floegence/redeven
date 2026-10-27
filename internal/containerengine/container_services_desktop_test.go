package containerengine

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"testing/synctest"
	"time"
)

const stoppedDockerDesktopDiagnostic = "Could not retrieve status. Is Docker Desktop running?\nYou can start Docker Desktop by running 'docker desktop start'.\n"

func TestDockerDesktopDiscoverySeparatesOwnershipFromHealth(t *testing.T) {
	home := t.TempDir()
	var healthErr error = ErrDaemonStopped
	slowStatusCalls := 0
	runner := CommandRunnerFunc(func(ctx context.Context, name string, args ...string) ([]byte, error) {
		switch command := name + " " + strings.Join(args, " "); command {
		case "docker context ls --format {{json .}}":
			return []byte(`{"Name":"desktop-linux","Current":true,"DockerEndpoint":"unix:///home/test/.docker/run/docker.sock"}`), nil
		case "docker desktop version --format json":
			return []byte(`{"version":"v0.2.0"}`), nil
		case "docker --context desktop-linux version --format {{json .}}":
			if healthErr != nil {
				return nil, healthErr
			}
			return []byte(`{"Server":{"Version":"29.0.1"}}`), nil
		case "docker desktop status --format json":
			slowStatusCalls++
			<-ctx.Done()
			return nil, ctx.Err()
		case "podman system connection list --format json":
			return nil, ErrCLIUnavailable
		default:
			t.Errorf("unexpected command: %s", command)
			return nil, ErrCLIUnavailable
		}
	})
	client := &CLIClient{Runner: runner, Timeout: 25 * time.Millisecond, GOOS: "darwin", UserHomeDir: func() (string, error) { return home, nil }}
	adapter, err := NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	var identity string
	for _, step := range []struct {
		err   error
		state ContainerServiceState
	}{
		{ErrDaemonStopped, ContainerServiceStateStopped},
		{ErrEngineTimeout, ContainerServiceStateUnreachable},
		{ErrPermissionDenied, ContainerServiceStatePermission},
		{nil, ContainerServiceStateRunning},
		{ErrDaemonStopped, ContainerServiceStateStopped},
	} {
		healthErr = step.err
		services, err := client.ContainerServices(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		service := services[0]
		if service.Implementation != ContainerServiceDockerDesktop || service.State != step.state || !service.Capabilities.Start {
			t.Fatalf("service after health %v = %+v", step.err, service)
		}
		if identity != "" && service.ServiceID != identity {
			t.Fatalf("service identity changed: %s -> %s", identity, service.ServiceID)
		}
		identity = service.ServiceID
		if step.state != ContainerServiceStateStopped && step.state != ContainerServiceStateRunning {
			req := ContainerServiceActionRequest{Engine: EngineDocker, ServiceID: identity}
			if _, err := adapter.ContainerServiceActionPreflight(context.Background(), MethodContainerServicesStart, req); !errors.Is(err, ErrContainerServiceActionUnsupported) {
				t.Fatalf("unsafe preflight accepted state %s: %v", step.state, err)
			}
			if _, err := client.ContainerServiceAction(context.Background(), MethodContainerServicesStart, req); !errors.Is(err, ErrContainerServiceActionUnsupported) {
				t.Fatalf("unsafe action accepted state %s: %v", step.state, err)
			}
		}
	}
	if slowStatusCalls != 0 {
		t.Fatalf("discovery invoked slow Desktop status %d times", slowStatusCalls)
	}
}

func TestDockerDesktopManagementFailureRetainsIdentity(t *testing.T) {
	for _, tt := range []struct {
		name   string
		output string
		err    error
		state  ContainerServiceState
	}{
		{"missing", "", ErrCLIUnavailable, ContainerServiceStateNotInstalled},
		{"timeout", "", ErrEngineTimeout, ContainerServiceStateUnreachable},
		{"permission", "", ErrPermissionDenied, ContainerServiceStatePermission},
		{"unknown", "", errors.New("unknown plugin failure"), ContainerServiceStateError},
		{"unexpected stopped management", "", ErrDaemonStopped, ContainerServiceStateError},
		{"invalid", "not json", nil, ContainerServiceStateError},
		{"empty", `{"version":""}`, nil, ContainerServiceStateError},
	} {
		t.Run(tt.name, func(t *testing.T) {
			runner := &runtimeDiscoveryRunner{outputs: map[string]string{
				"docker context ls --format {{json .}}": `{"Name":"desktop-linux","Current":true,"DockerEndpoint":"unix:///desktop.sock"}`,
				"docker desktop version --format json":  tt.output,
			}, errors: map[string]error{"docker desktop version --format json": tt.err, "podman system connection list --format json": ErrCLIUnavailable}}
			client := &CLIClient{Runner: runner, GOOS: "darwin"}
			services, err := client.ContainerServices(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			service := services[0]
			if service.ServiceID != containerServiceID(EngineDocker, ContainerServiceDockerDesktop, "local") || service.State != tt.state || !service.Capabilities.Start || service.GuidanceCode == "" {
				t.Fatalf("management failure changed ownership or omitted guidance: %+v", service)
			}
			if serviceSupportsMethod(service, MethodContainerServicesStart) {
				t.Fatal("unavailable management accepted a lifecycle action")
			}
		})
	}
}

func TestDockerDesktopOwnershipMatchesSelectedEndpoint(t *testing.T) {
	for _, tt := range []struct {
		name, active, address, desktopAddress string
		remote, want                          bool
	}{
		{"official Linux", "desktop-linux", "unix:///desktop.sock", "unix:///desktop.sock", false, true},
		{"official Windows", "desktop-windows", "npipe:////./pipe/dockerDesktopWindowsEngine", "npipe:////./pipe/dockerDesktopWindowsEngine", false, true},
		{"alias", "work", "unix:///desktop.sock", "unix:///desktop.sock", false, true},
		{"independent engine", "default", "unix:///var/run/docker.sock", "unix:///desktop.sock", false, false},
		{"Podman compatibility", "podman", "unix:///podman.sock", "unix:///desktop.sock", false, false},
		{"remote name collision", "desktop-linux", "ssh://remote", "ssh://remote", true, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			desktopName := "desktop-linux"
			if tt.active == "desktop-windows" {
				desktopName = tt.active
			}
			active := EngineEndpoint{EndpointID: endpointID(EngineDocker, tt.active), Engine: EngineDocker, DisplayName: tt.active, Address: tt.address, Remote: tt.remote}
			desktop := EngineEndpoint{EndpointID: endpointID(EngineDocker, desktopName), Engine: EngineDocker, DisplayName: desktopName, Address: tt.desktopAddress, Remote: tt.remote}
			if got := dockerDesktopEndpoint(active, []EngineEndpoint{desktop}); got != tt.want {
				t.Fatalf("ownership = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestDockerDesktopUnknownHealthRejectsConfigurationRestartBeforeWriting(t *testing.T) {
	home := t.TempDir()
	path := filepath.Join(home, ".docker", "daemon.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	original := []byte("{}\n")
	if err := os.WriteFile(path, original, 0o600); err != nil {
		t.Fatal(err)
	}
	runner := &runtimeDiscoveryRunner{outputs: map[string]string{
		"docker context ls --format {{json .}}": `{"Name":"desktop-linux","Current":true,"DockerEndpoint":"unix:///desktop.sock"}`,
		"docker desktop version --format json":  `{"version":"v0.2.0"}`,
	}, errors: map[string]error{
		"docker --context desktop-linux version --format {{json .}}": ErrEngineTimeout,
		"podman system connection list --format json":                ErrCLIUnavailable,
	}}
	client := &CLIClient{Runner: runner, UserHomeDir: func() (string, error) { return home, nil }}
	id := containerServiceID(EngineDocker, ContainerServiceDockerDesktop, "local")
	configuration, err := client.ContainerServiceConfiguration(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if slices.Contains(configuration.Sources[0].ApplyModes, ContainerServiceSaveAndRestart) {
		t.Fatal("unknown health exposed restart apply mode")
	}
	req := ContainerServiceConfigurationUpdateRequest{Engine: EngineDocker, ServiceID: id, SourceID: ContainerServiceConfigurationSourceEngine, BaseRevision: configuration.Sources[0].BaseRevision, Mode: ContainerServiceConfigurationDocument, ApplyMode: ContainerServiceSaveAndRestart, Content: `{"debug":true}`}
	if err := client.ValidateContainerServiceConfiguration(context.Background(), req); !errors.Is(err, ErrContainerServiceActionUnsupported) {
		t.Fatalf("validation allowed unknown health: %v", err)
	}
	if _, err := client.UpdateContainerServiceConfiguration(context.Background(), req); !errors.Is(err, ErrContainerServiceActionUnsupported) {
		t.Fatalf("update allowed unknown health: %v", err)
	}
	current, err := os.ReadFile(path)
	if err != nil || string(current) != string(original) {
		t.Fatalf("rejected restart changed configuration: %q, %v", current, err)
	}
}

func TestContainerServicesBoundSlowEngineIndependently(t *testing.T) {
	t.Parallel()
	var podmanProbeDeadline time.Time
	runner := CommandRunnerFunc(func(ctx context.Context, name string, args ...string) ([]byte, error) {
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > containerServiceDiscoveryTimeout {
			t.Errorf("discovery command has no bounded deadline")
		}
		switch command := name + " " + strings.Join(args, " "); command {
		case "docker context ls --format {{json .}}":
			return []byte(`{"Name":"desktop-linux","Current":true,"DockerEndpoint":"unix:///desktop.sock"}`), nil
		case "docker desktop version --format json":
			return []byte(`{"version":"v0.2.0"}`), nil
		case "docker --context desktop-linux version --format {{json .}}":
			return nil, ErrDaemonStopped
		case "podman system connection list --format json":
			podmanProbeDeadline = deadline
			return []byte(`[{"Name":"remote","Default":true,"URI":"ssh://remote/podman.sock"}]`), nil
		case "podman machine list --format json":
			return []byte("[]"), nil
		case "podman --connection remote version --format {{json .}}":
			if !deadline.Equal(podmanProbeDeadline) {
				t.Error("command reset the engine discovery budget")
			}
			<-ctx.Done()
			return nil, ctx.Err()
		default:
			t.Errorf("unexpected command %s", command)
			return nil, ErrCLIUnavailable
		}
	})
	client := &CLIClient{Runner: runner, GOOS: "darwin"}
	started := time.Now()
	services, err := client.ContainerServices(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(started); elapsed > containerServiceDiscoveryTimeout+time.Second {
		t.Fatalf("slow engine exceeded budget: %v", elapsed)
	}
	if services[0].Implementation != ContainerServiceDockerDesktop || services[0].State != ContainerServiceStateStopped || !services[0].Capabilities.Start {
		t.Fatalf("slow Podman changed Desktop: %+v", services[0])
	}
	if services[1].Implementation != ContainerServiceRemote || services[1].State != ContainerServiceStateUnreachable {
		t.Fatalf("timed out Podman = %+v", services[1])
	}
}

func TestDockerDesktopMacStartUsesApplicationLaunchAndWaitsForEngine(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		var calls []string
		probes := 0
		client := &CLIClient{GOOS: "darwin", Runner: CommandRunnerFunc(func(_ context.Context, name string, args ...string) ([]byte, error) {
			command := name + " " + strings.Join(args, " ")
			calls = append(calls, command)
			switch command {
			case "docker context ls --format {{json .}}":
				return []byte(`{"Name":"desktop-linux","Current":true,"DockerEndpoint":"unix:///desktop.sock"}`), nil
			case "/usr/bin/open -g -b com.docker.docker":
				return nil, nil
			case "docker --context desktop-linux version --format {{json .}}":
				probes++
				if probes < 3 {
					return nil, ErrDaemonStopped
				}
				return []byte(`{"Server":{"Version":"29.0.1"}}`), nil
			default:
				return nil, fmt.Errorf("unexpected command: %s", command)
			}
		})}
		service := ContainerService{Engine: EngineDocker, Implementation: ContainerServiceDockerDesktop, endpointID: endpointID(EngineDocker, "desktop-linux")}
		if err := client.runContainerServiceAction(context.Background(), service, MethodContainerServicesStart); err != nil {
			t.Fatal(err)
		}
		if probes != 3 || strings.Count(strings.Join(calls, "\n"), "/usr/bin/open") != 1 {
			t.Fatalf("launch must run once and wait for engine: %v", calls)
		}
	})
}

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
		case "docker desktop version --format json":
			return []byte(`{"version":"v0.2.0"}`), nil
		case "/usr/bin/open -g -b com.docker.docker", "docker desktop stop":
			running = command == "/usr/bin/open -g -b com.docker.docker"
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
	if got := strings.Join(lifecycleCalls, ","); got != "/usr/bin/open -g -b com.docker.docker,docker desktop stop,/usr/bin/open -g -b com.docker.docker" {
		t.Fatalf("lifecycle calls = %s", got)
	}
}

func TestContainerServiceLifecycleHasDedicatedBudget(t *testing.T) {
	for _, implementation := range []ContainerServiceImplementation{ContainerServiceDockerDesktop, ContainerServiceDockerEngine, ContainerServicePodmanMachine} {
		for _, method := range []Method{MethodContainerServicesStart, MethodContainerServicesStop, MethodContainerServicesRestart} {
			t.Run(string(implementation)+"/"+string(method), func(t *testing.T) {
				var deadlines []time.Time
				client := &CLIClient{GOOS: "linux", Timeout: time.Millisecond, Runner: CommandRunnerFunc(func(ctx context.Context, _ string, _ ...string) ([]byte, error) {
					deadline, ok := ctx.Deadline()
					if !ok || time.Until(deadline) < 119*time.Second || time.Until(deadline) > 120*time.Second {
						t.Errorf("lifecycle command budget = %v, want a dedicated two-minute budget", time.Until(deadline))
					}
					deadlines = append(deadlines, deadline)
					return nil, nil
				})}
				service := ContainerService{Implementation: implementation, serviceUnit: "docker.service", machineName: "podman-default"}
				if err := client.runContainerServiceAction(context.Background(), service, method); err != nil {
					t.Fatal(err)
				}
				if len(deadlines) == 0 {
					t.Fatal("no lifecycle command executed")
				}
				for _, deadline := range deadlines[1:] {
					if !deadline.Equal(deadlines[0]) {
						t.Fatal("restart steps did not share one lifecycle deadline")
					}
				}
			})
		}
	}
}

func TestContainerServiceLifecycleHonorsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	client := &CLIClient{GOOS: "linux", Runner: CommandRunnerFunc(func(ctx context.Context, _ string, _ ...string) ([]byte, error) {
		cancel()
		<-ctx.Done()
		return nil, ctx.Err()
	})}
	err := client.runContainerServiceAction(ctx, ContainerService{Implementation: ContainerServiceDockerDesktop}, MethodContainerServicesStart)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled lifecycle = %v", err)
	}
}

func TestContainerServiceLifecycleOutlivesQueryTimeout(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		client := NewCLIClient()
		client.GOOS = "linux"
		client.Runner = CommandRunnerFunc(func(ctx context.Context, _ string, _ ...string) ([]byte, error) {
			select {
			case <-time.After(11 * time.Second):
				return nil, nil
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		})
		if err := client.runContainerServiceAction(context.Background(), ContainerService{Implementation: ContainerServiceDockerDesktop}, MethodContainerServicesStart); err != nil {
			t.Fatalf("eleven-second Desktop start must succeed: %v", err)
		}
		if _, err := client.runHostCommand(context.Background(), "docker", "desktop", "version", "--format", "json"); !errors.Is(err, ErrEngineTimeout) {
			t.Fatalf("ordinary command must retain its ten-second timeout: %v", err)
		}
	})
}

func TestContainerServiceLifecycleDeadlineRemainsBounded(t *testing.T) {
	for _, parentBudget := range []time.Duration{time.Second, 3 * time.Minute} {
		t.Run(parentBudget.String(), func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				ctx, cancel := context.WithTimeout(context.Background(), parentBudget)
				defer cancel()
				client := NewCLIClient()
				calls := 0
				client.Runner = CommandRunnerFunc(func(ctx context.Context, _ string, _ ...string) ([]byte, error) {
					calls++
					<-ctx.Done()
					return nil, ctx.Err()
				})
				start := time.Now()
				err := client.runContainerServiceAction(ctx, ContainerService{Implementation: ContainerServicePodmanMachine, machineName: "podman-default"}, MethodContainerServicesRestart)
				if (!errors.Is(err, context.DeadlineExceeded) && !errors.Is(err, ErrEngineTimeout)) || time.Since(start) != min(parentBudget, 2*time.Minute) || calls != 1 {
					t.Fatalf("deadline result: err=%v elapsed=%v calls=%d", err, time.Since(start), calls)
				}
			})
		})
	}
}

func TestDockerDesktopMacStartNeverConfusesLaunchWithReadiness(t *testing.T) {
	for _, mode := range []string{"timeout", "canceled", "permission", "launch_failed", "missing_endpoint", "restart"} {
		t.Run(mode, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				launches, stops, probes := 0, 0, 0
				client := &CLIClient{GOOS: "darwin", Runner: CommandRunnerFunc(func(_ context.Context, name string, args ...string) ([]byte, error) {
					command := name + " " + strings.Join(args, " ")
					switch command {
					case "docker context ls --format {{json .}}":
						return []byte(`{"Name":"desktop-linux","Current":true,"DockerEndpoint":"unix:///desktop.sock"}`), nil
					case "/usr/bin/open -g -b com.docker.docker":
						launches++
						if mode == "launch_failed" {
							return nil, ErrCLIUnavailable
						}
						if mode == "canceled" {
							cancel()
						}
						return nil, nil
					case "docker desktop stop":
						stops++
						return nil, nil
					case "docker --context desktop-linux version --format {{json .}}":
						probes++
						if mode == "permission" {
							return nil, ErrPermissionDenied
						}
						if mode == "restart" {
							return []byte(`{"Server":{"Version":"29.0.1"}}`), nil
						}
						return nil, ErrDaemonStopped
					default:
						t.Fatalf("unexpected command: %s", command)
						return nil, nil
					}
				})}
				service := ContainerService{Engine: EngineDocker, Implementation: ContainerServiceDockerDesktop, endpointID: endpointID(EngineDocker, "desktop-linux")}
				method := MethodContainerServicesStart
				want := error(context.DeadlineExceeded)
				switch mode {
				case "canceled":
					want = context.Canceled
				case "permission":
					want = ErrPermissionDenied
				case "launch_failed":
					want = ErrCLIUnavailable
				case "missing_endpoint":
					service.endpointID = ""
					want = ErrEndpointNotFound
				case "restart":
					method = MethodContainerServicesRestart
					want = nil
				}
				err := client.runContainerServiceAction(ctx, service, method)
				if !errors.Is(err, want) {
					t.Fatalf("result = %v, want %v", err, want)
				}
				if mode == "missing_endpoint" && launches != 0 {
					t.Fatal("launched without reviewed endpoint")
				}
				if mode == "restart" && (stops != 1 || launches != 1 || probes != 1) {
					t.Fatalf("restart calls = %d/%d/%d", stops, launches, probes)
				}
				if launches > 1 {
					t.Fatal("launch replayed")
				}
			})
		})
	}
}
