package gitrepo

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/gitutil"
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

func mustGetDiffContent(
	t *testing.T,
	svc *Service,
	repo repoContext,
	req getDiffContentReq,
) *getDiffContentResp {
	t.Helper()
	resp, err := svc.getDiffContent(context.Background(), repo, req)
	if err != nil {
		t.Fatalf("getDiffContent(%s): %v", req.SourceKind, err)
	}
	return resp
}

func mustContainPath(t *testing.T, paths []string, want string) {
	t.Helper()
	for _, path := range paths {
		if path == want {
			return
		}
	}
	t.Fatalf("paths=%v, want %q", paths, want)
}

func TestBuildStashSummary_UsesParentsForLightweightMetadata(t *testing.T) {
	t.Parallel()

	summary := buildStashSummary(
		"stash-oid",
		"stash@{0}",
		"WIP on feature/demo: keep request small",
		1711824000,
		"head-commit index-commit untracked-commit",
	)

	if summary.ID != "stash-oid" {
		t.Fatalf("summary.ID=%q, want stash-oid", summary.ID)
	}
	if summary.Ref != "stash@{0}" {
		t.Fatalf("summary.Ref=%q, want stash@{0}", summary.Ref)
	}
	if summary.BranchName != "feature/demo" {
		t.Fatalf("summary.BranchName=%q, want feature/demo", summary.BranchName)
	}
	if summary.Message != "keep request small" {
		t.Fatalf("summary.Message=%q, want keep request small", summary.Message)
	}
	if summary.HeadCommit != "head-commit" {
		t.Fatalf("summary.HeadCommit=%q, want head-commit", summary.HeadCommit)
	}
	if !summary.HasUntracked {
		t.Fatalf("summary.HasUntracked=%v, want true", summary.HasUntracked)
	}
	if summary.CreatedAtUnixMs != 1711824000000 {
		t.Fatalf("summary.CreatedAtUnixMs=%d, want 1711824000000", summary.CreatedAtUnixMs)
	}
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

func TestGetRepoSummary_DetachedSuggestsReattachBranch(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.UpdateCommit)
	runGitFixture(t, fixture.Root, "checkout", compare.Branch)
	runGitFixture(t, fixture.Root, "switch", "--detach", fixture.BinaryCommit)

	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	resp, err := svc.getRepoSummary(context.Background(), repo)
	if err != nil {
		t.Fatalf("getRepoSummary: %v", err)
	}
	if !resp.Detached {
		t.Fatalf("Detached=%v, want true", resp.Detached)
	}
	if resp.ReattachBranch == nil {
		t.Fatalf("ReattachBranch=nil, want branch")
	}
	if resp.ReattachBranch.Name != compare.Branch {
		t.Fatalf("ReattachBranch.Name=%q, want %q", resp.ReattachBranch.Name, compare.Branch)
	}
	if resp.ReattachBranch.FullName != "refs/heads/"+compare.Branch {
		t.Fatalf("ReattachBranch.FullName=%q, want %q", resp.ReattachBranch.FullName, "refs/heads/"+compare.Branch)
	}
	if resp.ReattachBranch.Kind != "local" {
		t.Fatalf("ReattachBranch.Kind=%q, want local", resp.ReattachBranch.Kind)
	}
}

func TestGetRepoSummary_DetachedSkipsDetachedHistoryWhenSuggestingReattachBranch(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.UpdateCommit)
	runGitFixture(t, fixture.Root, "checkout", compare.Branch)
	runGitFixture(t, fixture.Root, "switch", "--detach", fixture.UpdateCommit)
	runGitFixture(t, fixture.Root, "switch", "--detach", fixture.BinaryCommit)

	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	resp, err := svc.getRepoSummary(context.Background(), repo)
	if err != nil {
		t.Fatalf("getRepoSummary: %v", err)
	}
	if resp.ReattachBranch == nil {
		t.Fatalf("ReattachBranch=nil, want branch")
	}
	if resp.ReattachBranch.Name != compare.Branch {
		t.Fatalf("ReattachBranch.Name=%q, want %q", resp.ReattachBranch.Name, compare.Branch)
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

	detail, presentation, files, err := svc.getCommitDetail(context.Background(), repo, fixture.RenameCommit)
	if err != nil {
		t.Fatalf("getCommitDetail(rename): %v", err)
	}
	if detail.Hash != fixture.RenameCommit {
		t.Fatalf("detail.Hash=%q, want %q", detail.Hash, fixture.RenameCommit)
	}
	if presentation.Mode != gitCommitDiffModePlain || presentation.MergeCommit {
		t.Fatalf("rename presentation=%+v, want plain non-merge", presentation)
	}
	if len(files) != 1 {
		t.Fatalf("rename files=%d, want 1", len(files))
	}
	if files[0].ChangeType != "renamed" || files[0].OldPath != "src/app.txt" || files[0].NewPath != "src/main.txt" {
		t.Fatalf("unexpected rename summary: %+v", files[0])
	}
	if files[0].DisplayPath != "src/main.txt" {
		t.Fatalf("rename metadata not preserved correctly: %+v", files[0])
	}
	renameDiff := mustGetDiffContent(t, svc, repo, getDiffContentReq{
		RepoRootPath: fixture.Root,
		SourceKind:   "commit",
		Commit:       fixture.RenameCommit,
		Mode:         "preview",
		File: gitDiffFileRef{
			ChangeType: "renamed",
			Path:       "src/main.txt",
			OldPath:    "src/app.txt",
			NewPath:    "src/main.txt",
		},
	})
	if !strings.Contains(renameDiff.File.PatchText, "diff --git") || !strings.Contains(renameDiff.File.PatchText, "rename to src/main.txt") {
		t.Fatalf("rename patch content mismatch: %+v", renameDiff.File)
	}

	_, binaryPresentation, binaryFiles, err := svc.getCommitDetail(context.Background(), repo, fixture.BinaryCommit)
	if err != nil {
		t.Fatalf("getCommitDetail(binary): %v", err)
	}
	if binaryPresentation.Mode != gitCommitDiffModePlain || binaryPresentation.MergeCommit {
		t.Fatalf("binary presentation=%+v, want plain non-merge", binaryPresentation)
	}
	if len(binaryFiles) < 2 {
		t.Fatalf("binary cleanup should include at least 2 file changes, got %d", len(binaryFiles))
	}
	foundBinary := false
	foundDeleted := false
	for _, file := range binaryFiles {
		if file.Path == "bin/data.bin" && file.IsBinary {
			content := mustGetDiffContent(t, svc, repo, getDiffContentReq{
				RepoRootPath: fixture.Root,
				SourceKind:   "commit",
				Commit:       fixture.BinaryCommit,
				Mode:         "preview",
				File: gitDiffFileRef{
					ChangeType: file.ChangeType,
					Path:       file.Path,
					OldPath:    file.OldPath,
					NewPath:    file.NewPath,
				},
			})
			foundBinary = strings.TrimSpace(content.File.PatchText) != ""
		}
		if file.Path == "README.md" && file.ChangeType == "deleted" {
			content := mustGetDiffContent(t, svc, repo, getDiffContentReq{
				RepoRootPath: fixture.Root,
				SourceKind:   "commit",
				Commit:       fixture.BinaryCommit,
				Mode:         "preview",
				File: gitDiffFileRef{
					ChangeType: file.ChangeType,
					Path:       file.Path,
					OldPath:    file.OldPath,
					NewPath:    file.NewPath,
				},
			})
			foundDeleted = strings.Contains(content.File.PatchText, "diff --git")
		}
	}
	if !foundBinary {
		t.Fatalf("expected binary file summary in commit detail")
	}
	if !foundDeleted {
		t.Fatalf("expected deleted README summary in commit detail")
	}
}

