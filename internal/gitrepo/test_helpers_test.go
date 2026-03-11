package gitrepo

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

type testRepoFixture struct {
	Root          string
	InitialCommit string
	UpdateCommit  string
	RenameCommit  string
	BinaryCommit  string
}

func runGitFixture(t *testing.T, dir string, args ...string) string {
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

func writeFixtureFile(t *testing.T, root string, relative string, data []byte) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(relative))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", relative, err)
	}
	if err := os.WriteFile(full, data, 0o644); err != nil {
		t.Fatalf("write %s: %v", relative, err)
	}
}

func createTestRepoFixture(t *testing.T) testRepoFixture {
	t.Helper()
	root := t.TempDir()
	runGitFixture(t, root, "init")
	runGitFixture(t, root, "config", "user.name", "Tester")
	runGitFixture(t, root, "config", "user.email", "tester@example.com")

	writeFixtureFile(t, root, "README.md", []byte("hello\n"))
	runGitFixture(t, root, "add", "README.md")
	runGitFixture(t, root, "commit", "-m", "initial")
	initial := runGitFixture(t, root, "rev-parse", "HEAD")

	writeFixtureFile(t, root, "src/app.txt", []byte("one\ntwo\n"))
	runGitFixture(t, root, "add", "src/app.txt")
	runGitFixture(t, root, "commit", "-m", "update app")
	update := runGitFixture(t, root, "rev-parse", "HEAD")

	runGitFixture(t, root, "mv", "src/app.txt", "src/main.txt")
	runGitFixture(t, root, "commit", "-m", "rename app")
	rename := runGitFixture(t, root, "rev-parse", "HEAD")

	if err := os.Remove(filepath.Join(root, "README.md")); err != nil {
		t.Fatalf("remove README: %v", err)
	}
	writeFixtureFile(t, root, "bin/data.bin", []byte{0x00, 0x01, 0x02, 0x03, 0x04})
	runGitFixture(t, root, "add", "-A")
	runGitFixture(t, root, "commit", "-m", "binary cleanup")
	binary := runGitFixture(t, root, "rev-parse", "HEAD")

	return testRepoFixture{
		Root:          root,
		InitialCommit: initial,
		UpdateCommit:  update,
		RenameCommit:  rename,
		BinaryCommit:  binary,
	}
}

type comparisonBranchFixture struct {
	BaseBranch string
	Branch     string
	Commit     string
	FilePath   string
}

type workspaceChangesFixture struct {
	TrackedPath   string
	UntrackedPath string
}

type workspaceConflictFixture struct {
	ConflictPath string
}

type remoteSyncFixture struct {
	RemoteRoot          string
	BaseBranch          string
	IncomingCommit      string
	RemoteFeatureBranch string
	RemoteFeatureCommit string
}

func createComparisonBranchFixture(t *testing.T, root string, startPoint string) comparisonBranchFixture {
	t.Helper()
	baseBranch := runGitFixture(t, root, "rev-parse", "--abbrev-ref", "HEAD")
	branchName := "feature/compare"
	filePath := "feature/branch-only.txt"

	runGitFixture(t, root, "checkout", "-b", branchName, startPoint)
	writeFixtureFile(t, root, filePath, []byte("feature branch\n"))
	runGitFixture(t, root, "add", filePath)
	runGitFixture(t, root, "commit", "-m", "feature branch change")
	commit := runGitFixture(t, root, "rev-parse", "HEAD")
	runGitFixture(t, root, "checkout", baseBranch)

	return comparisonBranchFixture{
		BaseBranch: baseBranch,
		Branch:     branchName,
		Commit:     commit,
		FilePath:   filePath,
	}
}

