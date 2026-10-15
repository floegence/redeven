package ai

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/gitutil"
)

const (
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
	Environment    promptEnvironmentFacts
	Repository     promptRepositoryState
	RepoRules      []promptRepoRuleFile
	RepoRulesError error
	Delegation     promptDelegationState
}

type promptEnvironmentFacts struct {
	WorkingDir         string
	AgentHomeDir       string
	FilesystemRoots    []promptFilesystemRootFact
	Shell              string
	PermissionType     FlowerPermissionType
	SubagentDelegation bool
}

type promptFilesystemRootFact struct {
	ID    string
	Label string
	Path  string
	Read  bool
	Write bool
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
	ScopeDir  string
	ReadError string
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

func collectPromptWorkspaceContext(r *run) promptWorkspaceContext {
	ctx := promptWorkspaceContext{
		Environment: collectPromptEnvironmentFacts(r),
	}
	ctx.Repository = collectPromptRepositoryState(ctx.Environment.WorkingDir)
	ctx.RepoRules, ctx.RepoRulesError = r.collectPromptRepoRuleFiles(ctx.Environment.WorkingDir, ctx.Repository.RepoRoot)
	ctx.Delegation = collectPromptDelegationState(r)
	return ctx
}

func collectPromptEnvironmentFacts(r *run) promptEnvironmentFacts {
	out := promptEnvironmentFacts{}
	if r == nil {
		return out
	}
	out.WorkingDir = promptWorkingDirForRun(r)
	out.AgentHomeDir = strings.TrimSpace(r.agentHomeDir)
	if r.scope != nil {
		ctx := r.scope.PathContext()
		out.FilesystemRoots = make([]promptFilesystemRootFact, 0, len(ctx.Roots))
		for _, root := range ctx.Roots {
			out.FilesystemRoots = append(out.FilesystemRoots, promptFilesystemRootFact{
				ID:    strings.TrimSpace(root.ID),
				Label: strings.TrimSpace(root.Label),
				Path:  strings.TrimSpace(root.PathAbs),
				Read:  root.Permissions.Read,
				Write: root.Permissions.Write,
			})
		}
	}
	out.Shell = strings.TrimSpace(r.shell)
	out.PermissionType = r.currentPermissionType()
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

func (r *run) collectPromptRepoRuleFiles(workingDir, repoRoot string) ([]promptRepoRuleFile, error) {
	if r == nil || strings.TrimSpace(workingDir) == "" {
		return nil, nil
	}
	scope, err := r.runPathScope()
	if err != nil {
		return nil, errors.New("repository rule discovery requires an authorized working directory")
	}
	files := []promptRepoRuleFile{}
	for _, dir := range promptRuleSearchDirs(workingDir, repoRoot) {
		resolvedDir, err := scope.Registry.Resolve(dir, filesystemscope.ResolveOptions{RequireExisting: true, RequireDir: true})
		if err != nil {
			return files, fmt.Errorf("cannot inspect repository rule directory %q within authorized filesystem roots", dir)
		}
		entries, err := os.ReadDir(resolvedDir.RealAbs)
		if err != nil {
			return files, fmt.Errorf("repository rule directory %q is unreadable", dir)
		}
		names := make(map[string]bool, len(entries))
		for _, entry := range entries {
			names[entry.Name()] = true
		}
		for _, name := range promptRepoRuleCandidateNames {
			if !names[name] {
				continue
			}
			file := promptRepoRuleFile{Path: filepath.Join(dir, name), ScopeDir: dir}
			resolved, err := scope.Registry.Resolve(file.Path, filesystemscope.ResolveOptions{RequireExisting: true})
			if err != nil {
				file.ReadError = "path is not readable within authorized filesystem roots"
			} else if info, err := os.Stat(resolved.RealAbs); err != nil || !info.Mode().IsRegular() {
				file.ReadError = "source is not an accessible regular file"
			} else if handle, err := os.Open(resolved.RealAbs); err != nil {
				file.ReadError = "file is unreadable"
			} else {
				_ = handle.Close()
			}
			files = append(files, file)
		}
	}
	return files, nil
}

func promptRuleSearchDirs(workingDir string, repoRoot string) []string {
	workingDir = strings.TrimSpace(workingDir)
	repoRoot = strings.TrimSpace(repoRoot)
	if workingDir == "" {
		return []string{}
	}
	workingDir = filepath.Clean(workingDir)
	if repoRoot == "" {
		return []string{workingDir}
	}
	repoRoot = filepath.Clean(repoRoot)
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

func collectPromptDelegationState(r *run) promptDelegationState {
	out := promptDelegationState{}
	if r == nil {
		return out
	}
	out.Enabled = r.allowSubagentDelegate
	if r.subagentRuntime == nil {
		return out
	}

	snapshots, err := r.subagentRuntime.snapshots(context.Background())
	if err != nil || len(snapshots) == 0 {
		return out
	}
	sort.Slice(snapshots, func(i, j int) bool {
		if snapshots[i].UpdatedAtMS == snapshots[j].UpdatedAtMS {
			return snapshots[i].CreatedAtMS > snapshots[j].CreatedAtMS
		}
		return snapshots[i].UpdatedAtMS > snapshots[j].UpdatedAtMS
	})

	for _, snapshot := range snapshots {
		status := strings.TrimSpace(snapshot.Status)
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
		out.Items = append(out.Items, promptDelegationItem{
			ID:        strings.TrimSpace(snapshot.ThreadID),
			AgentType: strings.TrimSpace(snapshot.AgentType),
			Status:    status,
			Title:     strings.TrimSpace(snapshot.TaskName),
			Objective: strings.TrimSpace(snapshot.LastMessagePreview),
		})
	}
	return out
}

func buildPromptWorkspaceContextSection(workspace promptWorkspaceContext) promptSection {
	lines := []string{"## Workspace Context"}
	if envLines := renderPromptEnvironmentFactsLines(workspace.Environment); len(envLines) > 0 {
		lines = append(lines, "### Environment Facts")
		lines = append(lines, envLines...)
	}
	if repoLines := renderPromptRepositoryStateLines(workspace.Repository); len(repoLines) > 0 {
		lines = append(lines, "### Repository State")
		lines = append(lines, repoLines...)
	}
	if ruleLines := renderPromptRepoRuleLines(workspace.RepoRules, workspace.RepoRulesError); len(ruleLines) > 0 {
		lines = append(lines, "### Repository Rules")
		lines = append(lines, ruleLines...)
	}
	if delegationLines := renderPromptDelegationLines(workspace.Delegation); len(delegationLines) > 0 {
		lines = append(lines, "### Delegation State")
		lines = append(lines, delegationLines...)
	}
	return newPromptSection("workspace_context", lines...)
}

func (r *run) floretTurnRuntimeContext() (flruntime.MessageContextItem, error) {
	runtimeLines := []string{"Tool execution environment: terminal.exec runs on the AI runtime host. A user-selected device may be different; selection does not route a command."}
	if r != nil && strings.TrimSpace(r.endpointID) != "" {
		runtimeLines = append(runtimeLines, "Runtime endpoint ID: "+strings.TrimSpace(r.endpointID))
	}
	sections := []promptSection{
		newPromptSection("tool_execution_environment", runtimeLines...),
		newPromptSection("current_context", buildBasicPromptCurrentContextLines(promptWorkingDirForRun(r), currentPromptLocalTimeContext(time.Now))...),
		buildPromptWorkspaceContextSection(collectPromptWorkspaceContext(r)),
	}
	if r != nil {
		if catalog := newPromptSectionFromText("available_skills", buildSkillCatalogPrompt(r.listSkills())); !catalog.isEmpty() {
			sections = append(sections, catalog)
		}
	}
	item := flruntime.MessageContextItem{
		Kind: "runtime_context", Title: "Tool execution environment", Text: renderPromptSections(sections),
	}
	if err := item.Validate(); err != nil {
		return flruntime.MessageContextItem{}, fmt.Errorf("tool execution context cannot be admitted: %w", err)
	}
	return item, nil
}

func renderPromptEnvironmentFactsLines(env promptEnvironmentFacts) []string {
	lines := []string{}
	if shell := strings.TrimSpace(env.Shell); shell != "" {
		lines = append(lines, fmt.Sprintf("- Shell: %s", shell))
	}
	if home := strings.TrimSpace(env.AgentHomeDir); home != "" {
		lines = append(lines, fmt.Sprintf("- Runtime home: %s", home))
	}
	if len(env.FilesystemRoots) > 0 {
		rootParts := make([]string, 0, len(env.FilesystemRoots))
		for _, root := range env.FilesystemRoots {
			path := strings.TrimSpace(root.Path)
			if path == "" {
				continue
			}
			label := strings.TrimSpace(root.Label)
			if label == "" {
				label = strings.TrimSpace(root.ID)
			}
			access := "read-only"
			if root.Write {
				access = "read-write"
			}
			rootParts = append(rootParts, fmt.Sprintf("%s=%s (%s)", label, path, access))
		}
		if len(rootParts) > 0 {
			lines = append(lines, fmt.Sprintf("- Filesystem roots: %s", strings.Join(rootParts, "; ")))
		}
	}
	permissionType := env.PermissionType
	lines = append(lines, fmt.Sprintf("- Permission type: %s", permissionTypeString(permissionType)))
	lines = append(lines, fmt.Sprintf("- Subagent delegation configured at admission: %t", env.SubagentDelegation))
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

func renderPromptRepoRuleLines(files []promptRepoRuleFile, discoveryErr error) []string {
	lines := []string{fmt.Sprintf("- Repository rule sources discovered: %d; contents not loaded", len(files))}
	for _, file := range files {
		status := "readable; contents not loaded"
		if file.ReadError != "" {
			status = "unreadable: " + file.ReadError
		}
		lines = append(lines, fmt.Sprintf("- Source %q; applies to %q and its descendants; %s", file.Path, file.ScopeDir, status))
	}
	if discoveryErr != nil {
		lines = append(lines, "- Rule discovery incomplete: "+discoveryErr.Error()+". Pause affected operations until the applicable rules can be inspected.")
	}
	return lines
}

func renderPromptDelegationLines(state promptDelegationState) []string {
	if !state.Enabled {
		return []string{"- Subagent delegation configured at admission: false"}
	}
	lines := []string{
		"- Subagent delegation configured at admission: true",
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
