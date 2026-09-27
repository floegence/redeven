package ai

import (
	"context"
	"slices"

	"github.com/floegence/redeven/internal/browserstore"
	"github.com/floegence/redeven/internal/session"
)

// Preference contains only stable identity. Resume is an observation of an
// existing, still-authorized workspace, never a stored command or tab grant.
type BrowserSourcePreference struct {
	Preference       *browserstore.Preference `json:"preference"`
	ManagedProfileID string                   `json:"managed_profile_id,omitempty"`
	SourceTarget     string                   `json:"source_target,omitempty"`
}

func (r *ComputerUseRuntime) BrowserPreference(ctx context.Context, meta *session.Meta) (BrowserSourcePreference, error) {
	host, owner, err := r.browserLibrary(meta)
	if err != nil {
		return BrowserSourcePreference{}, err
	}
	preference, err := host.browserStore.Preference(ctx, owner)
	result := BrowserSourcePreference{Preference: preference}
	if err != nil || preference == nil {
		return result, err
	}
	host.connectMu.Lock()
	defer host.connectMu.Unlock()
	profiles, err := host.browserStore.Profiles(ctx, owner)
	if err != nil {
		return result, err
	}
	for _, profile := range profiles {
		if profile.ID != preference.ProfileID {
			continue
		}
		if profile.Kind == browserstore.Managed {
			available, err := host.managedProfilesLocked()
			if err != nil {
				return result, err
			}
			if slices.ContainsFunc(available, func(item ComputerManagedProfile) bool { return item.ID == profile.ID }) {
				result.ManagedProfileID = profile.ID
			}
			return result, nil
		}
	}
	// External reconnection must not attach a remembered tab, even if its numeric
	// browser ID was reused. Only the current workspace's admitted target can resume.
	host.mu.RLock()
	defer host.mu.RUnlock()
	workspace := host.browserWorkspaces[owner+"/"+preference.ProfileID]
	if workspace == nil || workspace.selected == "" || host.browserService.State != "ready" {
		return result, nil
	}
	target := workspace.selected
	if source, ok := host.executors[target].(*extensionTargetExecutor); ok && source.client.profile.InstallationID == preference.InstallationID && source.client.profile.LibraryID == preference.ProfileID {
		select {
		case <-source.client.done:
		default:
			result.SourceTarget = target
		}
	}
	return result, nil
}

// Only a successful view belonging to this authenticated user and channel can
// save the preferred source. The caller cannot submit a profile or executable.
func (r *ComputerUseRuntime) SaveBrowserPreference(ctx context.Context, meta *session.Meta, viewID string) error {
	host, owner, err := r.browserLibrary(meta)
	if err != nil {
		return err
	}
	host.connectMu.Lock()
	defer host.connectMu.Unlock()
	view, err := host.browserView(meta, viewID)
	if err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	preference := browserstore.Preference{ProfileID: view.libraryProfile}
	host.mu.RLock()
	source := host.executors[view.initial]
	if external, ok := source.(*extensionTargetExecutor); ok {
		preference.InstallationID = external.client.profile.InstallationID
	}
	host.mu.RUnlock()
	if preference.ProfileID == "" {
		return errBrowserViewUnavailable
	}
	return host.browserStore.SetPreference(ctx, owner, preference)
}
