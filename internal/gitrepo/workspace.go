package gitrepo

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/floegence/redeven-agent/internal/gitutil"
)

type workspaceStatusSnapshot struct {
	HeadRef     string
	Detached    bool
	UpstreamRef string
	AheadCount  int
	BehindCount int
	Staged      []gitWorkspaceChange
	Unstaged    []gitWorkspaceChange
	Untracked   []gitWorkspaceChange
	Conflicted  []gitWorkspaceChange
}

func (s workspaceStatusSnapshot) Summary() gitWorkspaceSummary {
	return gitWorkspaceSummary{
		StagedCount:     len(s.Staged),
		UnstagedCount:   len(s.Unstaged),
		UntrackedCount:  len(s.Untracked),
		ConflictedCount: len(s.Conflicted),
	}
}

func (s *Service) getRepoSummary(ctx context.Context, repo repoContext) (*getRepoSummaryResp, error) {
	status, err := s.readWorkspaceStatus(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}
	stashCount := readStashCount(ctx, repo.repoRootReal)
	return &getRepoSummaryResp{
		RepoRootPath:     repo.repoRootVirtual,
		WorktreePath:     repo.repoRootVirtual,
		IsWorktree:       detectLinkedWorktree(ctx, repo.repoRootReal),
		HeadRef:          repo.headRef,
		HeadCommit:       repo.headCommit,
		Detached:         status.Detached,
		UpstreamRef:      status.UpstreamRef,
		AheadCount:       status.AheadCount,
		BehindCount:      status.BehindCount,
		StashCount:       stashCount,
		WorkspaceSummary: status.Summary(),
	}, nil
}

func (s *Service) listWorkspaceChanges(ctx context.Context, repo repoContext) (*listWorkspaceChangesResp, error) {
	status, err := s.readWorkspaceStatus(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}
	staged, err := s.readWorkspaceDiffSection(ctx, repo.repoRootReal, "staged")
	if err != nil {
		return nil, err
	}
	unstaged, err := s.readWorkspaceDiffSection(ctx, repo.repoRootReal, "unstaged")
	if err != nil {
		return nil, err
	}
	conflicted, err := s.readWorkspaceDiffSection(ctx, repo.repoRootReal, "conflicted")
	if err != nil {
		return nil, err
	}
	untracked := decorateUntrackedWorkspaceChanges(status.Untracked)
	summary := gitWorkspaceSummary{
		StagedCount:     len(staged),
		UnstagedCount:   len(unstaged),
		UntrackedCount:  len(untracked),
		ConflictedCount: len(conflicted),
	}
	return &listWorkspaceChangesResp{
		RepoRootPath: repo.repoRootVirtual,
		Summary:      summary,
		Staged:       staged,
		Unstaged:     unstaged,
		Untracked:    untracked,
		Conflicted:   conflicted,
	}, nil
}

func workspacePatchArgs(section string) ([]string, error) {
	base := []string{"diff", "--patch", "--find-renames", "--find-copies", "--no-ext-diff", "--binary"}
	switch section {
	case "staged":
		base = append(base, "--cached")
	case "unstaged":
	case "conflicted":
		base = append(base, "--cc")
	default:
		return nil, errors.New("invalid section")
	}
	return base, nil
}

func (s *Service) readWorkspaceDiffSection(ctx context.Context, repoRoot string, section string) ([]gitWorkspaceChange, error) {
	args, err := workspacePatchArgs(section)
	if err != nil {
		return nil, err
	}
	entries, err := s.readGitDiffEntries(ctx, repoRoot, args...)
	if err != nil {
		return nil, err
	}
	changes := make([]gitWorkspaceChange, 0, len(entries))
	for _, entry := range entries {
		change := entry.toWorkspaceChange(section)
		if section == "conflicted" {
			change.ChangeType = "conflicted"
		}
		changes = append(changes, change)
	}
	return changes, nil
}

func decorateUntrackedWorkspaceChanges(items []gitWorkspaceChange) []gitWorkspaceChange {
	if len(items) == 0 {
		return nil
	}
	result := make([]gitWorkspaceChange, 0, len(items))
	for _, item := range items {
		result = append(result, gitWorkspaceChange{
			Section:     "untracked",
			ChangeType:  "added",
			Path:        item.Path,
			NewPath:     item.NewPath,
			DisplayPath: firstNonEmptyPath(item.DisplayPath, item.Path, item.NewPath, item.OldPath),
		})
	}
	return result
}

