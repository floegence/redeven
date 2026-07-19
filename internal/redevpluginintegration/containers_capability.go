package redevpluginintegration

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/capabilities/containers"
	redevpluginartifacts "github.com/floegence/redeven/spec/redevplugin"
	"github.com/floegence/redevplugin/pkg/capability"
	"github.com/floegence/redevplugin/pkg/capabilitycontract"
	"github.com/floegence/redevplugin/pkg/observability"
	"github.com/floegence/redevplugin/pkg/version"
)

const (
	containersCapabilityID      = "redeven.capability.container_resources"
	containersCapabilityVersion = "1.0.0"
	containerTaskCanceledReason = "container operation canceled"
	containerTerminalFailure    = "container capability terminal state failed"
	containerTerminalTimeout    = 2 * time.Second
)

var errContainerTaskCanceled = errors.New(containerTaskCanceledReason)
var errContainersCapabilityClosed = errors.New("containers capability adapter is closed")

type containersCapabilityAdapter struct {
	containers      *containers.Adapter
	diagnostics     observability.DiagnosticsSink
	terminalTimeout time.Duration

	tasksMu sync.Mutex
	tasks   map[string]containerCapabilityTask
	closed  bool
	tasksWG sync.WaitGroup

	failureMu    sync.Mutex
	asyncFailure bool
}

type containerCapabilityTask struct {
	method string
	cancel context.CancelCauseFunc
}

func newContainersCapabilityRegistry(adapter *containers.Adapter, diagnostics observability.DiagnosticsSink) (*capability.Registry, *containersCapabilityAdapter, error) {
	if err := adapter.Validate(); err != nil {
		return nil, nil, err
	}
	bundle, trustedKey, err := redevpluginartifacts.ContainersCapabilityBundle()
	if err != nil {
		return nil, nil, fmt.Errorf("load containers capability artifacts: %w", err)
	}
	verified, err := capabilitycontract.Verify(capabilitycontract.VerifyRequest{
		Bundle:                    bundle,
		ExpectedPin:               bundle.Pin,
		TrustedKey:                trustedKey,
		CurrentReDevPluginVersion: version.CurrentCompatibilityVersion(),
	})
	if err != nil {
		return nil, nil, fmt.Errorf("verify containers capability artifacts: %w", err)
	}
	bridge := &containersCapabilityAdapter{
		containers:      adapter,
		diagnostics:     diagnostics,
		terminalTimeout: containerTerminalTimeout,
		tasks:           make(map[string]containerCapabilityTask),
	}
	registry := capability.NewRegistry()
	if err := registry.Register(capability.Registration{
		Contract:        verified,
		TargetProjector: bridge,
		Adapter:         bridge,
	}); err != nil {
		return nil, nil, fmt.Errorf("register containers capability: %w", err)
	}
	return registry, bridge, nil
}

func (a *containersCapabilityAdapter) Close() error {
	if a == nil {
		return nil
	}
	a.tasksMu.Lock()
	if !a.closed {
		a.closed = true
		for _, task := range a.tasks {
			task.cancel(errContainersCapabilityClosed)
		}
	}
	a.tasksMu.Unlock()
	a.tasksWG.Wait()
	a.failureMu.Lock()
	failed := a.asyncFailure
	a.failureMu.Unlock()
	if failed {
		return errors.New(containerTerminalFailure)
	}
	return nil
}

func (a *containersCapabilityAdapter) ProjectTarget(_ context.Context, req capability.TargetResolutionRequest) (capability.TargetDescriptor, error) {
	if a == nil || a.containers == nil || req.CapabilityID != containersCapabilityID || req.CapabilityVersion != containersCapabilityVersion {
		return capability.TargetDescriptor{}, errors.New("containers capability target is invalid")
	}
	kind, err := containerTargetKind(req.TargetMethod)
	if err != nil {
		return capability.TargetDescriptor{}, err
	}
	return capability.CloneTargetDescriptor(capability.TargetDescriptor{Kind: kind, Fields: req.TargetInput})
}

