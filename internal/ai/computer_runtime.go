package ai

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"sync"
)

// ComputerUseRuntime owns the adapters and the only target readiness path.
// Resolving identity is read-only. Preparation happens after target policy has
// authorized the action, and only a successful adapter handshake grants ready.
type ComputerUseRuntime struct {
	connectMu  sync.Mutex
	closed     bool
	mu         sync.RWMutex
	registry   *TargetRegistry
	bindings   ComputerTargetBindingStore
	media      computerMediaStore
	executors  map[string]TargetToolExecutor
	liveFrames map[string]*computerLiveSampler
	liveWG     sync.WaitGroup
}

// ConnectBrowser registers an explicitly authorized Chrome CDP session. A
// running system browser is never treated as connected implicitly; callers
// must provide the bridge endpoint returned by the user-facing connect flow.
func (r *ComputerUseRuntime) ConnectBrowser(ctx context.Context, cdpURL string) (TargetDescriptor, error) {
	if r == nil || r.registry == nil {
		return TargetDescriptor{}, errors.New("computer use runtime is unavailable")
	}
	r.connectMu.Lock()
	defer r.connectMu.Unlock()
	r.mu.RLock()
	closed := r.closed
	r.mu.RUnlock()
	if closed {
		return TargetDescriptor{}, &TargetStartupError{Code: "TARGET_NOT_READY", Reason: "runtime_closed"}
	}
	cdpURL = strings.TrimSpace(cdpURL)
	endpoint, err := url.Parse(cdpURL)
	if err != nil || endpoint.Hostname() == "" || endpoint.User != nil || endpoint.Fragment != "" || (endpoint.Scheme != "http" && endpoint.Scheme != "https" && endpoint.Scheme != "ws" && endpoint.Scheme != "wss") {
		return TargetDescriptor{}, &TargetStartupError{Code: "TARGET_CONNECTION_REQUIRED", Reason: "browser_endpoint_invalid"}
	}
	base, err := r.registry.ResolveTarget(ctx, "browser.managed")
	if err != nil {
		return TargetDescriptor{}, &TargetStartupError{Code: "TARGET_CONNECTION_REQUIRED", Reason: "managed_browser_unavailable"}
	}
	r.mu.RLock()
	managed, ok := r.executors[base.ID].(*PlaywrightTargetExecutor)
	r.mu.RUnlock()
	if !ok || managed == nil {
		return TargetDescriptor{}, &TargetStartupError{Code: "TARGET_CONNECTION_REQUIRED", Reason: "browser_adapter_unavailable"}
	}
	connected := NewPlaywrightTargetExecutor(managed.NodeBinary, managed.HelperPath, managed.ProfileDir)
	connected.CDPURL = cdpURL
	target := TargetDescriptor{ID: "browser-connected", Kind: "browser.connected", DisplayName: "Connected Chrome", Locality: "local", Capabilities: []string{"observe", "interaction"}, State: "starting", PermissionState: "not_checked"}
	// Publish only a verified replacement. A failed connection must not retire
	// the session the user already authorized.
	if err := connected.EnsureTargetReady(ctx, target.ID); err != nil {
		_ = connected.Close()
		target.State = "connection_required"
		if ctx.Err() != nil {
			return target, ctx.Err()
		}
		var startup *TargetStartupError
		if errors.As(err, &startup) {
			return target, startup
		}
		return target, &TargetStartupError{Code: "TARGET_CONNECTION_REQUIRED", Reason: "browser_connection_failed"}
	}
	target.Ready, target.State, target.PermissionState = true, "ready", "granted"
	r.mu.Lock()
	old := r.executors[target.ID]
	r.executors[target.ID] = connected
	err = r.registry.Register(target)
	r.mu.Unlock()
	if closer, ok := old.(interface{ Close() error }); ok {
		_ = closer.Close()
	}
	return target, err
}

