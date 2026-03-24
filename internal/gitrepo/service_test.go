package gitrepo

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven-agent/internal/gitutil"
)

func mustEvalPath(t *testing.T, value string) string {
	t.Helper()
	resolved, err := filepath.EvalSymlinks(value)
	if err != nil {
		t.Fatalf("filepath.EvalSymlinks(%q): %v", value, err)
	}
	return filepath.Clean(resolved)
}

func mustPreviewDeleteBranch(
	t *testing.T,
	svc *Service,
	repo repoContext,
	name string,
	fullName string,
	kind string,
) *previewDeleteBranchResp {
	t.Helper()
	resp, err := svc.previewDeleteBranch(context.Background(), repo, name, fullName, kind)
	if err != nil {
		t.Fatalf("previewDeleteBranch(%s): %v", name, err)
	}
	return resp
}

func mustPreviewMergeBranch(
	t *testing.T,
	svc *Service,
	repo repoContext,
	name string,
	fullName string,
	kind string,
) *previewMergeBranchResp {
	t.Helper()
	resp, err := svc.previewMergeBranch(context.Background(), repo, name, fullName, kind)
	if err != nil {
		t.Fatalf("previewMergeBranch(%s): %v", name, err)
	}
	return resp
}

func TestResolveRepoForPath(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	svc := NewService(fixture.Root)

	result, err := svc.resolveRepoForPath(context.Background(), filepath.Join(fixture.Root, "src"))
	if err != nil {
		t.Fatalf("resolveRepoForPath: %v", err)
	}
	if !result.Available {
		t.Fatalf("expected repository to be available")
	}
	repo := result.Repo
	if mustEvalPath(t, repo.repoRootReal) != mustEvalPath(t, fixture.Root) {
		t.Fatalf("repoRootReal=%q, want %q", repo.repoRootReal, fixture.Root)
	}
	if repo.headCommit != fixture.BinaryCommit {
		t.Fatalf("headCommit=%q, want %q", repo.headCommit, fixture.BinaryCommit)
	}
	if !result.GitAvailable || result.UnavailableReason != "" {
		t.Fatalf("expected git to be available without an unavailable reason: %+v", result)
	}
}

func TestResolveRepoForPath_NonRepository(t *testing.T) {
	t.Parallel()
	svc := NewService(t.TempDir())
	result, err := svc.resolveRepoForPath(context.Background(), "")
	if err != nil {
		t.Fatalf("resolveRepoForPath(non-repo): %v", err)
	}
	if result.Available {
		t.Fatalf("expected non-repository path to be unavailable")
	}
	if !result.GitAvailable {
		t.Fatalf("expected git capability to remain available for non-repository paths: %+v", result)
	}
	if got := result.UnavailableReason; got != "Current path is not inside a Git repository." {
		t.Fatalf("unexpected unavailable reason: %q", got)
	}
}

func TestResolveRepoForPath_GitUnavailable(t *testing.T) {
	fixture := createTestRepoFixture(t)
	svc := NewService(fixture.Root)
	t.Setenv("PATH", t.TempDir())

	result, err := svc.resolveRepoForPath(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveRepoForPath(git unavailable): %v", err)
	}
	if result.Available {
		t.Fatalf("expected repository to be unavailable without git: %+v", result)
	}
	if result.GitAvailable {
		t.Fatalf("expected git capability to be unavailable: %+v", result)
	}
	if got := result.UnavailableReason; got != gitUnavailableReason {
		t.Fatalf("unexpected unavailable reason: %q", got)
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
	result, err := svc.resolveRepoForPath(context.Background(), worktree)
	if err != nil {
		t.Fatalf("resolveRepoForPath(worktree): %v", err)
	}
	if !result.Available {
		t.Fatalf("expected worktree repository to be available")
	}
	repo := result.Repo
	if mustEvalPath(t, repo.repoRootReal) != mustEvalPath(t, worktree) {
		t.Fatalf("repoRootReal=%q, want %q", repo.repoRootReal, worktree)
	}
}

func TestGetCommitDetail_RenameAndBinary(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
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
	if files[0].DisplayPath != "src/main.txt" || !strings.Contains(files[0].PatchText, "diff --git") || !strings.Contains(files[0].PatchText, "rename to src/main.txt") {
		t.Fatalf("rename patch text not embedded correctly: %+v", files[0])
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
			foundBinary = strings.TrimSpace(file.PatchText) != ""
		}
		if file.Path == "README.md" && file.ChangeType == "deleted" {
			foundDeleted = strings.Contains(file.PatchText, "diff --git")
		}
	}
	if !foundBinary {
		t.Fatalf("expected binary file summary in commit detail")
	}
	if !foundDeleted {
		t.Fatalf("expected deleted README summary in commit detail")
	}
}

func TestGetFullContextDiff_CommitRenamePreservesRenameMetadata(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	resp, err := svc.getFullContextDiff(context.Background(), repo, getFullContextDiffReq{
		RepoRootPath: fixture.Root,
		SourceKind:   "commit",
		Commit:       fixture.RenameCommit,
		File: gitDiffFileRef{
			ChangeType: "renamed",
			Path:       "src/main.txt",
			OldPath:    "src/app.txt",
			NewPath:    "src/main.txt",
		},
	})
	if err != nil {
		t.Fatalf("getFullContextDiff(rename): %v", err)
	}
	if resp.File.ChangeType != "renamed" || resp.File.OldPath != "src/app.txt" || resp.File.NewPath != "src/main.txt" {
		t.Fatalf("unexpected rename summary: %+v", resp.File)
	}
	if !strings.Contains(resp.File.PatchText, "rename from src/app.txt") || !strings.Contains(resp.File.PatchText, "rename to src/main.txt") {
		t.Fatalf("rename metadata missing from full-context diff: %+v", resp.File)
	}
	if strings.Contains(resp.File.PatchText, "new file mode") {
		t.Fatalf("rename diff should not degrade into an added file view: %+v", resp.File)
	}
}

