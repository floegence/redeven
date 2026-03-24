package gitrepo

import (
	"context"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/floegence/redeven-agent/internal/gitutil"
)

const (
	embeddedGitDiffEntryMaxBytes    = 256 * 1024
	fullContextGitDiffEntryMaxBytes = 4 * 1024 * 1024
)

type gitDiffEntryData struct {
	ChangeType     string
	Path           string
	OldPath        string
	NewPath        string
	DisplayPath    string
	Additions      int
	Deletions      int
	IsBinary       bool
	PatchText      string
	PatchTruncated bool
}

func (entry gitDiffEntryData) toCommitFileSummary() gitCommitFileSummary {
	return gitCommitFileSummary{
		ChangeType:     entry.ChangeType,
		Path:           entry.Path,
		OldPath:        entry.OldPath,
		NewPath:        entry.NewPath,
		DisplayPath:    entry.DisplayPath,
		Additions:      entry.Additions,
		Deletions:      entry.Deletions,
		IsBinary:       entry.IsBinary,
		PatchText:      entry.PatchText,
		PatchTruncated: entry.PatchTruncated,
	}
}

func (entry gitDiffEntryData) toWorkspaceChange(section string) gitWorkspaceChange {
	return gitWorkspaceChange{
		Section:        section,
		ChangeType:     entry.ChangeType,
		Path:           entry.Path,
		OldPath:        entry.OldPath,
		NewPath:        entry.NewPath,
		DisplayPath:    entry.DisplayPath,
		Additions:      entry.Additions,
		Deletions:      entry.Deletions,
		IsBinary:       entry.IsBinary,
		PatchText:      entry.PatchText,
		PatchTruncated: entry.PatchTruncated,
	}
}

func (s *Service) readGitDiffEntries(ctx context.Context, repoRoot string, args ...string) ([]gitDiffEntryData, error) {
	entries, _, err := s.readGitDiffEntriesWithAllowedExitCodes(ctx, repoRoot, nil, args...)
	if err != nil {
		return nil, err
	}
	return entries, nil
}

func (s *Service) readGitDiffEntriesWithAllowedExitCodes(ctx context.Context, repoRoot string, allowedExitCodes []int, args ...string) ([]gitDiffEntryData, []byte, error) {
	return s.readGitDiffEntriesWithLimit(ctx, repoRoot, embeddedGitDiffEntryMaxBytes, allowedExitCodes, args...)
}

func (s *Service) readGitDiffEntriesWithLimit(ctx context.Context, repoRoot string, maxBytes int, allowedExitCodes []int, args ...string) ([]gitDiffEntryData, []byte, error) {
	out, err := gitutil.RunCombinedOutputAllowExitCodes(ctx, repoRoot, nil, allowedExitCodes, args...)
	if err != nil {
		return nil, nil, err
	}
	return parseGitDiffEntriesWithLimit(out, maxBytes), out, nil
}

func parseGitDiffEntries(out []byte) []gitDiffEntryData {
	return parseGitDiffEntriesWithLimit(out, embeddedGitDiffEntryMaxBytes)
}

func parseGitDiffEntriesWithLimit(out []byte, maxBytes int) []gitDiffEntryData {
	sections := splitGitDiffSections(string(out))
	entries := make([]gitDiffEntryData, 0, len(sections))
	for _, section := range sections {
		entry := parseGitDiffEntryWithLimit(section, maxBytes)
		if entry.Path == "" && entry.OldPath == "" && entry.NewPath == "" && strings.TrimSpace(entry.PatchText) == "" {
			continue
		}
		entries = append(entries, entry)
	}
	return entries
}

