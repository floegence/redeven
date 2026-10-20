package ai

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	flruntime "github.com/floegence/floret/v7/runtime"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
)

func TestFlowerRuntimeContextListsAllRuleSourcesWithoutBodies(t *testing.T) {
	root := initPromptWorkspaceRepo(t)
	nested := filepath.Join(root, "nested", "deeper")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	// Exercise UTF-8 and the old per-file and six-file limits together.
	body := strings.Repeat("仓库规则必须完整读取。\n", 500)
	for _, dir := range []string{root, filepath.Dir(nested), nested} {
		for _, name := range promptRepoRuleCandidateNames {
			if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	r := newRun(runOptions{AgentHomeDir: root, WorkingDir: nested})
	workspace := collectPromptWorkspaceContext(t.Context(), r, FlowerPermissionApprovalRequired)
	text := strings.Join(renderPromptRepoRuleLines(workspace.RepoRules, workspace.RepoRulesError), "\n")
	if len(workspace.RepoRules.Files) != 12 {
		t.Fatalf("discovered %d rule sources, want all 12", len(workspace.RepoRules.Files))
	}
	if !utf8.ValidString(text) || strings.Contains(text, "仓库规则") || strings.Contains(text, "excerpt") {
		t.Fatal("rule manifest must contain complete UTF-8 source descriptors, without body previews")
	}
	for _, dir := range []string{root, filepath.Dir(nested), nested} {
		for _, name := range promptRepoRuleCandidateNames {
			if !strings.Contains(text, filepath.Join(dir, name)) {
				t.Fatalf("missing rule source %s", filepath.Join(dir, name))
			}
		}
	}
	assertPromptContains(t, text, "readable; contents not loaded")
	assertPromptContains(t, text, "applies to")
}

func TestFlowerRuleSourceRejectsSymlinkOutsideAuthorizedRoots(t *testing.T) {
	root := initPromptWorkspaceRepo(t)
	outside := filepath.Join(t.TempDir(), "outside.md")
	if err := os.WriteFile(outside, []byte("OUTSIDE_RULE_SECRET"), 0o644); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "AGENTS.md")
	if err := os.Symlink(outside, path); err != nil {
		t.Fatal(err)
	}
	r := newRun(runOptions{AgentHomeDir: root, WorkingDir: root, FilesystemScope: flowerTestFilesystemScope(t, root)})
	workspace := collectPromptWorkspaceContext(t.Context(), r, FlowerPermissionApprovalRequired)
	text := strings.Join(renderPromptRepoRuleLines(workspace.RepoRules, workspace.RepoRulesError), "\n")
	assertPromptContains(t, text, path)
	assertPromptContains(t, text, "unreadable")
	assertPromptNotContains(t, text, "OUTSIDE_RULE_SECRET")
	assertPromptNotContains(t, text, outside)
}

func flowerTestFilesystemScope(t *testing.T, root string) *filesystemscope.Registry {
	t.Helper()
	scope, err := filesystemscope.NewRegistry(&config.Config{
		AgentHomeDir: root,
		FilesystemScope: &config.FilesystemScope{
			SchemaVersion: config.FilesystemScopeSchemaVersionV1,
			DefaultRootID: "workspace",
			Roots: []config.FilesystemRootPolicy{{
				ID: "workspace", Label: "Workspace", Path: root, Kind: config.FilesystemRootCustom,
				Permissions: config.FilesystemPermissionSet{Read: true, Write: true},
			}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return scope
}

func TestFlowerRuleSourcesReportUnreadableAndIncompleteDiscovery(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"AGENTS.md", "CLAUDE.md"} {
		if err := os.Symlink(filepath.Join(root, "missing"), filepath.Join(root, name)); err != nil {
			t.Fatal(err)
		}
	}
	r := newRun(runOptions{AgentHomeDir: root, WorkingDir: root, FilesystemScope: flowerTestFilesystemScope(t, root)})
	files, err := r.collectPromptRepoRuleFiles(t.Context(), root)
	if err != nil || len(files.Files) != 2 || files.Files[0].ReadError == "" || files.Files[1].ReadError == "" {
		t.Fatalf("unreadable sources lost: %+v, %v", files, err)
	}
	if os.Geteuid() != 0 {
		path := filepath.Join(root, ".develop.md")
		if err := os.WriteFile(path, []byte("unreadable rules"), 0o000); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Chmod(path, 0o600) })
		files, err = r.collectPromptRepoRuleFiles(t.Context(), root)
		if err != nil || len(files.Files) != 3 || files.Files[2].ReadError == "" {
			t.Fatalf("unreadable file was omitted or marked readable: %+v, %v", files, err)
		}
	}
	_, err = r.collectPromptRepoRuleFiles(t.Context(), filepath.Join(root, "missing"))
	if err == nil {
		t.Fatal("incomplete discovery must be explicit")
	}
	text := strings.Join(renderPromptRepoRuleLines(files, err), "\n")
	assertPromptContains(t, text, "Rule discovery incomplete")
	assertPromptContains(t, text, "Pause affected operations")
	if _, err := (*run)(nil).collectModelContextSnapshot(context.Background(), FlowerPermissionApprovalRequired, time.Now); !errors.Is(err, flruntime.ErrModelContextUnavailable) {
		t.Fatalf("missing runtime must fail explicitly: %v", err)
	}
}

func TestFlowerReadFilePreservesCompleteRulePages(t *testing.T) {
	root := t.TempDir()
	body := strings.Repeat("规则必须完整保留且不得静默裁剪。\n", 901)
	path := filepath.Join(root, "AGENTS.md")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	r := newRun(runOptions{AgentHomeDir: root, WorkingDir: root})
	var complete strings.Builder
	for offset := 1; ; {
		page, err := r.toolFileRead(t.Context(), FileReadArgs{FilePath: path, Offset: offset, Limit: 400})
		if err != nil {
			t.Fatal(err)
		}
		data, truncated, err := normalizeTruncatedToolPayload("read_file", page)
		if err != nil {
			t.Fatal(err)
		}
		record, ok := data.(map[string]any)
		if truncated || !ok || record["content"] != page.Content || record["total_lines"] != json.Number("901") {
			t.Fatalf("bounded rule page lost its content or continuation: %#v", data)
		}
		complete.WriteString(record["content"].(string))
		if !page.Truncated {
			break
		}
		offset = page.LineOffset + page.LineCount
	}
	if complete.String() != body {
		t.Fatal("complete reading lost rule content")
	}
}

func TestFlowerAuthorizedWorktreeUsesExplicitPaths(t *testing.T) {
	repo := initPromptWorkspaceRepo(t)
	worktree := filepath.Join(filepath.Dir(repo), "sibling-worktree")
	runPromptWorkspaceGit(t, repo, "worktree", "add", "-b", "task-worktree", worktree)
	r := newRun(runOptions{AgentHomeDir: repo, WorkingDir: repo, FilesystemScope: flowerTestFilesystemScope(t, filepath.Dir(repo))})
	cwd, err := r.resolveToolPath(worktree, repo)
	realWorktree, resolveErr := filepath.EvalSymlinks(worktree)
	if err != nil || resolveErr != nil || cwd != realWorktree {
		t.Fatalf("authorized worktree cwd=%q: %v", cwd, err)
	}
	path := filepath.Join(worktree, "README.md")
	if _, err := r.toolFileRead(t.Context(), FileReadArgs{FilePath: path}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.toolFileEdit(t.Context(), FileEditArgs{FilePath: path, OldString: "hello", NewString: "updated"}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.toolFileWrite(t.Context(), FileWriteArgs{FilePath: filepath.Join(worktree, "new.txt"), Content: "created"}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.toolApplyPatch(t.Context(), "*** Begin Patch\n*** Update File: ../sibling-worktree/README.md\n@@\n-updated\n+escaped\n*** End Patch"); err == nil {
		t.Fatal("patch must remain confined to the run working directory")
	}
	outside := filepath.Join(t.TempDir(), "outside.txt")
	denied := newRun(runOptions{AgentHomeDir: repo, WorkingDir: repo, FilesystemScope: flowerTestFilesystemScope(t, repo)})
	if _, err := denied.resolveToolPath(worktree, repo); err == nil {
		t.Fatal("unauthorized worktree cwd accepted")
	}
	if _, err := denied.toolFileWrite(t.Context(), FileWriteArgs{FilePath: outside, Content: "denied"}); err == nil {
		t.Fatal("out-of-root write accepted")
	}
	original, err := os.ReadFile(filepath.Join(repo, "README.md"))
	if err != nil || string(original) != "hello\n" {
		t.Fatal("worktree operations changed the original checkout")
	}
}
