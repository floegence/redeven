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

func TestCollectPromptRepoRuleFiles_DiscoversScopedSources(t *testing.T) {
	t.Parallel()

	root := initPromptWorkspaceRepo(t)
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

	files, err := newRun(runOptions{AgentHomeDir: root, WorkingDir: nested}).collectPromptRepoRuleFiles(t.Context(), nested)
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
		RepoRules: []promptRepoRuleFile{
			{
				Path:     "/workspace/repo/AGENTS.md",
				ScopeDir: "/workspace/repo",
			},
		},
	}
	section := strings.Join(append(renderPromptEnvironmentFactsLines(workspace.Environment), renderPromptRepoRuleLines(workspace.RepoRules, nil)...), "\n")

	for _, want := range []string{
		"- Shell: /bin/zsh",
		"- Filesystem roots: Home=/workspace/home (read-write); Computer=/ (read-only)",
		"- Permission type: approval_required",
		"/workspace/repo/AGENTS.md",
		"readable; contents not loaded",
		"- Subagent delegation available: true",
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
	if len(first.Sections) != 4 {
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

func TestModelContextCollectorRefreshesDateAndSkillsWithoutGitUpdates(t *testing.T) {
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
	if _, exists := current["repository"]; exists {
		t.Fatal("automatic snapshot contains Git repository facts")
	}
	for _, key := range []string{"local_time", "skills"} {
		if current[key] == previous[key] {
			t.Fatalf("changed section %s was stale", key)
		}
	}
	for _, key := range []string{"execution_environment", "repository_rules"} {
		if current[key] != previous[key] {
			t.Fatalf("unrelated section %s changed", key)
		}
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if snapshot, err := r.collectModelContextSnapshot(ctx, FlowerPermissionFullAccess, now); snapshot != nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled collection=%+v %v", snapshot, err)
	}
}
