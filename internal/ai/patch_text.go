package ai

import (
	"fmt"
	"strings"
)

// Matching reads the original file and moves forward. Unchanged lines retain
// their endings; inserted lines use the first existing ending (LF for new files).
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
