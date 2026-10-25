package ai

import (
	"fmt"
	"slices"
	"strings"
)

// Unchanged lines retain their endings; inserted lines use the first existing
// ending (LF for new files). All matching reads the original file.
type patchSourceLine struct{ text, ending string }

func splitPatchSource(original string) ([]patchSourceLine, string) {
	var lines []patchSourceLine
	preferred := ""
	start := 0
	for i := 0; i < len(original); i++ {
		if original[i] != '\n' && original[i] != '\r' {
			continue
		}
		end := i + 1
		if original[i] == '\r' && end < len(original) && original[end] == '\n' {
			end++
		}
		ending := original[i:end]
		if preferred == "" {
			preferred = ending
		}
		lines = append(lines, patchSourceLine{original[start:i], ending})
		start = end
		i = end - 1
	}
	if start < len(original) {
		lines = append(lines, patchSourceLine{text: original[start:]})
	}
	if preferred == "" {
		preferred = "\n"
	}
	return lines, preferred
}

func applyUnifiedDiffHunksToBytes(original []byte, hunks []unifiedDiffHunk) ([]byte, error) {
	source, ending := splitPatchSource(string(original))
	lines := make([]string, len(source))
	for i, line := range source {
		lines[i] = line.text
	}
	result, err := applyOrderedPatchHunks(source, lines, ending, hunks)
	diagnostic, ok := err.(*patchDiagnostic)
	if !ok || diagnostic.reason != "out_of_order" {
		return result, err
	}
	ordered, ambiguousChunk := orderUniquePatchHunks(lines, hunks)
	if ordered == nil {
		if ambiguousChunk > 0 {
			diagnostic.message += fmt.Sprintf("; automatic reordering is unsafe: chunk %d has multiple exact matches", ambiguousChunk)
			diagnostic.fix = fmt.Sprintf("add unique context to chunk %d and keep non-overlapping chunks in original file order", ambiguousChunk)
		}
		return nil, err
	}
	return applyOrderedPatchHunks(source, lines, ending, ordered)
}

// Reorder only ordinary chunks with one exact, disjoint original-source match
// each. Explicit anchors, ranges, EOF and pure additions keep their order rules.
// A nil result rejects reordering; a positive index identifies an ambiguous chunk.
func orderUniquePatchHunks(lines []string, hunks []unifiedDiffHunk) ([]unifiedDiffHunk, int) {
	type locatedHunk struct {
		hunk       unifiedDiffHunk
		start, end int
	}
	located := make([]locatedHunk, 0, len(hunks))
	for index, h := range hunks {
		if h.anchor != "" || h.hasRange || h.endOfFile {
			return nil, 0
		}
		old := patchOldLines(h)
		start, count := exactPatchSequenceMatches(lines, old)
		if count > 1 {
			return nil, index + 1
		}
		if count != 1 {
			return nil, 0
		}
		located = append(located, locatedHunk{h, start, start + len(old)})
	}
	slices.SortFunc(located, func(a, b locatedHunk) int { return a.start - b.start })
	ordered := make([]unifiedDiffHunk, len(located))
	for i, match := range located {
		if i > 0 && match.start < located[i-1].end {
			return nil, 0
		}
		ordered[i] = match.hunk
	}
	return ordered, 0
}

func applyOrderedPatchHunks(source []patchSourceLine, lines []string, ending string, hunks []unifiedDiffHunk) ([]byte, error) {
	var output []patchSourceLine
	var matched []patchMatchedRange
	cursor := 0
	for index, h := range hunks {
		start := cursor
		fail := func(reason string) ([]byte, error) {
			return nil, fmt.Errorf("chunk %d (patch body line %d): %s; read the current file and regenerate the patch", index+1, h.sourceLine, reason)
		}
		if h.anchor != "" {
			found, ok := findPatchSequence(lines, []string{h.anchor}, cursor, cursor, len(lines)-1)
			if !ok {
				return nil, diagnosePatchContext(lines, []string{h.anchor}, h, index+1, cursor, true, matched)
			}
			start = found.start + 1
		}
		old := patchOldLines(h)
		var match hunkMatchResult
		if len(old) == 0 {
			match.start = len(lines)
			if h.hasRange {
				match.start = h.oldStart
				if match.start < start || match.start > len(lines) {
					return fail("insertion range is outside the remaining original file")
				}
			}
			if h.endOfFile {
				match.start = len(lines)
			}
		} else {
			end := len(lines) - len(old)
			preferred := start
			if h.hasRange {
				preferred = h.oldStart - 1
			}
			if h.endOfFile {
				if end < start {
					return nil, diagnosePatchContext(lines, old, h, index+1, start, false, matched)
				}
				start = end
				preferred = end
			}
			var ok bool
			match, ok = findPatchSequence(lines, old, start, preferred, end)

			if !ok {
				return nil, diagnosePatchContext(lines, old, h, index+1, start, false, matched)
			}
		}
		if len(old) > 0 {
			matched = append(matched, patchMatchedRange{match.start, match.start + len(old)})
		}
		output = append(output, source[cursor:match.start]...)
		cursor = match.start
		for _, line := range h.lines {
			if line == "" {
				continue
			}
			switch line[0] {
			case ' ':
				output = append(output, source[cursor])
				cursor++
			case '-':
				cursor++
			case '+':
				output = append(output, patchSourceLine{text: line[1:], ending: ending})
			case '\\':
				// Keep the established apply_patch convention: nonempty updates end with
				// the preferred newline, including originally unterminated final lines.
			default:
				return fail(fmt.Sprintf("invalid line %q", line))
			}
		}
	}
	output = append(output, source[cursor:]...)
	var out strings.Builder
	for _, line := range output {
		out.WriteString(line.text)
		if line.ending == "" {
			out.WriteString(ending)
		} else {
			out.WriteString(line.ending)
		}
	}
	return []byte(out.String()), nil
}

func boundedPatchContext(s string) string {
	r := []rune(s)
	if len(r) > 400 {
		return string(r[:400]) + "…"
	}
	return s
}

func patchOldLines(h unifiedDiffHunk) []string {
	var old []string
	for _, line := range h.lines {
		if len(line) > 0 && (line[0] == ' ' || line[0] == '-') {
			old = append(old, line[1:])
		}
	}
	return old
}

// Two matches suffice to establish ambiguity; empty patterns have no location.
func exactPatchSequenceMatches(lines, pattern []string) (first, count int) {
	first = -1
	if len(pattern) == 0 {
		return first, 0
	}
	for pos := 0; pos+len(pattern) <= len(lines); pos++ {
		if slices.Equal(lines[pos:pos+len(pattern)], pattern) {
			if count == 0 {
				first = pos
			}
			count++
			if count == 2 {
				break
			}
		}
	}
	return first, count
}

func findPatchSequence(lines, pattern []string, start, preferred, end int) (hunkMatchResult, bool) {
	if start < 0 || end < start || end > len(lines)-len(pattern) {
		return hunkMatchResult{}, false
	}
	if preferred < start {
		preferred = start
	}
	if preferred > end {
		preferred = end
	}
	for _, mode := range orderedHunkMatchModes {
		matches := func(pos int) bool {
			for i, line := range pattern {
				if !comparePatchLine(mode, lines[pos+i], line) {
					return false
				}
			}
			return true
		}
		for pos := preferred; pos <= end; pos++ {
			if matches(pos) {
				return hunkMatchResult{pos, mode}, true
			}
		}
		for pos := start; pos < preferred; pos++ {
			if matches(pos) {
				return hunkMatchResult{pos, mode}, true
			}
		}
	}
	return hunkMatchResult{}, false
}
