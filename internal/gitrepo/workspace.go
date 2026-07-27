package gitrepo

import (
	"context"
	"errors"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type workspaceStatusSnapshot struct {
	HeadRef          string
	Detached         bool
	UpstreamRef      string
	AheadCount       int
	BehindCount      int
	Staged           []gitWorkspaceChange
	Unstaged         []gitWorkspaceChange
	Untracked        []gitWorkspaceChange
	Conflicted       []gitWorkspaceChange
	RecordCount      int
	pendingRenameXY  string
	pendingRenameNew string
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
	snapshot, release, err := s.workspaceSnapshot(ctx, repo.repoRootReal, "")
	if err != nil {
		return nil, err
	}
	defer release()
	status := snapshot.status
	stashCount := s.readStashCount(ctx, repo.repoRootReal)
	var reattachBranch *gitBranchSummary
	if status.Detached {
		reattachBranch = s.findReattachBranch(ctx, repo.repoRootReal)
	}
	return &getRepoSummaryResp{
		RepoRootPath:      repo.repoRootReal,
		WorktreePath:      repo.repoRootReal,
		IsWorktree:        repo.identity.GitDir != repo.identity.CommonDir,
		HeadRef:           repo.headRef,
		HeadCommit:        repo.headCommit,
		Detached:          status.Detached,
		ReattachBranch:    reattachBranch,
		UpstreamRef:       status.UpstreamRef,
		AheadCount:        status.AheadCount,
		BehindCount:       status.BehindCount,
		StashCount:        stashCount,
		WorkspaceSummary:  status.Summary(),
		WorkspaceRevision: snapshot.revision,
	}, nil
}

func (s *Service) listWorkspaceChanges(ctx context.Context, repo repoContext) (*listWorkspaceChangesResp, error) {
	snapshot, release, err := s.workspaceSnapshot(ctx, repo.repoRootReal, "")
	if err != nil {
		return nil, err
	}
	defer release()
	status := snapshot.status
	if status.RecordCount > 512 {
		return nil, errWorkspacePaginationRequired
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
		RepoRootPath:      repo.repoRootReal,
		WorkspaceRevision: snapshot.revision,
		Summary:           summary,
		Staged:            staged,
		Unstaged:          unstaged,
		Untracked:         untracked,
		Conflicted:        conflicted,
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

func (s *Service) listWorkspacePage(ctx context.Context, repo repoContext, section string, directoryPath string, offset int, limit int, expectedRevision string) (*listWorkspacePageResp, error) {
	snapshot, release, err := s.workspaceSnapshot(ctx, repo.repoRootReal, expectedRevision)
	if err != nil {
		return nil, err
	}
	defer release()
	status := snapshot.status

	pageSection, err := normalizeWorkspacePageSection(section)
	if err != nil {
		return nil, err
	}
	pageOffset := normalizeWorkspacePageOffset(offset)
	pageLimit := normalizeWorkspacePageLimit(limit)
	summary := status.Summary()

	return s.listWorkspaceDirectoryPage(repo.repoRootReal, status, snapshot.revision, pageSection, directoryPath, summary, pageOffset, pageLimit)
}

type workspaceDirectoryBucket struct {
	path       string
	files      map[string]struct{}
	unstaged   map[string]struct{}
	untracked  map[string]struct{}
	staged     map[string]struct{}
	conflicted map[string]struct{}
}

func (s *Service) listWorkspaceDirectoryPage(repoRoot string, status workspaceStatusSnapshot, revision string, pageSection string, directoryPath string, summary gitWorkspaceSummary, offset int, limit int) (*listWorkspacePageResp, error) {
	normalizedDirectoryPath, err := normalizeGitDirectoryPath(directoryPath)
	if err != nil {
		return nil, err
	}

	sectionItems := workspacePageSectionItems(status, pageSection)
	fileItems, deferred := partitionWorkspaceDirectoryItems(sectionItems, normalizedDirectoryPath)
	fileItems = append([]gitWorkspaceChange(nil), fileItems...)
	for index := range fileItems {
		finalizeWorkspaceStatusChange(&fileItems[index])
	}
	sortWorkspaceChanges(fileItems)

	directoryItems := buildWorkspaceDirectoryEntries(deferred, normalizedDirectoryPath, pageSection)
	items := append(directoryItems, fileItems...)
	sortWorkspaceChanges(items)

	start, end, nextOffset, hasMore := workspacePageBounds(len(items), offset, limit)
	pageItems := make([]gitWorkspaceChange, 0, maxWorkspaceSliceSize(start, end))
	if start < end {
		pageItems = append(pageItems, items[start:end]...)
	}

	return &listWorkspacePageResp{
		RepoRootPath:      repoRoot,
		WorkspaceRevision: revision,
		Section:           pageSection,
		DirectoryPath:     normalizedDirectoryPath,
		Breadcrumbs:       buildWorkspaceBreadcrumbs(repoRoot, normalizedDirectoryPath),
		Summary:           summary,
		ScopeFileCount:    uniqueWorkspaceFileCount(sectionItems, normalizedDirectoryPath),
		TotalCount:        len(items),
		Offset:            offset,
		NextOffset:        nextOffset,
		HasMore:           hasMore,
		Items:             pageItems,
	}, nil
}

func workspacePageSectionItems(status workspaceStatusSnapshot, section string) []gitWorkspaceChange {
	switch section {
	case "staged":
		return status.Staged
	case "conflicted":
		return status.Conflicted
	default:
		items := make([]gitWorkspaceChange, 0, len(status.Unstaged)+len(status.Untracked))
		items = append(items, status.Unstaged...)
		items = append(items, status.Untracked...)
		return items
	}
}

func uniqueWorkspaceFileCount(items []gitWorkspaceChange, directoryPath string) int {
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		browsePath := workspaceChangeBrowsePath(item)
		if browsePath != "" && workspacePathWithinDirectory(browsePath, directoryPath) {
			seen[browsePath] = struct{}{}
		}
	}
	return len(seen)
}

func (s *Service) listWorkspacePathStatuses(ctx context.Context, repo repoContext, paths []string, expectedRevision string) (*listWorkspacePathStatusesResp, error) {
	normalizedPaths, err := normalizeWorkspaceStatusRequestPaths(paths)
	if err != nil {
		return nil, err
	}
	snapshot, release, err := s.workspaceSnapshot(ctx, repo.repoRootReal, expectedRevision)
	if err != nil {
		return nil, err
	}
	defer release()

	allItems := make([]gitWorkspaceChange, 0, snapshot.status.Summary().StagedCount+snapshot.status.Summary().UnstagedCount+snapshot.status.Summary().UntrackedCount+snapshot.status.Summary().ConflictedCount)
	allItems = append(allItems, snapshot.status.Unstaged...)
	allItems = append(allItems, snapshot.status.Untracked...)
	allItems = append(allItems, snapshot.status.Conflicted...)
	allItems = append(allItems, snapshot.status.Staged...)

	items := make([]gitWorkspaceChange, 0, len(normalizedPaths))
	for _, requestedPath := range normalizedPaths {
		matching := workspaceItemsForRequestedPath(allItems, requestedPath)
		if len(matching) == 0 {
			continue
		}
		if workspaceRequestedPathIsDirectory(matching, requestedPath) {
			items = append(items, aggregateWorkspacePathStatus(matching, requestedPath))
			continue
		}
		exact := make([]gitWorkspaceChange, 0, len(matching))
		for _, item := range matching {
			if workspaceChangeBrowsePath(item) != requestedPath {
				continue
			}
			finalizeWorkspaceStatusChange(&item)
			exact = append(exact, item)
		}
		sortWorkspaceChanges(exact)
		items = append(items, exact...)
	}
	return &listWorkspacePathStatusesResp{
		RepoRootPath:      repo.repoRootReal,
		WorkspaceRevision: snapshot.revision,
		Items:             items,
	}, nil
}

func normalizeWorkspaceStatusRequestPaths(paths []string) ([]string, error) {
	seen := make(map[string]struct{}, len(paths))
	out := make([]string, 0, len(paths))
	for _, pathValue := range paths {
		normalized, err := normalizeGitPathspec(pathValue)
		if err != nil || normalized == "" {
			return nil, errors.New("invalid git path")
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		out = append(out, normalized)
	}
	return out, nil
}

func workspaceItemsForRequestedPath(items []gitWorkspaceChange, requestedPath string) []gitWorkspaceChange {
	out := make([]gitWorkspaceChange, 0)
	for _, item := range items {
		browsePath := workspaceChangeBrowsePath(item)
		if browsePath == requestedPath || strings.HasPrefix(browsePath, requestedPath+"/") {
			out = append(out, item)
		}
	}
	return out
}

func workspaceRequestedPathIsDirectory(items []gitWorkspaceChange, requestedPath string) bool {
	for _, item := range items {
		browsePath := workspaceChangeBrowsePath(item)
		if browsePath != requestedPath || item.EntryKind == "directory" {
			return true
		}
	}
	return false
}

func aggregateWorkspacePathStatus(items []gitWorkspaceChange, requestedPath string) gitWorkspaceChange {
	bucket := workspaceDirectoryBucket{
		path:       requestedPath,
		files:      make(map[string]struct{}),
		unstaged:   make(map[string]struct{}),
		untracked:  make(map[string]struct{}),
		staged:     make(map[string]struct{}),
		conflicted: make(map[string]struct{}),
	}
	for _, item := range items {
		browsePath := workspaceChangeBrowsePath(item)
		if browsePath == "" {
			continue
		}
		bucket.files[browsePath] = struct{}{}
		switch item.Section {
		case "unstaged":
			bucket.unstaged[browsePath] = struct{}{}
		case "untracked":
			bucket.untracked[browsePath] = struct{}{}
		case "staged":
			bucket.staged[browsePath] = struct{}{}
		case "conflicted":
			bucket.conflicted[browsePath] = struct{}{}
		}
	}
	return gitWorkspaceChange{
		EntryKind:           "directory",
		ParentPath:          workspaceChangeParentPath(gitWorkspaceChange{gitDiffFileSummary: gitDiffFileSummary{Path: requestedPath}}),
		DirectoryPath:       requestedPath,
		DescendantFileCount: len(bucket.files),
		UnstagedFileCount:   len(bucket.unstaged),
		UntrackedFileCount:  len(bucket.untracked),
		StagedFileCount:     len(bucket.staged),
		ConflictedFileCount: len(bucket.conflicted),
		ContainsUnstaged:    len(bucket.unstaged) != 0,
		ContainsUntracked:   len(bucket.untracked) != 0,
		ContainsStaged:      len(bucket.staged) != 0,
		ContainsConflicted:  len(bucket.conflicted) != 0,
		gitDiffFileSummary: gitDiffFileSummary{
			Path:        requestedPath,
			DisplayPath: requestedPath,
		},
	}
}

func partitionWorkspaceDirectoryItems(items []gitWorkspaceChange, directoryPath string) ([]gitWorkspaceChange, []gitWorkspaceChange) {
	if len(items) == 0 {
		return nil, nil
	}
	direct := make([]gitWorkspaceChange, 0, len(items))
	deferred := make([]gitWorkspaceChange, 0, len(items))
	for _, item := range items {
		browsePath := workspaceChangeBrowsePath(item)
		if browsePath == "" || !workspacePathWithinDirectory(browsePath, directoryPath) {
			continue
		}
		if workspaceChangeParentPath(item) == directoryPath {
			direct = append(direct, item)
			continue
		}
		deferred = append(deferred, item)
	}
	return direct, deferred
}

func buildWorkspaceDirectoryEntries(items []gitWorkspaceChange, parentPath string, pageSection string) []gitWorkspaceChange {
	if len(items) == 0 {
		return nil
	}
	buckets := make(map[string]*workspaceDirectoryBucket, len(items))
	for _, item := range items {
		browsePath := workspaceChangeBrowsePath(item)
		childDirectoryPath := workspaceImmediateChildPath(browsePath, parentPath)
		if childDirectoryPath == "" || childDirectoryPath == browsePath {
			continue
		}
		bucket := buckets[childDirectoryPath]
		if bucket == nil {
			bucket = &workspaceDirectoryBucket{
				path:       childDirectoryPath,
				files:      make(map[string]struct{}),
				unstaged:   make(map[string]struct{}),
				untracked:  make(map[string]struct{}),
				staged:     make(map[string]struct{}),
				conflicted: make(map[string]struct{}),
			}
			buckets[childDirectoryPath] = bucket
		}
		bucket.files[browsePath] = struct{}{}
		switch item.Section {
		case "untracked":
			bucket.untracked[browsePath] = struct{}{}
		case "unstaged":
			bucket.unstaged[browsePath] = struct{}{}
		case "staged":
			bucket.staged[browsePath] = struct{}{}
		case "conflicted":
			bucket.conflicted[browsePath] = struct{}{}
		}
	}
	if len(buckets) == 0 {
		return nil
	}
	keys := make([]string, 0, len(buckets))
	for key := range buckets {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]gitWorkspaceChange, 0, len(keys))
	for _, key := range keys {
		bucket := buckets[key]
		out = append(out, gitWorkspaceChange{
			Section:             pageSection,
			EntryKind:           "directory",
			ParentPath:          parentPath,
			DirectoryPath:       bucket.path,
			DescendantFileCount: len(bucket.files),
			UnstagedFileCount:   len(bucket.unstaged),
			UntrackedFileCount:  len(bucket.untracked),
			StagedFileCount:     len(bucket.staged),
			ConflictedFileCount: len(bucket.conflicted),
			ContainsUntracked:   len(bucket.untracked) != 0,
			ContainsUnstaged:    len(bucket.unstaged) != 0,
			ContainsStaged:      len(bucket.staged) != 0,
			ContainsConflicted:  len(bucket.conflicted) != 0,
			gitDiffFileSummary: gitDiffFileSummary{
				Path:        bucket.path,
				DisplayPath: bucket.path,
			},
		})
	}
	return out
}

func buildWorkspaceBreadcrumbs(repoRoot string, directoryPath string) []gitWorkspaceBreadcrumb {
	rootLabel := filepath.Base(repoRoot)
	if rootLabel == "" || rootLabel == "." || rootLabel == string(filepath.Separator) {
		rootLabel = "Repository"
	}
	breadcrumbs := []gitWorkspaceBreadcrumb{{Label: rootLabel, Path: ""}}
	if directoryPath == "" {
		return breadcrumbs
	}
	accumulated := ""
	for _, segment := range strings.Split(directoryPath, "/") {
		if segment == "" {
			continue
		}
		if accumulated == "" {
			accumulated = segment
		} else {
			accumulated = accumulated + "/" + segment
		}
		breadcrumbs = append(breadcrumbs, gitWorkspaceBreadcrumb{
			Label: segment,
			Path:  accumulated,
		})
	}
	return breadcrumbs
}

func maxWorkspaceSliceSize(start int, end int) int {
	if end <= start {
		return 0
	}
	return end - start
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
		for _, pathValue := range workspaceChangePathCandidates(item) {
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
		change.EntryKind = "file"
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
		change.ParentPath = workspaceChangeParentPath(change)
		change.MutationPaths = workspaceChangePathCandidates(change)
		changes = append(changes, change)
	}
	sortWorkspaceChanges(changes)
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
	change := gitWorkspaceChange{
		Section:   "untracked",
		EntryKind: "file",
		gitDiffFileSummary: gitDiffFileSummary{
			ChangeType:  "added",
			Path:        pathValue,
			NewPath:     firstNonEmptyPath(item.NewPath, pathValue),
			DisplayPath: firstNonEmptyPath(item.DisplayPath, pathValue, item.NewPath, item.OldPath),
		},
	}
	change.ParentPath = workspaceChangeParentPath(change)
	change.MutationPaths = workspaceChangePathCandidates(change)
	return change
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
	sortWorkspaceChanges(changes)
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
		if value != "" {
			return value
		}
	}
	return ""
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
			Section:   "conflicted",
			EntryKind: "file",
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
			Section:   "staged",
			EntryKind: "file",
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
			Section:   "unstaged",
			EntryKind: "file",
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
	if newPath != "" {
		return newPath
	}
	return oldPath
}

func (s *Service) readStashCount(ctx context.Context, repoRoot string) int {
	out := s.readGitOptional(ctx, repoRoot, "stash", "list", "--format=%H")
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
