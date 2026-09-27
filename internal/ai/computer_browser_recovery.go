package ai

import (
	"context"
	"crypto/rand"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/browserinstall"
	"github.com/floegence/redeven/internal/session"
)

var (
	errBrowserHostFailed        = errors.New("browser service requires recovery")
	errBrowserRecoveryBlocked   = errors.New("finish the external browser session before recovery")
	errBrowserGenerationChanged = errors.New("browser service generation changed")
	errBrowserOutcomeUnknown    = errors.New("browser operation outcome is unknown")
)

type BrowserServiceStatus struct {
	State      string `json:"state"`
	Generation string `json:"generation"`
}

type browserRecovery struct {
	generation string
	done       chan struct{}
	err        error
}

// BrowserErrorCode is the single safe mapping for product recovery actions.
// Raw debugger errors can contain page content, credentials or private endpoints.
func BrowserErrorCode(err error) string {
	switch {
	case errors.Is(err, errBrowserOutcomeUnknown):
		return "BROWSER_OUTCOME_UNKNOWN"
	case errors.Is(err, browserinstall.ErrSystemPreparationRequired):
		return "BROWSER_SANDBOX_UNAVAILABLE"
	case errors.Is(err, browserinstall.ErrDependenciesMissing):
		return "BROWSER_DEPENDENCIES_MISSING"
	case errors.Is(err, browserinstall.ErrInstallRequired):
		return "BROWSER_INSTALL_REQUIRED"
	case errors.Is(err, browserinstall.ErrDisabled):
		return "BROWSER_DISABLED"
	case errors.Is(err, errBrowserRecoveryBlocked):
		return "BROWSER_RECOVERY_BLOCKED"
	case errors.Is(err, errBrowserGenerationChanged):
		return "BROWSER_GENERATION_CHANGED"
	case errors.Is(err, errBrowserHostFailed):
		return "BROWSER_SERVICE_FAILED"
	case errors.Is(err, errBrowserViewUnavailable):
		return "BROWSER_SOURCE_UNAVAILABLE"
	case errors.Is(err, context.DeadlineExceeded):
		return "BROWSER_OPEN_TIMEOUT"
	case errors.Is(err, context.Canceled):
		return "BROWSER_REQUEST_CANCELLED"
	}
	var startup *TargetStartupError
	if errors.As(err, &startup) {
		switch startup.Reason {
		case "browser_connection_failed":
			return "BROWSER_SERVICE_FAILED"
		case "browser_sandbox_unavailable":
			return "BROWSER_SANDBOX_UNAVAILABLE"
		case "browser_dependency_missing":
			return "BROWSER_DEPENDENCIES_MISSING"
		}
	}
	var policy *targetToolPolicyError
	if errors.As(err, &policy) && policy.code == "target_selection_stale" {
		return "BROWSER_SOURCE_UNAVAILABLE"
	}
	return "BROWSER_OPEN_FAILED"
}

func (r *ComputerUseRuntime) browserServiceSnapshot() BrowserServiceStatus {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.browserService
}

func (r *ComputerUseRuntime) browserHostStopped(generation string) {
	r.mu.Lock()
	if !r.closed && r.browserService.Generation == generation && r.browserService.State != "recovering" {
		r.browserService.State = "failed"
	}
	r.mu.Unlock()
}

