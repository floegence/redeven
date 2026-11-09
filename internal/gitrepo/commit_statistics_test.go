package gitrepo

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/floegence/redeven/internal/session"
)

func TestRepoSummaryCommitStatisticsCoverEntireIndex(t *testing.T) {
	fixture := createTestRepoFixture(t)
	writeFixtureFile(t, fixture.Root, "src/main.txt", []byte("one\nchanged\nadded\n"))
	writeFixtureFile(t, fixture.Root, "nested/new.txt", []byte("new\n"))
	runGitFixture(t, fixture.Root, "add", ".")
	writeFixtureFile(t, fixture.Root, "nested/new.txt", []byte("not staged\nnot counted\n"))
	client := newGitRepoRPCClient(NewService(fixture.Root), &session.Meta{CanRead: true})
	payload, rpcErr, err := client.Call(context.Background(), TypeID_GIT_GET_REPO_SUMMARY, mustMarshalJSON(t, getRepoSummaryReq{RepoRootPath: fixture.Root}))
	if err != nil || rpcErr != nil {
		t.Fatalf("summary: %v %v", err, rpcErr)
	}
	var response struct {
		StagedStats *struct {
			Additions int `json:"additions"`
			Deletions int `json:"deletions"`
		} `json:"staged_stats"`
	}
	if err := json.Unmarshal(payload, &response); err != nil {
		t.Fatal(err)
	}
	if response.StagedStats == nil || response.StagedStats.Additions != 3 || response.StagedStats.Deletions != 1 {
		t.Fatalf("whole index metrics: %s", payload)
	}
}

func TestStagedStatisticsHandleNonTextChangesAndEmptyIndex(t *testing.T) {
	fixture := createTestRepoFixture(t)
	service := NewService(fixture.Root)
	if got := service.readStagedStats(context.Background(), fixture.Root, 0); got == nil || *got != (gitStagedStats{}) {
		t.Fatalf("empty index: %+v", got)
	}
	writeFixtureFile(t, fixture.Root, "binary.dat", []byte{0, 1, 2, 3})
	runGitFixture(t, fixture.Root, "add", "binary.dat")
	if got := service.readStagedStats(context.Background(), fixture.Root, 1); got == nil || *got != (gitStagedStats{}) {
		t.Fatalf("binary file: %+v", got)
	}
	runGitFixture(t, fixture.Root, "commit", "-m", "add binary fixture")
	runGitFixture(t, fixture.Root, "mv", "src/main.txt", "src/renamed.txt")
	if got := service.readStagedStats(context.Background(), fixture.Root, 1); got == nil || *got != (gitStagedStats{}) {
		t.Fatalf("pure rename: %+v", got)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got := service.readStagedStats(ctx, fixture.Root, 1); got != nil {
		t.Fatalf("cancelled read must remain unknown: %+v", got)
	}
}
