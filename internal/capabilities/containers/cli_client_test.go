package containers

import (
	"context"
	"reflect"
	"strings"
	"testing"
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

type fakeCommandRunner struct {
	outputs map[string]string
	calls   []string
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

type errFakeCommandNotFound string

func (e errFakeCommandNotFound) Error() string {
	return "unexpected command: " + string(e)
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
