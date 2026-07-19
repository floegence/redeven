package containers

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestAdapterStatusResolvesFirstAvailableEngine(t *testing.T) {
	client := &fakeEngineClient{status: map[Engine]EngineStatus{
		EngineDocker: {Engine: EngineDocker, Available: false},
		EnginePodman: {Engine: EnginePodman, Available: true, Version: "5.3.1"},
	}}
	response, err := NewAdapter(client).Status(context.Background(), StatusRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if response.Engine != EnginePodman || !response.Available || response.EngineVersion != "5.3.1" {
		t.Fatalf("status response = %+v", response)
	}
}

func TestAdapterStatusHonorsRequestedUnavailableEngine(t *testing.T) {
	client := &fakeEngineClient{status: map[Engine]EngineStatus{
		EngineDocker: {Engine: EngineDocker, Available: false},
	}}
	response, err := NewAdapter(client).Status(context.Background(), StatusRequest{Engine: EngineDocker})
	if !errors.Is(err, ErrEngineUnavailable) || response.Engine != EngineDocker || response.Available {
		t.Fatalf("status response = %+v, err=%v", response, err)
	}
}

func TestAdapterListAndInspectReturnRedactedDomainDTOs(t *testing.T) {
	container := testEngineContainer()
	client := &fakeEngineClient{
		status:  map[Engine]EngineStatus{EngineDocker: {Engine: EngineDocker, Available: true}},
		list:    map[Engine][]EngineContainer{EngineDocker: {container}},
		inspect: map[string]EngineContainer{"docker:container_123": container},
	}
	adapter := NewAdapter(client)
	list, err := adapter.List(context.Background(), ContainerListRequest{Engine: EngineDocker, All: true})
	if err != nil {
		t.Fatal(err)
	}
	if list.Engine != EngineDocker || len(list.Containers) != 1 || list.Containers[0].ContainerID != "container_123" {
		t.Fatalf("list response = %+v", list)
	}
	inspect, err := adapter.Inspect(context.Background(), ContainerInspectRequest{Engine: EngineDocker, ContainerID: "container_123"})
	if err != nil {
		t.Fatal(err)
	}
	if inspect.Container.Runtime.Env.SecretLikeCount != 1 || inspect.Container.Labels.SecretLikeCount != 1 {
		t.Fatalf("inspect summaries = %+v", inspect.Container)
	}
	raw, err := json.Marshal(inspect)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"API_TOKEN", "raw-token", "raw-label-secret", "/Users/alice/private/secrets"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("inspect response leaked %q: %s", forbidden, raw)
		}
	}
}

func TestAdapterStartPreflightUsesInspectedRuntime(t *testing.T) {
	client := &fakeEngineClient{inspect: map[string]EngineContainer{"docker:container_123": testEngineContainer()}}
	plan, err := NewAdapter(client).StartPreflight(context.Background(), ContainerStartRequest{
		Engine: EngineDocker, ContainerID: "container_123",
	})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Target.ContainerID != "container_123" || plan.RiskLevel != RiskLevelCritical || !plan.RequiresAdmin {
		t.Fatalf("preflight plan = %+v", plan)
	}
	assertRiskIDs(t, plan.RiskFlags, []string{
		"container_privileged", "container_socket_mount", "host_bind_mount", "host_network",
		"image_not_digest_pinned", "secret_environment", "secret_labels", "sensitive_mount_path",
	})
}

func TestAdapterActionsLogsAndPullUseBusinessClient(t *testing.T) {
	client := &fakeEngineClient{
		actions: map[string]EngineActionResult{
			"docker:containers.stop:container_123": {Engine: EngineDocker, Method: MethodStop, ContainerID: "container_123", Completed: true},
		},
		logs: map[string]EngineLogsResult{
			"docker:container_123": {Engine: EngineDocker, ContainerID: "container_123", Lines: []LogLine{{TimestampUnixMs: 1704067200000, Message: "ready"}}},
		},
		pulls: map[string]EngineImageResult{
			"docker:ghcr.io/acme/api:latest": {Engine: EngineDocker, Image: ImageInput{Reference: "ghcr.io/acme/api:latest", Digest: "sha256:feedface"}, Completed: true},
		},
	}
	adapter := NewAdapter(client)
	action, err := adapter.Stop(context.Background(), ContainerActionRequest{Engine: EngineDocker, ContainerID: "container_123", TimeoutSec: 10})
	if err != nil || action.Method != MethodStop || !action.Completed {
		t.Fatalf("stop response = %+v, err=%v", action, err)
	}
	logs, err := adapter.TailLogs(context.Background(), LogsTailRequest{Engine: EngineDocker, ContainerID: "container_123", TailLines: 50})
	if err != nil || len(logs.Lines) != 1 || logs.Lines[0].Message != "ready" {
		t.Fatalf("logs response = %+v, err=%v", logs, err)
	}
	pull, err := adapter.PullImage(context.Background(), ImagePullRequest{Engine: EngineDocker, ImageRef: "ghcr.io/acme/api:latest"})
	if err != nil || !pull.Completed || !pull.Image.DigestPinned {
		t.Fatalf("pull response = %+v, err=%v", pull, err)
	}
}

