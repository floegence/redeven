package ai

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/floegence/redeven/internal/browserstore"
)

// Chrome owns personal tab metadata; Runtime owns workspace visibility grants.
// Views retain independent selection and never select a Flower target.
// All directory mutations run under connectMu, while view grants use view.mu.
type browserWorkspace struct {
	id, owner, profile string
	extension          *computerExtensionClient
	native             map[string]ComputerBrowserTab
	targets            []string
	pinned             map[string]bool
	closed             []browserstore.Tab
	tabs               map[string]browserstore.Tab
	selected           string
	connection         *ComputerBrowserConnection // Runtime-only external source scope, never persisted.
	pendingCloses      int                        // Explicit close transactions may replace the last tab.
}

func (r *ComputerUseRuntime) newBrowserWorkspaceTab(ctx context.Context, workspace *browserWorkspace) (TargetDescriptor, error) {
	if workspace.connection == nil {
		return r.connectManagedBrowserLocked(ctx, ComputerBrowserConnection{ManagedProfileID: workspace.profile, NewTab: true}, "")
	}
	connection := *workspace.connection
	connection.NewTab, connection.TabID, connection.TabURL, connection.TabTitle = true, "", "", ""
	return r.connectCDPBrowserLocked(ctx, connection, "")
}

func newBrowserTargets(old, current []string) []string {
	var added []string
	for _, id := range current {
		if !slices.Contains(old, id) {
			added = append(added, id)
		}
	}
	return added
}

type browserDirectoryAction struct {
	Kind   string  `json:"kind"`
	Target string  `json:"target"`
	Before *string `json:"before"`
	Pinned bool    `json:"pinned"`
}

func (r *ComputerUseRuntime) browserDirectoryCommand(ctx context.Context, event browserHostEvent) (string, error) {
	var action browserDirectoryAction
	if json.Unmarshal(event.Action, &action) != nil {
		return "", errBrowserViewUnavailable
	}
	if action.Kind == "resolve" {
		return r.resolveWorkspaceSource(ctx, action.Target)
	}
	if action.Kind == "close" {
		return r.closeBrowserWorkspaceTab(ctx, event, action.Target)
	}
	r.connectMu.Lock()
	defer r.connectMu.Unlock()
	r.mu.RLock()
	view := r.browserViews[event.View]
	valid := !r.closed && view != nil && view.ctx.Err() == nil && view.workspace != nil
	r.mu.RUnlock()
	if !valid {
		return "", errBrowserViewUnavailable
	}
	ctx, cancel := view.operationContext(ctx)
	defer cancel()
	workspace := view.workspace
	if workspace.extension != nil {
		return r.extensionWorkspaceCommand(ctx, view, action)
	}
	if (action.Kind == "move" || action.Kind == "pin") && !view.permits(action.Target) {
		return "", errBrowserViewUnavailable
	}
	var selected string
	switch action.Kind {
	case "create", "restore":
		if len(workspace.targets) >= 128 {
			return "", errBrowserViewUnavailable
		}
		var restored *browserstore.Tab
		if action.Kind == "restore" {
			if workspace.connection != nil {
				return "", errBrowserViewUnavailable
			}
			if len(workspace.closed) == 0 {
				return "", nil
			}
			tab := workspace.closed[len(workspace.closed)-1]
			restored = &tab
		}
		target, err := r.newBrowserWorkspaceTab(ctx, workspace)
		if err != nil {
			return "", err
		}
		selected = target.ID
		workspace.targets = append(workspace.targets, selected)
		if restored != nil {
			workspace.closed = workspace.closed[:len(workspace.closed)-1]
			workspace.pinned[selected] = restored.Pinned
			if workspace.tabs == nil {
				workspace.tabs = make(map[string]browserstore.Tab)
			}
			workspace.tabs[selected] = browserRestorationTab(*restored)
		}
		if err := r.refreshBrowserWorkspace(ctx, workspace); err != nil {
			return "", err
		}
		if restored != nil {
			if err := view.host.call(ctx, "source.restore", map[string]string{"target": selected, "url": restored.URL}, nil); err != nil {
				return "", err
			}
		}
	case "move":
		if action.Before != nil && !view.permits(*action.Before) {
			return "", errBrowserViewUnavailable
		}
		if action.Before != nil && *action.Before == action.Target {
			return "", nil
		}
		workspace.targets = slices.DeleteFunc(workspace.targets, func(id string) bool { return id == action.Target })
		position := len(workspace.targets)
		if action.Before != nil {
			position = slices.Index(workspace.targets, *action.Before)
		}
		workspace.targets = slices.Insert(workspace.targets, position, action.Target)
	case "pin":
		workspace.pinned[action.Target] = action.Pinned
	default:
		return "", errors.New("browser directory action unavailable")
	}
	if err := r.refreshBrowserWorkspace(ctx, workspace); err != nil {
		return "", err
	}
	if err := r.saveBrowserWorkspace(ctx, workspace); err != nil {
		return "", err
	}
	return selected, nil
}

