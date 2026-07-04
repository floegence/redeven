package containers

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestCLIClientStatusParsesNestedEngineVersion(t *testing.T) {
	t.Parallel()

	runner := &fakeCommandRunner{
		outputs: map[string]string{
			"docker version --format {{json .}}": `{"Client":{"Version":"25.0.0"},"Server":{"Version":"25.0.3"}}`,
		},
	}
	client := &CLIClient{Runner: runner}

	status, err := client.Status(context.Background(), EngineDocker)
	if err != nil {
		t.Fatalf("Status() error = %v", err)
	}
	if !status.Available || status.Version != "25.0.3" {
		t.Fatalf("status = %+v", status)
	}
}

func TestCLIClientListParsesDockerNDJSONAndPodmanArray(t *testing.T) {
	t.Parallel()

	dockerList := strings.Join([]string{
		`{"ID":"abc123","Names":"api,api_1","Image":"ghcr.io/acme/api:latest","State":"running","Status":"Up 2 minutes","CreatedAt":"2024-01-01T00:00:00Z"}`,
		`{"ID":"def456","Names":"worker","Image":"ghcr.io/acme/worker:latest","State":"exited","Status":"Exited (0)","CreatedAt":"2024-01-02T00:00:00Z"}`,
	}, "\n")
	podmanList := `[
		{"Id":"pod123","Names":["pod-api"],"Image":"quay.io/acme/api:latest","State":"running","Created":1704067200}
	]`
	runner := &fakeCommandRunner{
		outputs: map[string]string{
			"docker ps -a --no-trunc --format json": dockerList,
			"podman ps -a --no-trunc --format json": podmanList,
		},
	}
	client := &CLIClient{Runner: runner}

	dockerContainers, err := client.List(context.Background(), EngineDocker, true)
	if err != nil {
		t.Fatalf("docker List() error = %v", err)
	}
	if len(dockerContainers) != 2 {
		t.Fatalf("docker containers = %+v", dockerContainers)
	}
	if dockerContainers[0].ContainerID != "abc123" || dockerContainers[0].Name != "api" || dockerContainers[0].State != ContainerStateRunning {
		t.Fatalf("first docker container = %+v", dockerContainers[0])
	}
	if dockerContainers[1].State != ContainerStateExited {
		t.Fatalf("second docker state = %q", dockerContainers[1].State)
	}

	podmanContainers, err := client.List(context.Background(), EnginePodman, true)
	if err != nil {
		t.Fatalf("podman List() error = %v", err)
	}
	if len(podmanContainers) != 1 || podmanContainers[0].Name != "pod-api" || podmanContainers[0].CreatedAtUnixMs != 1704067200000 {
		t.Fatalf("podman containers = %+v", podmanContainers)
	}
}

func TestCLIClientInspectParsesRuntimeInputs(t *testing.T) {
	t.Parallel()

	runner := &fakeCommandRunner{
		outputs: map[string]string{
			"docker inspect container_123": dockerInspectFixture,
		},
	}
	client := &CLIClient{Runner: runner}

	container, err := client.Inspect(context.Background(), EngineDocker, "container_123")
	if err != nil {
		t.Fatalf("Inspect() error = %v", err)
	}
	if container.ContainerID != "container_123" || container.Name != "api" || container.State != ContainerStateRunning {
		t.Fatalf("container identity = %+v", container)
	}
	if container.Image.Reference != "ghcr.io/acme/api:latest" || container.Image.Digest != "sha256:feedface" {
		t.Fatalf("image = %+v", container.Image)
	}
	if !container.Runtime.Privileged || container.Runtime.NetworkMode != "host" || container.Runtime.RestartPolicy != "always" {
		t.Fatalf("runtime = %+v", container.Runtime)
	}
	if !reflect.DeepEqual(container.Runtime.CapAdd, []string{"SYS_ADMIN"}) {
		t.Fatalf("cap_add = %#v", container.Runtime.CapAdd)
	}
	if len(container.Runtime.Mounts) != 2 || container.Runtime.Mounts[0].Type != MountTypeBind {
		t.Fatalf("mounts = %+v", container.Runtime.Mounts)
	}
	if len(container.Ports) != 1 || container.Ports[0].HostPort != 8080 || container.Ports[0].Port != 80 {
		t.Fatalf("ports = %+v", container.Ports)
	}
}

func TestCLIClientActionsBuildSafeArgv(t *testing.T) {
	t.Parallel()

	runner := &fakeCommandRunner{
		outputs: map[string]string{
			"docker start container_123":            "container_123\n",
			"docker stop --time 10 container_123":   "container_123\n",
			"docker restart --time 3 container_123": "container_123\n",
			"docker rm --force container_123":       "container_123\n",
		},
	}
	client := &CLIClient{Runner: runner}

	for _, req := range []EngineActionRequest{
		{Engine: EngineDocker, Method: MethodStart, ContainerID: "container_123"},
		{Engine: EngineDocker, Method: MethodStop, ContainerID: "container_123", TimeoutSec: 10},
		{Engine: EngineDocker, Method: MethodRestart, ContainerID: "container_123", TimeoutSec: 3},
		{Engine: EngineDocker, Method: MethodRemove, ContainerID: "container_123", Force: true},
	} {
		result, err := client.Action(context.Background(), req)
		if err != nil {
			t.Fatalf("Action(%s) error = %v", req.Method, err)
		}
		if !result.Completed || result.Method != req.Method || result.ContainerID != "container_123" {
			t.Fatalf("Action(%s) = %+v", req.Method, result)
		}
	}
	wantCalls := []string{
		"docker start container_123",
		"docker stop --time 10 container_123",
		"docker restart --time 3 container_123",
		"docker rm --force container_123",
	}
	if !reflect.DeepEqual(runner.calls, wantCalls) {
		t.Fatalf("calls = %#v, want %#v", runner.calls, wantCalls)
	}
}

