package containers

import (
	"context"
	"errors"
	"fmt"
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

func TestCLIClientStatusPropagatesCancellation(t *testing.T) {
	t.Parallel()

	client := &CLIClient{Runner: CommandRunnerFunc(func(context.Context, string, ...string) ([]byte, error) {
		return nil, context.Canceled
	})}
	status, err := client.Status(context.Background(), EngineDocker)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Status() error = %v, want context.Canceled", err)
	}
	if status.Available {
		t.Fatalf("Status() = %+v, want unavailable cancellation result", status)
	}
}

func TestCLIClientStatusPropagatesDeadline(t *testing.T) {
	t.Parallel()

	client := &CLIClient{Runner: &contextCancelRunner{}, Timeout: 5 * time.Millisecond}
	status, err := client.Status(context.Background(), EnginePodman)
	if !errors.Is(err, ErrEngineTimeout) {
		t.Fatalf("Status() error = %v, want ErrEngineTimeout", err)
	}
	if status.Available {
		t.Fatalf("Status() = %+v, want unavailable timeout result", status)
	}
}

func TestCLIClientStatusPropagatesParentDeadline(t *testing.T) {
	t.Parallel()

	client := &CLIClient{Runner: CommandRunnerFunc(func(context.Context, string, ...string) ([]byte, error) {
		return nil, context.DeadlineExceeded
	})}
	status, err := client.Status(context.Background(), EngineDocker)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Status() error = %v, want context.DeadlineExceeded", err)
	}
	if status.Available {
		t.Fatalf("Status() = %+v, want unavailable deadline result", status)
	}
}

func TestCLIClientStatusClassifiesEngineAvailabilityFailures(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		err  error
		want error
	}{
		{name: "CLI unavailable", err: ErrCLIUnavailable, want: ErrCLIUnavailable},
		{name: "backend unreachable", err: errors.New("engine command exited"), want: ErrBackendUnreachable},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			client := &CLIClient{Runner: CommandRunnerFunc(func(context.Context, string, ...string) ([]byte, error) {
				return nil, tt.err
			})}

			status, err := client.Status(context.Background(), EngineDocker)
			if !errors.Is(err, tt.want) {
				t.Fatalf("Status() error = %v, want %v", err, tt.want)
			}
			if status.Engine != EngineDocker || status.Available {
				t.Fatalf("Status() = %+v, want unavailable Docker result", status)
			}
		})
	}
}

