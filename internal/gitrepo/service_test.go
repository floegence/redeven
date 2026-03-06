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
