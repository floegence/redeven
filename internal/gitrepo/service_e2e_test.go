package gitrepo

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/floegence/flowersec/flowersec-go/framing/jsonframe"
	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven-agent/internal/session"
)

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

	resolvePayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_RESOLVE_REPO, []byte(`{"path":"/src"}`))
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
	if !resolveResp.Available || resolveResp.RepoRootPath != "/" {
		t.Fatalf("unexpected resolve response: %+v", resolveResp)
	}

	listPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_LIST_COMMITS, []byte(`{"repo_root_path":"/","limit":2}`))
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

	detailReq := getCommitDetailReq{RepoRootPath: "/", Commit: fixture.RenameCommit}
	detailReqBytes, _ := json.Marshal(detailReq)
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

	cancel()
	_ = clientConn.Close()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatalf("rpc server did not stop")
	}
}

func TestE2E_GitRepoPatchStream(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	svc := NewService(fixture.Root)
	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() { _ = serverConn.Close() })
	t.Cleanup(func() { _ = clientConn.Close() })

	go svc.ServeReadCommitPatchStream(context.Background(), serverConn, &session.Meta{CanRead: true})

	req := readCommitPatchReq{
		RepoRootPath: "/",
		Commit:       fixture.RenameCommit,
		FilePath:     "src/main.txt",
		MaxBytes:     1024 * 1024,
	}
	if err := jsonframe.WriteJSONFrame(clientConn, req); err != nil {
		t.Fatalf("write request: %v", err)
	}
	metaBytes, err := jsonframe.ReadJSONFrame(clientConn, jsonframe.DefaultMaxJSONFrameBytes)
	if err != nil {
		t.Fatalf("read response meta: %v", err)
	}
	var meta readCommitPatchRespMeta
	if err := json.Unmarshal(metaBytes, &meta); err != nil {
		t.Fatalf("unmarshal response meta: %v", err)
	}
	if !meta.Ok || meta.ContentLen <= 0 {
		t.Fatalf("unexpected patch meta: %+v", meta)
	}
	patch := make([]byte, meta.ContentLen)
	if _, err := io.ReadFull(clientConn, patch); err != nil {
		t.Fatalf("read patch: %v", err)
	}
	text := string(patch)
	if !strings.Contains(text, "diff --git") || !strings.Contains(text, "src/main.txt") {
		t.Fatalf("unexpected patch text: %s", text)
	}
}

func TestE2E_GitRepoPatchStream_Truncates(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	svc := NewService(fixture.Root)
	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() { _ = serverConn.Close() })
	t.Cleanup(func() { _ = clientConn.Close() })

	go svc.ServeReadCommitPatchStream(context.Background(), serverConn, &session.Meta{CanRead: true})

	req := readCommitPatchReq{
		RepoRootPath: "/",
		Commit:       fixture.BinaryCommit,
		MaxBytes:     32,
	}
	if err := jsonframe.WriteJSONFrame(clientConn, req); err != nil {
		t.Fatalf("write request: %v", err)
	}
	metaBytes, err := jsonframe.ReadJSONFrame(clientConn, jsonframe.DefaultMaxJSONFrameBytes)
	if err != nil {
		t.Fatalf("read response meta: %v", err)
	}
	var meta readCommitPatchRespMeta
	if err := json.Unmarshal(metaBytes, &meta); err != nil {
		t.Fatalf("unmarshal response meta: %v", err)
	}
	if !meta.Ok || !meta.Truncated || meta.ContentLen != 32 {
		t.Fatalf("unexpected truncation meta: %+v", meta)
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

	page1Payload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_LIST_COMMITS, []byte(`{"repo_root_path":"/","offset":0,"limit":2}`))
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

	page2Payload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_LIST_COMMITS, []byte(`{"repo_root_path":"/","offset":2,"limit":2}`))
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

	summaryPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_GET_REPO_SUMMARY, []byte(`{"repo_root_path":"/"}`))
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
	if summaryResp.RepoRootPath != "/" {
		t.Fatalf("summary repo_root_path=%q, want /", summaryResp.RepoRootPath)
	}
	if summaryResp.HeadRef != compare.BaseBranch {
		t.Fatalf("summary head_ref=%q, want %q", summaryResp.HeadRef, compare.BaseBranch)
	}
	if summaryResp.WorkspaceSummary.StagedCount != 1 || summaryResp.WorkspaceSummary.UnstagedCount != 1 || summaryResp.WorkspaceSummary.UntrackedCount != 1 {
		t.Fatalf("unexpected workspace summary: %+v", summaryResp.WorkspaceSummary)
	}

	workspacePayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_LIST_WORKSPACE, []byte(`{"repo_root_path":"/"}`))
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

	branchesPayload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_LIST_BRANCHES, []byte(`{"repo_root_path":"/"}`))
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
		RepoRootPath: "/",
		BaseRef:      compare.BaseBranch,
		TargetRef:    compare.Branch,
		Limit:        20,
	}
	compareReqBytes, _ := json.Marshal(compareReq)
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
}

