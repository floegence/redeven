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