func TestCLIClientPullImageParsesDigest(t *testing.T) {
	t.Parallel()

	runner := &fakeCommandRunner{
		outputs: map[string]string{
			"docker pull ghcr.io/acme/api:latest": "latest: Pulling from acme/api\nDigest: sha256:feedface\nStatus: Downloaded newer image\n",
		},
	}
	client := &CLIClient{Runner: runner}

	result, err := client.PullImage(context.Background(), EngineDocker, "ghcr.io/acme/api:latest")
	if err != nil {
		t.Fatalf("PullImage() error = %v", err)
	}
	if !result.Completed || result.Image.Reference != "ghcr.io/acme/api:latest" || result.Image.Digest != "sha256:feedface" {
		t.Fatalf("pull result = %+v", result)
	}
}

func TestCLIClientPullImagePropagatesContextCancellation(t *testing.T) {
	t.Parallel()

	runner := &contextCancelRunner{}
	client := &CLIClient{Runner: runner}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := client.PullImage(ctx, EngineDocker, "ghcr.io/acme/api:latest")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("PullImage() error = %v, want context.Canceled", err)
	}
	if runner.call != "docker pull ghcr.io/acme/api:latest" {
		t.Fatalf("runner call = %q", runner.call)
	}
}

func TestCLIClientPullImageTimeoutCancelsRunner(t *testing.T) {
	t.Parallel()

	runner := &contextCancelRunner{}
	client := &CLIClient{Runner: runner, Timeout: 5 * time.Millisecond}

	started := time.Now()
	_, err := client.PullImage(context.Background(), EngineDocker, "ghcr.io/acme/api:latest")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("PullImage() error = %v, want context.DeadlineExceeded", err)
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("PullImage() timeout took %s", elapsed)
	}
	if runner.call != "docker pull ghcr.io/acme/api:latest" {
		t.Fatalf("runner call = %q", runner.call)
	}
}

func TestExecRunnerReturnsContextErrorAfterCommandCancellation(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Millisecond)
	defer cancel()

	started := time.Now()
	_, err := execRunner{}.Run(ctx, "sh", "-c", "sleep 5")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Run() error = %v, want context.DeadlineExceeded", err)
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("Run() cancellation took %s", elapsed)
	}
}

func TestCLIClientTailLogsParsesBoundedBatch(t *testing.T) {
	t.Parallel()

	runner := &fakeCommandRunner{
		outputs: map[string]string{
			"docker logs --timestamps --tail 2 --since 2024-01-01T00:00:00Z container_123": strings.Join([]string{
				"2024-01-01T00:00:01Z ready",
				"plain line",
			}, "\n"),
		},
	}
	client := &CLIClient{Runner: runner}

	result, err := client.TailLogs(context.Background(), EngineLogsRequest{
		Engine:      EngineDocker,
		ContainerID: "container_123",
		TailLines:   2,
		SinceUnixMs: 1704067200000,
	})
	if err != nil {
		t.Fatalf("TailLogs() error = %v", err)
	}
	if len(result.Lines) != 2 {
		t.Fatalf("lines = %+v", result.Lines)
	}
	if result.Lines[0].TimestampUnixMs != 1704067201000 || result.Lines[0].Message != "ready" {
		t.Fatalf("first line = %+v", result.Lines[0])
	}
	if result.Lines[1].TimestampUnixMs != 0 || result.Lines[1].Message != "plain line" {
		t.Fatalf("second line = %+v", result.Lines[1])
	}
}

func TestCLIClientTailLogsRejectsFollowWithoutStreamAdapter(t *testing.T) {
	t.Parallel()

	client := &CLIClient{Runner: &fakeCommandRunner{}}
	_, err := client.TailLogs(context.Background(), EngineLogsRequest{
		Engine:      EngineDocker,
		ContainerID: "container_123",
		Follow:      true,
	})
	if !errors.Is(err, ErrLogsFollowUnsupported) {
		t.Fatalf("TailLogs() error = %v, want ErrLogsFollowUnsupported", err)
	}
}

