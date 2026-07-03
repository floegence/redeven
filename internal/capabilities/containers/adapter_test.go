package containers

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestAdapterStatusResolvesFirstAvailableEngine(t *testing.T) {
	t.Parallel()

	client := &fakeEngineClient{
		status: map[Engine]EngineStatus{
			EngineDocker: {Engine: EngineDocker, Available: false},
			EnginePodman: {Engine: EnginePodman, Available: true, Version: "5.3.1"},
		},
	}
	adapter := NewAdapter(client)

	resp, err := adapter.Status(context.Background(), StatusRequest{SchemaVersion: SchemaVersion})
	if err != nil {
		t.Fatalf("Status() error = %v", err)
	}
	if resp.Engine != EnginePodman || !resp.Available || resp.EngineVersion != "5.3.1" {
		t.Fatalf("status response = %+v", resp)
	}
}

func TestAdapterStatusHonorsRequestedEngineUnavailable(t *testing.T) {
	t.Parallel()

	client := &fakeEngineClient{
		status: map[Engine]EngineStatus{
			EngineDocker: {Engine: EngineDocker, Available: false},
			EnginePodman: {Engine: EnginePodman, Available: true, Version: "5.3.1"},
		},
	}
	adapter := NewAdapter(client)

	resp, err := adapter.Status(context.Background(), StatusRequest{SchemaVersion: SchemaVersion, Engine: EngineDocker})
	if !errors.Is(err, ErrEngineUnavailable) {
		t.Fatalf("Status() error = %v, want ErrEngineUnavailable", err)
	}
	if resp.Engine != EngineDocker || resp.Available {
		t.Fatalf("status response = %+v", resp)
	}
}

func TestAdapterListAndInspectReturnMinimalDTOs(t *testing.T) {
	t.Parallel()

	client := &fakeEngineClient{
		status: map[Engine]EngineStatus{
			EngineDocker: {Engine: EngineDocker, Available: true, Version: "25.0.0"},
		},
		list: map[Engine][]EngineContainer{
			EngineDocker: {
				testEngineContainer(),
			},
		},
		inspect: map[string]EngineContainer{
			"docker:container_123": testEngineContainer(),
		},
	}
	adapter := NewAdapter(client)

	list, err := adapter.List(context.Background(), ContainerListRequest{SchemaVersion: SchemaVersion, Engine: EngineDocker, All: true})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if list.SchemaVersion != SchemaVersion || list.CapabilityID != CapabilityID || list.Engine != EngineDocker {
		t.Fatalf("list contract identity = %+v", list)
	}
	if len(list.Containers) != 1 || list.Containers[0].ContainerID != "container_123" || list.Containers[0].Image.Reference != "ghcr.io/acme/api:latest" {
		t.Fatalf("list containers = %+v", list.Containers)
	}

	inspect, err := adapter.Inspect(context.Background(), ContainerInspectRequest{
		SchemaVersion: SchemaVersion,
		Engine:        EngineDocker,
		ContainerID:   "container_123",
	})
	if err != nil {
		t.Fatalf("Inspect() error = %v", err)
	}
	if inspect.Container.Runtime.Env.SecretLikeCount != 1 || inspect.Container.Labels.SecretLikeCount != 1 {
		t.Fatalf("inspect secret summaries = env:%+v labels:%+v", inspect.Container.Runtime.Env, inspect.Container.Labels)
	}
	raw, err := json.Marshal(inspect)
	if err != nil {
		t.Fatalf("marshal inspect: %v", err)
	}
	for _, forbidden := range []string{"API_TOKEN", "raw-token", "raw-label-secret", "/Users/alice/private/secrets"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("inspect response leaked %q in %s", forbidden, raw)
		}
	}
	if !strings.Contains(string(raw), redactedSensitivePath) {
		t.Fatalf("inspect response missing redacted sensitive path marker: %s", raw)
	}
}

func TestAdapterStartPreflightUsesInspectedRuntime(t *testing.T) {
	t.Parallel()

	client := &fakeEngineClient{
		inspect: map[string]EngineContainer{
			"docker:container_123": testEngineContainer(),
		},
	}
	adapter := NewAdapter(client)

	plan, err := adapter.StartPreflight(context.Background(), ContainerStartRequest{
		SchemaVersion: SchemaVersion,
		Engine:        EngineDocker,
		ContainerID:   "container_123",
	})
	if err != nil {
		t.Fatalf("StartPreflight() error = %v", err)
	}
	if plan.Target.ContainerID != "container_123" || plan.Target.ContainerName != "api" {
		t.Fatalf("target = %+v", plan.Target)
	}
	if plan.RiskLevel != RiskLevelCritical || !plan.RequiresAdmin {
		t.Fatalf("risk = %s admin=%v", plan.RiskLevel, plan.RequiresAdmin)
	}
	assertRiskIDs(t, plan.RiskFlags, []string{
		"container_privileged",
		"container_socket_mount",
		"host_bind_mount",
		"host_network",
		"image_not_digest_pinned",
		"secret_environment",
		"secret_labels",
		"sensitive_mount_path",
	})
}

type fakeEngineClient struct {
	status  map[Engine]EngineStatus
	list    map[Engine][]EngineContainer
	inspect map[string]EngineContainer
}

func (f *fakeEngineClient) Status(_ context.Context, engine Engine) (EngineStatus, error) {
	if status, ok := f.status[engine]; ok {
		return status, nil
	}
	return EngineStatus{Engine: engine}, nil
}

func (f *fakeEngineClient) List(_ context.Context, engine Engine, _ bool) ([]EngineContainer, error) {
	return append([]EngineContainer(nil), f.list[engine]...), nil
}

func (f *fakeEngineClient) Inspect(_ context.Context, engine Engine, containerID string) (EngineContainer, error) {
	container, ok := f.inspect[string(engine)+":"+containerID]
	if !ok {
		return EngineContainer{}, errors.New("not found")
	}
	return container, nil
}

func testEngineContainer() EngineContainer {
	return EngineContainer{
		Engine:          EngineDocker,
		ContainerID:     "container_123",
		Name:            "api",
		Image:           ImageInput{Reference: "ghcr.io/acme/api:latest"},
		State:           ContainerStateRunning,
		CreatedAtUnixMs: 1704067200000,
		Runtime: RuntimeInput{
			Privileged:  true,
			NetworkMode: "host",
			Env: []string{
				"API_TOKEN=raw-token",
				"PATH=/usr/bin",
			},
			Labels: map[string]string{
				"redeven.secret": "raw-label-secret",
				"owner":          "containers",
			},
			Mounts: []MountInput{
				{Type: MountTypeBind, Source: "/var/run/docker.sock", Target: "/var/run/docker.sock"},
				{Type: MountTypeBind, Source: "/Users/alice/private/secrets", Target: "/run/secrets/password"},
			},
		},
		Ports: []PortSummary{{Protocol: "tcp", HostIP: "127.0.0.1", HostPort: 8080, Port: 80}},
	}
}
