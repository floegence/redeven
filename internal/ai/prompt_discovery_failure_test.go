package ai

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
)

func TestRuleDiscoveryGitFailureCannotAdmitEmptySources(t *testing.T) {
	root := initPromptWorkspaceRepo(t)
	bin := t.TempDir()
	originalPath := os.Getenv("PATH")
	if err := os.WriteFile(filepath.Join(bin, "git"), []byte("#!/bin/sh\nexit 97\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	r := newRun(runOptions{AgentHomeDir: root, WorkingDir: root})
	if snapshot, err := r.collectModelContextSnapshot(t.Context(), FlowerPermissionFullAccess, time.Now); !errors.Is(err, flruntime.ErrModelContextUnavailable) || snapshot != nil {
		t.Fatalf("failed root probe admitted empty rules: snapshot=%+v err=%v", snapshot, err)
	}
	t.Setenv("PATH", originalPath)
	if snapshot, err := r.collectModelContextSnapshot(t.Context(), FlowerPermissionFullAccess, time.Now); err != nil || snapshot == nil {
		t.Fatalf("restored root probe cannot recover: snapshot=%+v err=%v", snapshot, err)
	}
}

func TestRuleDiscoveryReportsCompletedEmptyScope(t *testing.T) {
	root := t.TempDir()
	r := newRun(runOptions{AgentHomeDir: root, WorkingDir: root})
	discovery, err := r.collectPromptRepoRuleFiles(t.Context(), root)
	if err != nil || !reflect.DeepEqual(discovery.Directories, []string{root}) || len(discovery.Files) != 0 {
		t.Fatalf("non-repository discovery=%+v err=%v", discovery, err)
	}
	text := strings.Join(renderPromptRepoRuleLines(discovery, err), "\n")
	assertPromptContains(t, text, "Rule discovery complete")
	assertPromptContains(t, text, "No rule sources found in this scope")
	assertPromptNotContains(t, strings.Join(renderPromptRepoRuleLines(promptRepoRuleDiscovery{}, nil), "\n"), "Rule discovery complete")
}

func TestRuleDiscoveryBoundsWorktreesAndNestedRepositories(t *testing.T) {
	repo := initPromptWorkspaceRepo(t)
	worktree := filepath.Join(t.TempDir(), "worktree")
	runPromptWorkspaceGit(t, repo, "worktree", "add", "-b", "rules-test", worktree)
	nested := filepath.Join(repo, "nested")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	runPromptWorkspaceGit(t, nested, "init")
	for _, root := range []string{repo, worktree, nested} {
		if err := os.WriteFile(filepath.Join(root, "AGENTS.md"), []byte("scoped rules"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, root := range []string{repo, worktree, nested} {
		cwd := filepath.Join(root, "target")
		if err := os.Mkdir(cwd, 0o755); err != nil {
			t.Fatal(err)
		}
		r := newRun(runOptions{AgentHomeDir: root, WorkingDir: cwd, FilesystemScope: flowerTestFilesystemScope(t, root)})
		discovery, err := r.collectPromptRepoRuleFiles(t.Context(), cwd)
		if err != nil || !reflect.DeepEqual(discovery.Directories, []string{root, cwd}) || len(discovery.Files) != 1 || discovery.Files[0].Path != filepath.Join(root, "AGENTS.md") {
			t.Fatalf("scope %s: discovery=%+v err=%v", root, discovery, err)
		}
	}
	if _, err := promptRuleSearchDirs(worktree, repo); err == nil {
		t.Fatal("unrelated repository root accepted")
	}
}

func TestRuleDiscoveryRejectsUnauthorizedAncestorAndCorruptGit(t *testing.T) {
	repo := initPromptWorkspaceRepo(t)
	cwd := filepath.Join(repo, "target")
	if err := os.Mkdir(cwd, 0o755); err != nil {
		t.Fatal(err)
	}
	r := newRun(runOptions{AgentHomeDir: cwd, WorkingDir: cwd, FilesystemScope: flowerTestFilesystemScope(t, cwd)})
	if snapshot, err := r.collectModelContextSnapshot(t.Context(), FlowerPermissionFullAccess, time.Now); snapshot != nil || !errors.Is(err, flruntime.ErrModelContextUnavailable) {
		t.Fatalf("unauthorized root admitted: snapshot=%+v err=%v", snapshot, err)
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".git"), []byte("corrupt git file"), 0o644); err != nil {
		t.Fatal(err)
	}
	r = newRun(runOptions{AgentHomeDir: root, WorkingDir: root})
	if snapshot, err := r.collectModelContextSnapshot(t.Context(), FlowerPermissionFullAccess, time.Now); snapshot != nil || !errors.Is(err, flruntime.ErrModelContextUnavailable) {
		t.Fatalf("corrupt git admitted: snapshot=%+v err=%v", snapshot, err)
	}
}
