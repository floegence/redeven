package ai

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/browserinstall"
	"github.com/floegence/redeven/internal/browserstore"
	"github.com/floegence/redeven/internal/session"
)

// Tests must name a qualified installation explicitly. A Playwright cache is
// never an implicit substitute for the product's installation contract.
func configureBrowserFixture(t *testing.T, runtime *ComputerUseRuntime) {
	t.Helper()
	installation := os.Getenv("REDEVEN_BROWSER_TEST_INSTALLATION")
	if !filepath.IsAbs(installation) {
		t.Fatal("REDEVEN_BROWSER_TEST_INSTALLATION must name an absolute installed catalog package directory")
	}
	pkg, err := browserinstall.NativePackage()
	if err != nil {
		t.Fatal(err)
	}
	state := t.TempDir()
	packages := filepath.Join(state, "browser", "packages")
	if err := os.MkdirAll(packages, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(installation, filepath.Join(packages, pkg.SHA256)); err != nil {
		t.Fatal(err)
	}
	runtime.ConfigureManagedBrowser(state)
	if _, err := runtime.requireManagedBrowser(); err != nil {
		t.Fatal(err)
	}
}

func browserWorkspaceFixture(t *testing.T) (*ComputerUseRuntime, *session.Meta) {
	t.Helper()
	if os.Getenv("REDEVEN_BROWSER_INTEGRATION") != "1" {
		t.Skip("set REDEVEN_BROWSER_INTEGRATION=1 with the pinned browser installed")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	helper, err := filepath.Abs("../envapp/ui_src/scripts/redevenComputerHost.mjs")
	if err != nil {
		t.Fatal(err)
	}
	registry := NewTargetRegistry()
	if err := registry.Register(TargetDescriptor{ID: "browser-main", Kind: "browser.managed", DisplayName: "Fixture"}); err != nil {
		t.Fatal(err)
	}
	runtime := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"browser-main": NewPlaywrightTargetExecutor(node, helper, t.TempDir())}, t.TempDir())
	configureBrowserFixture(t, runtime)
	t.Cleanup(func() {
		if err := runtime.Close(); err != nil {
			t.Error(err)
		}
	})
	return runtime, &session.Meta{ChannelID: "browser-channel", UserPublicID: "user", EndpointID: "environment", CanRead: true, CanWrite: true, CanExecute: true}
}

