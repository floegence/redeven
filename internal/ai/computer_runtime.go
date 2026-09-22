package ai

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/browserinstall"
	"github.com/floegence/redeven/internal/browserstore"
)

// ComputerUseRuntime owns the adapters and the only target readiness path.
// Resolving identity is read-only. Preparation happens after target policy has
// authorized the action, and only a successful adapter handshake grants ready.
type ComputerUseRuntime struct {
	browserInstallation    *browserinstall.Manager
	browserInstallationErr error
	browserStore           *browserstore.Store
	browserStoreErr        error
	browserHost            *browserSourceHost           // protected by connectMu
	browserViews           map[string]*browserView      // protected by mu
	browserWorkspaces      map[string]*browserWorkspace // protected by connectMu
	candidates             map[string]computerCandidate
	managedProfiles        map[string]*managedBrowserProfile
	extension              *computerExtensionHub
	connectMu              sync.Mutex
	closed                 bool
	mu                     sync.RWMutex
	registry               *TargetRegistry
	bindings               ComputerTargetBindingStore
	media                  computerMediaStore
	executors              map[string]TargetToolExecutor
	liveFrames             map[string]*computerLiveSampler
	liveWG                 sync.WaitGroup
	controls               map[string]*computerTargetControl
	scripts                map[computerScriptKey]*computerScriptProcess
}

// ConnectBrowser registers an explicitly authorized Chrome CDP session. A
// running system browser is never treated as connected implicitly; callers
// must provide the bridge endpoint returned by the user-facing connect flow.
func (r *ComputerUseRuntime) ConnectBrowser(ctx context.Context, connection ComputerBrowserConnection) (TargetDescriptor, error) {
	return r.connectBrowser(ctx, connection, "")
}

