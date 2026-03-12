package gitrepo

import (
	"context"
	"encoding/json"
	"net"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven-agent/internal/session"
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
	if len(detailResp.Files) != 1 || detailResp.Files[0].ChangeType != "renamed" {
		t.Fatalf("unexpected detail files: %+v", detailResp.Files)
	}
	if !strings.Contains(detailResp.Files[0].PatchText, "rename to src/main.txt") || !strings.Contains(detailResp.Files[0].PatchText, "diff --git") {
		t.Fatalf("detail patch text not embedded: %+v", detailResp.Files[0])
	}

	cancel()
	_ = clientConn.Close()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatalf("rpc server did not stop")
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
	if !strings.Contains(workspaceResp.Staged[0].PatchText, "+staged") || !strings.Contains(workspaceResp.Unstaged[0].PatchText, "+unstaged") {
		t.Fatalf("workspace patch text not embedded: staged=%+v unstaged=%+v", workspaceResp.Staged[0], workspaceResp.Unstaged[0])
	}
	if !strings.Contains(workspaceResp.Untracked[0].PatchText, "diff --git a/todo.txt b/todo.txt") || !strings.Contains(workspaceResp.Untracked[0].PatchText, "+todo") {
		t.Fatalf("untracked entry should include patch text: %+v", workspaceResp.Untracked[0])
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
	if !strings.Contains(compareResp.Files[0].PatchText, "+feature branch") || !strings.Contains(compareResp.Files[0].PatchText, compare.FilePath) {
		t.Fatalf("compare patch text not embedded: %+v", compareResp.Files[0])
	}
}

func startGitRepoRPCSession(t *testing.T, svc *Service) (*rpc.Client, func()) {
	t.Helper()
	serverConn, clientConn := net.Pipe()
	router := rpc.NewRouter()
	svc.Register(router, &session.Meta{CanRead: true})
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
