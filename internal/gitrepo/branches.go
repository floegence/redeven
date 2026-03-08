package gitrepo

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/floegence/redeven-agent/internal/gitutil"
)

const (
	defaultBranchCompareLimit = 30
	maxBranchCompareLimit     = 100
)

type worktreeBinding struct {
	Ref  string
	Path string
}

func (s *Service) listBranches(ctx context.Context, repo repoContext) (*listBranchesResp, error) {
	bindings, _ := readWorktreeBindings(ctx, repo.repoRootReal)
	format := strings.Join([]string{
		"%(refname)",
		"%(refname:short)",
		"%(objectname)",
		"%(committerdate:unix)",
		"%(authorname)",
		"%(contents:subject)",
		"%(upstream:short)",
		"%(upstream:track)",
	}, "%00") + "%1e"
	out, err := gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil,
		"for-each-ref",
		"--sort=-committerdate",
		"--format="+format,
		"refs/heads",
		"refs/remotes",
	)
	if err != nil {
		return nil, err
	}
	local, remote := parseBranchListOutput(out, repo, bindings)
	return &listBranchesResp{
		RepoRootPath: repo.repoRootVirtual,
		CurrentRef:   repo.headRef,
		Detached:     repo.headRef == "HEAD" || repo.headRef == "",
		Local:        local,
		Remote:       remote,
	}, nil
}

func readWorktreeBindings(ctx context.Context, repoRoot string) (map[string]worktreeBinding, error) {
	out, err := gitutil.RunCombinedOutput(ctx, repoRoot, nil, "worktree", "list", "--porcelain")
	if err != nil {
		return nil, err
	}
	blocks := strings.Split(strings.TrimSpace(string(out)), "\n\n")
	result := make(map[string]worktreeBinding, len(blocks))
	for _, block := range blocks {
		if strings.TrimSpace(block) == "" {
			continue
		}
		lines := strings.Split(block, "\n")
		pathValue := ""
		refValue := ""
		for _, line := range lines {
			line = strings.TrimSpace(line)
			switch {
			case strings.HasPrefix(line, "worktree "):
				pathValue = strings.TrimSpace(strings.TrimPrefix(line, "worktree "))
			case strings.HasPrefix(line, "branch "):
				refValue = strings.TrimSpace(strings.TrimPrefix(line, "branch "))
			}
		}
		if refValue == "" || pathValue == "" {
			continue
		}
		result[refValue] = worktreeBinding{Ref: refValue, Path: pathValue}
	}
	return result, nil
}

func parseBranchListOutput(out []byte, repo repoContext, bindings map[string]worktreeBinding) ([]gitBranchSummary, []gitBranchSummary) {
	records := strings.Split(string(out), "\x1e")
	local := make([]gitBranchSummary, 0, len(records))
	remote := make([]gitBranchSummary, 0, len(records))
	for _, record := range records {
		record = strings.TrimSpace(record)
		if record == "" {
			continue
		}
		fields := strings.Split(record, "\x00")
		if len(fields) < 8 {
			continue
		}
		fullName := strings.TrimSpace(fields[0])
		shortName := strings.TrimSpace(fields[1])
		if fullName == "" || shortName == "" || strings.HasSuffix(fullName, "/HEAD") {
			continue
		}
		authorTimeUnix, _ := strconv.ParseInt(strings.TrimSpace(fields[3]), 10, 64)
		aheadCount, behindCount, upstreamGone := parseBranchTrack(strings.TrimSpace(fields[7]))
		summary := gitBranchSummary{
			Name:         shortName,
			FullName:     fullName,
			HeadCommit:   strings.TrimSpace(fields[2]),
			AuthorName:   strings.TrimSpace(fields[4]),
			AuthorTimeMs: authorTimeUnix * 1000,
			Subject:      strings.TrimSpace(fields[5]),
			UpstreamRef:  strings.TrimSpace(fields[6]),
			AheadCount:   aheadCount,
			BehindCount:  behindCount,
			UpstreamGone: upstreamGone,
			Current:      shortName == repo.headRef || fullName == "refs/heads/"+repo.headRef,
		}
		if binding, ok := bindings[fullName]; ok {
			summary.WorktreePath = binding.Path
		}
		if strings.HasPrefix(fullName, "refs/remotes/") {
			summary.Kind = "remote"
			remote = append(remote, summary)
			continue
		}
		summary.Kind = "local"
		local = append(local, summary)
	}
	return local, remote
}

