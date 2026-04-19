package gitrepo

import (
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven/internal/session"
)

func mustMarshalJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("json.Marshal(%T): %v", value, err)
	}
	return data
}

func mustEvalPathE2E(t *testing.T, value string) string {
	t.Helper()
	resolved, err := filepath.EvalSymlinks(value)
	if err != nil {
		t.Fatalf("filepath.EvalSymlinks(%q): %v", value, err)
	}
	return filepath.Clean(resolved)
}

func TestE2E_GitRepoRPC_ResolveListDetail(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	svc := NewService(fixture.Root)
	meta := &session.Meta{CanRead: true}

	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() { _ = serverConn.Close() })
	t.Cleanup(func() { _ = clientConn.Close() })

	router := rpc.NewRouter()
	svc.Register(router, meta)
	server := rpc.NewServer(serverConn, router)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	done := make(chan error, 1)
	go func() {
		done <- server.Serve(ctx)
	}()

	client := rpc.NewClient(clientConn)

	resolvePayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_RESOLVE_REPO, mustMarshalJSON(t, resolveRepoReq{
		Path: filepath.Join(fixture.Root, "src"),
	}))
	if err != nil {
		t.Fatalf("resolve repo call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("resolve repo rpc error: %+v", rpcErr)
	}
	var resolveResp resolveRepoResp
	if err := json.Unmarshal(resolvePayload, &resolveResp); err != nil {
		t.Fatalf("unmarshal resolve: %v", err)
	}
	if !resolveResp.Available || mustEvalPathE2E(t, resolveResp.RepoRootPath) != mustEvalPathE2E(t, fixture.Root) {
		t.Fatalf("unexpected resolve response: %+v", resolveResp)
	}

	listPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_LIST_COMMITS, mustMarshalJSON(t, listCommitsReq{
		RepoRootPath: fixture.Root,
		Limit:        2,
	}))
	if err != nil {
		t.Fatalf("list commits call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("list commits rpc error: %+v", rpcErr)
	}
	var listResp listCommitsResp
	if err := json.Unmarshal(listPayload, &listResp); err != nil {
		t.Fatalf("unmarshal list: %v", err)
	}
	if len(listResp.Commits) != 2 || !listResp.HasMore {
		t.Fatalf("unexpected list response: %+v", listResp)
	}

	detailReq := getCommitDetailReq{RepoRootPath: fixture.Root, Commit: fixture.RenameCommit}
	detailReqBytes := mustMarshalJSON(t, detailReq)
	detailPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_GET_COMMIT_DETAIL, detailReqBytes)
	if err != nil {
		t.Fatalf("get detail call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("get detail rpc error: %+v", rpcErr)
	}
	var detailResp getCommitDetailResp
	if err := json.Unmarshal(detailPayload, &detailResp); err != nil {
		t.Fatalf("unmarshal detail: %v", err)
	}
	if detailResp.Commit.Hash != fixture.RenameCommit {
		t.Fatalf("detail hash=%q, want %q", detailResp.Commit.Hash, fixture.RenameCommit)
	}
	if detailResp.Presentation.Mode != gitCommitDiffModePlain || detailResp.Presentation.MergeCommit {
		t.Fatalf("detail presentation=%+v, want plain non-merge", detailResp.Presentation)
	}
	if len(detailResp.Files) != 1 || detailResp.Files[0].ChangeType != "renamed" {
		t.Fatalf("unexpected detail files: %+v", detailResp.Files)
	}
	if detailResp.Files[0].NewPath != "src/main.txt" {
		t.Fatalf("detail metadata mismatch: %+v", detailResp.Files[0])
	}

	fullContextPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_DIFF_CONTENT, mustMarshalJSON(t, getDiffContentReq{
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
	}))
	if err != nil {
		t.Fatalf("get full-context diff call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("get full-context diff rpc error: %+v", rpcErr)
	}
	var fullContextResp getDiffContentResp
	if err := json.Unmarshal(fullContextPayload, &fullContextResp); err != nil {
		t.Fatalf("unmarshal full-context diff: %v", err)
	}
	if fullContextResp.File.ChangeType != "renamed" || fullContextResp.File.OldPath != "src/app.txt" || fullContextResp.File.NewPath != "src/main.txt" {
		t.Fatalf("unexpected full-context diff file: %+v", fullContextResp.File)
	}
	if fullContextResp.Presentation.Mode != gitCommitDiffModePlain || fullContextResp.Presentation.MergeCommit {
		t.Fatalf("full-context presentation=%+v, want plain non-merge", fullContextResp.Presentation)
	}
	if !strings.Contains(fullContextResp.File.PatchText, "rename from src/app.txt") || strings.Contains(fullContextResp.File.PatchText, "new file mode") {
		t.Fatalf("full-context rename diff should preserve rename metadata: %+v", fullContextResp.File)
	}

	cancel()
	_ = clientConn.Close()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatalf("rpc server did not stop")
	}
}

