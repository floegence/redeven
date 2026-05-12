package workbenchlayout

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func openTestService(t *testing.T) *Service {
	t.Helper()

	svc, err := Open(filepath.Join(t.TempDir(), "layout.sqlite"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() {
		if err := svc.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}
	})
	return svc
}

func sampleWidgets() []WidgetLayout {
	return []WidgetLayout{
		{
			WidgetID:        "widget-files-1",
			WidgetType:      "redeven.files",
			X:               120,
			Y:               80,
			Width:           760,
			Height:          560,
			ZIndex:          1,
			CreatedAtUnixMs: 1_700_000_000_000,
		},
		{
			WidgetID:        "widget-terminal-1",
			WidgetType:      "redeven.terminal",
			X:               420,
			Y:               160,
			Width:           840,
			Height:          500,
			ZIndex:          2,
			CreatedAtUnixMs: 1_700_000_000_100,
		},
	}
}

func sampleLayeredLayoutRequest() PutLayoutRequest {
	return PutLayoutRequest{
		BaseRevision: 0,
		Widgets:      sampleWidgets(),
		StickyNotes: []StickyNote{
			{
				ID:              "sticky-2",
				Kind:            StickyNoteKind,
				Body:            "Later note",
				Color:           "rose",
				X:               40,
				Y:               50,
				Width:           260,
				Height:          184,
				ZIndex:          4,
				CreatedAtUnixMs: 1_700_000_000_500,
				UpdatedAtUnixMs: 1_700_000_000_600,
			},
			{
				ID:              "sticky-1",
				Body:            "First note",
				Color:           "sage",
				X:               20,
				Y:               30,
				Width:           280,
				Height:          190,
				ZIndex:          3,
				CreatedAtUnixMs: 1_700_000_000_400,
				UpdatedAtUnixMs: 1_700_000_000_450,
			},
		},
		Annotations: []TextAnnotation{
			{
				ID:              "text-1",
				Kind:            TextAnnotationKind,
				Text:            "Investigate this area",
				FontFamily:      DefaultAnnotationFontFamily,
				FontSize:        34,
				FontWeight:      760,
				Color:           "#64748b",
				Align:           "center",
				X:               320,
				Y:               120,
				Width:           360,
				Height:          96,
				ZIndex:          7,
				CreatedAtUnixMs: 1_700_000_000_700,
				UpdatedAtUnixMs: 1_700_000_000_800,
			},
		},
		BackgroundLayers: []BackgroundLayer{
			{
				ID:              "region-1",
				Name:            "Focus area",
				Fill:            "#8fa1aa",
				Opacity:         0.42,
				Material:        "grid",
				X:               -120,
				Y:               -80,
				Width:           640,
				Height:          360,
				ZIndex:          1,
				CreatedAtUnixMs: 1_700_000_000_300,
				UpdatedAtUnixMs: 1_700_000_000_350,
			},
		},
	}
}

func intPtr(value int) *int {
	return &value
}

func int64Ptr(value int64) *int64 {
	return &value
}

func float64Ptr(value float64) *float64 {
	return &value
}

func mathNaN() float64 {
	return math.NaN()
}

func TestServiceSnapshotStartsEmpty(t *testing.T) {
	t.Parallel()

	svc := openTestService(t)

	snapshot, err := svc.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("Snapshot() error = %v", err)
	}
	if snapshot.Revision != 0 || snapshot.Seq != 0 {
		t.Fatalf("snapshot revision/seq = %d/%d, want 0/0", snapshot.Revision, snapshot.Seq)
	}
	if len(snapshot.Widgets) != 0 {
		t.Fatalf("snapshot widgets = %#v, want empty", snapshot.Widgets)
	}
	if len(snapshot.WidgetStates) != 0 {
		t.Fatalf("snapshot widget states = %#v, want empty", snapshot.WidgetStates)
	}
	if len(snapshot.StickyNotes) != 0 || len(snapshot.Annotations) != 0 || len(snapshot.BackgroundLayers) != 0 {
		t.Fatalf("snapshot layered objects = %#v/%#v/%#v, want empty", snapshot.StickyNotes, snapshot.Annotations, snapshot.BackgroundLayers)
	}
}

func TestServiceReplaceWritesSnapshotAndEvent(t *testing.T) {
	t.Parallel()

	svc := openTestService(t)
	ctx := context.Background()

	nextSnapshot, err := svc.Replace(ctx, PutLayoutRequest{
		BaseRevision: 0,
		Widgets:      sampleWidgets(),
	})
	if err != nil {
		t.Fatalf("Replace() error = %v", err)
	}
	if nextSnapshot.Revision != 1 {
		t.Fatalf("snapshot revision = %d, want 1", nextSnapshot.Revision)
	}
	if nextSnapshot.Seq != 1 {
		t.Fatalf("snapshot seq = %d, want 1", nextSnapshot.Seq)
	}
	if len(nextSnapshot.Widgets) != 2 {
		t.Fatalf("snapshot widgets = %#v, want 2 widgets", nextSnapshot.Widgets)
	}
	if len(nextSnapshot.WidgetStates) != 0 {
		t.Fatalf("snapshot widget states = %#v, want empty", nextSnapshot.WidgetStates)
	}

	persisted, err := svc.Snapshot(ctx)
	if err != nil {
		t.Fatalf("Snapshot() error = %v", err)
	}
	if !reflect.DeepEqual(persisted, nextSnapshot) {
		t.Fatalf("persisted snapshot = %#v, want %#v", persisted, nextSnapshot)
	}

	baseline, ch, err := svc.Subscribe(ctx, 0)
	if err != nil {
		t.Fatalf("Subscribe() error = %v", err)
	}
	if len(baseline) != 1 {
		t.Fatalf("baseline len = %d, want 1", len(baseline))
	}
	if baseline[0].Type != EventTypeLayoutReplaced {
		t.Fatalf("baseline type = %q, want %q", baseline[0].Type, EventTypeLayoutReplaced)
	}
	var payload Snapshot
	if err := json.Unmarshal(baseline[0].Payload, &payload); err != nil {
		t.Fatalf("json.Unmarshal(payload) error = %v", err)
	}
	if !reflect.DeepEqual(payload, nextSnapshot) {
		t.Fatalf("event payload = %#v, want %#v", payload, nextSnapshot)
	}
	select {
	case <-ch:
		t.Fatal("unexpected live event after baseline replay")
	default:
	}
}

