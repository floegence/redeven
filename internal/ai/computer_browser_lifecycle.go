package ai

import (
	"context"
	"log/slog"
	"time"
)

// Source events retire execution authority, never native directory identity.
// The helper event reader preserves order and binding generations fence late events.
func (r *ComputerUseRuntime) browserSourceGenerationEvent(generation string, event browserHostEvent) {
	r.connectMu.Lock()
	defer r.connectMu.Unlock()
	status := r.browserServiceSnapshot()
	if generation != status.Generation || status.State == "recovering" {
		return
	}
	r.mu.RLock()
	closed := r.closed
	executor := r.executors[event.Target]
	threadID := ""
	if control := r.controls[event.Target]; control != nil {
		control.mu.Lock()
		threadID = control.threadID
		control.mu.Unlock()
	}
	r.mu.RUnlock()
	if closed {
		return
	}
	if event.Binding != "" {
		if current, ok := executor.(*extensionTargetExecutor); ok && current.pipe.binding != event.Binding {
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.browserHost.ctx, 5*time.Second)
	defer cancel()
	// Native disconnection revokes execution before the helper observes EOF.
	// Its subsequent close retires the admitted target.
	if executor == nil && event.Type != "source_closed" {
		return
	}
	if event.Type == "source_popup" {
		if err := r.admitManagedBrowserPopup(ctx, event); err != nil {
			slog.Warn("managed browser popup admission failed", "target_id", event.Target)
		}
		return
	}
	if event.Type == "source_fault" {
		if target, err := r.registry.ResolveTarget(ctx, event.Target); err == nil {
			target.Ready, target.State = false, "connection_required"
			_ = r.registry.Update(target)
		}
		if threadID != "" {
			r.publishComputerStatus(FlowerComputerStatus{ThreadID: threadID, TargetID: event.Target, State: "unavailable", ReasonCode: "source_fault"})
		}
		return
	}
	if event.Type != "source_closed" {
		return
	}
	r.mu.Lock()
	// The configured base executor also owns installation paths. Retain that
	// configuration after its physical page closes, with readiness revoked.
	if event.Target != "browser-main" {
		delete(r.executors, event.Target)
		r.registry.remove(event.Target)
	} else if target, err := r.registry.ResolveTarget(ctx, event.Target); err == nil {
		target.Ready, target.State = false, "connection_required"
		_ = r.registry.Update(target)
	}
	if sampler := r.liveFrames[event.Target]; sampler != nil {
		sampler.cancel()
	}
	if control := r.controls[event.Target]; control != nil {
		control.mu.Lock()
		if control.browser != nil {
			control.browser.revoke()
		}
		control.mu.Unlock()
	}
	r.mu.Unlock()
	r.releaseScripts(func(key computerScriptKey) bool { return key.target == event.Target })
	if closer, ok := executor.(interface{ Close() error }); ok {
		_ = closer.Close()
	}
	if threadID != "" {
		r.publishComputerStatus(FlowerComputerStatus{ThreadID: threadID, TargetID: event.Target, State: "unavailable", ReasonCode: "target_closed"})
	}
}

// Only a Runtime-owned managed browser can admit its native popup. External
// Chrome pages still require explicit target selection by the user.
func (r *ComputerUseRuntime) admitManagedBrowserPopup(ctx context.Context, event browserHostEvent) error {
	if event.TabID == "" || len(event.TabID) > 256 {
		return errBrowserSourceUnavailable
	}
	r.mu.RLock()
	source, managed := r.executors[event.Target].(*PlaywrightTargetExecutor)
	r.mu.RUnlock()
	if !managed || !source.ManagedAttachment {
		return errBrowserSourceUnavailable
	}
	for profileID, profile := range r.managedProfiles {
		if profile.endpoint == source.CDPURL {
			_, err := r.connectManagedBrowserLocked(ctx, ComputerBrowserConnection{ManagedProfileID: profileID, TabID: event.TabID, privatePopup: true}, "")
			return err
		}
	}
	return errBrowserSourceUnavailable
}