func TestGetDiffContent_CommitRenamePreservesRenameMetadata(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	resp, err := svc.getDiffContent(context.Background(), repo, getDiffContentReq{
		RepoRootPath: fixture.Root,
		SourceKind:   "commit",
		Commit:       fixture.RenameCommit,
		Mode:         "full",
		File: gitDiffFileRef{
			ChangeType: "renamed",
			Path:       "src/main.txt",
			OldPath:    "src/app.txt",
			NewPath:    "src/main.txt",
		},
	})
	if err != nil {
		t.Fatalf("getDiffContent(rename): %v", err)
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
	if resp.Presentation.Mode != gitCommitDiffModePlain || resp.Presentation.MergeCommit {
		t.Fatalf("rename diff presentation=%+v, want plain non-merge", resp.Presentation)
	}
}

func TestGetCommitDetail_MergeCommitUsesFirstParentPresentation(t *testing.T) {
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

	detail, presentation, files, err := svc.getCommitDetail(context.Background(), repo, resp.HeadCommit)
	if err != nil {
		t.Fatalf("getCommitDetail(merge): %v", err)
	}
	if detail.Hash != strings.TrimSpace(resp.HeadCommit) {
		t.Fatalf("detail.Hash=%q, want %q", detail.Hash, resp.HeadCommit)
	}
	if !presentation.MergeCommit || presentation.Mode != gitCommitDiffModeFirstParent || presentation.ParentCount != 2 {
		t.Fatalf("merge presentation=%+v, want first-parent merge with 2 parents", presentation)
	}
	if len(files) != 1 {
		t.Fatalf("merge files=%d, want 1 first-parent entry", len(files))
	}
	if files[0].Path != "src/feature-merge.txt" || files[0].ChangeType != "added" {
		t.Fatalf("unexpected first-parent merge file summary: %+v", files[0])
	}
	mergeDiff := mustGetDiffContent(t, svc, repo, getDiffContentReq{
		RepoRootPath: fixture.Root,
		SourceKind:   "commit",
		Commit:       resp.HeadCommit,
		Mode:         "preview",
		File: gitDiffFileRef{
			ChangeType: files[0].ChangeType,
			Path:       files[0].Path,
			OldPath:    files[0].OldPath,
			NewPath:    files[0].NewPath,
		},
	})
	if mergeDiff.Presentation.Mode != gitCommitDiffModeFirstParent || !mergeDiff.Presentation.MergeCommit {
		t.Fatalf("merge diff presentation=%+v, want first-parent merge", mergeDiff.Presentation)
	}
	if !strings.Contains(mergeDiff.File.PatchText, "diff --git") || !strings.Contains(mergeDiff.File.PatchText, "src/feature-merge.txt") {
		t.Fatalf("merge diff patch mismatch: %+v", mergeDiff.File)
	}
}

func TestStashListDetailApplyAndDropFlow(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	workspace := createWorkspaceChangesFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	saveResp, err := svc.saveStash(context.Background(), repo, saveStashReq{
		RepoRootPath:     fixture.Root,
		Message:          "stash flow",
		IncludeUntracked: true,
	})
	if err != nil {
		t.Fatalf("saveStash: %v", err)
	}
	if saveResp.Created == nil || strings.TrimSpace(saveResp.Created.ID) == "" {
		t.Fatalf("saveStash created=%+v, want populated stash summary", saveResp.Created)
	}

	listResp, err := svc.listStashes(context.Background(), repo)
	if err != nil {
		t.Fatalf("listStashes: %v", err)
	}
	if len(listResp.Stashes) != 1 {
		t.Fatalf("stash count=%d, want 1", len(listResp.Stashes))
	}
	if listResp.Stashes[0].ID != saveResp.Created.ID {
		t.Fatalf("stash ID=%q, want %q", listResp.Stashes[0].ID, saveResp.Created.ID)
	}
	if !listResp.Stashes[0].HasUntracked {
		t.Fatalf("expected saved stash to include untracked files: %+v", listResp.Stashes[0])
	}

	detailResp, err := svc.getStashDetail(context.Background(), repo, saveResp.Created.ID)
	if err != nil {
		t.Fatalf("getStashDetail: %v", err)
	}
	foundTracked := false
	foundUntracked := false
	for _, file := range detailResp.Stash.Files {
		if file.Path == workspace.TrackedPath || file.NewPath == workspace.TrackedPath {
			foundTracked = true
		}
		if file.Path == workspace.UntrackedPath || file.NewPath == workspace.UntrackedPath {
			foundUntracked = true
		}
	}
	if !foundTracked || !foundUntracked {
		t.Fatalf("stash detail files missing expected paths: %+v", detailResp.Stash.Files)
	}

	var trackedFile *gitCommitFileSummary
	var untrackedFile *gitCommitFileSummary
	for index := range detailResp.Stash.Files {
		file := detailResp.Stash.Files[index]
		if trackedFile == nil && (file.Path == workspace.TrackedPath || file.NewPath == workspace.TrackedPath) {
			candidate := file
			trackedFile = &candidate
		}
		if untrackedFile == nil && (file.Path == workspace.UntrackedPath || file.NewPath == workspace.UntrackedPath) {
			candidate := file
			untrackedFile = &candidate
		}
	}
	if trackedFile == nil || untrackedFile == nil {
		t.Fatalf("expected tracked and untracked stash files for diff preview: %+v", detailResp.Stash.Files)
	}

	trackedDiff := mustGetDiffContent(t, svc, repo, getDiffContentReq{
		RepoRootPath: fixture.Root,
		SourceKind:   "stash",
		StashID:      saveResp.Created.ID,
		Mode:         "preview",
		File: gitDiffFileRef{
			ChangeType: trackedFile.ChangeType,
			Path:       trackedFile.Path,
			OldPath:    trackedFile.OldPath,
			NewPath:    trackedFile.NewPath,
		},
	})
	if !strings.Contains(trackedDiff.File.PatchText, "+unstaged") {
		t.Fatalf("tracked stash diff missing tracked patch content: %+v", trackedDiff.File)
	}

	untrackedDiff := mustGetDiffContent(t, svc, repo, getDiffContentReq{
		RepoRootPath: fixture.Root,
		SourceKind:   "stash",
		StashID:      saveResp.Created.ID,
		Mode:         "preview",
		File: gitDiffFileRef{
			ChangeType: untrackedFile.ChangeType,
			Path:       untrackedFile.Path,
			OldPath:    untrackedFile.OldPath,
			NewPath:    untrackedFile.NewPath,
		},
	})
	if untrackedDiff.File.ChangeType != "added" {
		t.Fatalf("untracked stash diff change_type=%q, want added", untrackedDiff.File.ChangeType)
	}
	if !strings.Contains(untrackedDiff.File.PatchText, "+todo") {
		t.Fatalf("untracked stash diff missing file content: %+v", untrackedDiff.File)
	}

	previewApplyResp, err := svc.previewApplyStash(context.Background(), repo, saveResp.Created.ID, false)
	if err != nil {
		t.Fatalf("previewApplyStash: %v", err)
	}
	if previewApplyResp.Blocking != nil || strings.TrimSpace(previewApplyResp.BlockingReason) != "" {
		t.Fatalf("previewApplyStash unexpectedly blocked: %+v", previewApplyResp)
	}
	if strings.TrimSpace(previewApplyResp.PlanFingerprint) == "" {
		t.Fatalf("expected apply preview fingerprint")
	}

	if _, err := svc.applyStash(context.Background(), repo, saveResp.Created.ID, false, previewApplyResp.PlanFingerprint); err != nil {
		t.Fatalf("applyStash: %v", err)
	}

	status, err := svc.readWorkspaceStatus(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("readWorkspaceStatus: %v", err)
	}
	summary := status.Summary()
	if summary.StagedCount != 1 || summary.UnstagedCount != 1 || summary.UntrackedCount != 1 {
		t.Fatalf("workspace summary after apply=%+v, want staged=1 unstaged=1 untracked=1", summary)
	}

	previewDropResp, err := svc.previewDropStash(context.Background(), repo, saveResp.Created.ID)
	if err != nil {
		t.Fatalf("previewDropStash: %v", err)
	}
	if strings.TrimSpace(previewDropResp.PlanFingerprint) == "" {
		t.Fatalf("expected drop preview fingerprint")
	}
	if _, err := svc.dropStash(context.Background(), repo, saveResp.Created.ID, previewDropResp.PlanFingerprint); err != nil {
		t.Fatalf("dropStash: %v", err)
	}

	listResp, err = svc.listStashes(context.Background(), repo)
	if err != nil {
		t.Fatalf("listStashes(after drop): %v", err)
	}
	if len(listResp.Stashes) != 0 {
		t.Fatalf("stash count after drop=%d, want 0", len(listResp.Stashes))
	}
}

func TestPreviewApplyStash_BlocksDirtyWorkspace(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	createWorkspaceChangesFixture(t, fixture.Root)
	saveResp, err := svc.saveStash(context.Background(), repo, saveStashReq{
		RepoRootPath:     fixture.Root,
		IncludeUntracked: true,
	})
	if err != nil {
		t.Fatalf("saveStash: %v", err)
	}
	if saveResp.Created == nil {
		t.Fatalf("saveStash created=nil")
	}

	writeFixtureFile(t, fixture.Root, "src/main.txt", []byte("dirty workspace\n"))

	previewResp, err := svc.previewApplyStash(context.Background(), repo, saveResp.Created.ID, false)
	if err != nil {
		t.Fatalf("previewApplyStash: %v", err)
	}
	if previewResp.Blocking == nil {
		t.Fatalf("expected dirty workspace blocker")
	}
	if previewResp.Blocking.Kind != gitMutationBlockerKindWorkspaceDirty {
		t.Fatalf("blocking kind=%q, want %q", previewResp.Blocking.Kind, gitMutationBlockerKindWorkspaceDirty)
	}
	if mustEvalPath(t, previewResp.Blocking.WorkspacePath) != mustEvalPath(t, fixture.Root) {
		t.Fatalf("blocking workspace_path=%q, want %q", previewResp.Blocking.WorkspacePath, fixture.Root)
	}
	if previewResp.Blocking.CanStashWorkspace {
		t.Fatalf("dirty apply blocker should not offer re-stashing: %+v", previewResp.Blocking)
	}
	if !strings.Contains(previewResp.BlockingReason, "Current workspace must be clean before applying a stash") {
		t.Fatalf("blocking_reason=%q, want apply blocker message", previewResp.BlockingReason)
	}
}

func TestApplyStash_RejectsStaleFingerprint(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	createWorkspaceChangesFixture(t, fixture.Root)
	saveResp, err := svc.saveStash(context.Background(), repo, saveStashReq{
		RepoRootPath:     fixture.Root,
		IncludeUntracked: true,
	})
	if err != nil {
		t.Fatalf("saveStash: %v", err)
	}
	if saveResp.Created == nil {
		t.Fatalf("saveStash created=nil")
	}

	previewResp, err := svc.previewApplyStash(context.Background(), repo, saveResp.Created.ID, false)
	if err != nil {
		t.Fatalf("previewApplyStash: %v", err)
	}

	writeFixtureFile(t, fixture.Root, "late.txt", []byte("late change\n"))

	_, err = svc.applyStash(context.Background(), repo, saveResp.Created.ID, false, previewResp.PlanFingerprint)
	if err == nil || !strings.Contains(err.Error(), "stash apply plan is stale") {
		t.Fatalf("applyStash stale error=%v, want stale fingerprint failure", err)
	}
}

func TestDropStash_RejectsStaleFingerprint(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	createWorkspaceChangesFixture(t, fixture.Root)
	saveResp, err := svc.saveStash(context.Background(), repo, saveStashReq{
		RepoRootPath: fixture.Root,
	})
	if err != nil {
		t.Fatalf("saveStash: %v", err)
	}
	if saveResp.Created == nil {
		t.Fatalf("saveStash created=nil")
	}

	previewResp, err := svc.previewDropStash(context.Background(), repo, saveResp.Created.ID)
	if err != nil {
		t.Fatalf("previewDropStash: %v", err)
	}

	runGitFixture(t, fixture.Root, "commit", "--allow-empty", "-m", "advance head")
	updatedRepo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo(updated): %v", err)
	}

	_, err = svc.dropStash(context.Background(), updatedRepo, saveResp.Created.ID, previewResp.PlanFingerprint)
	if err == nil || !strings.Contains(err.Error(), "stash drop plan is stale") {
		t.Fatalf("dropStash stale error=%v, want stale fingerprint failure", err)
	}
}