func TestGetFullContextDiff_WorkspaceUnstagedIncludesFullFileContext(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	writeFixtureFile(t, fixture.Root, "src/context.txt", []byte(strings.Join([]string{
		"line-1",
		"line-2",
		"line-3",
		"line-4",
		"line-5",
		"line-6",
		"line-7",
		"line-8",
		"",
	}, "\n")))
	runGitFixture(t, fixture.Root, "add", "src/context.txt")
	runGitFixture(t, fixture.Root, "commit", "-m", "add full context fixture")
	writeFixtureFile(t, fixture.Root, "src/context.txt", []byte(strings.Join([]string{
		"line-1",
		"line-2",
		"line-3",
		"line-4 updated",
		"line-5",
		"line-6",
		"line-7",
		"line-8",
		"",
	}, "\n")))

	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	resp, err := svc.getFullContextDiff(context.Background(), repo, getFullContextDiffReq{
		RepoRootPath:     fixture.Root,
		SourceKind:       "workspace",
		WorkspaceSection: "unstaged",
		File: gitDiffFileRef{
			ChangeType: "modified",
			Path:       "src/context.txt",
			NewPath:    "src/context.txt",
		},
	})
	if err != nil {
		t.Fatalf("getFullContextDiff(unstaged): %v", err)
	}
	if !strings.Contains(resp.File.PatchText, "@@ -1,8 +1,8 @@") {
		t.Fatalf("full-context patch should expand to the whole file hunk: %+v", resp.File)
	}
	if !strings.Contains(resp.File.PatchText, " line-8") {
		t.Fatalf("full-context patch should include trailing unchanged lines outside the compact patch window: %+v", resp.File)
	}
	if !strings.Contains(resp.File.PatchText, "+line-4 updated") {
		t.Fatalf("updated line missing from full-context patch: %+v", resp.File)
	}
}

func TestListWorkspaceChanges_EmbedsPatchText(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	workspace := createWorkspaceChangesFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	resp, err := svc.listWorkspaceChanges(context.Background(), repo)
	if err != nil {
		t.Fatalf("listWorkspaceChanges: %v", err)
	}
	if len(resp.Staged) != 1 || !strings.Contains(resp.Staged[0].PatchText, "+staged") {
		t.Fatalf("staged patch text not embedded: %+v", resp.Staged)
	}
	if len(resp.Unstaged) != 1 || !strings.Contains(resp.Unstaged[0].PatchText, "+unstaged") {
		t.Fatalf("unstaged patch text not embedded: %+v", resp.Unstaged)
	}
	if len(resp.Untracked) != 1 || resp.Untracked[0].Path != workspace.UntrackedPath {
		t.Fatalf("unexpected untracked entry: %+v", resp.Untracked)
	}
	if !strings.Contains(resp.Untracked[0].PatchText, "diff --git a/todo.txt b/todo.txt") || !strings.Contains(resp.Untracked[0].PatchText, "+todo") {
		t.Fatalf("untracked patch text not embedded: %+v", resp.Untracked[0])
	}
	if resp.Untracked[0].Additions != 1 || resp.Untracked[0].Deletions != 0 {
		t.Fatalf("unexpected untracked metrics: %+v", resp.Untracked[0])
	}
	if resp.Staged[0].DisplayPath != workspace.TrackedPath || resp.Unstaged[0].DisplayPath != workspace.TrackedPath {
		t.Fatalf("workspace display path mismatch: staged=%+v unstaged=%+v", resp.Staged[0], resp.Unstaged[0])
	}
	if len(resp.Conflicted) != 0 || resp.Summary.ConflictedCount != 0 {
		t.Fatalf("ordinary unstaged changes must not be classified as conflicted: %+v", resp)
	}
}

func TestListWorkspaceChanges_DoesNotClassifyOrdinaryDiffAsConflicted(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	createWorkspaceChangesFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	resp, err := svc.listWorkspaceChanges(context.Background(), repo)
	if err != nil {
		t.Fatalf("listWorkspaceChanges: %v", err)
	}
	if len(resp.Unstaged) != 1 {
		t.Fatalf("unstaged=%d, want 1", len(resp.Unstaged))
	}
	if len(resp.Conflicted) != 0 {
		t.Fatalf("conflicted=%d, want 0; resp=%+v", len(resp.Conflicted), resp.Conflicted)
	}
	if resp.Summary.ConflictedCount != 0 {
		t.Fatalf("conflicted_count=%d, want 0", resp.Summary.ConflictedCount)
	}
}