func TestE2E_GitRepoWorkspacePatchStream(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	workspace := createWorkspaceChangesFixture(t, fixture.Root)
	svc := NewService(fixture.Root)
	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() { _ = serverConn.Close() })
	t.Cleanup(func() { _ = clientConn.Close() })

	go svc.ServeReadWorkspacePatchStream(context.Background(), serverConn, &session.Meta{CanRead: true})

	req := readWorkspacePatchReq{
		RepoRootPath: "/",
		Section:      "staged",
		FilePath:     workspace.TrackedPath,
		MaxBytes:     1024 * 1024,
	}
	if err := jsonframe.WriteJSONFrame(clientConn, req); err != nil {
		t.Fatalf("write request: %v", err)
	}
	metaBytes, err := jsonframe.ReadJSONFrame(clientConn, jsonframe.DefaultMaxJSONFrameBytes)
	if err != nil {
		t.Fatalf("read response meta: %v", err)
	}
	var meta readCommitPatchRespMeta
	if err := json.Unmarshal(metaBytes, &meta); err != nil {
		t.Fatalf("unmarshal response meta: %v", err)
	}
	if !meta.Ok || meta.ContentLen <= 0 {
		t.Fatalf("unexpected patch meta: %+v", meta)
	}
	patch := make([]byte, meta.ContentLen)
	if _, err := io.ReadFull(clientConn, patch); err != nil {
		t.Fatalf("read patch: %v", err)
	}
	text := string(patch)
	if !strings.Contains(text, workspace.TrackedPath) || !strings.Contains(text, "+staged") {
		t.Fatalf("unexpected workspace patch text: %s", text)
	}
}

func TestE2E_GitRepoComparePatchStream(t *testing.T) {
	t.Parallel()
	fixture := createTestRepoFixture(t)
	compare := createComparisonBranchFixture(t, fixture.Root, fixture.UpdateCommit)
	svc := NewService(fixture.Root)
	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() { _ = serverConn.Close() })
	t.Cleanup(func() { _ = clientConn.Close() })

	go svc.ServeReadComparePatchStream(context.Background(), serverConn, &session.Meta{CanRead: true})

	req := readComparePatchReq{
		RepoRootPath: "/",
		BaseRef:      compare.BaseBranch,
		TargetRef:    compare.Branch,
		FilePath:     compare.FilePath,
		MaxBytes:     1024 * 1024,
	}
	if err := jsonframe.WriteJSONFrame(clientConn, req); err != nil {
		t.Fatalf("write request: %v", err)
	}
	metaBytes, err := jsonframe.ReadJSONFrame(clientConn, jsonframe.DefaultMaxJSONFrameBytes)
	if err != nil {
		t.Fatalf("read response meta: %v", err)
	}
	var meta readCommitPatchRespMeta
	if err := json.Unmarshal(metaBytes, &meta); err != nil {
		t.Fatalf("unmarshal response meta: %v", err)
	}
	if !meta.Ok || meta.ContentLen <= 0 {
		t.Fatalf("unexpected compare meta: %+v", meta)
	}
	patch := make([]byte, meta.ContentLen)
	if _, err := io.ReadFull(clientConn, patch); err != nil {
		t.Fatalf("read compare patch: %v", err)
	}
	text := string(patch)
	if !strings.Contains(text, compare.FilePath) || !strings.Contains(text, "+feature branch") {
		t.Fatalf("unexpected compare patch text: %s", text)
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
