package codeapp

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/terminal"
	"github.com/floegence/redeven/internal/workbenchlayout"
)

func TestDeletingTerminalGroupCleansSessionsFromEveryWorkbenchWidget(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	root := t.TempDir()
	layouts, err := workbenchlayout.Open(filepath.Join(root, "workbench.sqlite"))
	if err != nil {
		t.Fatalf("workbenchlayout.Open() error = %v", err)
	}
	t.Cleanup(func() { _ = layouts.Close() })
	if _, err := layouts.Replace(ctx, workbenchlayout.PutLayoutRequest{
		Widgets: []workbenchlayout.WidgetLayout{
			{WidgetID: "terminal-a", WidgetType: workbenchlayout.WidgetTypeTerminal, X: 0, Y: 0, Width: 800, Height: 500, ZIndex: 1, CreatedAtUnixMs: 1},
			{WidgetID: "terminal-b", WidgetType: workbenchlayout.WidgetTypeTerminal, X: 900, Y: 0, Width: 800, Height: 500, ZIndex: 2, CreatedAtUnixMs: 2},
		},
	}); err != nil {
		t.Fatalf("Replace() error = %v", err)
	}

	manager := terminal.NewManager("/bin/sh", root, nil)
	t.Cleanup(manager.Cleanup)
	if err := manager.EnablePersistentGroups(filepath.Join(root, "groups.sqlite")); err != nil {
		t.Fatalf("EnablePersistentGroups() error = %v", err)
	}
	_, group, err := manager.CreateGroup("Services", root)
	if err != nil {
		t.Fatalf("CreateGroup() error = %v", err)
	}
	first, err := manager.CreateSessionInGroup(group.ID, "first", "")
	if err != nil {
		t.Fatalf("CreateSessionInGroup(first) error = %v", err)
	}
	second, err := manager.CreateSessionInGroup(group.ID, "second", "")
	if err != nil {
		t.Fatalf("CreateSessionInGroup(second) error = %v", err)
	}
	if _, err := layouts.AppendTerminalSession(ctx, "terminal-a", first.ID); err != nil {
		t.Fatalf("AppendTerminalSession(terminal-a) error = %v", err)
	}
	if _, err := layouts.AppendTerminalSession(ctx, "terminal-b", second.ID); err != nil {
		t.Fatalf("AppendTerminalSession(terminal-b) error = %v", err)
	}

	removeCleanup := registerWorkbenchTerminalSessionCleanup(nil, layouts, manager)
	t.Cleanup(removeCleanup)
	if result, err := manager.DeleteGroup(group.ID); err != nil || len(result.FailedSessionIDs) != 0 {
		t.Fatalf("DeleteGroup() = (%#v, %v)", result, err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		snapshot, err := layouts.Snapshot(ctx)
		if err != nil {
			t.Fatalf("Snapshot() error = %v", err)
		}
		clean := len(snapshot.WidgetStates) == 2
		for _, state := range snapshot.WidgetStates {
			clean = clean && len(state.State.SessionIDs) == 0
		}
		if clean {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("group sessions remained in workbench widget states: %#v", snapshot.WidgetStates)
		}
		time.Sleep(10 * time.Millisecond)
	}

	if groups := manager.GroupCatalogSnapshot(); len(groups.Groups) != 1 || groups.Groups[0].ID != terminal.DefaultTerminalGroupID {
		t.Fatalf("group catalog after delete = %#v", groups)
	}
	if sessions := manager.VisibleSessionIDs(); len(sessions) != 0 {
		t.Fatalf("visible sessions after delete = %#v", sessions)
	}
}