func TestGetDiffContent_WorkspaceUnstagedIncludesFullFileContext(t *testing.T) {
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

	resp, err := svc.getDiffContent(context.Background(), repo, getDiffContentReq{
		RepoRootPath:     fixture.Root,
		SourceKind:       "workspace",
		WorkspaceSection: "unstaged",
		Mode:             "full",
		File: gitDiffFileRef{
			ChangeType: "modified",
			Path:       "src/context.txt",
			NewPath:    "src/context.txt",
		},
	})
	if err != nil {
		t.Fatalf("getDiffContent(unstaged): %v", err)
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

func TestClassifyGitMutationRPCError_StashDropSignals(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		err         error
		wantCode    uint32
		wantMessage string
	}{
		{
			name:        "drop stash stale plan",
			err:         errors.New("stash drop plan is stale; review the stash again"),
			wantCode:    409,
			wantMessage: "stash drop plan is stale; review the stash again",
		},
		{
			name:        "drop stash missing target",
			err:         errors.New("stash not found"),
			wantCode:    404,
			wantMessage: "stash not found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyGitMutationRPCError(tt.err)
			if got == nil {
				t.Fatalf("classifyGitMutationRPCError(%q)=nil", tt.err)
			}
			if got.Code != tt.wantCode {
				t.Fatalf("classifyGitMutationRPCError(%q) code=%d, want %d", tt.err, got.Code, tt.wantCode)
			}
			if got.Message != tt.wantMessage {
				t.Fatalf("classifyGitMutationRPCError(%q) message=%q, want %q", tt.err, got.Message, tt.wantMessage)
			}
		})
	}
}

