package workbenchlayout

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

func TestGitDiffPlacementRestoresMissingTargetAndReusesGeometry(t *testing.T) {
	svc := openTestService(t)
	ctx := context.Background()
	req := OpenGitDiffRequest{Diff: &GitDiffTarget{RepoRootPath: "/missing repo ", WorkspaceSection: "unstaged", Path: " file.ts ", ChangeType: "deleted"}}
	created, err := svc.OpenGitDiff(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	if !created.Created || len(created.Snapshot.WidgetStates) != 1 || len(created.Snapshot.Widgets) != 1 {
		t.Fatalf("incomplete creation: %#v", created)
	}
	if !reflect.DeepEqual(created.WidgetState.State.Diff, req.Diff) {
		t.Fatal("diff identity was changed")
	}
	geometry := created.Snapshot.Widgets[0]
	geometry.X, geometry.Y, geometry.Width, geometry.Height = -500, 70, 1000, 680
	if _, err := svc.Replace(ctx, PutLayoutRequest{BaseRevision: created.Snapshot.Revision, Widgets: []WidgetLayout{geometry}}); err != nil {
		t.Fatal(err)
	}
	reused, err := svc.OpenGitDiff(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	if reused.Created || reused.WidgetID != created.WidgetID || !reflect.DeepEqual(reused.Snapshot.Widgets[0], geometry) {
		t.Fatalf("changed placement: %#v", reused)
	}
	snapshot, err := svc.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(snapshot.WidgetStates[0].State.Diff, req.Diff) {
		t.Fatal("target did not survive database reload")
	}
	req.Diff.WorkspaceSection = "staged"
	other, err := svc.OpenGitDiff(ctx, req)
	if err != nil || !other.Created || other.WidgetID == created.WidgetID {
		t.Fatalf("sections were conflated: %#v, %v", other, err)
	}
}

func TestGitDiffPlacementRejectsInvalidTargetsAndRollsBack(t *testing.T) {
	svc := openTestService(t)
	for _, target := range []*GitDiffTarget{nil, {RepoRootPath: "/repo", WorkspaceSection: "other", Path: "a"}, {RepoRootPath: "/repo", WorkspaceSection: "unstaged", Path: "../a"}, {RepoRootPath: "/repo", WorkspaceSection: "unstaged"}} {
		if _, err := svc.OpenGitDiff(context.Background(), OpenGitDiffRequest{Diff: target}); err == nil {
			t.Fatalf("accepted %#v", target)
		}
	}
	var state WidgetStateData
	if err := json.Unmarshal([]byte(`{"kind":"git_diff","diff":{"repoRootPath":"/repo","workspaceSection":"unstaged","path":"file"},"item":null}`), &state); err != nil {
		t.Fatal(err)
	}
	if _, err := normalizeWidgetStateData(WidgetTypeGitDiff, state); err == nil {
		t.Fatal("accepted unrelated state")
	}
	if _, err := svc.store.db.Exec(`CREATE TRIGGER reject_diff_state BEFORE INSERT ON workbench_widget_states BEGIN SELECT RAISE(ABORT, 'state write rejected'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.OpenGitDiff(context.Background(), OpenGitDiffRequest{Diff: &GitDiffTarget{RepoRootPath: "/repo", WorkspaceSection: "untracked", Path: "a"}}); err == nil {
		t.Fatal("expected state write failure")
	}
	snapshot, err := svc.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Widgets) != 0 || len(snapshot.WidgetStates) != 0 {
		t.Fatal("left partial placement after failure")
	}
}