func TestBrowserWorkspaceOpensWithoutModelServiceAndReusesSources(t *testing.T) {
	runtime, meta := browserWorkspaceFixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	view, err := runtime.OpenBrowserWorkspace(ctx, meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"})
	if err != nil {
		t.Fatal(err)
	}
	if view.InitialTarget == "" || view.ProfileID != "browser-main" {
		t.Fatalf("workspace identity: %+v", view)
	}
	first := runtime.executors[view.InitialTarget]
	second, err := runtime.OpenBrowserWorkspace(ctx, meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"})
	if err != nil {
		t.Fatal(err)
	}
	if second.ID == view.ID || second.InitialTarget != view.InitialTarget || runtime.executors[view.InitialTarget] != first {
		t.Fatal("opening another viewer replaced the source owner")
	}
	if len(runtime.managedProfiles) != 1 {
		t.Fatal("viewing duplicated the managed browser process")
	}
	observation, err := runtime.OpenBrowserObservation(ctx, meta, view.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer observation.Close()
	messages := make(chan map[string]any, 128)
	go func() {
		defer close(messages)
		reader := bufio.NewScanner(observation)
		reader.Buffer(make([]byte, 4096), 16<<20)
		for reader.Scan() {
			var message map[string]any
			if json.Unmarshal(reader.Bytes(), &message) != nil {
				return
			}
			select {
			case messages <- message:
			case <-ctx.Done():
				return
			}
		}
	}()
	ack := func(id int) {
		t.Helper()
		for {
			select {
			case message, ok := <-messages:
				if !ok {
					t.Fatal("observation ended before command acknowledgement")
				}
				if message["type"] != "ack" || message["id"] != float64(id) {
					continue
				}
				if message["ok"] != true {
					t.Fatalf("directory command %d failed: %v", id, message)
				}
				return
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
		}
	}
	for {
		select {
		case message, ok := <-messages:
			if !ok {
				t.Fatal("observation closed")
			}
			if message["type"] != "session_access" || message["editTabs"] != true {
				continue
			}
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
		break
	}
	command, _ := json.Marshal(map[string]any{"type": "command", "id": 1, "tab": view.InitialTarget, "epoch": "", "action": map[string]any{"kind": "tab_new"}})
	if err := runtime.ReceiveBrowserView(ctx, meta, view.ID, "", command); err != nil {
		t.Fatal(err)
	}
	ack(1)
	runtime.browserViews[view.ID].mu.Lock()
	created := slices.Clone(runtime.browserViews[view.ID].targets)
	runtime.browserViews[view.ID].mu.Unlock()
	if len(created) != 2 {
		t.Fatalf("directory command failed to create a Runtime source: %v", created)
	}
	if runtime.controlForTarget(created[1]).threadID != "" || runtime.controlForTarget(created[1]).browser != nil {
		t.Fatal("tab creation granted input authority")
	}
	if !slices.Equal(runtime.browserViews[second.ID].targets, created) {
		t.Fatal("the second workspace viewer missed the new source")
	}
	for index, action := range []map[string]any{
		{"kind": "tab_pin", "tab": created[1], "pinned": true},
		{"kind": "tab_move", "tab": created[1], "before": created[0]},
		{"kind": "tab_close", "tab": created[1]},
		{"kind": "tab_restore"},
	} {
		var state struct {
			Active string `json:"active"`
		}
		if err := runtime.browserHost.call(ctx, "view.state", map[string]string{"view": view.ID}, &state); err != nil {
			t.Fatal(err)
		}
		command, _ := json.Marshal(map[string]any{"type": "command", "id": index + 2, "tab": state.Active, "epoch": "", "action": action})
		if err := runtime.ReceiveBrowserView(ctx, meta, view.ID, "", command); err != nil {
			t.Fatal(err)
		}
		ack(index + 2)
	}
	workspace := runtime.browserViews[view.ID].workspace
	if len(workspace.targets) != 2 || workspace.targets[1] == created[1] || !workspace.pinned[workspace.targets[1]] {
		t.Fatalf("closed tab was not restored with a fresh source identity and pin: %+v", workspace)
	}
	if runtime.controlForTarget(view.InitialTarget).threadID != "" {
		t.Fatal("opening a browser acquired Flower control")
	}
	profiles, err := runtime.BrowserLibraryProfiles(ctx, meta)
	if err != nil || len(profiles) != 1 || profiles[0].ID != "browser-main" {
		t.Fatalf("profile metadata: %+v %v", profiles, err)
	}
	if err := runtime.CloseBrowserView(ctx, meta, view.ID); err != nil {
		t.Fatal(err)
	}
	if err := runtime.browserHost.call(ctx, "source.ready", map[string]string{"target": view.InitialTarget}, nil); err != nil {
		t.Fatal("closing one viewer closed its source", err)
	}
}

func TestBrowserInputAdmissionDoesNotWaitForNavigationCompletion(t *testing.T) {
	runtime, meta := browserWorkspaceFixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	entered := make(chan struct{})
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-r.Context().Done()
	}))
	defer func() { site.CloseClientConnections(); site.Close() }()
	view, err := runtime.OpenBrowserWorkspace(ctx, meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"})
	if err != nil {
		t.Fatal(err)
	}
	observation, err := runtime.OpenBrowserObservation(ctx, meta, view.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer observation.Close()
	go func() { _, _ = io.Copy(io.Discard, observation) }()
	token, err := runtime.AcquireBrowserViewControl(ctx, meta, view.ID, view.InitialTarget, false, false)
	if err != nil {
		t.Fatal(err)
	}
	admission, done := context.WithTimeout(ctx, time.Second)
	defer done()
	command, _ := json.Marshal(map[string]any{"type": "command", "id": 1, "tab": view.InitialTarget, "epoch": "", "action": map[string]any{"kind": "navigate", "url": site.URL}})
	if err := runtime.ReceiveBrowserView(admission, meta, view.ID, token, command); err != nil {
		t.Fatalf("input admission waited for navigation completion: %v", err)
	}
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	command, _ = json.Marshal(map[string]any{"type": "command", "id": 2, "tab": view.InitialTarget, "epoch": "", "action": map[string]any{"kind": "stop"}})
	if err := runtime.ReceiveBrowserView(ctx, meta, view.ID, token, command); err != nil {
		t.Fatal("stop was blocked by the pending navigation", err)
	}
}

func TestBrowserSourceCloseRetiresRuntimeIdentityWithoutClosingPeer(t *testing.T) {
	runtime, meta := browserWorkspaceFixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()
	view, err := runtime.OpenBrowserWorkspace(ctx, meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"})
	if err != nil {
		t.Fatal(err)
	}
	observation := observeBrowserFixture(t, ctx, runtime, meta, view)
	observation.send(1, view.InitialTarget, "", map[string]any{"kind": "tab_new"})
	observation.ack(1)
	runtime.connectMu.Lock()
	workspace := runtime.browserViews[view.ID].workspace
	peer := workspace.targets[1]
	runtime.connectMu.Unlock()
	var closed bool
	if err := runtime.browserHost.call(ctx, "source.close", map[string]string{"target": view.InitialTarget}, &closed); err != nil || !closed {
		t.Fatalf("source close: %v %v", closed, err)
	}
	deadline := time.NewTimer(2 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		runtime.mu.RLock()
		_, retained := runtime.executors[view.InitialTarget]
		runtime.mu.RUnlock()
		if !retained {
			break
		}
		select {
		case <-tick.C:
		case <-deadline.C:
			t.Fatal("closed source retained its Runtime executor and target identity")
		}
	}
	if _, err := runtime.registry.ResolveTarget(ctx, view.InitialTarget); err == nil {
		t.Fatal("closed source remained in the target directory")
	}
	runtime.connectMu.Lock()
	targets := slices.Clone(workspace.targets)
	runtime.connectMu.Unlock()
	if !slices.Equal(targets, []string{peer}) || runtime.browserViews[view.ID].permits(view.InitialTarget) {
		t.Fatalf("closed source retained observation grants: %v", targets)
	}
	if err := runtime.browserHost.call(ctx, "source.ready", map[string]string{"target": peer}, nil); err != nil {
		t.Fatal("closing a source damaged its peer", err)
	}
	if _, err := runtime.managedResources(); err != nil {
		t.Fatal("closing an admitted page removed the browser installation owner", err)
	}
}

func TestBrowserRestoreAcknowledgesWhileTheSourceWebsiteIsPending(t *testing.T) {
	runtime, meta := browserWorkspaceFixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	entered := make(chan struct{}, 1)
	site := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
		select {
		case entered <- struct{}{}:
		default:
		}
		<-request.Context().Done()
	}))
	defer func() { site.CloseClientConnections(); site.Close() }()
	view, err := runtime.OpenBrowserWorkspace(ctx, meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"})
	if err != nil {
		t.Fatal(err)
	}
	_ = observeBrowserFixture(t, ctx, runtime, meta, view)
	runtime.connectMu.Lock()
	runtime.browserViews[view.ID].workspace.closed = []browserstore.Tab{{URL: site.URL, Title: "Pending site"}}
	runtime.connectMu.Unlock()
	operation, done := context.WithTimeout(ctx, 3*time.Second)
	defer done()
	target, err := runtime.browserDirectoryCommand(operation, browserHostEvent{View: view.ID, Action: json.RawMessage(`{"kind":"restore"}`)})
	if err != nil || target == "" {
		t.Fatalf("restoring a tab waited for its website: %q %v", target, err)
	}
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("restored source did not start navigation")
	}
	if _, err := runtime.OpenBrowserWorkspace(operation, meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"}); err != nil {
		t.Fatal("pending restored navigation blocked the browser directory", err)
	}
	if control := runtime.controlForTarget(target); control.threadID != "" || control.browser != nil {
		t.Fatal("restoring a tab restored input authority")
	}
}

func TestBrowserWorkspaceRecordsSourceNavigationAndRestorationState(t *testing.T) {
	runtime, meta := browserWorkspaceFixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "<title>Saved source</title><h1>Saved source</h1>")
	}))
	defer site.Close()
	view, err := runtime.OpenBrowserWorkspace(ctx, meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"})
	if err != nil {
		t.Fatal(err)
	}
	observation := observeBrowserFixture(t, ctx, runtime, meta, view)
	token, err := runtime.AcquireBrowserViewControl(ctx, meta, view.ID, view.InitialTarget, false, false)
	if err != nil {
		t.Fatal(err)
	}
	observation.send(1, view.InitialTarget, token, map[string]any{"kind": "navigate", "url": site.URL})
	observation.ack(1)
	observation.send(2, view.InitialTarget, "", map[string]any{"kind": "tab_pin", "tab": view.InitialTarget, "pinned": true})
	observation.ack(2)
	observation.send(3, view.InitialTarget, "", map[string]any{"kind": "tab_new"})
	observation.ack(3)
	deadline := time.NewTimer(2 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		tabs, err := runtime.BrowserLibraryTabs(ctx, meta, "browser-main")
		if err != nil {
			t.Fatal(err)
		}
		history, err := runtime.BrowserHistory(ctx, meta, "browser-main", "", 10)
		if err != nil {
			t.Fatal(err)
		}
		if len(tabs) == 2 && tabs[0].URL == site.URL+"/" && tabs[0].Title == "Saved source" && tabs[0].Pinned && !tabs[0].Selected && tabs[1].Selected && len(history) == 1 && history[0].Title == "Saved source" && history[0].Visits == 1 {
			return
		}
		select {
		case <-tick.C:
		case <-deadline.C:
			t.Fatalf("source navigation or directory state was not saved: tabs=%+v history=%+v", tabs, history)
		}
	}
}