func splitGitDiffSections(raw string) []string {
	normalized := strings.ReplaceAll(raw, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	lines := strings.Split(normalized, "\n")
	sections := make([]string, 0, 8)
	current := make([]string, 0, 32)
	for _, line := range lines {
		if isGitDiffSectionStart(line) {
			if len(current) > 0 {
				sections = append(sections, strings.TrimRight(strings.Join(current, "\n"), "\n"))
			}
			current = []string{line}
			continue
		}
		if len(current) == 0 {
			continue
		}
		current = append(current, line)
	}
	if len(current) > 0 {
		sections = append(sections, strings.TrimRight(strings.Join(current, "\n"), "\n"))
	}
	return sections
}

func isGitDiffSectionStart(line string) bool {
	return strings.HasPrefix(line, "diff --git ") ||
		strings.HasPrefix(line, "diff --cc ") ||
		strings.HasPrefix(line, "diff --combined ")
}

func parseGitDiffEntryWithLimit(section string, maxBytes int) gitDiffEntryData {
	lines := strings.Split(strings.ReplaceAll(strings.ReplaceAll(section, "\r\n", "\n"), "\r", "\n"), "\n")
	entry := gitDiffEntryData{ChangeType: "modified"}
	if len(lines) == 0 {
		return entry
	}

	entry.OldPath, entry.NewPath = parseGitDiffHeaderPaths(lines[0])
	entry.Path = preferredDiffPath(entry.ChangeType, entry.OldPath, entry.NewPath)

	for _, line := range lines[1:] {
		switch {
		case strings.HasPrefix(line, "rename from "):
			entry.ChangeType = "renamed"
			entry.OldPath = strings.TrimSpace(strings.TrimPrefix(line, "rename from "))
		case strings.HasPrefix(line, "rename to "):
			entry.ChangeType = "renamed"
			entry.NewPath = strings.TrimSpace(strings.TrimPrefix(line, "rename to "))
		case strings.HasPrefix(line, "copy from "):
			entry.ChangeType = "copied"
			entry.OldPath = strings.TrimSpace(strings.TrimPrefix(line, "copy from "))
		case strings.HasPrefix(line, "copy to "):
			entry.ChangeType = "copied"
			entry.NewPath = strings.TrimSpace(strings.TrimPrefix(line, "copy to "))
		case strings.HasPrefix(line, "new file mode "):
			entry.ChangeType = "added"
		case strings.HasPrefix(line, "deleted file mode "):
			entry.ChangeType = "deleted"
		case strings.HasPrefix(line, "--- "):
			oldPath := normalizeGitPatchMarkerPath(strings.TrimSpace(strings.TrimPrefix(line, "--- ")))
			if oldPath != "" {
				entry.OldPath = oldPath
			}
		case strings.HasPrefix(line, "+++ "):
			newPath := normalizeGitPatchMarkerPath(strings.TrimSpace(strings.TrimPrefix(line, "+++ ")))
			if newPath != "" {
				entry.NewPath = newPath
			}
		case strings.HasPrefix(line, "Binary files ") || line == "GIT binary patch":
			entry.IsBinary = true
		}
		if strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++") {
			entry.Additions += 1
		}
		if strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---") {
			entry.Deletions += 1
		}
	}

	entry.Path = preferredDiffPath(entry.ChangeType, entry.OldPath, entry.NewPath)
	entry.DisplayPath = preferredDiffDisplayPath(entry.Path, entry.OldPath, entry.NewPath)
	entry.PatchText, entry.PatchTruncated = truncateEmbeddedPatchText(strings.TrimSpace(section), maxBytes)
	return entry
}

func parseGitDiffHeaderPaths(line string) (string, string) {
	rest := ""
	switch {
	case strings.HasPrefix(line, "diff --git "):
		rest = strings.TrimSpace(strings.TrimPrefix(line, "diff --git "))
	case strings.HasPrefix(line, "diff --cc "):
		pathValue := normalizeGitPatchMarkerPath(strings.TrimSpace(strings.TrimPrefix(line, "diff --cc ")))
		return pathValue, pathValue
	case strings.HasPrefix(line, "diff --combined "):
		pathValue := normalizeGitPatchMarkerPath(strings.TrimSpace(strings.TrimPrefix(line, "diff --combined ")))
		return pathValue, pathValue
	default:
		return "", ""
	}
	parts := scanGitHeaderPathTokens(rest, 2)
	if len(parts) < 2 {
		return "", ""
	}
	return normalizeGitPatchMarkerPath(parts[0]), normalizeGitPatchMarkerPath(parts[1])
}

func scanGitHeaderPathTokens(raw string, want int) []string {
	out := make([]string, 0, want)
	for index := 0; index < len(raw) && len(out) < want; {
		for index < len(raw) && raw[index] == ' ' {
			index += 1
		}
		if index >= len(raw) {
			break
		}
		if raw[index] == '"' {
			start := index
			index += 1
			escaped := false
			for index < len(raw) {
				ch := raw[index]
				index += 1
				if escaped {
					escaped = false
					continue
				}
				if ch == '\\' {
					escaped = true
					continue
				}
				if ch == '"' {
					break
				}
			}
			token := raw[start:index]
			if unquoted, err := strconv.Unquote(token); err == nil {
				out = append(out, unquoted)
			} else {
				out = append(out, strings.Trim(token, "\""))
			}
			continue
		}
		start := index
		for index < len(raw) && raw[index] != ' ' {
			index += 1
		}
		out = append(out, raw[start:index])
	}
	return out
}

func normalizeGitPatchMarkerPath(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" || value == "/dev/null" {
		return ""
	}
	if unquoted, err := strconv.Unquote(value); err == nil {
		value = unquoted
	}
	value = strings.TrimPrefix(value, "a/")
	value = strings.TrimPrefix(value, "b/")
	return strings.TrimSpace(value)
}

func preferredDiffPath(changeType string, oldPath string, newPath string) string {
	switch strings.TrimSpace(changeType) {
	case "deleted":
		if oldPath != "" {
			return oldPath
		}
	default:
		if newPath != "" {
			return newPath
		}
	}
	if oldPath != "" {
		return oldPath
	}
	return newPath
}

func preferredDiffDisplayPath(pathValue string, oldPath string, newPath string) string {
	if strings.TrimSpace(pathValue) != "" {
		return strings.TrimSpace(pathValue)
	}
	if strings.TrimSpace(newPath) != "" {
		return strings.TrimSpace(newPath)
	}
	return strings.TrimSpace(oldPath)
}

func truncateEmbeddedPatchText(text string, maxBytes int) (string, bool) {
	if maxBytes <= 0 || len(text) <= maxBytes {
		return text, false
	}
	trimmed := text[:maxBytes]
	for !utf8.ValidString(trimmed) && len(trimmed) > 0 {
		trimmed = trimmed[:len(trimmed)-1]
	}
	return strings.TrimRight(trimmed, "\n"), true
}
