package ai

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/floegence/redeven/internal/filesystemscope"
)

type unifiedDiffHunk struct {
	oldStart   int
	oldCount   int
	newStart   int
	newCount   int
	lines      []string
	anchor     string
	endOfFile  bool
	hasRange   bool
	sourceLine int
}

type unifiedDiffFile struct {
	oldPath string // "/dev/null" or path without a/ prefix
	newPath string // "/dev/null" or path without b/ prefix

	// Preserve submitted paths after canonicalization for commit-time checks.
	oldInput string
	newInput string

	isNew    bool
	isDelete bool

	newPerm *fs.FileMode

	hunks []unifiedDiffHunk
}

var unifiedDiffHunkHeaderRE = regexp.MustCompile(`^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@`)

type patchInputFormat string

const (
	patchInputFormatBeginPatch  patchInputFormat = "begin_patch"
	patchInputFormatUnifiedDiff patchInputFormat = "unified_diff"
)

type hunkMatchMode string

const (
	hunkMatchModeExact              hunkMatchMode = "exact"
	hunkMatchModeTrimEnd            hunkMatchMode = "trim_end"
	hunkMatchModeTrimSpace          hunkMatchMode = "trim_space"
	hunkMatchModeUnicodePunctuation hunkMatchMode = "unicode_punctuation"
)

type hunkMatchResult struct {
	start int
	mode  hunkMatchMode
}

var orderedHunkMatchModes = []hunkMatchMode{
	hunkMatchModeExact,
	hunkMatchModeTrimEnd,
	hunkMatchModeTrimSpace,
	hunkMatchModeUnicodePunctuation,
}

type parsedPatch struct {
	inputFormat      patchInputFormat
	normalizedFormat patchInputFormat
	files            []unifiedDiffFile
	mutations        []FileMutationResult
}