func TestE2E_GitRepoRPC_MergeCommitDetailUsesFirstParentPresentation(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	mergeFixture := createMergeCommitBranchFixture(t, fixture.Root)
	runGitFixture(t, fixture.Root, "merge", "--no-ff", mergeFixture.Branch, "-m", "merge feature branch")
	mergeCommit := runGitFixture(t, fixture.Root, "rev-parse", "HEAD")

	svc := NewService(fixture.Root)
	client, closeServer := startGitRepoRPCSession(t, svc)
	defer closeServer()

	detailPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_GET_COMMIT_DETAIL, mustMarshalJSON(t, getCommitDetailReq{
		RepoRootPath: fixture.Root,
		Commit:       mergeCommit,
	}))
	if err != nil {
		t.Fatalf("get merge detail call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("get merge detail rpc error: %+v", rpcErr)
	}
	var detailResp getCommitDetailResp
	if err := json.Unmarshal(detailPayload, &detailResp); err != nil {
		t.Fatalf("unmarshal merge detail: %v", err)
	}
	if detailResp.Commit.Hash != mergeCommit {
		t.Fatalf("merge detail hash=%q, want %q", detailResp.Commit.Hash, mergeCommit)
	}
	if !detailResp.Presentation.MergeCommit || detailResp.Presentation.Mode != gitCommitDiffModeFirstParent || detailResp.Presentation.ParentCount != 2 {
		t.Fatalf("merge detail presentation=%+v, want first-parent merge with 2 parents", detailResp.Presentation)
	}
	if len(detailResp.Files) != 1 || detailResp.Files[0].Path != "src/feature-merge.txt" || detailResp.Files[0].ChangeType != "added" {
		t.Fatalf("unexpected merge detail files: %+v", detailResp.Files)
	}

	diffPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_DIFF_CONTENT, mustMarshalJSON(t, getDiffContentReq{
		RepoRootPath: fixture.Root,
		SourceKind:   "commit",
		Commit:       mergeCommit,
		Mode:         "preview",
		File: gitDiffFileRef{
			ChangeType: detailResp.Files[0].ChangeType,
			Path:       detailResp.Files[0].Path,
			OldPath:    detailResp.Files[0].OldPath,
			NewPath:    detailResp.Files[0].NewPath,
		},
	}))
	if err != nil {
		t.Fatalf("get merge diff call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("get merge diff rpc error: %+v", rpcErr)
	}
	var diffResp getDiffContentResp
	if err := json.Unmarshal(diffPayload, &diffResp); err != nil {
		t.Fatalf("unmarshal merge diff: %v", err)
	}
	if !diffResp.Presentation.MergeCommit || diffResp.Presentation.Mode != gitCommitDiffModeFirstParent {
		t.Fatalf("merge diff presentation=%+v, want first-parent merge", diffResp.Presentation)
	}
	if !strings.Contains(diffResp.File.PatchText, "diff --git") || !strings.Contains(diffResp.File.PatchText, "src/feature-merge.txt") {
		t.Fatalf("merge diff patch mismatch: %+v", diffResp.File)
	}
}

func TestE2E_GitRepoRPC_ListCommitsPagination(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	svc := NewService(fixture.Root)
	meta := &session.Meta{CanRead: true}

	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() { _ = serverConn.Close() })
	t.Cleanup(func() { _ = clientConn.Close() })

	router := rpc.NewRouter()
	svc.Register(router, meta)
	server := rpc.NewServer(serverConn, router)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	done := make(chan error, 1)
	go func() {
		done <- server.Serve(ctx)
	}()

	client := rpc.NewClient(clientConn)

	page1Payload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_LIST_COMMITS, mustMarshalJSON(t, listCommitsReq{
		RepoRootPath: fixture.Root,
		Offset:       0,
		Limit:        2,
	}))
	if err != nil {
		t.Fatalf("list commits page1 call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("list commits page1 rpc error: %+v", rpcErr)
	}
	var page1 listCommitsResp
	if err := json.Unmarshal(page1Payload, &page1); err != nil {
		t.Fatalf("unmarshal page1: %v", err)
	}
	if !page1.HasMore || page1.NextOffset != 2 {
		t.Fatalf("unexpected page1 paging: %+v", page1)
	}
	if len(page1.Commits) != 2 || page1.Commits[0].Hash != fixture.BinaryCommit || page1.Commits[1].Hash != fixture.RenameCommit {
		t.Fatalf("unexpected page1 commits: %+v", page1.Commits)
	}

	page2Payload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_LIST_COMMITS, mustMarshalJSON(t, listCommitsReq{
		RepoRootPath: fixture.Root,
		Offset:       2,
		Limit:        2,
	}))
	if err != nil {
		t.Fatalf("list commits page2 call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("list commits page2 rpc error: %+v", rpcErr)
	}
	var page2 listCommitsResp
	if err := json.Unmarshal(page2Payload, &page2); err != nil {
		t.Fatalf("unmarshal page2: %v", err)
	}
	if page2.HasMore || page2.NextOffset != 0 {
		t.Fatalf("unexpected page2 paging: %+v", page2)
	}
	if len(page2.Commits) != 2 || page2.Commits[0].Hash != fixture.UpdateCommit || page2.Commits[1].Hash != fixture.InitialCommit {
		t.Fatalf("unexpected page2 commits: %+v", page2.Commits)
	}

	cancel()
	_ = clientConn.Close()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatalf("rpc server did not stop")
	}
}

