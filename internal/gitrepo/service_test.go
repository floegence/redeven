package gitrepo

import (
	"context"
	"path/filepath"
	"testing"
)

func TestResolveRepoForPath(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	svc := NewService(fixture.Root)

	repo, available, err := svc.resolveRepoForPath(context.Background(), "/src")
	if err != nil {
		t.Fatalf("resolveRepoForPath: %v", err)
	}
	if !available {
		t.Fatalf("expected repository to be available")
	}
	if repo.repoRootVirtual != "/" {
		t.Fatalf("repoRootVirtual=%q, want /", repo.repoRootVirtual)
	}
	if filepath.Clean(repo.repoRootReal) != filepath.Clean(fixture.Root) {
		t.Fatalf("repoRootReal=%q, want %q", repo.repoRootReal, fixture.Root)
	}
	if repo.headCommit != fixture.BinaryCommit {
		t.Fatalf("headCommit=%q, want %q", repo.headCommit, fixture.BinaryCommit)
	}
}

func TestResolveRepoForPath_NonRepository(t *testing.T) {
	t.Parallel()
	svc := NewService(t.TempDir())
	_, available, err := svc.resolveRepoForPath(context.Background(), "/")
	if err != nil {
		t.Fatalf("resolveRepoForPath(non-repo): %v", err)
	}
	if available {
		t.Fatalf("expected non-repository path to be unavailable")
	}
}

func TestResolveRepoForPath_Worktree(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	worktree := filepath.Join(t.TempDir(), "wt")
	branch := "feat-worktree-history"
	runGitFixture(t, fixture.Root, "branch", branch)
	runGitFixture(t, fixture.Root, "worktree", "add", worktree, branch)

	svc := NewService(worktree)
	repo, available, err := svc.resolveRepoForPath(context.Background(), "/")
	if err != nil {
		t.Fatalf("resolveRepoForPath(worktree): %v", err)
	}
	if !available {
		t.Fatalf("expected worktree repository to be available")
	}
	if filepath.Clean(repo.repoRootReal) != filepath.Clean(worktree) {
		t.Fatalf("repoRootReal=%q, want %q", repo.repoRootReal, worktree)
	}
}

func TestGetCommitDetail_RenameAndBinary(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), "/")
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	detail, files, err := svc.getCommitDetail(context.Background(), repo, fixture.RenameCommit)
	if err != nil {
		t.Fatalf("getCommitDetail(rename): %v", err)
	}
	if detail.Hash != fixture.RenameCommit {
		t.Fatalf("detail.Hash=%q, want %q", detail.Hash, fixture.RenameCommit)
	}
	if len(files) != 1 {
		t.Fatalf("rename files=%d, want 1", len(files))
	}
	if files[0].ChangeType != "renamed" || files[0].OldPath != "src/app.txt" || files[0].NewPath != "src/main.txt" {
		t.Fatalf("unexpected rename summary: %+v", files[0])
	}

	_, binaryFiles, err := svc.getCommitDetail(context.Background(), repo, fixture.BinaryCommit)
	if err != nil {
		t.Fatalf("getCommitDetail(binary): %v", err)
	}
	if len(binaryFiles) < 2 {
		t.Fatalf("binary cleanup should include at least 2 file changes, got %d", len(binaryFiles))
	}
	foundBinary := false
	foundDeleted := false
	for _, file := range binaryFiles {
		if file.Path == "bin/data.bin" && file.IsBinary {
			foundBinary = true
		}
		if file.Path == "README.md" && file.ChangeType == "deleted" {
			foundDeleted = true
		}
	}
	if !foundBinary {
		t.Fatalf("expected binary file summary in commit detail")
	}
	if !foundDeleted {
		t.Fatalf("expected deleted README summary in commit detail")
	}
}

func TestNormalizePatchPath(t *testing.T) {
	t.Parallel()
	if _, err := normalizePatchPath("../secret"); err == nil {
		t.Fatalf("expected path escape to be rejected")
	}
	path, err := normalizePatchPath("src/main.txt")
	if err != nil {
		t.Fatalf("normalizePatchPath(valid): %v", err)
	}
	if path != "src/main.txt" {
		t.Fatalf("path=%q, want src/main.txt", path)
	}
}

