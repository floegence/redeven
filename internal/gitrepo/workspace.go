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

const (
	defaultWorkspacePageSize = 200
	maxWorkspacePageSize     = 500
)

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
	var reattachBranch *gitBranchSummary
	if status.Detached {
		reattachBranch = findReattachBranch(ctx, repo.repoRootReal)
	}
	return &getRepoSummaryResp{
		RepoRootPath:     repo.repoRootReal,
		WorktreePath:     repo.repoRootReal,
		IsWorktree:       detectLinkedWorktree(ctx, repo.repoRootReal),
		HeadRef:          repo.headRef,
		HeadCommit:       repo.headCommit,
		Detached:         status.Detached,
		ReattachBranch:   reattachBranch,
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
	staged, err := s.readWorkspaceSectionChanges(ctx, repo.repoRootReal, "staged", status.Staged)
	if err != nil {
		return nil, err
	}
	unstaged, err := s.readWorkspaceSectionChanges(ctx, repo.repoRootReal, "unstaged", status.Unstaged)
	if err != nil {
		return nil, err
	}
	conflicted, err := s.readWorkspaceSectionChanges(ctx, repo.repoRootReal, "conflicted", status.Conflicted)
	if err != nil {
		return nil, err
	}
	untracked, err := s.readUntrackedWorkspaceChanges(ctx, repo.repoRootReal, status.Untracked)
	if err != nil {
		return nil, err
	}
	summary := gitWorkspaceSummary{
		StagedCount:     len(staged),
		UnstagedCount:   len(unstaged),
		UntrackedCount:  len(untracked),
		ConflictedCount: len(conflicted),
	}
	return &listWorkspaceChangesResp{
		RepoRootPath: repo.repoRootReal,
		Summary:      summary,
		Staged:       staged,
		Unstaged:     unstaged,
		Untracked:    untracked,
		Conflicted:   conflicted,
	}, nil
}

func normalizeWorkspacePageSection(section string) (string, error) {
	switch strings.TrimSpace(section) {
	case "", "changes":
		return "changes", nil
	case "staged":
		return "staged", nil
	case "conflicted":
		return "conflicted", nil
	default:
		return "", errors.New("invalid workspace page section")
	}
}

func normalizeWorkspacePageLimit(limit int) int {
	switch {
	case limit <= 0:
		return defaultWorkspacePageSize
	case limit > maxWorkspacePageSize:
		return maxWorkspacePageSize
	default:
		return limit
	}
}

func normalizeWorkspacePageOffset(offset int) int {
	if offset < 0 {
		return 0
	}
	return offset
}

func workspacePageBounds(totalCount int, offset int, limit int) (int, int, int, bool) {
	start := normalizeWorkspacePageOffset(offset)
	if start > totalCount {
		start = totalCount
	}
	end := start + normalizeWorkspacePageLimit(limit)
	if end > totalCount {
		end = totalCount
	}
	nextOffset := end
	hasMore := nextOffset < totalCount
	return start, end, nextOffset, hasMore
}

func sliceWorkspaceItems(items []gitWorkspaceChange, offset int, limit int) ([]gitWorkspaceChange, int, bool) {
	start, end, nextOffset, hasMore := workspacePageBounds(len(items), offset, limit)
	if start >= end {
		return nil, nextOffset, hasMore
	}
	return items[start:end], nextOffset, hasMore
}

func slicePendingWorkspaceItems(unstaged []gitWorkspaceChange, untracked []gitWorkspaceChange, offset int, limit int) ([]gitWorkspaceChange, []gitWorkspaceChange, int, int, bool) {
	totalCount := len(unstaged) + len(untracked)
	start, end, nextOffset, hasMore := workspacePageBounds(totalCount, offset, limit)
	if start >= end {
		return nil, nil, totalCount, nextOffset, hasMore
	}

	unstagedStart := clampWorkspaceIndex(start, len(unstaged))
	unstagedEnd := clampWorkspaceIndex(end, len(unstaged))
	var unstagedPage []gitWorkspaceChange
	if unstagedStart < unstagedEnd {
		unstagedPage = unstaged[unstagedStart:unstagedEnd]
	}

	untrackedStart := clampWorkspaceIndex(start-len(unstaged), len(untracked))
	untrackedEnd := clampWorkspaceIndex(end-len(unstaged), len(untracked))
	var untrackedPage []gitWorkspaceChange
	if untrackedStart < untrackedEnd {
		untrackedPage = untracked[untrackedStart:untrackedEnd]
	}

	return unstagedPage, untrackedPage, totalCount, nextOffset, hasMore
}