func TestBrowserWorkspaceRestoresSavedTabsOnlyWhenExplicitlyOpened(t *testing.T) {
	runtime, meta := browserWorkspaceFixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		_, _ = io.WriteString(w, "<title>Restored page</title><h1>"+request.URL.Path+"</h1>")
	}))
	defer site.Close()
	owner := browserLibraryOwner(meta)
	if err := runtime.browserStore.PutProfile(ctx, owner, browserstore.Profile{ID: "browser-main", Name: "Default", Kind: browserstore.Managed}); err != nil {
		t.Fatal(err)
	}
	if err := runtime.browserStore.SaveTabs(ctx, owner, "browser-main", []browserstore.Tab{{URL: site.URL + "/first", Title: "First", Pinned: true}, {URL: site.URL + "/second", Title: "Second", Selected: true}}); err != nil {
		t.Fatal(err)
	}
	if len(runtime.managedProfiles) != 0 || runtime.browserHost != nil {
		t.Fatal("saved product state started a browser without a user opening it")
	}
	view, err := runtime.OpenBrowserWorkspace(ctx, meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"})
	if err != nil {
		t.Fatal(err)
	}
	runtime.connectMu.Lock()
	workspace := runtime.browserViews[view.ID].workspace
	targets := slices.Clone(workspace.targets)
	pinned := len(targets) == 2 && workspace.pinned[targets[0]]
	runtime.connectMu.Unlock()
	if len(targets) != 2 || view.InitialTarget != targets[1] || !pinned {
		t.Fatalf("saved tab order, selection or pin was lost: targets=%v view=%+v", targets, view)
	}
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		var tabs []browserstore.Tab
		if err := runtime.browserHost.call(ctx, "source.describe", map[string]any{"targets": targets}, &tabs); err != nil {
			t.Fatal(err)
		}
		if len(tabs) == 2 && tabs[0].URL == site.URL+"/first" && tabs[1].URL == site.URL+"/second" {
			break
		}
		select {
		case <-tick.C:
		case <-deadline.C:
			t.Fatalf("saved addresses were not restored: %+v", tabs)
		}
	}
	other, err := runtime.OpenBrowserWorkspace(ctx, meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"})
	if err != nil || other.InitialTarget != view.InitialTarget {
		t.Fatalf("opening another view changed the restored source: %+v %v", other, err)
	}
	for _, id := range targets {
		control := runtime.controlForTarget(id)
		if control.threadID != "" || control.browser != nil {
			t.Fatal("saved tabs restored a controller")
		}
	}
	// Browser loss retires live identities but must not progressively erase the
	// durable snapshot as individual source-close events arrive.
	runtime.connectMu.Lock()
	runtime.managedProfiles["browser-main"].close()
	runtime.connectMu.Unlock()
	for {
		runtime.connectMu.Lock()
		retired := len(workspace.targets) == 0
		runtime.connectMu.Unlock()
		if retired {
			break
		}
		select {
		case <-tick.C:
		case <-ctx.Done():
			t.Fatal("stopped browser retained live source identities")
		}
	}
	saved, err := runtime.BrowserLibraryTabs(ctx, meta, "browser-main")
	if err != nil || len(saved) != 2 {
		t.Fatalf("browser loss erased recovery state: %+v %v", saved, err)
	}
	reopened, err := runtime.OpenBrowserWorkspace(ctx, meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"})
	if err != nil || slices.Contains(targets, reopened.InitialTarget) {
		t.Fatalf("stopped browser did not restore with fresh identities: %+v %v", reopened, err)
	}
}

func TestBrowserPrivateNavigationDoesNotEnterHistoryOrRestoration(t *testing.T) {
	runtime, meta := browserWorkspaceFixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "<title>Private source</title><h1>Private source</h1>")
	}))
	defer site.Close()
	view, err := runtime.OpenBrowserWorkspace(ctx, meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"})
	if err != nil {
		t.Fatal(err)
	}
	observation := observeBrowserFixture(t, ctx, runtime, meta, view)
	token, err := runtime.AcquireBrowserViewControl(ctx, meta, view.ID, view.InitialTarget, false, true)
	if err != nil {
		t.Fatal(err)
	}
	observation.send(1, view.InitialTarget, token, map[string]any{"kind": "navigate", "url": site.URL + "/private"})
	observation.ack(1)
	history, err := runtime.BrowserHistory(ctx, meta, "browser-main", "", 10)
	if err != nil || len(history) != 0 {
		t.Fatalf("private navigation entered history: %+v %v", history, err)
	}
	tabs, err := runtime.BrowserLibraryTabs(ctx, meta, "browser-main")
	if err != nil || len(tabs) != 1 || tabs[0].URL != "about:blank" || tabs[0].Title == "Private source" {
		t.Fatalf("private navigation replaced the recovery snapshot: %+v %v", tabs, err)
	}
}