func TestListCommits_PaginatesNewestFirst(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), "/")
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	page1, nextOffset, hasMore, err := svc.listCommits(context.Background(), repo, "", 0, 2)
	if err != nil {
		t.Fatalf("listCommits(page1): %v", err)
	}
	if !hasMore {
		t.Fatalf("expected first page to have more commits")
	}
	if nextOffset != 2 {
		t.Fatalf("nextOffset(page1)=%d, want 2", nextOffset)
	}
	if len(page1) != 2 {
		t.Fatalf("len(page1)=%d, want 2", len(page1))
	}
	if page1[0].Hash != fixture.BinaryCommit || page1[1].Hash != fixture.RenameCommit {
		t.Fatalf("unexpected page1 order: %+v", page1)
	}

	page2, nextOffset, hasMore, err := svc.listCommits(context.Background(), repo, "", nextOffset, 2)
	if err != nil {
		t.Fatalf("listCommits(page2): %v", err)
	}
	if hasMore {
		t.Fatalf("expected second page to be terminal")
	}
	if nextOffset != 0 {
		t.Fatalf("nextOffset(page2)=%d, want 0", nextOffset)
	}
	if len(page2) != 2 {
		t.Fatalf("len(page2)=%d, want 2", len(page2))
	}
	if page2[0].Hash != fixture.UpdateCommit || page2[1].Hash != fixture.InitialCommit {
		t.Fatalf("unexpected page2 order: %+v", page2)
	}
}

func TestParseWorkspaceStatusPorcelainV2(t *testing.T) {
	t.Parallel()
	raw := []byte(
		"# branch.head main\x00" +
			"# branch.upstream origin/main\x00" +
			"# branch.ab +2 -1\x00" +
			"1 M. N... 100644 100644 100644 abc def src/staged.txt\x00" +
			"1 .M N... 100644 100644 100644 abc def src/unstaged.txt\x00" +
			"2 R. N... 100644 100644 100644 abc def R100 src/new.txt\x00src/old.txt\x00" +
			"u UU N... 100644 100644 100644 100644 aaa bbb ccc src/conflict.txt\x00" +
			"? notes/todo.txt\x00",
	)

	snapshot := parseWorkspaceStatusPorcelainV2(raw)
	if snapshot.HeadRef != "main" {
		t.Fatalf("HeadRef=%q, want main", snapshot.HeadRef)
	}
	if snapshot.UpstreamRef != "origin/main" {
		t.Fatalf("UpstreamRef=%q, want origin/main", snapshot.UpstreamRef)
	}
	if snapshot.AheadCount != 2 || snapshot.BehindCount != 1 {
		t.Fatalf("ahead/behind=%d/%d, want 2/1", snapshot.AheadCount, snapshot.BehindCount)
	}
	if len(snapshot.Staged) != 2 {
		t.Fatalf("staged=%d, want 2", len(snapshot.Staged))
	}
	if len(snapshot.Unstaged) != 1 {
		t.Fatalf("unstaged=%d, want 1", len(snapshot.Unstaged))
	}
	if len(snapshot.Conflicted) != 1 {
		t.Fatalf("conflicted=%d, want 1", len(snapshot.Conflicted))
	}
	if len(snapshot.Untracked) != 1 {
		t.Fatalf("untracked=%d, want 1", len(snapshot.Untracked))
	}
	if snapshot.Staged[1].ChangeType != "renamed" || snapshot.Staged[1].OldPath != "src/old.txt" || snapshot.Staged[1].NewPath != "src/new.txt" {
		t.Fatalf("unexpected rename item: %+v", snapshot.Staged[1])
	}
	if snapshot.Untracked[0].Path != "notes/todo.txt" {
		t.Fatalf("unexpected untracked path: %+v", snapshot.Untracked[0])
	}
}