func containerTargetKind(method string) (string, error) {
	switch containers.Method(method) {
	case containers.MethodStatus, containers.MethodList:
		return "container_engine", nil
	case containers.MethodInspect,
		containers.MethodStartPreflight,
		containers.MethodStart,
		containers.MethodStop,
		containers.MethodRestart,
		containers.MethodRemove,
		containers.MethodLogsTail:
		return "container", nil
	case containers.MethodImagesPull:
		return "container_image", nil
	default:
		return "", fmt.Errorf("%w: %q", containers.ErrInvalidMethod, method)
	}
}

func (a *containersCapabilityAdapter) Invoke(ctx context.Context, req capability.Invocation) (capability.Result, error) {
	if a == nil || a.containers == nil {
		return capability.Result{}, errors.New("containers capability adapter is not configured")
	}
	switch containers.Method(req.Execution.TargetMethod) {
	case containers.MethodStatus:
		return a.status(ctx, req.Arguments)
	case containers.MethodList:
		return a.list(ctx, req.Arguments)
	case containers.MethodInspect:
		return a.inspect(ctx, req.Arguments)
	case containers.MethodStartPreflight:
		return a.startPreflight(ctx, req.Arguments)
	case containers.MethodStart,
		containers.MethodStop,
		containers.MethodRestart,
		containers.MethodRemove,
		containers.MethodImagesPull:
		return a.startOperation(ctx, req)
	case containers.MethodLogsTail:
		return a.startLogStream(ctx, req)
	default:
		return capability.Result{}, fmt.Errorf("%w: %q", containers.ErrInvalidMethod, req.Execution.TargetMethod)
	}
}

func (a *containersCapabilityAdapter) CancelOperation(_ context.Context, req capability.OperationCancellation) error {
	if a == nil || strings.TrimSpace(req.OperationID) == "" || strings.TrimSpace(req.Execution.TargetMethod) == "" {
		return errors.New("container operation cancellation is invalid")
	}
	a.tasksMu.Lock()
	task, ok := a.tasks[req.OperationID]
	if !ok || task.method != req.Execution.TargetMethod {
		a.tasksMu.Unlock()
		return errors.New("container operation is not active")
	}
	a.tasksMu.Unlock()
	task.cancel(errContainerTaskCanceled)
	return nil
}

func (a *containersCapabilityAdapter) status(ctx context.Context, arguments map[string]any) (capability.Result, error) {
	var input engineArguments
	if err := decodeCapabilityArguments(arguments, &input); err != nil {
		return capability.Result{}, err
	}
	result, err := a.containers.Status(ctx, containers.StatusRequest{Engine: input.Engine})
	if err != nil {
		return capability.Result{}, containerBusinessError(err)
	}
	data := map[string]any{
		"engine":    string(result.Engine),
		"available": result.Available,
	}
	if result.EngineVersion != "" {
		data["engine_version"] = result.EngineVersion
	}
	return capability.Result{Data: data}, nil
}

func (a *containersCapabilityAdapter) list(ctx context.Context, arguments map[string]any) (capability.Result, error) {
	var input listArguments
	if err := decodeCapabilityArguments(arguments, &input); err != nil {
		return capability.Result{}, err
	}
	result, err := a.containers.List(ctx, containers.ContainerListRequest{Engine: input.Engine, All: input.All})
	if err != nil {
		return capability.Result{}, containerBusinessError(err)
	}
	items := make([]any, len(result.Containers))
	for index, item := range result.Containers {
		items[index] = projectContainerSummary(item)
	}
	return capability.Result{Data: map[string]any{
		"engine":     string(result.Engine),
		"containers": items,
	}}, nil
}

func (a *containersCapabilityAdapter) inspect(ctx context.Context, arguments map[string]any) (capability.Result, error) {
	var input containerArguments
	if err := decodeCapabilityArguments(arguments, &input); err != nil {
		return capability.Result{}, err
	}
	result, err := a.containers.Inspect(ctx, containers.ContainerInspectRequest{
		Engine:      input.Engine,
		ContainerID: input.ContainerID,
	})
	if err != nil {
		return capability.Result{}, containerBusinessError(err)
	}
	return capability.Result{Data: map[string]any{
		"engine":    string(result.Engine),
		"container": projectContainerInspect(result.Container),
	}}, nil
}