func TestServiceReplaceWritesLayeredObjectsAndEventPayload(t *testing.T) {
	t.Parallel()

	svc := openTestService(t)
	ctx := context.Background()

	req := sampleLayeredLayoutRequest()
	nextSnapshot, err := svc.Replace(ctx, req)
	if err != nil {
		t.Fatalf("Replace() error = %v", err)
	}
	if nextSnapshot.Revision != 1 || nextSnapshot.Seq != 1 {
		t.Fatalf("snapshot revision/seq = %d/%d, want 1/1", nextSnapshot.Revision, nextSnapshot.Seq)
	}
	if len(nextSnapshot.StickyNotes) != 2 || nextSnapshot.StickyNotes[0].ID != "sticky-1" || nextSnapshot.StickyNotes[0].Kind != StickyNoteKind {
		t.Fatalf("sticky notes = %#v, want sorted notes with kind", nextSnapshot.StickyNotes)
	}
	if len(nextSnapshot.Annotations) != 1 || nextSnapshot.Annotations[0].Kind != TextAnnotationKind || nextSnapshot.Annotations[0].Align != "center" {
		t.Fatalf("annotations = %#v, want text annotation", nextSnapshot.Annotations)
	}
	if len(nextSnapshot.BackgroundLayers) != 1 || nextSnapshot.BackgroundLayers[0].Material != "grid" || nextSnapshot.BackgroundLayers[0].Opacity != 0.42 {
		t.Fatalf("background layers = %#v, want grid layer", nextSnapshot.BackgroundLayers)
	}

	persisted, err := svc.Snapshot(ctx)
	if err != nil {
		t.Fatalf("Snapshot() error = %v", err)
	}
	if !reflect.DeepEqual(persisted, nextSnapshot) {
		t.Fatalf("persisted snapshot = %#v, want %#v", persisted, nextSnapshot)
	}

	baseline, _, err := svc.Subscribe(ctx, 0)
	if err != nil {
		t.Fatalf("Subscribe() error = %v", err)
	}
	if len(baseline) != 1 {
		t.Fatalf("baseline len = %d, want 1", len(baseline))
	}
	var payload Snapshot
	if err := json.Unmarshal(baseline[0].Payload, &payload); err != nil {
		t.Fatalf("json.Unmarshal(payload) error = %v", err)
	}
	if !reflect.DeepEqual(payload, nextSnapshot) {
		t.Fatalf("event payload = %#v, want %#v", payload, nextSnapshot)
	}
}

