package containers

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

var (
	ErrEngineUnavailable = errors.New("container engine is unavailable")
	ErrInvalidEngine     = errors.New("container engine is invalid")
)

type EngineStatus struct {
	Engine    Engine
	Available bool
	Version   string
}

type EngineContainer struct {
	Engine          Engine
	ContainerID     string
	Name            string
	Image           ImageInput
	State           ContainerState
	CreatedAtUnixMs int64
	Runtime         RuntimeInput
	Ports           []PortSummary
}

type EngineClient interface {
	Status(ctx context.Context, engine Engine) (EngineStatus, error)
	List(ctx context.Context, engine Engine, all bool) ([]EngineContainer, error)
	Inspect(ctx context.Context, engine Engine, containerID string) (EngineContainer, error)
}

type Adapter struct {
	client      EngineClient
	engineOrder []Engine
}

func NewAdapter(client EngineClient) *Adapter {
	return &Adapter{
		client:      client,
		engineOrder: []Engine{EngineDocker, EnginePodman},
	}
}

func (a *Adapter) Status(ctx context.Context, req StatusRequest) (StatusResponse, error) {
	engine, status, err := a.resolveEngine(ctx, req.Engine)
	if err != nil {
		return StatusResponse{
			SchemaVersion:     SchemaVersion,
			CapabilityID:      CapabilityID,
			CapabilityVersion: CapabilityVersion,
			Engine:            engine,
			Available:         false,
		}, err
	}
	return StatusResponse{
		SchemaVersion:     SchemaVersion,
		CapabilityID:      CapabilityID,
		CapabilityVersion: CapabilityVersion,
		Engine:            engine,
		Available:         status.Available,
		EngineVersion:     status.Version,
	}, nil
}

func (a *Adapter) List(ctx context.Context, req ContainerListRequest) (ContainerListResponse, error) {
	engine, _, err := a.resolveEngine(ctx, req.Engine)
	if err != nil {
		return ContainerListResponse{}, err
	}
	containers, err := a.client.List(ctx, engine, req.All)
	if err != nil {
		return ContainerListResponse{}, err
	}
	out := make([]ContainerSummary, 0, len(containers))
	for _, container := range containers {
		out = append(out, containerSummary(container))
	}
	return ContainerListResponse{
		SchemaVersion: SchemaVersion,
		CapabilityID:  CapabilityID,
		Engine:        engine,
		Containers:    out,
	}, nil
}

func (a *Adapter) Inspect(ctx context.Context, req ContainerInspectRequest) (ContainerInspectResponse, error) {
	if err := validateEngine(req.Engine); err != nil {
		return ContainerInspectResponse{}, err
	}
	containerID := strings.TrimSpace(req.ContainerID)
	if containerID == "" {
		return ContainerInspectResponse{}, errors.New("container_id is required")
	}
	container, err := a.client.Inspect(ctx, req.Engine, containerID)
	if err != nil {
		return ContainerInspectResponse{}, err
	}
	return ContainerInspectResponse{
		SchemaVersion: SchemaVersion,
		CapabilityID:  CapabilityID,
		Engine:        req.Engine,
		Container:     containerInspect(container),
	}, nil
}

func (a *Adapter) StartPreflight(ctx context.Context, req ContainerStartRequest) (StartPreflightPlan, error) {
	if err := validateEngine(req.Engine); err != nil {
		return StartPreflightPlan{}, err
	}
	containerID := strings.TrimSpace(req.ContainerID)
	if containerID == "" {
		return StartPreflightPlan{}, errors.New("container_id is required")
	}
	container, err := a.client.Inspect(ctx, req.Engine, containerID)
	if err != nil {
		return StartPreflightPlan{}, err
	}
	return BuildStartPreflightPlan(StartPreflightInput{
		Engine:        req.Engine,
		ContainerID:   container.ContainerID,
		ContainerName: container.Name,
		Image:         container.Image,
		Runtime:       container.Runtime,
	})
}

func (a *Adapter) resolveEngine(ctx context.Context, requested Engine) (Engine, EngineStatus, error) {
	if a == nil || a.client == nil {
		return EngineDocker, EngineStatus{Engine: EngineDocker}, errors.New("container engine client is required")
	}
	if requested != "" {
		if err := validateEngine(requested); err != nil {
			return requested, EngineStatus{Engine: requested}, err
		}
		status, err := a.client.Status(ctx, requested)
		if err != nil {
			return requested, EngineStatus{Engine: requested}, err
		}
		if !status.Available {
			return requested, status, fmt.Errorf("%w: %s", ErrEngineUnavailable, requested)
		}
		return requested, status, nil
	}
	for _, engine := range a.engineOrder {
		status, err := a.client.Status(ctx, engine)
		if err != nil || !status.Available {
			continue
		}
		return engine, status, nil
	}
	return EngineDocker, EngineStatus{Engine: EngineDocker}, ErrEngineUnavailable
}

func validateEngine(engine Engine) error {
	if engine.Valid() {
		return nil
	}
	return fmt.Errorf("%w: %q", ErrInvalidEngine, engine)
}

func containerSummary(container EngineContainer) ContainerSummary {
	return ContainerSummary{
		ContainerID:     strings.TrimSpace(container.ContainerID),
		Name:            strings.TrimSpace(container.Name),
		Image:           imageSummary(container.Image),
		State:           container.State,
		CreatedAtUnixMs: container.CreatedAtUnixMs,
		Ports:           append([]PortSummary(nil), container.Ports...),
	}
}

func containerInspect(container EngineContainer) ContainerInspect {
	runtime := RuntimeSummary{
		Privileged:    container.Runtime.Privileged,
		NetworkMode:   strings.TrimSpace(container.Runtime.NetworkMode),
		PIDMode:       strings.TrimSpace(container.Runtime.PIDMode),
		IPCMode:       strings.TrimSpace(container.Runtime.IPCMode),
		RestartPolicy: strings.TrimSpace(container.Runtime.RestartPolicy),
		Env:           summarizeEnv(container.Runtime.Env),
		Labels:        summarizeLabels(container.Runtime.Labels),
		Mounts:        summarizeMounts(container.Runtime.Mounts),
		Devices:       summarizeDevices(container.Runtime.Devices),
		CapAdd:        normalizeCaps(container.Runtime.CapAdd),
		CapDrop:       normalizeCaps(container.Runtime.CapDrop),
	}
	return ContainerInspect{
		ContainerID:     strings.TrimSpace(container.ContainerID),
		Name:            strings.TrimSpace(container.Name),
		Image:           imageSummary(container.Image),
		State:           container.State,
		CreatedAtUnixMs: container.CreatedAtUnixMs,
		Runtime:         runtime,
		Labels:          runtime.Labels,
		Ports:           append([]PortSummary(nil), container.Ports...),
		Mounts:          append([]MountSummary(nil), runtime.Mounts...),
		Devices:         append([]DeviceSummary(nil), runtime.Devices...),
	}
}

func imageSummary(image ImageInput) ImageSummary {
	digest := strings.TrimSpace(image.Digest)
	return ImageSummary{
		Reference:    strings.TrimSpace(image.Reference),
		Digest:       digest,
		DigestPinned: digest != "",
	}
}