func (a *containersCapabilityAdapter) startPreflight(ctx context.Context, arguments map[string]any) (capability.Result, error) {
	var input containerArguments
	if err := decodeCapabilityArguments(arguments, &input); err != nil {
		return capability.Result{}, err
	}
	plan, err := a.containers.StartPreflight(ctx, containers.ContainerStartRequest{
		Engine:      input.Engine,
		ContainerID: input.ContainerID,
	})
	if err != nil {
		return capability.Result{}, containerBusinessError(err)
	}
	return capability.Result{Data: projectStartPreflight(plan)}, nil
}

func (a *containersCapabilityAdapter) startOperation(ctx context.Context, req capability.Invocation) (capability.Result, error) {
	sink := req.Execution.Operation
	if sink == nil || strings.TrimSpace(sink.ID()) == "" {
		return capability.Result{}, errors.New("containers operation sink is required")
	}
	method := containers.Method(req.Execution.TargetMethod)
	accepted, run, err := a.containerOperation(method, req.Arguments)
	if err != nil {
		return capability.Result{}, err
	}
	taskCtx, err := a.registerTask(ctx, sink.ID(), string(method))
	if err != nil {
		return capability.Result{}, err
	}
	go a.runOperationTask(taskCtx, req.Execution.ExecutionBinding, sink, run)
	return capability.Result{Data: accepted}, nil
}

func (a *containersCapabilityAdapter) containerOperation(method containers.Method, arguments map[string]any) (map[string]any, func(context.Context) error, error) {
	switch method {
	case containers.MethodStart:
		var input containerArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		return acceptedContainerOperation(method, input.Engine, input.ContainerID), func(ctx context.Context) error {
			_, err := a.containers.Start(ctx, containers.ContainerStartRequest{Engine: input.Engine, ContainerID: input.ContainerID})
			return err
		}, nil
	case containers.MethodStop, containers.MethodRestart:
		var input containerActionArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		run := func(ctx context.Context) error {
			request := containers.ContainerActionRequest{Engine: input.Engine, ContainerID: input.ContainerID, TimeoutSec: input.TimeoutSec}
			if method == containers.MethodStop {
				_, err := a.containers.Stop(ctx, request)
				return err
			}
			_, err := a.containers.Restart(ctx, request)
			return err
		}
		return acceptedContainerOperation(method, input.Engine, input.ContainerID), run, nil
	case containers.MethodRemove:
		var input removeArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		return acceptedContainerOperation(method, input.Engine, input.ContainerID), func(ctx context.Context) error {
			_, err := a.containers.Remove(ctx, containers.ContainerActionRequest{
				Engine: input.Engine, ContainerID: input.ContainerID, Force: input.Force,
			})
			return err
		}, nil
	case containers.MethodImagesPull:
		var input imagePullArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		accepted := map[string]any{"accepted": true, "engine": string(input.Engine), "image_ref": input.ImageRef}
		return accepted, func(ctx context.Context) error {
			_, err := a.containers.PullImage(ctx, containers.ImagePullRequest{Engine: input.Engine, ImageRef: input.ImageRef})
			return err
		}, nil
	default:
		return nil, nil, fmt.Errorf("%w: %q is not an operation method", containers.ErrInvalidMethod, method)
	}
}

func acceptedContainerOperation(method containers.Method, engine containers.Engine, containerID string) map[string]any {
	return map[string]any{
		"accepted":     true,
		"engine":       string(engine),
		"container_id": containerID,
		"method":       string(method),
	}
}

func (a *containersCapabilityAdapter) startLogStream(ctx context.Context, req capability.Invocation) (capability.Result, error) {
	if req.Execution.Operation == nil || req.Execution.Stream == nil || strings.TrimSpace(req.Execution.Operation.ID()) == "" || strings.TrimSpace(req.Execution.Stream.ID()) == "" {
		return capability.Result{}, errors.New("containers log stream sinks are required")
	}
	var input logArguments
	if err := decodeCapabilityArguments(req.Arguments, &input); err != nil {
		return capability.Result{}, err
	}
	taskCtx, err := a.registerTask(ctx, req.Execution.Operation.ID(), req.Execution.TargetMethod)
	if err != nil {
		return capability.Result{}, err
	}
	go a.runLogTask(taskCtx, req.Execution.ExecutionBinding, req.Execution.Operation, req.Execution.Stream, input)
	return capability.Result{Data: map[string]any{
		"engine":       string(input.Engine),
		"container_id": input.ContainerID,
		"subscribed":   true,
	}}, nil
}