func parseBranchTrack(raw string) (int, int, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, 0, false
	}
	raw = strings.TrimPrefix(raw, "[")
	raw = strings.TrimSuffix(raw, "]")
	if strings.EqualFold(raw, "gone") {
		return 0, 0, true
	}
	parts := strings.Split(raw, ",")
	ahead := 0
	behind := 0
	for _, part := range parts {
		part = strings.TrimSpace(part)
		switch {
		case strings.HasPrefix(part, "ahead "):
			ahead, _ = strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(part, "ahead ")))
		case strings.HasPrefix(part, "behind "):
			behind, _ = strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(part, "behind ")))
		}
	}
	return ahead, behind, false
}

func (s *Service) getBranchCompare(ctx context.Context, repo repoContext, baseRef string, targetRef string, limit int) (*getBranchCompareResp, error) {
	baseRef, err := normalizeGitRef(baseRef)
	if err != nil {
		return nil, err
	}
	targetRef, err = normalizeGitRef(targetRef)
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = defaultBranchCompareLimit
	}
	if limit > maxBranchCompareLimit {
		limit = maxBranchCompareLimit
	}
	mergeBase := strings.TrimSpace(readGitOptional(ctx, repo.repoRootReal, "merge-base", baseRef, targetRef))
	targetAhead, targetBehind := readSymmetricAheadBehind(ctx, repo.repoRootReal, baseRef, targetRef)
	commits, _, _, err := s.listCommits(ctx, repo, baseRef+".."+targetRef, 0, limit)
	if err != nil {
		return nil, err
	}
	compareRef := baseRef + "..." + targetRef
	entries, err := s.readGitDiffEntries(ctx, repo.repoRootReal,
		"diff",
		"--patch",
		"--find-renames",
		"--find-copies",
		"--no-ext-diff",
		"--binary",
		compareRef,
	)
	if err != nil {
		return nil, err
	}
	files := make([]gitCommitFileSummary, 0, len(entries))
	for _, entry := range entries {
		files = append(files, entry.toCommitFileSummary())
	}
	return &getBranchCompareResp{
		RepoRootPath:      repo.repoRootVirtual,
		BaseRef:           baseRef,
		TargetRef:         targetRef,
		MergeBase:         mergeBase,
		TargetAheadCount:  targetAhead,
		TargetBehindCount: targetBehind,
		Commits:           commits,
		Files:             files,
	}, nil
}

func readSymmetricAheadBehind(ctx context.Context, repoRoot string, baseRef string, targetRef string) (int, int) {
	out := strings.TrimSpace(readGitOptional(ctx, repoRoot, "rev-list", "--left-right", "--count", baseRef+"..."+targetRef))
	if out == "" {
		return 0, 0
	}
	parts := strings.Fields(out)
	if len(parts) < 2 {
		return 0, 0
	}
	left, _ := strconv.Atoi(parts[0])
	right, _ := strconv.Atoi(parts[1])
	return right, left
}

func normalizeGitRef(raw string) (string, error) {
	ref := strings.TrimSpace(raw)
	if ref == "" {
		return "", errors.New("missing ref")
	}
	if strings.HasPrefix(ref, "-") || strings.ContainsAny(ref, "\r\n") {
		return "", errors.New("invalid ref")
	}
	return ref, nil
}

func normalizeGitRefOrDefault(raw string, fallback string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	return normalizeGitRef(raw)
}