func TestE2E_GitRepoRPC_WorkbenchEndpoints(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.UpdateCommit)
	workspace := createWorkspaceChangesFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	client, closeServer := startGitRepoRPCSession(t, svc)
	defer closeServer()

	summaryPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_GET_REPO_SUMMARY, mustMarshalJSON(t, getRepoSummaryReq{
		RepoRootPath: fixture.Root,
	}))
	if err != nil {
		t.Fatalf("get repo summary call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("get repo summary rpc error: %+v", rpcErr)
	}
	var summaryResp getRepoSummaryResp
	if err := json.Unmarshal(summaryPayload, &summaryResp); err != nil {
		t.Fatalf("unmarshal get repo summary: %v", err)
	}
	if mustEvalPathE2E(t, summaryResp.RepoRootPath) != mustEvalPathE2E(t, fixture.Root) {
		t.Fatalf("summary repo_root_path=%q, want %q", summaryResp.RepoRootPath, fixture.Root)
	}
	if summaryResp.HeadRef != compare.BaseBranch {
		t.Fatalf("summary head_ref=%q, want %q", summaryResp.HeadRef, compare.BaseBranch)
	}
	if summaryResp.WorkspaceSummary.StagedCount != 1 || summaryResp.WorkspaceSummary.UnstagedCount != 1 || summaryResp.WorkspaceSummary.UntrackedCount != 1 {
		t.Fatalf("unexpected workspace summary: %+v", summaryResp.WorkspaceSummary)
	}

	workspacePayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_LIST_WORKSPACE, mustMarshalJSON(t, listWorkspaceChangesReq{
		RepoRootPath: fixture.Root,
	}))
	if err != nil {
		t.Fatalf("list workspace call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("list workspace rpc error: %+v", rpcErr)
	}
	var workspaceResp listWorkspaceChangesResp
	if err := json.Unmarshal(workspacePayload, &workspaceResp); err != nil {
		t.Fatalf("unmarshal list workspace: %v", err)
	}
	if len(workspaceResp.Staged) != 1 || workspaceResp.Staged[0].Path != workspace.TrackedPath {
		t.Fatalf("unexpected staged items: %+v", workspaceResp.Staged)
	}
	if len(workspaceResp.Unstaged) != 1 || workspaceResp.Unstaged[0].Path != workspace.TrackedPath {
		t.Fatalf("unexpected unstaged items: %+v", workspaceResp.Unstaged)
	}
	if len(workspaceResp.Untracked) != 1 || workspaceResp.Untracked[0].Path != workspace.UntrackedPath {
		t.Fatalf("unexpected untracked items: %+v", workspaceResp.Untracked)
	}
	workspacePagePayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_LIST_WORKSPACE_PAGE, mustMarshalJSON(t, listWorkspacePageReq{
		RepoRootPath: fixture.Root,
		Section:      "changes",
		Offset:       0,
		Limit:        1,
	}))
	if err != nil {
		t.Fatalf("list workspace page call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("list workspace page rpc error: %+v", rpcErr)
	}
	var workspacePageResp listWorkspacePageResp
	if err := json.Unmarshal(workspacePagePayload, &workspacePageResp); err != nil {
		t.Fatalf("unmarshal list workspace page: %v", err)
	}
	if workspacePageResp.Section != "changes" || workspacePageResp.TotalCount != 2 || workspacePageResp.NextOffset != 1 || !workspacePageResp.HasMore {
		t.Fatalf("unexpected workspace page response: %+v", workspacePageResp)
	}
	if len(workspacePageResp.Items) != 1 || workspacePageResp.Items[0].EntryKind != "directory" || workspacePageResp.Items[0].DirectoryPath != "src" {
		t.Fatalf("unexpected workspace page items: %+v", workspacePageResp.Items)
	}
	stagedDiffPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_DIFF_CONTENT, mustMarshalJSON(t, getDiffContentReq{
		RepoRootPath:     fixture.Root,
		SourceKind:       "workspace",
		WorkspaceSection: "staged",
		Mode:             "preview",
		File: gitDiffFileRef{
			ChangeType: workspaceResp.Staged[0].ChangeType,
			Path:       workspaceResp.Staged[0].Path,
			OldPath:    workspaceResp.Staged[0].OldPath,
			NewPath:    workspaceResp.Staged[0].NewPath,
		},
	}))
	if err != nil {
		t.Fatalf("get staged diff call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("get staged diff rpc error: %+v", rpcErr)
	}
	var stagedDiffResp getDiffContentResp
	if err := json.Unmarshal(stagedDiffPayload, &stagedDiffResp); err != nil {
		t.Fatalf("unmarshal staged diff: %v", err)
	}
	if !strings.Contains(stagedDiffResp.File.PatchText, "+staged") {
		t.Fatalf("unexpected staged diff content: %+v", stagedDiffResp.File)
	}
	untrackedDiffPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_DIFF_CONTENT, mustMarshalJSON(t, getDiffContentReq{
		RepoRootPath:     fixture.Root,
		SourceKind:       "workspace",
		WorkspaceSection: "untracked",
		Mode:             "preview",
		File: gitDiffFileRef{
			ChangeType: workspaceResp.Untracked[0].ChangeType,
			Path:       workspaceResp.Untracked[0].Path,
			OldPath:    workspaceResp.Untracked[0].OldPath,
			NewPath:    workspaceResp.Untracked[0].NewPath,
		},
	}))
	if err != nil {
		t.Fatalf("get untracked diff call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("get untracked diff rpc error: %+v", rpcErr)
	}
	var untrackedDiffResp getDiffContentResp
	if err := json.Unmarshal(untrackedDiffPayload, &untrackedDiffResp); err != nil {
		t.Fatalf("unmarshal untracked diff: %v", err)
	}
	if !strings.Contains(untrackedDiffResp.File.PatchText, "diff --git a/todo.txt b/todo.txt") || !strings.Contains(untrackedDiffResp.File.PatchText, "+todo") {
		t.Fatalf("unexpected untracked diff content: %+v", untrackedDiffResp.File)
	}

	branchesPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_LIST_BRANCHES, mustMarshalJSON(t, listBranchesReq{
		RepoRootPath: fixture.Root,
	}))
	if err != nil {
		t.Fatalf("list branches call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("list branches rpc error: %+v", rpcErr)
	}
	var branchesResp listBranchesResp
	if err := json.Unmarshal(branchesPayload, &branchesResp); err != nil {
		t.Fatalf("unmarshal list branches: %v", err)
	}
	if branchesResp.CurrentRef != compare.BaseBranch {
		t.Fatalf("branches current_ref=%q, want %q", branchesResp.CurrentRef, compare.BaseBranch)
	}
	foundBranch := false
	for _, branch := range branchesResp.Local {
		if branch.Name == compare.Branch {
			foundBranch = true
			break
		}
	}
	if !foundBranch {
		t.Fatalf("expected compare branch %q in local list: %+v", compare.Branch, branchesResp.Local)
	}

	compareReq := getBranchCompareReq{
		RepoRootPath: fixture.Root,
		BaseRef:      compare.BaseBranch,
		TargetRef:    compare.Branch,
		Limit:        20,
	}
	compareReqBytes := mustMarshalJSON(t, compareReq)
	comparePayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_GET_BRANCH_DIFF, compareReqBytes)
	if err != nil {
		t.Fatalf("get branch compare call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("get branch compare rpc error: %+v", rpcErr)
	}
	var compareResp getBranchCompareResp
	if err := json.Unmarshal(comparePayload, &compareResp); err != nil {
		t.Fatalf("unmarshal get branch compare: %v", err)
	}
	if compareResp.MergeBase != fixture.UpdateCommit {
		t.Fatalf("merge_base=%q, want %q", compareResp.MergeBase, fixture.UpdateCommit)
	}
	if compareResp.TargetAheadCount != 1 || compareResp.TargetBehindCount != 2 {
		t.Fatalf("ahead/behind=%d/%d, want 1/2", compareResp.TargetAheadCount, compareResp.TargetBehindCount)
	}
	if len(compareResp.Commits) != 1 || compareResp.Commits[0].Hash != compare.Commit {
		t.Fatalf("unexpected compare commits: %+v", compareResp.Commits)
	}
	if len(compareResp.Files) != 1 || compareResp.Files[0].Path != compare.FilePath {
		t.Fatalf("unexpected compare files: %+v", compareResp.Files)
	}
	compareDiffPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_DIFF_CONTENT, mustMarshalJSON(t, getDiffContentReq{
		RepoRootPath: fixture.Root,
		SourceKind:   "compare",
		BaseRef:      compare.BaseBranch,
		TargetRef:    compare.Branch,
		Mode:         "preview",
		File: gitDiffFileRef{
			ChangeType: compareResp.Files[0].ChangeType,
			Path:       compareResp.Files[0].Path,
			OldPath:    compareResp.Files[0].OldPath,
			NewPath:    compareResp.Files[0].NewPath,
		},
	}))
	if err != nil {
		t.Fatalf("get compare diff call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("get compare diff rpc error: %+v", rpcErr)
	}
	var compareDiffResp getDiffContentResp
	if err := json.Unmarshal(compareDiffPayload, &compareDiffResp); err != nil {
		t.Fatalf("unmarshal compare diff: %v", err)
	}
	if !strings.Contains(compareDiffResp.File.PatchText, "+feature branch") || !strings.Contains(compareDiffResp.File.PatchText, compare.FilePath) {
		t.Fatalf("compare diff content mismatch: %+v", compareDiffResp.File)
	}
}