func (a *containersCapabilityAdapter) registerTask(ctx context.Context, operationID, method string) (context.Context, error) {
	operationID = strings.TrimSpace(operationID)
	method = strings.TrimSpace(method)
	if operationID == "" || method == "" {
		return nil, errors.New("container capability task identity is required")
	}
	taskCtx, cancel := context.WithCancelCause(ctx)
	a.tasksMu.Lock()
	if a.closed {
		a.tasksMu.Unlock()
		cancel(errContainersCapabilityClosed)
		return nil, errContainersCapabilityClosed
	}
	if _, exists := a.tasks[operationID]; exists {
		a.tasksMu.Unlock()
		cancel(errors.New("duplicate container capability task"))
		return nil, errors.New("container capability task is already active")
	}
	a.tasks[operationID] = containerCapabilityTask{method: method, cancel: cancel}
	a.tasksWG.Add(1)
	a.tasksMu.Unlock()
	return taskCtx, nil
}

func (a *containersCapabilityAdapter) unregisterTask(operationID string) {
	a.tasksMu.Lock()
	task := a.tasks[operationID]
	delete(a.tasks, operationID)
	a.tasksMu.Unlock()
	if task.cancel != nil {
		task.cancel(nil)
	}
	a.tasksWG.Done()
}

func (a *containersCapabilityAdapter) runOperationTask(ctx context.Context, binding capability.ExecutionBinding, sink capability.OperationSink, run func(context.Context) error) {
	defer a.unregisterTask(sink.ID())
	err := runContainerTask(ctx, run)
	terminalCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), a.terminalTimeout)
	defer cancel()
	if err == nil {
		a.recordTerminalResult(binding, sink.Complete(terminalCtx))
		return
	}
	if containerTaskWasCanceled(ctx, sink.CancelRequested()) {
		a.recordTerminalResult(binding, sink.Cancel(terminalCtx, containerTaskCanceledReason))
		return
	}
	a.recordTerminalResult(binding, sink.Fail(terminalCtx, capability.ExecutionFailureAdapterFailed, containerBusinessError(err)))
}

func (a *containersCapabilityAdapter) runLogTask(ctx context.Context, binding capability.ExecutionBinding, operation capability.OperationSink, stream capability.StreamSink, input logArguments) {
	defer a.unregisterTask(operation.ID())
	run := func(taskCtx context.Context) error {
		request := containers.LogsTailRequest{
			Engine: input.Engine, ContainerID: input.ContainerID, TailLines: input.TailLines,
			SinceUnixMs: input.SinceUnixMS, Follow: input.Follow,
		}
		appendLine := func(line containers.LogLine) error {
			event := map[string]any{"message": line.Message}
			if line.TimestampUnixMs > 0 {
				event["timestamp_unix_ms"] = line.TimestampUnixMs
			}
			return stream.Append(taskCtx, event)
		}
		if input.Follow {
			return a.containers.FollowLogs(taskCtx, request, containers.LogLineSinkFunc(func(_ context.Context, line containers.LogLine) error {
				return appendLine(line)
			}))
		}
		result, err := a.containers.TailLogs(taskCtx, request)
		if err != nil {
			return err
		}
		for _, line := range result.Lines {
			if err := appendLine(line); err != nil {
				return err
			}
		}
		return nil
	}
	err := runContainerTask(ctx, run)
	terminalCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), a.terminalTimeout)
	defer cancel()
	if err == nil {
		a.recordTerminalResult(binding, stream.Close(terminalCtx))
		return
	}
	if containerTaskWasCanceled(ctx, operation.CancelRequested()) {
		a.recordTerminalResult(binding, operation.Cancel(terminalCtx, containerTaskCanceledReason))
		return
	}
	a.recordTerminalResult(binding, stream.Fail(terminalCtx, capability.ExecutionFailureAdapterFailed, containerBusinessError(err)))
}

