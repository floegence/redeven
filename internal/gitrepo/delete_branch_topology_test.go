package gitrepo

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDeleteBranch_CreatedFromMainDirectory(t *testing.T) {
	for _, nested := range []bool{false, true} {
		name := "sibling"
		if nested {
			name = "nested"
		}
		t.Run(name, func(t *testing.T) {
			fixture := createTestRepoFixture(t)
			runGitFixture(t, fixture.Root, "branch", "-m", "main")
			worktree := filepath.Join(filepath.Dir(fixture.Root), "feature")
			if nested {
				worktree = filepath.Join(fixture.Root, ".worktrees", "feature")
			}
			runGitFixture(t, fixture.Root, "worktree", "add", "-b", "feature/from-main", worktree, "main")
			writeFixtureFile(t, fixture.Root, "keep.txt", []byte("primary workspace data\n"))
			svc := NewService(filepath.Dir(fixture.Root))
			defer svc.Close()
			repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
			if err != nil {
				t.Fatal(err)
			}
			preview := mustPreviewDeleteBranch(t, svc, repo, "feature/from-main", "", "local")
			if !preview.SafeDeleteAllowed || !preview.RequiresWorktreeRemoval || preview.BlockingReason != "" {
				t.Fatalf("unexpected preview: %+v", preview)
			}
			resp, err := svc.deleteBranch(context.Background(), repo, deleteBranchOptions{Name: "feature/from-main", DeleteMode: "safe", RemoveLinkedWorktree: true, PlanFingerprint: preview.PlanFingerprint})
			if err != nil {
				t.Fatal(err)
			}
			if !resp.LinkedWorktreeRemoved || resp.HeadRef != "main" {
				t.Fatalf("unexpected response: %+v", resp)
			}
			if _, err := os.Stat(worktree); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("worktree remains: %v", err)
			}
			if svc.gitRefExists(context.Background(), fixture.Root, "refs/heads/feature/from-main") {
				t.Fatal("branch remains")
			}
			data, err := os.ReadFile(filepath.Join(fixture.Root, "keep.txt"))
			if err != nil || string(data) != "primary workspace data\n" {
				t.Fatalf("primary data changed: %q %v", data, err)
			}
		})
	}
}

func TestDeleteBranch_BlocksNonRemovableWorktree(t *testing.T) {
	for _, scenario := range []string{"primary", "locked", "nested-detached"} {
		t.Run(scenario, func(t *testing.T) {
			fixture := createTestRepoFixture(t)
			runGitFixture(t, fixture.Root, "branch", "-m", "main")
			worktree := filepath.Join(filepath.Dir(fixture.Root), "feature")
			current := fixture.Root
			target := "feature/guard"
			switch scenario {
			case "primary":
				runGitFixture(t, fixture.Root, "switch", "-c", target)
				runGitFixture(t, fixture.Root, "worktree", "add", worktree, "main")
				current, worktree = worktree, fixture.Root
			default:
				runGitFixture(t, fixture.Root, "worktree", "add", "-b", target, worktree, "main")
				if scenario == "locked" {
					runGitFixture(t, fixture.Root, "worktree", "lock", "--reason", "user-owned runtime", worktree)
				}
				if scenario == "nested-detached" {
					runGitFixture(t, fixture.Root, "worktree", "add", "--detach", filepath.Join(worktree, "child"), "main")
				}
			}
			svc := NewService(filepath.Dir(fixture.Root))
			defer svc.Close()
			repo, err := svc.resolveExplicitRepo(context.Background(), current)
			if err != nil {
				t.Fatal(err)
			}
			preview := mustPreviewDeleteBranch(t, svc, repo, target, "", "local")
			if preview.SafeDeleteAllowed || preview.ForceDeleteAllowed || preview.BlockingReason == "" {
				t.Fatalf("non-removable %s worktree offered for deletion: %+v", scenario, preview)
			}
			for _, mode := range []string{"safe", "force"} {
				_, err := svc.deleteBranch(context.Background(), repo, deleteBranchOptions{Name: target, DeleteMode: mode, ConfirmBranchName: target, RemoveLinkedWorktree: true, DiscardLinkedWorktreeChanges: true, PlanFingerprint: preview.PlanFingerprint})
				if err == nil || !strings.Contains(err.Error(), preview.BlockingReason) {
					t.Fatalf("%s delete error=%v, want preview blocker", mode, err)
				}
			}
			if _, err := os.Stat(worktree); err != nil {
				t.Fatal("protected worktree removed", err)
			}
			if !svc.gitRefExists(context.Background(), current, "refs/heads/"+target) {
				t.Fatal("protected branch removed")
			}
		})
	}
}

