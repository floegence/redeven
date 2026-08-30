package containerengine

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestContainerExecProgramUsesExactDockerContextAndArgv(t *testing.T) {
	t.Parallel()
	runner := &fakeCommandRunner{outputs: map[string]string{
		"docker context ls --format {{json .}}":                `{"Name":"desktop-linux","Current":true}`,
		"docker --context desktop-linux inspect container_123": `[{"Id":"container_123","Name":"/api","State":{"Status":"running","Running":true},"Config":{"Image":"alpine:3.22"}}]`,
	}}
	client := &CLIClient{Runner: runner}
	adapter, err := NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	endpoints, err := client.ListEndpoints(context.Background(), EngineDocker)
	if err != nil {
		t.Fatal(err)
	}
	bound, _, err := adapter.BindEndpoint(context.Background(), EngineDocker, endpoints[0].EndpointID)
	if err != nil {
		t.Fatal(err)
	}
	program, err := adapter.ContainerExecProgram(bound, ContainerExecRequest{
		Engine: EngineDocker, ContainerID: "container_123", Argv: []string{"/bin/sh", "-c", "printf '%s' '$HOME'"},
	})
	if err != nil {
		t.Fatalf("ContainerExecProgram() error = %v", err)
	}
	want := ProgramSpec{
		Executable: "docker",
		Args:       []string{"--context", "desktop-linux", "exec", "--interactive", "--tty", "container_123", "/bin/sh", "-c", "printf '%s' '$HOME'"},
	}
	if !reflect.DeepEqual(program, want) {
		t.Fatalf("program = %#v, want %#v", program, want)
	}
}

func TestContainerExecProgramUsesExactPodmanConnection(t *testing.T) {
	t.Parallel()
	runner := &fakeCommandRunner{outputs: map[string]string{
		"podman system connection list --format json":       `[{"Name":"machine","Default":true}]`,
		"podman --connection machine inspect container_123": `[{"Id":"container_123","Name":"api","State":{"Status":"running","Running":true},"ImageName":"alpine:3.22"}]`,
	}}
	client := &CLIClient{Runner: runner}
	adapter, err := NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	endpoints, err := client.ListEndpoints(context.Background(), EnginePodman)
	if err != nil {
		t.Fatal(err)
	}
	bound, _, err := adapter.BindEndpoint(context.Background(), EnginePodman, endpoints[len(endpoints)-1].EndpointID)
	if err != nil {
		t.Fatal(err)
	}
	program, err := adapter.ContainerExecProgram(bound, ContainerExecRequest{Engine: EnginePodman, ContainerID: "container_123"})
	if err != nil {
		t.Fatalf("ContainerExecProgram() error = %v", err)
	}
	want := ProgramSpec{Executable: "podman", Args: []string{"--connection", "machine", "exec", "--interactive", "--tty", "container_123", "/bin/sh"}}
	if !reflect.DeepEqual(program, want) {
		t.Fatalf("program = %#v, want %#v", program, want)
	}
}

func TestContainerExecProgramRejectsStoppedContainer(t *testing.T) {
	t.Parallel()
	client := &fakeEngineClient{inspect: map[string]EngineContainer{
		"docker:container_123": {Engine: EngineDocker, ContainerID: "container_123", State: ContainerStateExited},
	}}
	adapter, err := NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	_, err = adapter.ContainerExecProgram(context.Background(), ContainerExecRequest{Engine: EngineDocker, ContainerID: "container_123"})
	if !errors.Is(err, ErrContainerNotRunning) {
		t.Fatalf("ContainerExecProgram() error = %v, want ErrContainerNotRunning", err)
	}
}

func TestNormalizeContainerExecArgvRejectsUnsafeOrOversizedInput(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		argv []string
	}{
		{name: "missing executable", argv: []string{" "}},
		{name: "control character", argv: []string{"/bin/sh", "line\nbreak"}},
		{name: "too many items", argv: make([]string, maxContainerExecArgvItems+1)},
		{name: "too many bytes", argv: []string{"/bin/sh", strings.Repeat("a", maxContainerExecArgvBytes)}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if _, err := normalizeContainerExecArgv(tt.argv); err == nil {
				t.Fatal("normalizeContainerExecArgv() error = nil")
			}
		})
	}
}
