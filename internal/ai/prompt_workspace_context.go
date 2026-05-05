package ai

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/gitutil"
)

const (
	promptRepoRuleMaxFiles       = 6
	promptRepoRulePerFileBytes   = 4096
	promptRepoRuleTotalBytes     = 12288
	promptDelegationPreviewItems = 3
	promptGitProbeTimeout        = 3 * time.Second
)

var promptRepoRuleCandidateNames = []string{
	"AGENTS.md",
	"CLAUDE.md",
	".develop.md",
	".introduce.md",
}

type promptWorkspaceContext struct {
	Environment promptEnvironmentFacts
	Repository  promptRepositoryState
	RepoRules   []promptRepoRuleFile
	Delegation  promptDelegationState
}

type promptEnvironmentFacts struct {
	WorkingDir              string
	AgentHomeDir            string
	Shell                   string
	UserInteractionEnabled  bool
	ToolApprovalEnabled     bool
	DangerousCommandBlocked bool
	SubagentDelegation      bool
}

type promptRepositoryState struct {
	Available       bool
	RepoRoot        string
	RelativeWorkdir string
	Branch          string
	Upstream        string
	DetachedHead    bool
	LinkedWorktree  bool
	AheadCount      int
	BehindCount     int
	StagedCount     int
	UnstagedCount   int
	UntrackedCount  int
}

type promptRepoRuleFile struct {
	Path      string
	Label     string
	Content   string
	Truncated bool
}

type promptDelegationState struct {
	Enabled        bool
	ActiveCount    int
	QueuedCount    int
	RunningCount   int
	WaitingCount   int
	CompletedCount int
	FailedCount    int
	CanceledCount  int
	TimedOutCount  int
	Items          []promptDelegationItem
}

type promptDelegationItem struct {
	ID        string
	AgentType string
	Status    string
	Title     string
	Objective string
}

func collectPromptWorkspaceContext(r *run, capability runCapabilityContract) promptWorkspaceContext {
	ctx := promptWorkspaceContext{
		Environment: collectPromptEnvironmentFacts(r, capability),
	}
	ctx.Repository = collectPromptRepositoryState(ctx.Environment.WorkingDir)
	ctx.RepoRules = collectPromptRepoRuleFiles(ctx.Environment.WorkingDir, ctx.Repository.RepoRoot)
	ctx.Delegation = collectPromptDelegationState(r)
	return ctx
}

func collectPromptEnvironmentFacts(r *run, capability runCapabilityContract) promptEnvironmentFacts {
	out := promptEnvironmentFacts{
		UserInteractionEnabled: capability.AllowUserInteraction,
	}
	if r == nil {
		return out
	}
	out.WorkingDir = promptWorkingDirForRun(r)
	out.AgentHomeDir = strings.TrimSpace(r.agentHomeDir)
	out.Shell = strings.TrimSpace(r.shell)
	if r.cfg != nil {
		out.ToolApprovalEnabled = r.cfg.EffectiveRequireUserApproval()
		out.DangerousCommandBlocked = r.cfg.EffectiveBlockDangerousCommands()
	}
	out.SubagentDelegation = r.allowSubagentDelegate
	return out
}