func TestParseBranchListOutput(t *testing.T) {
	t.Parallel()
	out := []byte(
		"refs/heads/main\x00main\x00abc123\x001706000000\x00Alice\x00Base commit\x00origin/main\x00[ahead 2, behind 1]\x1e" +
			"refs/heads/feature/demo\x00feature/demo\x00def456\x001706000100\x00Bob\x00Feature commit\x00origin/feature/demo\x00[gone]\x1e" +
			"refs/remotes/origin/main\x00origin/main\x00abc123\x001706000000\x00Alice\x00Remote base\x00\x00\x1e" +
			"refs/remotes/origin/HEAD\x00origin/HEAD\x00abc123\x001706000000\x00Alice\x00HEAD\x00\x00\x1e",
	)

	local, remote := parseBranchListOutput(out, repoContext{headRef: "main"}, map[string]worktreeBinding{
		"refs/heads/feature/demo": {Ref: "refs/heads/feature/demo", Path: "/tmp/feature-demo"},
	})
	if len(local) != 2 {
		t.Fatalf("local=%d, want 2", len(local))
	}
	if len(remote) != 1 {
		t.Fatalf("remote=%d, want 1", len(remote))
	}
	if !local[0].Current || local[0].AheadCount != 2 || local[0].BehindCount != 1 {
		t.Fatalf("unexpected main branch summary: %+v", local[0])
	}
	if local[1].Name != "feature/demo" || !local[1].UpstreamGone || local[1].WorktreePath != "/tmp/feature-demo" {
		t.Fatalf("unexpected feature branch summary: %+v", local[1])
	}
	if remote[0].Kind != "remote" || remote[0].Name != "origin/main" {
		t.Fatalf("unexpected remote branch summary: %+v", remote[0])
	}
}

func TestListBranches_ReportsWorktreeBinding(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.UpdateCommit)
	worktree := filepath.Join(t.TempDir(), "compare-wt")
	runGitFixture(t, fixture.Root, "worktree", "add", worktree, compare.Branch)

	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), "/")
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}
	resp, err := svc.listBranches(context.Background(), repo)
	if err != nil {
		t.Fatalf("listBranches: %v", err)
	}
	if resp.CurrentRef != compare.BaseBranch {
		t.Fatalf("CurrentRef=%q, want %q", resp.CurrentRef, compare.BaseBranch)
	}

	var found bool
	for _, branch := range resp.Local {
		if branch.Name != compare.Branch {
			continue
		}
		found = true
		gotWorktree, err := filepath.EvalSymlinks(branch.WorktreePath)
		if err != nil {
			t.Fatalf("EvalSymlinks(branch.WorktreePath): %v", err)
		}
		wantWorktree, err := filepath.EvalSymlinks(worktree)
		if err != nil {
			t.Fatalf("EvalSymlinks(worktree): %v", err)
		}
		if filepath.Clean(gotWorktree) != filepath.Clean(wantWorktree) {
			t.Fatalf("WorktreePath=%q, want %q", gotWorktree, wantWorktree)
		}
		if branch.Current {
			t.Fatalf("feature branch should not be current: %+v", branch)
		}
	}
	if !found {
		t.Fatalf("expected branch %q in local list: %+v", compare.Branch, resp.Local)
	}
}

func TestGetBranchCompare(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.UpdateCommit)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), "/")
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	resp, err := svc.getBranchCompare(context.Background(), repo, compare.BaseBranch, compare.Branch, 10)
	if err != nil {
		t.Fatalf("getBranchCompare: %v", err)
	}
	if resp.MergeBase != fixture.UpdateCommit {
		t.Fatalf("MergeBase=%q, want %q", resp.MergeBase, fixture.UpdateCommit)
	}
	if resp.TargetAheadCount != 1 || resp.TargetBehindCount != 2 {
		t.Fatalf("ahead/behind=%d/%d, want 1/2", resp.TargetAheadCount, resp.TargetBehindCount)
	}
	if len(resp.Commits) != 1 || resp.Commits[0].Hash != compare.Commit {
		t.Fatalf("unexpected compare commits: %+v", resp.Commits)
	}
	foundFile := false
	for _, file := range resp.Files {
		if file.Path == compare.FilePath && file.ChangeType == "added" {
			foundFile = true
			break
		}
	}
	if !foundFile {
		t.Fatalf("expected compare file %q in diff files: %+v", compare.FilePath, resp.Files)
	}
}
