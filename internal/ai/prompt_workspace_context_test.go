package ai

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func runPromptWorkspaceGit(t *testing.T, dir string, args ...string) string {
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

func initPromptWorkspaceRepo(t *testing.T) string {
	t.Helper()
	repo := t.TempDir()
	runPromptWorkspaceGit(t, repo, "init")
	runPromptWorkspaceGit(t, repo, "config", "user.name", "Tester")
	runPromptWorkspaceGit(t, repo, "config", "user.email", "tester@example.com")
	if err := os.WriteFile(filepath.Join(repo, "README.md"), []byte("hello\n"), 0o644); err != nil {
		t.Fatalf("write README: %v", err)
	}
	runPromptWorkspaceGit(t, repo, "add", "README.md")
	runPromptWorkspaceGit(t, repo, "commit", "-m", "initial")
	return repo
}

func TestCollectPromptRepositoryState_ReportsDirtyCounts(t *testing.T) {
	t.Parallel()

	repo := initPromptWorkspaceRepo(t)
	readmePath := filepath.Join(repo, "README.md")
	if err := os.WriteFile(readmePath, []byte("hello\nstaged\n"), 0o644); err != nil {
		t.Fatalf("write staged README: %v", err)
	}
	runPromptWorkspaceGit(t, repo, "add", "README.md")
	if err := os.WriteFile(readmePath, []byte("hello\nstaged\nunstaged\n"), 0o644); err != nil {
		t.Fatalf("write unstaged README: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repo, "note.txt"), []byte("scratch\n"), 0o644); err != nil {
		t.Fatalf("write untracked file: %v", err)
	}

	state := collectPromptRepositoryState(repo)
	if !state.Available {
		t.Fatalf("expected repository state to be available")
	}
	if state.StagedCount != 1 || state.UnstagedCount != 1 || state.UntrackedCount != 1 {
		t.Fatalf("unexpected dirty counts: %+v", state)
	}
	if state.RelativeWorkdir != "." {
		t.Fatalf("relative workdir=%q, want .", state.RelativeWorkdir)
	}
}

func TestCollectPromptRepositoryState_ReportsLinkedWorktree(t *testing.T) {
	t.Parallel()

	repo := initPromptWorkspaceRepo(t)
	branch := "feat-worktree-context"
	worktree := filepath.Join(t.TempDir(), "wt")
	runPromptWorkspaceGit(t, repo, "branch", branch)
	runPromptWorkspaceGit(t, repo, "worktree", "add", worktree, branch)
	if err := os.WriteFile(filepath.Join(worktree, "worktree-note.txt"), []byte("hello\n"), 0o644); err != nil {
		t.Fatalf("write worktree file: %v", err)
	}

	state := collectPromptRepositoryState(worktree)
	if !state.Available {
		t.Fatalf("expected worktree repository state to be available")
	}
	if !state.LinkedWorktree {
		t.Fatalf("expected linked worktree to be detected: %+v", state)
	}
	if state.Branch != branch {
		t.Fatalf("branch=%q, want %q", state.Branch, branch)
	}
	if state.RepoRoot != filepath.Clean(worktree) {
		t.Fatalf("repo root=%q, want %q", state.RepoRoot, worktree)
	}
	if state.UntrackedCount != 1 {
		t.Fatalf("untracked_count=%d, want 1", state.UntrackedCount)
	}
}

func TestCollectPromptRepoRuleFiles_DiscoversAndTruncates(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	nested := filepath.Join(root, "nested", "deeper")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatalf("mkdir nested: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "AGENTS.md"), []byte("root instructions\n"), 0o644); err != nil {
		t.Fatalf("write AGENTS.md: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, ".develop.md"), []byte(strings.Repeat("a", promptRepoRulePerFileBytes+64)), 0o644); err != nil {
		t.Fatalf("write .develop.md: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "nested", "CLAUDE.md"), []byte("nested instructions\n"), 0o644); err != nil {
		t.Fatalf("write CLAUDE.md: %v", err)
	}

	files := collectPromptRepoRuleFiles(nested, root)
	if len(files) != 3 {
		t.Fatalf("repo rule file count=%d, want 3", len(files))
	}
	if files[0].Label != "AGENTS.md" {
		t.Fatalf("first rule label=%q, want AGENTS.md", files[0].Label)
	}
	if files[1].Label != ".develop.md" || !files[1].Truncated {
		t.Fatalf("expected truncated .develop.md rule file, got %+v", files[1])
	}
	if files[2].Label != filepath.Join("nested", "CLAUDE.md") {
		t.Fatalf("third rule label=%q, want %q", files[2].Label, filepath.Join("nested", "CLAUDE.md"))
	}
}

func TestCollectPromptDelegationState_SummarizesActiveSubagents(t *testing.T) {
	t.Parallel()

	running := &subagentTask{
		id:        "subagent_running",
		objective: "Patch parser",
		agentType: subagentAgentTypeWorker,
		spec: subagentSpec{
			Title:     "Parser worker",
			Objective: "Patch parser",
		},
		status:    subagentStatusRunning,
		updatedAt: 200,
	}
	queued := &subagentTask{
		id:        "subagent_queued",
		objective: "Review diff",
		agentType: subagentAgentTypeReviewer,
		spec: subagentSpec{
			Title:     "Reviewer",
			Objective: "Review diff",
		},
		status:    subagentStatusQueued,
		updatedAt: 100,
	}
	completed := &subagentTask{
		id:        "subagent_completed",
		objective: "Summarize findings",
		agentType: subagentAgentTypeExplore,
		spec: subagentSpec{
			Title:     "Explorer",
			Objective: "Summarize findings",
		},
		status:    subagentStatusCompleted,
		updatedAt: 50,
	}
	r := &run{
		allowSubagentDelegate: true,
		subagentManager: &subagentManager{
			tasks: map[string]*subagentTask{
				running.id:   running,
				queued.id:    queued,
				completed.id: completed,
			},
			taskByTaskID: map[string]string{},
		},
	}

	state := collectPromptDelegationState(r)
	if !state.Enabled {
		t.Fatalf("expected delegation to be enabled")
	}
	if state.ActiveCount != 2 || state.RunningCount != 1 || state.QueuedCount != 1 || state.CompletedCount != 1 {
		t.Fatalf("unexpected delegation counts: %+v", state)
	}
	if len(state.Items) != 2 {
		t.Fatalf("preview item count=%d, want 2", len(state.Items))
	}
	if state.Items[0].ID != running.id {
		t.Fatalf("first preview item=%q, want %q", state.Items[0].ID, running.id)
	}
}

func TestBuildPromptWorkspaceContextSection_RendersStructuredFacts(t *testing.T) {
	t.Parallel()

	section := buildPromptWorkspaceContextSection(promptRuntimeSnapshot{
		WorkspaceContext: promptWorkspaceContext{
			Environment: promptEnvironmentFacts{
				Shell:                   "/bin/zsh",
				AgentHomeDir:            "/workspace/home",
				ToolApprovalEnabled:     true,
				DangerousCommandBlocked: false,
				SubagentDelegation:      true,
			},
			Repository: promptRepositoryState{
				Available:       true,
				RepoRoot:        "/workspace/repo",
				RelativeWorkdir: "internal/ai",
				Branch:          "feat/workspace-context",
				Upstream:        "origin/main",
				LinkedWorktree:  true,
				AheadCount:      2,
				BehindCount:     1,
				StagedCount:     1,
				UnstagedCount:   2,
				UntrackedCount:  3,
			},
			RepoRules: []promptRepoRuleFile{
				{
					Label:     "AGENTS.md",
					Content:   "Follow repo rules.",
					Truncated: true,
				},
			},
			Delegation: promptDelegationState{
				Enabled:      true,
				ActiveCount:  1,
				RunningCount: 1,
				Items: []promptDelegationItem{
					{
						ID:        "subagent_1",
						AgentType: "worker",
						Status:    "running",
						Title:     "Rule sync",
						Objective: "Sync repo rules",
					},
				},
			},
		},
	}).render()

	for _, want := range []string{
		"### Environment Facts",
		"- Shell: /bin/zsh",
		"### Repository State",
		"- Repository root: /workspace/repo",
		"### Repository Rules",
		"#### AGENTS.md",
		"truncated to stay within the prompt budget",
		"### Delegation State",
		"Rule sync -- objective: Sync repo rules",
	} {
		if !strings.Contains(section, want) {
			t.Fatalf("workspace context section missing %q: %q", want, section)
		}
	}
}