func TestCLIClientListParsesDockerNDJSONAndPodmanArray(t *testing.T) {
	t.Parallel()

	dockerList := strings.Join([]string{
		`{"ID":"abc123","Names":"api,api_1","Image":"ghcr.io/acme/api:latest","State":"running","Status":"Up 2 minutes","Ports":"127.0.0.1:8080->80/tcp, 443/tcp","CreatedAt":"2024-01-01 00:00:00 +0000 UTC"}`,
		`{"ID":"def456","Names":"worker","Image":"ghcr.io/acme/worker:latest","State":"exited","Status":"Exited (0)","CreatedAt":"2024-01-02T00:00:00Z"}`,
	}, "\n")
	podmanList := `[
		{"Id":"pod123","Names":["pod-api"],"Image":"quay.io/acme/api:latest","State":"running","CreatedAt":"2 years ago","Created":1704067200,"Ports":[{"host_ip":"::1","container_port":8080,"host_port":18080,"range":2,"protocol":"tcp,udp"}],"ExposedPorts":{"8080":["tcp"],"9000":["sctp"]}}
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
	if dockerContainers[0].CreatedAtUnixMs != 1704067200000 || !reflect.DeepEqual(dockerContainers[0].Ports, []PortSummary{
		{Protocol: "tcp", HostIP: "127.0.0.1", HostPort: 8080, Port: 80},
		{Protocol: "tcp", Port: 443},
	}) {
		t.Fatalf("first docker container metadata = %+v", dockerContainers[0])
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
	if !reflect.DeepEqual(podmanContainers[0].Ports, []PortSummary{
		{Protocol: "tcp", HostIP: "::1", HostPort: 18080, Port: 8080},
		{Protocol: "udp", HostIP: "::1", HostPort: 18080, Port: 8080},
		{Protocol: "tcp", HostIP: "::1", HostPort: 18081, Port: 8081},
		{Protocol: "udp", HostIP: "::1", HostPort: 18081, Port: 8081},
		{Protocol: "sctp", Port: 9000},
	}) {
		t.Fatalf("podman ports = %+v", podmanContainers[0].Ports)
	}
}

func TestCLIClientListPrefersPausedDockerStatusOverRunningState(t *testing.T) {
	t.Parallel()

	runner := &fakeCommandRunner{outputs: map[string]string{
		"docker ps -a --no-trunc --format json": `{"ID":"paused123","Names":"paused-api","Image":"alpine:3.22","State":"running","Status":"Up 2 minutes (Paused)"}`,
	}}
	client := &CLIClient{Runner: runner}

	containers, err := client.List(context.Background(), EngineDocker, true)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(containers) != 1 || containers[0].State != ContainerStatePaused {
		t.Fatalf("containers = %+v, want one paused container", containers)
	}
}

func TestNormalizeContainerStatePrefersPausedFlagOverRunningFlag(t *testing.T) {
	t.Parallel()

	state := normalizeContainerState(inspectState{Running: true, Paused: true, Status: "paused"})
	if state != ContainerStatePaused {
		t.Fatalf("normalizeContainerState() = %q, want %q", state, ContainerStatePaused)
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
	if container.Image.Reference != "ghcr.io/acme/api:latest" || container.Image.Digest != testSHA256Digest {
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
			"docker pause container_123":            "container_123\n",
			"docker unpause container_123":          "container_123\n",
			"docker kill container_123":             "container_123\n",
		},
	}
	client := &CLIClient{Runner: runner}

	for _, req := range []EngineActionRequest{
		{Engine: EngineDocker, Method: MethodStart, ContainerID: "container_123"},
		{Engine: EngineDocker, Method: MethodStop, ContainerID: "container_123", TimeoutSec: 10},
		{Engine: EngineDocker, Method: MethodRestart, ContainerID: "container_123", TimeoutSec: 3},
		{Engine: EngineDocker, Method: MethodRemove, ContainerID: "container_123", Force: true},
		{Engine: EngineDocker, Method: MethodPause, ContainerID: "container_123"},
		{Engine: EngineDocker, Method: MethodUnpause, ContainerID: "container_123"},
		{Engine: EngineDocker, Method: MethodKill, ContainerID: "container_123"},
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
		"docker pause container_123",
		"docker unpause container_123",
		"docker kill container_123",
	}
	if !reflect.DeepEqual(runner.calls, wantCalls) {
		t.Fatalf("calls = %#v, want %#v", runner.calls, wantCalls)
	}
}

func TestCLIClientPullImageParsesDigest(t *testing.T) {
	t.Parallel()

	runner := &fakeCommandRunner{
		outputs: map[string]string{
			"docker pull ghcr.io/acme/api:latest": "latest: Pulling from acme/api\nDigest: " + testSHA256Digest + "\nStatus: Downloaded newer image\n",
		},
	}
	client := &CLIClient{Runner: runner}

	result, err := client.PullImage(context.Background(), EngineDocker, "ghcr.io/acme/api:latest")
	if err != nil {
		t.Fatalf("PullImage() error = %v", err)
	}
	if !result.Completed || result.Image.Reference != "ghcr.io/acme/api:latest" || result.Image.Digest != testSHA256Digest {
		t.Fatalf("pull result = %+v", result)
	}
}

func TestCLIClientV3ResourcesParseDockerAndPodmanFormats(t *testing.T) {
	t.Parallel()
	runner := &fakeCommandRunner{outputs: map[string]string{
		"docker stats --no-stream --format json container_123": `{"ID":"container_123","CPUPerc":"12.5%","MemUsage":"10.5MiB / 1GiB","NetIO":"1.5kB / 2MB"}`,
		"docker images --no-trunc --format json":               `{"ID":"sha256:one","Repository":"ghcr.io/acme/api","Tag":"latest","Digest":"sha256:digest"}`,
		"podman images --no-trunc --format json":               `[{"Id":"sha256:two","Reference":"quay.io/acme/api:stable","Digest":"sha256:pdigest"}]`,
		"docker volume ls --format json":                       `{"Name":"data","Driver":"local","Scope":"local"}`,
		"podman volume ls --format json":                       `[{"Name":"cache","Driver":"local","Scope":"local","CreatedAt":"2024-01-03T00:00:00Z"}]`,
		"docker ps -a --no-trunc --format json":                "",
		"podman ps -a --no-trunc --format json":                "",
	}}
	client := &CLIClient{Runner: runner}
	stats, err := client.Stats(context.Background(), EngineDocker, "container_123")
	if err != nil {
		t.Fatalf("Stats() error = %v", err)
	}
	if stats.ContainerID != "container_123" || stats.CPUPercent != 12.5 || stats.MemoryBytes != int64(10.5*1024*1024) || stats.MemoryLimit != 1<<30 || stats.NetworkRxBytes != 1500 || stats.NetworkTxBytes != 2_000_000 {
		t.Fatalf("stats = %+v", stats)
	}
	dockerImages, err := client.ListImages(context.Background(), EngineDocker)
	if err != nil || len(dockerImages) != 1 || dockerImages[0].ID != "sha256:one" || dockerImages[0].Reference != "ghcr.io/acme/api:latest" {
		t.Fatalf("docker images = %+v, err=%v", dockerImages, err)
	}
	podmanImages, err := client.ListImages(context.Background(), EnginePodman)
	if err != nil || len(podmanImages) != 1 || podmanImages[0].ID != "sha256:two" || podmanImages[0].Reference != "quay.io/acme/api:stable" {
		t.Fatalf("podman images = %+v, err=%v", podmanImages, err)
	}
	dockerVolumes, err := client.ListVolumes(context.Background(), EngineDocker)
	if err != nil || len(dockerVolumes) != 1 || dockerVolumes[0].Name != "data" {
		t.Fatalf("docker volumes = %+v, err=%v", dockerVolumes, err)
	}
	podmanVolumes, err := client.ListVolumes(context.Background(), EnginePodman)
	if err != nil || len(podmanVolumes) != 1 || podmanVolumes[0].Name != "cache" || podmanVolumes[0].CreatedAtUnixMs != 1704240000000 {
		t.Fatalf("podman volumes = %+v, err=%v", podmanVolumes, err)
	}
}

func TestCLIClientV3ResourceMutationsBuildSafeArgv(t *testing.T) {
	t.Parallel()
	runner := &fakeCommandRunner{outputs: map[string]string{
		"docker run -d --name api --restart always --network host --privileged -e MODE=prod ghcr.io/acme/api:latest sh -c sleep": "container_123\n",
		"docker tag ghcr.io/acme/api:latest ghcr.io/acme/api:stable":                                                             "",
		"docker image rm --force ghcr.io/acme/api:old":                                                                           "",
		"docker volume create --driver local data":                                                                               "data\n",
		"docker volume rm data": "",
	}}
	client := &CLIClient{Runner: runner}
	created, err := client.CreateContainer(context.Background(), ContainerCreateRequest{Engine: EngineDocker, Name: "api", Image: "ghcr.io/acme/api:latest", Command: []string{"sh", "-c", "sleep"}, Env: []string{"MODE=prod"}, RestartPolicy: "always", NetworkMode: "host", Privileged: true})
	if err != nil || created.ContainerID != "container_123" {
		t.Fatalf("CreateContainer() = %+v, err=%v", created, err)
	}
	if err := client.TagImage(context.Background(), ImageTagRequest{Engine: EngineDocker, Image: "ghcr.io/acme/api:latest", Tag: "ghcr.io/acme/api:stable"}); err != nil {
		t.Fatalf("TagImage() error = %v", err)
	}
	if err := client.RemoveImage(context.Background(), ImageRemoveRequest{Engine: EngineDocker, Image: "ghcr.io/acme/api:old", Force: true}); err != nil {
		t.Fatalf("RemoveImage() error = %v", err)
	}
	volume, err := client.CreateVolume(context.Background(), VolumeCreateRequest{Engine: EngineDocker, Name: "data", Driver: "local"})
	if err != nil || volume.Name != "data" {
		t.Fatalf("CreateVolume() = %+v, err=%v", volume, err)
	}
	if err := client.RemoveVolume(context.Background(), VolumeRemoveRequest{Engine: EngineDocker, Name: "data"}); err != nil {
		t.Fatalf("RemoveVolume() error = %v", err)
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
	if !errors.Is(err, ErrEngineTimeout) {
		t.Fatalf("PullImage() error = %v, want ErrEngineTimeout", err)
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

func TestExecRunnerRejectsOutputBeyondTheBoundedCommandLimit(t *testing.T) {
	t.Parallel()

	command := fmt.Sprintf("head -c %d /dev/zero", maxCommandOutputBytes+1)
	_, err := execRunner{}.Run(context.Background(), "sh", "-c", command)
	if !errors.Is(err, ErrCommandOutputLimit) {
		t.Fatalf("Run() error = %v, want ErrCommandOutputLimit", err)
	}
}

func TestCommandFailureClassificationReturnsOnlyStableDomainErrors(t *testing.T) {
	t.Parallel()

	inspect := classifyCommandFailure([]string{"inspect", "container_404"}, errors.New("exit status 1"))
	if errors.Is(inspect, ErrContainerNotFound) || inspect.Error() != "container command failed: exit status 1" {
		t.Fatalf("inspect classification = %v", inspect)
	}
	logs := classifyCommandFailure([]string{"logs", "container_1"}, errors.New("exit status 1"))
	if !errors.Is(logs, ErrLogsUnavailable) || strings.Contains(logs.Error(), "secret") {
		t.Fatalf("logs classification = %v", logs)
	}
}

func TestExecRunnerDiscardsSensitiveStderr(t *testing.T) {
	t.Parallel()

	_, err := execRunner{}.Run(
		context.Background(),
		"sh",
		"-c",
		"printf '%s' 'bearer-secret https://example.test/?token=secret /Users/private/key' >&2; exit 9",
	)
	if err == nil {
		t.Fatal("Run() error = nil")
	}
	for _, forbidden := range []string{"bearer-secret", "example.test", "token=secret", "/Users/private/key"} {
		if strings.Contains(err.Error(), forbidden) {
			t.Fatalf("Run() error contains stderr data %q: %v", forbidden, err)
		}
	}
}

func TestExecRunnerFiltersRuntimeStartupSecrets(t *testing.T) {
	t.Setenv("REDEVEN_LOCAL_UI_PASSWORD", "password-secret")
	t.Setenv("REDEVEN_BOOTSTRAP_TICKET", "ticket-secret")
	t.Setenv("REDEVEN_DESKTOP_BOOTSTRAP_TICKET", "legacy-ticket")

	const verifyCleanEnvironment = `if [ -n "${REDEVEN_LOCAL_UI_PASSWORD+x}${REDEVEN_BOOTSTRAP_TICKET+x}${REDEVEN_DESKTOP_BOOTSTRAP_TICKET+x}" ]; then exit 97; fi`
	out, err := execRunner{}.Run(context.Background(), "sh", "-c", verifyCleanEnvironment+`; printf clean`)
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if string(out) != "clean" {
		t.Fatalf("Run() output = %q, want clean", out)
	}

	var streamed []string
	err = execRunner{}.Stream(context.Background(), "sh", []string{"-c", verifyCleanEnvironment + `; printf 'clean\n'`}, func(line []byte) error {
		streamed = append(streamed, string(line))
		return nil
	})
	if err != nil {
		t.Fatalf("Stream() error = %v", err)
	}
	if !reflect.DeepEqual(streamed, []string{"clean"}) {
		t.Fatalf("Stream() lines = %#v, want clean", streamed)
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
    "RepoDigests": ["ghcr.io/acme/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"],
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