// An accepted recovery belongs to Runtime, not the HTTP request. Concurrent or
// delayed requests for the same generation observe the same bounded operation.
func (r *ComputerUseRuntime) RecoverBrowser(ctx context.Context, meta *session.Meta, generation string) (BrowserServiceStatus, error) {
	if err := requireRWX(meta); err != nil {
		return BrowserServiceStatus{}, err
	}
	if err := ctx.Err(); err != nil {
		return BrowserServiceStatus{}, err
	}
	r.connectMu.Lock()
	operation := r.browserRecovery
	if operation == nil || operation.generation != generation {
		status := r.browserServiceSnapshot()
		if generation == "" || status.Generation != generation {
			r.connectMu.Unlock()
			return status, errBrowserGenerationChanged
		}
		r.mu.RLock()
		blocked := r.closed
		for target, control := range r.controls {
			executor := r.executors[target]
			browser, ok := executor.(*PlaywrightTargetExecutor)
			_, extension := executor.(*extensionTargetExecutor)
			external := extension || ok && !browser.ManagedAttachment && browser.CDPURL != ""
			control.mu.Lock()
			// Closed private openers can leave live private descendants. Their
			// reservation remains authoritative even after the executor retires.
			blocked = blocked || control.browser != nil && !control.browser.managed || external && control.threadID != ""
			control.mu.Unlock()
		}
		r.mu.RUnlock()
		if blocked {
			r.connectMu.Unlock()
			return status, errBrowserRecoveryBlocked
		}
		operation = &browserRecovery{generation: generation, done: make(chan struct{})}
		r.browserRecovery = operation
		r.mu.Lock()
		r.browserService.State = "recovering"
		for _, view := range r.browserViews {
			view.cancel()
		}
		r.mu.Unlock()
		go r.rebuildBrowser(operation)
	}
	r.connectMu.Unlock()
	select {
	case <-ctx.Done():
		return r.browserServiceSnapshot(), ctx.Err()
	case <-operation.done:
		return r.browserServiceSnapshot(), operation.err
	}
}

func (r *ComputerUseRuntime) rebuildBrowser(operation *browserRecovery) {
	r.connectMu.Lock()
	defer r.connectMu.Unlock()
	defer close(operation.done)
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		operation.err = errBrowserHostFailed
		return
	}
	var views []*browserView
	for _, view := range r.browserViews {
		view.cancel()
		views = append(views, view)
	}
	retired := make(map[string]bool)
	var executors []interface{ Close() error }
	for id, executor := range r.executors {
		_, ok := executor.(*PlaywrightTargetExecutor)
		_, extension := executor.(*extensionTargetExecutor)
		if !ok && !extension {
			continue
		}
		retired[id] = true
		executors = append(executors, executor.(interface{ Close() error }))
		if sampler := r.liveFrames[id]; sampler != nil {
			sampler.cancel()
		}
		if control := r.controls[id]; control != nil {
			control.mu.Lock()
			if control.browser != nil {
				control.browser.revoke()
			}
			if control.threadID != "" {
				control.pauseForUser()
			}
			control.mu.Unlock()
		}
		if id == "browser-main" {
			// Retain immutable launch paths, but keep this closed executor's
			// physical identity. Old Flower bindings cannot create a new page.
			if target, err := r.registry.ResolveTarget(context.Background(), id); err == nil {
				target.Ready, target.State = false, "connection_required"
				_ = r.registry.Update(target)
			}
		} else {
			delete(r.executors, id)
			r.registry.remove(id)
		}
	}
	r.mu.Unlock()
	// Terminating owned browsers makes uncertain held input terminal. Never
	// terminate personal Chrome or clear its unresolved privacy reservations.
	// Stop process owners together before draining views. This interrupts old
	// source calls and bounds cleanup independently of the number of open tabs.
	var processes sync.WaitGroup
	for _, profile := range r.managedProfiles {
		processes.Go(profile.close)
	}
	if r.browserHost != nil {
		processes.Go(func() { _ = r.browserHost.Close() })
	}
	processes.Wait()
	clear(r.managedProfiles)
	var consumers sync.WaitGroup
	for _, view := range views {
		consumers.Go(func() { _ = view.close() })
	}
	r.releaseScripts(func(key computerScriptKey) bool { return retired[key.target] })
	for _, executor := range executors {
		consumers.Go(func() { _ = executor.Close() })
	}
	consumers.Wait()
	r.browserHost = nil
	clear(r.browserWorkspaces)
	r.mu.Lock()
	for target := range retired {
		delete(r.controls, target)
	}
	r.browserService = BrowserServiceStatus{State: "idle", Generation: rand.Text()}
	r.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	_, operation.err = r.browserSourceHostLocked(ctx)
	if operation.err != nil {
		r.browserHostStopped(r.browserServiceSnapshot().Generation)
	}
	slog.Info("browser service recovery completed", "generation", r.browserServiceSnapshot().Generation, "ready", operation.err == nil)
}