func collectPromptRepositoryState(workingDir string) promptRepositoryState {
	workingDir = strings.TrimSpace(workingDir)
	if workingDir == "" {
		return promptRepositoryState{}
	}

	ctx, cancel := context.WithTimeout(context.Background(), promptGitProbeTimeout)
	defer cancel()

	repoRoot, ok := gitutil.ShowTopLevel(ctx, workingDir)
	if !ok {
		return promptRepositoryState{}
	}
	state := promptRepositoryState{
		Available: true,
		RepoRoot:  filepath.Clean(repoRoot),
	}
	if rel, err := filepath.Rel(state.RepoRoot, workingDir); err == nil {
		state.RelativeWorkdir = filepath.Clean(rel)
	}
	if strings.TrimSpace(state.RelativeWorkdir) == "" {
		state.RelativeWorkdir = "."
	}

	branch := strings.TrimSpace(readPromptGitOptional(ctx, state.RepoRoot, "symbolic-ref", "--quiet", "--short", "HEAD"))
	if branch == "" {
		branch = strings.TrimSpace(readPromptGitOptional(ctx, state.RepoRoot, "rev-parse", "--short", "HEAD"))
		state.DetachedHead = branch != ""
	}
	state.Branch = branch

	upstream := strings.TrimSpace(readPromptGitOptional(ctx, state.RepoRoot, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"))
	state.Upstream = upstream
	if upstream != "" {
		state.AheadCount, state.BehindCount = readPromptGitAheadBehind(ctx, state.RepoRoot)
	}

	gitDir := resolvePromptGitPath(ctx, state.RepoRoot, "rev-parse", "--git-dir")
	commonDir := resolvePromptGitPath(ctx, state.RepoRoot, "rev-parse", "--git-common-dir")
	if gitDir != "" && commonDir != "" && filepath.Clean(gitDir) != filepath.Clean(commonDir) {
		state.LinkedWorktree = true
	}

	statusRaw := readPromptGitOptional(ctx, state.RepoRoot, "status", "--porcelain=1", "--untracked-files=normal")
	state.StagedCount, state.UnstagedCount, state.UntrackedCount = parsePromptGitStatusCounts(statusRaw)
	return state
}

func readPromptGitOptional(ctx context.Context, repoRoot string, args ...string) string {
	out, err := gitutil.RunCombinedOutput(ctx, repoRoot, nil, args...)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func resolvePromptGitPath(ctx context.Context, repoRoot string, args ...string) string {
	raw := strings.TrimSpace(readPromptGitOptional(ctx, repoRoot, args...))
	if raw == "" {
		return ""
	}
	if filepath.IsAbs(raw) {
		return filepath.Clean(raw)
	}
	return filepath.Clean(filepath.Join(repoRoot, raw))
}

func readPromptGitAheadBehind(ctx context.Context, repoRoot string) (int, int) {
	raw := readPromptGitOptional(ctx, repoRoot, "rev-list", "--left-right", "--count", "HEAD...@{upstream}")
	if raw == "" {
		return 0, 0
	}
	fields := strings.Fields(raw)
	if len(fields) < 2 {
		return 0, 0
	}
	ahead, errAhead := strconv.Atoi(strings.TrimSpace(fields[0]))
	behind, errBehind := strconv.Atoi(strings.TrimSpace(fields[1]))
	if errAhead != nil || errBehind != nil {
		return 0, 0
	}
	if ahead < 0 {
		ahead = 0
	}
	if behind < 0 {
		behind = 0
	}
	return ahead, behind
}

func parsePromptGitStatusCounts(raw string) (staged int, unstaged int, untracked int) {
	for _, line := range strings.Split(strings.TrimSpace(raw), "\n") {
		line = strings.TrimRight(line, "\r")
		if len(line) < 2 {
			continue
		}
		x := line[0]
		y := line[1]
		if x == '?' && y == '?' {
			untracked++
			continue
		}
		if x != ' ' {
			staged++
		}
		if y != ' ' {
			unstaged++
		}
	}
	return staged, unstaged, untracked
}

func collectPromptRepoRuleFiles(workingDir string, repoRoot string) []promptRepoRuleFile {
	paths := discoverPromptRepoRulePaths(workingDir, repoRoot)
	if len(paths) == 0 {
		return []promptRepoRuleFile{}
	}
	remainingBudget := promptRepoRuleTotalBytes
	files := make([]promptRepoRuleFile, 0, len(paths))
	for _, path := range paths {
		if len(files) >= promptRepoRuleMaxFiles || remainingBudget <= 0 {
			break
		}
		perFileBudget := promptRepoRulePerFileBytes
		if remainingBudget < perFileBudget {
			perFileBudget = remainingBudget
		}
		content, truncated, ok := readPromptRepoRuleContent(path, perFileBudget)
		if !ok || strings.TrimSpace(content) == "" {
			continue
		}
		files = append(files, promptRepoRuleFile{
			Path:      filepath.Clean(path),
			Label:     promptRepoRuleLabel(path, repoRoot),
			Content:   content,
			Truncated: truncated,
		})
		remainingBudget -= len([]byte(content))
	}
	return files
}

func discoverPromptRepoRulePaths(workingDir string, repoRoot string) []string {
	workingDir = strings.TrimSpace(workingDir)
	if workingDir == "" {
		return []string{}
	}
	searchDirs := promptRuleSearchDirs(workingDir, repoRoot)
	seen := map[string]struct{}{}
	paths := make([]string, 0, len(searchDirs)*len(promptRepoRuleCandidateNames))
	for _, dir := range searchDirs {
		for _, name := range promptRepoRuleCandidateNames {
			path := filepath.Join(dir, name)
			info, err := os.Stat(path)
			if err != nil || info.IsDir() {
				continue
			}
			cleaned := filepath.Clean(path)
			if _, ok := seen[cleaned]; ok {
				continue
			}
			seen[cleaned] = struct{}{}
			paths = append(paths, cleaned)
		}
	}
	return paths
}

func promptRuleSearchDirs(workingDir string, repoRoot string) []string {
	workingDir = filepath.Clean(strings.TrimSpace(workingDir))
	repoRoot = filepath.Clean(strings.TrimSpace(repoRoot))
	if workingDir == "" {
		return []string{}
	}
	if repoRoot == "" {
		return []string{workingDir}
	}
	rel, err := filepath.Rel(repoRoot, workingDir)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return []string{workingDir}
	}

	reversed := []string{}
	for dir := workingDir; ; dir = filepath.Dir(dir) {
		reversed = append(reversed, dir)
		if dir == repoRoot {
			break
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
	}
	dirs := make([]string, 0, len(reversed))
	for i := len(reversed) - 1; i >= 0; i-- {
		dirs = append(dirs, reversed[i])
	}
	return dirs
}

func readPromptRepoRuleContent(path string, budget int) (string, bool, bool) {
	if budget <= 0 {
		return "", false, false
	}
	f, err := os.Open(path)
	if err != nil {
		return "", false, false
	}
	defer f.Close()

	buf, err := io.ReadAll(io.LimitReader(f, int64(budget+1)))
	if err != nil {
		return "", false, false
	}
	truncated := len(buf) > budget
	if truncated {
		buf = buf[:budget]
	}
	content := strings.ReplaceAll(string(buf), "\r\n", "\n")
	content = strings.TrimSpace(content)
	if content == "" {
		return "", false, false
	}
	return content, truncated, true
}

func promptRepoRuleLabel(path string, repoRoot string) string {
	path = filepath.Clean(strings.TrimSpace(path))
	repoRoot = filepath.Clean(strings.TrimSpace(repoRoot))
	if path == "" {
		return ""
	}
	if repoRoot != "" {
		if rel, err := filepath.Rel(repoRoot, path); err == nil {
			return filepath.Clean(rel)
		}
	}
	return filepath.Base(path)
}

func collectPromptDelegationState(r *run) promptDelegationState {
	out := promptDelegationState{}
	if r == nil {
		return out
	}
	out.Enabled = r.allowSubagentDelegate
	if r.subagentManager == nil {
		return out
	}

	tasks := r.subagentManager.allTasks()
	if len(tasks) == 0 {
		return out
	}
	sort.Slice(tasks, func(i, j int) bool {
		if tasks[i] == nil || tasks[j] == nil {
			return i < j
		}
		return extractPromptDelegationUpdatedAt(tasks[i]) > extractPromptDelegationUpdatedAt(tasks[j])
	})

	for _, task := range tasks {
		if task == nil {
			continue
		}
		status := strings.TrimSpace(task.statusSnapshot())
		switch status {
		case subagentStatusQueued:
			out.QueuedCount++
			out.ActiveCount++
		case subagentStatusRunning:
			out.RunningCount++
			out.ActiveCount++
		case subagentStatusWaiting:
			out.WaitingCount++
			out.ActiveCount++
		case subagentStatusCompleted:
			out.CompletedCount++
		case subagentStatusFailed:
			out.FailedCount++
		case subagentStatusCanceled:
			out.CanceledCount++
		case subagentStatusTimedOut:
			out.TimedOutCount++
		default:
			out.ActiveCount++
		}
		if isSubagentTerminalStatus(status) || len(out.Items) >= promptDelegationPreviewItems {
			continue
		}
		snapshot := task.snapshot()
		out.Items = append(out.Items, promptDelegationItem{
			ID:        strings.TrimSpace(anyToString(snapshot["subagent_id"])),
			AgentType: strings.TrimSpace(anyToString(snapshot["agent_type"])),
			Status:    status,
			Title:     strings.TrimSpace(anyToString(snapshot["title"])),
			Objective: strings.TrimSpace(anyToString(snapshot["objective"])),
		})
	}
	return out
}

func extractPromptDelegationUpdatedAt(task *subagentTask) int64 {
	if task == nil {
		return 0
	}
	snapshot := task.snapshot()
	switch v := snapshot["updated_at_ms"].(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case float64:
		return int64(v)
	default:
		return 0
	}
}

func buildPromptWorkspaceContextSection(snapshot promptRuntimeSnapshot) promptSection {
	lines := []string{"## Workspace Context"}
	if envLines := renderPromptEnvironmentFactsLines(snapshot.WorkspaceContext.Environment); len(envLines) > 0 {
		lines = append(lines, "### Environment Facts")
		lines = append(lines, envLines...)
	}
	if repoLines := renderPromptRepositoryStateLines(snapshot.WorkspaceContext.Repository); len(repoLines) > 0 {
		lines = append(lines, "### Repository State")
		lines = append(lines, repoLines...)
	}
	if ruleLines := renderPromptRepoRuleLines(snapshot.WorkspaceContext.RepoRules); len(ruleLines) > 0 {
		lines = append(lines, "### Repository Rules")
		lines = append(lines, ruleLines...)
	}
	if delegationLines := renderPromptDelegationLines(snapshot.WorkspaceContext.Delegation); len(delegationLines) > 0 {
		lines = append(lines, "### Delegation State")
		lines = append(lines, delegationLines...)
	}
	return newPromptSection("workspace_context", lines...)
}

func renderPromptEnvironmentFactsLines(env promptEnvironmentFacts) []string {
	lines := []string{}
	if shell := strings.TrimSpace(env.Shell); shell != "" {
		lines = append(lines, fmt.Sprintf("- Shell: %s", shell))
	}
	if home := strings.TrimSpace(env.AgentHomeDir); home != "" {
		lines = append(lines, fmt.Sprintf("- Runtime home: %s", home))
	}
	lines = append(lines,
		fmt.Sprintf("- Mutating tool approval required: %t", env.ToolApprovalEnabled),
		fmt.Sprintf("- Dangerous terminal commands hard-blocked: %t", env.DangerousCommandBlocked),
	)
	lines = append(lines, fmt.Sprintf("- Subagent delegation available: %t", env.SubagentDelegation))
	return lines
}

func renderPromptRepositoryStateLines(repo promptRepositoryState) []string {
	if !repo.Available {
		return []string{"- Git repository detected from the current working directory: false"}
	}
	lines := []string{
		"- Git repository detected from the current working directory: true",
		fmt.Sprintf("- Repository root: %s", repo.RepoRoot),
	}
	if rel := strings.TrimSpace(repo.RelativeWorkdir); rel != "" {
		lines = append(lines, fmt.Sprintf("- Working directory relative to repository root: %s", rel))
	}
	if branch := strings.TrimSpace(repo.Branch); branch != "" {
		if repo.DetachedHead {
			lines = append(lines, fmt.Sprintf("- HEAD state: detached at %s", branch))
		} else {
			lines = append(lines, fmt.Sprintf("- Current branch: %s", branch))
		}
	}
	if upstream := strings.TrimSpace(repo.Upstream); upstream != "" {
		lines = append(lines,
			fmt.Sprintf("- Upstream branch: %s", upstream),
			fmt.Sprintf("- Ahead/behind vs upstream: ahead=%d, behind=%d", repo.AheadCount, repo.BehindCount),
		)
	}
	lines = append(lines, fmt.Sprintf("- Linked worktree checkout: %t", repo.LinkedWorktree))
	if repo.StagedCount == 0 && repo.UnstagedCount == 0 && repo.UntrackedCount == 0 {
		lines = append(lines, "- Workspace changes: clean")
	} else {
		lines = append(lines, fmt.Sprintf("- Workspace changes: staged=%d, unstaged=%d, untracked=%d", repo.StagedCount, repo.UnstagedCount, repo.UntrackedCount))
	}
	return lines
}

func renderPromptRepoRuleLines(files []promptRepoRuleFile) []string {
	if len(files) == 0 {
		return []string{"- Repository rule files loaded: none"}
	}
	lines := []string{fmt.Sprintf("- Repository rule files loaded: %d", len(files))}
	for _, file := range files {
		label := strings.TrimSpace(file.Label)
		if label == "" {
			label = strings.TrimSpace(file.Path)
		}
		if label == "" {
			continue
		}
		lines = append(lines, fmt.Sprintf("#### %s", label))
		lines = append(lines, indentPromptBlock(file.Content, "    ")...)
		if file.Truncated {
			lines = append(lines, "- Note: this rule file excerpt was truncated to stay within the prompt budget.")
		}
	}
	return lines
}

func renderPromptDelegationLines(state promptDelegationState) []string {
	if !state.Enabled {
		return []string{"- Subagent delegation enabled for this run: false"}
	}
	lines := []string{
		"- Subagent delegation enabled for this run: true",
		fmt.Sprintf("- Subagent counts: active=%d, queued=%d, running=%d, waiting_input=%d, completed=%d, failed=%d, canceled=%d, timed_out=%d", state.ActiveCount, state.QueuedCount, state.RunningCount, state.WaitingCount, state.CompletedCount, state.FailedCount, state.CanceledCount, state.TimedOutCount),
	}
	if len(state.Items) == 0 {
		lines = append(lines, "- Active subagent preview: none")
		return lines
	}
	for _, item := range state.Items {
		title := strings.TrimSpace(item.Title)
		if title == "" {
			title = strings.TrimSpace(item.ID)
		}
		switch {
		case title != "" && strings.TrimSpace(item.Objective) != "":
			lines = append(lines, fmt.Sprintf("- Active subagent [%s/%s] %s -- objective: %s", item.AgentType, item.Status, title, item.Objective))
		case title != "":
			lines = append(lines, fmt.Sprintf("- Active subagent [%s/%s] %s", item.AgentType, item.Status, title))
		}
	}
	return lines
}

func indentPromptBlock(text string, prefix string) []string {
	text = strings.TrimSpace(strings.ReplaceAll(text, "\r\n", "\n"))
	if text == "" {
		return []string{}
	}
	if prefix == "" {
		prefix = "    "
	}
	lines := []string{}
	for _, line := range strings.Split(text, "\n") {
		lines = append(lines, prefix+line)
	}
	return lines
}
