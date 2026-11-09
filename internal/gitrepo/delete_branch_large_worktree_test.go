package gitrepo

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDeleteBranch_LargeIgnoredBuildArtifact(t *testing.T) {
	fixture := createTestRepoFixture(t)
	worktree := filepath.Join(filepath.Dir(fixture.Root), "large-build")
	runGitFixture(t, fixture.Root, "worktree", "add", "-b", "feature/large-build", worktree)
	writeFixtureFile(t, fixture.Root, ".git/info/exclude", []byte("DerivedData/\n"))
	writeFixtureFile(t, worktree, "DerivedData/Build/large.bin", nil)
	artifact := filepath.Join(worktree, "DerivedData/Build/large.bin")
	// Sparse content reproduces the former 1 GiB limit without allocating it.
	if err := os.Truncate(artifact, 2<<30); err != nil {
		t.Fatal(err)
	}
	svc := NewService(filepath.Dir(fixture.Root))
	defer svc.Close()
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatal(err)
	}
	preview := mustPreviewDeleteBranch(t, svc, repo, "feature/large-build", "", "local")
	if !preview.SafeDeleteAllowed || !preview.RequiresWorktreeRemoval || !preview.RequiresDiscardConfirmation {
		t.Fatalf("large ignored artifact not reviewed: %+v", preview)
	}
	request := deleteBranchOptions{Name: "feature/large-build", RemoveLinkedWorktree: true, PlanFingerprint: preview.PlanFingerprint}
	if _, err := svc.deleteBranch(context.Background(), repo, request); err == nil || !strings.Contains(err.Error(), "discard confirmation is required") {
		t.Fatalf("ignored content lost without consent: %v", err)
	}
	request.DiscardLinkedWorktreeChanges = true
	resp, err := svc.deleteBranch(context.Background(), repo, request)
	if err != nil || !resp.LinkedWorktreeRemoved {
		t.Fatalf("delete reviewed large worktree: %+v %v", resp, err)
	}
	if _, err := os.Stat(worktree); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("worktree remains: %v", err)
	}
	if svc.gitRefExists(context.Background(), fixture.Root, "refs/heads/feature/large-build") {
		t.Fatal("branch remains")
	}
}

func TestDeleteBranch_IgnoredBuildChangesPreserveReviewedRisk(t *testing.T) {
	fixture := createTestRepoFixture(t)
	worktree := filepath.Join(filepath.Dir(fixture.Root), "build-risk")
	runGitFixture(t, fixture.Root, "worktree", "add", "-b", "feature/build-risk", worktree)
	writeFixtureFile(t, fixture.Root, ".git/info/exclude", []byte("DerivedData/\n"))
	writeFixtureFile(t, worktree, "DerivedData/Build/value", []byte("before"))
	svc := NewService(filepath.Dir(fixture.Root))
	defer svc.Close()
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatal(err)
	}
	before := mustPreviewDeleteBranch(t, svc, repo, "feature/build-risk", "", "local")
	writeFixtureFile(t, worktree, "DerivedData/Build/value", []byte("new build contents"))
	writeFixtureFile(t, worktree, "DerivedData/Build/another", []byte("new build artifact"))
	after := mustPreviewDeleteBranch(t, svc, repo, "feature/build-risk", "", "local")
	if !after.RequiresDiscardConfirmation {
		t.Fatal("ignored content must still require consent")
	}
	if before.PlanFingerprint != after.PlanFingerprint {
		t.Fatal("build content changes invalidated unchanged directory removal risk")
	}
	_, err = svc.deleteBranch(context.Background(), repo, deleteBranchOptions{Name: "feature/build-risk", RemoveLinkedWorktree: true, DiscardLinkedWorktreeChanges: true, PlanFingerprint: before.PlanFingerprint})
	if err != nil {
		t.Fatalf("unchanged ignored-directory risk rejected at execution: %v", err)
	}
}