func clampWorkspaceIndex(value int, max int) int {
	switch {
	case value < 0:
		return 0
	case value > max:
		return max
	default:
		return value
	}
}

func (s *Service) listWorkspacePage(ctx context.Context, repo repoContext, section string, offset int, limit int) (*listWorkspacePageResp, error) {
	status, err := s.readWorkspaceStatus(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}

	pageSection, err := normalizeWorkspacePageSection(section)
	if err != nil {
		return nil, err
	}
	pageOffset := normalizeWorkspacePageOffset(offset)
	pageLimit := normalizeWorkspacePageLimit(limit)
	summary := status.Summary()

	var (
		totalCount int
		nextOffset int
		hasMore    bool
		items      []gitWorkspaceChange
	)

	switch pageSection {
	case "staged":
		pageItems, pageNextOffset, pageHasMore := sliceWorkspaceItems(status.Staged, pageOffset, pageLimit)
		items, err = s.readWorkspaceSectionChangesPage(ctx, repo.repoRootReal, "staged", pageItems)
		if err != nil {
			return nil, err
		}
		totalCount = len(status.Staged)
		nextOffset = pageNextOffset
		hasMore = pageHasMore
	case "conflicted":
		pageItems, pageNextOffset, pageHasMore := sliceWorkspaceItems(status.Conflicted, pageOffset, pageLimit)
		items, err = s.readWorkspaceSectionChangesPage(ctx, repo.repoRootReal, "conflicted", pageItems)
		if err != nil {
			return nil, err
		}
		totalCount = len(status.Conflicted)
		nextOffset = pageNextOffset
		hasMore = pageHasMore
	default:
		unstagedPage, untrackedPage, pageTotalCount, pageNextOffset, pageHasMore := slicePendingWorkspaceItems(status.Unstaged, status.Untracked, pageOffset, pageLimit)
		unstagedItems, err := s.readWorkspaceSectionChangesPage(ctx, repo.repoRootReal, "unstaged", unstagedPage)
		if err != nil {
			return nil, err
		}
		untrackedItems, err := s.readUntrackedWorkspaceChanges(ctx, repo.repoRootReal, untrackedPage)
		if err != nil {
			return nil, err
		}
		items = append(unstagedItems, untrackedItems...)
		totalCount = pageTotalCount
		nextOffset = pageNextOffset
		hasMore = pageHasMore
	}

	return &listWorkspacePageResp{
		RepoRootPath: repo.repoRootReal,
		Section:      pageSection,
		Summary:      summary,
		TotalCount:   totalCount,
		Offset:       pageOffset,
		NextOffset:   nextOffset,
		HasMore:      hasMore,
		Items:        items,
	}, nil
}

func workspaceMetadataArgs(section string) ([]string, error) {
	base := []string{"diff", "--numstat", "-z", "--find-renames", "--find-copies", "--no-ext-diff"}
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

func workspaceSectionPathspecs(statusItems []gitWorkspaceChange) []string {
	if len(statusItems) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(statusItems)*3)
	pathspecs := make([]string, 0, len(statusItems))
	for _, item := range statusItems {
		for _, pathValue := range []string{item.Path, item.NewPath, item.OldPath} {
			pathValue = strings.TrimSpace(pathValue)
			if pathValue == "" {
				continue
			}
			if _, ok := seen[pathValue]; ok {
				continue
			}
			seen[pathValue] = struct{}{}
			pathspecs = append(pathspecs, pathValue)
		}
	}
	return pathspecs
}

func (s *Service) readWorkspaceSectionChanges(ctx context.Context, repoRoot string, section string, statusItems []gitWorkspaceChange) ([]gitWorkspaceChange, error) {
	return s.readWorkspaceSectionChangesWithPathspecs(ctx, repoRoot, section, statusItems, nil)
}

