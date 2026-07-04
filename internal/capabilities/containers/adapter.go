package containers

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
)

var (
	ErrEngineUnavailable           = errors.New("container engine is unavailable")
	ErrInvalidEngine               = errors.New("container engine is invalid")
	ErrInvalidMethod               = errors.New("container method is invalid")
	ErrLogStreamBackpressure       = errors.New("logs stream sink backpressure")
	ErrLogsFollowUnsupported       = errors.New("logs follow requires a streaming adapter")
	ErrContainerOperationIDMissing = errors.New("container operation_id is required")
	ErrContainerOperationActive    = errors.New("container operation is already active")
	ErrContainerOperationNotFound  = errors.New("container operation is not active")
	ErrContainerOperationMismatch  = errors.New("container operation method mismatch")
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

type EngineActionRequest struct {
	Engine      Engine
	Method      Method
	ContainerID string
	Force       bool
	TimeoutSec  int
}

type EngineActionResult struct {
	Engine      Engine
	Method      Method
	ContainerID string
	Completed   bool
}

type EngineLogsRequest struct {
	Engine      Engine
	ContainerID string
	TailLines   int
	SinceUnixMs int64
	Follow      bool
}

type EngineLogsResult struct {
	Engine      Engine
	ContainerID string
	Lines       []LogLine
}

type LogLineSink interface {
	AppendLogLine(ctx context.Context, line LogLine) error
}

type LogLineSinkFunc func(ctx context.Context, line LogLine) error

func (f LogLineSinkFunc) AppendLogLine(ctx context.Context, line LogLine) error {
	return f(ctx, line)
}

type LogLineChannelSink struct {
	Lines chan<- LogLine
}

func NewLogLineChannelSink(lines chan<- LogLine) LogLineChannelSink {
	return LogLineChannelSink{Lines: lines}
}

func (s LogLineChannelSink) AppendLogLine(ctx context.Context, line LogLine) error {
	if s.Lines == nil {
		return errors.New("logs stream sink channel is required")
	}
	select {
	case s.Lines <- line:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	default:
		return ErrLogStreamBackpressure
	}
}

type EngineImageResult struct {
	Engine    Engine
	Image     ImageInput
	Completed bool
}

type ContainerOperationCancelRequest struct {
	OperationID string `json:"operation_id"`
	Method      Method `json:"method,omitempty"`
}

type ContainerOperationCancelResult struct {
	OperationID     string `json:"operation_id"`
	Method          Method `json:"method"`
	CancelRequested bool   `json:"cancel_requested"`
}

type EngineClient interface {
	Status(ctx context.Context, engine Engine) (EngineStatus, error)
	List(ctx context.Context, engine Engine, all bool) ([]EngineContainer, error)
	Inspect(ctx context.Context, engine Engine, containerID string) (EngineContainer, error)
	Action(ctx context.Context, req EngineActionRequest) (EngineActionResult, error)
	TailLogs(ctx context.Context, req EngineLogsRequest) (EngineLogsResult, error)
	PullImage(ctx context.Context, engine Engine, imageRef string) (EngineImageResult, error)
}

type EngineLogFollower interface {
	FollowLogs(ctx context.Context, req EngineLogsRequest, sink LogLineSink) error
}

type Adapter struct {
	client      EngineClient
	engineOrder []Engine

	operationsMu sync.Mutex
	operations   map[string]containerOperationCancel
}

type containerOperationCancel struct {
	method Method
	cancel context.CancelFunc
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

func (a *Adapter) Start(ctx context.Context, req ContainerStartRequest) (ContainerActionResponse, error) {
	return a.runAction(ctx, EngineActionRequest{
		Engine:      req.Engine,
		Method:      MethodStart,
		ContainerID: req.ContainerID,
	})
}

func (a *Adapter) Stop(ctx context.Context, req ContainerActionRequest) (ContainerActionResponse, error) {
	return a.runAction(ctx, EngineActionRequest{
		Engine:      req.Engine,
		Method:      MethodStop,
		ContainerID: req.ContainerID,
		TimeoutSec:  req.TimeoutSec,
	})
}

func (a *Adapter) Restart(ctx context.Context, req ContainerActionRequest) (ContainerActionResponse, error) {
	return a.runAction(ctx, EngineActionRequest{
		Engine:      req.Engine,
		Method:      MethodRestart,
		ContainerID: req.ContainerID,
		TimeoutSec:  req.TimeoutSec,
	})
}

func (a *Adapter) Remove(ctx context.Context, req ContainerActionRequest) (ContainerActionResponse, error) {
	return a.runAction(ctx, EngineActionRequest{
		Engine:      req.Engine,
		Method:      MethodRemove,
		ContainerID: req.ContainerID,
		Force:       req.Force,
	})
}

func (a *Adapter) TailLogs(ctx context.Context, req LogsTailRequest) (LogsTailResponse, error) {
	if err := validateEngine(req.Engine); err != nil {
		return LogsTailResponse{}, err
	}
	containerID := strings.TrimSpace(req.ContainerID)
	if containerID == "" {
		return LogsTailResponse{}, errors.New("container_id is required")
	}
	result, err := a.client.TailLogs(ctx, EngineLogsRequest{
		Engine:      req.Engine,
		ContainerID: containerID,
		TailLines:   req.TailLines,
		SinceUnixMs: req.SinceUnixMs,
		Follow:      req.Follow,
	})
	if err != nil {
		return LogsTailResponse{}, err
	}
	return LogsTailResponse{
		SchemaVersion:     SchemaVersion,
		CapabilityID:      CapabilityID,
		CapabilityVersion: CapabilityVersion,
		Engine:            result.Engine,
		ContainerID:       strings.TrimSpace(result.ContainerID),
		Lines:             append([]LogLine(nil), result.Lines...),
	}, nil
}

func (a *Adapter) FollowLogs(ctx context.Context, req LogsTailRequest, sink LogLineSink) error {
	if err := validateEngine(req.Engine); err != nil {
		return err
	}
	containerID := strings.TrimSpace(req.ContainerID)
	if containerID == "" {
		return errors.New("container_id is required")
	}
	if sink == nil {
		return errors.New("logs stream sink is required")
	}
	follower, ok := a.client.(EngineLogFollower)
	if !ok {
		return ErrLogsFollowUnsupported
	}
	return follower.FollowLogs(ctx, EngineLogsRequest{
		Engine:      req.Engine,
		ContainerID: containerID,
		TailLines:   req.TailLines,
		SinceUnixMs: req.SinceUnixMs,
		Follow:      true,
	}, sink)
}

func (a *Adapter) PullImage(ctx context.Context, req ImagePullRequest) (ImagePullResponse, error) {
	engine, imageRef, err := validateImagePull(req)
	if err != nil {
		return ImagePullResponse{}, err
	}
	return a.pullImage(ctx, engine, imageRef)
}

func (a *Adapter) PullImageWithOperation(ctx context.Context, operationID string, req ImagePullRequest) (ImagePullResponse, error) {
	engine, imageRef, err := validateImagePull(req)
	if err != nil {
		return ImagePullResponse{}, err
	}
	operationID = strings.TrimSpace(operationID)
	if operationID == "" {
		return ImagePullResponse{}, ErrContainerOperationIDMissing
	}
	operationCtx, cancel := context.WithCancel(ctx)
	if err := a.registerOperationCancel(operationID, MethodImagesPull, cancel); err != nil {
		cancel()
		return ImagePullResponse{}, err
	}
	defer a.unregisterOperationCancel(operationID)

	return a.pullImage(operationCtx, engine, imageRef)
}

func (a *Adapter) CancelOperation(_ context.Context, req ContainerOperationCancelRequest) (ContainerOperationCancelResult, error) {
	operationID := strings.TrimSpace(req.OperationID)
	if operationID == "" {
		return ContainerOperationCancelResult{}, ErrContainerOperationIDMissing
	}
	cancel, method, err := a.lookupOperationCancel(operationID)
	if err != nil {
		return ContainerOperationCancelResult{}, err
	}
	if req.Method != "" && req.Method != method {
		return ContainerOperationCancelResult{}, fmt.Errorf("%w: %s cannot cancel %s", ErrContainerOperationMismatch, req.Method, method)
	}
	cancel()
	return ContainerOperationCancelResult{
		OperationID:     operationID,
		Method:          method,
		CancelRequested: true,
	}, nil
}

func (a *Adapter) pullImage(ctx context.Context, engine Engine, imageRef string) (ImagePullResponse, error) {
	result, err := a.client.PullImage(ctx, engine, imageRef)
	if err != nil {
		return ImagePullResponse{}, err
	}
	return ImagePullResponse{
		SchemaVersion:     SchemaVersion,
		CapabilityID:      CapabilityID,
		CapabilityVersion: CapabilityVersion,
		Engine:            result.Engine,
		Image:             imageSummary(result.Image),
		Completed:         result.Completed,
	}, nil
}

func validateImagePull(req ImagePullRequest) (Engine, string, error) {
	if err := validateEngine(req.Engine); err != nil {
		return "", "", err
	}
	imageRef := strings.TrimSpace(req.ImageRef)
	if imageRef == "" {
		return "", "", errors.New("image_ref is required")
	}
	return req.Engine, imageRef, nil
}

func (a *Adapter) registerOperationCancel(operationID string, method Method, cancel context.CancelFunc) error {
	a.operationsMu.Lock()
	defer a.operationsMu.Unlock()

	if a.operations == nil {
		a.operations = make(map[string]containerOperationCancel)
	}
	if _, ok := a.operations[operationID]; ok {
		return fmt.Errorf("%w: %s", ErrContainerOperationActive, operationID)
	}
	a.operations[operationID] = containerOperationCancel{
		method: method,
		cancel: cancel,
	}
	return nil
}

func (a *Adapter) unregisterOperationCancel(operationID string) {
	a.operationsMu.Lock()
	defer a.operationsMu.Unlock()

	delete(a.operations, operationID)
}

func (a *Adapter) lookupOperationCancel(operationID string) (context.CancelFunc, Method, error) {
	a.operationsMu.Lock()
	defer a.operationsMu.Unlock()

	operation, ok := a.operations[operationID]
	if !ok {
		return nil, "", fmt.Errorf("%w: %s", ErrContainerOperationNotFound, operationID)
	}
	return operation.cancel, operation.method, nil
}

func (a *Adapter) runAction(ctx context.Context, req EngineActionRequest) (ContainerActionResponse, error) {
	if err := validateAction(req); err != nil {
		return ContainerActionResponse{}, err
	}
	result, err := a.client.Action(ctx, req)
	if err != nil {
		return ContainerActionResponse{}, err
	}
	return ContainerActionResponse{
		SchemaVersion:     SchemaVersion,
		CapabilityID:      CapabilityID,
		CapabilityVersion: CapabilityVersion,
		Engine:            result.Engine,
		Method:            result.Method,
		ContainerID:       strings.TrimSpace(result.ContainerID),
		Completed:         result.Completed,
	}, nil
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

func validateAction(req EngineActionRequest) error {
	if err := validateEngine(req.Engine); err != nil {
		return err
	}
	switch req.Method {
	case MethodStart, MethodStop, MethodRestart, MethodRemove:
	default:
		return fmt.Errorf("%w: %q", ErrInvalidMethod, req.Method)
	}
	if strings.TrimSpace(req.ContainerID) == "" {
		return errors.New("container_id is required")
	}
	if req.TimeoutSec < 0 {
		return errors.New("timeout_sec must be non-negative")
	}
	return nil
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