func TestListWorkspaceChanges_ReportsOnlyRealConflictsInConflictedSection(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	conflict := createWorkspaceConflictFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	resp, err := svc.listWorkspaceChanges(context.Background(), repo)
	if err != nil {
		t.Fatalf("listWorkspaceChanges: %v", err)
	}
	if len(resp.Conflicted) != 1 || resp.Summary.ConflictedCount != 1 {
		t.Fatalf("unexpected conflicted payload: summary=%+v conflicted=%+v", resp.Summary, resp.Conflicted)
	}
	if resp.Conflicted[0].Path != conflict.ConflictPath || resp.Conflicted[0].DisplayPath != conflict.ConflictPath {
		t.Fatalf("unexpected conflicted path: %+v", resp.Conflicted[0])
	}
	if resp.Conflicted[0].ChangeType != "conflicted" {
		t.Fatalf("changeType=%q, want conflicted", resp.Conflicted[0].ChangeType)
	}
	if !strings.Contains(resp.Conflicted[0].PatchText, "diff --cc") {
		t.Fatalf("expected combined diff patch text, got: %q", resp.Conflicted[0].PatchText)
	}
	if len(resp.Unstaged) != 0 {
		t.Fatalf("conflicted file must not also leak into unstaged: %+v", resp.Unstaged)
	}
}

func TestStageAndUnstageWorkspacePaths(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	workspace := createWorkspaceChangesFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	if err := svc.stageWorkspacePaths(context.Background(), repo, []string{workspace.TrackedPath, workspace.UntrackedPath}); err != nil {
		t.Fatalf("stageWorkspacePaths: %v", err)
	}
	stagedResp, err := svc.listWorkspaceChanges(context.Background(), repo)
	if err != nil {
		t.Fatalf("listWorkspaceChanges(after stage): %v", err)
	}
	if stagedResp.Summary.StagedCount != 2 || stagedResp.Summary.UnstagedCount != 0 || stagedResp.Summary.UntrackedCount != 0 {
		t.Fatalf("unexpected staged summary: %+v", stagedResp.Summary)
	}

	if err := svc.unstageWorkspacePaths(context.Background(), repo, []string{workspace.UntrackedPath}); err != nil {
		t.Fatalf("unstageWorkspacePaths: %v", err)
	}
	unstagedResp, err := svc.listWorkspaceChanges(context.Background(), repo)
	if err != nil {
		t.Fatalf("listWorkspaceChanges(after unstage): %v", err)
	}
	if unstagedResp.Summary.StagedCount != 1 || unstagedResp.Summary.UntrackedCount != 1 {
		t.Fatalf("unexpected unstaged summary: %+v", unstagedResp.Summary)
	}
}

func TestCommitWorkspace_UsesStagedChanges(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	workspace := createWorkspaceChangesFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	if err := svc.stageWorkspacePaths(context.Background(), repo, []string{workspace.TrackedPath, workspace.UntrackedPath}); err != nil {
		t.Fatalf("stageWorkspacePaths: %v", err)
	}
	commitResp, err := svc.commitWorkspace(context.Background(), repo, "ship staged workspace changes")
	if err != nil {
		t.Fatalf("commitWorkspace: %v", err)
	}
	if strings.TrimSpace(commitResp.HeadCommit) == "" {
		t.Fatalf("expected head commit after commit")
	}

	updatedRepo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo(after commit): %v", err)
	}
	workspaceResp, err := svc.listWorkspaceChanges(context.Background(), updatedRepo)
	if err != nil {
		t.Fatalf("listWorkspaceChanges(after commit): %v", err)
	}
	if workspaceResp.Summary.StagedCount != 0 || workspaceResp.Summary.UnstagedCount != 0 || workspaceResp.Summary.UntrackedCount != 0 {
		t.Fatalf("expected clean workspace after commit: %+v", workspaceResp.Summary)
	}

	commits, _, _, err := svc.listCommits(context.Background(), updatedRepo, "", 0, 1)
	if err != nil {
		t.Fatalf("listCommits(after commit): %v", err)
	}
	if len(commits) != 1 || commits[0].Subject != "ship staged workspace changes" {
		t.Fatalf("unexpected latest commit: %+v", commits)
	}
}

func TestFetchRepo_UpdatesRemoteTrackingRefs(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	remote := createRemoteSyncFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	resp, err := svc.fetchRepo(context.Background(), repo)
	if err != nil {
		t.Fatalf("fetchRepo: %v", err)
	}
	if resp.HeadRef != remote.BaseBranch {
		t.Fatalf("HeadRef=%q, want %q", resp.HeadRef, remote.BaseBranch)
	}
	remoteHead := runGitFixture(t, fixture.Root, "rev-parse", "refs/remotes/origin/"+remote.BaseBranch)
	if remoteHead != remote.IncomingCommit {
		t.Fatalf("remote tracking head=%q, want %q", remoteHead, remote.IncomingCommit)
	}
}

func TestPullRepo_FastForwardsCurrentBranch(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	remote := createRemoteSyncFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	resp, err := svc.pullRepo(context.Background(), repo)
	if err != nil {
		t.Fatalf("pullRepo: %v", err)
	}
	if resp.HeadCommit != remote.IncomingCommit {
		t.Fatalf("HeadCommit=%q, want %q", resp.HeadCommit, remote.IncomingCommit)
	}
	localHead := runGitFixture(t, fixture.Root, "rev-parse", "HEAD")
	if localHead != remote.IncomingCommit {
		t.Fatalf("local HEAD=%q, want %q", localHead, remote.IncomingCommit)
	}
}

