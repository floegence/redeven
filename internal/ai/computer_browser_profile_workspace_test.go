package ai

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/browserbridge"
	"github.com/floegence/redeven/internal/session"
)

func TestExtensionWorkspaceNativeDirectorySurvivesProjectionLossAndLastClose(t *testing.T) {
	var published atomic.Int32
	var rejectInventory atomic.Bool
	host, _ := browserHostFixture(t, func(w http.ResponseWriter, request *http.Request) {
		var command struct {
			ID, Method string
			Params     json.RawMessage
		}
		_ = json.NewDecoder(request.Body).Decode(&command)
		var result any = true
		if command.Method == "source.inventory" {
			if rejectInventory.Load() {
				_ = json.NewEncoder(w).Encode(map[string]any{"id": command.ID, "error": "BROWSER_SOURCE_DIRECTORY_INVALID"})
				return
			}
			var args struct{ Tabs []ComputerBrowserTab }
			_ = json.Unmarshal(command.Params, &args)
			result = args.Tabs
		}
		if command.Method == "source.directory" {
			published.Add(1)
		}
		if command.Method == "source.admit" || command.Method == "source.ready" || command.Method == "source.order" {
			t.Error("metadata-only workspace tried to establish projection or overwrite native order", command.Method)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": command.ID, "result": result})
	})
	runtime := NewComputerUseRuntime(NewTargetRegistry(), nil, t.TempDir())
	runtime.browserHost = host
	runtime.ConfigureManagedBrowser(t.TempDir())
	hub, client, peer := extensionFixture(t, runtime)
	runtime.extension = hub
	t.Cleanup(func() { _ = runtime.Close() })
	meta := &session.Meta{ChannelID: "channel", UserPublicID: "user", EndpointID: "environment", CanRead: true, CanWrite: true, CanExecute: true}
	tabs := []ComputerBrowserTab{
		{ID: "7", NativeTargetID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", URL: "https://example.test/", Title: "First"},
		{ID: "8", NativeTargetID: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", URL: "chrome://settings/", Availability: "unsupported"},
	}
	var nativeMu sync.Mutex
	var revision uint64
	var commands []string
	var deferredTabs []ComputerBrowserTab
	unknownClose := true
	publish := func(next []ComputerBrowserTab) error {
		revision++
		var event map[string]any
		if revision == 1 {
			event = map[string]any{"type": "tabs_changed", "revision": revision, "tabs": next}
		} else {
			order := make([]string, 0, len(next))
			removed := make([]string, 0)
			for _, tab := range next {
				order = append(order, tab.ID)
			}
			for _, tab := range tabs {
				if !slices.Contains(order, tab.ID) {
					removed = append(removed, tab.ID)
				}
			}
			event = map[string]any{"type": "tabs_changed", "revision": revision, "upsert": next, "removed": removed, "order": order}
		}
		tabs = slices.Clone(next)
		return browserbridge.WriteMessage(peer, event, 1<<20)
	}
	go func() {
		for {
			raw, err := browserbridge.ReadMessage(peer, 1<<20)
			if err != nil {
				return
			}
			var command struct {
				ID, Command string
				Arguments   struct {
					Tab string `json:"tab_id"`
				}
			}
			if json.Unmarshal(raw, &command) != nil {
				return
			}
			nativeMu.Lock()
			commands = append(commands, command.Command)
			var result any = map[string]any{}
			var failure string
			switch command.Command {
			case "watch_tabs":
				if revision == 0 {
					_ = publish(tabs)
				}
			case "close_tab":
				next := slices.DeleteFunc(slices.Clone(tabs), func(tab ComputerBrowserTab) bool { return tab.ID == command.Arguments.Tab })
				if unknownClose {
					unknownClose = false
					deferredTabs = next
					failure = "EXTENSION_COMMAND_FAILED"
				} else {
					_ = publish(next)
				}
			case "new_tab":
				_ = publish(append(slices.Clone(tabs), ComputerBrowserTab{ID: "9", NativeTargetID: "cccccccccccccccccccccccccccccccc", URL: "about:blank"}))
				// The native effect committed, but its response was lost/unknown.
				failure = "EXTENSION_COMMAND_FAILED"
			case "sync_tabs":
				if deferredTabs != nil {
					_ = publish(deferredTabs)
					deferredTabs = nil
				}
			default:
				t.Error("unexpected native command", command.Command)
			}
			response := map[string]any{"id": command.ID, "result": result}
			if failure != "" {
				response = map[string]any{"id": command.ID, "error": failure}
			}
			_ = browserbridge.WriteMessage(peer, response, 1<<20)
			nativeMu.Unlock()
		}
	}()
	first, err := runtime.OpenBrowserWorkspace(t.Context(), meta, BrowserWorkspaceRequest{Connection: &ComputerBrowserConnection{ExtensionProfileID: client.profile.ID}})
	if err != nil {
		t.Fatal(err)
	}
	runtime.connectMu.Lock()
	workspace := runtime.browserViews[first.ID].workspace
	ids := slices.Clone(workspace.targets)
	runtime.connectMu.Unlock()
	if first.WorkspaceID == "" || len(ids) != 2 || len(runtime.executors) != 0 {
		t.Fatal("workspace requires live projection", first, ids)
	}
	second, err := runtime.OpenBrowserWorkspace(t.Context(), meta, BrowserWorkspaceRequest{WorkspaceID: first.WorkspaceID, InitialTarget: ids[1]})
	if err != nil || second.InitialTarget != ids[1] || first.InitialTarget != ids[0] {
		t.Fatal("window selections not independent", first, second, err)
	}
	runtime.browserSourceEvent(browserHostEvent{Type: "source_closed", Target: ids[0], Binding: "retired"})
	if !runtime.browserViews[first.ID].permits(ids[0]) {
		t.Fatal("projection loss removed native directory grant")
	}
	for index, id := range ids {
		_, err = runtime.browserDirectoryCommand(t.Context(), browserHostEvent{View: first.ID, Action: json.RawMessage(`{"kind":"close","target":"` + id + `"}`)})
		if index == 0 && !errors.Is(err, errBrowserOutcomeUnknown) || index != 0 && err != nil {
			t.Fatal(err)
		}
		runtime.connectMu.Lock()
		remaining := len(workspace.targets)
		runtime.connectMu.Unlock()
		if remaining != len(ids)-index-1 {
			t.Fatal("close outcome was not reconciled", remaining)
		}
	}
	if runtime.AuthorizeBrowserView(meta, first.ID) != nil || runtime.AuthorizeBrowserView(meta, second.ID) != nil {
		t.Fatal("last native close retired a window")
	}
	runtime.connectMu.Lock()
	empty := len(workspace.targets) == 0
	runtime.connectMu.Unlock()
	if !empty {
		t.Fatal("last native close did not leave an empty workspace")
	}
	if _, err = runtime.browserDirectoryCommand(t.Context(), browserHostEvent{View: first.ID, Action: json.RawMessage(`{"kind":"create"}`)}); !errors.Is(err, errBrowserOutcomeUnknown) {
		t.Fatal("uncertain creation was reported as success", err)
	}
	runtime.connectMu.Lock()
	count := len(workspace.targets)
	runtime.connectMu.Unlock()
	nativeMu.Lock()
	creates := 0
	for _, command := range commands {
		if command == "new_tab" {
			creates++
		}
	}
	nativeMu.Unlock()
	if count != 1 || creates != 1 {
		t.Fatal("uncertain creation was replayed or lost", count, creates)
	}
	if published.Load() < 4 {
		t.Fatal("native updates were not published")
	}
	before := published.Load()
	nativeMu.Lock()
	changed := slices.Clone(tabs)
	changed[0].Title = "Native title changed"
	err = publish(changed)
	nativeMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.After(time.Second)
	for published.Load() == before {
		select {
		case <-deadline:
			t.Fatal("native event did not update the workspace")
		case <-time.After(time.Millisecond):
		}
	}
	rejectInventory.Store(true)
	nativeMu.Lock()
	err = publish(tabs)
	nativeMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-client.done:
	case <-time.After(time.Second):
		t.Fatal("invalid directory retained a live profile with stale grants")
	}
	deadline = time.After(time.Second)
	for runtime.AuthorizeBrowserView(meta, first.ID) == nil || runtime.AuthorizeBrowserView(meta, second.ID) == nil {
		select {
		case <-deadline:
			t.Fatal("invalid directory retained observation grants")
		case <-time.After(time.Millisecond):
		}
	}
	done := make(chan error, 1)
	go func() { done <- runtime.Close() }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("runtime shutdown deadlocked joining its native directory worker")
	}
}

func TestExtensionProjectionLossKeepsNativeWorkspaceIdentity(t *testing.T) {
	runtime, meta, _, _ := browserViewFixture(t)
	client := &computerExtensionClient{profile: ComputerExtensionProfile{LibraryID: "profile"}}
	workspace := &browserWorkspace{id: "workspace", owner: browserLibraryOwner(meta), profile: "profile", extension: client, targets: []string{"page"}, native: map[string]ComputerBrowserTab{"page": {ID: "7", NativeTargetID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", URL: "https://example.test/"}}}
	runtime.browserWorkspaces = map[string]*browserWorkspace{"profile": workspace}
	runtime.connectMu.Lock()
	descriptor, err := runtime.openBrowserViewLocked(t.Context(), meta, BrowserViewRequest{Targets: []string{"page"}, InitialTarget: "page", workspace: workspace})
	runtime.connectMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	runtime.browserSourceEvent(browserHostEvent{Type: "source_closed", Target: "page"})
	if runtime.AuthorizeBrowserView(meta, descriptor.ID) != nil || !runtime.browserViews[descriptor.ID].permits("page") || !slices.Equal(workspace.targets, []string{"page"}) {
		t.Fatal("projection loss destroyed native workspace identity")
	}
}
