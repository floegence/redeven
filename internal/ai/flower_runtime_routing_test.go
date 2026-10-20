package ai

import (
	"context"
	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"path/filepath"
	"testing"
)

func thinkingCurrent(version uint64, text string, live bool, activity flruntime.ThreadActivity) flruntime.ThreadView {
	return flruntime.ThreadView{
		ThreadID:    identity.ThreadID("thread-thinking"),
		ViewVersion: version,
		Activity:    activity,
		TurnID:      identity.TurnID("turn-thinking"),
		RunID:       identity.RunID("run-thinking"),
		Items: []flruntime.ThreadItem{{
			ID: "thinking-1", TurnID: identity.TurnID("turn-thinking"), RunID: identity.RunID("run-thinking"), Ordinal: 2,
			Kind: flruntime.ThreadItemThinking, Text: text, Live: live,
		}},
	}
}

func TestResolveFlowerRuntimeRouteLoadsImmutableRootRouteOnce(t *testing.T) {
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("open thread store: %v", err)
	}
	if err := store.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{
		ThreadID: "thread-route", EndpointID: "env-route", PermissionType: "approval_required",
	}); err != nil {
		t.Fatalf("create thread settings: %v", err)
	}
	service := &Service{
		threadsDB:                     store,
		flowerRuntimeEndpointByThread: make(map[string]string),
	}
	endpointID, parentThreadID, err := service.resolveFlowerRuntimeRoute(context.Background(), "thread-route")
	if err != nil || endpointID != "env-route" || parentThreadID != "" {
		t.Fatalf("initial route resolution = (%q, %q), %v", endpointID, parentThreadID, err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close thread store: %v", err)
	}
	endpointID, parentThreadID, err = service.resolveFlowerRuntimeRoute(context.Background(), "thread-route")
	if err != nil || endpointID != "env-route" || parentThreadID != "" {
		t.Fatalf("cached route resolution = (%q, %q), %v", endpointID, parentThreadID, err)
	}
	if err := service.rememberFlowerRuntimeEndpoint("thread-route", "env-other"); err != errFlowerRuntimeEndpointConflict {
		t.Fatalf("conflicting endpoint error = %v, want %v", err, errFlowerRuntimeEndpointConflict)
	}
	service.forgetFlowerRuntimeThread("thread-route")
	if _, _, err := service.resolveFlowerRuntimeRoute(context.Background(), "thread-route"); err == nil {
		t.Fatal("route resolved after removal with closed store")
	}
}

func TestResolveFlowerRuntimeRouteLoadsPersistedParentIdentity(t *testing.T) {
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{
		ThreadID: "thread-child-route", ParentThreadID: "thread-parent-route", EndpointID: "env-route",
		PermissionType: "approval_required",
	}); err != nil {
		t.Fatal(err)
	}
	service := &Service{
		threadsDB: store, flowerRuntimeEndpointByThread: make(map[string]string),
		flowerRuntimeParentByThread: make(map[string]string), flowerRuntimeRouteKnown: make(map[string]bool),
	}
	endpointID, parentThreadID, err := service.resolveFlowerRuntimeRoute(context.Background(), "thread-child-route")
	if err != nil || endpointID != "env-route" || parentThreadID != "thread-parent-route" {
		t.Fatalf("resolved route=(%q,%q,%v)", endpointID, parentThreadID, err)
	}
}