func TestE2E_GitRepoRPC_StashEndpoints(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	workspace := createWorkspaceChangesFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	client, closeServer := startGitRepoRPCSession(t, svc)
	defer closeServer()

	savePayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_SAVE_STASH, mustMarshalJSON(t, saveStashReq{
		RepoRootPath:     fixture.Root,
		Message:          "rpc stash",
		IncludeUntracked: true,
	}))
	if err != nil {
		t.Fatalf("save stash call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("save stash rpc error: %+v", rpcErr)
	}
	var saveResp saveStashResp
	if err := json.Unmarshal(savePayload, &saveResp); err != nil {
		t.Fatalf("unmarshal save stash: %v", err)
	}
	if saveResp.Created == nil || strings.TrimSpace(saveResp.Created.ID) == "" {
		t.Fatalf("save stash created=%+v, want populated stash summary", saveResp.Created)
	}

	listPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_LIST_STASHES, mustMarshalJSON(t, listStashesReq{
		RepoRootPath: fixture.Root,
	}))
	if err != nil {
		t.Fatalf("list stashes call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("list stashes rpc error: %+v", rpcErr)
	}
	var listResp listStashesResp
	if err := json.Unmarshal(listPayload, &listResp); err != nil {
		t.Fatalf("unmarshal list stashes: %v", err)
	}
	if len(listResp.Stashes) != 1 || listResp.Stashes[0].ID != saveResp.Created.ID {
		t.Fatalf("unexpected stash list: %+v", listResp.Stashes)
	}

	detailPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_GET_STASH_DETAIL, mustMarshalJSON(t, getStashDetailReq{
		RepoRootPath: fixture.Root,
		ID:           saveResp.Created.ID,
	}))
	if err != nil {
		t.Fatalf("get stash detail call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("get stash detail rpc error: %+v", rpcErr)
	}
	var detailResp getStashDetailResp
	if err := json.Unmarshal(detailPayload, &detailResp); err != nil {
		t.Fatalf("unmarshal stash detail: %v", err)
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

	trackedDiffPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_DIFF_CONTENT, mustMarshalJSON(t, getDiffContentReq{
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
	}))
	if err != nil {
		t.Fatalf("get stash tracked diff call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("get stash tracked diff rpc error: %+v", rpcErr)
	}
	var trackedDiffResp getDiffContentResp
	if err := json.Unmarshal(trackedDiffPayload, &trackedDiffResp); err != nil {
		t.Fatalf("unmarshal stash tracked diff: %v", err)
	}
	if !strings.Contains(trackedDiffResp.File.PatchText, "+unstaged") {
		t.Fatalf("stash tracked diff content mismatch: %+v", trackedDiffResp.File)
	}

	untrackedDiffPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_DIFF_CONTENT, mustMarshalJSON(t, getDiffContentReq{
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
	}))
	if err != nil {
		t.Fatalf("get stash untracked diff call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("get stash untracked diff rpc error: %+v", rpcErr)
	}
	var untrackedDiffResp getDiffContentResp
	if err := json.Unmarshal(untrackedDiffPayload, &untrackedDiffResp); err != nil {
		t.Fatalf("unmarshal stash untracked diff: %v", err)
	}
	if untrackedDiffResp.File.ChangeType != "added" {
		t.Fatalf("stash untracked diff change_type=%q, want added", untrackedDiffResp.File.ChangeType)
	}
	if !strings.Contains(untrackedDiffResp.File.PatchText, "+todo") {
		t.Fatalf("stash untracked diff content mismatch: %+v", untrackedDiffResp.File)
	}

	previewApplyPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_PREVIEW_APPLY, mustMarshalJSON(t, previewApplyStashReq{
		RepoRootPath: fixture.Root,
		ID:           saveResp.Created.ID,
	}))
	if err != nil {
		t.Fatalf("preview apply stash call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("preview apply stash rpc error: %+v", rpcErr)
	}
	var previewApplyResp previewApplyStashResp
	if err := json.Unmarshal(previewApplyPayload, &previewApplyResp); err != nil {
		t.Fatalf("unmarshal preview apply stash: %v", err)
	}
	if previewApplyResp.Blocking != nil || strings.TrimSpace(previewApplyResp.BlockingReason) != "" {
		t.Fatalf("preview apply unexpectedly blocked: %+v", previewApplyResp)
	}
	if strings.TrimSpace(previewApplyResp.PlanFingerprint) == "" {
		t.Fatalf("expected apply preview fingerprint")
	}

	applyPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_APPLY_STASH, mustMarshalJSON(t, applyStashReq{
		RepoRootPath:    fixture.Root,
		ID:              saveResp.Created.ID,
		PlanFingerprint: previewApplyResp.PlanFingerprint,
	}))
	if err != nil {
		t.Fatalf("apply stash call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("apply stash rpc error: %+v", rpcErr)
	}
	var applyResp applyStashResp
	if err := json.Unmarshal(applyPayload, &applyResp); err != nil {
		t.Fatalf("unmarshal apply stash: %v", err)
	}
	if applyResp.HeadCommit != fixture.BinaryCommit {
		t.Fatalf("apply head_commit=%q, want %q", applyResp.HeadCommit, fixture.BinaryCommit)
	}

	workspacePayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_LIST_WORKSPACE, mustMarshalJSON(t, listWorkspaceChangesReq{
		RepoRootPath: fixture.Root,
	}))
	if err != nil {
		t.Fatalf("list workspace after apply call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("list workspace after apply rpc error: %+v", rpcErr)
	}
	var workspaceResp listWorkspaceChangesResp
	if err := json.Unmarshal(workspacePayload, &workspaceResp); err != nil {
		t.Fatalf("unmarshal workspace after apply: %v", err)
	}
	if workspaceResp.Summary.StagedCount != 1 || workspaceResp.Summary.UnstagedCount != 1 || workspaceResp.Summary.UntrackedCount != 1 {
		t.Fatalf("unexpected workspace summary after apply: %+v", workspaceResp.Summary)
	}

	previewDropPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_PREVIEW_DROP, mustMarshalJSON(t, previewDropStashReq{
		RepoRootPath: fixture.Root,
		ID:           saveResp.Created.ID,
	}))
	if err != nil {
		t.Fatalf("preview drop stash call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("preview drop stash rpc error: %+v", rpcErr)
	}
	var previewDropResp previewDropStashResp
	if err := json.Unmarshal(previewDropPayload, &previewDropResp); err != nil {
		t.Fatalf("unmarshal preview drop stash: %v", err)
	}
	if strings.TrimSpace(previewDropResp.PlanFingerprint) == "" {
		t.Fatalf("expected drop preview fingerprint")
	}

	dropPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_DROP_STASH, mustMarshalJSON(t, dropStashReq{
		RepoRootPath:    fixture.Root,
		ID:              saveResp.Created.ID,
		PlanFingerprint: previewDropResp.PlanFingerprint,
	}))
	if err != nil {
		t.Fatalf("drop stash call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("drop stash rpc error: %+v", rpcErr)
	}
	var dropResp dropStashResp
	if err := json.Unmarshal(dropPayload, &dropResp); err != nil {
		t.Fatalf("unmarshal drop stash: %v", err)
	}
	if dropResp.HeadCommit != fixture.BinaryCommit {
		t.Fatalf("drop head_commit=%q, want %q", dropResp.HeadCommit, fixture.BinaryCommit)
	}

	listPayload, rpcErr, err = client.Call(context.Background(), TypeID_GIT_LIST_STASHES, mustMarshalJSON(t, listStashesReq{
		RepoRootPath: fixture.Root,
	}))
	if err != nil {
		t.Fatalf("list stashes after drop call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("list stashes after drop rpc error: %+v", rpcErr)
	}
	var listAfterResp listStashesResp
	if err := json.Unmarshal(listPayload, &listAfterResp); err != nil {
		t.Fatalf("unmarshal list stashes after drop: %v", err)
	}
	if len(listAfterResp.Stashes) != 0 {
		t.Fatalf("stash count after drop=%d, want 0", len(listAfterResp.Stashes))
	}
}

func startGitRepoRPCSession(t *testing.T, svc *Service) (*rpc.Client, func()) {
	t.Helper()
	serverConn, clientConn := net.Pipe()
	router := rpc.NewRouter()
	svc.Register(router, &session.Meta{CanRead: true, CanWrite: true})
	server := rpc.NewServer(serverConn, router)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- server.Serve(ctx)
	}()

	cleanup := func() {
		cancel()
		_ = clientConn.Close()
		_ = serverConn.Close()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatalf("rpc server did not stop")
		}
	}
	return rpc.NewClient(clientConn), cleanup
}