func TestListWorkspaceChanges_ProvidesMetadataOnlySummariesAndLazyDiffContent(t *testing.T) {
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
	if len(resp.Staged) != 1 || resp.Staged[0].Path != workspace.TrackedPath {
		t.Fatalf("unexpected staged metadata: %+v", resp.Staged)
	}
	if len(resp.Unstaged) != 1 || resp.Unstaged[0].Path != workspace.TrackedPath {
		t.Fatalf("unexpected unstaged metadata: %+v", resp.Unstaged)
	}
	if len(resp.Untracked) != 1 || resp.Untracked[0].Path != workspace.UntrackedPath {
		t.Fatalf("unexpected untracked entry: %+v", resp.Untracked)
	}
	stagedDiff := mustGetDiffContent(t, svc, repo, getDiffContentReq{
		RepoRootPath:     fixture.Root,
		SourceKind:       "workspace",
		WorkspaceSection: "staged",
		Mode:             "preview",
		File: gitDiffFileRef{
			ChangeType: resp.Staged[0].ChangeType,
			Path:       resp.Staged[0].Path,
			OldPath:    resp.Staged[0].OldPath,
			NewPath:    resp.Staged[0].NewPath,
		},
	})
	if !strings.Contains(stagedDiff.File.PatchText, "+staged") {
		t.Fatalf("staged diff content mismatch: %+v", stagedDiff.File)
	}
	unstagedDiff := mustGetDiffContent(t, svc, repo, getDiffContentReq{
		RepoRootPath:     fixture.Root,
		SourceKind:       "workspace",
		WorkspaceSection: "unstaged",
		Mode:             "preview",
		File: gitDiffFileRef{
			ChangeType: resp.Unstaged[0].ChangeType,
			Path:       resp.Unstaged[0].Path,
			OldPath:    resp.Unstaged[0].OldPath,
			NewPath:    resp.Unstaged[0].NewPath,
		},
	})
	if !strings.Contains(unstagedDiff.File.PatchText, "+unstaged") {
		t.Fatalf("unstaged diff content mismatch: %+v", unstagedDiff.File)
	}
	untrackedDiff := mustGetDiffContent(t, svc, repo, getDiffContentReq{
		RepoRootPath:     fixture.Root,
		SourceKind:       "workspace",
		WorkspaceSection: "untracked",
		Mode:             "preview",
		File: gitDiffFileRef{
			ChangeType: resp.Untracked[0].ChangeType,
			Path:       resp.Untracked[0].Path,
			OldPath:    resp.Untracked[0].OldPath,
			NewPath:    resp.Untracked[0].NewPath,
		},
	})
	if !strings.Contains(untrackedDiff.File.PatchText, "diff --git a/todo.txt b/todo.txt") || !strings.Contains(untrackedDiff.File.PatchText, "+todo") {
		t.Fatalf("untracked diff content mismatch: %+v", untrackedDiff.File)
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
	conflictedDiff := mustGetDiffContent(t, svc, repo, getDiffContentReq{
		RepoRootPath:     fixture.Root,
		SourceKind:       "workspace",
		WorkspaceSection: "conflicted",
		Mode:             "preview",
		File: gitDiffFileRef{
			ChangeType: resp.Conflicted[0].ChangeType,
			Path:       resp.Conflicted[0].Path,
			OldPath:    resp.Conflicted[0].OldPath,
			NewPath:    resp.Conflicted[0].NewPath,
		},
	})
	if !strings.Contains(conflictedDiff.File.PatchText, "diff --cc") {
		t.Fatalf("expected combined diff patch text, got: %q", conflictedDiff.File.PatchText)
	}
	if len(resp.Unstaged) != 0 {
		t.Fatalf("conflicted file must not also leak into unstaged: %+v", resp.Unstaged)
	}
}

func TestListWorkspacePage_ChangesPagesImmediateChildren(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	writeFixtureFile(t, fixture.Root, "src/second.txt", []byte("tracked\n"))
	runGitFixture(t, fixture.Root, "add", "src/second.txt")
	runGitFixture(t, fixture.Root, "commit", "-m", "add second tracked file")
	workspace := createWorkspaceChangesFixture(t, fixture.Root)
	writeFixtureFile(t, fixture.Root, "src/second.txt", []byte("tracked\npending\n"))
	writeFixtureFile(t, fixture.Root, "scratch.txt", []byte("scratch\n"))

	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	resp, err := svc.listWorkspacePage(context.Background(), repo, "changes", "", 1, 2)
	if err != nil {
		t.Fatalf("listWorkspacePage(changes): %v", err)
	}
	if resp.Section != "changes" {
		t.Fatalf("Section=%q, want changes", resp.Section)
	}
	if resp.TotalCount != 3 || resp.Offset != 1 || resp.NextOffset != 3 || resp.HasMore {
		t.Fatalf("unexpected page window: %+v", resp)
	}
	if len(resp.Items) != 2 {
		t.Fatalf("len(items)=%d, want 2", len(resp.Items))
	}
	if resp.Items[0].EntryKind != "file" || resp.Items[1].EntryKind != "file" {
		t.Fatalf("expected file rows after paging past the root directory row: %+v", resp.Items)
	}
	if resp.Items[0].Path != "scratch.txt" || resp.Items[1].Path != workspace.UntrackedPath {
		t.Fatalf("unexpected immediate children page: %+v", resp.Items)
	}
}

func TestListWorkspacePage_StagesAndConflictsRemainSectionScoped(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	workspace := createWorkspaceChangesFixture(t, fixture.Root)

	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}
	if err := svc.stageWorkspacePaths(context.Background(), repo, []string{workspace.UntrackedPath}); err != nil {
		t.Fatalf("stageWorkspacePaths: %v", err)
	}

	stagedPage, err := svc.listWorkspacePage(context.Background(), repo, "staged", "", 0, 1)
	if err != nil {
		t.Fatalf("listWorkspacePage(staged): %v", err)
	}
	if stagedPage.Section != "staged" {
		t.Fatalf("Section=%q, want staged", stagedPage.Section)
	}
	if stagedPage.TotalCount != 2 || stagedPage.Offset != 0 || stagedPage.NextOffset != 1 || !stagedPage.HasMore {
		t.Fatalf("unexpected staged page: %+v", stagedPage)
	}
	if len(stagedPage.Items) != 1 || stagedPage.Items[0].Section != "staged" {
		t.Fatalf("unexpected staged items: %+v", stagedPage.Items)
	}

	conflictFixture := createTestRepoFixture(t)
	conflict := createWorkspaceConflictFixture(t, conflictFixture.Root)
	conflictSvc := NewService(conflictFixture.Root)
	conflictRepo, err := conflictSvc.resolveExplicitRepo(context.Background(), conflictFixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo(conflict): %v", err)
	}
	conflictedPage, err := conflictSvc.listWorkspacePage(context.Background(), conflictRepo, "conflicted", "", 0, 10)
	if err != nil {
		t.Fatalf("listWorkspacePage(conflicted): %v", err)
	}
	if conflictedPage.Section != "conflicted" || conflictedPage.TotalCount != 1 || conflictedPage.NextOffset != 1 || conflictedPage.HasMore {
		t.Fatalf("unexpected conflicted page: %+v", conflictedPage)
	}
	if len(conflictedPage.Items) != 1 {
		t.Fatalf("len(conflicted items)=%d, want 1", len(conflictedPage.Items))
	}
	if conflictedPage.Items[0].Section != "conflicted" || conflictedPage.Items[0].Path != conflict.ConflictPath {
		t.Fatalf("unexpected conflicted item: %+v", conflictedPage.Items[0])
	}
	if conflictedPage.Items[0].ChangeType != "conflicted" {
		t.Fatalf("ChangeType=%q, want conflicted", conflictedPage.Items[0].ChangeType)
	}
}

