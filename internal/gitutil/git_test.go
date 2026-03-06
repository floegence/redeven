package gitutil

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func runGitForTest(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Tester",
		"GIT_AUTHOR_EMAIL=tester@example.com",
		"GIT_COMMITTER_NAME=Tester",
		"GIT_COMMITTER_EMAIL=tester@example.com",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v\n%s", strings.Join(args, " "), err, string(out))
	}
	return strings.TrimSpace(string(out))
}

func initRepoForTest(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	runGitForTest(t, dir, "init")
	runGitForTest(t, dir, "config", "user.name", "Tester")
	runGitForTest(t, dir, "config", "user.email", "tester@example.com")
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("hello\n"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	runGitForTest(t, dir, "add", "README.md")
	runGitForTest(t, dir, "commit", "-m", "initial")
	return dir
}

func TestShowTopLevel_Repository(t *testing.T) {
	t.Parallel()
	repo := initRepoForTest(t)
	subdir := filepath.Join(repo, "nested")
	if err := os.MkdirAll(subdir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	root, ok := ShowTopLevel(context.Background(), subdir)
	if !ok {
		t.Fatalf("ShowTopLevel should detect repository")
	}
	if filepath.Clean(root) != filepath.Clean(repo) {
		t.Fatalf("root=%q, want %q", root, repo)
	}
}

func TestShowTopLevel_NonRepository(t *testing.T) {
	t.Parallel()
	root, ok := ShowTopLevel(context.Background(), t.TempDir())
	if ok || root != "" {
		t.Fatalf("expected non-repo directory to return false")
	}
}

func TestShowTopLevel_Worktree(t *testing.T) {
	t.Parallel()
	repo := initRepoForTest(t)
	branch := "feat-worktree-test"
	worktree := filepath.Join(t.TempDir(), "wt")
	runGitForTest(t, repo, "branch", branch)
	runGitForTest(t, repo, "worktree", "add", worktree, branch)
	root, ok := ShowTopLevel(context.Background(), worktree)
	if !ok {
		t.Fatalf("ShowTopLevel should detect worktree")
	}
	if filepath.Clean(root) != filepath.Clean(worktree) {
		t.Fatalf("root=%q, want %q", root, worktree)
	}
}