func TestE2E_GitRepoRPC_PreviewDeleteBranchWithLinkedWorktree(t *testing.T) {
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
	client, closeServer := startGitRepoRPCSession(t, svc)
	defer closeServer()

	previewPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_PREVIEW_DELETE, mustMarshalJSON(t, previewDeleteBranchReq{
		RepoRootPath: fixture.Root,
		Name:         compare.Branch,
		FullName:     "refs/heads/" + compare.Branch,
		Kind:         "local",
	}))
	if err != nil {
		t.Fatalf("preview delete branch call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("preview delete branch rpc error: %+v", rpcErr)
	}
	var previewResp previewDeleteBranchResp
	if err := json.Unmarshal(previewPayload, &previewResp); err != nil {
		t.Fatalf("unmarshal preview delete branch: %v", err)
	}
	if !previewResp.RequiresWorktreeRemoval || !previewResp.RequiresDiscardConfirmation {
		t.Fatalf("unexpected preview flags: %+v", previewResp)
	}
	if !previewResp.ForceDeleteAllowed || !previewResp.ForceDeleteRequiresConfirm {
		t.Fatalf("expected force delete fallback in preview: %+v", previewResp)
	}
	if previewResp.LinkedWorktree == nil || !previewResp.LinkedWorktree.Accessible {
		t.Fatalf("expected accessible linked worktree: %+v", previewResp)
	}
	if mustEvalPathE2E(t, previewResp.LinkedWorktree.WorktreePath) != mustEvalPathE2E(t, worktree) {
		t.Fatalf("preview worktree path=%q, want %q", previewResp.LinkedWorktree.WorktreePath, worktree)
	}
	if len(previewResp.LinkedWorktree.Untracked) != 1 || previewResp.LinkedWorktree.Untracked[0].Path != "scratch.txt" {
		t.Fatalf("unexpected preview worktree changes: %+v", previewResp.LinkedWorktree.Untracked)
	}
}