func TestPushRepo_PushesCurrentBranch(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	remote := createRemoteSyncFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}
	if _, err := svc.pullRepo(context.Background(), repo); err != nil {
		t.Fatalf("pullRepo: %v", err)
	}

	writeFixtureFile(t, fixture.Root, "src/pushed.txt", []byte("push me\n"))
	runGitFixture(t, fixture.Root, "add", "src/pushed.txt")
	runGitFixture(t, fixture.Root, "commit", "-m", "push local change")

	updatedRepo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo(after commit): %v", err)
	}
	resp, err := svc.pushRepo(context.Background(), updatedRepo)
	if err != nil {
		t.Fatalf("pushRepo: %v", err)
	}
	localHead := runGitFixture(t, fixture.Root, "rev-parse", "HEAD")
	remoteHead := runGitFixture(t, remote.RemoteRoot, "rev-parse", "refs/heads/"+remote.BaseBranch)
	if resp.HeadCommit != localHead {
		t.Fatalf("HeadCommit=%q, want %q", resp.HeadCommit, localHead)
	}
	if remoteHead != localHead {
		t.Fatalf("remote HEAD=%q, want %q", remoteHead, localHead)
	}
}

func TestCheckoutBranch_ChecksOutLocalBranch(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.UpdateCommit)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	resp, err := svc.checkoutBranch(context.Background(), repo, compare.Branch, "refs/heads/"+compare.Branch, "local")
	if err != nil {
		t.Fatalf("checkoutBranch(local): %v", err)
	}
	if resp.HeadRef != compare.Branch {
		t.Fatalf("HeadRef=%q, want %q", resp.HeadRef, compare.Branch)
	}
	current := runGitFixture(t, fixture.Root, "rev-parse", "--abbrev-ref", "HEAD")
	if current != compare.Branch {
		t.Fatalf("current branch=%q, want %q", current, compare.Branch)
	}
}

func TestCheckoutBranch_RemoteCreatesTrackingBranch(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	remote := createRemoteSyncFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}
	if _, err := svc.fetchRepo(context.Background(), repo); err != nil {
		t.Fatalf("fetchRepo: %v", err)
	}
	repo, err = svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo(after fetch): %v", err)
	}

	remoteName := "origin/" + remote.RemoteFeatureBranch
	resp, err := svc.checkoutBranch(context.Background(), repo, remoteName, "refs/remotes/"+remoteName, "remote")
	if err != nil {
		t.Fatalf("checkoutBranch(remote): %v", err)
	}
	if resp.HeadRef != remote.RemoteFeatureBranch {
		t.Fatalf("HeadRef=%q, want %q", resp.HeadRef, remote.RemoteFeatureBranch)
	}
	current := runGitFixture(t, fixture.Root, "rev-parse", "--abbrev-ref", "HEAD")
	if current != remote.RemoteFeatureBranch {
		t.Fatalf("current branch=%q, want %q", current, remote.RemoteFeatureBranch)
	}
	upstream := runGitFixture(t, fixture.Root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
	if upstream != remoteName {
		t.Fatalf("upstream=%q, want %q", upstream, remoteName)
	}
	localHead := runGitFixture(t, fixture.Root, "rev-parse", "HEAD")
	if localHead != remote.RemoteFeatureCommit {
		t.Fatalf("local HEAD=%q, want %q", localHead, remote.RemoteFeatureCommit)
	}
}

func TestPreviewMergeBranch_FastForward(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.BinaryCommit)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	resp := mustPreviewMergeBranch(t, svc, repo, compare.Branch, "refs/heads/"+compare.Branch, "local")
	if resp.Outcome != mergeBranchOutcomeFastForward {
		t.Fatalf("Outcome=%q, want %q", resp.Outcome, mergeBranchOutcomeFastForward)
	}
	if resp.CurrentRef != compare.BaseBranch {
		t.Fatalf("CurrentRef=%q, want %q", resp.CurrentRef, compare.BaseBranch)
	}
	if resp.SourceName != compare.Branch {
		t.Fatalf("SourceName=%q, want %q", resp.SourceName, compare.Branch)
	}
	if resp.MergeBase != fixture.BinaryCommit {
		t.Fatalf("MergeBase=%q, want %q", resp.MergeBase, fixture.BinaryCommit)
	}
	if resp.SourceAheadCount != 1 || resp.SourceBehindCount != 0 {
		t.Fatalf("unexpected ahead/behind counts: %+v", resp)
	}
	if resp.PlanFingerprint == "" {
		t.Fatalf("expected preview fingerprint")
	}
	if len(resp.Files) != 1 || resp.Files[0].Path != compare.FilePath {
		t.Fatalf("unexpected preview files: %+v", resp.Files)
	}
}

func TestPreviewMergeBranch_BlocksDirtyWorkspace(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.BinaryCommit)
	createWorkspaceChangesFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	resp := mustPreviewMergeBranch(t, svc, repo, compare.Branch, "refs/heads/"+compare.Branch, "local")
	if resp.Outcome != mergeBranchOutcomeBlocked {
		t.Fatalf("Outcome=%q, want %q", resp.Outcome, mergeBranchOutcomeBlocked)
	}
	if !strings.Contains(resp.BlockingReason, "Current workspace must be clean before merging") {
		t.Fatalf("unexpected blocking reason: %q", resp.BlockingReason)
	}
}

func TestPreviewMergeBranch_BlocksDetachedHead(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.BinaryCommit)
	runGitFixture(t, fixture.Root, "checkout", "--detach", fixture.BinaryCommit)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	resp := mustPreviewMergeBranch(t, svc, repo, compare.Branch, "refs/heads/"+compare.Branch, "local")
	if resp.Outcome != mergeBranchOutcomeBlocked {
		t.Fatalf("Outcome=%q, want %q", resp.Outcome, mergeBranchOutcomeBlocked)
	}
	if !strings.Contains(resp.BlockingReason, "Attach HEAD to a local branch before merging") {
		t.Fatalf("unexpected blocking reason: %q", resp.BlockingReason)
	}
}