func (r *ComputerUseRuntime) connectBrowser(ctx context.Context, connection ComputerBrowserConnection, targetID string) (TargetDescriptor, error) {
	if err := connection.validate(); err != nil {
		return TargetDescriptor{}, err
	}
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
	if targetID != "" {
		if existing, err := r.registry.ResolveTarget(ctx, targetID); err == nil && existing.ID == targetID {
			return existing, nil
		}
	}
	if connection.ManagedProfileID != "" {
		return r.connectManagedBrowserLocked(ctx, connection, targetID)
	}
	if connection.ExtensionProfileID != "" {
		return r.connectExtensionBrowser(ctx, connection, targetID)
	}
	return r.connectCDPBrowserLocked(ctx, connection, targetID)
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
	r := &ComputerUseRuntime{registry: registry, executors: executors, media: computerMediaStore{directory: mediaDirectory}}
	for _, executor := range executors {
		if browser, ok := executor.(*PlaywrightTargetExecutor); ok {
			browser.runtimeManaged = true
		}
	}
	if err := r.restoreComputerExtension(context.Background()); err != nil {
		slog.Warn("browser extension registration could not be restored", "error", err)
	}
	return r
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
		if bound == "" {
			return r.defaultThreadBrowser(threadID)
		}
		return r.registry.ResolveTarget(ctx, bound)
	}
	if strings.HasPrefix(alias, "task-browser-") {
		if existing, err := r.registry.ResolveTarget(ctx, alias); err == nil {
			return existing, nil
		}
		// Only an unbound invocation may materialize its frozen default plan.
		// A lost durable page must not be recreated by naming its old ID.
		bindings := r.targetBindings()
		if bindings == nil {
			return TargetDescriptor{}, errors.New("computer target binding store is unavailable")
		}
		bound, err := bindings.GetComputerTarget(ctx, threadID)
		if err != nil {
			return TargetDescriptor{}, err
		}
		if bound != "" {
			return TargetDescriptor{}, errTargetNotRegistered
		}
		planned, err := r.defaultThreadBrowser(threadID)
		if err == nil && planned.ID == alias {
			return planned, nil
		}
		return TargetDescriptor{}, errTargetNotRegistered
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

// prepareInitialManagedTarget is shared by ordinary tool preparation and explicit
// private-control recovery. Only the Runtime may launch a managed profile.
func (r *ComputerUseRuntime) prepareInitialManagedTarget(ctx context.Context, target TargetDescriptor) (TargetDescriptor, error) {
	if target.connection != nil {
		// A resource plan freezes the profile in the target identity. Re-check
		// registration under the connection lock so concurrent preparation
		// cannot create two pages for the same task.
		return r.connectBrowser(ctx, *target.connection, target.ID)
	}
	var readinessErr error
	// Only the initial managed target may create its first page lazily. A lost
	// bound tab never selects a replacement or revives its old references.
	if target.ID == "browser-main" {
		r.connectMu.Lock()
		r.mu.RLock()
		executor, ok := r.executors[target.ID].(*PlaywrightTargetExecutor)
		needsPage := ok && executor.CDPURL == ""
		closed := r.closed
		r.mu.RUnlock()
		if closed {
			r.connectMu.Unlock()
			return target, &TargetStartupError{Code: "TARGET_NOT_READY", Reason: "runtime_closed"}
		}
		if needsPage {
			var prepared TargetDescriptor
			prepared, readinessErr = r.connectManagedBrowserLocked(ctx, ComputerBrowserConnection{ManagedProfileID: "browser-main", NewTab: true}, target.ID)
			if readinessErr == nil {
				target = prepared
			}
		}
		r.connectMu.Unlock()
	}
	if readinessErr == nil {
		readinessErr = r.prepareRegisteredBrowserSource(ctx, target.ID)
	}
	return target, readinessErr
}

func (r *ComputerUseRuntime) PrepareTarget(ctx context.Context, target TargetDescriptor) (TargetDescriptor, error) {
	if target.Kind == "browser.managed" && target.PermissionState != "helper_missing" {
		if _, err := r.requireManagedBrowser(); err != nil {
			return target, err
		}
	}
	var readinessErr error
	if err := ctx.Err(); err != nil {
		return target, err
	}
	target, readinessErr = r.prepareInitialManagedTarget(ctx, target)
	control := r.controlForTarget(target.ID)
	select {
	case <-ctx.Done():
		return target, ctx.Err()
	case control.gate <- struct{}{}:
	}
	defer func() { <-control.gate }()
	r.mu.RLock()
	executor := r.executors[target.ID]
	closed := r.closed
	r.mu.RUnlock()
	if closed {
		return target, &TargetStartupError{Code: "TARGET_NOT_READY", Reason: "runtime_closed"}
	}
	if executor == nil {
		return target, nil
	}
	checker, ok := executor.(targetReadinessChecker)
	if !ok {
		return target, errors.New("target adapter has no readiness handshake")
	}
	err := readinessErr
	if err == nil {
		err = checker.EnsureTargetReady(ctx, target.ID)
	}
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
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.closed {
		return target, &TargetStartupError{Code: "TARGET_NOT_READY", Reason: "runtime_closed"}
	}
	if updateErr := r.registry.Update(target); updateErr != nil {
		return target, updateErr
	}
	return target, nil
}
func (r *ComputerUseRuntime) ExecuteTargetTool(ctx context.Context, call TargetToolCall) (TargetToolResult, error) {
	if err := r.checkManagedTarget(call.TargetID); err != nil {
		return TargetToolResult{}, err
	}
	if call.bindSelection {
		if err := r.requireComputerSelectionOpen(call); err != nil {
			return TargetToolResult{}, err
		}
	}
	control, unlock, err := r.acquireComputerControl(ctx, call)
	if err != nil {
		return TargetToolResult{}, err
	}
	if call.bindSelection {
		if err := r.authorizeComputerCall(ctx, &call); err != nil {
			unlock()
			return TargetToolResult{}, err
		}
		if err := r.requireComputerSelectionOpen(call); err != nil {
			unlock()
			return TargetToolResult{}, err
		}
		if err := r.BindThreadTarget(ctx, call.ThreadID, call.TargetID); err != nil {
			unlock()
			return TargetToolResult{}, err
		}
		control.mu.Lock()
		control.threadID, control.turnID, control.runID = call.ThreadID, call.TurnID, call.RunID
		control.mu.Unlock()
		call.bindSelection = false
	}
	if call.ToolName == "computer.exec" {
		r.releasePreviousComputerTarget(call)
		unlock()
		return r.executeComputerScript(ctx, call)
	}
	defer unlock()
	return r.executeComputerToolLocked(ctx, call, control)
}

func (r *ComputerUseRuntime) executeComputerToolLocked(ctx context.Context, call TargetToolCall, control *computerTargetControl) (TargetToolResult, error) {
	if err := r.checkManagedTarget(call.TargetID); err != nil {
		return TargetToolResult{}, err
	}
	// Re-read grants after gate admission, including live capture and handback.
	// A queued operation must not retain permissions revoked while it waited.
	if err := r.authorizeComputerCall(ctx, &call); err != nil {
		return TargetToolResult{}, err
	}
	if call.controlReturn {
		control.mu.Lock()
		safety := control.pause
		missing := safety != nil && !call.fullAccess && ((safety.RequiredOrigin != "" && !slices.Contains(call.allowedOrigins, safety.RequiredOrigin)) || (safety.RequiredApp != "" && !slices.Contains(call.allowedApps, safety.RequiredApp)) || (slices.Contains(safety.ReasonCodes, "foreground_permission") && !call.allowForeground))
		control.mu.Unlock()
		if missing {
			return TargetToolResult{}, &targetToolPolicyError{code: "interaction_takeover_required", tool: call.ToolName, target: call.TargetID, safety: safety}
		}
	}
	// Look up only after acquiring the gate: a queued action must use the
	// admitted adapter, not one retired while it was waiting for control.
	r.mu.RLock()
	executor := r.executors[strings.TrimSpace(call.TargetID)]
	r.mu.RUnlock()
	if executor == nil {
		return TargetToolResult{}, &TargetStartupError{Code: "TARGET_EXECUTOR_UNAVAILABLE", Reason: "target_adapter_missing"}
	}
	r.releasePreviousComputerTarget(call)
	captureCtx := ctx
	if call.liveFrame && call.ToolName == "computer.screenshot" && !call.userInput && !call.controlReturn {
		// Hiding a viewer must not interrupt JSONL and retire a healthy browser.
		// Cancel lock acquisition normally, then drain only the admitted passive
		// capture within a deadline. The sampler discards it after viewer close.
		var cancel context.CancelFunc
		captureCtx, cancel = context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
	}
	result, err := executor.ExecuteTargetTool(captureCtx, call)
	var observationFailure *targetToolPolicyError
	if errors.As(err, &observationFailure) && observationFailure.code == "target_observation_unavailable" {
		payload, _ := result.Result.(map[string]any)
		source := "tool"
		if call.liveFrame {
			source = "viewer"
		}
		slog.Info("computer observation unavailable", "thread_id", call.ThreadID, "target_id", call.TargetID,
			"source", source, "stage", computerObservationStage(anyToString(payload["observation_stage"])), "action_executed", payload["action_executed"] == true)
	}
	if takeoverResult(result, err) {
		control.recordPause(call, result, err)
	}

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
	if result.Safety != nil && (!result.Safety.SafeToCapture || !result.Safety.SafeToSendToModel) {
		for _, attachment := range result.Attachments {
			if release, ok := executor.(interface{ releaseTargetFrame(string) }); ok {
				release.releaseTargetFrame(attachment.ResourceRef)
			}
		}
		result.Attachments, result.frameBytes = nil, nil
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
	if call.controlReturn && err == nil {
		if result.TargetID != call.TargetID || result.Safety == nil {
			return TargetToolResult{}, &TargetStartupError{Code: "TARGET_NOT_READY", Reason: "control_observation_unavailable"}
		}
		if result.Safety.Level != "routine" || !result.Safety.SafeToCapture || !result.Safety.SafeToSendToModel {
			return TargetToolResult{}, &targetToolPolicyError{code: "interaction_takeover_required", tool: call.ToolName, target: call.TargetID, safety: result.Safety}
		}
		if len(result.Attachments) != 1 || validateComputerFrame(result.Attachments[0], result.frameBytes) != nil {
			return TargetToolResult{}, computerTargetFailure(call, "FRAME_UNAVAILABLE")
		}
		control.mu.Lock()
		if control.threadID != call.ThreadID || control.runID != call.RunID {
			control.mu.Unlock()
			return TargetToolResult{}, computerTargetFailure(call, "TARGET_NOT_ALLOWED")
		}
		if browser, ok := executor.(interface {
			setBrowserPrivacy(context.Context, string, bool) error
		}); ok {
			if err := browser.setBrowserPrivacy(ctx, call.TargetID, false); err != nil {
				control.mu.Unlock()
				return TargetToolResult{}, computerTargetFailure(call, "TARGET_CONNECTION_REQUIRED")
			}
		}
		control.pause = nil
		control.mu.Unlock()
	}
	return result, err
}
func (r *ComputerUseRuntime) ResolveTargetToolAttachment(ctx context.Context, ref string) ([]byte, error) {
	return r.media.read(ctx, ref)
}
func (r *ComputerUseRuntime) Close() error {
	var failures []error
	if r.browserInstallation != nil {
		r.browserInstallation.Close()
	}
	r.connectMu.Lock()
	defer r.connectMu.Unlock()
	r.mu.Lock()
	r.closed = true
	var browserViews []*browserView
	for _, view := range r.browserViews {
		view.cancel()
		browserViews = append(browserViews, view)
	}
	var browserLeases []*browserTargetLease
	for _, control := range r.controls {
		control.mu.Lock()
		if control.browser != nil {
			control.browser.revoke()
			browserLeases = append(browserLeases, control.browser)
		}
		control.mu.Unlock()
	}
	for _, sampler := range r.liveFrames {
		sampler.cancel()
	}
	r.mu.Unlock()
	for _, view := range browserViews {
		failures = append(failures, view.close())
	}
	if r.extension != nil {
		r.extension.close()
	}
	r.liveWG.Wait()
	r.releaseScripts(func(computerScriptKey) bool { return true })
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
	for _, lease := range browserLeases {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		failures = append(failures, lease.close(ctx))
		cancel()
	}
	if r.browserHost != nil {
		failures = append(failures, r.browserHost.Close())
	}
	for _, profile := range r.managedProfiles {
		profile.close()
	}
	clear(r.managedProfiles)
	if r.browserStore != nil {
		failures = append(failures, r.browserStore.Close())
	}
	return errors.Join(failures...)
}