func TestServiceSubscribeReceivesNewEvent(t *testing.T) {
	t.Parallel()

	svc := openTestService(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	baseline, ch, err := svc.Subscribe(ctx, 0)
	if err != nil {
		t.Fatalf("Subscribe() error = %v", err)
	}
	if len(baseline) != 0 {
		t.Fatalf("baseline = %#v, want empty", baseline)
	}

	done := make(chan Event, 1)
	go func() {
		select {
		case event := <-ch:
			done <- event
		case <-time.After(2 * time.Second):
		}
	}()

	nextSnapshot, err := svc.Replace(context.Background(), PutLayoutRequest{
		BaseRevision: 0,
		Widgets:      sampleWidgets(),
	})
	if err != nil {
		t.Fatalf("Replace() error = %v", err)
	}

	select {
	case event := <-done:
		if event.Seq != nextSnapshot.Seq {
			t.Fatalf("event seq = %d, want %d", event.Seq, nextSnapshot.Seq)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for live event")
	}
}

func TestServiceReplaceRejectsRevisionConflict(t *testing.T) {
	t.Parallel()

	svc := openTestService(t)
	ctx := context.Background()

	if _, err := svc.Replace(ctx, PutLayoutRequest{
		BaseRevision: 0,
		Widgets:      sampleWidgets(),
	}); err != nil {
		t.Fatalf("first Replace() error = %v", err)
	}

	_, err := svc.Replace(ctx, PutLayoutRequest{
		BaseRevision: 0,
		Widgets: []WidgetLayout{
			{
				WidgetID:        "widget-files-2",
				WidgetType:      "redeven.files",
				X:               10,
				Y:               20,
				Width:           760,
				Height:          560,
				ZIndex:          1,
				CreatedAtUnixMs: 1_700_000_000_200,
			},
		},
	})
	if err == nil {
		t.Fatal("Replace() succeeded, want conflict error")
	}
	var conflict *RevisionConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("error = %v, want RevisionConflictError", err)
	}
	if conflict.CurrentRevision != 1 {
		t.Fatalf("current revision = %d, want 1", conflict.CurrentRevision)
	}
}

func TestServiceReplaceNoOpDoesNotAdvanceRevision(t *testing.T) {
	t.Parallel()

	svc := openTestService(t)
	ctx := context.Background()

	first, err := svc.Replace(ctx, PutLayoutRequest{
		BaseRevision: 0,
		Widgets:      sampleWidgets(),
	})
	if err != nil {
		t.Fatalf("first Replace() error = %v", err)
	}

	second, err := svc.Replace(ctx, PutLayoutRequest{
		BaseRevision: first.Revision,
		Widgets:      sampleWidgets(),
	})
	if err != nil {
		t.Fatalf("second Replace() error = %v", err)
	}
	if second.Revision != first.Revision || second.Seq != first.Seq {
		t.Fatalf("second snapshot = %#v, want unchanged %#v", second, first)
	}
}

func TestServiceReplaceLayeredNoOpWithStaleRevisionDoesNotAdvance(t *testing.T) {
	t.Parallel()

	svc := openTestService(t)
	ctx := context.Background()

	req := sampleLayeredLayoutRequest()
	first, err := svc.Replace(ctx, req)
	if err != nil {
		t.Fatalf("first Replace() error = %v", err)
	}
	req.BaseRevision = 0
	second, err := svc.Replace(ctx, req)
	if err != nil {
		t.Fatalf("second Replace() error = %v", err)
	}
	if !reflect.DeepEqual(second, first) {
		t.Fatalf("stale no-op snapshot = %#v, want unchanged %#v", second, first)
	}
}

func TestServiceReplaceNormalizesLayeredObjects(t *testing.T) {
	t.Parallel()

	svc := openTestService(t)
	ctx := context.Background()

	snapshot, err := svc.Replace(ctx, PutLayoutRequest{
		BaseRevision: 0,
		StickyNotes: []StickyNote{
			{
				ID:     "sticky-1",
				Kind:   "",
				Body:   "   ",
				Color:  "not-a-color",
				X:      10,
				Y:      20,
				Width:  -1,
				Height: -1,
				ZIndex: -1,
			},
		},
		Annotations: []TextAnnotation{
			{
				ID:         "text-1",
				Text:       "",
				FontSize:   999,
				FontWeight: 1200,
				Color:      "#ffffff",
				Align:      "justify",
				X:          30,
				Y:          40,
				Width:      -1,
				Height:     -1,
				ZIndex:     -8,
			},
		},
		BackgroundLayers: []BackgroundLayer{
			{
				ID:       "region-1",
				Name:     "",
				Fill:     "#ffffff",
				Opacity:  2,
				Material: "noise",
				X:        50,
				Y:        60,
				Width:    -1,
				Height:   -1,
				ZIndex:   -2,
			},
		},
	})
	if err != nil {
		t.Fatalf("Replace() error = %v", err)
	}

	note := snapshot.StickyNotes[0]
	if note.Body != DefaultStickyNoteBody || note.Color != DefaultStickyNoteColor || note.Width != 260 || note.Height != 190 || note.ZIndex != 0 || note.CreatedAtUnixMs <= 0 || note.UpdatedAtUnixMs <= 0 {
		t.Fatalf("normalized note = %#v, want defaults and clamped z", note)
	}
	annotation := snapshot.Annotations[0]
	if annotation.Text != DefaultAnnotationText || annotation.FontSize != 160 || annotation.FontWeight != DefaultAnnotationFontWeight || annotation.Color != DefaultAnnotationColor || annotation.Align != DefaultAnnotationAlign || annotation.Width != 460 || annotation.Height != 96 {
		t.Fatalf("normalized annotation = %#v, want defaults and clamps", annotation)
	}
	layer := snapshot.BackgroundLayers[0]
	if layer.Name != DefaultBackgroundLayerName || layer.Fill != DefaultBackgroundLayerFill || layer.Opacity != 1 || layer.Material != DefaultBackgroundLayerMaterial || layer.Width != 560 || layer.Height != 360 {
		t.Fatalf("normalized background layer = %#v, want defaults and clamps", layer)
	}
}

func TestServiceReplaceRejectsInvalidAndDuplicateLayeredObjects(t *testing.T) {
	t.Parallel()

	svc := openTestService(t)
	ctx := context.Background()

	_, err := svc.Replace(ctx, PutLayoutRequest{
		BaseRevision: 0,
		StickyNotes: []StickyNote{
			{ID: "duplicate", X: 1, Y: 1},
			{ID: "duplicate", X: 2, Y: 2},
		},
	})
	if err == nil {
		t.Fatal("Replace(duplicate sticky notes) succeeded, want validation error")
	}
	var validation *ValidationError
	if !errors.As(err, &validation) {
		t.Fatalf("error = %v, want ValidationError", err)
	}

	_, err = svc.Replace(ctx, PutLayoutRequest{
		BaseRevision: 0,
		Annotations: []TextAnnotation{
			{ID: "text-1", X: 1, Y: 1},
			{ID: "text-2", X: mathNaN(), Y: 1},
		},
	})
	if err == nil {
		t.Fatal("Replace(invalid annotation) succeeded, want validation error")
	}
	if !errors.As(err, &validation) {
		t.Fatalf("error = %v, want ValidationError", err)
	}
}

func TestServiceOpenPreviewCreatesWidgetAndStateAtomically(t *testing.T) {
	t.Parallel()

	svc := openTestService(t)
	ctx := context.Background()

	resp, err := svc.OpenPreview(ctx, OpenPreviewRequest{
		RequestID: "request-open-preview",
		Item: PreviewItem{
			Path: "/workspace/src/main.go",
			Name: "main.go",
			Size: int64Ptr(128),
		},
		Viewport: OpenPreviewViewportHint{
			CenterX:       float64Ptr(640),
			CenterY:       float64Ptr(420),
			DefaultWidth:  900,
			DefaultHeight: 620,
		},
	})
	if err != nil {
		t.Fatalf("OpenPreview() error = %v", err)
	}
	if !resp.Created {
		t.Fatalf("created = false, want true")
	}
	if resp.RequestID != "request-open-preview" {
		t.Fatalf("request_id = %q, want request-open-preview", resp.RequestID)
	}
	if resp.WidgetID == "" || resp.WidgetState.WidgetID != resp.WidgetID {
		t.Fatalf("widget ids = %q/%q, want populated and matching", resp.WidgetID, resp.WidgetState.WidgetID)
	}
	if !strings.HasPrefix(resp.WidgetID, "widget-preview-") {
		t.Fatalf("widget_id = %q, want runtime-generated preview id", resp.WidgetID)
	}
	if resp.WidgetState.State.Item == nil || resp.WidgetState.State.Item.Path != "/workspace/src/main.go" {
		t.Fatalf("widget state item = %#v, want preview item", resp.WidgetState.State.Item)
	}
	if resp.Snapshot.Revision != 1 || resp.Snapshot.Seq != 1 {
		t.Fatalf("snapshot revision/seq = %d/%d, want 1/1", resp.Snapshot.Revision, resp.Snapshot.Seq)
	}
	if len(resp.Snapshot.Widgets) != 1 || resp.Snapshot.Widgets[0].WidgetID != resp.WidgetID {
		t.Fatalf("snapshot widgets = %#v, want created preview widget", resp.Snapshot.Widgets)
	}
	if got := resp.Snapshot.Widgets[0]; got.WidgetType != WidgetTypePreview || got.X != 190 || got.Y != 110 || got.Width != 900 || got.Height != 620 || got.ZIndex != 1 || got.CreatedAtUnixMs <= 0 {
		t.Fatalf("created widget = %#v, want centered preview geometry", got)
	}
	if len(resp.Snapshot.WidgetStates) != 1 || resp.Snapshot.WidgetStates[0].WidgetID != resp.WidgetID {
		t.Fatalf("snapshot widget states = %#v, want preview state in same snapshot", resp.Snapshot.WidgetStates)
	}

	baseline, _, err := svc.Subscribe(ctx, 0)
	if err != nil {
		t.Fatalf("Subscribe() error = %v", err)
	}
	if len(baseline) != 1 || baseline[0].Type != EventTypeLayoutReplaced {
		t.Fatalf("baseline events = %#v, want one layout.replaced event", baseline)
	}
	var payload Snapshot
	if err := json.Unmarshal(baseline[0].Payload, &payload); err != nil {
		t.Fatalf("json.Unmarshal(payload) error = %v", err)
	}
	if len(payload.Widgets) != 1 || len(payload.WidgetStates) != 1 {
		t.Fatalf("event payload = %#v, want widget and preview state together", payload)
	}
	if payload.WidgetStates[0].WidgetID != payload.Widgets[0].WidgetID {
		t.Fatalf("event payload widget/state ids = %q/%q, want atomic match", payload.Widgets[0].WidgetID, payload.WidgetStates[0].WidgetID)
	}
}

func TestServiceOpenPreviewReusesSameFileWidget(t *testing.T) {
	t.Parallel()

	svc := openTestService(t)
	ctx := context.Background()

	first, err := svc.OpenPreview(ctx, OpenPreviewRequest{
		Item: PreviewItem{Path: "/workspace/demo.txt", Name: "demo.txt"},
	})
	if err != nil {
		t.Fatalf("first OpenPreview() error = %v", err)
	}
	second, err := svc.OpenPreview(ctx, OpenPreviewRequest{
		Item: PreviewItem{Path: "/workspace/demo.txt", Name: "demo.txt"},
	})
	if err != nil {
		t.Fatalf("second OpenPreview() error = %v", err)
	}
	if second.Created {
		t.Fatalf("second created = true, want reuse")
	}
	if second.WidgetID != first.WidgetID {
		t.Fatalf("second widget_id = %q, want %q", second.WidgetID, first.WidgetID)
	}
	if second.Snapshot.Revision != first.Snapshot.Revision || second.WidgetState.Revision != first.WidgetState.Revision {
		t.Fatalf("second response = %#v, want no-op reuse of first %#v", second, first)
	}
}

func TestServiceOpenPreviewStrategies(t *testing.T) {
	t.Parallel()

	svc := openTestService(t)
	ctx := context.Background()

	first, err := svc.OpenPreview(ctx, OpenPreviewRequest{
		Item: PreviewItem{Path: "/workspace/first.txt", Name: "first.txt"},
	})
	if err != nil {
		t.Fatalf("first OpenPreview() error = %v", err)
	}
	second, err := svc.OpenPreview(ctx, OpenPreviewRequest{
		Item: PreviewItem{Path: "/workspace/second.txt", Name: "second.txt"},
	})
	if err != nil {
		t.Fatalf("second OpenPreview() error = %v", err)
	}
	if !second.Created || second.WidgetID == first.WidgetID {
		t.Fatalf("second response = %#v, want new widget for different file", second)
	}

	reuseLatest, err := svc.OpenPreview(ctx, OpenPreviewRequest{
		Item:         PreviewItem{Path: "/workspace/third.txt", Name: "third.txt"},
		OpenStrategy: OpenPreviewStrategyFocusLatestOrCreate,
	})
	if err != nil {
		t.Fatalf("reuse latest OpenPreview() error = %v", err)
	}
	if reuseLatest.Created || reuseLatest.WidgetID != second.WidgetID {
		t.Fatalf("reuse latest response = %#v, want latest widget %q", reuseLatest, second.WidgetID)
	}
	if reuseLatest.WidgetState.State.Item == nil || reuseLatest.WidgetState.State.Item.Path != "/workspace/third.txt" {
		t.Fatalf("reuse latest state item = %#v, want third file", reuseLatest.WidgetState.State.Item)
	}

	forced, err := svc.OpenPreview(ctx, OpenPreviewRequest{
		Item:         PreviewItem{Path: "/workspace/third.txt", Name: "third.txt"},
		OpenStrategy: OpenPreviewStrategyCreateNew,
	})
	if err != nil {
		t.Fatalf("create_new OpenPreview() error = %v", err)
	}
	if !forced.Created || forced.WidgetID == reuseLatest.WidgetID {
		t.Fatalf("forced response = %#v, want a new widget", forced)
	}
	if len(forced.Snapshot.Widgets) != 3 {
		t.Fatalf("forced snapshot widgets = %#v, want 3 preview widgets", forced.Snapshot.Widgets)
	}
}

func TestServicePutWidgetStateCAS(t *testing.T) {
	t.Parallel()

	svc := openTestService(t)
	ctx := context.Background()

	if _, err := svc.Replace(ctx, PutLayoutRequest{
		BaseRevision: 0,
		Widgets:      sampleWidgets(),
	}); err != nil {
		t.Fatalf("Replace() error = %v", err)
	}

	state, err := svc.PutWidgetState(ctx, "widget-files-1", PutWidgetStateRequest{
		BaseRevision: 0,
		WidgetType:   WidgetTypeFiles,
		State: WidgetStateData{
			Kind:        WidgetStateKindFiles,
			CurrentPath: "/workspace/src",
		},
	})
	if err != nil {
		t.Fatalf("PutWidgetState() error = %v", err)
	}
	if state.Revision != 1 || state.State.CurrentPath != "/workspace/src" {
		t.Fatalf("state = %#v, want revision 1 current_path /workspace/src", state)
	}

	persisted, err := svc.Snapshot(ctx)
	if err != nil {
		t.Fatalf("Snapshot() error = %v", err)
	}
	if persisted.Revision != 1 {
		t.Fatalf("layout revision = %d, want 1", persisted.Revision)
	}
	if persisted.Seq != state.Revision+1 {
		t.Fatalf("snapshot seq = %d, want widget-state event seq 2", persisted.Seq)
	}
	if len(persisted.WidgetStates) != 1 || persisted.WidgetStates[0].State.CurrentPath != "/workspace/src" {
		t.Fatalf("persisted widget states = %#v, want files path", persisted.WidgetStates)
	}

	same, err := svc.PutWidgetState(ctx, "widget-files-1", PutWidgetStateRequest{
		BaseRevision: 0,
		WidgetType:   WidgetTypeFiles,
		State: WidgetStateData{
			Kind:        WidgetStateKindFiles,
			CurrentPath: "/workspace/src",
		},
	})
	if err != nil {
		t.Fatalf("same PutWidgetState() error = %v", err)
	}
	if same.Revision != state.Revision || same.UpdatedAtUnixMs != state.UpdatedAtUnixMs {
		t.Fatalf("same state = %#v, want unchanged %#v", same, state)
	}

	_, err = svc.PutWidgetState(ctx, "widget-files-1", PutWidgetStateRequest{
		BaseRevision: 0,
		WidgetType:   WidgetTypeFiles,
		State: WidgetStateData{
			Kind:        WidgetStateKindFiles,
			CurrentPath: "/workspace/other",
		},
	})
	if err == nil {
		t.Fatal("PutWidgetState() succeeded, want conflict")
	}
	var conflict *WidgetStateRevisionConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("error = %v, want WidgetStateRevisionConflictError", err)
	}
	if conflict.WidgetID != "widget-files-1" || conflict.CurrentRevision != 1 {
		t.Fatalf("conflict = %#v, want widget-files-1 revision 1", conflict)
	}
}