func firstNonEmptyPath(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func (s *Service) readWorkspaceStatus(ctx context.Context, repoRoot string) (workspaceStatusSnapshot, error) {
	out, err := gitutil.RunCombinedOutput(ctx, repoRoot, nil, "status", "--porcelain=v2", "--branch", "-z")
	if err != nil {
		return workspaceStatusSnapshot{}, err
	}
	return parseWorkspaceStatusPorcelainV2(out), nil
}

func parseWorkspaceStatusPorcelainV2(out []byte) workspaceStatusSnapshot {
	tokens := strings.Split(string(out), "\x00")
	snapshot := workspaceStatusSnapshot{}
	for index := 0; index < len(tokens); index += 1 {
		token := strings.TrimSuffix(tokens[index], "\n")
		if token == "" {
			continue
		}
		switch {
		case strings.HasPrefix(token, "# "):
			parseWorkspaceHeader(&snapshot, strings.TrimSpace(token[2:]))
		case strings.HasPrefix(token, "1 "):
			fields := strings.SplitN(token, " ", 9)
			if len(fields) < 9 {
				continue
			}
			applyTrackedWorkspaceRecord(&snapshot, fields[1], strings.TrimSpace(fields[8]), "", strings.TrimSpace(fields[8]))
		case strings.HasPrefix(token, "2 "):
			fields := strings.SplitN(token, " ", 10)
			if len(fields) < 10 {
				continue
			}
			newPath := strings.TrimSpace(fields[9])
			oldPath := ""
			if index+1 < len(tokens) {
				oldPath = strings.TrimSpace(strings.TrimSuffix(tokens[index+1], "\n"))
				index += 1
			}
			applyTrackedWorkspaceRecord(&snapshot, fields[1], preferredWorkspacePath(oldPath, newPath), oldPath, newPath)
		case strings.HasPrefix(token, "u "):
			fields := strings.SplitN(token, " ", 11)
			if len(fields) < 11 {
				continue
			}
			pathValue := strings.TrimSpace(fields[10])
			snapshot.Conflicted = append(snapshot.Conflicted, gitWorkspaceChange{
				Section:     "conflicted",
				ChangeType:  "conflicted",
				Path:        pathValue,
				DisplayPath: pathValue,
			})
		case strings.HasPrefix(token, "? "):
			pathValue := strings.TrimSpace(token[2:])
			snapshot.Untracked = append(snapshot.Untracked, gitWorkspaceChange{
				Section:     "untracked",
				ChangeType:  "added",
				Path:        pathValue,
				NewPath:     pathValue,
				DisplayPath: pathValue,
			})
		}
	}
	return snapshot
}

func parseWorkspaceHeader(snapshot *workspaceStatusSnapshot, line string) {
	if snapshot == nil || line == "" {
		return
	}
	switch {
	case strings.HasPrefix(line, "branch.head "):
		value := strings.TrimSpace(strings.TrimPrefix(line, "branch.head "))
		snapshot.HeadRef = value
		snapshot.Detached = value == "(detached)" || value == "HEAD"
	case strings.HasPrefix(line, "branch.upstream "):
		snapshot.UpstreamRef = strings.TrimSpace(strings.TrimPrefix(line, "branch.upstream "))
	case strings.HasPrefix(line, "branch.ab "):
		rest := strings.TrimSpace(strings.TrimPrefix(line, "branch.ab "))
		parts := strings.Fields(rest)
		for _, part := range parts {
			if strings.HasPrefix(part, "+") {
				snapshot.AheadCount, _ = strconv.Atoi(strings.TrimPrefix(part, "+"))
			}
			if strings.HasPrefix(part, "-") {
				snapshot.BehindCount, _ = strconv.Atoi(strings.TrimPrefix(part, "-"))
			}
		}
	}
}

func applyTrackedWorkspaceRecord(snapshot *workspaceStatusSnapshot, xy string, pathValue string, oldPath string, newPath string) {
	if snapshot == nil {
		return
	}
	if len(xy) < 2 {
		return
	}
	indexStatus := xy[0]
	worktreeStatus := xy[1]
	if indexStatus == 'U' || worktreeStatus == 'U' {
		snapshot.Conflicted = append(snapshot.Conflicted, gitWorkspaceChange{
			Section:     "conflicted",
			ChangeType:  "conflicted",
			Path:        pathValue,
			OldPath:     oldPath,
			NewPath:     newPath,
			DisplayPath: firstNonEmptyPath(pathValue, newPath, oldPath),
		})
		return
	}
	if indexStatus != '.' {
		snapshot.Staged = append(snapshot.Staged, gitWorkspaceChange{
			Section:     "staged",
			ChangeType:  workspaceChangeType(indexStatus, oldPath, newPath),
			Path:        pathValue,
			OldPath:     oldPath,
			NewPath:     newPath,
			DisplayPath: firstNonEmptyPath(pathValue, newPath, oldPath),
		})
	}
	if worktreeStatus != '.' {
		snapshot.Unstaged = append(snapshot.Unstaged, gitWorkspaceChange{
			Section:     "unstaged",
			ChangeType:  workspaceChangeType(worktreeStatus, oldPath, newPath),
			Path:        pathValue,
			OldPath:     oldPath,
			NewPath:     newPath,
			DisplayPath: firstNonEmptyPath(pathValue, newPath, oldPath),
		})
	}
}

func workspaceChangeType(status byte, oldPath string, newPath string) string {
	if oldPath != "" && newPath != "" && oldPath != newPath {
		switch status {
		case 'C':
			return "copied"
		default:
			return "renamed"
		}
	}
	switch status {
	case 'A':
		return "added"
	case 'D':
		return "deleted"
	case 'C':
		return "copied"
	case 'R':
		return "renamed"
	case 'U':
		return "conflicted"
	default:
		return "modified"
	}
}

func preferredWorkspacePath(oldPath string, newPath string) string {
	if strings.TrimSpace(newPath) != "" {
		return strings.TrimSpace(newPath)
	}
	return strings.TrimSpace(oldPath)
}

func readStashCount(ctx context.Context, repoRoot string) int {
	out := readGitOptional(ctx, repoRoot, "stash", "list", "--format=%H")
	if strings.TrimSpace(out) == "" {
		return 0
	}
	count := 0
	for _, line := range strings.Split(out, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		count += 1
	}
	return count
}

func detectLinkedWorktree(ctx context.Context, repoRoot string) bool {
	gitDir := strings.TrimSpace(readGitOptional(ctx, repoRoot, "rev-parse", "--absolute-git-dir"))
	commonDir := strings.TrimSpace(readGitOptional(ctx, repoRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"))
	if gitDir == "" || commonDir == "" {
		return false
	}
	return strings.TrimSuffix(gitDir, "/") != strings.TrimSuffix(commonDir, "/")
}
