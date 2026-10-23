package ai

import (
	"fmt"
	"strings"
)

// Diagnostics explain rejected input; they never select a replacement location.
type patchDiagnostic struct {
	reason, message, fix         string
	chunk, patchLine, sourceLine int
	searchLine                   int
}

func (d *patchDiagnostic) Error() string {
	if d.chunk > 0 {
		return fmt.Sprintf("chunk %d (patch body line %d): %s; %s", d.chunk, d.patchLine, d.message, d.fix)
	}
	return d.message + "; " + d.fix
}

type patchMatchedRange struct{ start, end int }

func diagnosePatchContext(lines, pattern []string, h unifiedDiffHunk, chunk, start int, anchor bool, matched []patchMatchedRange) *patchDiagnostic {
	kind := "expected context"
	if anchor {
		kind = "context anchor"
	}
	d := &patchDiagnostic{
		reason: "context_not_found", chunk: chunk, patchLine: h.sourceLine, searchLine: start + 1,
		message: fmt.Sprintf("%s was not found in the remaining original file starting at line %d: %q", kind, start+1, boundedPatchContext(strings.Join(pattern, "\n"))),
		fix:     "read the current file and regenerate the patch using its current text",
	}
	// Only exact source evidence refines the diagnosis. Never guess which repeated
	// or normalized occurrence the model intended, and never apply this search.
	first, count := -1, 0
	for pos := 0; pos+len(pattern) <= len(lines); pos++ {
		equal := len(pattern) > 0
		for i, line := range pattern {
			if lines[pos+i] != line {
				equal = false
				break
			}
		}
		if equal {
			count++
			if first < 0 {
				first = pos
			}
			if count == 2 {
				break
			}
		}
	}
	if count == 0 {
		return d
	}
	d.sourceLine = first + 1
	if count > 1 {
		d.reason = "context_before_cursor"
		d.message = fmt.Sprintf("%s has multiple exact occurrences, first at original line %d, but none satisfies the current search boundary at line %d", kind, first+1, start+1)
		d.fix = "read the current file, add unique context, and keep non-overlapping chunks in original file order; verify any anchor and EOF marker"
		return d
	}
	for _, previous := range matched {
		if first < previous.end && first+len(pattern) > previous.start {
			d.reason = "overlapping_context"
			d.message = fmt.Sprintf("%s at original line %d overlaps a previous chunk; the next search starts at line %d", kind, first+1, start+1)
			d.fix = "combine overlapping edits and their shared context into one chunk using the original file text"
			return d
		}
	}
	if h.endOfFile && !anchor && first+len(pattern) != len(lines) {
		d.reason = "eof_context_mismatch"
		d.message = fmt.Sprintf("%s exists at original line %d but does not end at EOF (line %d); the EOF search starts at line %d", kind, first+1, len(lines), start+1)
		d.fix = "read the file tail and correct the *** End of File marker or its context"
		return d
	}
	d.reason = "out_of_order"
	d.message = fmt.Sprintf("%s exists at original line %d, before the next search at line %d", kind, first+1, start+1)
	d.fix = "reorder chunks in original file order, from top to bottom, without overlapping context"
	if h.anchor != "" && !anchor {
		d.reason = "before_anchor"
		d.fix = "choose a context anchor before the intended edit and keep chunks in original file order"
	}
	return d
}

func duplicatePatchOperation(path string) *patchDiagnostic {
	return &patchDiagnostic{
		reason:  "duplicate_file_operation",
		message: fmt.Sprintf("patch touches %s in more than one file operation", path),
		fix:     "use one operation per canonical file; combine updates under one *** Update File: header with non-overlapping chunks in original file order",
	}
}