func TestDeleteBranch_RejectsChangedWorkspaceRisk(t *testing.T) {
	for _, scenario := range []string{"clean-to-dirty", "tracked-dirty", "staged-change", "renamed-untracked", "new-ignored-root", "replaced-worktree"} {
		t.Run(scenario, func(t *testing.T) {
			fixture := createTestRepoFixture(t)
			worktree := filepath.Join(filepath.Dir(fixture.Root), "risk")
			runGitFixture(t, fixture.Root, "worktree", "add", "-b", "feature/risk", worktree)
			writeFixtureFile(t, fixture.Root, ".git/info/exclude", []byte("cache/\nbuild/\n"))
			if scenario == "renamed-untracked" {
				writeFixtureFile(t, worktree, "before.txt", []byte("user data"))
			}
			if scenario == "new-ignored-root" {
				writeFixtureFile(t, worktree, "cache/value", []byte("ignored user data"))
			}
			svc := NewService(filepath.Dir(fixture.Root))
			defer svc.Close()
			repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
			if err != nil {
				t.Fatal(err)
			}
			preview := mustPreviewDeleteBranch(t, svc, repo, "feature/risk", "", "local")
			switch scenario {
			case "clean-to-dirty":
				writeFixtureFile(t, worktree, "new.txt", []byte("new user data"))
			case "tracked-dirty", "staged-change":
				writeFixtureFile(t, worktree, "src/main.txt", []byte("new user changes"))
				if scenario == "staged-change" {
					runGitFixture(t, worktree, "add", "src/main.txt")
				}
			case "renamed-untracked":
				if err := os.Rename(filepath.Join(worktree, "before.txt"), filepath.Join(worktree, "after.txt")); err != nil {
					t.Fatal(err)
				}
			case "new-ignored-root":
				writeFixtureFile(t, worktree, "build/value", []byte("new ignored data"))
			case "replaced-worktree":
				retained := worktree + "-original"
				if err := os.Rename(worktree, retained); err != nil {
					t.Fatal(err)
				}
				if err := os.Mkdir(worktree, 0o755); err != nil {
					t.Fatal(err)
				}
				entries, err := os.ReadDir(retained)
				if err != nil {
					t.Fatal(err)
				}
				for _, entry := range entries {
					if err := os.Rename(filepath.Join(retained, entry.Name()), filepath.Join(worktree, entry.Name())); err != nil {
						t.Fatal(err)
					}
				}
			}
			_, err = svc.deleteBranch(context.Background(), repo, deleteBranchOptions{Name: "feature/risk", RemoveLinkedWorktree: true, DiscardLinkedWorktreeChanges: true, PlanFingerprint: preview.PlanFingerprint})
			if err == nil || !strings.Contains(err.Error(), "delete plan is stale") {
				t.Fatalf("changed risk was not rejected: %v", err)
			}
			if _, err := os.Stat(worktree); err != nil {
				t.Fatalf("worktree was removed: %v", err)
			}
			if !svc.gitRefExists(context.Background(), fixture.Root, "refs/heads/feature/risk") {
				t.Fatal("branch was removed")
			}
		})
	}
}

func TestDeleteBranch_PendingContentEditsPreserveReviewedRisk(t *testing.T) {
	for _, section := range []string{"untracked", "unstaged", "staged"} {
		t.Run(section, func(t *testing.T) {
			fixture := createTestRepoFixture(t)
			worktree := filepath.Join(filepath.Dir(fixture.Root), "pending-risk")
			runGitFixture(t, fixture.Root, "worktree", "add", "-b", "feature/pending-risk", worktree)
			path := "src/main.txt"
			if section == "untracked" {
				path = "draft.txt"
			}
			writeFixtureFile(t, worktree, path, []byte("before"))
			if section == "staged" {
				runGitFixture(t, worktree, "add", path)
			}
			svc := NewService(filepath.Dir(fixture.Root))
			defer svc.Close()
			repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
			if err != nil {
				t.Fatal(err)
			}
			before := mustPreviewDeleteBranch(t, svc, repo, "feature/pending-risk", "", "local")
			writeFixtureFile(t, worktree, path, []byte("same path and risk, revised content"))
			if section == "staged" {
				runGitFixture(t, worktree, "add", path)
			}
			after := mustPreviewDeleteBranch(t, svc, repo, "feature/pending-risk", "", "local")
			if before.PlanFingerprint != after.PlanFingerprint || !after.RequiresDiscardConfirmation {
				t.Fatal("content bytes changed a stable discard risk")
			}
			request := deleteBranchOptions{Name: "feature/pending-risk", RemoveLinkedWorktree: true, PlanFingerprint: before.PlanFingerprint}
			_, err = svc.deleteBranch(context.Background(), repo, request)
			if err == nil || !strings.Contains(err.Error(), "discard confirmation is required") {
				t.Fatalf("missing discard consent: %v", err)
			}
			request.DiscardLinkedWorktreeChanges = true
			if _, err := svc.deleteBranch(context.Background(), repo, request); err != nil {
				t.Fatalf("unchanged pending-content risk rejected at execution: %v", err)
			}
		})
	}
}