func (a *containersCapabilityAdapter) recordTerminalResult(binding capability.ExecutionBinding, err error) {
	if err == nil {
		return
	}
	a.failureMu.Lock()
	a.asyncFailure = true
	a.failureMu.Unlock()
	if a.diagnostics == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), a.terminalTimeout)
	defer cancel()
	_ = a.diagnostics.AppendPluginDiagnostic(ctx, observability.DiagnosticEvent{
		Type:                 "plugin.container_capability.terminal_failed",
		Severity:             observability.DiagnosticSeverityWarning,
		Message:              containerTerminalFailure,
		PluginID:             binding.PluginID,
		PluginInstanceID:     binding.PluginInstanceID,
		SurfaceInstanceID:    binding.SurfaceInstanceID,
		ActiveFingerprint:    binding.ActiveFingerprint,
		OwnerSessionHash:     binding.OwnerSessionHash,
		OwnerUserHash:        binding.OwnerUserHash,
		OwnerEnvHash:         binding.OwnerEnvHash,
		SessionChannelIDHash: binding.SessionChannelIDHash,
		CorrelationID:        binding.AuditCorrelationID,
		Details: observability.DiagnosticDetails{
			OperationID: binding.OperationID,
			StreamID:    binding.StreamID,
			Method:      binding.TargetMethod,
			FailureCode: string(capability.ExecutionFailurePlatformFailed),
		},
		Failure: observability.FailureFromError(
			observability.FailureAdapter,
			observability.FailureComponentExecution,
			observability.FailureOperationExecutionFail,
			err,
		),
	})
}

func runContainerTask(ctx context.Context, run func(context.Context) error) (err error) {
	defer func() {
		if recover() != nil {
			err = errors.New("container capability adapter panicked")
		}
	}()
	return run(ctx)
}

func containerTaskWasCanceled(ctx context.Context, requested <-chan struct{}) bool {
	select {
	case <-requested:
		return true
	default:
	}
	cause := context.Cause(ctx)
	return errors.Is(cause, errContainerTaskCanceled) || errors.Is(cause, errContainersCapabilityClosed)
}

type engineArguments struct {
	Engine containers.Engine `json:"engine"`
}

type listArguments struct {
	Engine containers.Engine `json:"engine"`
	All    bool              `json:"all,omitempty"`
}

type containerArguments struct {
	Engine      containers.Engine `json:"engine"`
	ContainerID string            `json:"container_id"`
}

type containerActionArguments struct {
	Engine      containers.Engine `json:"engine"`
	ContainerID string            `json:"container_id"`
	TimeoutSec  int               `json:"timeout_sec,omitempty"`
}

type removeArguments struct {
	Engine      containers.Engine `json:"engine"`
	ContainerID string            `json:"container_id"`
	Force       bool              `json:"force,omitempty"`
}

type logArguments struct {
	Engine      containers.Engine `json:"engine"`
	ContainerID string            `json:"container_id"`
	TailLines   int               `json:"tail_lines,omitempty"`
	SinceUnixMS int64             `json:"since_unix_ms,omitempty"`
	Follow      bool              `json:"follow,omitempty"`
}

type imagePullArguments struct {
	Engine   containers.Engine `json:"engine"`
	ImageRef string            `json:"image_ref"`
}

