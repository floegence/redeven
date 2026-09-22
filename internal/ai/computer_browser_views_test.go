package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
)

func TestBrowserPreferencesBelongToObservationWithoutInputControl(t *testing.T) {
	runtime, meta, methods, mu := browserViewFixture(t)
	view, err := runtime.OpenBrowserView(t.Context(), meta, BrowserViewRequest{Targets: []string{"page"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := runtime.SetBrowserViewPreferences(t.Context(), meta, view.ID, false, true); err == nil {
		t.Fatal("an unopened view changed subscriptions")
	}
	observation, err := runtime.OpenBrowserObservation(t.Context(), meta, view.ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = observation.Close() })
	other := *meta
	other.ChannelID = "other"
	if err := runtime.SetBrowserViewPreferences(t.Context(), &other, view.ID, false, true); err == nil {
		t.Fatal("another channel changed observation")
	}
	if err := runtime.SetBrowserViewPreferences(t.Context(), meta, view.ID, false, true); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if !slices.Contains(*methods, "view.visible") || !slices.Contains(*methods, "view.audio") || slices.Contains(*methods, "view.acquire") {
		t.Fatalf("observation preferences acquired input: %v", *methods)
	}
}

func browserViewFixture(t *testing.T) (*ComputerUseRuntime, *session.Meta, *[]string, *sync.Mutex) {
	t.Helper()
	var mu sync.Mutex
	var methods []string
	host, _ := browserHostFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/media" {
			w.WriteHeader(http.StatusOK)
			w.(http.Flusher).Flush()
			for {
				if _, err := w.Write(make([]byte, 32768)); err != nil {
					return
				}
				w.(http.Flusher).Flush()
			}
		}
		if r.URL.Path == "/observe" {
			w.Header().Set("Content-Type", "application/x-ndjson")
			w.WriteHeader(http.StatusOK)
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			return
		}
		var request struct{ ID, Method string }
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		mu.Lock()
		methods = append(methods, request.Method)
		mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"id": request.ID, "result": true})
	})
	executor := NewPlaywrightTargetExecutor("/fixture/node", "/fixture/helper", t.TempDir())
	executor.sourceHost = host
	runtime := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"page": executor}, t.TempDir())
	runtime.browserHost = host
	t.Cleanup(func() { _ = runtime.Close() })
	return runtime, &session.Meta{ChannelID: "channel", UserPublicID: "user", EndpointID: "environment", CanRead: true, CanWrite: true, CanExecute: true}, &methods, &mu
}

func TestBrowserViewIdentityAndExplicitSourceGrants(t *testing.T) {
	runtime, meta, methods, mu := browserViewFixture(t)
	if _, err := runtime.OpenBrowserView(t.Context(), meta, BrowserViewRequest{Targets: []string{"unregistered"}}); err == nil {
		t.Fatal("unregistered source was granted")
	}
	view, err := runtime.OpenBrowserView(t.Context(), meta, BrowserViewRequest{Targets: []string{"page"}, InitialTarget: "page"})
	if err != nil {
		t.Fatal(err)
	}
	for _, identity := range []string{"channel", "user", "environment", "permissions"} {
		other := *meta
		switch identity {
		case "channel":
			other.ChannelID = "another"
		case "user":
			other.UserPublicID = "another"
		case "environment":
			other.EndpointID = "another"
		default:
			other.CanExecute = false
		}
		if _, err := runtime.browserView(&other, view.ID); err == nil {
			t.Fatalf("%s change retained view authority", identity)
		}
		if err := runtime.CloseBrowserView(t.Context(), &other, view.ID); err == nil {
			t.Fatalf("%s could close another view", identity)
		}
	}
	if _, err := runtime.AcquireBrowserViewControl(t.Context(), meta, view.ID, "another", false, false); err == nil {
		t.Fatal("view acquired an ungranted source")
	}
	mu.Lock()
	for _, method := range *methods {
		if method == "view.acquire" {
			t.Error("rejected target reached the source controller")
		}
	}
	mu.Unlock()
	if err := runtime.CloseBrowserView(t.Context(), meta, view.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.browserView(meta, view.ID); err == nil {
		t.Fatal("closed view remained authorized")
	}
}

func TestBrowserViewLeaseFencesAIAndChannelDisconnect(t *testing.T) {
	runtime, meta, _, _ := browserViewFixture(t)
	view, err := runtime.OpenBrowserView(t.Context(), meta, BrowserViewRequest{Targets: []string{"page"}, InitialTarget: "page"})
	if err != nil {
		t.Fatal(err)
	}
	observation, err := runtime.OpenBrowserObservation(t.Context(), meta, view.ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = observation.Close() })
	token, err := runtime.AcquireBrowserViewControl(t.Context(), meta, view.ID, "page", false, true)
	if err != nil || token == "" {
		t.Fatalf("acquire private control: %q %v", token, err)
	}
	if _, _, err := runtime.acquireComputerControl(t.Context(), TargetToolCall{TargetID: "page"}); err == nil {
		t.Fatal("AI bypassed user control")
	}
	if runtime.controlForTarget("page").browserObservationPermitted("another-view") {
		t.Fatal("private view exposed its target")
	}
	if err := runtime.ReceiveBrowserView(t.Context(), meta, view.ID, "stale", json.RawMessage(`{"type":"command","tab":"page","action":{"kind":"click"}}`)); err == nil {
		t.Fatal("stale control token reached the source")
	}
	if err := runtime.ReleaseBrowserViewControl(t.Context(), meta, view.ID, "stale"); err == nil {
		t.Fatal("stale token released current control")
	}
	runtime.CloseBrowserChannel(meta)
	if _, err := runtime.browserView(meta, view.ID); err == nil {
		t.Fatal("disconnected channel retained view authority")
	}
	control, unlock, err := runtime.acquireComputerControl(context.Background(), TargetToolCall{TargetID: "page"})
	if err != nil {
		t.Fatal(err)
	}
	unlock()
	if !control.browserObservationPermitted("another-view") {
		t.Fatal("successful input drain retained obsolete privacy")
	}
}

