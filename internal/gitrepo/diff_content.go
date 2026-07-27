package gitrepo

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/floegence/redeven/internal/gitruntime"
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
	stashSection := ""
	if strings.TrimSpace(req.SourceKind) == "stash" {
		stashSection, err = s.resolveRequestedStashSection(ctx, repo.repoRootReal, req.StashID, req.StashSection, req.File)
		if err != nil {
			return nil, err
		}
		req.StashSection = stashSection
	}

	args, allowedExitCodes, presentation, err := s.buildDiffContentArgs(ctx, repo, req, pathspecs, mode)
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

	file := entry.toDiffFileContent()
	file.StashSection = stashSection
	resp := &getDiffContentResp{
		RepoRootPath: repo.repoRootReal,
		Mode:         mode,
		Presentation: presentation,
		File:         file,
	}
	fitDiffContentResponse(resp, 700<<10)
	return resp, nil
}

func fitDiffContentResponse(resp *getDiffContentResp, maxEncodedBytes int) {
	if resp == nil || maxEncodedBytes <= 0 {
		return
	}
	if _, err := gitruntime.JSONEncodedSize(resp, maxEncodedBytes); err == nil {
		return
	}
	patch := resp.File.PatchText
	low, high := 0, len(patch)
	for low < high {
		mid := low + (high-low+1)/2
		resp.File.PatchText = patch[:mid]
		resp.File.PatchTruncated = true
		if _, encodeErr := gitruntime.JSONEncodedSize(resp, maxEncodedBytes); encodeErr == nil {
			low = mid
		} else {
			high = mid - 1
		}
	}
	for low > 0 && !utf8.ValidString(patch[:low]) {
		low--
	}
	resp.File.PatchText = patch[:low]
	resp.File.PatchTruncated = true
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

func (s *Service) buildDiffContentArgs(ctx context.Context, repo repoContext, req getDiffContentReq, pathspecs []string, mode string) ([]string, []int, gitCommitDiffPresentation, error) {
	unifiedArg := ""
	if mode == "full" {
		unifiedArg = "--unified=" + strconv.Itoa(fullContextGitUnifiedLines)
	}

	switch strings.TrimSpace(req.SourceKind) {
	case "workspace":
		args, allowedExitCodes, err := buildWorkspaceDiffContentArgs(req.WorkspaceSection, pathspecs, unifiedArg)
		return args, allowedExitCodes, gitCommitDiffPresentation{}, err
	case "commit":
		commit := strings.TrimSpace(req.Commit)
		if commit == "" {
			return nil, nil, gitCommitDiffPresentation{}, errors.New("missing commit")
		}
		presentation, err := s.readCommitDiffPresentation(ctx, repo.repoRootReal, commit)
		if err != nil {
			return nil, nil, gitCommitDiffPresentation{}, err
		}
		return buildCommitDiffPatchArgs(commit, pathspecs, unifiedArg, presentation), nil, presentation, nil
	case "compare":
		baseRef, err := normalizeGitRef(req.BaseRef)
		if err != nil {
			return nil, nil, gitCommitDiffPresentation{}, err
		}
		targetRef, err := normalizeGitRef(req.TargetRef)
		if err != nil {
			return nil, nil, gitCommitDiffPresentation{}, err
		}
		args := []string{
			"--literal-pathspecs",
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
		return args, nil, gitCommitDiffPresentation{}, nil
	case "stash":
		stashID := strings.TrimSpace(req.StashID)
		if stashID == "" {
			return nil, nil, gitCommitDiffPresentation{}, errors.New("missing stash id")
		}
		baseRef, targetRef, err := stashSectionDiffRefs(stashID, req.StashSection)
		if err != nil {
			return nil, nil, gitCommitDiffPresentation{}, err
		}
		args := []string{
			"--literal-pathspecs",
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
		args = append(args, baseRef, targetRef, "--")
		args = append(args, pathspecs...)
		return args, nil, gitCommitDiffPresentation{}, nil
	default:
		return nil, nil, gitCommitDiffPresentation{}, errors.New("invalid source kind")
	}
}

const emptyGitTreeOID = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

func stashSectionDiffRefs(stashID string, section string) (string, string, error) {
	switch strings.TrimSpace(section) {
	case "staged":
		return stashID + "^1", stashID + "^2", nil
	case "unstaged":
		return stashID + "^2", stashID, nil
	case "untracked":
		return emptyGitTreeOID, stashID + "^3", nil
	default:
		return "", "", errors.New("invalid stash section")
	}
}

func (s *Service) resolveRequestedStashSection(ctx context.Context, repoRoot string, stashID string, requestedSection string, file gitDiffFileRef) (string, error) {
	switch strings.TrimSpace(requestedSection) {
	case "staged", "unstaged", "untracked":
		return strings.TrimSpace(requestedSection), nil
	case "":
	default:
		return "", errors.New("invalid stash section")
	}
	files, err := s.readStashFiles(ctx, repoRoot, strings.TrimSpace(stashID))
	if err != nil {
		return "", err
	}
	sections := make(map[string]struct{}, 3)
	requestKeys := nonEmptyDiffMatchKeys(file.Path, file.OldPath, file.NewPath)
	for _, item := range files {
		itemKeys := nonEmptyDiffMatchKeys(item.Path, item.OldPath, item.NewPath, item.DisplayPath)
		if diffMatchKeysOverlap(requestKeys, itemKeys) {
			sections[item.StashSection] = struct{}{}
		}
	}
	if len(sections) == 0 {
		return "", errors.New("file not found in diff")
	}
	if len(sections) != 1 {
		return "", errors.New("ambiguous stash section")
	}
	for section := range sections {
		return section, nil
	}
	return "", errors.New("file not found in diff")
}

func diffMatchKeysOverlap(left []string, right []string) bool {
	for _, leftValue := range left {
		for _, rightValue := range right {
			if leftValue == rightValue {
				return true
			}
		}
	}
	return false
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
			"--literal-pathspecs",
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
		"--literal-pathspecs",
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
		file.Path,
		file.OldPath,
		file.NewPath,
	}
}

func findDiffContentEntry(entries []gitDiffEntryData, file gitDiffFileRef) (gitDiffEntryData, bool) {
	requestOld := file.OldPath
	requestNew := file.NewPath
	if requestOld != "" && requestNew != "" {
		for _, entry := range entries {
			if requestOld == entry.OldPath && requestNew == entry.NewPath {
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