func TestServiceReplaceDeletesRemovedWidgetStates(t *testing.T) {
	t.Parallel()

	svc := openTestService(t)
	ctx := context.Background()

	initial, err := svc.Replace(ctx, PutLayoutRequest{
		BaseRevision: 0,
		Widgets:      sampleWidgets(),
	})
	if err != nil {
		t.Fatalf("Replace() error = %v", err)
	}
	if _, err := svc.PutWidgetState(ctx, "widget-files-1", PutWidgetStateRequest{
		BaseRevision: 0,
		WidgetType:   WidgetTypeFiles,
		State: WidgetStateData{
			Kind:        WidgetStateKindFiles,
			CurrentPath: "/workspace/src",
		},
	}); err != nil {
		t.Fatalf("PutWidgetState(files) error = %v", err)
	}
	if _, err := svc.AppendTerminalSession(ctx, "widget-terminal-1", "session-1"); err != nil {
		t.Fatalf("AppendTerminalSession() error = %v", err)
	}

	next, err := svc.Replace(ctx, PutLayoutRequest{
		BaseRevision: initial.Revision,
		Widgets:      sampleWidgets()[1:],
	})
	if err != nil {
		t.Fatalf("Replace(remove files) error = %v", err)
	}
	if len(next.WidgetStates) != 1 {
		t.Fatalf("widget states = %#v, want only terminal state", next.WidgetStates)
	}
	if next.WidgetStates[0].WidgetID != "widget-terminal-1" {
		t.Fatalf("remaining widget state = %#v, want terminal", next.WidgetStates[0])
	}
}

