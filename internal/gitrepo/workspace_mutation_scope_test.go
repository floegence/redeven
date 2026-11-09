package gitrepo

import (
	"context"
	"testing"
)

func TestStageWorkspaceKeepsOtherSectionsUntouched(t *testing.T) {
	for _, section := range []string{"changes", "conflicted"} {
		t.Run(section, func(t *testing.T) {
			fixture := createTestRepoFixture(t)
			conflict := createWorkspaceConflictFixture(t, fixture.Root)
			writeFixtureFile(t, fixture.Root, "pending.txt", []byte("pending\n"))
			svc := NewService(fixture.Root)
			defer svc.Close()
			repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
			if err != nil {
				t.Fatal(err)
			}
			result, err := svc.stageWorkspace(context.Background(), repo, workspaceMutationSelection{Section: section})
			if err != nil {
				t.Fatal(err)
			}
			if result.MatchedCount != 1 || result.AffectedCount != 1 {
				t.Fatalf("result: %+v", result)
			}
			status, err := svc.readWorkspaceStatus(context.Background(), fixture.Root)
			if err != nil {
				t.Fatal(err)
			}
			if section == "changes" {
				if len(status.Conflicted) != 1 || status.Conflicted[0].Path != conflict.ConflictPath {
					t.Fatalf("unselected conflict was staged: %+v", status)
				}
			} else if len(status.Untracked) != 1 || status.Untracked[0].Path != "pending.txt" {
				t.Fatalf("unselected pending file was staged: %+v", status)
			}
		})
	}
}

func TestUnstageWorkspaceKeepsConflictsUntouched(t *testing.T) {
	fixture := createTestRepoFixture(t)
	conflict := createWorkspaceConflictFixture(t, fixture.Root)
	writeFixtureFile(t, fixture.Root, "pending.txt", []byte("pending\n"))
	runGitFixture(t, fixture.Root, "add", "--", "pending.txt")
	svc := NewService(fixture.Root)
	defer svc.Close()
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.unstageWorkspace(context.Background(), repo, workspaceMutationSelection{Section: "staged"})
	if err != nil {
		t.Fatal(err)
	}
	status, err := svc.readWorkspaceStatus(context.Background(), fixture.Root)
	if err != nil {
		t.Fatal(err)
	}
	if len(status.Conflicted) != 1 || status.Conflicted[0].Path != conflict.ConflictPath {
		t.Fatalf("unselected conflict index changed: %+v", status)
	}
}