type patchFileSummary struct {
	Path      string `json:"path"`
	OldPath   string `json:"old_path"`
	NewPath   string `json:"new_path"`
	Change    string `json:"change"`
	Hunks     int    `json:"hunks"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}

func normalizePatchText(patchText string) string {
	normalized := strings.ReplaceAll(patchText, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	return normalized
}

func parsePatchText(patchText string) (parsedPatch, error) {
	normalized := normalizePatchText(patchText)
	trimmed := strings.TrimSpace(normalized)
	if strings.HasPrefix(trimmed, "*** Begin Patch") {
		files, err := parseBeginPatch(normalized)
		if err != nil {
			return parsedPatch{}, err
		}
		return parsedPatch{
			inputFormat:      patchInputFormatBeginPatch,
			normalizedFormat: patchInputFormatBeginPatch,
			files:            files,
		}, nil
	}
	files, err := parseUnifiedDiff(normalized)
	if err != nil {
		return parsedPatch{}, err
	}
	return parsedPatch{
		inputFormat:      patchInputFormatUnifiedDiff,
		normalizedFormat: patchInputFormatBeginPatch,
		files:            files,
	}, nil
}

func isBeginPatchHeader(trimmedLine string) bool {
	switch {
	case strings.HasPrefix(trimmedLine, "*** Add File: "):
		return true
	case strings.HasPrefix(trimmedLine, "*** Delete File: "):
		return true
	case strings.HasPrefix(trimmedLine, "*** Update File: "):
		return true
	case trimmedLine == "*** End Patch":
		return true
	default:
		return false
	}
}

func parseBeginPatch(patchText string) ([]unifiedDiffFile, error) {
	lines := strings.Split(normalizePatchText(patchText), "\n")
	i := 0
	for i < len(lines) && strings.TrimSpace(lines[i]) == "" {
		i++
	}
	if i >= len(lines) || strings.TrimSpace(lines[i]) != "*** Begin Patch" {
		return nil, errors.New("unsupported patch format: missing *** Begin Patch header")
	}
	i++

	var out []unifiedDiffFile
	for i < len(lines) {
		trimmed := strings.TrimSpace(lines[i])
		if trimmed == "" {
			i++
			continue
		}
		if trimmed == "*** End Patch" {
			if len(out) == 0 {
				return nil, errors.New("invalid patch: no file operations")
			}
			for _, tail := range lines[i+1:] {
				if strings.TrimSpace(tail) != "" {
					return nil, errors.New("invalid patch: content after *** End Patch")
				}
			}
			return out, nil
		}

		switch {
		case strings.HasPrefix(trimmed, "*** Add File: "):
			newPath := strings.TrimSpace(strings.TrimPrefix(trimmed, "*** Add File: "))
			if newPath == "" {
				return nil, errors.New("invalid add file patch: missing path")
			}
			i++
			var hunkLines []string
			for i < len(lines) {
				if isBeginPatchHeader(lines[i]) {
					break
				}
				if strings.TrimSpace(lines[i]) == "*** End of File" {
					i++
					continue
				}
				if !strings.HasPrefix(lines[i], "+") {
					return nil, fmt.Errorf("invalid add file line: %q; each new content line in an *** Add File body must start with +", lines[i])
				}
				hunkLines = append(hunkLines, lines[i])
				i++
			}
			if len(hunkLines) == 0 {
				return nil, fmt.Errorf("invalid add file patch for %q: empty body", newPath)
			}
			out = append(out, unifiedDiffFile{
				oldPath: "/dev/null",
				newPath: newPath,
				isNew:   true,
				hunks: []unifiedDiffHunk{
					{
						oldStart: 1,
						oldCount: 0,
						newStart: 1,
						newCount: len(hunkLines),
						lines:    hunkLines,
					},
				},
			})

		case strings.HasPrefix(trimmed, "*** Delete File: "):
			oldPath := strings.TrimSpace(strings.TrimPrefix(trimmed, "*** Delete File: "))
			if oldPath == "" {
				return nil, errors.New("invalid delete file patch: missing path")
			}
			out = append(out, unifiedDiffFile{
				oldPath:  oldPath,
				newPath:  "/dev/null",
				isDelete: true,
			})
			i++

		case strings.HasPrefix(trimmed, "*** Update File: "):
			oldPath := strings.TrimSpace(strings.TrimPrefix(trimmed, "*** Update File: "))
			if oldPath == "" {
				return nil, errors.New("invalid update file patch: missing path")
			}
			i++
			newPath := oldPath
			if i < len(lines) {
				moveLine := strings.TrimSpace(lines[i])
				if strings.HasPrefix(moveLine, "*** Move to: ") {
					newPath = strings.TrimSpace(strings.TrimPrefix(moveLine, "*** Move to: "))
					if newPath == "" {
						return nil, errors.New("invalid move target path")
					}
					i++
				}
			}
			body := make([]string, 0, 8)
			for i < len(lines) {
				if isBeginPatchHeader(lines[i]) {
					break
				}
				body = append(body, lines[i])
				i++
			}
			hunks, err := parseBeginPatchUpdateHunks(body)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", oldPath, err)
			}
			out = append(out, unifiedDiffFile{
				oldPath: oldPath,
				newPath: newPath,
				hunks:   hunks,
			})

		default:
			return nil, fmt.Errorf("unsupported patch format line: %q", lines[i])
		}
	}
	return nil, errors.New("invalid patch: missing *** End Patch trailer")
}

func parseBeginPatchUpdateHunks(lines []string) ([]unifiedDiffHunk, error) {
	var hunks []unifiedDiffHunk
	var cur *unifiedDiffHunk
	flush := func() error {
		if cur == nil {
			return nil
		}
		if len(cur.lines) == 0 {
			return fmt.Errorf("invalid empty chunk at patch body line %d", cur.sourceLine)
		}
		hunks = append(hunks, *cur)
		return nil
	}
	for i, line := range lines {
		if line == "*** End of File" {
			if cur == nil || len(cur.lines) == 0 || cur.endOfFile {
				return nil, fmt.Errorf("invalid EOF marker at patch body line %d", i+1)
			}
			cur.endOfFile = true
			continue
		}
		if strings.HasPrefix(line, "@@") {
			if err := flush(); err != nil {
				return nil, err
			}
			next := unifiedDiffHunk{sourceLine: i + 1}
			switch {
			case line == "@@":
			case unifiedDiffHunkHeaderRE.MatchString(line):
				parsed, err := parseUnifiedDiffHunkHeader(line)
				if err != nil {
					return nil, err
				}
				next = parsed
				next.sourceLine = i + 1
			case strings.HasPrefix(line, "@@ "):
				next.anchor = strings.TrimPrefix(line, "@@ ")
			default:
				return nil, fmt.Errorf("invalid chunk header at patch body line %d: %q", i+1, line)
			}
			cur = &next
			continue
		}
		if line == "" {
			return nil, fmt.Errorf("invalid update line at patch body line %d: empty lines require a space prefix", i+1)
		}
		if cur == nil {
			cur = &unifiedDiffHunk{sourceLine: i + 1}
		}
		if cur.endOfFile {
			return nil, fmt.Errorf("unexpected content after EOF marker at patch body line %d", i+1)
		}
		switch line[0] {
		case ' ', '+', '-', '\\':
			cur.lines = append(cur.lines, line)
		default:
			return nil, fmt.Errorf("invalid update line at patch body line %d: %q", i+1, line)
		}
	}
	if err := flush(); err != nil {
		return nil, err
	}
	return hunks, nil
}

func parseUnifiedDiff(patchText string) ([]unifiedDiffFile, error) {
	raw := normalizePatchText(patchText)
	lines := strings.Split(raw, "\n")

	var out []unifiedDiffFile
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		if !strings.HasPrefix(line, "diff --git ") {
			continue
		}

		parts := strings.Fields(line)
		if len(parts) < 4 {
			return nil, fmt.Errorf("invalid diff header: %q", line)
		}
		fd := unifiedDiffFile{
			oldPath: trimDiffPath(parts[2]),
			newPath: trimDiffPath(parts[3]),
		}

		i++
		for i < len(lines) {
			l := lines[i]
			if strings.HasPrefix(l, "diff --git ") || strings.HasPrefix(l, "@@") {
				break
			}
			switch {
			case strings.HasPrefix(l, "new file mode "):
				fd.isNew = true
				if perm, ok := parseGitFileMode(strings.TrimSpace(strings.TrimPrefix(l, "new file mode "))); ok {
					fd.newPerm = &perm
				}
			case strings.HasPrefix(l, "deleted file mode "):
				fd.isDelete = true
			case strings.HasPrefix(l, "--- "):
				fd.oldPath = parseDiffPath(strings.TrimSpace(strings.TrimPrefix(l, "--- ")))
			case strings.HasPrefix(l, "+++ "):
				fd.newPath = parseDiffPath(strings.TrimSpace(strings.TrimPrefix(l, "+++ ")))
			}
			i++
		}

		for i < len(lines) {
			l := lines[i]
			if strings.HasPrefix(l, "diff --git ") {
				i--
				break
			}
			if !strings.HasPrefix(l, "@@") {
				i++
				continue
			}
			h, err := parseUnifiedDiffHunkHeader(l)
			h.sourceLine = i + 1
			if err != nil {
				return nil, err
			}
			i++
			for i < len(lines) {
				l2 := lines[i]
				if strings.HasPrefix(l2, "diff --git ") || strings.HasPrefix(l2, "@@") {
					i--
					break
				}
				h.lines = append(h.lines, l2)
				i++
			}
			fd.hunks = append(fd.hunks, h)
			i++
		}

		if strings.TrimSpace(fd.oldPath) == "" || strings.TrimSpace(fd.newPath) == "" {
			return nil, fmt.Errorf("missing file paths in diff header: %q", line)
		}
		out = append(out, fd)
	}
	if len(out) == 0 {
		return nil, errors.New("unsupported patch format: missing diff --git headers")
	}
	return out, nil
}

func trimDiffPath(raw string) string {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, "a/")
	raw = strings.TrimPrefix(raw, "b/")
	return raw
}

func parseDiffPath(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	fields := strings.Fields(raw)
	if len(fields) > 0 {
		raw = fields[0]
	}
	return trimDiffPath(raw)
}

func parseGitFileMode(raw string) (fs.FileMode, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, false
	}
	if strings.HasPrefix(raw, "120") {
		// Symlink: unsupported for now.
		return 0, false
	}
	permRaw := raw
	if len(raw) >= 3 {
		permRaw = raw[len(raw)-3:]
	}
	v, err := strconv.ParseInt(permRaw, 8, 32)
	if err != nil {
		return 0, false
	}
	return fs.FileMode(v) & 0o777, true
}

func parseUnifiedDiffHunkHeader(line string) (unifiedDiffHunk, error) {
	m := unifiedDiffHunkHeaderRE.FindStringSubmatch(line)
	if len(m) == 0 {
		return unifiedDiffHunk{}, fmt.Errorf("invalid hunk header: %q", line)
	}
	oldStart, _ := strconv.Atoi(m[1])
	oldCount := 1
	if strings.TrimSpace(m[2]) != "" {
		oldCount, _ = strconv.Atoi(m[2])
	}
	newStart, _ := strconv.Atoi(m[3])
	newCount := 1
	if strings.TrimSpace(m[4]) != "" {
		newCount, _ = strconv.Atoi(m[4])
	}
	return unifiedDiffHunk{
		hasRange: true,
		oldStart: oldStart,
		oldCount: oldCount,
		newStart: newStart,
		newCount: newCount,
		lines:    nil,
	}, nil
}

func summarizePatchFiles(files []unifiedDiffFile) (filesChanged int, hunks int, additions int, deletions int, summaries []patchFileSummary) {
	filesChanged = len(files)
	summaries = make([]patchFileSummary, 0, len(files))
	for _, fd := range files {
		oldPath := strings.TrimSpace(fd.oldPath)
		newPath := strings.TrimSpace(fd.newPath)
		path := newPath
		if path == "" || path == "/dev/null" {
			path = oldPath
		}

		fileHunks := 0
		fileAdditions := 0
		fileDeletions := 0
		for _, h := range fd.hunks {
			if len(h.lines) > 0 {
				hunks++
				fileHunks++
			}
			for _, line := range h.lines {
				if line == "" {
					continue
				}
				switch line[0] {
				case '+':
					additions++
					fileAdditions++
				case '-':
					deletions++
					fileDeletions++
				}
			}
		}

		summaries = append(summaries, patchFileSummary{
			Path:      path,
			OldPath:   oldPath,
			NewPath:   newPath,
			Change:    classifyPatchFileChange(fd),
			Hunks:     fileHunks,
			Additions: fileAdditions,
			Deletions: fileDeletions,
		})
	}
	return filesChanged, hunks, additions, deletions, summaries
}

func classifyPatchFileChange(fd unifiedDiffFile) string {
	oldPath := strings.TrimSpace(fd.oldPath)
	newPath := strings.TrimSpace(fd.newPath)
	if fd.isDelete || newPath == "/dev/null" {
		return "deleted"
	}
	if fd.isNew || oldPath == "/dev/null" {
		return "added"
	}
	if oldPath != newPath {
		return "renamed"
	}
	return "modified"
}

type patchFilePlan struct {
	oldInput            string
	newInput            string
	oldAbs              string
	newAbs              string
	delete              bool
	write               bool
	perm                fs.FileMode
	contents            []byte
	mutation            FileMutationResult
	baseline            []byte
	destinationBaseline []byte
	destinationExisted  bool
}

// patchApplyError distinguishes validation from a commit that may have changed
// files. It never authorizes automatic replay, including after partial success.
type patchApplyError struct {
	cause     error
	attempted bool
	completed []string
	path      string
}

func (e *patchApplyError) Error() string {
	if !e.attempted {
		return fmt.Sprintf("patch validation failed; no files changed: %v", e.cause)
	}
	return fmt.Sprintf("patch stopped at %s after %d completed file operations; files may have changed: %v; inspect affected files before continuing; do not repeat the patch blindly", e.path, len(e.completed), e.cause)
}
func (e *patchApplyError) Unwrap() error { return e.cause }

func resolvePatchFiles(scope runPathScope, files []unifiedDiffFile) ([]unifiedDiffFile, error) {
	resolved := append([]unifiedDiffFile(nil), files...)
	for i := range resolved {
		fd := &resolved[i]
		if fd.oldInput == "" {
			fd.oldInput = fd.oldPath
		}
		if fd.newInput == "" {
			fd.newInput = fd.newPath
		}
		for _, binding := range []struct {
			input  string
			target *string
		}{
			{fd.oldInput, &fd.oldPath}, {fd.newInput, &fd.newPath},
		} {
			target, err := resolvePatchPath(scope, binding.input)
			if err != nil {
				return nil, err
			}
			if target != "" {
				*binding.target = target
			}
		}
	}
	return resolved, nil
}

func applyParsedPatch(ctx context.Context, scope runPathScope, parsed parsedPatch) (parsedPatch, error) {
	files, err := resolvePatchFiles(scope, parsed.files)
	if err != nil {
		return parsedPatch{}, &patchApplyError{cause: err}
	}
	parsed.files = files
	if err := validateAuthorizedPatchResources(ctx, parsed); err != nil {
		return parsedPatch{}, err
	}
	plans := make([]patchFilePlan, 0, len(files))
	seen := map[string]bool{}
	for _, fd := range files {
		operationPaths := map[string]bool{}
		for _, path := range []string{fd.oldPath, fd.newPath} {
			if path == "/dev/null" || operationPaths[path] {
				continue
			}
			operationPaths[path] = true
			if seen[path] {
				return parsedPatch{}, &patchApplyError{cause: duplicatePatchOperation(path)}
			}
			seen[path] = true
		}
		plan, err := buildPatchFilePlan(scope, fd)
		if err != nil {
			return parsedPatch{}, &patchApplyError{cause: err}
		}
		if (fd.oldPath != "/dev/null" && plan.oldAbs != fd.oldPath) || (fd.newPath != "/dev/null" && plan.newAbs != fd.newPath) {
			return parsedPatch{}, &patchApplyError{cause: fmt.Errorf("patch target changed while planning; inspect paths and submit a new patch")}
		}
		plans = append(plans, plan)
	}
	// Complete planning before the first effect. A single-file atomic replacement
	// does not make a multi-file patch atomic; retain confirmed operations on error.
	mutations, err := commitPatchPlans(ctx, scope, plans, atomicWriteFile, os.Remove)
	parsed.mutations = mutations
	return parsed, err
}

func commitPatchPlans(ctx context.Context, scope runPathScope, plans []patchFilePlan, write func(string, []byte, fs.FileMode) error, remove func(string) error) ([]FileMutationResult, error) {
	for _, plan := range plans {
		if err := validatePatchPlan(scope, plan); err != nil {
			return nil, &patchApplyError{cause: err}
		}
	}
	var mutations []FileMutationResult
	var completed []string
	attempted := false
	for _, plan := range plans {
		path := plan.newAbs
		if path == "" {
			path = plan.oldAbs
		}
		failure := func(err error) ([]FileMutationResult, error) {
			return mutations, &patchApplyError{cause: err, attempted: attempted, completed: append([]string(nil), completed...), path: path}
		}
		if err := ctx.Err(); err != nil {
			return failure(err)
		}
		if err := validatePatchPlan(scope, plan); err != nil {
			return failure(err)
		}
		attempted = true
		if plan.delete {
			if err := remove(plan.oldAbs); err != nil {
				return failure(err)
			}
		} else if plan.write {
			if err := os.MkdirAll(filepath.Dir(plan.newAbs), 0755); err != nil {
				return failure(err)
			}
			if err := write(plan.newAbs, plan.contents, plan.perm); err != nil {
				return failure(err)
			}
			if plan.oldAbs != "" && plan.oldAbs != plan.newAbs {
				// This is a confirmed destination edit until source deletion succeeds.
				change, oldPath := "create", ""
				if plan.destinationExisted {
					change, oldPath = "update", plan.newAbs
				}
				mutations = append(mutations, newFileMutationResultWithPaths(plan.newAbs, oldPath, plan.newAbs, change, string(plan.destinationBaseline), string(plan.contents)))
				if err := ctx.Err(); err != nil {
					return failure(err)
				}
				if err := validatePatchSource(scope, plan); err != nil {
					return failure(err)
				}
				if err := remove(plan.oldAbs); err != nil {
					return failure(err)
				}
				mutations = mutations[:len(mutations)-1]
			}
		}
		completed = append(completed, path)
		mutations = append(mutations, plan.mutation)
	}
	return mutations, nil
}

func validatePatchTarget(scope runPathScope, input, target string) error {
	if target == "" {
		return nil
	}
	current, err := resolvePatchPath(scope, input)
	if err != nil {
		return err
	}
	if current != target {
		return fmt.Errorf("patch target changed before write: %s", input)
	}
	if info, err := os.Stat(target); err == nil && !info.Mode().IsRegular() {
		return fmt.Errorf("patch target is not a regular file: %s", target)
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func validatePatchSource(scope runPathScope, plan patchFilePlan) error {
	if plan.oldAbs == "" {
		return nil
	}
	if err := validatePatchTarget(scope, plan.oldInput, plan.oldAbs); err != nil {
		return err
	}
	current, err := os.ReadFile(plan.oldAbs)
	if err != nil {
		return err
	}
	if !bytes.Equal(current, plan.baseline) {
		return fmt.Errorf("file changed before patch could be applied: %s; read the current file and regenerate the patch", plan.oldAbs)
	}
	return nil
}

func validatePatchPlan(scope runPathScope, plan patchFilePlan) error {
	if err := validatePatchSource(scope, plan); err != nil {
		return err
	}
	if err := validatePatchTarget(scope, plan.newInput, plan.newAbs); err != nil {
		return err
	}
	if plan.newAbs != "" && plan.newAbs != plan.oldAbs {
		current, err := os.ReadFile(plan.newAbs)
		if plan.destinationExisted {
			if err != nil {
				return err
			}
			if !bytes.Equal(current, plan.destinationBaseline) {
				return fmt.Errorf("destination changed before patch could be applied: %s", plan.newAbs)
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("destination appeared before patch could be applied: %s", plan.newAbs)
		}
	}
	return nil
}

func buildPatchFilePlan(scope runPathScope, fd unifiedDiffFile) (patchFilePlan, error) {
	oldPath := firstNonEmptyString(fd.oldInput, fd.oldPath)
	newPath := firstNonEmptyString(fd.newInput, fd.newPath)
	if oldPath == "" || newPath == "" {
		return patchFilePlan{}, errors.New("invalid diff paths")
	}

	oldAbs, err := resolvePatchPath(scope, oldPath)
	if err != nil {
		return patchFilePlan{}, err
	}
	newAbs, err := resolvePatchPath(scope, newPath)
	if err != nil {
		return patchFilePlan{}, err
	}

	if fd.isDelete || newPath == "/dev/null" {
		if oldPath == "/dev/null" {
			return patchFilePlan{}, errors.New("invalid delete diff: old path is /dev/null")
		}
		originalBytes, err := os.ReadFile(oldAbs)
		if err != nil {
			return patchFilePlan{}, err
		}
		return patchFilePlan{
			oldInput: oldPath,
			newInput: newPath,
			oldAbs:   oldAbs,
			delete:   true,
			baseline: originalBytes,
			mutation: newFileMutationResultWithPaths(oldAbs, oldAbs, "", "delete", string(originalBytes), ""),
		}, nil
	}

	// Determine baseline file and permissions.
	baselineAbs := newAbs
	if oldPath != "/dev/null" {
		baselineAbs = oldAbs
	}

	perm := fs.FileMode(0o644)
	var fileBytes []byte
	if oldPath != "/dev/null" {
		b, err := os.ReadFile(baselineAbs)
		if err != nil {
			return patchFilePlan{}, err
		}
		fileBytes = b
		if st, err := os.Stat(baselineAbs); err == nil {
			perm = st.Mode() & 0o777
		}
	}
	if fd.isNew || oldPath == "/dev/null" {
		perm = 0o644
	}
	if fd.newPerm != nil {
		perm = *fd.newPerm & 0o777
	}

	next := fileBytes
	if len(fd.hunks) > 0 {
		var applyErr error
		next, applyErr = applyUnifiedDiffHunksToBytes(fileBytes, fd.hunks)
		if applyErr != nil {
			return patchFilePlan{}, fmt.Errorf("%s: %w", baselineAbs, applyErr)
		}
	}
	var destinationBaseline []byte
	destinationExisted := false
	if newAbs != oldAbs {
		destinationBaseline, err = os.ReadFile(newAbs)
		if err == nil {
			destinationExisted = true
		} else if !errors.Is(err, os.ErrNotExist) {
			return patchFilePlan{}, err
		}
	}
	before := fileBytes
	changeType := patchMutationChangeType(fd)
	if destinationExisted && oldAbs == "" {
		before = destinationBaseline
		changeType = "update"
	}
	mutation := newFileMutationResultWithPaths(newAbs, oldAbs, newAbs, changeType, string(before), string(next))
	return patchFilePlan{
		oldInput:            oldPath,
		newInput:            newPath,
		oldAbs:              oldAbs,
		newAbs:              newAbs,
		delete:              false,
		write:               true,
		perm:                perm,
		contents:            next,
		baseline:            fileBytes,
		destinationBaseline: destinationBaseline,
		destinationExisted:  destinationExisted,
		mutation:            mutation,
	}, nil
}

func patchMutationChangeType(fd unifiedDiffFile) string {
	switch classifyPatchFileChange(fd) {
	case "added":
		return "create"
	case "deleted":
		return "delete"
	case "renamed":
		return "rename"
	default:
		return "update"
	}
}

// cwd is a relative-path base; Registry owns logical and canonical path policy.
func resolvePatchPath(scope runPathScope, raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "/dev/null" {
		return "", nil
	}
	if raw == "" {
		return "", errors.New("invalid path: missing patch file path")
	}
	if scope.Registry == nil {
		return "", errors.New("invalid path: nil filesystem scope")
	}
	resolved, err := scope.Registry.ResolveTarget(scope.resolveInput(raw), filesystemscope.ResolveOptions{ForWrite: true})
	if err != nil {
		return "", fmt.Errorf("invalid path: patch target %q: %w", raw, err)
	}
	return resolved.RealAbs, nil
}

func comparePatchLine(mode hunkMatchMode, actual string, expected string) bool {
	switch mode {
	case hunkMatchModeExact:
		return actual == expected
	case hunkMatchModeTrimEnd:
		return trimPatchLineEnd(actual) == trimPatchLineEnd(expected)
	case hunkMatchModeTrimSpace:
		return strings.TrimSpace(actual) == strings.TrimSpace(expected)
	case hunkMatchModeUnicodePunctuation:
		return normalizePatchLineUnicode(strings.TrimSpace(actual)) == normalizePatchLineUnicode(strings.TrimSpace(expected))
	default:
		return actual == expected
	}
}

func trimPatchLineEnd(s string) string {
	return strings.TrimRightFunc(s, unicode.IsSpace)
}

func normalizePatchLineUnicode(s string) string {
	replacer := strings.NewReplacer(
		"\u2018", "'",
		"\u2019", "'",
		"\u201a", "'",
		"\u201b", "'",
		"\u201c", "\"",
		"\u201d", "\"",
		"\u201e", "\"",
		"\u201f", "\"",
		"\u2010", "-",
		"\u2011", "-",
		"\u2012", "-",
		"\u2013", "-",
		"\u2014", "-",
		"\u2015", "-",
		"\u2026", "...",
		"\u00a0", " ",
	)
	return replacer.Replace(s)
}

func atomicWriteFile(path string, data []byte, perm fs.FileMode) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".redeven-apply-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	cleanup := func() {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
	}
	if _, err := tmp.Write(data); err != nil {
		cleanup()
		return err
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return err
	}
	if err := os.Chmod(tmpName, perm&0777); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	return nil
}