func TestCLIClientFollowLogsStreamsTimestampedLines(t *testing.T) {
	t.Parallel()

	runner := &fakeCommandRunner{
		streams: map[string][]string{
			"docker logs --follow --timestamps --tail 2 --since 2024-01-01T00:00:00Z container_123": {
				"2024-01-01T00:00:01Z ready",
				"plain line",
			},
		},
	}
	client := &CLIClient{Runner: runner}
	lines := make(chan LogLine, 2)

	err := client.FollowLogs(context.Background(), EngineLogsRequest{
		Engine:      EngineDocker,
		ContainerID: "container_123",
		TailLines:   2,
		SinceUnixMs: 1704067200000,
		Follow:      true,
	}, NewLogLineChannelSink(lines))
	if err != nil {
		t.Fatalf("FollowLogs() error = %v", err)
	}
	if len(lines) != 2 {
		t.Fatalf("streamed lines = %d", len(lines))
	}
	first := <-lines
	second := <-lines
	if first.TimestampUnixMs != 1704067201000 || first.Message != "ready" {
		t.Fatalf("first line = %+v", first)
	}
	if second.TimestampUnixMs != 0 || second.Message != "plain line" {
		t.Fatalf("second line = %+v", second)
	}
	wantCalls := []string{"docker logs --follow --timestamps --tail 2 --since 2024-01-01T00:00:00Z container_123"}
	if !reflect.DeepEqual(runner.calls, wantCalls) {
		t.Fatalf("calls = %#v, want %#v", runner.calls, wantCalls)
	}
}

func TestCLIClientFollowLogsStopsOnSinkBackpressure(t *testing.T) {
	t.Parallel()

	runner := &fakeCommandRunner{
		streams: map[string][]string{
			"docker logs --follow --timestamps --tail 100 container_123": {
				"2024-01-01T00:00:01Z ready",
				"2024-01-01T00:00:02Z still-running",
			},
		},
	}
	client := &CLIClient{Runner: runner}
	err := client.FollowLogs(context.Background(), EngineLogsRequest{
		Engine:      EngineDocker,
		ContainerID: "container_123",
		Follow:      true,
	}, NewLogLineChannelSink(make(chan LogLine)))
	if !errors.Is(err, ErrLogStreamBackpressure) {
		t.Fatalf("FollowLogs() error = %v, want ErrLogStreamBackpressure", err)
	}
	if !reflect.DeepEqual(runner.streamed, []string{"2024-01-01T00:00:01Z ready"}) {
		t.Fatalf("streamed lines before backpressure = %#v", runner.streamed)
	}
}

type fakeCommandRunner struct {
	outputs  map[string]string
	streams  map[string][]string
	calls    []string
	streamed []string
}

func (f *fakeCommandRunner) Run(_ context.Context, name string, args ...string) ([]byte, error) {
	key := strings.TrimSpace(name + " " + strings.Join(args, " "))
	f.calls = append(f.calls, key)
	out, ok := f.outputs[key]
	if !ok {
		return nil, errFakeCommandNotFound(key)
	}
	return []byte(out), nil
}

func (f *fakeCommandRunner) Stream(_ context.Context, name string, args []string, onStdoutLine func([]byte) error) error {
	key := strings.TrimSpace(name + " " + strings.Join(args, " "))
	f.calls = append(f.calls, key)
	lines, ok := f.streams[key]
	if !ok {
		return errFakeCommandNotFound(key)
	}
	for _, line := range lines {
		f.streamed = append(f.streamed, line)
		if err := onStdoutLine([]byte(line)); err != nil {
			return err
		}
	}
	return nil
}

type errFakeCommandNotFound string

func (e errFakeCommandNotFound) Error() string {
	return "unexpected command: " + string(e)
}

type contextCancelRunner struct {
	call string
}

func (r *contextCancelRunner) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	r.call = strings.TrimSpace(name + " " + strings.Join(args, " "))
	<-ctx.Done()
	return nil, ctx.Err()
}

const dockerInspectFixture = `[
  {
    "Id": "container_123",
    "Name": "/api",
    "Created": "2024-01-01T00:00:00Z",
    "RepoDigests": ["ghcr.io/acme/api@sha256:feedface"],
    "Config": {
      "Image": "ghcr.io/acme/api:latest",
      "Env": ["API_TOKEN=raw-token", "PATH=/usr/bin"],
      "Labels": {"redeven.secret": "raw-label-secret", "owner": "containers"}
    },
    "State": {
      "Status": "running",
      "Running": true
    },
    "HostConfig": {
      "Privileged": true,
      "NetworkMode": "host",
      "PidMode": "host",
      "IpcMode": "host",
      "RestartPolicy": {"Name": "always"},
      "CapAdd": ["SYS_ADMIN"],
      "CapDrop": ["NET_RAW"],
      "Devices": [
        {"PathOnHost": "/dev/kvm", "PathInContainer": "/dev/kvm", "CgroupPermissions": "rwm"}
      ]
    },
    "Mounts": [
      {"Type": "bind", "Source": "/var/run/docker.sock", "Destination": "/var/run/docker.sock", "RW": true},
      {"Type": "bind", "Source": "/Users/alice/private/secrets", "Destination": "/run/secrets/password", "RW": false}
    ],
    "NetworkSettings": {
      "Ports": {
        "80/tcp": [{"HostIp": "127.0.0.1", "HostPort": "8080"}]
      }
    }
  }
]`
