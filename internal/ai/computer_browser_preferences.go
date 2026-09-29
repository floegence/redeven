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
	Preference         *browserstore.Preference `json:"preference"`
	ManagedProfileID   string                   `json:"managed_profile_id,omitempty"`
	WorkspaceID        string                   `json:"workspace_id,omitempty"`
	ExtensionProfileID string                   `json:"extension_profile_id,omitempty"`
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
	// A saved profile identifies a workspace, never a temporary projection.
	if workspace := host.browserWorkspaces[owner+"/"+preference.ProfileID]; workspace != nil && workspace.extension != nil {
		select {
		case <-workspace.extension.done:
		default:
			result.WorkspaceID = workspace.id
			result.ExtensionProfileID = workspace.extension.profile.ID
		}
	}
	if result.ExtensionProfileID == "" && host.extension != nil {
		host.extension.mu.Lock()
		for _, client := range host.extension.profiles {
			if client.profile.LibraryID == preference.ProfileID && client.profile.InstallationID == preference.InstallationID {
				result.ExtensionProfileID = client.profile.ID
				break
			}
		}
		host.extension.mu.Unlock()
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
	if view.workspace != nil && view.workspace.extension != nil {
		preference.InstallationID = view.workspace.extension.profile.InstallationID
	}
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
