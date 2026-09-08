package workbenchlayout

import (
	"context"
	"encoding/json"
	"reflect"
	"sync"
	"testing"
)

func pluginPlacement(instance, surface string) OpenPluginRequest {
	return OpenPluginRequest{
		State:    WidgetStateData{Kind: WidgetStateKindPlugin, PluginID: "example.plugin", PluginInstanceID: instance, SurfaceID: surface, DisplayName: "Example", ExpectedManagementRevision: 1},
		Viewport: OpenPreviewViewportHint{CenterX: float64Ptr(600), CenterY: float64Ptr(400), DefaultWidth: 1120, DefaultHeight: 760},
	}
}

func TestPluginPlacementIsAtomicAndPreservesExistingGeometry(t *testing.T) {
	svc := openTestService(t)
	ctx := context.Background()
	req := pluginPlacement("instance-one", "main")
	created, err := svc.OpenPlugin(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	if !created.Created || len(created.Snapshot.Widgets) != 1 || len(created.Snapshot.WidgetStates) != 1 {
		t.Fatalf("incomplete placement: %#v", created)
	}
	geometry := created.Snapshot.Widgets[0]
	geometry.X, geometry.Y, geometry.Width, geometry.Height = -450, 123, 1300, 900
	_, err = svc.Replace(ctx, PutLayoutRequest{BaseRevision: created.Snapshot.Revision, Widgets: []WidgetLayout{geometry}})
	if err != nil {
		t.Fatal(err)
	}
	req.State.ExpectedManagementRevision = 2
	req.Viewport.CenterX = float64Ptr(10000)
	updated, err := svc.OpenPlugin(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Created || updated.WidgetID != created.WidgetID || !reflect.DeepEqual(updated.Snapshot.Widgets[0], geometry) {
		t.Fatalf("refresh changed placement: %#v", updated)
	}
	if updated.WidgetState.State.ExpectedManagementRevision != 2 {
		t.Fatal("revision was not refreshed")
	}
	repeated, err := svc.OpenPlugin(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	if repeated.Snapshot.Seq != updated.Snapshot.Seq {
		t.Fatal("idempotent retry changed snapshot")
	}
	baseline, _, err := svc.Subscribe(ctx, 0)
	if err != nil {
		t.Fatal(err)
	}
	var first Snapshot
	if err := json.Unmarshal(baseline[0].Payload, &first); err != nil {
		t.Fatal(err)
	}
	if len(first.Widgets) != 1 || len(first.WidgetStates) != 1 {
		t.Fatal("published a partially created plugin")
	}
}

func TestPluginPlacementConcurrentRequestsReuseOneWidget(t *testing.T) {
	svc := openTestService(t)
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			if _, err := svc.OpenPlugin(context.Background(), pluginPlacement("same", "main")); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	snapshot, err := svc.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Widgets) != 1 || len(snapshot.WidgetStates) != 1 {
		t.Fatalf("duplicated target: %#v", snapshot)
	}
}

func TestRemovePluginWidgetsRemovesOnlyExactInstanceAndPublishes(t *testing.T) {
	svc := openTestService(t)
	ctx := context.Background()
	for _, target := range [][2]string{{"one", "main"}, {"one", "details"}, {"two", "main"}} {
		if _, err := svc.OpenPlugin(ctx, pluginPlacement(target[0], target[1])); err != nil {
			t.Fatal(err)
		}
	}
	removed, err := svc.RemovePluginWidgets(ctx, "one")
	if err != nil {
		t.Fatal(err)
	}
	if len(removed.Widgets) != 1 || len(removed.WidgetStates) != 1 || removed.WidgetStates[0].State.PluginInstanceID != "two" {
		t.Fatalf("wrong removal: %#v", removed)
	}
	repeated, err := svc.RemovePluginWidgets(ctx, "one")
	if err != nil {
		t.Fatal(err)
	}
	if repeated.Seq != removed.Seq {
		t.Fatal("repeat cleanup changed layout")
	}
}

func TestPluginPlacementRollsBackOnStateWriteFailure(t *testing.T) {
	svc := openTestService(t)
	_, err := svc.store.db.Exec(`CREATE TRIGGER reject_plugin_state BEFORE INSERT ON workbench_widget_states BEGIN SELECT RAISE(ABORT, 'state write rejected'); END`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.OpenPlugin(context.Background(), pluginPlacement("one", "main")); err == nil {
		t.Fatal("expected transaction failure")
	}
	snapshot, err := svc.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Widgets) != 0 || len(snapshot.WidgetStates) != 0 || snapshot.Revision != 0 {
		t.Fatalf("partial transaction survived: %#v", snapshot)
	}
}

func TestPluginBindingRefreshCannotRetargetOrDowngrade(t *testing.T) {
	svc := openTestService(t)
	ctx := context.Background()
	placed, err := svc.OpenPlugin(ctx, pluginPlacement("instance-one", "secondary"))
	if err != nil {
		t.Fatal(err)
	}
	state := placed.WidgetState.State
	state.ExpectedManagementRevision = 2
	state.DisplayName = "New name"
	updated, err := svc.PutWidgetState(ctx, placed.WidgetID, PutWidgetStateRequest{BaseRevision: 1, WidgetType: WidgetTypePlugin, State: state})
	if err != nil {
		t.Fatal(err)
	}
	if updated.State.DisplayName != "New name" || updated.State.ExpectedManagementRevision != 2 || updated.Revision != 2 {
		t.Fatalf("refresh lost fields: %#v", updated)
	}
	state.ExpectedManagementRevision = 1
	stale, err := svc.PutWidgetState(ctx, placed.WidgetID, PutWidgetStateRequest{BaseRevision: 2, WidgetType: WidgetTypePlugin, State: state})
	if err != nil || stale.State.ExpectedManagementRevision != 2 {
		t.Fatalf("stale refresh downgraded binding: %#v %v", stale, err)
	}
	state.SurfaceID = "replacement"
	if _, err := svc.PutWidgetState(ctx, placed.WidgetID, PutWidgetStateRequest{BaseRevision: 2, WidgetType: WidgetTypePlugin, State: state}); err == nil {
		t.Fatal("retargeted a placed widget")
	}
}