func TestListWorkspacePage_ChangesSupportsDirectoryBrowsing(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	createWorkspaceChangesFixture(t, fixture.Root)
	writeFixtureFile(t, fixture.Root, "desktop/diagnostics/report.txt", []byte("report\n"))
	writeFixtureFile(t, fixture.Root, "desktop/diagnostics/logs/error.txt", []byte("error\n"))
	writeFixtureFile(t, fixture.Root, "desktop/readme.md", []byte("desktop\n"))

	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	rootPage, err := svc.listWorkspacePage(context.Background(), repo, "changes", "", 0, 20)
	if err != nil {
		t.Fatalf("listWorkspacePage(root): %v", err)
	}
	if rootPage.DirectoryPath != "" {
		t.Fatalf("DirectoryPath=%q, want root", rootPage.DirectoryPath)
	}
	var desktopDir *gitWorkspaceChange
	for index := range rootPage.Items {
		if rootPage.Items[index].EntryKind == "directory" && rootPage.Items[index].DirectoryPath == "desktop" {
			desktopDir = &rootPage.Items[index]
			break
		}
	}
	if desktopDir == nil {
		t.Fatalf("expected desktop directory entry in root page: %+v", rootPage.Items)
	}
	if desktopDir.DescendantFileCount != 3 || !desktopDir.ContainsUntracked || desktopDir.ContainsUnstaged {
		t.Fatalf("unexpected desktop directory aggregate: %+v", desktopDir)
	}

	desktopPage, err := svc.listWorkspacePage(context.Background(), repo, "changes", "desktop/", 0, 20)
	if err != nil {
		t.Fatalf("listWorkspacePage(desktop): %v", err)
	}
	if desktopPage.DirectoryPath != "desktop" {
		t.Fatalf("DirectoryPath=%q, want desktop", desktopPage.DirectoryPath)
	}
	if len(desktopPage.Breadcrumbs) != 2 || desktopPage.Breadcrumbs[1].Path != "desktop" {
		t.Fatalf("unexpected breadcrumbs: %+v", desktopPage.Breadcrumbs)
	}
	if len(desktopPage.Items) != 2 {
		t.Fatalf("len(desktop items)=%d, want 2", len(desktopPage.Items))
	}
	if desktopPage.Items[0].EntryKind != "directory" || desktopPage.Items[0].DirectoryPath != "desktop/diagnostics" {
		t.Fatalf("unexpected first desktop item: %+v", desktopPage.Items[0])
	}
	if desktopPage.Items[1].EntryKind != "file" || desktopPage.Items[1].Path != "desktop/readme.md" {
		t.Fatalf("unexpected second desktop item: %+v", desktopPage.Items[1])
	}
}