func TestPreviewMergeBranch_BlocksSameBranch(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	fullName := "refs/heads/" + repo.headRef
	resp := mustPreviewMergeBranch(t, svc, repo, repo.headRef, fullName, "local")
	if resp.Outcome != mergeBranchOutcomeBlocked {
		t.Fatalf("Outcome=%q, want %q", resp.Outcome, mergeBranchOutcomeBlocked)
	}
	if !strings.Contains(resp.BlockingReason, "Select a different branch to merge into the current branch") {
		t.Fatalf("unexpected blocking reason: %q", resp.BlockingReason)
	}
}

func TestPreviewMergeBranch_BlocksInProgressOperation(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.BinaryCommit)
	mergeHeadPath := runGitFixture(t, fixture.Root, "rev-parse", "--git-path", "MERGE_HEAD")
	mergeHeadPath = strings.TrimSpace(mergeHeadPath)
	if !filepath.IsAbs(mergeHeadPath) {
		mergeHeadPath = filepath.Join(fixture.Root, mergeHeadPath)
	}
	if err := os.WriteFile(mergeHeadPath, []byte(compare.Commit+"\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(MERGE_HEAD): %v", err)
	}

	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	resp := mustPreviewMergeBranch(t, svc, repo, compare.Branch, "refs/heads/"+compare.Branch, "local")
	if resp.Outcome != mergeBranchOutcomeBlocked {
		t.Fatalf("Outcome=%q, want %q", resp.Outcome, mergeBranchOutcomeBlocked)
	}
	if !strings.Contains(resp.BlockingReason, "Finish the current merge before merging another branch") {
		t.Fatalf("unexpected blocking reason: %q", resp.BlockingReason)
	}
}

func TestMergeBranch_UpToDate(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.BinaryCommit)
	runGitFixture(t, fixture.Root, "merge", "--ff-only", compare.Branch)

	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	preview := mustPreviewMergeBranch(t, svc, repo, compare.Branch, "refs/heads/"+compare.Branch, "local")
	if preview.Outcome != mergeBranchOutcomeUpToDate {
		t.Fatalf("Outcome=%q, want %q", preview.Outcome, mergeBranchOutcomeUpToDate)
	}

	resp, err := svc.mergeBranch(context.Background(), repo, compare.Branch, "refs/heads/"+compare.Branch, "local", preview.PlanFingerprint)
	if err != nil {
		t.Fatalf("mergeBranch(up_to_date): %v", err)
	}
	if resp.Result != mergeBranchOutcomeUpToDate {
		t.Fatalf("Result=%q, want %q", resp.Result, mergeBranchOutcomeUpToDate)
	}
	if resp.HeadCommit != compare.Commit {
		t.Fatalf("HeadCommit=%q, want %q", resp.HeadCommit, compare.Commit)
	}
}

func TestMergeBranch_FastForward(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.BinaryCommit)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	preview := mustPreviewMergeBranch(t, svc, repo, compare.Branch, "refs/heads/"+compare.Branch, "local")
	if preview.Outcome != mergeBranchOutcomeFastForward {
		t.Fatalf("Outcome=%q, want %q", preview.Outcome, mergeBranchOutcomeFastForward)
	}

	resp, err := svc.mergeBranch(context.Background(), repo, compare.Branch, "refs/heads/"+compare.Branch, "local", preview.PlanFingerprint)
	if err != nil {
		t.Fatalf("mergeBranch(fast_forward): %v", err)
	}
	if resp.Result != mergeBranchOutcomeFastForward {
		t.Fatalf("Result=%q, want %q", resp.Result, mergeBranchOutcomeFastForward)
	}
	if resp.HeadRef != compare.BaseBranch {
		t.Fatalf("HeadRef=%q, want %q", resp.HeadRef, compare.BaseBranch)
	}
	if resp.HeadCommit != compare.Commit {
		t.Fatalf("HeadCommit=%q, want %q", resp.HeadCommit, compare.Commit)
	}
}

func TestMergeBranch_MergeCommit(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	mergeFixture := createMergeCommitBranchFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	preview := mustPreviewMergeBranch(t, svc, repo, mergeFixture.Branch, "refs/heads/"+mergeFixture.Branch, "local")
	if preview.Outcome != mergeBranchOutcomeMergeCommit {
		t.Fatalf("Outcome=%q, want %q", preview.Outcome, mergeBranchOutcomeMergeCommit)
	}

	resp, err := svc.mergeBranch(context.Background(), repo, mergeFixture.Branch, "refs/heads/"+mergeFixture.Branch, "local", preview.PlanFingerprint)
	if err != nil {
		t.Fatalf("mergeBranch(merge_commit): %v", err)
	}
	if resp.Result != mergeBranchOutcomeMergeCommit {
		t.Fatalf("Result=%q, want %q", resp.Result, mergeBranchOutcomeMergeCommit)
	}
	parents := strings.Fields(runGitFixture(t, fixture.Root, "show", "-s", "--format=%P", "HEAD"))
	if len(parents) != 2 {
		t.Fatalf("merge commit parents=%v, want 2 parents", parents)
	}
}