type browserObservationFixture struct {
	t        *testing.T
	ctx      context.Context
	runtime  *ComputerUseRuntime
	meta     *session.Meta
	view     BrowserViewDescriptor
	messages chan map[string]any
	epoch    string
}

func observeBrowserFixture(t *testing.T, ctx context.Context, runtime *ComputerUseRuntime, meta *session.Meta, view BrowserViewDescriptor) *browserObservationFixture {
	t.Helper()
	body, err := runtime.OpenBrowserObservation(ctx, meta, view.ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = body.Close() })
	fixture := &browserObservationFixture{t: t, ctx: ctx, runtime: runtime, meta: meta, view: view, messages: make(chan map[string]any, 128)}
	go func() {
		defer close(fixture.messages)
		reader := bufio.NewScanner(body)
		reader.Buffer(make([]byte, 4096), 16<<20)
		for reader.Scan() {
			var message map[string]any
			if json.Unmarshal(reader.Bytes(), &message) != nil {
				return
			}
			select {
			case fixture.messages <- message:
			case <-ctx.Done():
				return
			}
		}
	}()
	fixture.wait(func(message map[string]any) bool {
		return message["type"] == "session_access" && message["editTabs"] == true
	})
	return fixture
}

func (fixture *browserObservationFixture) wait(predicate func(map[string]any) bool) map[string]any {
	fixture.t.Helper()
	for {
		select {
		case message, ok := <-fixture.messages:
			if !ok {
				fixture.t.Fatal("browser observation closed before its expected event")
			}
			if message["type"] == "snapshot" {
				fixture.epoch, _ = message["epoch"].(string)
			}
			if predicate(message) {
				return message
			}
		case <-fixture.ctx.Done():
			fixture.t.Fatal(fixture.ctx.Err())
		}
	}
}
func (fixture *browserObservationFixture) send(id int, target, token string, action map[string]any) {
	fixture.t.Helper()
	body, _ := json.Marshal(map[string]any{"type": "command", "id": id, "tab": target, "epoch": fixture.epoch, "action": action})
	if err := fixture.runtime.ReceiveBrowserView(fixture.ctx, fixture.meta, fixture.view.ID, token, body); err != nil {
		fixture.t.Fatal(err)
	}
}
func (fixture *browserObservationFixture) ack(id int) {
	fixture.t.Helper()
	message := fixture.wait(func(message map[string]any) bool { return message["type"] == "ack" && message["id"] == float64(id) })
	if message["ok"] != true {
		fixture.t.Fatalf("browser command failed: %v", message)
	}
}