func decodeCapabilityArguments(arguments map[string]any, dst any) error {
	raw, err := json.Marshal(arguments)
	if err != nil {
		return fmt.Errorf("encode containers capability arguments: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return fmt.Errorf("decode containers capability arguments: %w", err)
	}
	return nil
}

func projectContainerSummary(item containers.ContainerSummary) map[string]any {
	data := map[string]any{
		"container_id": item.ContainerID,
		"image":        projectImage(item.Image),
		"state":        string(item.State),
	}
	if item.Name != "" {
		data["name"] = item.Name
	}
	if item.CreatedAtUnixMs > 0 {
		data["created_at_unix_ms"] = item.CreatedAtUnixMs
	}
	if len(item.Ports) > 0 {
		ports := make([]any, len(item.Ports))
		for index, port := range item.Ports {
			ports[index] = projectPort(port)
		}
		data["ports"] = ports
	}
	return data
}

func projectContainerInspect(item containers.ContainerInspect) map[string]any {
	data := map[string]any{
		"container_id": item.ContainerID,
		"image":        projectImage(item.Image),
		"state":        string(item.State),
	}
	if item.Name != "" {
		data["name"] = item.Name
	}
	if item.CreatedAtUnixMs > 0 {
		data["created_at_unix_ms"] = item.CreatedAtUnixMs
	}
	if len(item.Ports) > 0 {
		ports := make([]any, len(item.Ports))
		for index, port := range item.Ports {
			ports[index] = projectPort(port)
		}
		data["ports"] = ports
	}
	return data
}

func projectImage(image containers.ImageSummary) map[string]any {
	data := map[string]any{"digest_pinned": image.DigestPinned}
	if image.Reference != "" {
		data["reference"] = image.Reference
	}
	if image.Digest != "" {
		data["digest"] = image.Digest
	}
	return data
}

func projectPort(port containers.PortSummary) map[string]any {
	data := map[string]any{"port": port.Port}
	if port.Protocol != "" {
		data["protocol"] = port.Protocol
	}
	if port.HostIP != "" {
		data["host_ip"] = port.HostIP
	}
	if port.HostPort > 0 {
		data["host_port"] = port.HostPort
	}
	return data
}

func projectStartPreflight(plan containers.StartPreflightPlan) map[string]any {
	risks := make([]any, len(plan.RiskFlags))
	for index, risk := range plan.RiskFlags {
		item := map[string]any{
			"id":       risk.ID,
			"severity": string(risk.Severity),
			"title":    risk.Title,
		}
		if risk.Detail != "" {
			item["detail"] = risk.Detail
		}
		if risk.AdminRequired {
			item["admin_required"] = true
		}
		risks[index] = item
	}
	data := map[string]any{
		"method": string(plan.Method),
		"request": map[string]any{
			"engine":       string(plan.Request.Engine),
			"container_id": plan.Request.ContainerID,
		},
		"target": map[string]any{
			"engine":       string(plan.Target.Engine),
			"container_id": plan.Target.ContainerID,
			"target_hash":  plan.Target.TargetHash,
		},
		"image": projectImage(plan.Image),
		"runtime": map[string]any{
			"privileged": plan.Runtime.Privileged,
		},
		"risk_level":     string(plan.RiskLevel),
		"risk_flags":     risks,
		"requires_admin": plan.RequiresAdmin,
	}
	target := data["target"].(map[string]any)
	if plan.Target.ContainerName != "" {
		target["container_name"] = plan.Target.ContainerName
	}
	runtime := data["runtime"].(map[string]any)
	for key, value := range map[string]string{
		"network_mode":   plan.Runtime.NetworkMode,
		"pid_mode":       plan.Runtime.PIDMode,
		"ipc_mode":       plan.Runtime.IPCMode,
		"restart_policy": plan.Runtime.RestartPolicy,
	} {
		if value != "" {
			runtime[key] = value
		}
	}
	if len(plan.Summary) > 0 {
		data["summary"] = append([]string(nil), plan.Summary...)
	}
	return data
}

func containerBusinessError(cause error) error {
	code := "CONTAINER_OPERATION_FAILED"
	message := "The container operation failed"
	var details map[string]any
	if errors.Is(cause, containers.ErrEngineUnavailable) {
		code = "CONTAINER_ENGINE_UNAVAILABLE"
		message = "The selected container engine is unavailable"
	} else if errors.Is(cause, containers.ErrContainerNotFound) {
		code = "CONTAINER_NOT_FOUND"
		message = "The requested container does not exist"
		var notFound *containers.ContainerNotFoundError
		if !errors.As(cause, &notFound) || strings.TrimSpace(notFound.ContainerID) == "" {
			return errors.New("container not-found error is missing its canonical target")
		}
		details = map[string]any{"container_id": strings.TrimSpace(notFound.ContainerID)}
	} else if errors.Is(cause, containers.ErrLogsUnavailable) {
		code = "CONTAINER_LOGS_UNAVAILABLE"
		message = "Container logs are unavailable"
	}
	businessError, err := capability.NewBusinessError(code, message, details)
	if err != nil {
		return errors.New("container capability business error is invalid")
	}
	return businessError
}