func TestMergeBranch_Conflicted(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	mergeFixture := createMergeConflictBranchFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	preview := mustPreviewMergeBranch(t, svc, repo, mergeFixture.Branch, "refs/heads/"+mergeFixture.Branch, "local")
	if preview.Outcome != mergeBranchOutcomeMergeCommit {
		t.Fatalf("Outcome=%q, want %q", preview.Outcome, mergeBranchOutcomeMergeCommit)
	}

	resp, err := svc.mergeBranch(context.Background(), repo, mergeFixture.Branch, "refs/heads/"+mergeFixture.Branch, "local", preview.PlanFingerprint)
	if err != nil {
		t.Fatalf("mergeBranch(conflicted): %v", err)
	}
	if resp.Result != mergeBranchResultConflicted {
		t.Fatalf("Result=%q, want %q", resp.Result, mergeBranchResultConflicted)
	}
	if resp.ConflictSummary.ConflictedCount != 1 {
		t.Fatalf("unexpected conflict summary: %+v", resp.ConflictSummary)
	}
	status, err := svc.readWorkspaceStatus(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("readWorkspaceStatus: %v", err)
	}
	if len(status.Conflicted) != 1 || status.Conflicted[0].Path != mergeFixture.ConflictPath {
		t.Fatalf("unexpected conflicted files: %+v", status.Conflicted)
	}
}

func TestMergeBranch_RejectsStalePlan(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.BinaryCommit)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	preview := mustPreviewMergeBranch(t, svc, repo, compare.Branch, "refs/heads/"+compare.Branch, "local")

	runGitFixture(t, fixture.Root, "checkout", compare.Branch)
	writeFixtureFile(t, fixture.Root, compare.FilePath, []byte("feature branch\nstale\n"))
	runGitFixture(t, fixture.Root, "add", compare.FilePath)
	runGitFixture(t, fixture.Root, "commit", "-m", "stale merge branch change")
	runGitFixture(t, fixture.Root, "checkout", compare.BaseBranch)

	repo, err = svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo(after branch update): %v", err)
	}

	_, err = svc.mergeBranch(context.Background(), repo, compare.Branch, "refs/heads/"+compare.Branch, "local", preview.PlanFingerprint)
	if err == nil {
		t.Fatalf("expected stale merge plan to fail")
	}
	if !strings.Contains(err.Error(), "merge plan is stale") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestDeleteBranch_DeletesMergedLocalBranch(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.BinaryCommit)
	runGitFixture(t, fixture.Root, "merge", "--ff-only", compare.Branch)

	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	preview := mustPreviewDeleteBranch(t, svc, repo, compare.Branch, "refs/heads/"+compare.Branch, "local")
	if !preview.SafeDeleteAllowed {
		t.Fatalf("expected safe delete preview: %+v", preview)
	}

	resp, err := svc.deleteBranch(
		context.Background(),
		repo,
		compare.Branch,
		"refs/heads/"+compare.Branch,
		"local",
		false,
		false,
		preview.PlanFingerprint,
	)
	if err != nil {
		t.Fatalf("deleteBranch(local): %v", err)
	}
	if resp.HeadRef != compare.BaseBranch {
		t.Fatalf("HeadRef=%q, want %q", resp.HeadRef, compare.BaseBranch)
	}
	if gitRefExists(context.Background(), fixture.Root, "refs/heads/"+compare.Branch) {
		t.Fatalf("expected branch %q to be deleted", compare.Branch)
	}
}

func TestDeleteBranch_RejectsCurrentBranch(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	_, err = svc.deleteBranch(context.Background(), repo, repo.headRef, "refs/heads/"+repo.headRef, "local", false, false, "stale")
	if err == nil {
		t.Fatalf("expected deleting current branch to fail")
	}
	if !strings.Contains(err.Error(), "cannot delete the current branch") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestDeleteBranch_RejectsUnmergedBranch(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.UpdateCommit)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	preview := mustPreviewDeleteBranch(t, svc, repo, compare.Branch, "refs/heads/"+compare.Branch, "local")
	if preview.SafeDeleteAllowed {
		t.Fatalf("expected safe delete blocker: %+v", preview)
	}
	if !strings.Contains(strings.ToLower(preview.SafeDeleteReason), "not fully merged") {
		t.Fatalf("unexpected preview safe delete reason: %+v", preview)
	}

	_, err = svc.deleteBranch(
		context.Background(),
		repo,
		compare.Branch,
		"refs/heads/"+compare.Branch,
		"local",
		false,
		false,
		preview.PlanFingerprint,
	)
	if err == nil {
		t.Fatalf("expected deleting unmerged branch to fail")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "not fully merged") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestPreviewDeleteBranch_ReportsLinkedDirtyWorktree(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.UpdateCommit)
	serviceRoot := filepath.Dir(fixture.Root)
	worktree := filepath.Join(serviceRoot, "compare-wt")
	runGitFixture(t, fixture.Root, "worktree", "add", worktree, compare.Branch)
	if err := os.WriteFile(filepath.Join(worktree, "scratch.txt"), []byte("pending worktree file\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(scratch.txt): %v", err)
	}

	svc := NewService(serviceRoot)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	preview := mustPreviewDeleteBranch(t, svc, repo, compare.Branch, "refs/heads/"+compare.Branch, "local")
	if preview.LinkedWorktree == nil {
		t.Fatalf("expected linked worktree preview: %+v", preview)
	}
	if !preview.RequiresWorktreeRemoval || !preview.RequiresDiscardConfirmation {
		t.Fatalf("unexpected worktree requirements: %+v", preview)
	}
	if !preview.LinkedWorktree.Accessible || mustEvalPath(t, preview.LinkedWorktree.WorktreePath) != mustEvalPath(t, worktree) {
		t.Fatalf("unexpected worktree path: %+v", preview.LinkedWorktree)
	}
	if preview.LinkedWorktree.Summary.UntrackedCount != 1 {
		t.Fatalf("unexpected worktree summary: %+v", preview.LinkedWorktree.Summary)
	}
	if len(preview.LinkedWorktree.Untracked) != 1 || preview.LinkedWorktree.Untracked[0].Path != "scratch.txt" {
		t.Fatalf("unexpected worktree changes: %+v", preview.LinkedWorktree.Untracked)
	}
}

