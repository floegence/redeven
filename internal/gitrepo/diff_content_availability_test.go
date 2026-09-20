package gitrepo

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorkspaceDiffTargetAvailability(t *testing.T) {
	fixture := createTestRepoFixture(t)
	svc := NewService(fixture.Root)
	ctx := context.Background()
	repo, err := svc.resolveExplicitRepo(ctx, fixture.Root)
	if err != nil {
		t.Fatal(err)
	}
	path := " availability.txt "
	writeFixtureFile(t, fixture.Root, path, []byte("original\n"))
	request := getDiffContentReq{RepoRootPath: fixture.Root, SourceKind: "workspace", WorkspaceSection: "untracked", Mode: "preview", File: gitDiffFileRef{Path: path}}
	if _, err := svc.getDiffContent(ctx, repo, request); err != nil {
		t.Fatal(err)
	}
	runGitFixture(t, fixture.Root, "add", "--", path)
	if _, err := svc.getDiffContent(ctx, repo, request); err == nil {
		t.Fatal("a staged file still produced an untracked diff")
	}
	request.WorkspaceSection = "staged"
	if _, err := svc.getDiffContent(ctx, repo, request); err != nil {
		t.Fatal(err)
	}
	runGitFixture(t, fixture.Root, "commit", "-m", "track availability fixture")
	request.WorkspaceSection = "unstaged"
	if _, err := svc.getDiffContent(ctx, repo, request); err == nil {
		t.Fatal("an unchanged file produced a diff")
	}
	if err := os.Remove(filepath.Join(fixture.Root, path)); err != nil {
		t.Fatal(err)
	}
	deleted, err := svc.getDiffContent(ctx, repo, request)
	if err != nil || !strings.Contains(deleted.File.PatchText, "-original") {
		t.Fatalf("tracked deletion lost its diff: %v", err)
	}
	request.WorkspaceSection = "untracked"
	if _, err := svc.getDiffContent(ctx, repo, request); err == nil {
		t.Fatal("a missing untracked file produced a diff")
	}
}