func TestServiceTerminalSessionStateHelpers(t *testing.T) {
	t.Parallel()

	svc := openTestService(t)
	ctx := context.Background()

	if _, err := svc.Replace(ctx, PutLayoutRequest{
		BaseRevision: 0,
		Widgets:      sampleWidgets(),
	}); err != nil {
		t.Fatalf("Replace() error = %v", err)
	}

	first, err := svc.AppendTerminalSession(ctx, "widget-terminal-1", "session-1")
	if err != nil {
		t.Fatalf("AppendTerminalSession(session-1) error = %v", err)
	}
	if first.Revision != 1 || !reflect.DeepEqual(first.State.SessionIDs, []string{"session-1"}) {
		t.Fatalf("first state = %#v, want session-1 revision 1", first)
	}

	withGeometry, err := svc.PutWidgetState(ctx, "widget-terminal-1", PutWidgetStateRequest{
		BaseRevision: first.Revision,
		WidgetType:   WidgetTypeTerminal,
		State: WidgetStateData{
			Kind:         WidgetStateKindTerminal,
			SessionIDs:   first.State.SessionIDs,
			FontSize:     intPtr(14),
			FontFamilyID: "jetbrains",
		},
	})
	if err != nil {
		t.Fatalf("PutWidgetState(terminal geometry) error = %v", err)
	}
	if withGeometry.State.FontSize == nil || *withGeometry.State.FontSize != 14 || withGeometry.State.FontFamilyID != "jetbrains" {
		t.Fatalf("geometry state = %#v, want font size 14 and jetbrains", withGeometry.State)
	}

	duplicate, err := svc.AppendTerminalSession(ctx, "widget-terminal-1", "session-1")
	if err != nil {
		t.Fatalf("AppendTerminalSession(duplicate) error = %v", err)
	}
	if duplicate.Revision != withGeometry.Revision || !reflect.DeepEqual(duplicate.State.SessionIDs, withGeometry.State.SessionIDs) {
		t.Fatalf("duplicate state = %#v, want unchanged %#v", duplicate, withGeometry)
	}
	if duplicate.State.FontSize == nil || *duplicate.State.FontSize != 14 || duplicate.State.FontFamilyID != "jetbrains" {
		t.Fatalf("duplicate geometry = %#v, want preserved geometry", duplicate.State)
	}

	second, err := svc.AppendTerminalSession(ctx, "widget-terminal-1", "session-2")
	if err != nil {
		t.Fatalf("AppendTerminalSession(session-2) error = %v", err)
	}
	if second.Revision != 3 || !reflect.DeepEqual(second.State.SessionIDs, []string{"session-1", "session-2"}) {
		t.Fatalf("second state = %#v, want both sessions revision 3", second)
	}
	if second.State.FontSize == nil || *second.State.FontSize != 14 || second.State.FontFamilyID != "jetbrains" {
		t.Fatalf("second geometry = %#v, want preserved geometry", second.State)
	}

	removed, err := svc.RemoveTerminalSession(ctx, "widget-terminal-1", "session-1")
	if err != nil {
		t.Fatalf("RemoveTerminalSession(session-1) error = %v", err)
	}
	if removed.Revision != 4 || !reflect.DeepEqual(removed.State.SessionIDs, []string{"session-2"}) {
		t.Fatalf("removed state = %#v, want session-2 revision 4", removed)
	}
	if removed.State.FontSize == nil || *removed.State.FontSize != 14 || removed.State.FontFamilyID != "jetbrains" {
		t.Fatalf("removed geometry = %#v, want preserved geometry", removed.State)
	}

	missing, err := svc.RemoveTerminalSession(ctx, "widget-terminal-1", "missing")
	if err != nil {
		t.Fatalf("RemoveTerminalSession(missing) error = %v", err)
	}
	if missing.Revision != removed.Revision || !reflect.DeepEqual(missing.State.SessionIDs, removed.State.SessionIDs) {
		t.Fatalf("missing removal state = %#v, want unchanged %#v", missing, removed)
	}
}