func TestDeleteBranch_RejectsRemoteBranch(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	remote := createRemoteSyncFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}
	if _, err := svc.fetchRepo(context.Background(), repo); err != nil {
		t.Fatalf("fetchRepo: %v", err)
	}
	repo, err = svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo(after fetch): %v", err)
	}

	remoteName := "origin/" + remote.RemoteFeatureBranch
	_, err = svc.deleteBranch(context.Background(), repo, remoteName, "refs/remotes/"+remoteName, "remote", false, false, "stale")
	if err == nil {
		t.Fatalf("expected deleting remote branch to fail")
	}
	if !strings.Contains(err.Error(), "remote branches cannot be deleted here") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestDeleteBranch_RemovesLinkedCleanWorktreeAndBranch(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.BinaryCommit)
	runGitFixture(t, fixture.Root, "merge", "--ff-only", compare.Branch)
	serviceRoot := filepath.Dir(fixture.Root)
	worktree := filepath.Join(serviceRoot, "compare-wt")
	runGitFixture(t, fixture.Root, "worktree", "add", worktree, compare.Branch)

	svc := NewService(serviceRoot)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	preview := mustPreviewDeleteBranch(t, svc, repo, compare.Branch, "refs/heads/"+compare.Branch, "local")
	if !preview.SafeDeleteAllowed || !preview.RequiresWorktreeRemoval || preview.RequiresDiscardConfirmation {
		t.Fatalf("unexpected preview: %+v", preview)
	}
	expectedRemovedWorktreePath := filepath.Clean(preview.LinkedWorktree.WorktreePath)

	resp, err := svc.deleteBranch(
		context.Background(),
		repo,
		compare.Branch,
		"refs/heads/"+compare.Branch,
		"local",
		true,
		false,
		preview.PlanFingerprint,
	)
	if err != nil {
		t.Fatalf("deleteBranch(clean linked worktree): %v", err)
	}
	if !resp.LinkedWorktreeRemoved || filepath.Clean(resp.RemovedWorktreePath) != expectedRemovedWorktreePath {
		t.Fatalf("unexpected delete response: %+v", resp)
	}
	if _, err := os.Stat(worktree); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected worktree %q to be removed, err=%v", worktree, err)
	}
	if gitRefExists(context.Background(), fixture.Root, "refs/heads/"+compare.Branch) {
		t.Fatalf("expected branch %q to be deleted", compare.Branch)
	}
}

func TestDeleteBranch_RejectsDirtyLinkedWorktreeWithoutDiscardConsent(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.BinaryCommit)
	runGitFixture(t, fixture.Root, "merge", "--ff-only", compare.Branch)
	serviceRoot := filepath.Dir(fixture.Root)
	worktree := filepath.Join(serviceRoot, "compare-wt")
	runGitFixture(t, fixture.Root, "worktree", "add", worktree, compare.Branch)
	if err := os.WriteFile(filepath.Join(worktree, "scratch.txt"), []byte("pending worktree file\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(scratch.txt): %v", err)
	}

	svc := NewService(serviceRoot)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	preview := mustPreviewDeleteBranch(t, svc, repo, compare.Branch, "refs/heads/"+compare.Branch, "local")
	if !preview.RequiresDiscardConfirmation {
		t.Fatalf("expected discard confirmation requirement: %+v", preview)
	}

	_, err = svc.deleteBranch(
		context.Background(),
		repo,
		compare.Branch,
		"refs/heads/"+compare.Branch,
		"local",
		true,
		false,
		preview.PlanFingerprint,
	)
	if err == nil {
		t.Fatalf("expected dirty linked worktree delete to require discard confirmation")
	}
	if !strings.Contains(err.Error(), "discard confirmation is required") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestDeleteBranch_RemovesDirtyLinkedWorktreeAndBranchWithConsent(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.BinaryCommit)
	runGitFixture(t, fixture.Root, "merge", "--ff-only", compare.Branch)
	serviceRoot := filepath.Dir(fixture.Root)
	worktree := filepath.Join(serviceRoot, "compare-wt")
	runGitFixture(t, fixture.Root, "worktree", "add", worktree, compare.Branch)
	if err := os.WriteFile(filepath.Join(worktree, "scratch.txt"), []byte("pending worktree file\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(scratch.txt): %v", err)
	}

	svc := NewService(serviceRoot)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	preview := mustPreviewDeleteBranch(t, svc, repo, compare.Branch, "refs/heads/"+compare.Branch, "local")
	resp, err := svc.deleteBranch(
		context.Background(),
		repo,
		compare.Branch,
		"refs/heads/"+compare.Branch,
		"local",
		true,
		true,
		preview.PlanFingerprint,
	)
	if err != nil {
		t.Fatalf("deleteBranch(dirty linked worktree): %v", err)
	}
	if !resp.LinkedWorktreeRemoved {
		t.Fatalf("expected linked worktree removal: %+v", resp)
	}
	if _, err := os.Stat(worktree); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected worktree %q to be removed, err=%v", worktree, err)
	}
	if gitRefExists(context.Background(), fixture.Root, "refs/heads/"+compare.Branch) {
		t.Fatalf("expected branch %q to be deleted", compare.Branch)
	}
}