func TestResolveWorkspaceMutationPaths_UsesPagedSections(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	workspace := createWorkspaceChangesFixture(t, fixture.Root)

	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	changePaths, err := svc.resolveWorkspaceMutationPaths(context.Background(), repo, "changes")
	if err != nil {
		t.Fatalf("resolveWorkspaceMutationPaths(changes): %v", err)
	}
	mustContainPath(t, changePaths, workspace.TrackedPath)
	mustContainPath(t, changePaths, workspace.UntrackedPath)

	if err := svc.stageWorkspacePaths(context.Background(), repo, []string{workspace.UntrackedPath}); err != nil {
		t.Fatalf("stageWorkspacePaths: %v", err)
	}
	stagedPaths, err := svc.resolveWorkspaceMutationPaths(context.Background(), repo, "staged")
	if err != nil {
		t.Fatalf("resolveWorkspaceMutationPaths(staged): %v", err)
	}
	if len(stagedPaths) != 2 {
		t.Fatalf("stagedPaths=%v, want 2 paths", stagedPaths)
	}

	conflictFixture := createTestRepoFixture(t)
	conflict := createWorkspaceConflictFixture(t, conflictFixture.Root)
	conflictSvc := NewService(conflictFixture.Root)
	conflictRepo, err := conflictSvc.resolveExplicitRepo(context.Background(), conflictFixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo(conflict): %v", err)
	}
	conflictPaths, err := conflictSvc.resolveWorkspaceMutationPaths(context.Background(), conflictRepo, "conflicted")
	if err != nil {
		t.Fatalf("resolveWorkspaceMutationPaths(conflicted): %v", err)
	}
	mustContainPath(t, conflictPaths, conflict.ConflictPath)
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

func TestStageAndUnstageWorkspacePaths_BeforeFirstCommit(t *testing.T) {
	t.Parallel()
	root := createUnbornRepoFixture(t)
	workspace := createWorkspaceChangesFixture(t, root)
	svc := NewService(root)
	repo, err := svc.resolveExplicitRepo(context.Background(), root)
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
	if unstagedResp.Summary.StagedCount != 1 || unstagedResp.Summary.UnstagedCount != 0 || unstagedResp.Summary.UntrackedCount != 1 {
		t.Fatalf("unexpected unstaged summary: %+v", unstagedResp.Summary)
	}
	if len(unstagedResp.Untracked) != 1 || unstagedResp.Untracked[0].Path != workspace.UntrackedPath {
		t.Fatalf("unexpected untracked items after unstage: %+v", unstagedResp.Untracked)
	}
}

func TestUnstageAllWorkspacePaths_BeforeFirstCommit(t *testing.T) {
	t.Parallel()
	root := createUnbornRepoFixture(t)
	workspace := createWorkspaceChangesFixture(t, root)
	svc := NewService(root)
	repo, err := svc.resolveExplicitRepo(context.Background(), root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	if err := svc.stageWorkspacePaths(context.Background(), repo, []string{workspace.TrackedPath, workspace.UntrackedPath}); err != nil {
		t.Fatalf("stageWorkspacePaths: %v", err)
	}
	stagedPaths, err := svc.resolveWorkspaceMutationPaths(context.Background(), repo, "staged")
	if err != nil {
		t.Fatalf("resolveWorkspaceMutationPaths(staged): %v", err)
	}
	if len(stagedPaths) != 2 {
		t.Fatalf("stagedPaths=%v, want 2 paths", stagedPaths)
	}

	if err := svc.unstageWorkspacePaths(context.Background(), repo, stagedPaths); err != nil {
		t.Fatalf("unstageWorkspacePaths(all): %v", err)
	}
	unstagedResp, err := svc.listWorkspaceChanges(context.Background(), repo)
	if err != nil {
		t.Fatalf("listWorkspaceChanges(after unstage all): %v", err)
	}
	if unstagedResp.Summary.StagedCount != 0 || unstagedResp.Summary.UnstagedCount != 0 || unstagedResp.Summary.UntrackedCount != 2 {
		t.Fatalf("unexpected unstaged summary: %+v", unstagedResp.Summary)
	}
	untrackedPaths := make([]string, 0, len(unstagedResp.Untracked))
	for _, item := range unstagedResp.Untracked {
		untrackedPaths = append(untrackedPaths, item.Path)
	}
	mustContainPath(t, untrackedPaths, workspace.UntrackedPath)
	trackedDir := filepath.ToSlash(filepath.Dir(workspace.TrackedPath))
	for _, path := range untrackedPaths {
		if path == workspace.TrackedPath || strings.HasPrefix(path, trackedDir+"/") || path == trackedDir+"/" {
			return
		}
	}
	t.Fatalf("expected tracked path to move back into untracked items: %+v", untrackedPaths)
}

func TestDiscardWorkspacePaths_RemovesPendingChangesButKeepsStagedSnapshot(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	workspace := createWorkspaceChangesFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	changePaths, err := svc.resolveWorkspaceMutationPaths(context.Background(), repo, "changes")
	if err != nil {
		t.Fatalf("resolveWorkspaceMutationPaths(changes): %v", err)
	}
	if err := svc.discardWorkspacePaths(context.Background(), repo, changePaths); err != nil {
		t.Fatalf("discardWorkspacePaths: %v", err)
	}

	resp, err := svc.listWorkspaceChanges(context.Background(), repo)
	if err != nil {
		t.Fatalf("listWorkspaceChanges(after discard): %v", err)
	}
	if resp.Summary.StagedCount != 1 || resp.Summary.UnstagedCount != 0 || resp.Summary.UntrackedCount != 0 {
		t.Fatalf("unexpected workspace summary after discard: %+v", resp.Summary)
	}

	data, err := os.ReadFile(filepath.Join(fixture.Root, filepath.FromSlash(workspace.TrackedPath)))
	if err != nil {
		t.Fatalf("read tracked path: %v", err)
	}
	if string(data) != "one\ntwo\nstaged\n" {
		t.Fatalf("tracked file content=%q, want staged snapshot", string(data))
	}
	if _, err := os.Stat(filepath.Join(fixture.Root, filepath.FromSlash(workspace.UntrackedPath))); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("untracked file still exists or unexpected stat error: %v", err)
	}
}

func TestDiscardWorkspacePaths_BeforeFirstCommitRestoresIndexVersion(t *testing.T) {
	t.Parallel()
	root := createUnbornRepoFixture(t)
	workspace := createWorkspaceChangesFixture(t, root)
	svc := NewService(root)
	repo, err := svc.resolveExplicitRepo(context.Background(), root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	changePaths, err := svc.resolveWorkspaceMutationPaths(context.Background(), repo, "changes")
	if err != nil {
		t.Fatalf("resolveWorkspaceMutationPaths(changes): %v", err)
	}
	if err := svc.discardWorkspacePaths(context.Background(), repo, changePaths); err != nil {
		t.Fatalf("discardWorkspacePaths: %v", err)
	}

	resp, err := svc.listWorkspaceChanges(context.Background(), repo)
	if err != nil {
		t.Fatalf("listWorkspaceChanges(after discard): %v", err)
	}
	if resp.Summary.StagedCount != 1 || resp.Summary.UnstagedCount != 0 || resp.Summary.UntrackedCount != 0 {
		t.Fatalf("unexpected workspace summary after discard: %+v", resp.Summary)
	}

	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(workspace.TrackedPath)))
	if err != nil {
		t.Fatalf("read tracked path: %v", err)
	}
	if string(data) != "one\ntwo\nstaged\n" {
		t.Fatalf("tracked file content=%q, want index snapshot", string(data))
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(workspace.UntrackedPath))); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("untracked file still exists or unexpected stat error: %v", err)
	}
}

