package ai

import (
	"context"
	"errors"
	"strings"
)

// ComputerUseRuntime owns the adapters and the only target readiness path.
// Resolving identity is read-only. Preparation happens after target policy has
// authorized the action, and only a successful adapter handshake grants ready.
type ComputerUseRuntime struct {
	registry  *TargetRegistry
	executors map[string]TargetToolExecutor
}

type TargetPreparer interface {
	PrepareTarget(context.Context, TargetDescriptor) (TargetDescriptor, error)
}

type targetReadinessChecker interface {
	EnsureTargetReady(context.Context, string) error
}

type TargetStartupError struct{ Code, Reason string }

func (e *TargetStartupError) Error() string { return e.Code + ": " + e.Reason }

func NewComputerUseRuntime(registry *TargetRegistry, executors map[string]TargetToolExecutor) *ComputerUseRuntime {
	return &ComputerUseRuntime{registry: registry, executors: executors}
}
func (r *ComputerUseRuntime) ResolveTarget(ctx context.Context, alias string) (TargetDescriptor, error) {
	return r.registry.ResolveTarget(ctx, alias)
}
func (r *ComputerUseRuntime) PrepareTarget(ctx context.Context, target TargetDescriptor) (TargetDescriptor, error) {
	executor := r.executors[target.ID]
	if executor == nil {
		return target, nil
	}
	checker, ok := executor.(targetReadinessChecker)
	if !ok {
		return target, errors.New("target adapter has no readiness handshake")
	}
	err := checker.EnsureTargetReady(ctx, target.ID)
	if ctx.Err() != nil {
		return target, ctx.Err()
	}
	target.Ready = err == nil
	target.State, target.PermissionState = "ready", "granted"
	if err != nil {
		target.State, target.PermissionState = "setup_required", "helper_unavailable"
		var startup *TargetStartupError
		if errors.As(err, &startup) {
			target.PermissionState = startup.Reason
			switch startup.Code {
			case "TARGET_CONNECTION_REQUIRED":
				target.State = "connection_required"
			case "TARGET_PERMISSION_REQUIRED":
				target.State = "permission_required"
			}
		}
	}
	if updateErr := r.registry.Update(target); updateErr != nil {
		return target, updateErr
	}
	return target, nil
}
func (r *ComputerUseRuntime) ExecuteTargetTool(ctx context.Context, call TargetToolCall) (TargetToolResult, error) {
	executor := r.executors[strings.TrimSpace(call.TargetID)]
	if executor == nil {
		return TargetToolResult{}, &TargetStartupError{Code: "TARGET_EXECUTOR_UNAVAILABLE", Reason: "target_adapter_missing"}
	}
	result, err := executor.ExecuteTargetTool(ctx, call)
	if err != nil {
		if target, resolveErr := r.registry.ResolveTarget(ctx, call.TargetID); resolveErr == nil {
			target.Ready = false
			target.State = "stopped"
			_ = r.registry.Update(target)
		}
	}
	return result, err
}
func (r *ComputerUseRuntime) ResolveTargetToolAttachment(ctx context.Context, ref string) ([]byte, error) {
	for _, executor := range r.executors {
		if resolver, ok := executor.(TargetToolAttachmentResolver); ok {
			if body, err := resolver.ResolveTargetToolAttachment(ctx, ref); err == nil {
				return body, nil
			}
		}
	}
	return nil, errors.New("target attachment is unavailable")
}
func (r *ComputerUseRuntime) Close() error {
	var failures []error
	for _, executor := range r.executors {
		if closer, ok := executor.(interface{ Close() error }); ok {
			failures = append(failures, closer.Close())
		}
	}
	return errors.Join(failures...)
}