func TestE2E_GitRepoRPC_ForceDeleteBranch(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.UpdateCommit)

	svc := NewService(fixture.Root)
	client, closeServer := startGitRepoRPCSession(t, svc)
	defer closeServer()

	previewPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_PREVIEW_DELETE, mustMarshalJSON(t, previewDeleteBranchReq{
		RepoRootPath: fixture.Root,
		Name:         compare.Branch,
		FullName:     "refs/heads/" + compare.Branch,
		Kind:         "local",
	}))
	if err != nil {
		t.Fatalf("preview delete branch call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("preview delete branch rpc error: %+v", rpcErr)
	}
	var previewResp previewDeleteBranchResp
	if err := json.Unmarshal(previewPayload, &previewResp); err != nil {
		t.Fatalf("unmarshal preview delete branch: %v", err)
	}
	if previewResp.SafeDeleteAllowed || !previewResp.ForceDeleteAllowed {
		t.Fatalf("expected force-delete-only preview: %+v", previewResp)
	}

	deletePayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_DELETE_BRANCH, mustMarshalJSON(t, deleteBranchReq{
		RepoRootPath:      fixture.Root,
		Name:              compare.Branch,
		FullName:          "refs/heads/" + compare.Branch,
		Kind:              "local",
		DeleteMode:        string(deleteBranchModeForce),
		ConfirmBranchName: compare.Branch,
		PlanFingerprint:   previewResp.PlanFingerprint,
	}))
	if err != nil {
		t.Fatalf("force delete branch call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("force delete branch rpc error: %+v", rpcErr)
	}
	var deleteResp deleteBranchResp
	if err := json.Unmarshal(deletePayload, &deleteResp); err != nil {
		t.Fatalf("unmarshal force delete branch: %v", err)
	}
	if deleteResp.HeadRef != compare.BaseBranch {
		t.Fatalf("HeadRef=%q, want %q", deleteResp.HeadRef, compare.BaseBranch)
	}
	if gitRefExists(context.Background(), fixture.Root, "refs/heads/"+compare.Branch) {
		t.Fatalf("expected branch %q to be force deleted", compare.Branch)
	}
}