// Caller holds connectMu. Never take a view's input mutex here: the engine's
// directory callback can be awaiting this update inside that view's command.
func (r *ComputerUseRuntime) refreshBrowserWorkspace(ctx context.Context, workspace *browserWorkspace) error {
	r.mu.RLock()
	var views []*browserView
	for _, view := range r.browserViews {
		if view.workspace == workspace && view.ctx.Err() == nil {
			views = append(views, view)
		}
	}
	r.mu.RUnlock()
	pinned := make([]string, 0)
	for _, id := range workspace.targets {
		if workspace.pinned[id] {
			pinned = append(pinned, id)
		}
	}
	if workspace.extension == nil {
		if err := r.browserHost.call(ctx, "source.order", map[string]any{"targets": workspace.targets, "pinned": pinned}, nil); err != nil {
			return err
		}
	}
	for _, view := range views {
		view.mu.Lock()
		view.targets = slices.Clone(workspace.targets)
		observing := view.observing
		view.mu.Unlock()
		if observing {
			if err := view.host.call(ctx, "view.grants", map[string]any{"view": view.id, "targets": workspace.targets}, nil); err != nil {
				return err
			}
		}
	}
	return nil
}

// A close decision may remain open indefinitely. Reserve only its source gate;
// new tabs and other workspaces must not wait behind the global directory lock.
func (r *ComputerUseRuntime) closeBrowserWorkspaceTab(ctx context.Context, event browserHostEvent, targetID string) (string, error) {
	r.connectMu.Lock()
	r.mu.RLock()
	view := r.browserViews[event.View]
	valid := !r.closed && view != nil && view.ctx.Err() == nil && view.workspace != nil
	r.mu.RUnlock()
	if valid {
		valid = view.permits(targetID)
	}
	pinned := valid && view.workspace.pinned[targetID]
	if valid {
		view.workspace.pendingCloses++
	}
	r.connectMu.Unlock()
	if !valid {
		return "", errBrowserViewUnavailable
	}
	defer func() {
		r.connectMu.Lock()
		defer r.connectMu.Unlock()
		view.workspace.pendingCloses--
		r.mu.RLock()
		var views []*browserView
		for _, candidate := range r.browserViews {
			if candidate.workspace == view.workspace {
				views = append(views, candidate)
			}
		}
		r.mu.RUnlock()
		for _, candidate := range views {
			candidate.retireIfEmpty()
		}
	}()
	ctx, cancel := view.operationContext(ctx)
	defer cancel()
	// Closing is an explicit product operation. Reserve the same target gate
	// as input, revoke the former owner, and drain before closing the source.
	lease, err := r.acquireBrowserLease(ctx, targetID, view.id, false, true, nil)
	if err != nil {
		return "", err
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.WithoutCancel(ctx), browserInputDrainTimeout)
		defer done()
		_ = lease.close(cleanup)
	}()
	if view.workspace.extension != nil {
		r.connectMu.Lock()
		tab, exists := view.workspace.native[targetID]
		r.connectMu.Unlock()
		if !exists {
			return "", errBrowserViewUnavailable
		}
		r.mu.RLock()
		connected := r.executors[targetID] != nil
		r.mu.RUnlock()
		var closed bool
		err := lease.run(ctx, func(ctx context.Context) error {
			if connected {
				return view.host.call(ctx, "source.close", map[string]string{"target": targetID}, &closed)
			}
			_, err := view.workspace.extension.call(ctx, "close_tab", map[string]any{"tab_id": tab.ID, "native_target_id": tab.NativeTargetID})
			closed = err == nil
			return err
		})
		if err != nil {
			r.connectMu.Lock()
			defer r.connectMu.Unlock()
			return "", r.reconcileExtensionWorkspaceOutcome(ctx, view.workspace, err)
		}
		if !closed {
			return "", nil
		}
		r.connectMu.Lock()
		defer r.connectMu.Unlock()
		if _, err := view.workspace.extension.call(ctx, "sync_tabs", nil); err != nil {
			return "", err
		}
		return "", r.refreshExtensionWorkspace(ctx, view.workspace)
	}
	var tabs []browserstore.Tab
	if err := view.host.call(ctx, "source.describe", map[string]any{"targets": []string{targetID}}, &tabs); err != nil {
		return "", err
	}
	var closed bool
	if err := lease.run(ctx, func(ctx context.Context) error {
		return view.host.call(ctx, "source.close", map[string]string{"target": targetID}, &closed)
	}); err != nil {
		return "", err
	}
	if !closed {
		return "", nil
	}
	r.connectMu.Lock()
	defer r.connectMu.Unlock()
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	workspace := view.workspace
	if len(tabs) == 1 && workspace.connection == nil {
		tabs[0] = browserRestorationTab(tabs[0])
		tabs[0].Pinned = pinned
		workspace.closed = append(workspace.closed, tabs[0])
		if len(workspace.closed) > 20 {
			workspace.closed = workspace.closed[1:]
		}
	}
	workspace.targets = slices.DeleteFunc(workspace.targets, func(id string) bool { return id == targetID })
	delete(workspace.pinned, targetID)
	// Keep one blank tab so browser commands retain an addressable selected
	// source. This does not navigate or reclaim the page that was closed.
	if len(workspace.targets) == 0 && workspace.connection == nil {
		target, err := r.newBrowserWorkspaceTab(ctx, workspace)
		if err != nil {
			return "", err
		}
		workspace.targets = append(workspace.targets, target.ID)
	}

	if err := r.refreshBrowserWorkspace(ctx, workspace); err != nil {
		return "", err
	}
	if err := r.saveBrowserWorkspace(ctx, workspace); err != nil {
		return "", err
	}
	return "", nil
}
