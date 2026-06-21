package ai

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven/internal/config"
)

const (
	defaultFileReadLimit  = 200
	maxFileReadLimit      = 400
	maxMutationPatchRunes = 8000
)

type FileReadArgs struct {
	FilePath string `json:"file_path"`
	Offset   int    `json:"offset,omitempty"`
	Limit    int    `json:"limit,omitempty"`
}

type FileReadResult struct {
	FilePath    string `json:"file_path"`
	DisplayName string `json:"display_name"`
	Content     string `json:"content"`
	LineOffset  int    `json:"line_offset,omitempty"`
	LineCount   int    `json:"line_count,omitempty"`
	TotalLines  int    `json:"total_lines,omitempty"`
	Truncated   bool   `json:"truncated,omitempty"`
}

type FileEditArgs struct {
	FilePath   string `json:"file_path"`
	OldString  string `json:"old_string"`
	NewString  string `json:"new_string"`
	ReplaceAll bool   `json:"replace_all,omitempty"`
}

type FileWriteArgs struct {
	FilePath string `json:"file_path"`
	Content  string `json:"content"`
}

type FileMutationResult struct {
	FilePath              string `json:"file_path"`
	DisplayName           string `json:"display_name"`
	OldPath               string `json:"old_path,omitempty"`
	NewPath               string `json:"new_path,omitempty"`
	ChangeType            string `json:"change_type"`
	Additions             int    `json:"additions,omitempty"`
	Deletions             int    `json:"deletions,omitempty"`
	UnifiedDiff           string `json:"unified_diff,omitempty"`
	DiffUnavailableReason string `json:"diff_unavailable_reason,omitempty"`
	Truncated             bool   `json:"truncated,omitempty"`
}

type ApplyPatchResult struct {
	FilesChanged     int                  `json:"files_changed"`
	Hunks            int                  `json:"hunks"`
	Additions        int                  `json:"additions"`
	Deletions        int                  `json:"deletions"`
	InputFormat      string               `json:"input_format"`
	NormalizedFormat string               `json:"normalized_format"`
	Files            []patchFileSummary   `json:"files"`
	Mutations        []FileMutationResult `json:"mutations"`
}

type ExitPlanPromptRef struct {
	Tool   string `json:"tool"`
	Prompt string `json:"prompt"`
}

type ExitPlanModeArgs struct {
	Summary        string              `json:"summary,omitempty"`
	AllowedPrompts []ExitPlanPromptRef `json:"allowed_prompts,omitempty"`
}

type ExitPlanModeResult struct {
	Summary string `json:"summary,omitempty"`
}

func mapToolFilePathError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, os.ErrNotExist):
		return errors.New("file not found")
	case errors.Is(err, errToolPathMustAbsolute):
		return errors.New("file_path must be absolute")
	default:
		return errors.New("invalid file_path")
	}
}

func (r *run) resolveStructuredToolPath(filePath string, mustExist bool) (string, error) {
	scope, err := r.runPathScope()
	if err != nil {
		return "", mapToolCwdError(err)
	}
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		return "", errInvalidToolPath
	}
	if mustExist {
		resolved, err := scope.ResolveExistingPath(filePath)
		if err != nil {
			return "", err
		}
		return resolved, nil
	}
	return scope.ResolveTargetPath(filePath)
}

