package ai

import (
	"context"
	"github.com/floegence/redeven/internal/browserstore"
	"github.com/floegence/redeven/internal/session"
	"path/filepath"
	"strings"
	"testing"
)

func TestExternalBrowserLibraryScopesProfilesAndRecordsOnlyGrantedViews(t *testing.T) {
	store, err := browserstore.Open(filepath.Join(t.TempDir(), "library.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	runtime := &ComputerUseRuntime{browserStore: store, executors: map[string]TargetToolExecutor{
		"one":    &PlaywrightTargetExecutor{CDPURL: "http://127.0.0.1:9000/private-endpoint", BrowserContextID: "profile-a"},
		"peer":   &PlaywrightTargetExecutor{CDPURL: "http://127.0.0.1:9000/private-endpoint", BrowserContextID: "profile-a"},
		"other":  &PlaywrightTargetExecutor{CDPURL: "http://127.0.0.1:9000/private-endpoint", BrowserContextID: "profile-b"},
		"chrome": &extensionTargetExecutor{client: &computerExtensionClient{profile: ComputerExtensionProfile{ID: "chrome-profile", Name: "Personal"}}},
	}, browserViews: make(map[string]*browserView)}
	ctx := t.Context()
	meta := &session.Meta{UserPublicID: "one", EndpointID: "environment"}
	profile, err := runtime.prepareBrowserViewLibrary(ctx, meta, BrowserViewRequest{Targets: []string{"one", "peer"}})
	if err != nil || profile == "" || strings.Contains(profile, "private-endpoint") {
		t.Fatalf("profile identity %q: %v", profile, err)
	}
	if profile != runtime.browserSourceLibrary("peer").ID || profile == runtime.browserSourceLibrary("other").ID || profile == runtime.browserSourceLibrary("chrome").ID {
		t.Fatal("external profile boundary changed")
	}
	mixed, err := runtime.prepareBrowserViewLibrary(ctx, meta, BrowserViewRequest{Targets: []string{"one", "other"}})
	if err != nil || mixed != "" {
		t.Fatal("mixed-profile view received a shared library")
	}
	owner := browserLibraryOwner(meta)
	lifetime, cancel := context.WithCancel(ctx)
	defer cancel()
	for _, id := range []string{"inline", "window"} {
		runtime.browserViews[id] = &browserView{owner: owner, libraryProfile: profile, targets: []string{"one"}, ctx: lifetime, libraryTabs: make(map[string]browserstore.Tab)}
	}
	change := func(target, url, title string) {
		runtime.browserSourceMetadata(ctx, browserHostEvent{Target: target, Tab: &browserstore.Tab{URL: url, Title: title}})
	}
	change("one", "https://site.test/a", "First")
	change("one", "https://site.test/a", "Updated title")
	change("peer", "https://private.test/", "Never admitted to view")
	entries, err := store.History(ctx, owner, profile, "", 100)
	if err != nil || len(entries) != 1 || entries[0].Visits != 1 || entries[0].Title != "Updated title" {
		t.Fatalf("shared view history: %+v %v", entries, err)
	}
	if err := store.SaveTabs(ctx, owner, profile, []browserstore.Tab{{URL: "https://site.test/a", Selected: true}}); err != browserstore.ErrExternalRestore {
		t.Fatal("external history granted URL restoration")
	}
	cancel()
	change("one", "https://site.test/after-close", "After close")
	entries, _ = store.History(ctx, owner, profile, "", 100)
	if len(entries) != 1 {
		t.Fatal("closed external view continued collecting history")
	}
	other, _ := store.History(ctx, browserLibraryOwner(&session.Meta{UserPublicID: "other", EndpointID: "environment"}), profile, "", 100)
	if len(other) != 0 {
		t.Fatal("history crossed authenticated user boundary")
	}
}
