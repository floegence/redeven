package ai

import (
	"context"
	"log/slog"
	"slices"
	"time"
)

// Source events retire product identities, never reconnect a browser or grant
// its replacement. The helper's event reader preserves their source order.
func (r *ComputerUseRuntime) browserSourceEvent(event browserHostEvent) {
	r.connectMu.Lock()
	defer r.connectMu.Unlock()
	r.mu.RLock()
	closed := r.closed
	view := r.browserViews[event.View]
	executor := r.executors[event.Target]
	r.mu.RUnlock()
	if closed {
		return
	}
	if event.Type == "view_fault" {
		if view != nil {
			_ = view.close()
		}
		return
	}
	ctx, cancel := context.WithTimeout(r.browserHost.ctx, 5*time.Second)
	defer cancel()
	if event.Type == "view_selected" {
		if view != nil && view.workspace != nil && view.permits(event.Target) {
			view.workspace.selected = event.Target
			if err := r.saveBrowserWorkspace(ctx, view.workspace); err != nil {
				slog.Error("browser restoration snapshot failed", "profile_id", view.workspace.profile)
			}
		}
		return
	}
	// Native disconnection revokes execution before the helper observes EOF.
	// Its subsequent close must still retire directory and observation grants.
	if executor == nil && event.Type != "source_closed" {
		return
	}
	if event.Type == "source_popup" {
		if err := r.admitManagedBrowserPopup(ctx, event); err != nil {
			slog.Warn("managed browser popup admission failed", "target_id", event.Target)
		}
		return
	}
	if event.Type == "source_changed" {
		r.browserSourceMetadata(ctx, event)
		return
	}
	if event.Type == "source_fault" {
		if target, err := r.registry.ResolveTarget(ctx, event.Target); err == nil {
			target.Ready, target.State = false, "connection_required"
			_ = r.registry.Update(target)
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
	var affected []*browserView
	for _, candidate := range r.browserViews {
		if candidate.permits(event.Target) {
			affected = append(affected, candidate)
		}
	}
	r.mu.Unlock()
	r.releaseScripts(func(key computerScriptKey) bool { return key.target == event.Target })
	for _, workspace := range r.browserWorkspaces {
		// Unexpected source loss alone must not progressively overwrite the
		// recovery checkpoint during a browser-wide shutdown. An explicit tab
		// close commits its resulting directory in browserDirectoryCommand.
		workspace.targets = slices.DeleteFunc(workspace.targets, func(id string) bool { return id == event.Target })
		delete(workspace.pinned, event.Target)
		delete(workspace.tabs, event.Target)
	}
	// Grant removal also covers explicitly connected pages without a managed
	// workspace. Healthy sources and independent view selections remain alive.
	for _, candidate := range affected {
		candidate.mu.Lock()
		candidate.targets = slices.DeleteFunc(candidate.targets, func(id string) bool { return id == event.Target })
		targets, observing := slices.Clone(candidate.targets), candidate.observing
		candidate.mu.Unlock()
		if observing {
			if err := candidate.host.call(ctx, "view.grants", map[string]any{"view": candidate.id, "targets": targets}, nil); err != nil {
				_ = candidate.close()
			}
		}
	}
	if closer, ok := executor.(interface{ Close() error }); ok {
		_ = closer.Close()
	}
}
