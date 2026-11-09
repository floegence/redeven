package gitrepo

import (
	"context"
	"crypto/sha256"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDestructiveWorkspaceFingerprintRejectsFileReplacement(t *testing.T) {
	fixture := createTestRepoFixture(t)
	svc := NewService(filepath.Dir(fixture.Root))
	defer svc.Close()
	writeFixtureFile(t, fixture.Root, "scratch", []byte("same"))
	path := filepath.Join(fixture.Root, "scratch")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	before, err := svc.destructiveWorkspaceFingerprint(context.Background(), fixture.Root)
	if err != nil {
		t.Fatal(err)
	}
	replacement := filepath.Join(t.TempDir(), "replacement")
	if err := os.WriteFile(replacement, []byte("same"), info.Mode()); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(replacement, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(replacement, path); err != nil {
		t.Fatal(err)
	}
	after, err := svc.destructiveWorkspaceFingerprint(context.Background(), fixture.Root)
	if err != nil {
		t.Fatal(err)
	}
	if before == after {
		t.Fatal("file replacement did not invalidate review")
	}
}

func TestDestructiveWorkspaceScannerReleasesDirectoryMemory(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "first/child/value", []byte("one"))
	writeFixtureFile(t, root, "second/child/value", []byte("two"))
	directory, err := openRootDirectoryNoFollow(root)
	if err != nil {
		t.Fatal(err)
	}
	defer directory.Close()
	info, err := directory.Stat()
	if err != nil {
		t.Fatal(err)
	}
	scanner := &destructiveWorkspaceScanner{ctx: context.Background(), hash: sha256.New()}
	if err := scanner.scanDirectory(directory, root, "", true, info); err != nil {
		t.Fatal(err)
	}
	if scanner.heapBytes != 0 || scanner.entries != 6 {
		t.Fatalf("released traversal retained heap=%d entries=%d", scanner.heapBytes, scanner.entries)
	}
	scanner.heapBytes = destructiveScanMaxHeapBytes
	if err := scanner.admitEntry("overflow", "overflow"); !errors.Is(err, errDestructiveWorkspaceScanLimit) {
		t.Fatalf("live heap cap ignored: %v", err)
	}
}

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

func TestDeleteBranch_RejectsRewrittenIgnoredContentWithRestoredMtime(t *testing.T) {
	fixture := createTestRepoFixture(t)
	worktree := filepath.Join(filepath.Dir(fixture.Root), "rewrite")
	runGitFixture(t, fixture.Root, "worktree", "add", "-b", "feature/rewrite", worktree)
	writeFixtureFile(t, fixture.Root, ".git/info/exclude", []byte("cache/\n"))
	writeFixtureFile(t, worktree, "cache/value", []byte("before"))
	svc := NewService(filepath.Dir(fixture.Root))
	defer svc.Close()
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatal(err)
	}
	preview := mustPreviewDeleteBranch(t, svc, repo, "feature/rewrite", "", "local")
	path := filepath.Join(worktree, "cache/value")
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	writeFixtureFile(t, worktree, "cache/value", []byte("after!"))
	if err := os.Chtimes(path, before.ModTime(), before.ModTime()); err != nil {
		t.Fatal(err)
	}
	_, err = svc.deleteBranch(context.Background(), repo, deleteBranchOptions{Name: "feature/rewrite", RemoveLinkedWorktree: true, DiscardLinkedWorktreeChanges: true, PlanFingerprint: preview.PlanFingerprint})
	if err == nil || !strings.Contains(err.Error(), "delete plan is stale") {
		t.Fatalf("rewritten ignored content did not invalidate review: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "after!" {
		t.Fatalf("stale review changed user data: %q %v", data, err)
	}
}
