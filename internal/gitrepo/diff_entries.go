package gitrepo

import (
	"context"
	"errors"
	"io"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/floegence/redeven/internal/gitruntime"
)

const (
	embeddedGitDiffEntryMaxBytes    = 256 * 1024
	fullContextGitDiffEntryMaxBytes = 640 * 1024
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

func (entry gitDiffEntryData) toDiffFileSummary() gitDiffFileSummary {
	return gitDiffFileSummary{
		ChangeType:  entry.ChangeType,
		Path:        entry.Path,
		OldPath:     entry.OldPath,
		NewPath:     entry.NewPath,
		DisplayPath: entry.DisplayPath,
		Additions:   entry.Additions,
		Deletions:   entry.Deletions,
		IsBinary:    entry.IsBinary,
	}
}

func (entry gitDiffEntryData) toDiffFileContent() gitDiffFileContent {
	return gitDiffFileContent{
		gitDiffFileSummary: entry.toDiffFileSummary(),
		PatchText:          entry.PatchText,
		PatchTruncated:     entry.PatchTruncated,
	}
}

func (s *Service) readGitDiffEntriesWithLimit(ctx context.Context, repoRoot string, maxBytes int, allowedExitCodes []int, args ...string) ([]gitDiffEntryData, []byte, error) {
	collector := newBoundedDiffPrefix(maxBytes)
	result, err := s.runtime.StreamRead(ctx, repoRoot, nil, collector.consume, args...)
	if err != nil && !allowedGitStreamExit(err, allowedExitCodes) {
		return nil, nil, err
	}
	for collector.truncated && len(collector.data) > 0 && !utf8.Valid(collector.data) {
		collector.data = collector.data[:len(collector.data)-1]
	}
	entries := parseGitDiffEntriesWithLimit(collector.data, maxBytes)
	if collector.truncated {
		for index := range entries {
			entries[index].PatchTruncated = true
		}
	}
	return entries, result.Stdout, nil
}

type boundedDiffPrefix struct {
	data      []byte
	limit     int
	truncated bool
}

func newBoundedDiffPrefix(limit int) *boundedDiffPrefix {
	if limit < 0 {
		limit = 0
	}
	if limit > fullContextGitDiffEntryMaxBytes {
		limit = fullContextGitDiffEntryMaxBytes
	}
	return &boundedDiffPrefix{data: make([]byte, 0, min(limit, 64<<10)), limit: limit}
}

func (c *boundedDiffPrefix) consume(reader io.Reader) error {
	buffer := make([]byte, 32<<10)
	for {
		n, err := reader.Read(buffer)
		if n > 0 {
			remaining := c.limit - len(c.data)
			if remaining > 0 {
				keep := min(n, remaining)
				c.data = append(c.data, buffer[:keep]...)
				if keep != n {
					c.truncated = true
				}
			} else {
				c.truncated = true
			}
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

func allowedGitStreamExit(err error, allowed []int) bool {
	var commandErr *gitruntime.CommandError
	if !errors.As(err, &commandErr) || commandErr.UnknownOutcome || commandErr.BudgetExceeded {
		return false
	}
	for _, code := range allowed {
		if commandErr.ExitCode == code {
			return true
		}
	}
	return false
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
	sections := make([]string, 0, 8)
	sectionStart := -1
	for lineStart := 0; lineStart <= len(normalized); {
		lineEnd := strings.IndexByte(normalized[lineStart:], '\n')
		if lineEnd < 0 {
			lineEnd = len(normalized)
		} else {
			lineEnd += lineStart
		}
		line := normalized[lineStart:lineEnd]
		if isGitDiffSectionStart(line) {
			if sectionStart >= 0 {
				sections = append(sections, strings.TrimRight(normalized[sectionStart:lineStart], "\n"))
			}
			sectionStart = lineStart
		}
		if lineEnd == len(normalized) {
			break
		}
		lineStart = lineEnd + 1
	}
	if sectionStart >= 0 {
		sections = append(sections, strings.TrimRight(normalized[sectionStart:], "\n"))
	}
	return sections
}

func isGitDiffSectionStart(line string) bool {
	return strings.HasPrefix(line, "diff --git ") ||
		strings.HasPrefix(line, "diff --cc ") ||
		strings.HasPrefix(line, "diff --combined ")
}

func parseGitDiffEntryWithLimit(section string, maxBytes int) gitDiffEntryData {
	normalized := strings.ReplaceAll(section, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	entry := gitDiffEntryData{ChangeType: "modified"}
	if normalized == "" {
		return entry
	}

	firstLine := true
	for lineStart := 0; lineStart <= len(normalized); {
		lineEnd := strings.IndexByte(normalized[lineStart:], '\n')
		if lineEnd < 0 {
			lineEnd = len(normalized)
		} else {
			lineEnd += lineStart
		}
		line := normalized[lineStart:lineEnd]
		if firstLine {
			entry.OldPath, entry.NewPath = parseGitDiffHeaderPaths(line)
			entry.Path = preferredDiffPath(entry.ChangeType, entry.OldPath, entry.NewPath)
			firstLine = false
			if lineEnd == len(normalized) {
				break
			}
			lineStart = lineEnd + 1
			continue
		}

		switch {
		case strings.HasPrefix(line, "rename from "):
			entry.ChangeType = "renamed"
			entry.OldPath = normalizeGitMetadataPath(strings.TrimPrefix(line, "rename from "))
		case strings.HasPrefix(line, "rename to "):
			entry.ChangeType = "renamed"
			entry.NewPath = normalizeGitMetadataPath(strings.TrimPrefix(line, "rename to "))
		case strings.HasPrefix(line, "copy from "):
			entry.ChangeType = "copied"
			entry.OldPath = normalizeGitMetadataPath(strings.TrimPrefix(line, "copy from "))
		case strings.HasPrefix(line, "copy to "):
			entry.ChangeType = "copied"
			entry.NewPath = normalizeGitMetadataPath(strings.TrimPrefix(line, "copy to "))
		case strings.HasPrefix(line, "new file mode "):
			entry.ChangeType = "added"
		case strings.HasPrefix(line, "deleted file mode "):
			entry.ChangeType = "deleted"
		case strings.HasPrefix(line, "--- "):
			oldPath := normalizeGitPatchMarkerPath(strings.TrimPrefix(line, "--- "))
			if oldPath != "" {
				entry.OldPath = oldPath
			}
		case strings.HasPrefix(line, "+++ "):
			newPath := normalizeGitPatchMarkerPath(strings.TrimPrefix(line, "+++ "))
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
		if lineEnd == len(normalized) {
			break
		}
		lineStart = lineEnd + 1
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
		rest = strings.TrimPrefix(line, "diff --git ")
	case strings.HasPrefix(line, "diff --cc "):
		pathValue := normalizeGitMetadataPath(strings.TrimPrefix(line, "diff --cc "))
		return pathValue, pathValue
	case strings.HasPrefix(line, "diff --combined "):
		pathValue := normalizeGitMetadataPath(strings.TrimPrefix(line, "diff --combined "))
		return pathValue, pathValue
	default:
		return "", ""
	}
	if oldPath, newPath, ok := splitUnquotedGitDiffPaths(rest); ok {
		return normalizeGitPatchMarkerPath(oldPath), normalizeGitPatchMarkerPath(newPath)
	}
	parts := scanGitHeaderPathTokens(rest, 2)
	if len(parts) < 2 {
		return "", ""
	}
	return normalizeGitPatchMarkerPath(parts[0]), normalizeGitPatchMarkerPath(parts[1])
}

func splitUnquotedGitDiffPaths(raw string) (string, string, bool) {
	if !strings.HasPrefix(raw, "a/") || strings.HasPrefix(raw, "\"") {
		return "", "", false
	}
	fallback := -1
	for searchStart := 0; searchStart < len(raw); {
		relative := strings.Index(raw[searchStart:], " b/")
		if relative < 0 {
			break
		}
		separator := searchStart + relative
		if fallback < 0 {
			fallback = separator
		}
		oldPath := raw[:separator]
		newPath := raw[separator+1:]
		if strings.TrimPrefix(oldPath, "a/") == strings.TrimPrefix(newPath, "b/") {
			return oldPath, newPath, true
		}
		searchStart = separator + 1
	}
	if fallback < 0 {
		return "", "", false
	}
	return raw[:fallback], raw[fallback+1:], true
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
	value := strings.TrimSuffix(raw, "\t")
	if value == "" || value == "/dev/null" {
		return ""
	}
	if unquoted, err := strconv.Unquote(value); err == nil {
		value = unquoted
	}
	value = strings.TrimPrefix(value, "a/")
	value = strings.TrimPrefix(value, "b/")
	return value
}

func normalizeGitMetadataPath(raw string) string {
	if unquoted, err := strconv.Unquote(raw); err == nil {
		return unquoted
	}
	return raw
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
	if pathValue != "" {
		return pathValue
	}
	if newPath != "" {
		return newPath
	}
	return oldPath
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