func (s *Service) readWorkspaceSectionChangesPage(ctx context.Context, repoRoot string, section string, statusItems []gitWorkspaceChange) ([]gitWorkspaceChange, error) {
	return s.readWorkspaceSectionChangesWithPathspecs(ctx, repoRoot, section, statusItems, workspaceSectionPathspecs(statusItems))
}

func (s *Service) readWorkspaceSectionChangesWithPathspecs(ctx context.Context, repoRoot string, section string, statusItems []gitWorkspaceChange, pathspecs []string) ([]gitWorkspaceChange, error) {
	if len(statusItems) == 0 {
		return nil, nil
	}
	args, err := workspaceMetadataArgs(section)
	if err != nil {
		return nil, err
	}
	if len(pathspecs) > 0 {
		args = append(args, "--")
		args = append(args, pathspecs...)
	}
	entries, err := s.readGitDiffNumstatMetadata(ctx, repoRoot, args...)
	if err != nil {
		return nil, err
	}

	patchByPath := make(map[string]gitDiffFileSummary, len(entries))
	for _, entry := range entries {
		for _, key := range diffSummaryMatchKeys(entry) {
			if key == "" {
				continue
			}
			patchByPath[key] = entry
		}
	}

	changes := make([]gitWorkspaceChange, 0, len(statusItems))
	for _, item := range statusItems {
		change := item
		change.Section = section
		if section == "conflicted" {
			change.ChangeType = "conflicted"
		}
		for _, key := range workspaceSectionMatchKeys(change) {
			if key == "" {
				continue
			}
			entry, ok := patchByPath[key]
			if !ok {
				continue
			}
			change.Path = firstNonEmptyPath(change.Path, entry.Path)
			change.OldPath = firstNonEmptyPath(change.OldPath, entry.OldPath)
			change.NewPath = firstNonEmptyPath(change.NewPath, entry.NewPath)
			change.DisplayPath = firstNonEmptyPath(change.DisplayPath, entry.DisplayPath, entry.Path, entry.NewPath, entry.OldPath)
			change.Additions = entry.Additions
			change.Deletions = entry.Deletions
			change.IsBinary = entry.IsBinary
			break
		}
		changes = append(changes, change)
	}
	return changes, nil
}

func workspaceSectionMatchKeys(item gitWorkspaceChange) []string {
	return []string{
		firstNonEmptyPath(item.DisplayPath),
		firstNonEmptyPath(item.Path),
		firstNonEmptyPath(item.NewPath),
		firstNonEmptyPath(item.OldPath),
	}
}

func decorateUntrackedWorkspaceChange(item gitWorkspaceChange) gitWorkspaceChange {
	pathValue := firstNonEmptyPath(item.Path, item.NewPath, item.DisplayPath, item.OldPath)
	return gitWorkspaceChange{
		Section: "untracked",
		gitDiffFileSummary: gitDiffFileSummary{
			ChangeType:  "added",
			Path:        pathValue,
			NewPath:     firstNonEmptyPath(item.NewPath, pathValue),
			DisplayPath: firstNonEmptyPath(item.DisplayPath, pathValue, item.NewPath, item.OldPath),
		},
	}
}

func (s *Service) readUntrackedWorkspaceChanges(ctx context.Context, repoRoot string, statusItems []gitWorkspaceChange) ([]gitWorkspaceChange, error) {
	if len(statusItems) == 0 {
		return nil, nil
	}

	changes := make([]gitWorkspaceChange, 0, len(statusItems))
	for _, item := range statusItems {
		change, err := s.readUntrackedWorkspaceChange(ctx, repoRoot, item)
		if err != nil {
			return nil, err
		}
		changes = append(changes, change)
	}
	return changes, nil
}