func TestE2E_GitRepoRPC_DiscardWorkspace(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	workspace := createWorkspaceChangesFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	client, closeServer := startGitRepoRPCSession(t, svc)
	defer closeServer()

	discardPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_DISCARD_WORKSPACE, mustMarshalJSON(t, discardWorkspaceReq{
		RepoRootPath: fixture.Root,
		Section:      "changes",
	}))
	if err != nil {
		t.Fatalf("discard workspace call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("discard workspace rpc error: %+v", rpcErr)
	}
	var discardResp discardWorkspaceResp
	if err := json.Unmarshal(discardPayload, &discardResp); err != nil {
		t.Fatalf("unmarshal discard workspace: %v", err)
	}
	if mustEvalPathE2E(t, discardResp.RepoRootPath) != mustEvalPathE2E(t, fixture.Root) {
		t.Fatalf("discard repo_root_path=%q, want %q", discardResp.RepoRootPath, fixture.Root)
	}

	workspacePayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_LIST_WORKSPACE, mustMarshalJSON(t, listWorkspaceChangesReq{
		RepoRootPath: fixture.Root,
	}))
	if err != nil {
		t.Fatalf("list workspace call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("list workspace rpc error: %+v", rpcErr)
	}
	var workspaceResp listWorkspaceChangesResp
	if err := json.Unmarshal(workspacePayload, &workspaceResp); err != nil {
		t.Fatalf("unmarshal workspace: %v", err)
	}
	if workspaceResp.Summary.StagedCount != 1 || workspaceResp.Summary.UnstagedCount != 0 || workspaceResp.Summary.UntrackedCount != 0 {
		t.Fatalf("unexpected workspace summary after discard: %+v", workspaceResp.Summary)
	}

	data, err := os.ReadFile(filepath.Join(fixture.Root, filepath.FromSlash(workspace.TrackedPath)))
	if err != nil {
		t.Fatalf("read tracked path: %v", err)
	}
	if string(data) != "one\ntwo\nstaged\n" {
		t.Fatalf("tracked file content=%q, want staged snapshot", string(data))
	}
	if _, err := os.Stat(filepath.Join(fixture.Root, filepath.FromSlash(workspace.UntrackedPath))); !os.IsNotExist(err) {
		t.Fatalf("untracked file still exists or unexpected stat error: %v", err)
	}
}