func TestManagedBrowserPopupJoinsDirectoryWithoutChangingSelection(t *testing.T) {
	runtime, meta := browserWorkspaceFixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 8*time.Second)
	defer cancel()
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/popup" {
			_, _ = io.WriteString(w, `<title>Popup destination</title><h1>Popup page</h1>`)
			return
		}
		_, _ = io.WriteString(w, `<title>Opener</title><h1>Source page</h1><script>window.addEventListener('keydown',event=>{if(event.key==='Enter')window.open('/popup','_blank')})</script>`)
	}))
	defer site.Close()
	view, err := runtime.OpenBrowserWorkspace(ctx, meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"})
	if err != nil {
		t.Fatal(err)
	}
	first := observeBrowserFixture(t, ctx, runtime, meta, view)
	token, err := runtime.AcquireBrowserViewControl(ctx, meta, view.ID, view.InitialTarget, false, false)
	if err != nil {
		t.Fatal(err)
	}
	first.send(1, view.InitialTarget, token, map[string]any{"kind": "navigate", "url": site.URL})
	first.ack(1)
	first.send(2, view.InitialTarget, token, map[string]any{"kind": "key", "phase": "down", "key": "Enter", "code": "Enter", "modifiers": 0})
	first.ack(2)
	first.send(3, view.InitialTarget, token, map[string]any{"kind": "key", "phase": "up", "key": "Enter", "code": "Enter", "modifiers": 0})
	first.ack(3)
	tabs := first.wait(func(message map[string]any) bool {
		if message["type"] != "tabs" {
			return false
		}
		state := message["state"].(map[string]any)
		return len(state["tabs"].([]any)) == 2
	})["state"].(map[string]any)
	if tabs["active"] != view.InitialTarget {
		t.Fatal("popup stole current selection")
	}
	var popup string
	for _, item := range tabs["tabs"].([]any) {
		id := item.(map[string]any)["id"].(string)
		if id != view.InitialTarget {
			popup = id
		}
	}
	if popup == "" {
		t.Fatal("popup has no source identity")
	}
	first.send(4, view.InitialTarget, "", map[string]any{"kind": "tab_select", "tab": popup})
	first.ack(4)
	if _, err := runtime.AcquireBrowserViewControl(ctx, meta, view.ID, popup, false, false); err != nil {
		t.Fatal("admitted popup cannot be controlled", err)
	}
}