func splitFileReadLines(content string) []string {
	if content == "" {
		return nil
	}
	lines := strings.SplitAfter(content, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

func splitMutationDiffLines(content string) []string {
	if content == "" {
		return nil
	}
	lines := strings.Split(content, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

type mutationDiffLine struct {
	oldLine int
	newLine int
	prefix  byte
	text    string
}

type mutationDiffHunk struct {
	oldStart int
	oldCount int
	newStart int
	newCount int
	lines    []mutationDiffLine
}

func buildMutationDiffHunks(before string, after string) []mutationDiffHunk {
	beforeLines := splitMutationDiffLines(before)
	afterLines := splitMutationDiffLines(after)
	prefix := 0
	for prefix < len(beforeLines) && prefix < len(afterLines) && beforeLines[prefix] == afterLines[prefix] {
		prefix++
	}
	suffix := 0
	for prefix+suffix < len(beforeLines) && prefix+suffix < len(afterLines) {
		beforeIdx := len(beforeLines) - 1 - suffix
		afterIdx := len(afterLines) - 1 - suffix
		if beforeLines[beforeIdx] != afterLines[afterIdx] {
			break
		}
		suffix++
	}
	if prefix == len(beforeLines) && prefix == len(afterLines) {
		return nil
	}
	beforeEnd := len(beforeLines) - suffix
	afterEnd := len(afterLines) - suffix
	if beforeEnd < prefix {
		beforeEnd = prefix
	}
	if afterEnd < prefix {
		afterEnd = prefix
	}
	lines := make([]mutationDiffLine, 0, beforeEnd-prefix+afterEnd-prefix)
	for idx := prefix; idx < beforeEnd; idx++ {
		lines = append(lines, mutationDiffLine{oldLine: idx + 1, prefix: '-', text: beforeLines[idx]})
	}
	for idx := prefix; idx < afterEnd; idx++ {
		lines = append(lines, mutationDiffLine{newLine: idx + 1, prefix: '+', text: afterLines[idx]})
	}
	return []mutationDiffHunk{{
		oldStart: prefix + 1,
		oldCount: beforeEnd - prefix,
		newStart: prefix + 1,
		newCount: afterEnd - prefix,
		lines:    lines,
	}}
}

func newFileMutationResult(filePath string, changeType string, before string, after string) FileMutationResult {
	return newFileMutationResultWithPaths(filePath, "", "", changeType, before, after)
}

func newFileMutationResultWithPaths(filePath string, oldPath string, newPath string, changeType string, before string, after string) FileMutationResult {
	return newFileMutationResultWithPatch(filePath, oldPath, newPath, changeType, mutationUnifiedDiff(filePath, oldPath, newPath, changeType, before, after))
}

func newFileMutationResultWithPatch(filePath string, oldPath string, newPath string, changeType string, patch mutationPatchText) FileMutationResult {
	cleanFilePath := strings.TrimSpace(filePath)
	cleanOldPath := strings.TrimSpace(oldPath)
	cleanNewPath := strings.TrimSpace(newPath)
	result := FileMutationResult{
		FilePath:    cleanFilePath,
		DisplayName: displayNameForFilePath(firstNonEmptyString(cleanNewPath, cleanFilePath, cleanOldPath)),
		OldPath:     cleanOldPath,
		NewPath:     cleanNewPath,
		ChangeType:  strings.TrimSpace(changeType),
		Additions:   patch.additions,
		Deletions:   patch.deletions,
		UnifiedDiff: patch.text,
		Truncated:   patch.truncated,
	}
	if result.DisplayName == "" {
		result.DisplayName = displayNameForFilePath(cleanFilePath)
	}
	if result.UnifiedDiff == "" && strings.TrimSpace(changeType) != "noop" {
		result.DiffUnavailableReason = "No textual diff is available."
	}
	return result
}

type mutationPatchText struct {
	text      string
	additions int
	deletions int
	truncated bool
}

func displayNameForFilePath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" || path == "/dev/null" {
		return ""
	}
	clean := filepath.Clean(path)
	if clean == "." {
		return stripDisplayNameContentRef(path)
	}
	return stripDisplayNameContentRef(filepath.Base(clean))
}

func isDisplayNameContentRefSuffix(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	if strings.HasPrefix(value, "L") && len(value) > 1 {
		for _, r := range value[1:] {
			if r < '0' || r > '9' {
				return false
			}
		}
		return true
	}
	if len(value) < 8 {
		return false
	}
	for _, r := range value {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F') {
			continue
		}
		return false
	}
	return true
}

func stripDisplayNameContentRef(value string) string {
	out := strings.TrimSpace(value)
	for {
		idx := strings.LastIndex(out, "#")
		if idx < 0 {
			return out
		}
		if !isDisplayNameContentRefSuffix(out[idx+1:]) {
			return out
		}
		out = strings.TrimSpace(out[:idx])
	}
}

func mutationActionPath(filePath string, oldPath string, newPath string, changeType string) string {
	changeType = strings.ToLower(strings.TrimSpace(changeType))
	if changeType == "delete" {
		return ""
	}
	return firstNonEmptyString(newPath, filePath, oldPath)
}

func mutationDirectoryPath(actionPath string, oldPath string, newPath string) string {
	path := firstNonEmptyString(actionPath, newPath, oldPath)
	if path == "" || path == "/dev/null" {
		return ""
	}
	return filepath.Dir(path)
}

func mutationPatchPaths(filePath string, oldPath string, newPath string, changeType string) (string, string) {
	changeType = strings.ToLower(strings.TrimSpace(changeType))
	cleanFilePath := strings.TrimSpace(filePath)
	cleanOldPath := firstNonEmptyString(oldPath, cleanFilePath)
	cleanNewPath := firstNonEmptyString(newPath, cleanFilePath)
	if changeType == "create" {
		cleanOldPath = "/dev/null"
	}
	if changeType == "delete" {
		cleanNewPath = "/dev/null"
	}
	return cleanOldPath, cleanNewPath
}

func mutationUnifiedDiff(filePath string, oldPath string, newPath string, changeType string, before string, after string) mutationPatchText {
	if before == after {
		return mutationPatchText{}
	}
	hunks := buildMutationDiffHunks(before, after)
	oldPatchPath, newPatchPath := mutationPatchPaths(filePath, oldPath, newPath, changeType)
	oldDisplayPath, newDisplayPath := mutationPatchPaths(displayNameForFilePath(oldPatchPath), "", displayNameForFilePath(newPatchPath), changeType)
	return renderMutationPatch(oldDisplayPath, newDisplayPath, hunks)
}

func renderMutationPatch(oldPath string, newPath string, hunks []mutationDiffHunk) mutationPatchText {
	if len(hunks) == 0 {
		return mutationPatchText{}
	}
	var builder strings.Builder
	builder.WriteString("--- ")
	builder.WriteString(patchMarkerPath(oldPath, "a/"))
	builder.WriteByte('\n')
	builder.WriteString("+++ ")
	builder.WriteString(patchMarkerPath(newPath, "b/"))
	builder.WriteByte('\n')
	additions := 0
	deletions := 0
	for _, hunk := range hunks {
		builder.WriteString(fmt.Sprintf("@@ -%d,%d +%d,%d @@\n", hunk.oldStart, hunk.oldCount, hunk.newStart, hunk.newCount))
		for _, line := range hunk.lines {
			if line.prefix == '+' {
				additions++
			}
			if line.prefix == '-' {
				deletions++
			}
			builder.WriteByte(line.prefix)
			builder.WriteString(line.text)
			builder.WriteByte('\n')
		}
	}
	text, truncated := truncateMutationPatchText(builder.String())
	return mutationPatchText{text: text, additions: additions, deletions: deletions, truncated: truncated}
}

func patchMarkerPath(path string, prefix string) string {
	path = filepath.ToSlash(strings.TrimSpace(path))
	if path == "" {
		path = "/dev/null"
	}
	if path == "/dev/null" {
		return path
	}
	if strings.HasPrefix(path, prefix) {
		return path
	}
	return prefix + strings.TrimPrefix(path, "/")
}

func truncateMutationPatchText(text string) (string, bool) {
	text = strings.TrimRight(text, "\n")
	if text == "" {
		return "", false
	}
	runes := []rune(text)
	if len(runes) <= maxMutationPatchRunes {
		return text, false
	}
	return string(runes[:maxMutationPatchRunes]), true
}

func normalizeFileReadWindow(offset int, limit int) (startLine int, lineLimit int) {
	startLine = offset
	if startLine <= 0 {
		startLine = 1
	}
	lineLimit = limit
	if lineLimit <= 0 {
		lineLimit = defaultFileReadLimit
	}
	if lineLimit > maxFileReadLimit {
		lineLimit = maxFileReadLimit
	}
	return startLine, lineLimit
}

func (r *run) toolFileRead(ctx context.Context, args FileReadArgs) (FileReadResult, error) {
	if err := ctx.Err(); err != nil {
		return FileReadResult{}, err
	}
	path, err := r.resolveStructuredToolPath(args.FilePath, true)
	if err != nil {
		return FileReadResult{}, mapToolFilePathError(err)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return FileReadResult{}, mapToolFilePathError(err)
	}
	lines := splitFileReadLines(string(content))
	totalLines := len(lines)
	startLine, lineLimit := normalizeFileReadWindow(args.Offset, args.Limit)
	if totalLines == 0 {
		return FileReadResult{
			FilePath:    path,
			DisplayName: displayNameForFilePath(path),
			Content:     "",
			LineOffset:  1,
			LineCount:   0,
			TotalLines:  0,
			Truncated:   false,
		}, nil
	}
	if startLine > totalLines {
		startLine = totalLines + 1
	}
	startIdx := startLine - 1
	if startIdx > totalLines {
		startIdx = totalLines
	}
	endIdx := startIdx + lineLimit
	if endIdx > totalLines {
		endIdx = totalLines
	}
	window := strings.Join(lines[startIdx:endIdx], "")
	return FileReadResult{
		FilePath:    path,
		DisplayName: displayNameForFilePath(path),
		Content:     window,
		LineOffset:  startLine,
		LineCount:   endIdx - startIdx,
		TotalLines:  totalLines,
		Truncated:   endIdx < totalLines,
	}, nil
}

func (r *run) toolFileEdit(ctx context.Context, args FileEditArgs) (FileMutationResult, error) {
	if err := ctx.Err(); err != nil {
		return FileMutationResult{}, err
	}
	if args.OldString == "" {
		return FileMutationResult{}, errors.New("old_string is required")
	}
	if args.OldString == args.NewString {
		return FileMutationResult{}, errors.New("new_string must differ from old_string")
	}
	path, err := r.resolveStructuredToolPath(args.FilePath, true)
	if err != nil {
		return FileMutationResult{}, mapToolFilePathError(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		return FileMutationResult{}, mapToolFilePathError(err)
	}
	if info.IsDir() {
		return FileMutationResult{}, errors.New("file_path must reference a file")
	}
	originalBytes, err := os.ReadFile(path)
	if err != nil {
		return FileMutationResult{}, mapToolFilePathError(err)
	}
	original := string(originalBytes)
	matchCount := strings.Count(original, args.OldString)
	if matchCount == 0 {
		return FileMutationResult{}, errors.New("old_string was not found")
	}
	if !args.ReplaceAll && matchCount > 1 {
		return FileMutationResult{}, fmt.Errorf("old_string matched %d times; set replace_all=true to replace every occurrence", matchCount)
	}
	var updated string
	if args.ReplaceAll {
		updated = strings.ReplaceAll(original, args.OldString, args.NewString)
	} else {
		updated = strings.Replace(original, args.OldString, args.NewString, 1)
	}
	if original == updated {
		return newFileMutationResult(path, "noop", original, updated), nil
	}
	if err := os.WriteFile(path, []byte(updated), info.Mode().Perm()); err != nil {
		return FileMutationResult{}, err
	}
	return newFileMutationResult(path, "update", original, updated), nil
}

func (r *run) toolFileWrite(ctx context.Context, args FileWriteArgs) (FileMutationResult, error) {
	if err := ctx.Err(); err != nil {
		return FileMutationResult{}, err
	}
	path, err := r.resolveStructuredToolPath(args.FilePath, false)
	if err != nil {
		return FileMutationResult{}, mapToolFilePathError(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return FileMutationResult{}, err
	}
	original := ""
	mode := os.FileMode(0o644)
	changeType := "create"
	if info, statErr := os.Stat(path); statErr == nil {
		if info.IsDir() {
			return FileMutationResult{}, errors.New("file_path must reference a file")
		}
		mode = info.Mode().Perm()
		changeType = "update"
		current, readErr := os.ReadFile(path)
		if readErr != nil {
			return FileMutationResult{}, readErr
		}
		original = string(current)
		if original == args.Content {
			return newFileMutationResult(path, "noop", original, args.Content), nil
		}
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return FileMutationResult{}, statErr
	}
	if err := os.WriteFile(path, []byte(args.Content), mode); err != nil {
		return FileMutationResult{}, err
	}
	return newFileMutationResult(path, changeType, original, args.Content), nil
}

func normalizeExitPlanPromptRefs(items []ExitPlanPromptRef) []ExitPlanPromptRef {
	if len(items) == 0 {
		return nil
	}
	out := make([]ExitPlanPromptRef, 0, len(items))
	seen := map[string]struct{}{}
	for _, item := range items {
		tool := strings.TrimSpace(item.Tool)
		prompt := truncateRunes(strings.TrimSpace(item.Prompt), 240)
		if tool == "" || prompt == "" {
			continue
		}
		key := strings.ToLower(tool) + "\n" + prompt
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, ExitPlanPromptRef{
			Tool:   tool,
			Prompt: prompt,
		})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func buildExitPlanModeQuestion(summary string) string {
	summary = truncateRunes(strings.TrimSpace(summary), 280)
	if summary == "" {
		return "I need act mode to execute the proposed changes. Switch this thread to Act mode?"
	}
	return fmt.Sprintf("I need act mode to execute the proposed changes. Summary: %s. Switch this thread to Act mode?", summary)
}

func buildExitPlanModeWaitingPrompt(messageID string, toolID string, args ExitPlanModeArgs) *RequestUserInputPrompt {
	return normalizeRequestUserInputPrompt(&RequestUserInputPrompt{
		MessageID:        strings.TrimSpace(messageID),
		ToolID:           toolID,
		ToolName:         "exit_plan_mode",
		ReasonCode:       AskUserReasonUserDecisionRequired,
		RequiredFromUser: []string{"Choose whether to switch this thread to act mode so execution can continue."},
		Questions: []RequestUserInputQuestion{
			{
				ID:                "switch_to_act_mode",
				Header:            "Execution Needed",
				Question:          buildExitPlanModeQuestion(args.Summary),
				ResponseMode:      requestUserInputResponseModeSelect,
				ChoicesExhaustive: boolValuePtr(true),
				Choices: []RequestUserInputChoice{
					{
						ChoiceID:    "switch_to_act",
						Label:       "Switch to Act mode",
						Description: "Enable file and command changes so Flower can execute the plan.",
						Kind:        requestUserInputChoiceKindSelect,
						Actions: []RequestUserInputAction{
							{Type: requestUserInputActionSetMode, Mode: config.AIModeAct},
						},
					},
					{
						ChoiceID:    "stay_in_plan",
						Label:       "Stay in Plan mode",
						Description: "Keep the thread readonly and continue planning only.",
						Kind:        requestUserInputChoiceKindSelect,
					},
				},
			},
		},
	})
}

func boolValuePtr(v bool) *bool {
	out := v
	return &out
}
