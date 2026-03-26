package gitrepo

import (
	"context"
	"strconv"
	"strings"

	"github.com/floegence/redeven-agent/internal/gitutil"
)

func (s *Service) readGitDiffMetadata(ctx context.Context, repoRoot string, nameStatusArgs []string, numstatArgs []string) ([]gitCommitFileSummary, error) {
	nameEntries, err := s.readGitDiffNameStatusMetadata(ctx, repoRoot, nameStatusArgs...)
	if err != nil {
		return nil, err
	}
	statEntries, err := s.readGitDiffNumstatMetadata(ctx, repoRoot, numstatArgs...)
	if err != nil {
		return nil, err
	}

	statByKey := make(map[string]gitDiffFileSummary, len(statEntries)*4)
	for _, entry := range statEntries {
		for _, key := range diffSummaryMatchKeys(entry) {
			if key == "" {
				continue
			}
			statByKey[key] = entry
		}
	}

	merged := make([]gitCommitFileSummary, 0, maxInt(len(nameEntries), len(statEntries)))
	seen := make(map[string]struct{}, len(nameEntries))
	seenKeys := make(map[string]struct{}, len(nameEntries)*4)
	for _, entry := range nameEntries {
		mergedEntry := entry
		for _, key := range diffSummaryMatchKeys(entry) {
			if key == "" {
				continue
			}
			stat, ok := statByKey[key]
			if !ok {
				continue
			}
			mergedEntry.Additions = stat.Additions
			mergedEntry.Deletions = stat.Deletions
			mergedEntry.IsBinary = stat.IsBinary
			break
		}
		identity := diffSummaryIdentity(mergedEntry)
		if identity != "" {
			seen[identity] = struct{}{}
		}
		for _, key := range diffSummaryMatchKeys(mergedEntry) {
			if key == "" {
				continue
			}
			seenKeys[key] = struct{}{}
		}
		merged = append(merged, gitCommitFileSummary(mergedEntry))
	}

	for _, entry := range statEntries {
		alreadyMerged := false
		for _, key := range diffSummaryMatchKeys(entry) {
			if key == "" {
				continue
			}
			if _, ok := seenKeys[key]; ok {
				alreadyMerged = true
				break
			}
		}
		if alreadyMerged {
			continue
		}
		identity := diffSummaryIdentity(entry)
		if identity != "" {
			if _, ok := seen[identity]; ok {
				continue
			}
		}
		merged = append(merged, gitCommitFileSummary(entry))
	}
	return merged, nil
}

func (s *Service) readGitDiffNameStatusMetadata(ctx context.Context, repoRoot string, args ...string) ([]gitDiffFileSummary, error) {
	return s.readGitDiffNameStatusMetadataWithAllowedExitCodes(ctx, repoRoot, nil, args...)
}

func (s *Service) readGitDiffNameStatusMetadataWithAllowedExitCodes(ctx context.Context, repoRoot string, allowedExitCodes []int, args ...string) ([]gitDiffFileSummary, error) {
	out, err := gitutil.RunCombinedOutputAllowExitCodes(ctx, repoRoot, nil, allowedExitCodes, args...)
	if err != nil {
		return nil, err
	}
	return parseGitNameStatusMetadata(out), nil
}

func (s *Service) readGitDiffNumstatMetadata(ctx context.Context, repoRoot string, args ...string) ([]gitDiffFileSummary, error) {
	return s.readGitDiffNumstatMetadataWithAllowedExitCodes(ctx, repoRoot, nil, args...)
}

func (s *Service) readGitDiffNumstatMetadataWithAllowedExitCodes(ctx context.Context, repoRoot string, allowedExitCodes []int, args ...string) ([]gitDiffFileSummary, error) {
	out, err := gitutil.RunCombinedOutputAllowExitCodes(ctx, repoRoot, nil, allowedExitCodes, args...)
	if err != nil {
		return nil, err
	}
	return parseGitNumstatMetadata(out), nil
}