func TestBrowserDirectoryBeforeUnloadKeepsOtherWorkspaceCommandsUsable(t *testing.T) {
	runtime, meta := browserWorkspaceFixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `<html><body><h1>Protected tab</h1><script>window.addEventListener('keydown',()=>{window.onbeforeunload=()=>true})</script></body></html>`)
	}))
	defer site.Close()
	view, err := runtime.OpenBrowserWorkspace(ctx, meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"})
	if err != nil {
		t.Fatal(err)
	}
	first := observeBrowserFixture(t, ctx, runtime, meta, view)
	token, err := runtime.AcquireBrowserViewControl(ctx, meta, view.ID, view.InitialTarget, false, false)
	if err != nil {
		t.Fatal(err)
	}
	first.send(1, view.InitialTarget, token, map[string]any{"kind": "navigate", "url": site.URL})
	first.ack(1)
	first.send(2, view.InitialTarget, token, map[string]any{"kind": "key", "phase": "down", "key": "Enter", "code": "Enter", "modifiers": 0})
	first.ack(2)
	first.send(3, view.InitialTarget, token, map[string]any{"kind": "key", "phase": "up", "key": "Enter", "code": "Enter", "modifiers": 0})
	first.ack(3)
	first.send(4, view.InitialTarget, "", map[string]any{"kind": "tab_close", "tab": view.InitialTarget})
	decision := first.wait(func(message map[string]any) bool { return message["type"] == "dialog" && message["dialog"] != nil })["dialog"].(map[string]any)
	if decision["authority"] != "directory" {
		t.Fatal("close decision acquired page input authority")
	}
	// A human decision cannot monopolize the Runtime directory lock.
	otherContext, otherCancel := context.WithTimeout(ctx, 3*time.Second)
	other, err := runtime.OpenBrowserWorkspace(otherContext, meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"})
	otherCancel()
	if err != nil {
		t.Fatal("pending close blocked another workspace", err)
	}
	second := observeBrowserFixture(t, ctx, runtime, meta, other)
	second.send(1, other.InitialTarget, "", map[string]any{"kind": "tab_new"})
	second.ack(1)
	// Exceed the former private IPC deadline without expiring a user's decision.
	timer := time.NewTimer(31 * time.Second)
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	first.send(5, view.InitialTarget, "", map[string]any{"kind": "dialog_reply", "dialog": decision["id"], "accept": false})
	// Both operations may acknowledge in either order once the decision resolves.
	seen := map[float64]bool{}
	for len(seen) != 2 {
		message := first.wait(func(message map[string]any) bool {
			return message["type"] == "ack" && (message["id"] == float64(4) || message["id"] == float64(5))
		})
		if message["ok"] != true {
			t.Fatalf("close decision expired: %v", message)
		}
		seen[message["id"].(float64)] = true
	}
	if err := runtime.browserHost.call(ctx, "source.ready", map[string]string{"target": view.InitialTarget}, nil); err != nil {
		t.Fatal("canceling close lost the source", err)
	}
}

func TestPrivateBrowserPopupCannotLeakThroughOpeningAnotherWorkspace(t *testing.T) {
	runtime, meta := browserWorkspaceFixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 12*time.Second)
	defer cancel()
	popupRequested := make(chan struct{}, 1)
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/private-popup" {
			_, _ = io.WriteString(w, `<title>Private popup</title><h1>Private popup contents</h1>`)
			select {
			case popupRequested <- struct{}{}:
			default:
			}
			return
		}
		_, _ = io.WriteString(w, `<title>Private opener</title><script>window.addEventListener('keydown',event=>{if(event.key==='Enter')window.open('/private-popup','_blank')})</script>`)
	}))
	defer site.Close()
	view, err := runtime.OpenBrowserWorkspace(ctx, meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"})
	if err != nil {
		t.Fatal(err)
	}
	first := observeBrowserFixture(t, ctx, runtime, meta, view)
	token, err := runtime.AcquireBrowserViewControl(ctx, meta, view.ID, view.InitialTarget, false, true)
	if err != nil {
		t.Fatal(err)
	}
	first.send(1, view.InitialTarget, token, map[string]any{"kind": "navigate", "url": site.URL})
	first.ack(1)
	first.send(2, view.InitialTarget, token, map[string]any{"kind": "key", "phase": "down", "key": "Enter", "code": "Enter", "modifiers": 0})
	first.ack(2)
	first.send(3, view.InitialTarget, token, map[string]any{"kind": "key", "phase": "up", "key": "Enter", "code": "Enter", "modifiers": 0})
	first.ack(3)
	select {
	case <-popupRequested:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	privateTabs := first.wait(func(message map[string]any) bool {
		if message["type"] != "tabs" {
			return false
		}
		return len(message["state"].(map[string]any)["tabs"].([]any)) == 2
	})["state"].(map[string]any)
	if privateTabs["active"] != view.InitialTarget {
		t.Fatal("private popup stole source selection")
	}
	other, err := runtime.OpenBrowserWorkspace(ctx, meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"})
	if err != nil {
		t.Fatal(err)
	}
	second := observeBrowserFixture(t, ctx, runtime, meta, other)
	state := second.wait(func(message map[string]any) bool { return message["type"] == "tabs" })["state"].(map[string]any)
	for _, item := range state["tabs"].([]any) {
		tab := item.(map[string]any)
		if tab["url"] == site.URL+"/private-popup" || tab["title"] == "Private popup" {
			t.Fatal("another workspace observed the private popup")
		}
	}
	for _, inventory := range []func() ([]ComputerBrowserTab, error){
		func() ([]ComputerBrowserTab, error) { return runtime.ManagedBrowserTabs(ctx, meta, "browser-main") },
		func() ([]ComputerBrowserTab, error) {
			return runtime.BrowserTabs(ctx, runtime.managedProfiles["browser-main"].endpoint)
		},
	} {
		tabs, err := inventory()
		if err != nil || len(tabs) != 0 {
			t.Fatalf("public inventory exposed private pages: %v %v", len(tabs), err)
		}
	}
	var closed bool
	if err := runtime.browserHost.call(ctx, "source.close", map[string]string{"target": view.InitialTarget}, &closed); err != nil || !closed {
		t.Fatalf("close private opener: %v %v", closed, err)
	}
	public, err := runtime.candidateBrowserTabs(ctx, ComputerBrowserConnection{ManagedProfileID: "browser-main"})
	if err != nil {
		t.Fatal(err)
	}
	if len(public) != 0 {
		t.Fatal("closed private opener exposed its descendants through AI inventory")
	}
	if err := runtime.ReleaseBrowserViewControl(ctx, meta, view.ID, token); err != nil {
		t.Fatal(err)
	}
	public, err = runtime.candidateBrowserTabs(ctx, ComputerBrowserConnection{ManagedProfileID: "browser-main"})
	if err != nil || len(public) != 1 || public[0].URL != site.URL+"/private-popup" {
		t.Fatalf("explicit private handback did not release descendant visibility: %v %v", len(public), err)
	}

}
