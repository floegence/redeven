package containerengine

import (
	"context"
	"errors"
	"strings"
)

const (
	maxContainerExecArgvItems = 32
	maxContainerExecArgvBytes = 8 * 1024
)

type ContainerExecRequest struct {
	Engine      Engine     `json:"engine"`
	EndpointID  EndpointID `json:"endpoint_id"`
	ContainerID string     `json:"-"`
	Argv        []string   `json:"argv,omitempty"`
}

// ProgramSpec is an exact executable and argv pair. Callers must pass it to a
// program-backed PTY without shell parsing or interpolation.
type ProgramSpec struct {
	Executable string
	Args       []string
}

type containerExecProgramClient interface {
	ContainerExecProgram(context.Context, ContainerExecRequest) (ProgramSpec, error)
}

func (a *Adapter) ContainerExecProgram(ctx context.Context, req ContainerExecRequest) (ProgramSpec, error) {
	if err := validateEngine(req.Engine); err != nil {
		return ProgramSpec{}, err
	}
	containerID := strings.TrimSpace(req.ContainerID)
	if err := validateContainerIdentifier(containerID); err != nil {
		return ProgramSpec{}, err
	}
	argv, err := normalizeContainerExecArgv(req.Argv)
	if err != nil {
		return ProgramSpec{}, err
	}
	container, err := a.client.Inspect(ctx, req.Engine, containerID)
	if err != nil {
		return ProgramSpec{}, normalizeContainerResourceError(containerID, err)
	}
	if container.State != ContainerStateRunning {
		return ProgramSpec{}, &ContainerNotRunningError{ContainerID: containerID}
	}
	client, ok := a.client.(containerExecProgramClient)
	if !ok || interfaceIsNil(client) {
		return ProgramSpec{}, ErrResourceCapabilityUnsupported
	}
	req.ContainerID = containerID
	req.Argv = argv
	return client.ContainerExecProgram(ctx, req)
}

func normalizeContainerExecArgv(input []string) ([]string, error) {
	if len(input) == 0 {
		return []string{"/bin/sh"}, nil
	}
	if len(input) > maxContainerExecArgvItems {
		return nil, errors.New("exec argv exceeds the item limit")
	}
	argv := make([]string, len(input))
	total := 0
	for index, value := range input {
		if index == 0 && strings.TrimSpace(value) == "" {
			return nil, errors.New("exec executable is required")
		}
		if hasControl(value) {
			return nil, errors.New("exec argv contains control characters")
		}
		total += len(value)
		if total > maxContainerExecArgvBytes {
			return nil, errors.New("exec argv exceeds the byte limit")
		}
		argv[index] = value
	}
	return argv, nil
}