func parseGitNameStatusMetadata(out []byte) []gitDiffFileSummary {
	tokens := strings.Split(string(out), "\x00")
	items := make([]gitDiffFileSummary, 0, len(tokens)/2)
	for index := 0; index < len(tokens); index += 1 {
		status := strings.TrimSpace(strings.TrimSuffix(tokens[index], "\n"))
		if status == "" {
			continue
		}
		changeKind := byte(status[0])
		switch changeKind {
		case 'R', 'C':
			if index+2 >= len(tokens) {
				break
			}
			oldPath := strings.TrimSpace(strings.TrimSuffix(tokens[index+1], "\n"))
			newPath := strings.TrimSpace(strings.TrimSuffix(tokens[index+2], "\n"))
			index += 2
			items = append(items, gitDiffFileSummary{
				ChangeType:  normalizeNameStatusChangeType(changeKind),
				Path:        firstNonEmptyPath(newPath, oldPath),
				OldPath:     oldPath,
				NewPath:     newPath,
				DisplayPath: firstNonEmptyPath(newPath, oldPath),
			})
		default:
			if index+1 >= len(tokens) {
				break
			}
			pathValue := strings.TrimSpace(strings.TrimSuffix(tokens[index+1], "\n"))
			index += 1
			items = append(items, gitDiffFileSummary{
				ChangeType:  normalizeNameStatusChangeType(changeKind),
				Path:        pathValue,
				DisplayPath: pathValue,
			})
		}
	}
	return items
}

func parseGitNumstatMetadata(out []byte) []gitDiffFileSummary {
	tokens := strings.Split(string(out), "\x00")
	items := make([]gitDiffFileSummary, 0, len(tokens)/2)
	for index := 0; index < len(tokens); index += 1 {
		record := strings.TrimSuffix(tokens[index], "\n")
		record = strings.TrimSpace(record)
		if record == "" {
			continue
		}
		fields := strings.SplitN(record, "\t", 3)
		if len(fields) < 3 {
			continue
		}
		additions, deletions, isBinary := parseNumstatCounts(fields[0], fields[1])
		pathValue := strings.TrimSpace(fields[2])
		oldPath := ""
		newPath := ""
		if pathValue == "" {
			if index+2 >= len(tokens) {
				break
			}
			oldPath = normalizeGitPatchMarkerPath(strings.TrimSpace(strings.TrimSuffix(tokens[index+1], "\n")))
			newPath = normalizeGitPatchMarkerPath(strings.TrimSpace(strings.TrimSuffix(tokens[index+2], "\n")))
			index += 2
			pathValue = firstNonEmptyPath(newPath, oldPath)
		}
		items = append(items, gitDiffFileSummary{
			Path:        pathValue,
			OldPath:     oldPath,
			NewPath:     newPath,
			DisplayPath: firstNonEmptyPath(pathValue, newPath, oldPath),
			Additions:   additions,
			Deletions:   deletions,
			IsBinary:    isBinary,
		})
	}
	return items
}

func parseNumstatCounts(additionsRaw string, deletionsRaw string) (int, int, bool) {
	additionsRaw = strings.TrimSpace(additionsRaw)
	deletionsRaw = strings.TrimSpace(deletionsRaw)
	if additionsRaw == "-" || deletionsRaw == "-" {
		return 0, 0, true
	}
	additions, _ := strconv.Atoi(additionsRaw)
	deletions, _ := strconv.Atoi(deletionsRaw)
	return additions, deletions, false
}

func normalizeNameStatusChangeType(kind byte) string {
	switch kind {
	case 'A':
		return "added"
	case 'D':
		return "deleted"
	case 'R':
		return "renamed"
	case 'C':
		return "copied"
	case 'U':
		return "conflicted"
	default:
		return "modified"
	}
}

func diffSummaryMatchKeys(entry gitDiffFileSummary) []string {
	return []string{
		firstNonEmptyPath(entry.DisplayPath),
		firstNonEmptyPath(entry.Path),
		firstNonEmptyPath(entry.NewPath),
		firstNonEmptyPath(entry.OldPath),
	}
}

func diffSummaryIdentity(entry gitDiffFileSummary) string {
	return strings.Join([]string{
		strings.TrimSpace(entry.ChangeType),
		firstNonEmptyPath(entry.Path),
		firstNonEmptyPath(entry.OldPath),
		firstNonEmptyPath(entry.NewPath),
	}, "\x00")
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
}
