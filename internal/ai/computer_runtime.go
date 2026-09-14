package ai

import (
	"context"
	"errors"
	"strings"
	"sync"
)

// ComputerUseRuntime owns the adapters and the only target readiness path.
// Resolving identity is read-only. Preparation happens after target policy has
// authorized the action, and only a successful adapter handshake grants ready.
type ComputerUseRuntime struct {
	mu        sync.RWMutex
	registry  *TargetRegistry
	executors map[string]TargetToolExecutor
}

// ConnectBrowser registers an explicitly authorized Chrome CDP session. A
// running system browser is never treated as connected implicitly; callers
// must provide the bridge endpoint returned by the user-facing connect flow.
func (r *ComputerUseRuntime) ConnectBrowser(ctx context.Context, cdpURL string) (TargetDescriptor, error) {
	if r == nil || r.registry == nil {
		return TargetDescriptor{}, errors.New("computer use runtime is unavailable")
	}
	cdpURL = strings.TrimSpace(cdpURL)
	if cdpURL == "" {
		return TargetDescriptor{}, errors.New("browser connection endpoint is required")
	}
	base, err := r.registry.ResolveTarget(ctx, "browser.managed")
	if err != nil {
		return TargetDescriptor{}, &TargetStartupError{Code: "TARGET_CONNECTION_REQUIRED", Reason: "managed_browser_unavailable"}
	}
	managed, ok := r.executors[base.ID].(*PlaywrightTargetExecutor)
	if !ok || managed == nil {
		return TargetDescriptor{}, &TargetStartupError{Code: "TARGET_CONNECTION_REQUIRED", Reason: "browser_adapter_unavailable"}
	}
	connected := NewPlaywrightTargetExecutor(managed.NodeBinary, managed.HelperPath, managed.ProfileDir)
	connected.CDPURL = cdpURL
	target := TargetDescriptor{ID: "browser-connected", Kind: "browser.connected", DisplayName: "Connected Chrome", Locality: "local", Capabilities: []string{"observe", "interaction"}, State: "starting", PermissionState: "not_checked"}
	if err := r.registry.Register(target); err != nil {
		return TargetDescriptor{}, err
	}
	r.mu.Lock()
	r.executors[target.ID] = connected
	r.mu.Unlock()
	return r.PrepareTarget(ctx, target)
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
	r.mu.RLock()
	executor := r.executors[target.ID]
	r.mu.RUnlock()
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
	r.mu.RLock()
	executor := r.executors[strings.TrimSpace(call.TargetID)]
	r.mu.RUnlock()
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
	r.mu.RLock()
	executors := make([]TargetToolExecutor, 0, len(r.executors))
	for _, executor := range r.executors {
		executors = append(executors, executor)
	}
	r.mu.RUnlock()
	for _, executor := range executors {
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
	r.mu.RLock()
	executors := make([]TargetToolExecutor, 0, len(r.executors))
	for _, executor := range r.executors {
		executors = append(executors, executor)
	}
	r.mu.RUnlock()
	for _, executor := range executors {
		if closer, ok := executor.(interface{ Close() error }); ok {
			failures = append(failures, closer.Close())
		}
	}
	return errors.Join(failures...)
}