func TestBrowserDirectoryDecisionDoesNotNeedOrWaitForPageInput(t *testing.T) {
	runtime, meta, methods, mu := browserViewFixture(t)
	descriptor, err := runtime.OpenBrowserView(t.Context(), meta, BrowserViewRequest{Targets: []string{"page"}})
	if err != nil {
		t.Fatal(err)
	}
	observation, err := runtime.OpenBrowserObservation(t.Context(), meta, descriptor.ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = observation.Close() })
	if _, err := runtime.AcquireBrowserViewControl(t.Context(), meta, descriptor.ID, "page", false, false); err != nil {
		t.Fatal(err)
	}
	// A source close owns the existing target gate while awaiting beforeunload.
	// Its exact directory decision is admitted by the SDK's separate authority.
	gate := runtime.controlForTarget("page").gate
	gate <- struct{}{}
	defer func() { <-gate }()
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	err = runtime.ReceiveBrowserView(ctx, meta, descriptor.ID, "", json.RawMessage(`{"type":"command","id":1,"tab":"page","epoch":"","action":{"kind":"dialog_reply","dialog":"pending-close","accept":false}}`))
	if err != nil {
		t.Fatal("directory decision was blocked by page input", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if !slices.Contains(*methods, "view.directory_decision") {
		t.Fatal("decision bypassed the source's exact authority")
	}
}

func TestBrowserObservationRegistrationAndDirectoryChangesKeepCurrentGrants(t *testing.T) {
	entered, proceed := make(chan struct{}), make(chan struct{})
	var ready atomic.Bool
	host, _ := browserHostFixture(t, func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/observe" {
			close(entered)
			select {
			case <-proceed:
			case <-request.Context().Done():
				return
			}
			ready.Store(true)
			w.WriteHeader(http.StatusOK)
			w.(http.Flusher).Flush()
			<-request.Context().Done()
			return
		}
		var command struct{ ID, Method string }
		if err := json.NewDecoder(request.Body).Decode(&command); err != nil {
			t.Error(err)
			return
		}
		response := map[string]any{"id": command.ID, "result": true}
		if command.Method == "view.grants" && !ready.Load() {
			response = map[string]any{"id": command.ID, "error": "BROWSER_VIEW_UNAVAILABLE"}
		}
		_ = json.NewEncoder(w).Encode(response)
	})
	executor := NewPlaywrightTargetExecutor("/fixture/node", "/fixture/helper", t.TempDir())
	executor.sourceHost = host
	runtime := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"page": executor}, t.TempDir())
	runtime.browserHost = host
	t.Cleanup(func() { _ = runtime.Close() })
	meta := &session.Meta{ChannelID: "channel", UserPublicID: "user", EndpointID: "environment", CanRead: true, CanWrite: true, CanExecute: true}
	workspace := &browserWorkspace{owner: browserLibraryOwner(meta), targets: []string{"page"}, pinned: make(map[string]bool)}
	view, err := runtime.OpenBrowserView(t.Context(), meta, BrowserViewRequest{Targets: []string{"page"}, workspace: workspace})
	if err != nil {
		t.Fatal(err)
	}
	observed := make(chan error, 1)
	go func() {
		body, err := runtime.OpenBrowserObservation(t.Context(), meta, view.ID)
		if err == nil {
			t.Cleanup(func() { _ = body.Close() })
		}
		observed <- err
	}()
	<-entered
	// The fixture delays source registration; a concurrent directory update
	// must preserve its grants instead of addressing a view that is not open.
	timer := time.AfterFunc(100*time.Millisecond, func() { close(proceed) })
	defer timer.Stop()
	runtime.connectMu.Lock()
	err = runtime.refreshBrowserWorkspace(t.Context(), workspace)
	runtime.connectMu.Unlock()
	if observedError := <-observed; observedError != nil {
		t.Fatal(observedError)
	}
	if err != nil {
		t.Fatal("directory update raced observation registration", err)
	}
}

func TestBrowserExtensionViewRequiresTheCurrentSharedSourceOwner(t *testing.T) {
	runtime, meta, _, _ := browserViewFixture(t)
	runtime.executors["extension"] = &extensionTargetExecutor{targetID: "extension", sourceHost: runtime.browserHost}
	view, err := runtime.OpenBrowserView(t.Context(), meta, BrowserViewRequest{Targets: []string{"extension"}})
	if err != nil {
		t.Fatal(err)
	}
	if view.InitialTarget != "extension" || view.ProfileID != "" {
		t.Fatalf("extension view changed source scope: %+v", view)
	}
	runtime.executors["extension"] = &extensionTargetExecutor{targetID: "extension"}
	if _, err = runtime.OpenBrowserView(t.Context(), meta, BrowserViewRequest{Targets: []string{"extension"}}); err == nil {
		t.Fatal("a disconnected extension acquired a view")
	}
}