func TestServicePruneTerminalSessions(t *testing.T) {
	t.Parallel()

	svc := openTestService(t)
	ctx := context.Background()

	widgets := append([]WidgetLayout{}, sampleWidgets()...)
	widgets = append(widgets, WidgetLayout{
		WidgetID:        "widget-terminal-2",
		WidgetType:      WidgetTypeTerminal,
		X:               900,
		Y:               240,
		Width:           840,
		Height:          500,
		ZIndex:          3,
		CreatedAtUnixMs: 1_700_000_000_300,
	})
	if _, err := svc.Replace(ctx, PutLayoutRequest{
		BaseRevision: 0,
		Widgets:      widgets,
	}); err != nil {
		t.Fatalf("Replace() error = %v", err)
	}
	if _, err := svc.AppendTerminalSession(ctx, "widget-terminal-1", "live-1"); err != nil {
		t.Fatalf("AppendTerminalSession(live-1) error = %v", err)
	}
	if _, err := svc.AppendTerminalSession(ctx, "widget-terminal-1", "stale-1"); err != nil {
		t.Fatalf("AppendTerminalSession(stale-1) error = %v", err)
	}
	if _, err := svc.AppendTerminalSession(ctx, "widget-terminal-2", "stale-2"); err != nil {
		t.Fatalf("AppendTerminalSession(stale-2) error = %v", err)
	}
	if _, err := svc.AppendTerminalSession(ctx, "widget-terminal-2", "live-2"); err != nil {
		t.Fatalf("AppendTerminalSession(live-2) error = %v", err)
	}

	updated, err := svc.PruneTerminalSessions(ctx, []string{"live-1", "live-2"})
	if err != nil {
		t.Fatalf("PruneTerminalSessions() error = %v", err)
	}
	if len(updated) != 2 {
		t.Fatalf("updated states = %#v, want 2 terminal widgets", updated)
	}

	snapshot, err := svc.Snapshot(ctx)
	if err != nil {
		t.Fatalf("Snapshot() error = %v", err)
	}
	if got := terminalSessionIDsForWidget(t, snapshot, "widget-terminal-1"); !reflect.DeepEqual(got, []string{"live-1"}) {
		t.Fatalf("widget-terminal-1 sessions = %#v, want live-1", got)
	}
	if got := terminalSessionIDsForWidget(t, snapshot, "widget-terminal-2"); !reflect.DeepEqual(got, []string{"live-2"}) {
		t.Fatalf("widget-terminal-2 sessions = %#v, want live-2", got)
	}
	seqAfterPrune := snapshot.Seq

	noOp, err := svc.PruneTerminalSessions(ctx, []string{"live-1", "live-2"})
	if err != nil {
		t.Fatalf("PruneTerminalSessions(no-op) error = %v", err)
	}
	if len(noOp) != 0 {
		t.Fatalf("no-op updated states = %#v, want none", noOp)
	}
	afterNoOp, err := svc.Snapshot(ctx)
	if err != nil {
		t.Fatalf("Snapshot(no-op) error = %v", err)
	}
	if afterNoOp.Seq != seqAfterPrune {
		t.Fatalf("no-op snapshot seq = %d, want unchanged %d", afterNoOp.Seq, seqAfterPrune)
	}
}