func TestDiscardWorkspacePaths_WithExplicitUntrackedPathOnly(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	workspace := createWorkspaceChangesFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	if err := svc.discardWorkspacePaths(context.Background(), repo, []string{workspace.UntrackedPath}); err != nil {
		t.Fatalf("discardWorkspacePaths(untracked): %v", err)
	}

	resp, err := svc.listWorkspaceChanges(context.Background(), repo)
	if err != nil {
		t.Fatalf("listWorkspaceChanges(after discard): %v", err)
	}
	if resp.Summary.StagedCount != 1 || resp.Summary.UnstagedCount != 1 || resp.Summary.UntrackedCount != 0 {
		t.Fatalf("unexpected workspace summary after untracked discard: %+v", resp.Summary)
	}
}

func TestDiscardWorkspace_DirectorySelectionReportsTruthfully(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	createWorkspaceChangesFixture(t, fixture.Root)
	writeFixtureFile(t, fixture.Root, "desktop/diagnostics/report.txt", []byte("report\n"))
	writeFixtureFile(t, fixture.Root, "desktop/diagnostics/logs/error.txt", []byte("error\n"))
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	result, err := svc.discardWorkspace(context.Background(), repo, workspaceMutationSelection{
		Section:       "changes",
		DirectoryPath: "desktop/diagnostics/",
	})
	if err != nil {
		t.Fatalf("discardWorkspace(directory): %v", err)
	}
	if result.RequestedCount != 2 || result.MatchedCount != 2 || result.AffectedCount != 2 || result.RemainingCount != 0 {
		t.Fatalf("unexpected discard result: %+v", result)
	}
	if _, statErr := os.Stat(filepath.Join(fixture.Root, "desktop", "diagnostics", "report.txt")); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("expected report.txt to be removed, got: %v", statErr)
	}
	if _, statErr := os.Stat(filepath.Join(fixture.Root, "desktop", "diagnostics", "logs", "error.txt")); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("expected error.txt to be removed, got: %v", statErr)
	}

	noopResult, err := svc.discardWorkspace(context.Background(), repo, workspaceMutationSelection{
		Section:       "changes",
		DirectoryPath: "desktop/diagnostics/",
	})
	if err != nil {
		t.Fatalf("discardWorkspace(directory second pass): %v", err)
	}
	if noopResult.RequestedCount != 0 || noopResult.MatchedCount != 0 || noopResult.AffectedCount != 0 || len(noopResult.Warnings) == 0 {
		t.Fatalf("expected warning-only no-op result, got: %+v", noopResult)
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

func TestSwitchDetached_ChecksOutCommit(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	resp, err := svc.switchDetached(context.Background(), repo, fixture.BinaryCommit)
	if err != nil {
		t.Fatalf("switchDetached: %v", err)
	}
	if !resp.Detached {
		t.Fatalf("Detached=%v, want true", resp.Detached)
	}
	if resp.HeadRef != "HEAD" {
		t.Fatalf("HeadRef=%q, want HEAD", resp.HeadRef)
	}
	if resp.HeadCommit != fixture.BinaryCommit {
		t.Fatalf("HeadCommit=%q, want %q", resp.HeadCommit, fixture.BinaryCommit)
	}
	current := runGitFixture(t, fixture.Root, "rev-parse", "--abbrev-ref", "HEAD")
	if current != "HEAD" {
		t.Fatalf("current branch=%q, want HEAD", current)
	}
	localHead := runGitFixture(t, fixture.Root, "rev-parse", "HEAD")
	if localHead != fixture.BinaryCommit {
		t.Fatalf("local HEAD=%q, want %q", localHead, fixture.BinaryCommit)
	}
}

func TestSwitchDetached_BlocksDirtyWorkspace(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	createWorkspaceChangesFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	_, err = svc.switchDetached(context.Background(), repo, fixture.BinaryCommit)
	if err == nil {
		t.Fatalf("switchDetached: expected error")
	}
	if !strings.Contains(err.Error(), "Current workspace must be clean before switching to detached HEAD") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSwitchDetached_BlocksInProgressOperation(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	mergeHeadPath := runGitFixture(t, fixture.Root, "rev-parse", "--git-path", "MERGE_HEAD")
	mergeHeadPath = strings.TrimSpace(mergeHeadPath)
	if !filepath.IsAbs(mergeHeadPath) {
		mergeHeadPath = filepath.Join(fixture.Root, mergeHeadPath)
	}
	if err := os.WriteFile(mergeHeadPath, []byte(fixture.BinaryCommit+"\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(MERGE_HEAD): %v", err)
	}

	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	_, err = svc.switchDetached(context.Background(), repo, fixture.BinaryCommit)
	if err == nil {
		t.Fatalf("switchDetached: expected error")
	}
	if !strings.Contains(err.Error(), "Finish the current merge before switching to detached HEAD") {
		t.Fatalf("unexpected error: %v", err)
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
		deleteBranchOptions{
			Name:            compare.Branch,
			FullName:        "refs/heads/" + compare.Branch,
			Kind:            "local",
			DeleteMode:      string(deleteBranchModeSafe),
			PlanFingerprint: preview.PlanFingerprint,
		},
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

	_, err = svc.deleteBranch(context.Background(), repo, deleteBranchOptions{
		Name:            repo.headRef,
		FullName:        "refs/heads/" + repo.headRef,
		Kind:            "local",
		DeleteMode:      string(deleteBranchModeSafe),
		PlanFingerprint: "stale",
	})
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
	if !preview.ForceDeleteAllowed || !preview.ForceDeleteRequiresConfirm {
		t.Fatalf("expected force delete fallback for unmerged branch: %+v", preview)
	}

	_, err = svc.deleteBranch(
		context.Background(),
		repo,
		deleteBranchOptions{
			Name:            compare.Branch,
			FullName:        "refs/heads/" + compare.Branch,
			Kind:            "local",
			DeleteMode:      string(deleteBranchModeSafe),
			PlanFingerprint: preview.PlanFingerprint,
		},
	)
	if err == nil {
		t.Fatalf("expected deleting unmerged branch to fail")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "not fully merged") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestDeleteBranch_ForceDeletesUnmergedBranchWithExactBranchName(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.UpdateCommit)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	preview := mustPreviewDeleteBranch(t, svc, repo, compare.Branch, "refs/heads/"+compare.Branch, "local")
	if preview.SafeDeleteAllowed || !preview.ForceDeleteAllowed {
		t.Fatalf("expected force delete fallback for unmerged branch: %+v", preview)
	}

	resp, err := svc.deleteBranch(
		context.Background(),
		repo,
		deleteBranchOptions{
			Name:              compare.Branch,
			FullName:          "refs/heads/" + compare.Branch,
			Kind:              "local",
			DeleteMode:        string(deleteBranchModeForce),
			ConfirmBranchName: compare.Branch,
			PlanFingerprint:   preview.PlanFingerprint,
		},
	)
	if err != nil {
		t.Fatalf("force deleteBranch(unmerged): %v", err)
	}
	if resp.HeadRef != compare.BaseBranch {
		t.Fatalf("HeadRef=%q, want %q", resp.HeadRef, compare.BaseBranch)
	}
	if gitRefExists(context.Background(), fixture.Root, "refs/heads/"+compare.Branch) {
		t.Fatalf("expected branch %q to be force deleted", compare.Branch)
	}
}

func TestDeleteBranch_RejectsForceDeleteWhenBranchNameConfirmationMismatches(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.UpdateCommit)
	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	preview := mustPreviewDeleteBranch(t, svc, repo, compare.Branch, "refs/heads/"+compare.Branch, "local")
	_, err = svc.deleteBranch(
		context.Background(),
		repo,
		deleteBranchOptions{
			Name:              compare.Branch,
			FullName:          "refs/heads/" + compare.Branch,
			Kind:              "local",
			DeleteMode:        string(deleteBranchModeForce),
			ConfirmBranchName: "feature/wrong-branch",
			PlanFingerprint:   preview.PlanFingerprint,
		},
	)
	if err == nil {
		t.Fatalf("expected force delete confirmation mismatch to fail")
	}
	if !strings.Contains(err.Error(), "branch name confirmation does not match") {
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
	if !preview.ForceDeleteAllowed || !preview.ForceDeleteRequiresConfirm {
		t.Fatalf("expected force delete fallback for linked worktree preview: %+v", preview)
	}
}

func TestPreviewDeleteBranch_BlocksForceDeleteForInaccessibleLinkedWorktree(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.UpdateCommit)
	worktree := filepath.Join(t.TempDir(), "compare-inaccessible-wt")
	runGitFixture(t, fixture.Root, "worktree", "add", worktree, compare.Branch)

	svc := NewService(fixture.Root)
	repo, err := svc.resolveExplicitRepo(context.Background(), fixture.Root)
	if err != nil {
		t.Fatalf("resolveExplicitRepo: %v", err)
	}

	preview := mustPreviewDeleteBranch(t, svc, repo, compare.Branch, "refs/heads/"+compare.Branch, "local")
	if preview.LinkedWorktree == nil || preview.LinkedWorktree.Accessible {
		t.Fatalf("expected inaccessible linked worktree preview: %+v", preview)
	}
	if preview.SafeDeleteAllowed {
		t.Fatalf("expected safe delete to remain blocked for unmerged branch: %+v", preview)
	}
	if preview.ForceDeleteAllowed {
		t.Fatalf("expected force delete to be blocked for inaccessible linked worktree: %+v", preview)
	}
	if !strings.Contains(preview.BlockingReason, "not accessible from this runtime host") {
		t.Fatalf("unexpected blocking reason: %+v", preview)
	}
	if preview.ForceDeleteReason != preview.BlockingReason {
		t.Fatalf("expected force delete reason to mirror the blocking reason: %+v", preview)
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
	_, err = svc.deleteBranch(context.Background(), repo, deleteBranchOptions{
		Name:            remoteName,
		FullName:        "refs/remotes/" + remoteName,
		Kind:            "remote",
		DeleteMode:      string(deleteBranchModeSafe),
		PlanFingerprint: "stale",
	})
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
		deleteBranchOptions{
			Name:                 compare.Branch,
			FullName:             "refs/heads/" + compare.Branch,
			Kind:                 "local",
			DeleteMode:           string(deleteBranchModeSafe),
			RemoveLinkedWorktree: true,
			PlanFingerprint:      preview.PlanFingerprint,
		},
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
		deleteBranchOptions{
			Name:                 compare.Branch,
			FullName:             "refs/heads/" + compare.Branch,
			Kind:                 "local",
			DeleteMode:           string(deleteBranchModeSafe),
			RemoveLinkedWorktree: true,
			PlanFingerprint:      preview.PlanFingerprint,
		},
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
		deleteBranchOptions{
			Name:                         compare.Branch,
			FullName:                     "refs/heads/" + compare.Branch,
			Kind:                         "local",
			DeleteMode:                   string(deleteBranchModeSafe),
			RemoveLinkedWorktree:         true,
			DiscardLinkedWorktreeChanges: true,
			PlanFingerprint:              preview.PlanFingerprint,
		},
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

func TestDeleteBranch_ForceDeletesUnmergedDirtyLinkedWorktreeAndBranch(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.UpdateCommit)
	serviceRoot := filepath.Dir(fixture.Root)
	worktree := filepath.Join(serviceRoot, "compare-force-wt")
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
	if preview.SafeDeleteAllowed || !preview.ForceDeleteAllowed || !preview.RequiresDiscardConfirmation {
		t.Fatalf("unexpected preview for force delete linked worktree: %+v", preview)
	}

	resp, err := svc.deleteBranch(
		context.Background(),
		repo,
		deleteBranchOptions{
			Name:                 compare.Branch,
			FullName:             "refs/heads/" + compare.Branch,
			Kind:                 "local",
			DeleteMode:           string(deleteBranchModeForce),
			ConfirmBranchName:    compare.Branch,
			RemoveLinkedWorktree: true,
			PlanFingerprint:      preview.PlanFingerprint,
		},
	)
	if err != nil {
		t.Fatalf("force deleteBranch(unmerged linked worktree): %v", err)
	}
	if !resp.LinkedWorktreeRemoved {
		t.Fatalf("expected linked worktree removal: %+v", resp)
	}
	if _, err := os.Stat(worktree); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected worktree %q to be removed, err=%v", worktree, err)
	}
	if gitRefExists(context.Background(), fixture.Root, "refs/heads/"+compare.Branch) {
		t.Fatalf("expected branch %q to be force deleted", compare.Branch)
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
		deleteBranchOptions{
			Name:            compare.Branch,
			FullName:        "refs/heads/" + compare.Branch,
			Kind:            "local",
			DeleteMode:      string(deleteBranchModeSafe),
			PlanFingerprint: preview.PlanFingerprint,
		},
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
			content := mustGetDiffContent(t, svc, repo, getDiffContentReq{
				RepoRootPath: fixture.Root,
				SourceKind:   "compare",
				BaseRef:      compare.BaseBranch,
				TargetRef:    compare.Branch,
				Mode:         "preview",
				File: gitDiffFileRef{
					ChangeType: file.ChangeType,
					Path:       file.Path,
					OldPath:    file.OldPath,
					NewPath:    file.NewPath,
				},
			})
			foundFile = strings.Contains(content.File.PatchText, "+feature branch") && strings.Contains(content.File.PatchText, compare.FilePath)
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
