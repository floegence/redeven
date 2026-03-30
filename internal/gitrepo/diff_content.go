package gitrepo

import (
	"context"
	"errors"
	"strconv"
	"strings"
)

const fullContextGitUnifiedLines = 1_000_000

func (s *Service) getDiffContent(ctx context.Context, repo repoContext, req getDiffContentReq) (*getDiffContentResp, error) {
	pathspecs, err := normalizeGitPathspecs(diffPathspecCandidates(req.File))
	if err != nil {
		return nil, err
	}
	if len(pathspecs) == 0 {
		return nil, errors.New("missing diff file")
	}

	mode, maxBytes, err := normalizeGitDiffContentMode(req.Mode)
	if err != nil {
		return nil, err
	}

	args, allowedExitCodes, err := s.buildDiffContentArgs(ctx, repo, req, pathspecs, mode)
	if err != nil {
		return nil, err
	}
	entries, _, err := s.readGitDiffEntriesWithLimit(ctx, repo.repoRootReal, maxBytes, allowedExitCodes, args...)
	if err != nil {
		return nil, err
	}
	entry, ok := findDiffContentEntry(entries, req.File)
	if !ok {
		return nil, errors.New("file not found in diff")
	}

	return &getDiffContentResp{
		RepoRootPath: repo.repoRootReal,
		Mode:         mode,
		File:         entry.toDiffFileContent(),
	}, nil
}

func normalizeGitDiffContentMode(raw string) (string, int, error) {
	switch strings.TrimSpace(raw) {
	case "", "preview":
		return "preview", embeddedGitDiffEntryMaxBytes, nil
	case "full":
		return "full", fullContextGitDiffEntryMaxBytes, nil
	default:
		return "", 0, errors.New("invalid diff mode")
	}
}

func (s *Service) buildDiffContentArgs(ctx context.Context, repo repoContext, req getDiffContentReq, pathspecs []string, mode string) ([]string, []int, error) {
	unifiedArg := ""
	if mode == "full" {
		unifiedArg = "--unified=" + strconv.Itoa(fullContextGitUnifiedLines)
	}

	switch strings.TrimSpace(req.SourceKind) {
	case "workspace":
		return buildWorkspaceDiffContentArgs(req.WorkspaceSection, pathspecs, unifiedArg)
	case "commit":
		commit := strings.TrimSpace(req.Commit)
		if commit == "" {
			return nil, nil, errors.New("missing commit")
		}
		args := []string{
			"show",
			"--format=",
			"--patch",
			"--find-renames",
			"--find-copies",
			"--no-ext-diff",
			"--binary",
			"--root",
		}
		if unifiedArg != "" {
			args = append(args, unifiedArg)
		}
		args = append(args, commit)
		if len(pathspecs) > 0 {
			args = append(args, "--")
			args = append(args, pathspecs...)
		}
		return args, nil, nil
	case "compare":
		baseRef, err := normalizeGitRef(req.BaseRef)
		if err != nil {
			return nil, nil, err
		}
		targetRef, err := normalizeGitRef(req.TargetRef)
		if err != nil {
			return nil, nil, err
		}
		args := []string{
			"diff",
			"--patch",
			"--find-renames",
			"--find-copies",
			"--no-ext-diff",
			"--binary",
		}
		if unifiedArg != "" {
			args = append(args, unifiedArg)
		}
		args = append(args, baseRef+"..."+targetRef)
		if len(pathspecs) > 0 {
			args = append(args, "--")
			args = append(args, pathspecs...)
		}
		return args, nil, nil
	case "stash":
		stashID := strings.TrimSpace(req.StashID)
		if stashID == "" {
			return nil, nil, errors.New("missing stash id")
		}
		summary, err := s.resolveStashByID(ctx, repo.repoRootReal, stashID)
		if err != nil {
			return nil, nil, err
		}
		args := []string{
			"stash",
			"show",
			"--patch",
			"--include-untracked",
			"--find-renames",
			"--find-copies",
			"--no-ext-diff",
			"--binary",
		}
		if unifiedArg != "" {
			args = append(args, unifiedArg)
		}
		args = append(args, summary.Ref)
		// `git stash show <stash> -- <path>` is not a valid file-scoped preview form.
		// Load the stash patch once and reuse existing diff-entry matching to select
		// the requested file, including tracked and untracked stash entries.
		return args, nil, nil
	default:
		return nil, nil, errors.New("invalid source kind")
	}
}

func buildWorkspaceDiffContentArgs(section string, pathspecs []string, unifiedArg string) ([]string, []int, error) {
	section = strings.TrimSpace(section)
	if section == "" {
		return nil, nil, errors.New("missing workspace section")
	}
	if section == "untracked" {
		if len(pathspecs) == 0 {
			return nil, nil, errors.New("missing diff file")
		}
		args := []string{
			"diff",
			"--no-index",
			"--patch",
			"--no-ext-diff",
			"--binary",
		}
		if unifiedArg != "" {
			args = append(args, unifiedArg)
		}
		args = append(args, "--", "/dev/null", pathspecs[0])
		return args, []int{1}, nil
	}

	args := []string{
		"diff",
		"--patch",
		"--find-renames",
		"--find-copies",
		"--no-ext-diff",
		"--binary",
	}
	switch section {
	case "staged":
		args = append(args, "--cached")
	case "unstaged":
	case "conflicted":
		args = append(args, "--cc")
	default:
		return nil, nil, errors.New("invalid workspace section")
	}
	if unifiedArg != "" {
		args = append(args, unifiedArg)
	}
	if len(pathspecs) > 0 {
		args = append(args, "--")
		args = append(args, pathspecs...)
	}
	return args, nil, nil
}

func diffPathspecCandidates(file gitDiffFileRef) []string {
	return []string{
		strings.TrimSpace(file.Path),
		strings.TrimSpace(file.OldPath),
		strings.TrimSpace(file.NewPath),
	}
}

func findDiffContentEntry(entries []gitDiffEntryData, file gitDiffFileRef) (gitDiffEntryData, bool) {
	requestOld := strings.TrimSpace(file.OldPath)
	requestNew := strings.TrimSpace(file.NewPath)
	if requestOld != "" && requestNew != "" {
		for _, entry := range entries {
			if requestOld == strings.TrimSpace(entry.OldPath) && requestNew == strings.TrimSpace(entry.NewPath) {
				return entry, true
			}
		}
	}

	requestKeys := nonEmptyDiffMatchKeys(file.Path, file.OldPath, file.NewPath)
	for _, entry := range entries {
		entryKeys := nonEmptyDiffMatchKeys(entry.Path, entry.OldPath, entry.NewPath, entry.DisplayPath)
		for _, requestKey := range requestKeys {
			for _, entryKey := range entryKeys {
				if requestKey == entryKey {
					return entry, true
				}
			}
		}
	}
	return gitDiffEntryData{}, false
}

func nonEmptyDiffMatchKeys(values ...string) []string {
	seen := make(map[string]struct{}, len(values))
	keys := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		keys = append(keys, value)
	}
	return keys
}