func TestE2E_GitRepoRPC_PreviewMergeBranch(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.BinaryCommit)

	svc := NewService(fixture.Root)
	client, closeServer := startGitRepoRPCSession(t, svc)
	defer closeServer()

	payload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_PREVIEW_MERGE, mustMarshalJSON(t, previewMergeBranchReq{
		RepoRootPath: fixture.Root,
		Name:         compare.Branch,
		FullName:     "refs/heads/" + compare.Branch,
		Kind:         "local",
	}))
	if err != nil {
		t.Fatalf("preview merge branch call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("preview merge branch rpc error: %+v", rpcErr)
	}

	var resp previewMergeBranchResp
	if err := json.Unmarshal(payload, &resp); err != nil {
		t.Fatalf("unmarshal preview merge branch: %v", err)
	}
	if resp.Outcome != mergeBranchOutcomeFastForward {
		t.Fatalf("Outcome=%q, want %q", resp.Outcome, mergeBranchOutcomeFastForward)
	}
	if resp.CurrentRef != compare.BaseBranch {
		t.Fatalf("CurrentRef=%q, want %q", resp.CurrentRef, compare.BaseBranch)
	}
	if len(resp.Files) != 1 || resp.Files[0].Path != compare.FilePath {
		t.Fatalf("unexpected preview files: %+v", resp.Files)
	}
	if resp.PlanFingerprint == "" {
		t.Fatalf("expected preview fingerprint")
	}
}

func TestE2E_GitRepoRPC_MergeBranch(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.BinaryCommit)

	svc := NewService(fixture.Root)
	client, closeServer := startGitRepoRPCSession(t, svc)
	defer closeServer()

	previewPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_PREVIEW_MERGE, mustMarshalJSON(t, previewMergeBranchReq{
		RepoRootPath: fixture.Root,
		Name:         compare.Branch,
		FullName:     "refs/heads/" + compare.Branch,
		Kind:         "local",
	}))
	if err != nil {
		t.Fatalf("preview merge branch call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("preview merge branch rpc error: %+v", rpcErr)
	}

	var previewResp previewMergeBranchResp
	if err := json.Unmarshal(previewPayload, &previewResp); err != nil {
		t.Fatalf("unmarshal preview merge branch: %v", err)
	}
	if previewResp.Outcome != mergeBranchOutcomeFastForward {
		t.Fatalf("Outcome=%q, want %q", previewResp.Outcome, mergeBranchOutcomeFastForward)
	}

	mergePayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_MERGE_BRANCH, mustMarshalJSON(t, mergeBranchReq{
		RepoRootPath:    fixture.Root,
		Name:            compare.Branch,
		FullName:        "refs/heads/" + compare.Branch,
		Kind:            "local",
		PlanFingerprint: previewResp.PlanFingerprint,
	}))
	if err != nil {
		t.Fatalf("merge branch call: %v", err)
	}
	if rpcErr != nil {
		t.Fatalf("merge branch rpc error: %+v", rpcErr)
	}

	var mergeResp mergeBranchResp
	if err := json.Unmarshal(mergePayload, &mergeResp); err != nil {
		t.Fatalf("unmarshal merge branch: %v", err)
	}
	if mergeResp.Result != mergeBranchOutcomeFastForward {
		t.Fatalf("Result=%q, want %q", mergeResp.Result, mergeBranchOutcomeFastForward)
	}
	if mergeResp.HeadRef != compare.BaseBranch {
		t.Fatalf("HeadRef=%q, want %q", mergeResp.HeadRef, compare.BaseBranch)
	}
	if mergeResp.HeadCommit != compare.Commit {
		t.Fatalf("HeadCommit=%q, want %q", mergeResp.HeadCommit, compare.Commit)
	}
}