type TargetPreparer interface {
	PrepareTarget(context.Context, TargetDescriptor) (TargetDescriptor, error)
}

type targetReadinessChecker interface {
	EnsureTargetReady(context.Context, string) error
}

type TargetStartupError struct{ Code, Reason string }

func (e *TargetStartupError) Error() string { return e.Code + ": " + e.Reason }

func NewComputerUseRuntime(registry *TargetRegistry, executors map[string]TargetToolExecutor, mediaDirectory string) *ComputerUseRuntime {
	return &ComputerUseRuntime{registry: registry, executors: executors, media: computerMediaStore{directory: mediaDirectory}}
}
func (r *ComputerUseRuntime) ResolveTarget(ctx context.Context, alias string) (TargetDescriptor, error) {
	return r.registry.ResolveTarget(ctx, alias)
}

// ComputerTargetBindingStore persists product target selection, never thread
// lifecycle or control authority. The Service installs its migrated product store
// before accepting turns. There is no process-local shadow binding.
type ComputerTargetBindingStore interface {
	GetComputerTarget(context.Context, string) (string, error)
	SetComputerTarget(context.Context, string, string) error
}

func (r *ComputerUseRuntime) targetBindings() ComputerTargetBindingStore {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.bindings
}

func (r *ComputerUseRuntime) ResolveTargetForThread(ctx context.Context, threadID, alias string) (TargetDescriptor, error) {
	alias = strings.TrimSpace(alias)
	if strings.TrimSpace(threadID) != "" && (alias == "" || alias == "current") {
		bindings := r.targetBindings()
		if bindings == nil {
			return TargetDescriptor{}, errors.New("computer target binding store is unavailable")
		}
		bound, err := bindings.GetComputerTarget(ctx, threadID)
		if err != nil {
			return TargetDescriptor{}, err
		}
		if bound != "" {
			alias = bound
		}
	}
	return r.registry.ResolveTarget(ctx, alias)
}

// BindThreadTarget runs after policy, readiness and safety checks, before an
// effect. Storage failure must not discard the result of an already executed
// action or invite its replay. A failed effect retains the selected target.
func (r *ComputerUseRuntime) BindThreadTarget(ctx context.Context, threadID, targetID string) error {
	bindings := r.targetBindings()
	if bindings == nil {
		return errors.New("computer target binding store is unavailable")
	}
	if _, err := r.registry.ResolveTarget(ctx, targetID); err != nil {
		return err
	}
	return bindings.SetComputerTarget(ctx, threadID, targetID)
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
			var failure *targetToolPolicyError
			if errors.As(err, &failure) {
				// A capture failure or a safety pause says nothing about helper liveness.
				if failure.targetState != "" {
					target.Ready, target.State = false, failure.targetState
					_ = r.registry.Update(target)
				}
			} else {
				target.Ready, target.State = false, "stopped"
				_ = r.registry.Update(target)
			}
		}
	}
	if err == nil && len(result.Attachments) > 0 {
		for _, attachment := range result.Attachments {
			if release, ok := executor.(interface{ releaseTargetFrame(string) }); ok {
				defer release.releaseTargetFrame(attachment.ResourceRef)
			}
			if !call.liveFrame {
				if storeErr := r.media.put(ctx, attachment, result.frameBytes); storeErr != nil {
					return TargetToolResult{}, computerTargetFailure(call, "FRAME_UNAVAILABLE")
				}
			}
		}
	}
	return result, err
}
func (r *ComputerUseRuntime) ResolveTargetToolAttachment(ctx context.Context, ref string) ([]byte, error) {
	return r.media.read(ctx, ref)
}
func (r *ComputerUseRuntime) Close() error {
	r.connectMu.Lock()
	defer r.connectMu.Unlock()
	r.mu.Lock()
	r.closed = true
	for _, sampler := range r.liveFrames {
		sampler.cancel()
	}
	r.mu.Unlock()
	r.liveWG.Wait()
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