func TestAdapterFollowLogsStreamsThroughFollowerClient(t *testing.T) {
	client := &fakeFollowingEngineClient{fakeEngineClient: fakeEngineClient{}}
	var lines []LogLine
	err := NewAdapter(client).FollowLogs(context.Background(), LogsTailRequest{
		Engine: EngineDocker, ContainerID: "container_123", TailLines: 20, Follow: true,
	}, LogLineSinkFunc(func(_ context.Context, line LogLine) error {
		lines = append(lines, line)
		return nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 2 || lines[0].Message != "first" || lines[1].Message != "second" {
		t.Fatalf("streamed lines = %+v", lines)
	}
}

func TestAdapterFollowLogsRequiresStreamingClient(t *testing.T) {
	err := NewAdapter(&fakeEngineClient{}).FollowLogs(context.Background(), LogsTailRequest{
		Engine: EngineDocker, ContainerID: "container_123", Follow: true,
	}, LogLineSinkFunc(func(context.Context, LogLine) error { return nil }))
	if !errors.Is(err, ErrLogsFollowUnsupported) {
		t.Fatalf("FollowLogs() error = %v", err)
	}
}

func TestAdapterBusinessOperationsRespectContextCancellation(t *testing.T) {
	started := make(chan struct{})
	client := &fakeEngineClient{
		action: func(ctx context.Context, req EngineActionRequest) (EngineActionResult, error) {
			close(started)
			<-ctx.Done()
			return EngineActionResult{}, ctx.Err()
		},
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := NewAdapter(client).Remove(ctx, ContainerActionRequest{Engine: EngineDocker, ContainerID: "container_123", Force: true})
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("business operation did not start")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("Remove() error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("business operation did not observe cancellation")
	}
}

type fakeEngineClient struct {
	status  map[Engine]EngineStatus
	list    map[Engine][]EngineContainer
	inspect map[string]EngineContainer
	actions map[string]EngineActionResult
	logs    map[string]EngineLogsResult
	pulls   map[string]EngineImageResult
	action  func(context.Context, EngineActionRequest) (EngineActionResult, error)
}

func (c *fakeEngineClient) Status(_ context.Context, engine Engine) (EngineStatus, error) {
	if value, ok := c.status[engine]; ok {
		return value, nil
	}
	return EngineStatus{Engine: engine, Available: false}, nil
}

func (c *fakeEngineClient) List(_ context.Context, engine Engine, _ bool) ([]EngineContainer, error) {
	return append([]EngineContainer(nil), c.list[engine]...), nil
}

func (c *fakeEngineClient) Inspect(_ context.Context, engine Engine, containerID string) (EngineContainer, error) {
	value, ok := c.inspect[string(engine)+":"+containerID]
	if !ok {
		return EngineContainer{}, errors.New("container not found")
	}
	return value, nil
}

func (c *fakeEngineClient) Action(ctx context.Context, req EngineActionRequest) (EngineActionResult, error) {
	if c.action != nil {
		return c.action(ctx, req)
	}
	value, ok := c.actions[string(req.Engine)+":"+string(req.Method)+":"+req.ContainerID]
	if !ok {
		return EngineActionResult{}, errors.New("container action not configured")
	}
	return value, nil
}

func (c *fakeEngineClient) TailLogs(_ context.Context, req EngineLogsRequest) (EngineLogsResult, error) {
	value, ok := c.logs[string(req.Engine)+":"+req.ContainerID]
	if !ok {
		return EngineLogsResult{}, errors.New("container logs not configured")
	}
	return value, nil
}

func (c *fakeEngineClient) PullImage(_ context.Context, engine Engine, imageRef string) (EngineImageResult, error) {
	value, ok := c.pulls[string(engine)+":"+imageRef]
	if !ok {
		return EngineImageResult{}, errors.New("image pull not configured")
	}
	return value, nil
}

type fakeFollowingEngineClient struct {
	fakeEngineClient
}

func (c *fakeFollowingEngineClient) FollowLogs(ctx context.Context, _ EngineLogsRequest, sink LogLineSink) error {
	for _, line := range []LogLine{{Message: "first"}, {Message: "second"}} {
		if err := sink.AppendLogLine(ctx, line); err != nil {
			return err
		}
	}
	return nil
}

func testEngineContainer() EngineContainer {
	return EngineContainer{
		Engine: EngineDocker, ContainerID: "container_123", Name: "api",
		Image: ImageInput{Reference: "ghcr.io/acme/api:latest"}, State: ContainerStateRunning,
		CreatedAtUnixMs: 1704067200000,
		Runtime: RuntimeInput{
			Privileged: true, NetworkMode: "host", Env: []string{"MODE=prod", "API_TOKEN=raw-token"},
			Labels: map[string]string{"service": "api", "auth_secret": "raw-label-secret"},
			Mounts: []MountInput{
				{Type: MountTypeBind, Source: "/Users/alice/private/secrets", Target: "/run/secrets", ReadOnly: true},
				{Type: MountTypeBind, Source: "/var/run/docker.sock", Target: "/var/run/docker.sock"},
			},
		},
		Ports: []PortSummary{{Protocol: "tcp", HostPort: 8080, Port: 80}},
	}
}

func assertRiskIDs(t *testing.T, risks []RiskFlag, expected []string) {
	t.Helper()
	seen := make(map[string]bool, len(risks))
	for _, risk := range risks {
		seen[risk.ID] = true
	}
	for _, id := range expected {
		if !seen[id] {
			t.Fatalf("missing risk %q in %+v", id, risks)
		}
	}
}