func (s *Service) readUntrackedWorkspaceChange(ctx context.Context, repoRoot string, item gitWorkspaceChange) (gitWorkspaceChange, error) {
	change := decorateUntrackedWorkspaceChange(item)
	targetPath := firstNonEmptyPath(change.Path, change.NewPath, change.DisplayPath)
	if targetPath == "" {
		return change, nil
	}

	entries, err := s.readGitDiffNumstatMetadataWithAllowedExitCodes(
		ctx,
		repoRoot,
		[]int{1},
		"diff",
		"--no-index",
		"--numstat",
		"-z",
		"--",
		"/dev/null",
		targetPath,
	)
	if err != nil {
		return gitWorkspaceChange{}, err
	}
	if len(entries) == 0 {
		diffEntries, _, diffErr := s.readGitDiffEntriesWithLimit(
			ctx,
			repoRoot,
			embeddedGitDiffEntryMaxBytes,
			[]int{1},
			"diff",
			"--no-index",
			"--patch",
			"--no-ext-diff",
			"--binary",
			"--",
			"/dev/null",
			targetPath,
		)
		if diffErr != nil {
			return gitWorkspaceChange{}, diffErr
		}
		if len(diffEntries) > 0 {
			entry := diffEntries[0]
			change.Path = firstNonEmptyPath(change.Path, entry.Path, entry.NewPath, entry.OldPath)
			change.NewPath = firstNonEmptyPath(change.NewPath, entry.NewPath, change.Path)
			change.DisplayPath = firstNonEmptyPath(change.DisplayPath, entry.DisplayPath, entry.Path, change.Path, change.NewPath)
			change.Additions = entry.Additions
			change.Deletions = entry.Deletions
			change.IsBinary = entry.IsBinary
		}
		return change, nil
	}
	if len(entries) == 0 {
		return change, nil
	}

	for _, entry := range entries {
		change.Additions += entry.Additions
		change.Deletions += entry.Deletions
	}
	if len(entries) == 1 {
		entry := entries[0]
		change.Path = firstNonEmptyPath(change.Path, entry.Path, entry.NewPath, entry.OldPath)
		change.NewPath = firstNonEmptyPath(entry.NewPath, change.NewPath, change.Path)
		change.DisplayPath = firstNonEmptyPath(change.DisplayPath, entry.DisplayPath, entry.Path, change.Path, change.NewPath)
		change.IsBinary = entry.IsBinary
	}
	return change, nil
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
				Section: "conflicted",
				gitDiffFileSummary: gitDiffFileSummary{
					ChangeType:  "conflicted",
					Path:        pathValue,
					DisplayPath: pathValue,
				},
			})
		case strings.HasPrefix(token, "? "):
			pathValue := strings.TrimSpace(token[2:])
			snapshot.Untracked = append(snapshot.Untracked, gitWorkspaceChange{
				Section: "untracked",
				gitDiffFileSummary: gitDiffFileSummary{
					ChangeType:  "added",
					Path:        pathValue,
					NewPath:     pathValue,
					DisplayPath: pathValue,
				},
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
			Section: "conflicted",
			gitDiffFileSummary: gitDiffFileSummary{
				ChangeType:  "conflicted",
				Path:        pathValue,
				OldPath:     oldPath,
				NewPath:     newPath,
				DisplayPath: firstNonEmptyPath(pathValue, newPath, oldPath),
			},
		})
		return
	}
	if indexStatus != '.' {
		snapshot.Staged = append(snapshot.Staged, gitWorkspaceChange{
			Section: "staged",
			gitDiffFileSummary: gitDiffFileSummary{
				ChangeType:  workspaceChangeType(indexStatus, oldPath, newPath),
				Path:        pathValue,
				OldPath:     oldPath,
				NewPath:     newPath,
				DisplayPath: firstNonEmptyPath(pathValue, newPath, oldPath),
			},
		})
	}
	if worktreeStatus != '.' {
		snapshot.Unstaged = append(snapshot.Unstaged, gitWorkspaceChange{
			Section: "unstaged",
			gitDiffFileSummary: gitDiffFileSummary{
				ChangeType:  workspaceChangeType(worktreeStatus, oldPath, newPath),
				Path:        pathValue,
				OldPath:     oldPath,
				NewPath:     newPath,
				DisplayPath: firstNonEmptyPath(pathValue, newPath, oldPath),
			},
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
