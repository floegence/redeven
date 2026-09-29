package ai

import (
	"context"
	"crypto/rand"
	"slices"

	"github.com/floegence/redeven/internal/browserstore"
	"github.com/floegence/redeven/internal/session"
)

type BrowserWorkspaceRequest struct {
	WorkspaceID      string                     `json:"workspace_id,omitempty"`
	InitialTarget    string                     `json:"initial_target,omitempty"`
	ManagedProfileID string                     `json:"managed_profile_id,omitempty"`
	Connection       *ComputerBrowserConnection `json:"connection,omitempty"`
}

// A browser workspace grants product observation of an explicitly opened
// browser profile or explicit CDP page. It never changes a Flower binding.
func (r *ComputerUseRuntime) OpenBrowserWorkspace(ctx context.Context, meta *session.Meta, request BrowserWorkspaceRequest) (BrowserViewDescriptor, error) {
	if requireRWX(meta) != nil || browserLibraryOwner(meta) == "" {
		return BrowserViewDescriptor{}, errBrowserViewUnavailable
	}
	if request.WorkspaceID != "" {
		if request.Connection != nil || request.ManagedProfileID != "" {
			return BrowserViewDescriptor{}, errBrowserViewUnavailable
		}
		r.connectMu.Lock()
		defer r.connectMu.Unlock()
		for _, workspace := range r.browserWorkspaces {
			if workspace.id != request.WorkspaceID || workspace.owner != browserLibraryOwner(meta) {
				continue
			}
			if workspace.extension != nil {
				select {
				case <-workspace.extension.done:
					var current *computerExtensionClient
					if r.extension != nil {
						r.extension.mu.Lock()
						for _, client := range r.extension.profiles {
							if client.profile.LibraryID == workspace.profile {
								current = client
								break
							}
						}
						r.extension.mu.Unlock()
					}
					if current == nil {
						return BrowserViewDescriptor{}, errBrowserViewUnavailable
					}
					workspace.extension = current
					workspace.connection = &ComputerBrowserConnection{ExtensionProfileID: current.profile.ID}
					if _, err := current.call(ctx, "watch_tabs", nil); err != nil {
						return BrowserViewDescriptor{}, err
					}
				default:
				}
				if err := r.refreshExtensionWorkspace(ctx, workspace); err != nil {
					return BrowserViewDescriptor{}, err
				}
			}
			initial := request.InitialTarget
			if !slices.Contains(workspace.targets, initial) {
				initial = workspace.selected
			}
			if !slices.Contains(workspace.targets, initial) {
				initial = ""
				if len(workspace.targets) > 0 {
					initial = workspace.targets[0]
				}
			}
			profile := ""
			if workspace.connection == nil {
				profile = workspace.profile
			}
			return r.openBrowserViewLocked(ctx, meta, BrowserViewRequest{Targets: slices.Clone(workspace.targets), InitialTarget: initial, ProfileID: profile, workspace: workspace})
		}
		return BrowserViewDescriptor{}, errBrowserViewUnavailable
	}
	if (request.ManagedProfileID == "") == (request.Connection == nil) {
		return BrowserViewDescriptor{}, errBrowserViewUnavailable
	}
	if request.Connection != nil && request.Connection.ExtensionProfileID != "" {
		c := request.Connection
		if len(c.ExtensionProfileID) > 64 || c.ManagedProfileID != "" || c.NewTab || c.TabID != "" || c.TabURL != "" || c.TabTitle != "" || c.CDPURL != "" || c.ProfileID != "" {
			return BrowserViewDescriptor{}, errBrowserViewUnavailable
		}
		return r.openExtensionWorkspace(ctx, meta, request.Connection.ExtensionProfileID)
	}
	if request.Connection != nil {
		if request.Connection.ManagedProfileID != "" {
			return BrowserViewDescriptor{}, errBrowserViewUnavailable
		}
		_, owner, err := r.browserLibrary(meta)
		if err != nil {
			return BrowserViewDescriptor{}, err
		}
		target, err := r.ConnectBrowser(ctx, *request.Connection)
		if err != nil {
			return BrowserViewDescriptor{}, err
		}
		r.connectMu.Lock()
		defer r.connectMu.Unlock()
		profile, err := r.prepareBrowserViewLibrary(ctx, meta, BrowserViewRequest{Targets: []string{target.ID}})
		if err != nil || profile == "" {
			return BrowserViewDescriptor{}, errBrowserViewUnavailable
		}
		if r.browserWorkspaces == nil {
			r.browserWorkspaces = make(map[string]*browserWorkspace)
		}
		key := owner + "/" + profile
		workspace := r.browserWorkspaces[key]
		connection := *request.Connection
		connection.NewTab, connection.TabID, connection.TabURL, connection.TabTitle = false, "", "", ""
		if workspace == nil {
			workspace = &browserWorkspace{id: "browser-workspace-" + rand.Text(), owner: owner, profile: profile, connection: &connection, pinned: make(map[string]bool), tabs: make(map[string]browserstore.Tab)}
			r.browserWorkspaces[key] = workspace
		}
		workspace.connection = &connection
		if !slices.Contains(workspace.targets, target.ID) {
			if len(workspace.targets) >= 128 {
				return BrowserViewDescriptor{}, errBrowserViewUnavailable
			}
			workspace.targets = append(workspace.targets, target.ID)
		}
		workspace.selected = target.ID
		if err := r.refreshBrowserWorkspace(ctx, workspace); err != nil {
			return BrowserViewDescriptor{}, err
		}
		return r.openBrowserViewLocked(ctx, meta, BrowserViewRequest{Targets: slices.Clone(workspace.targets), InitialTarget: target.ID, workspace: workspace})
	}
	host, owner, err := r.browserLibrary(meta)
	if err != nil {
		return BrowserViewDescriptor{}, err
	}
	host.connectMu.Lock()
	defer host.connectMu.Unlock()
	profiles, err := host.managedProfilesLocked()
	if err != nil {
		return BrowserViewDescriptor{}, err
	}
	index := slices.IndexFunc(profiles, func(profile ComputerManagedProfile) bool { return profile.ID == request.ManagedProfileID })
	if index < 0 {
		return BrowserViewDescriptor{}, errBrowserViewUnavailable
	}
	profile := profiles[index]
	if err := host.browserStore.PutProfile(ctx, owner, browserstore.Profile{ID: profile.ID, Name: profile.Name, Kind: browserstore.Managed}); err != nil {
		return BrowserViewDescriptor{}, err
	}
	var saved []browserstore.Tab
	if process := host.managedProfiles[profile.ID]; process == nil || process.stopped() {
		saved, err = host.browserStore.Tabs(ctx, owner, profile.ID)
		if err != nil {
			return BrowserViewDescriptor{}, err
		}
	}
	process, err := host.managedProfileLocked(ctx, profile.ID)
	if err != nil {
		return BrowserViewDescriptor{}, err
	}
	tabs, err := process.call(ctx, "inventory")
	if err != nil {
		return BrowserViewDescriptor{}, err
	}
	tabs, err = host.browserInventoryPrivacy(ctx, process.endpoint, tabs)
	if err != nil {
		return BrowserViewDescriptor{}, err
	}
	if len(tabs) == 0 {
		tabs, err = process.call(ctx, "new_tab")
		if err != nil {
			return BrowserViewDescriptor{}, err
		}
	}
	key := owner + "/" + profile.ID
	if host.browserWorkspaces == nil {
		host.browserWorkspaces = make(map[string]*browserWorkspace)
	}
	workspace := host.browserWorkspaces[key]
	if workspace == nil {
		workspace = &browserWorkspace{id: "browser-workspace-" + rand.Text(), owner: owner, profile: profile.ID, pinned: make(map[string]bool), tabs: make(map[string]browserstore.Tab)}
		host.browserWorkspaces[key] = workspace
	}
	var targets []string
	// Reuse only blank startup pages. Any independently existing source page
	// remains in the live directory; restoration never closes it by URL.
	for _, tab := range saved {
		connection := ComputerBrowserConnection{ManagedProfileID: profile.ID, NewTab: true}
		if blank := slices.IndexFunc(tabs, func(tab ComputerBrowserTab) bool { return tab.URL == "about:blank" }); blank >= 0 {
			connection.NewTab, connection.TabID = false, tabs[blank].ID
			tabs = slices.Delete(tabs, blank, blank+1)
		}
		target, err := host.connectManagedBrowserLocked(ctx, connection, "")
		if err != nil {
			return BrowserViewDescriptor{}, err
		}
		if err := host.browserHost.call(ctx, "source.restore", map[string]string{"target": target.ID, "url": tab.URL}, nil); err != nil {
			return BrowserViewDescriptor{}, err
		}
		targets = append(targets, target.ID)
		workspace.tabs[target.ID] = browserRestorationTab(tab)
		workspace.pinned[target.ID] = tab.Pinned
		if tab.Selected {
			workspace.selected = target.ID
		}
	}
	for _, tab := range tabs {
		if tab.Private {
			if known := host.managedTabTargetID(process.endpoint, tab.ID); known != "" {
				targets = append(targets, known)
			}
			continue
		}
		// Opening an owned profile follows stable tab identities while pages load.
		// Metadata snapshot checks belong to explicit tab selection, not this
		// internal enumeration of the already selected managed profile.
		target, err := host.connectManagedBrowserLocked(ctx, ComputerBrowserConnection{ManagedProfileID: profile.ID, TabID: tab.ID}, "")
		if err != nil {
			return BrowserViewDescriptor{}, err
		}
		targets = append(targets, target.ID)
		if _, known := workspace.tabs[target.ID]; !known {
			if _, err := host.updateBrowserWorkspaceTab(ctx, workspace, target.ID, browserstore.Tab{URL: tab.URL, Title: tab.Title}); err != nil {
				return BrowserViewDescriptor{}, err
			}
		}
	}
	added := newBrowserTargets(workspace.targets, targets)
	workspace.targets = append(slices.DeleteFunc(workspace.targets, func(id string) bool { return !slices.Contains(targets, id) }), added...)
	if err := host.refreshBrowserWorkspace(ctx, workspace); err != nil {
		return BrowserViewDescriptor{}, err
	}
	if err := host.saveBrowserWorkspace(ctx, workspace); err != nil {
		return BrowserViewDescriptor{}, err
	}
	return r.openBrowserViewLocked(ctx, meta, BrowserViewRequest{Targets: slices.Clone(workspace.targets), InitialTarget: workspace.selected, ProfileID: profile.ID, workspace: workspace})
}
