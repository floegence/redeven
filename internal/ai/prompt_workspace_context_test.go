package ai

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
)

type fakePromptSubagentRuntime struct {
	items []subagentSnapshot
	err   error
}

func (f fakePromptSubagentRuntime) manage(context.Context, string, map[string]any) (map[string]any, error) {
	return nil, nil
}

func (f fakePromptSubagentRuntime) release() {}

func (f fakePromptSubagentRuntime) snapshots(context.Context) ([]subagentSnapshot, error) {
	out := append([]subagentSnapshot(nil), f.items...)
	return out, f.err
}

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

	state := collectPromptRepositoryState(t.Context(), repo)
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

	state := collectPromptRepositoryState(t.Context(), worktree)
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

func TestCollectPromptRepoRuleFiles_DiscoversScopedSources(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	nested := filepath.Join(root, "nested", "deeper")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatalf("mkdir nested: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "AGENTS.md"), []byte("root instructions\n"), 0o644); err != nil {
		t.Fatalf("write AGENTS.md: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, ".develop.md"), []byte(strings.Repeat("a", 5000)), 0o644); err != nil {
		t.Fatalf("write .develop.md: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "nested", "CLAUDE.md"), []byte("nested instructions\n"), 0o644); err != nil {
		t.Fatalf("write CLAUDE.md: %v", err)
	}

	files, err := newRun(runOptions{AgentHomeDir: root, WorkingDir: nested}).collectPromptRepoRuleFiles(t.Context(), nested, root)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 3 {
		t.Fatalf("repo rule file count=%d, want 3", len(files))
	}
	if files[0].Path != filepath.Join(root, "AGENTS.md") {
		t.Fatalf("first rule label=%q, want AGENTS.md", files[0].Path)
	}
	if files[1].Path != filepath.Join(root, ".develop.md") || files[1].ReadError != "" {
		t.Fatalf("expected readable .develop.md source, got %+v", files[1])
	}
	if files[2].Path != filepath.Join(root, "nested", "CLAUDE.md") {
		t.Fatalf("third rule label=%q, want %q", files[2].Path, filepath.Join(root, "nested", "CLAUDE.md"))
	}
}

func TestCollectPromptDelegationState_SummarizesActiveSubagents(t *testing.T) {
	t.Parallel()

	r := &run{
		allowSubagentDelegate: true,
		subagentRuntime: fakePromptSubagentRuntime{
			items: []subagentSnapshot{
				{
					ThreadID:           "subagent_running",
					TaskName:           "Parser worker",
					LastMessagePreview: "Patch parser",
					AgentType:          subagentAgentTypeWorker,
					Status:             subagentStatusRunning,
					UpdatedAtMS:        200,
					CreatedAtMS:        100,
				},
				{
					ThreadID:           "subagent_queued",
					TaskName:           "Reviewer",
					LastMessagePreview: "Review diff",
					AgentType:          subagentAgentTypeReviewer,
					Status:             subagentStatusQueued,
					UpdatedAtMS:        100,
					CreatedAtMS:        50,
				},
				{
					ThreadID:           "subagent_completed",
					TaskName:           "Explorer",
					LastMessagePreview: "Summarize findings",
					AgentType:          subagentAgentTypeExplore,
					Status:             subagentStatusCompleted,
					UpdatedAtMS:        50,
					CreatedAtMS:        25,
				},
			},
		},
	}

	state := collectPromptDelegationState(t.Context(), r)
	if !state.Enabled {
		t.Fatalf("expected delegation to be enabled")
	}
	if state.ActiveCount != 2 || state.RunningCount != 1 || state.QueuedCount != 1 || state.CompletedCount != 1 {
		t.Fatalf("unexpected delegation counts: %+v", state)
	}
	if len(state.Items) != 2 {
		t.Fatalf("preview item count=%d, want 2", len(state.Items))
	}
	if state.Items[0].ID != "subagent_running" {
		t.Fatalf("first preview item=%q, want subagent_running", state.Items[0].ID)
	}
}

func TestBuildPromptWorkspaceContextSection_RendersStructuredFacts(t *testing.T) {
	t.Parallel()

	workspace := promptWorkspaceContext{
		Environment: promptEnvironmentFacts{
			Shell:        "/bin/zsh",
			AgentHomeDir: "/workspace/home",
			FilesystemRoots: []promptFilesystemRootFact{
				{ID: "home", Label: "Home", Path: "/workspace/home", Read: true, Write: true},
				{ID: "computer", Label: "Computer", Path: "/", Read: true, Write: false},
			},
			PermissionType:     FlowerPermissionApprovalRequired,
			SubagentDelegation: true,
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
				Path:     "/workspace/repo/AGENTS.md",
				ScopeDir: "/workspace/repo",
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
	}
	section := strings.Join(append(append(append(renderPromptEnvironmentFactsLines(workspace.Environment), renderPromptRepositoryStateLines(workspace.Repository)...), renderPromptRepoRuleLines(workspace.RepoRules, nil)...), renderPromptDelegationLines(workspace.Delegation)...), "\n")

	for _, want := range []string{
		"- Shell: /bin/zsh",
		"- Filesystem roots: Home=/workspace/home (read-write); Computer=/ (read-only)",
		"- Permission type: approval_required",
		"- Repository root: /workspace/repo",
		"/workspace/repo/AGENTS.md",
		"readable; contents not loaded",
		"Rule sync -- objective: Sync repo rules",
	} {
		if !strings.Contains(section, want) {
			t.Fatalf("workspace context section missing %q: %q", want, section)
		}
	}
}

func TestModelContextSnapshotCarriesCompleteStablePartitions(t *testing.T) {
	root := t.TempDir()
	r := newRun(runOptions{WorkingDir: root, AgentHomeDir: root, Shell: "/bin/zsh"})
	now := func() time.Time { return time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC) }
	first, err := r.collectModelContextSnapshot(t.Context(), FlowerPermissionApprovalRequired, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Sections) != 6 {
		t.Fatalf("sections=%+v", first.Sections)
	}
	text := modelContextSnapshotText(first)
	for _, want := range []string{root, "- Current date: 2026-10-15", "- Timezone: UTC", "- Shell: /bin/zsh", "approval_required"} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing %q: %s", want, text)
		}
	}
	second, err := r.collectModelContextSnapshot(t.Context(), FlowerPermissionApprovalRequired, now)
	if err != nil || !reflect.DeepEqual(first, second) {
		t.Fatalf("unchanged discovery changed facts: %v", err)
	}
}