func TestDeleteBranch_RejectsPlanAfterWorktreeLocked(t *testing.T) {
	fixture := createTestRepoFixture(t)
	worktree := filepath.Join(filepath.Dir(fixture.Root), "feature")
	runGitFixture(t, fixture.Root, "worktree", "add", "-b", "feature/lock", worktree)
	svc := NewService(filepath.Dir(fixture.Root))
	defer svc.Close()
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatal(err)
	}
	preview := mustPreviewDeleteBranch(t, svc, repo, "feature/lock", "", "local")
	runGitFixture(t, fixture.Root, "worktree", "lock", worktree)
	_, err = svc.deleteBranch(context.Background(), repo, deleteBranchOptions{Name: "feature/lock", RemoveLinkedWorktree: true, PlanFingerprint: preview.PlanFingerprint})
	if err == nil || !strings.Contains(err.Error(), "delete plan is stale") {
		t.Fatalf("locked worktree did not invalidate review: %v", err)
	}
}

func TestDeleteBranch_RequiresDiscardConsentForEveryMode(t *testing.T) {
	for _, ignored := range []bool{false, true} {
		name := "untracked"
		if ignored {
			name = "ignored"
		}
		t.Run(name, func(t *testing.T) {
			fixture := createTestRepoFixture(t)
			worktree := filepath.Join(filepath.Dir(fixture.Root), "feature")
			runGitFixture(t, fixture.Root, "worktree", "add", "-b", "feature/consent", worktree)
			if ignored {
				writeFixtureFile(t, fixture.Root, ".git/info/exclude", []byte("scratch.txt\n"))
			}
			writeFixtureFile(t, worktree, "scratch.txt", []byte("user data\n"))
			svc := NewService(filepath.Dir(fixture.Root))
			defer svc.Close()
			repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
			if err != nil {
				t.Fatal(err)
			}
			preview := mustPreviewDeleteBranch(t, svc, repo, "feature/consent", "", "local")
			if !preview.RequiresDiscardConfirmation {
				t.Fatal("missing discard confirmation", preview)
			}
			for _, mode := range []string{"safe", "force"} {
				_, err := svc.deleteBranch(context.Background(), repo, deleteBranchOptions{Name: "feature/consent", DeleteMode: mode, ConfirmBranchName: "feature/consent", RemoveLinkedWorktree: true, PlanFingerprint: preview.PlanFingerprint})
				if err == nil || !strings.Contains(err.Error(), "discard confirmation is required") {
					t.Fatalf("%s discarded without consent: %v", mode, err)
				}
				data, err := os.ReadFile(filepath.Join(worktree, "scratch.txt"))
				if err != nil || string(data) != "user data\n" {
					t.Fatalf("user data changed: %q %v", data, err)
				}
			}
			_, err = svc.deleteBranch(context.Background(), repo, deleteBranchOptions{Name: "feature/consent", DeleteMode: "safe", RemoveLinkedWorktree: true, DiscardLinkedWorktreeChanges: true, PlanFingerprint: preview.PlanFingerprint})
			if err != nil {
				t.Fatalf("delete with explicit discard consent: %v", err)
			}
			if _, err := os.Stat(worktree); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("authorized worktree remains: %v", err)
			}

		})
	}
}
