package ai

import (
	"context"
	"slices"

	"github.com/floegence/redeven/internal/browserstore"
)

// Caller holds connectMu. A popup joins only the explicitly opened, owned
// managed directory of its opener. It never selects a view or a Flower target.
func (r *ComputerUseRuntime) admitManagedBrowserPopup(ctx context.Context, event browserHostEvent) error {
	if event.TabID == "" || len(event.TabID) > 256 {
		return errBrowserViewUnavailable
	}
	r.mu.RLock()
	source, managed := r.executors[event.Target].(*PlaywrightTargetExecutor)
	r.mu.RUnlock()
	if !managed || !source.ManagedAttachment {
		return errBrowserViewUnavailable
	}
	var workspaces []*browserWorkspace
	for _, workspace := range r.browserWorkspaces {
		if slices.Contains(workspace.targets, event.Target) && len(workspace.targets) < 128 {
			workspaces = append(workspaces, workspace)
		}
	}
	if len(workspaces) == 0 {
		return nil
	}
	target, err := r.connectManagedBrowserLocked(ctx, ComputerBrowserConnection{ManagedProfileID: workspaces[0].profile, TabID: event.TabID, privatePopup: true}, "")
	if err != nil {
		return err
	}
	for _, workspace := range workspaces {
		if !slices.Contains(workspace.targets, target.ID) {
			workspace.targets = append(workspace.targets, target.ID)
		}
		if err := r.refreshBrowserWorkspace(ctx, workspace); err != nil {
			return err
		}
	}
	var tabs []browserstore.Tab
	if err := r.browserHost.call(ctx, "source.describe", map[string]any{"targets": []string{target.ID}}, &tabs); err != nil {
		return err
	}
	if len(tabs) == 1 {
		r.browserSourceMetadata(ctx, browserHostEvent{Target: target.ID, Tab: &tabs[0]})
	}
	return nil
}