func TestDeleteBranch_RejectsStaleDeletePlan(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.BinaryCommit)
	runGitFixture(t, fixture.Root, "merge", "--ff-only", compare.Branch)

	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	preview := mustPreviewDeleteBranch(t, svc, repo, compare.Branch, "refs/heads/"+compare.Branch, "local")
	if _, err := gitutil.RunCombinedOutput(context.Background(), fixture.Root, nil, "update-ref", "refs/heads/"+compare.Branch, fixture.BinaryCommit); err != nil {
		t.Fatalf("update-ref: %v", err)
	}

	_, err = svc.deleteBranch(
		context.Background(),
		repo,
		compare.Branch,
		"refs/heads/"+compare.Branch,
		"local",
		false,
		false,
		preview.PlanFingerprint,
	)
	if err == nil {
		t.Fatalf("expected stale delete plan to fail")
	}
	if !strings.Contains(err.Error(), "delete plan is stale") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestListCommits_PaginatesNewestFirst(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
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
	serviceRoot := filepath.Dir(fixture.Root)
	worktree := filepath.Join(serviceRoot, "compare-wt")
	runGitFixture(t, fixture.Root, "worktree", "add", worktree, compare.Branch)

	svc := NewService(serviceRoot)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
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

func TestListWorkspaceChanges_UsesBranchWorktreePath(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.UpdateCommit)
	serviceRoot := filepath.Dir(fixture.Root)
	worktree := filepath.Join(serviceRoot, "compare-wt")
	runGitFixture(t, fixture.Root, "worktree", "add", worktree, compare.Branch)
	if err := os.WriteFile(filepath.Join(worktree, "scratch.txt"), []byte("pending worktree file\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(scratch.txt): %v", err)
	}

	svc := NewService(serviceRoot)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo(main): %v", err)
	}
	branches, err := svc.listBranches(context.Background(), repo)
	if err != nil {
		t.Fatalf("listBranches: %v", err)
	}

	var branchWorktreePath string
	for _, branch := range branches.Local {
		if branch.Name == compare.Branch {
			branchWorktreePath = branch.WorktreePath
			break
		}
	}
	if mustEvalPath(t, branchWorktreePath) != mustEvalPath(t, worktree) {
		t.Fatalf("branchWorktreePath=%q, want %q", branchWorktreePath, worktree)
	}

	worktreeRepo, err := svc.resolveExplicitRepo(context.Background(), branchWorktreePath)
	if err != nil {
		t.Fatalf("resolveExplicitRepo(worktree): %v", err)
	}
	workspace, err := svc.listWorkspaceChanges(context.Background(), worktreeRepo)
	if err != nil {
		t.Fatalf("listWorkspaceChanges(worktree): %v", err)
	}
	if mustEvalPath(t, workspace.RepoRootPath) != mustEvalPath(t, worktree) {
		t.Fatalf("workspace.RepoRootPath=%q, want %q", workspace.RepoRootPath, worktree)
	}
	if workspace.Summary.UntrackedCount != 1 {
		t.Fatalf("workspace.Summary.UntrackedCount=%d, want 1", workspace.Summary.UntrackedCount)
	}
	if len(workspace.Untracked) != 1 || workspace.Untracked[0].Path != "scratch.txt" {
		t.Fatalf("unexpected worktree untracked files: %+v", workspace.Untracked)
	}
}

func TestGetBranchCompare(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.UpdateCommit)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
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
			foundFile = strings.Contains(file.PatchText, "+feature branch") && strings.Contains(file.PatchText, compare.FilePath)
			break
		}
	}
	if !foundFile {
		t.Fatalf("expected compare file %q in diff files: %+v", compare.FilePath, resp.Files)
	}
}

func TestGetBranchCompare_EmbedsLinkedWorktreeSnapshot(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.UpdateCommit)
	serviceRoot := filepath.Dir(fixture.Root)
	worktree := filepath.Join(serviceRoot, "compare-wt")
	runGitFixture(t, fixture.Root, "worktree", "add", worktree, compare.Branch)
	if err := os.WriteFile(filepath.Join(worktree, "scratch.txt"), []byte("pending worktree file\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(scratch.txt): %v", err)
	}

	svc := NewService(serviceRoot)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	resp, err := svc.getBranchCompare(context.Background(), repo, compare.BaseBranch, compare.Branch, 10)
	if err != nil {
		t.Fatalf("getBranchCompare: %v", err)
	}
	if resp.LinkedWorktree == nil {
		t.Fatalf("expected linked worktree snapshot in compare response")
	}
	gotWorktree, err := filepath.EvalSymlinks(resp.LinkedWorktree.WorktreePath)
	if err != nil {
		t.Fatalf("EvalSymlinks(resp.LinkedWorktree.WorktreePath): %v", err)
	}
	wantWorktree, err := filepath.EvalSymlinks(worktree)
	if err != nil {
		t.Fatalf("EvalSymlinks(worktree): %v", err)
	}
	if filepath.Clean(gotWorktree) != filepath.Clean(wantWorktree) {
		t.Fatalf("LinkedWorktree.WorktreePath=%q, want %q", gotWorktree, wantWorktree)
	}
	if resp.LinkedWorktree.Summary.UntrackedCount != 1 {
		t.Fatalf("LinkedWorktree.Summary.UntrackedCount=%d, want 1", resp.LinkedWorktree.Summary.UntrackedCount)
	}
	if len(resp.LinkedWorktree.Untracked) != 1 || resp.LinkedWorktree.Untracked[0].Path != "scratch.txt" {
		t.Fatalf("unexpected linked worktree untracked files: %+v", resp.LinkedWorktree.Untracked)
	}
}
