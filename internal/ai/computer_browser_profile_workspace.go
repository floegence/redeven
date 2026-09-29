package ai

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"slices"
	"time"

	"github.com/floegence/redeven/internal/browserstore"
	"github.com/floegence/redeven/internal/session"
)

func extensionNativeTargetID(client *computerExtensionClient, native string) string {
	digest := sha256.Sum256([]byte(client.profile.LibraryID + "\x00" + native))
	return "chrome-" + hex.EncodeToString(digest[:])
}

// A Flower resource plan may reserve an opaque target before Chrome creates
// its tab. Reuse that first identity in every workspace; binding generations
// never choose or replace it.
func (r *ComputerUseRuntime) extensionWorkspaceTargetID(client *computerExtensionClient, native string) string {
	for _, workspace := range r.browserWorkspaces {
		if workspace.extension == nil || workspace.extension.profile.LibraryID != client.profile.LibraryID {
			continue
		}
		for id, tab := range workspace.native {
			if tab.NativeTargetID == native {
				return id
			}
		}
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	for id, executor := range r.executors {
		if source, ok := executor.(*extensionTargetExecutor); ok && source.client == client && source.nativeTargetID == native {
			return id
		}
	}
	return extensionNativeTargetID(client, native)
}

func (r *ComputerUseRuntime) openExtensionWorkspace(ctx context.Context, meta *session.Meta, profileID string) (BrowserViewDescriptor, error) {
	_, owner, err := r.browserLibrary(meta)
	if err != nil {
		return BrowserViewDescriptor{}, err
	}
	client, err := r.extensionClient(profileID)
	if err != nil {
		return BrowserViewDescriptor{}, err
	}
	r.connectMu.Lock()
	defer r.connectMu.Unlock()
	if _, err := r.browserSourceHostLocked(ctx); err != nil {
		return BrowserViewDescriptor{}, err
	}
	if _, err := client.call(ctx, "watch_tabs", nil); err != nil {
		return BrowserViewDescriptor{}, err
	}
	if err := r.browserStore.PutProfile(ctx, owner, browserstore.Profile{ID: client.profile.LibraryID, Name: client.profile.Name, Kind: browserstore.Extension}); err != nil {
		return BrowserViewDescriptor{}, err
	}
	if r.browserWorkspaces == nil {
		r.browserWorkspaces = make(map[string]*browserWorkspace)
	}
	key := owner + "/" + client.profile.LibraryID
	workspace := r.browserWorkspaces[key]
	if workspace == nil {
		workspace = &browserWorkspace{id: "browser-workspace-" + rand.Text(), owner: owner, profile: client.profile.LibraryID, pinned: make(map[string]bool), tabs: make(map[string]browserstore.Tab)}
		r.browserWorkspaces[key] = workspace
	}
	workspace.extension = client
	workspace.connection = &ComputerBrowserConnection{ExtensionProfileID: profileID}
	if err := r.refreshExtensionWorkspace(ctx, workspace); err != nil {
		return BrowserViewDescriptor{}, err
	}
	if !slices.Contains(workspace.targets, workspace.selected) {
		workspace.selected = ""
		if len(workspace.targets) > 0 {
			workspace.selected = workspace.targets[0]
		}
	}
	return r.openBrowserViewLocked(ctx, meta, BrowserViewRequest{Targets: slices.Clone(workspace.targets), InitialTarget: workspace.selected, workspace: workspace})
}

// Caller holds connectMu. Native directory updates never establish projection
// or input authority; the helper applies the existing view grants separately.
func (r *ComputerUseRuntime) refreshExtensionWorkspace(ctx context.Context, workspace *browserWorkspace) error {
	tabs, err := workspace.extension.directorySnapshot()
	if err != nil {
		return err
	}
	tabs, err = r.browserInventoryPrivacy(ctx, "extension:"+workspace.extension.profile.LibraryID, tabs)
	if err != nil {
		return err
	}
	current := make(map[string]ComputerBrowserTab, len(tabs))
	targets := make([]string, 0, len(tabs))
	entries := make([]map[string]any, 0, len(tabs))
	for _, tab := range tabs {
		id := r.extensionWorkspaceTargetID(workspace.extension, tab.NativeTargetID)
		if tab.Private {
			previous, known := workspace.native[id]
			if !known {
				continue
			}
			tab = previous
		}
		current[id] = tab
		targets = append(targets, id)
		entries = append(entries, map[string]any{"id": id, "native": tab.NativeTargetID, "url": tab.URL, "title": tab.Title, "pinned": tab.Pinned, "loading": tab.Loading, "availability": tab.Availability})
	}
	workspace.native, workspace.targets = current, targets
	if err := r.browserHost.call(ctx, "source.directory", map[string]any{"workspace": workspace.id, "tabs": entries}, nil); err != nil {
		return err
	}
	return r.refreshBrowserWorkspace(ctx, workspace)
}

func (client *computerExtensionClient) directoryUpdates() {
	defer client.hub.wait.Done()
	for {
		select {
		case <-client.done:
			if client.hub.owner != nil {
				client.hub.owner.extensionWorkspaceDisconnected(client)
			}
			return
		case <-client.directoryChanged:
			r := client.hub.owner
			if r == nil {
				continue
			}
			r.connectMu.Lock()
			r.mu.RLock()
			closed := r.closed
			r.mu.RUnlock()
			if closed {
				r.connectMu.Unlock()
				return
			}
			for _, workspace := range r.browserWorkspaces {
				if workspace.extension != client {
					continue
				}
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				err := r.refreshExtensionWorkspace(ctx, workspace)
				cancel()
				if err != nil {
					slog.Warn("browser directory update failed", "stage", "native_directory", "profile_id", client.profile.ID)
					// A failed privacy/grant publication cannot leave a live view
					// observing an obsolete directory. The normal disconnect path
					// drains bindings and views; recovery requires a fresh snapshot.
					_ = client.conn.Close()
					break
				}
			}
			r.connectMu.Unlock()
		}
	}
}

func (r *ComputerUseRuntime) resolveWorkspaceSource(ctx context.Context, target string) (string, error) {
	r.connectMu.Lock()
	defer r.connectMu.Unlock()
	r.mu.RLock()
	var workspace *browserWorkspace
	for _, view := range r.browserViews {
		if view.ctx.Err() == nil && view.workspace != nil && view.workspace.extension != nil && view.permits(target) {
			workspace = view.workspace
			break
		}
	}
	r.mu.RUnlock()
	if workspace == nil {
		return "", errBrowserViewUnavailable
	}
	tab, ok := workspace.native[target]
	if !ok || tab.Availability != "" {
		return "", errBrowserViewUnavailable
	}
	_, err := r.connectExtensionBrowser(ctx, ComputerBrowserConnection{ExtensionProfileID: workspace.extension.profile.ID, TabID: tab.ID, nativeTargetID: tab.NativeTargetID}, target)
	if err != nil {
		return "", err
	}
	return target, nil
}

// Native mutation confirmation precedes publication. An unknown create outcome
// reconciles metadata only; it never repeats creation or navigation.
func (r *ComputerUseRuntime) extensionWorkspaceCommand(ctx context.Context, view *browserView, action browserDirectoryAction) (string, error) {
	workspace, client := view.workspace, view.workspace.extension
	nativeArgs := func(target string) (map[string]any, error) {
		tab, ok := workspace.native[target]
		if !ok || !view.permits(target) {
			return nil, errBrowserViewUnavailable
		}
		return map[string]any{"tab_id": tab.ID, "native_target_id": tab.NativeTargetID}, nil
	}
	command := ""
	args := map[string]any{}
	switch action.Kind {
	case "create":
		command = "new_tab"
	case "pin", "move":
		var err error
		args, err = nativeArgs(action.Target)
		if err != nil {
			return "", err
		}
		command = action.Kind + "_tab"
		if action.Kind == "pin" {
			args["pinned"] = action.Pinned
		}
		if action.Kind == "move" && action.Before != nil {
			if *action.Before == action.Target {
				return "", nil
			}
			before, err := nativeArgs(*action.Before)
			if err != nil {
				return "", err
			}
			args["before"] = before
		}
	default:
		return "", errBrowserViewUnavailable
	}
	raw, operationErr := client.call(ctx, command, args)
	if operationErr != nil {
		return "", r.reconcileExtensionWorkspaceOutcome(ctx, workspace, operationErr)
	}
	if err := r.refreshExtensionWorkspace(ctx, workspace); err != nil {
		return "", err
	}
	if action.Kind == "create" {
		var created struct {
			Native string `json:"native_target_id"`
		}
		if json.Unmarshal(raw, &created) != nil || created.Native == "" {
			return "", errBrowserOutcomeUnknown
		}
		target := r.extensionWorkspaceTargetID(client, created.Native)
		if _, ok := workspace.native[target]; !ok {
			return "", errBrowserOutcomeUnknown
		}
		return target, nil
	}
	return "", nil
}

// Caller holds connectMu. Read current native facts once after an uncertain
// mutation. Never repeat its effect or navigation, including a timed-out close.
func (r *ComputerUseRuntime) reconcileExtensionWorkspaceOutcome(ctx context.Context, workspace *browserWorkspace, operationErr error) error {
	reconcile, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	_, syncErr := workspace.extension.call(reconcile, "sync_tabs", nil)
	if syncErr == nil {
		syncErr = r.refreshExtensionWorkspace(reconcile, workspace)
	}
	return errors.Join(errBrowserOutcomeUnknown, operationErr, syncErr)
}

func (r *ComputerUseRuntime) extensionWorkspaceDisconnected(client *computerExtensionClient) {
	r.connectMu.Lock()
	r.mu.RLock()
	var views []*browserView
	if !r.closed {
		for _, view := range r.browserViews {
			if view.workspace != nil && view.workspace.extension == client {
				views = append(views, view)
			}
		}
	}
	r.mu.RUnlock()
	r.connectMu.Unlock()
	for _, view := range views {
		_ = view.close()
	}
}
