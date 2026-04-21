package workbenchlayout

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"reflect"
	"testing"
	"time"
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
