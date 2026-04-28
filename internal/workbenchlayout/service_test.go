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

func intPtr(value int) *int {
	return &value
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
