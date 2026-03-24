package gitrepo

import (
	"context"
	"errors"
	"strconv"
	"strings"
)

const fullContextGitUnifiedLines = 1_000_000

func (s *Service) getFullContextDiff(ctx context.Context, repo repoContext, req getFullContextDiffReq) (*getFullContextDiffResp, error) {
	pathspecs, err := normalizeGitPathspecs(diffPathspecCandidates(req.File))
	if err != nil {
		return nil, err
	}
	if len(pathspecs) == 0 && strings.TrimSpace(req.SourceKind) != "workspace" {
		return nil, errors.New("missing diff file")
	}

	args, allowedExitCodes, err := buildFullContextDiffArgs(req, pathspecs)
	if err != nil {
		return nil, err
	}
	entries, _, err := s.readGitDiffEntriesWithLimit(ctx, repo.repoRootReal, fullContextGitDiffEntryMaxBytes, allowedExitCodes, args...)
	if err != nil {
		return nil, err
	}
	entry, ok := findFullContextDiffEntry(entries, req.File)
	if !ok {
		return nil, errors.New("file not found in diff")
	}
	return &getFullContextDiffResp{
		RepoRootPath: repo.repoRootReal,
		File:         entry.toCommitFileSummary(),
	}, nil
}

func buildFullContextDiffArgs(req getFullContextDiffReq, pathspecs []string) ([]string, []int, error) {
	fullContextArg := "--unified=" + strconv.Itoa(fullContextGitUnifiedLines)
	switch strings.TrimSpace(req.SourceKind) {
	case "workspace":
		section := strings.TrimSpace(req.WorkspaceSection)
		if section == "" {
			return nil, nil, errors.New("missing workspace section")
		}
		if section == "untracked" {
			if len(pathspecs) == 0 {
				return nil, nil, errors.New("missing diff file")
			}
			return []string{
				"diff",
				"--no-index",
				"--patch",
				"--no-ext-diff",
				"--binary",
				fullContextArg,
				"--",
				"/dev/null",
				pathspecs[0],
			}, []int{1}, nil
		}
		args, err := workspacePatchArgs(section)
		if err != nil {
			return nil, nil, err
		}
		args = append(args, fullContextArg)
		if len(pathspecs) > 0 {
			args = append(args, "--")
			args = append(args, pathspecs...)
		}
		return args, nil, nil
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
			fullContextArg,
			commit,
		}
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
			fullContextArg,
			baseRef + "..." + targetRef,
		}
		if len(pathspecs) > 0 {
			args = append(args, "--")
			args = append(args, pathspecs...)
		}
		return args, nil, nil
	default:
		return nil, nil, errors.New("invalid source kind")
	}
}

func diffPathspecCandidates(file gitDiffFileRef) []string {
	return []string{
		strings.TrimSpace(file.Path),
		strings.TrimSpace(file.OldPath),
		strings.TrimSpace(file.NewPath),
	}
}

func findFullContextDiffEntry(entries []gitDiffEntryData, file gitDiffFileRef) (gitDiffEntryData, bool) {
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