func TestModelContextCollectorRefreshesDateRepositoryAndSkillsWithoutUnrelatedChanges(t *testing.T) {
	root := initPromptWorkspaceRepo(t)
	writeContextTestSkill(t, root, "First catalog")
	mgr := newSkillManager(root, root)
	mgr.userHome = root
	r := newRun(runOptions{WorkingDir: root, AgentHomeDir: root, SkillManager: mgr})
	clock := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
	now := func() time.Time { return clock }
	first, err := r.collectModelContextSnapshot(t.Context(), FlowerPermissionFullAccess, now)
	if err != nil {
		t.Fatal(err)
	}
	sections := func(snapshot *flruntime.ModelContextSnapshot) map[string]string {
		out := map[string]string{}
		for _, section := range snapshot.Sections {
			out[section.Key] = section.Text
		}
		return out
	}
	previous := sections(first)
	clock = clock.Add(time.Second)
	same, err := r.collectModelContextSnapshot(t.Context(), FlowerPermissionFullAccess, now)
	if err != nil || !reflect.DeepEqual(first, same) {
		t.Fatalf("subsecond collection changed facts: %v", err)
	}
	clock = clock.Add(24 * time.Hour)
	writeContextTestSkill(t, root, "Second catalog")
	if err := os.WriteFile(filepath.Join(root, "new-file.txt"), []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	next, err := r.collectModelContextSnapshot(t.Context(), FlowerPermissionFullAccess, now)
	if err != nil {
		t.Fatal(err)
	}
	current := sections(next)
	for _, key := range []string{"local_time", "repository", "skills"} {
		if current[key] == previous[key] {
			t.Fatalf("changed section %s was stale", key)
		}
	}
	for _, key := range []string{"execution_environment", "repository_rules", "delegation"} {
		if current[key] != previous[key] {
			t.Fatalf("unrelated section %s changed", key)
		}
	}
	r.subagentRuntime = fakePromptSubagentRuntime{err: errors.New("delegation read failed")}
	unavailable, err := r.collectModelContextSnapshot(t.Context(), FlowerPermissionFullAccess, now)
	if err != nil || !strings.Contains(sections(unavailable)["delegation"], "earlier delegation facts are no longer current") {
		t.Fatalf("optional probe retained false facts: %v", err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if snapshot, err := r.collectModelContextSnapshot(ctx, FlowerPermissionFullAccess, now); snapshot != nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled collection=%+v %v", snapshot, err)
	}
}
