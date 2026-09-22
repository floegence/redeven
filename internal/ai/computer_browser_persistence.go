package ai

import (
	"context"
	"log/slog"
	"net/url"
	"slices"
	"unicode/utf8"

	"github.com/floegence/redeven/internal/browserstore"
)

// Snapshots retain only restorable GET addresses. Website script/data URLs,
// embedded credentials, form values and input authority are never persisted.
func browserRestorationTab(tab browserstore.Tab) browserstore.Tab {
	parsed, err := url.Parse(tab.URL)
	if err != nil || len(tab.URL) > 8192 || parsed.User != nil || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		tab.URL = "about:blank"
	}
	if len(tab.Title) > 512 {
		tab.Title = tab.Title[:512]
		for !utf8.ValidString(tab.Title) {
			tab.Title = tab.Title[:len(tab.Title)-1]
		}
	}
	tab.Selected, tab.Pinned = false, false
	return tab
}

// connectMu owns workspace metadata and its persistence ordering. The shared
// source owner supplies facts; a renderer cannot write a restoration snapshot.
func (r *ComputerUseRuntime) saveBrowserWorkspace(ctx context.Context, workspace *browserWorkspace) error {
	if len(workspace.targets) == 0 {
		return nil
	}
	if !slices.Contains(workspace.targets, workspace.selected) {
		workspace.selected = workspace.targets[0]
	}
	if r.browserStore == nil || workspace.connection != nil {
		return nil
	}
	tabs := make([]browserstore.Tab, 0, len(workspace.targets))
	for _, id := range workspace.targets {
		tab := browserRestorationTab(workspace.tabs[id])
		tab.Selected, tab.Pinned = id == workspace.selected, workspace.pinned[id]
		tabs = append(tabs, tab)
	}
	return r.browserStore.SaveTabs(ctx, workspace.owner, workspace.profile, tabs)
}

func (r *ComputerUseRuntime) browserSourceMetadata(ctx context.Context, event browserHostEvent) {
	if event.Tab == nil || r.browserStore == nil {
		return
	}
	r.mu.RLock()
	control := r.controls[event.Target]
	r.mu.RUnlock()
	if control != nil {
		control.mu.Lock()
		private := control.browser != nil && control.browser.private
		control.mu.Unlock()
		if private {
			return
		}
	}
	// Multiple windows share one history event. Closing the last external view
	// stops product history collection; personal Chrome history is never imported.
	r.mu.RLock()
	var external []*browserView
	for _, view := range r.browserViews {
		if r.browserSourceLibrary(event.Target).Kind != browserstore.Managed && view.workspace == nil && view.libraryProfile != "" && view.ctx.Err() == nil && view.permits(event.Target) {
			external = append(external, view)
		}
	}
	r.mu.RUnlock()
	tab := browserRestorationTab(*event.Tab)
	previous := make(map[string]browserstore.Tab)
	for _, view := range external {
		key := view.owner + "/" + view.libraryProfile
		if last, exists := view.libraryTabs[event.Target]; exists {
			previous[key] = last
		}
	}
	for _, view := range external {
		key := view.owner + "/" + view.libraryProfile
		last := previous[key]
		view.libraryTabs[event.Target] = tab
		if last == tab {
			continue
		}
		previous[key] = tab
		if tab.URL == "about:blank" {
			continue
		}
		entry := browserstore.Entry{URL: tab.URL, Title: tab.Title}
		var err error
		if last.URL != tab.URL {
			err = r.browserStore.Visit(ctx, view.owner, view.libraryProfile, entry)
		} else {
			err = r.browserStore.UpdateVisitTitle(ctx, view.owner, view.libraryProfile, entry)
		}
		if err != nil {
			slog.Error("browser history update failed", "profile_id", view.libraryProfile)
		}
	}
	for _, workspace := range r.browserWorkspaces {
		if !slices.Contains(workspace.targets, event.Target) {
			continue
		}
		if workspace.connection != nil {
			r.mu.RLock()
			observed := false
			for _, view := range r.browserViews {
				if view.workspace == workspace && view.ctx.Err() == nil {
					observed = true
					break
				}
			}
			r.mu.RUnlock()
			if !observed {
				continue
			}
		}
		changed, err := r.updateBrowserWorkspaceTab(ctx, workspace, event.Target, *event.Tab)
		if err != nil {
			slog.Error("browser history update failed", "profile_id", workspace.profile)
		}
		if !changed {
			continue
		}
		if err := r.saveBrowserWorkspace(ctx, workspace); err != nil {
			slog.Error("browser restoration snapshot failed", "profile_id", workspace.profile)
		}
	}
}

// Initial admission and later source metadata share the same visit identity.
// Opening another window or changing only the title cannot duplicate a visit.
func (r *ComputerUseRuntime) updateBrowserWorkspaceTab(ctx context.Context, workspace *browserWorkspace, target string, source browserstore.Tab) (bool, error) {
	tab := browserRestorationTab(source)
	previous := workspace.tabs[target]
	if previous == tab {
		return false, nil
	}
	if tab.URL != "about:blank" {
		entry := browserstore.Entry{URL: tab.URL, Title: tab.Title}
		var err error
		if previous.URL != tab.URL {
			err = r.browserStore.Visit(ctx, workspace.owner, workspace.profile, entry)
		} else {
			err = r.browserStore.UpdateVisitTitle(ctx, workspace.owner, workspace.profile, entry)
		}
		if err != nil {
			return false, err
		}
	}
	if workspace.tabs == nil {
		workspace.tabs = make(map[string]browserstore.Tab)
	}
	workspace.tabs[target] = tab
	return true, nil
}
