package gitutil

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestResolveTopLevelClassifiesOnlyConfirmedNonRepository(t *testing.T) {
	root, err := ResolveTopLevel(t.Context(), t.TempDir())
	if root != "" || !errors.Is(err, ErrNotRepository) {
		t.Fatalf("non-repository root=%q err=%v", root, err)
	}
	for _, tc := range []struct {
		name, script string
		wantNotRepo  bool
	}{
		{"ordinary", "echo 'fatal: not a git repository (or any of the parent directories): .git' >&2; exit 128", true},
		{"filesystem boundary", "echo 'fatal: not a git repository (or any parent up to mount point /Volumes)' >&2; echo 'Stopping at filesystem boundary (GIT_DISCOVERY_ACROSS_FILESYSTEM not set).' >&2; exit 128", true},
		{"unexpected exit", "echo 'fatal: not a git repository (or any of the parent directories): .git' >&2; exit 97", false},
		{"corrupt metadata", "echo 'fatal: invalid gitfile format: .git' >&2; exit 128", false},
		{"unsafe ownership", "echo 'fatal: detected dubious ownership in repository' >&2; exit 128", false},
		{"empty success", "exit 0", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			bin := t.TempDir()
			if err := os.WriteFile(filepath.Join(bin, "git"), []byte("#!/bin/sh\n"+tc.script+"\n"), 0o755); err != nil {
				t.Fatal(err)
			}
			t.Setenv("PATH", bin)
			root, err := ResolveTopLevel(t.Context(), bin)
			if root != "" || err == nil || errors.Is(err, ErrNotRepository) != tc.wantNotRepo {
				t.Fatalf("root=%q err=%v wantNotRepo=%t", root, err, tc.wantNotRepo)
			}
		})
	}
}

func TestResolveTopLevelPreservesUnavailableAndCancellation(t *testing.T) {
	bin := t.TempDir()
	t.Setenv("PATH", bin)
	if _, err := ResolveTopLevel(t.Context(), bin); !IsGitUnavailable(err) || errors.Is(err, ErrNotRepository) {
		t.Fatalf("missing git classified incorrectly: %v", err)
	}
	if err := os.WriteFile(filepath.Join(bin, "git"), []byte("#!/bin/sh\nexec /bin/sleep 30\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
	defer cancel()
	if _, err := ResolveTopLevel(ctx, bin); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("timeout lost: %v", err)
	}
	ctx, cancel = context.WithCancel(t.Context())
	cancel()
	if _, err := ResolveTopLevel(ctx, bin); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation lost: %v", err)
	}
	if _, err := ResolveTopLevel(t.Context(), " "); err == nil {
		t.Fatal("empty directory accepted")
	}
}

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
