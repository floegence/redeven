package ai

import (
	"slices"
	"testing"
)

func TestBrowserLastSourceLossRetiresViewAuthority(t *testing.T) {
	runtime, meta, _, _ := browserViewFixture(t)
	descriptor, err := runtime.OpenBrowserView(t.Context(), meta, BrowserViewRequest{Targets: []string{"page"}})
	if err != nil {
		t.Fatal(err)
	}
	view := runtime.browserViews[descriptor.ID]
	runtime.browserSourceEvent(browserHostEvent{Type: "source_closed", Target: "page"})
	if view.ctx.Err() == nil || runtime.AuthorizeBrowserView(meta, descriptor.ID) == nil {
		t.Fatal("last source loss left an authorized, indefinitely loading view")
	}
}

func TestBrowserSourceCloseRemovesGrantsAfterNativeRetirement(t *testing.T) {
	runtime := NewComputerUseRuntime(NewTargetRegistry(), nil, t.TempDir())
	runtime.browserHost = &browserSourceHost{ctx: t.Context()}
	workspace := &browserWorkspace{targets: []string{"retired", "healthy"}, pinned: map[string]bool{"retired": true}}
	runtime.browserWorkspaces = map[string]*browserWorkspace{"external": workspace}
	view := &browserView{targets: []string{"retired", "healthy"}, workspace: workspace}
	runtime.browserViews = map[string]*browserView{"view": view}
	// Native retirement has already revoked execution. The source host's
	// later close notification must still remove observation/directory grants.
	runtime.browserSourceEvent(browserHostEvent{Type: "source_closed", Target: "retired"})
	if !slices.Equal(workspace.targets, []string{"healthy"}) || view.permits("retired") || workspace.pinned["retired"] {
		t.Fatal("native retirement left a closed target in workspace grants")
	}
	if !view.permits("healthy") {
		t.Fatal("native retirement removed its healthy peer")
	}
}
