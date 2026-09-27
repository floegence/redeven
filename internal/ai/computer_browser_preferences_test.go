package ai

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/browserstore"
	"github.com/floegence/redeven/internal/session"
)

func TestBrowserPreferenceRequiresOwnedSuccessfulViewAndNeverRestoresExternalAuthority(t *testing.T) {
	store, err := browserstore.Open(filepath.Join(t.TempDir(), "browser.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	meta := &session.Meta{UserPublicID: "user", EndpointID: "environment", ChannelID: "channel", CanRead: true, CanWrite: true, CanExecute: true}
	owner := browserLibraryOwner(meta)
	profile := browserstore.Profile{ID: "chrome-profile", Name: "Personal", Kind: browserstore.Extension}
	if err = store.PutProfile(t.Context(), owner, profile); err != nil {
		t.Fatal(err)
	}
	installation := "browser-aaaaaaaaaaaaaaaaaaaaaaaa"
	client := &computerExtensionClient{done: make(chan struct{}), profile: ComputerExtensionProfile{ID: "ephemeral", LibraryID: profile.ID, InstallationID: installation}}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	host := &ComputerUseRuntime{browserStore: store, browserService: BrowserServiceStatus{State: "ready"}, executors: map[string]TargetToolExecutor{"target": &extensionTargetExecutor{client: client}}, browserViews: map[string]*browserView{"view": {owner: owner, channel: meta.ChannelID, ctx: ctx, initial: "target", libraryProfile: profile.ID}}, browserWorkspaces: map[string]*browserWorkspace{owner + "/" + profile.ID: {owner: owner, profile: profile.ID, selected: "target"}}}
	if err = host.SaveBrowserPreference(t.Context(), meta, "missing"); err == nil {
		t.Fatal("unsuccessful view saved preference")
	}
	for _, field := range []string{"user", "environment", "channel"} {
		other := *meta
		switch field {
		case "user":
			other.UserPublicID = "other"
		case "environment":
			other.EndpointID = "other"
		case "channel":
			other.ChannelID = "other"
		}
		if host.SaveBrowserPreference(t.Context(), &other, "view") == nil {
			t.Fatal("preference crossed", field)
		}
	}
	if err = host.SaveBrowserPreference(t.Context(), meta, "view"); err != nil {
		t.Fatal(err)
	}
	saved, err := host.BrowserPreference(t.Context(), meta)
	if err != nil || saved.Preference == nil || saved.Preference.InstallationID != installation || saved.SourceTarget != "target" {
		t.Fatal(saved, err)
	}
	close(client.done)
	saved, err = host.BrowserPreference(t.Context(), meta)
	if err != nil || saved.SourceTarget != "" || saved.ManagedProfileID != "" || saved.Preference == nil {
		t.Fatal("disconnected authority was restored or preference was lost", saved, err)
	}
	cancel()
	if host.SaveBrowserPreference(t.Context(), meta, "view") == nil {
		t.Fatal("closed view changed preference")
	}
}

func TestExtensionReconnectKeepsLibraryIdentityAndRotatesAuthority(t *testing.T) {
	_, first, _ := extensionFixture(t)
	_, second, _ := extensionFixture(t)
	if first.profile.ID == second.profile.ID {
		t.Fatal("reconnection reused authority")
	}
	if first.profile.LibraryID == "" || first.profile.LibraryID != second.profile.LibraryID {
		t.Fatal("reconnection lost library identity")
	}
}