func TestServiceRemoveTerminalSessionFromAllWidgets(t *testing.T) {
	t.Parallel()

	svc := openTestService(t)
	ctx := context.Background()

	widgets := append([]WidgetLayout{}, sampleWidgets()...)
	widgets = append(widgets, WidgetLayout{
		WidgetID:        "widget-terminal-2",
		WidgetType:      WidgetTypeTerminal,
		X:               900,
		Y:               240,
		Width:           840,
		Height:          500,
		ZIndex:          3,
		CreatedAtUnixMs: 1_700_000_000_300,
	})
	if _, err := svc.Replace(ctx, PutLayoutRequest{
		BaseRevision: 0,
		Widgets:      widgets,
	}); err != nil {
		t.Fatalf("Replace() error = %v", err)
	}
	if _, err := svc.AppendTerminalSession(ctx, "widget-terminal-1", "shared-session"); err != nil {
		t.Fatalf("AppendTerminalSession(widget-terminal-1/shared) error = %v", err)
	}
	if _, err := svc.AppendTerminalSession(ctx, "widget-terminal-1", "kept-1"); err != nil {
		t.Fatalf("AppendTerminalSession(widget-terminal-1/kept) error = %v", err)
	}
	if _, err := svc.AppendTerminalSession(ctx, "widget-terminal-2", "shared-session"); err != nil {
		t.Fatalf("AppendTerminalSession(widget-terminal-2/shared) error = %v", err)
	}
	if _, err := svc.AppendTerminalSession(ctx, "widget-terminal-2", "kept-2"); err != nil {
		t.Fatalf("AppendTerminalSession(widget-terminal-2/kept) error = %v", err)
	}

	updated, err := svc.RemoveTerminalSessionFromAllWidgets(ctx, "shared-session")
	if err != nil {
		t.Fatalf("RemoveTerminalSessionFromAllWidgets() error = %v", err)
	}
	if len(updated) != 2 {
		t.Fatalf("updated states = %#v, want 2 terminal widgets", updated)
	}

	snapshot, err := svc.Snapshot(ctx)
	if err != nil {
		t.Fatalf("Snapshot() error = %v", err)
	}
	if got := terminalSessionIDsForWidget(t, snapshot, "widget-terminal-1"); !reflect.DeepEqual(got, []string{"kept-1"}) {
		t.Fatalf("widget-terminal-1 sessions = %#v, want kept-1", got)
	}
	if got := terminalSessionIDsForWidget(t, snapshot, "widget-terminal-2"); !reflect.DeepEqual(got, []string{"kept-2"}) {
		t.Fatalf("widget-terminal-2 sessions = %#v, want kept-2", got)
	}
}