func createWorkspaceChangesFixture(t *testing.T, root string) workspaceChangesFixture {
	t.Helper()
	trackedPath := "src/main.txt"
	untrackedPath := "todo.txt"

	writeFixtureFile(t, root, trackedPath, []byte("one\ntwo\nstaged\n"))
	runGitFixture(t, root, "add", trackedPath)
	writeFixtureFile(t, root, trackedPath, []byte("one\ntwo\nstaged\nunstaged\n"))
	writeFixtureFile(t, root, untrackedPath, []byte("todo\n"))

	return workspaceChangesFixture{
		TrackedPath:   trackedPath,
		UntrackedPath: untrackedPath,
	}
}

func createWorkspaceConflictFixture(t *testing.T, root string) workspaceConflictFixture {
	t.Helper()
	conflictPath := "src/conflict.txt"

	writeFixtureFile(t, root, conflictPath, []byte("base\n"))
	runGitFixture(t, root, "add", conflictPath)
	runGitFixture(t, root, "commit", "-m", "add conflict base")

	runGitFixture(t, root, "checkout", "-b", "feature/conflict")
	writeFixtureFile(t, root, conflictPath, []byte("feature\n"))
	runGitFixture(t, root, "add", conflictPath)
	runGitFixture(t, root, "commit", "-m", "feature conflict change")

	runGitFixture(t, root, "checkout", "master")
	writeFixtureFile(t, root, conflictPath, []byte("main\n"))
	runGitFixture(t, root, "add", conflictPath)
	runGitFixture(t, root, "commit", "-m", "main conflict change")

	cmd := exec.Command("git", "-C", root, "merge", "feature/conflict")
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Tester",
		"GIT_AUTHOR_EMAIL=tester@example.com",
		"GIT_COMMITTER_NAME=Tester",
		"GIT_COMMITTER_EMAIL=tester@example.com",
	)
	out, err := cmd.CombinedOutput()
	if err == nil {
		t.Fatalf("expected merge conflict, got success\n%s", string(out))
	}

	return workspaceConflictFixture{ConflictPath: conflictPath}
}

func createRemoteSyncFixture(t *testing.T, root string) remoteSyncFixture {
	t.Helper()
	baseBranch := runGitFixture(t, root, "rev-parse", "--abbrev-ref", "HEAD")
	tempRoot := t.TempDir()
	remoteRoot := filepath.Join(tempRoot, "origin.git")
	cloneRoot := filepath.Join(tempRoot, "origin-clone")
	featureBranch := "feature/remote-checkout"

	runGitFixture(t, tempRoot, "init", "--bare", remoteRoot)
	runGitFixture(t, root, "remote", "add", "origin", remoteRoot)
	runGitFixture(t, root, "push", "-u", "origin", baseBranch)
	runGitFixture(t, tempRoot, "clone", remoteRoot, cloneRoot)
	runGitFixture(t, cloneRoot, "config", "user.name", "Tester")
	runGitFixture(t, cloneRoot, "config", "user.email", "tester@example.com")

	writeFixtureFile(t, cloneRoot, "remote/incoming.txt", []byte("incoming\n"))
	runGitFixture(t, cloneRoot, "add", "remote/incoming.txt")
	runGitFixture(t, cloneRoot, "commit", "-m", "remote incoming")
	incomingCommit := runGitFixture(t, cloneRoot, "rev-parse", "HEAD")
	runGitFixture(t, cloneRoot, "push", "origin", baseBranch)

	runGitFixture(t, cloneRoot, "checkout", "-b", featureBranch)
	writeFixtureFile(t, cloneRoot, "remote/checkout.txt", []byte("remote checkout branch\n"))
	runGitFixture(t, cloneRoot, "add", "remote/checkout.txt")
	runGitFixture(t, cloneRoot, "commit", "-m", "remote checkout branch")
	remoteFeatureCommit := runGitFixture(t, cloneRoot, "rev-parse", "HEAD")
	runGitFixture(t, cloneRoot, "push", "-u", "origin", featureBranch)

	return remoteSyncFixture{
		RemoteRoot:          remoteRoot,
		BaseBranch:          baseBranch,
		IncomingCommit:      incomingCommit,
		RemoteFeatureBranch: featureBranch,
		RemoteFeatureCommit: remoteFeatureCommit,
	}
}
