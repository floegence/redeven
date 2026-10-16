package ai

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/gitutil"
)

const promptRuleRootProbeTimeout = 3 * time.Second

var promptRepoRuleCandidateNames = []string{
	"AGENTS.md",
	"CLAUDE.md",
	".develop.md",
	".introduce.md",
}

type promptWorkspaceContext struct {
	Environment    promptEnvironmentFacts
	RepoRules      []promptRepoRuleFile
	RepoRulesError error
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

type promptRepoRuleFile struct {
	Path      string
	ScopeDir  string
	ReadError string
}

func collectPromptWorkspaceContext(ctx context.Context, r *run, permission FlowerPermissionType) promptWorkspaceContext {
	workspace := promptWorkspaceContext{
		Environment: collectPromptEnvironmentFacts(r, permission),
	}
	workspace.RepoRules, workspace.RepoRulesError = r.collectPromptRepoRuleFiles(ctx, workspace.Environment.WorkingDir)
	return workspace
}

func collectPromptEnvironmentFacts(r *run, permission FlowerPermissionType) promptEnvironmentFacts {
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
	out.PermissionType = permission
	out.SubagentDelegation = r.allowSubagentDelegate
	return out
}

func (r *run) collectPromptRepoRuleFiles(ctx context.Context, workingDir string) ([]promptRepoRuleFile, error) {
	if r == nil || strings.TrimSpace(workingDir) == "" {
		return nil, nil
	}
	scope, err := r.runPathScope()
	if err != nil {
		return nil, errors.New("repository rule discovery requires an authorized working directory")
	}
	// Git root discovery bounds applicable rule sources; workspace status is
	// queried only through tools when the model needs it.
	probeCtx, cancel := context.WithTimeout(ctx, promptRuleRootProbeTimeout)
	repoRoot, _ := gitutil.ResolveTopLevel(probeCtx, workingDir)
	cancel()
	files := []promptRepoRuleFile{}
	for _, dir := range promptRuleSearchDirs(workingDir, repoRoot) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
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
			if err := ctx.Err(); err != nil {
				return nil, err
			}
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

// collectModelContextSnapshot is the sole Flower runtime fact collector. Floret
// owns comparison, chronological admission, rendering and durable history.
func (r *run) collectModelContextSnapshot(ctx context.Context, permission FlowerPermissionType, now func() time.Time) (*flruntime.ModelContextSnapshot, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if r == nil {
		return nil, fmt.Errorf("%w: runtime execution configuration is unavailable", flruntime.ErrModelContextUnavailable)
	}
	workspace := collectPromptWorkspaceContext(ctx, r, permission)
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if workspace.RepoRulesError != nil {
		return nil, fmt.Errorf("%w: %v", flruntime.ErrModelContextUnavailable, workspace.RepoRulesError)
	}
	for _, file := range workspace.RepoRules {
		if file.ReadError != "" {
			return nil, fmt.Errorf("%w: repository rule source %q: %s", flruntime.ErrModelContextUnavailable, file.Path, file.ReadError)
		}
	}
	runtimeLines := []string{"Tool execution environment: terminal.exec runs on the AI runtime host. A user-selected device may be different; selection does not route a command.", "- Working directory: " + workspace.Environment.WorkingDir}
	if endpoint := strings.TrimSpace(r.endpointID); endpoint != "" {
		runtimeLines = append(runtimeLines, "Runtime endpoint ID: "+endpoint)
	}
	runtimeLines = append(runtimeLines, renderPromptEnvironmentFactsLines(workspace.Environment)...)
	manager := r.ensureSkillManager()
	if manager == nil {
		return nil, fmt.Errorf("%w: skill catalog unavailable", flruntime.ErrModelContextUnavailable)
	}
	catalog, err := manager.modelContextCatalog(ctx, permissionTypeString(permission))
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("%w: %v", flruntime.ErrModelContextUnavailable, err)
	}
	skills := buildSkillCatalogPrompt(catalog)
	if skills == "" {
		skills = "No skills are available for the current permission policy."
	}
	snapshot := &flruntime.ModelContextSnapshot{Sections: []flruntime.ModelContextSection{
		{Key: "execution_environment", Title: "Execution environment", Text: strings.Join(runtimeLines, "\n")},
		{Key: "local_time", Title: "Date and timezone", Text: strings.Join(renderPromptLocalTimeContextLines(currentPromptLocalTimeContext(now)), "\n")},
		{Key: "repository_rules", Title: "Repository rule sources", Text: strings.Join(renderPromptRepoRuleLines(workspace.RepoRules, nil), "\n")},
		{Key: "skills", Title: "Available skills", Text: skills},
	}}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := snapshot.Validate(); err != nil {
		return nil, fmt.Errorf("%w: runtime snapshot cannot be admitted: %v", flruntime.ErrModelContextUnavailable, err)
	}
	return snapshot, nil
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
	lines = append(lines, fmt.Sprintf("- Subagent delegation available: %t", env.SubagentDelegation))
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