func TestServiceMigratesV2DatabaseToV3(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "layout-v2.sqlite")
	createWorkbenchLayoutV2Database(t, dbPath)

	svc, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open(v2) error = %v", err)
	}
	t.Cleanup(func() {
		if err := svc.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}
	})

	snapshot, err := svc.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("Snapshot() error = %v", err)
	}
	if snapshot.Revision != 1 || len(snapshot.Widgets) != 1 || snapshot.Widgets[0].WidgetID != "widget-files-1" {
		t.Fatalf("migrated snapshot widgets = %#v revision=%d, want v2 widget", snapshot.Widgets, snapshot.Revision)
	}
	if len(snapshot.WidgetStates) != 1 || snapshot.WidgetStates[0].State.CurrentPath != "/workspace/src" {
		t.Fatalf("migrated widget states = %#v, want files state", snapshot.WidgetStates)
	}
	if len(snapshot.StickyNotes) != 0 || len(snapshot.Annotations) != 0 || len(snapshot.BackgroundLayers) != 0 {
		t.Fatalf("migrated layered objects = %#v/%#v/%#v, want empty", snapshot.StickyNotes, snapshot.Annotations, snapshot.BackgroundLayers)
	}

	next, err := svc.Replace(context.Background(), PutLayoutRequest{
		BaseRevision: snapshot.Revision,
		Widgets:      snapshot.Widgets,
		StickyNotes: []StickyNote{
			{ID: "sticky-1", Body: "Migrated DB can write new objects", X: 1, Y: 2},
		},
	})
	if err != nil {
		t.Fatalf("Replace(after migration) error = %v", err)
	}
	if len(next.StickyNotes) != 1 || next.StickyNotes[0].ID != "sticky-1" {
		t.Fatalf("next sticky notes = %#v, want persisted sticky note", next.StickyNotes)
	}
}

func createWorkbenchLayoutV2Database(t *testing.T, dbPath string) {
	t.Helper()

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	defer db.Close()

	_, err = db.Exec(`
CREATE TABLE __redeven_db_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  db_kind TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_migrated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_migrated_from_version INTEGER NOT NULL DEFAULT 0,
  last_migrated_to_version INTEGER NOT NULL DEFAULT 0
);
INSERT INTO __redeven_db_meta(singleton, db_kind, created_at_unix_ms, last_migrated_at_unix_ms, last_migrated_from_version, last_migrated_to_version)
VALUES (1, 'workbench_layout_runtime', 1700000000000, 1700000000000, 1, 2);
PRAGMA user_version = 2;
CREATE TABLE workbench_layout_snapshot (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
INSERT INTO workbench_layout_snapshot(singleton, revision, seq, updated_at_unix_ms)
VALUES (1, 1, 2, 1700000000200);
CREATE TABLE workbench_layout_widgets (
  widget_id TEXT PRIMARY KEY,
  widget_type TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  z_index INTEGER NOT NULL,
  created_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX idx_workbench_layout_widgets_order
  ON workbench_layout_widgets(z_index ASC, created_at_unix_ms ASC, widget_id ASC);
INSERT INTO workbench_layout_widgets(widget_id, widget_type, x, y, width, height, z_index, created_at_unix_ms)
VALUES ('widget-files-1', 'redeven.files', 120, 80, 760, 560, 1, 1700000000000);
CREATE TABLE workbench_layout_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX idx_workbench_layout_events_seq
  ON workbench_layout_events(seq ASC);
INSERT INTO workbench_layout_events(seq, event_type, payload_json, created_at_unix_ms)
VALUES (1, 'layout.replaced', '{}', 1700000000100);
CREATE TABLE workbench_widget_states (
  widget_id TEXT PRIMARY KEY,
  widget_type TEXT NOT NULL,
  revision INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX idx_workbench_widget_states_type
  ON workbench_widget_states(widget_type ASC, widget_id ASC);
INSERT INTO workbench_widget_states(widget_id, widget_type, revision, state_json, updated_at_unix_ms)
VALUES ('widget-files-1', 'redeven.files', 1, '{"kind":"files","current_path":"/workspace/src"}', 1700000000200);
`)
	if err != nil {
		t.Fatalf("create v2 db error = %v", err)
	}
}

func terminalSessionIDsForWidget(t *testing.T, snapshot Snapshot, widgetID string) []string {
	t.Helper()

	for _, state := range snapshot.WidgetStates {
		if state.WidgetID == widgetID {
			return state.State.SessionIDs
		}
	}
	t.Fatalf("missing widget state %q in snapshot %#v", widgetID, snapshot.WidgetStates)
	return nil
}
