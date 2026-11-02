package ai

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/session"
)

func TestManagedBrowserTabQueryDoesNotLaunch(t *testing.T) {
	root := t.TempDir()
	host := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"browser-main": NewPlaywrightTargetExecutor("/bin/sh", filepath.Join(root, "helper.mjs"), filepath.Join(root, "profiles"))}, root)
	t.Cleanup(func() { _ = host.Close() })
	tabs, err := host.ManagedBrowserTabs(t.Context(), &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}, "browser-main")
	if err != nil || len(tabs) != 0 {
		t.Fatalf("stopped profile query: %v %v", tabs, err)
	}
	if len(host.managedProfiles) != 0 {
		t.Fatal("query created a browser owner")
	}
}

func TestManagedBrowserRetirementSerializesControl(t *testing.T) {
	for _, scenario := range []string{"action", "task", "private", "viewer", "free"} {
		t.Run(scenario, func(t *testing.T) {
			e := NewPlaywrightTargetExecutor("/bin/sh", "/helper", t.TempDir())
			e.ManagedAttachment, e.CDPURL = true, "http://127.0.0.1:1234"
			host := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"tab": e}, t.TempDir())
			t.Cleanup(func() { _ = host.Close() })
			p := &managedBrowserProfile{endpoint: e.CDPURL, done: make(chan struct{})}
			c := host.controlForTarget("tab")
			switch scenario {
			case "action":
				c.gate <- struct{}{}
			case "task":
				c.threadID = "busy"
			case "private":
				c.browser = &browserTargetLease{}
			case "viewer":
				host.liveFrames = map[string]*computerLiveSampler{"observer": {request: ComputerViewerRequest{TargetID: "tab"}, cancel: func() {}}}
			}
			host.connectMu.Lock()
			retired := host.reserveManagedProfileLocked(p, true)
			host.connectMu.Unlock()
			if retired != (scenario == "free") || e.closed != retired {
				t.Fatal("retirement crossed a control boundary")
			}
			if scenario == "action" {
				<-c.gate
			}
			if retired {
				_, release, err := host.acquireComputerControl(t.Context(), TargetToolCall{TargetID: "tab", ThreadID: "next"})
				if release != nil {
					release()
				}
				if err == nil || c.threadID != "" {
					t.Fatal("queued task acquired a stopped profile")
				}
			}
			c.browser = nil
			host.liveFrames = nil
		})
	}
}
func TestManagedBrowserLifecycleRejectsInvalidAuthorityAndCancellation(t *testing.T) {
	host, _ := runtimeFixture(t)
	for _, meta := range []*session.Meta{nil, {CanRead: true, CanWrite: true}, {CanRead: true, CanExecute: true}, {CanWrite: true, CanExecute: true}} {
		if _, err := host.ManageBrowserProfile(t.Context(), meta, "browser-main", "start"); err == nil {
			t.Fatal("accepted missing authority")
		}
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := host.ManageBrowserProfile(ctx, &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}, "browser-main", "stop"); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation: %v", err)
	}
	if len(host.managedProfiles) != 0 {
		t.Fatal("rejected requests launched a browser")
	}
}
