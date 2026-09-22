package ai

import (
	"slices"
	"testing"
)

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
