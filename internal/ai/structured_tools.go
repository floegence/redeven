package ai

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/pathutil"
)

const (
	defaultFileReadLimit = 200
	maxFileReadLimit     = 400
)

type DiffHunkView struct {
	OldStart int      `json:"old_start"`
	OldLines int      `json:"old_lines"`
	NewStart int      `json:"new_start"`
	NewLines int      `json:"new_lines"`
	Before   []string `json:"before,omitempty"`
	After    []string `json:"after,omitempty"`
}

type FileReadArgs struct {
	FilePath string `json:"file_path"`
	Offset   int    `json:"offset,omitempty"`
	Limit    int    `json:"limit,omitempty"`
}

type FileReadResult struct {
	FilePath   string `json:"file_path"`
	Content    string `json:"content"`
	LineOffset int    `json:"line_offset,omitempty"`
	LineCount  int    `json:"line_count,omitempty"`
	TotalLines int    `json:"total_lines,omitempty"`
	Truncated  bool   `json:"truncated,omitempty"`
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
	FilePath       string         `json:"file_path"`
	ChangeType     string         `json:"change_type"`
	StructuredDiff []DiffHunkView `json:"structured_diff,omitempty"`
	OriginalFile   string         `json:"original_file,omitempty"`
	UpdatedFile    string         `json:"updated_file,omitempty"`
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
	WaitingPrompt *RequestUserInputPrompt `json:"waiting_prompt,omitempty"`
	Summary       string                  `json:"summary,omitempty"`
}

type RuntimeCloseout struct {
	Result       string   `json:"result"`
	EvidenceRefs []string `json:"evidence_refs,omitempty"`
	Risks        []string `json:"remaining_risks,omitempty"`
	NextActions  []string `json:"next_actions,omitempty"`
	Source       string   `json:"source"`
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
	workingDirAbs, err := r.workingDirAbs()
	if err != nil {
		return "", mapToolCwdError(err)
	}
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		return "", errInvalidToolPath
	}
	candidate := filePath
	if candidate == "~" || strings.HasPrefix(candidate, "~/") {
		normalized, err := pathutil.NormalizeUserPathInput(candidate, r.agentHomeDir)
		if err != nil {
			return "", errInvalidToolPath
		}
		candidate = normalized
	} else if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(workingDirAbs, candidate)
	}
	if mustExist {
		resolved, err := pathutil.ResolveExistingScopedPath(candidate, r.agentHomeDir)
		if err != nil {
			return "", err
		}
		return resolved, nil
	}
	return resolveToolPath(candidate, workingDirAbs, r.agentHomeDir)
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

func splitStructuredDiffLines(content string) []string {
	if content == "" {
		return nil
	}
	lines := strings.Split(content, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

func buildStructuredDiff(before string, after string) []DiffHunkView {
	beforeLines := splitStructuredDiffLines(before)
	afterLines := splitStructuredDiffLines(after)
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
	return []DiffHunkView{{
		OldStart: prefix + 1,
		OldLines: beforeEnd - prefix,
		NewStart: prefix + 1,
		NewLines: afterEnd - prefix,
		Before:   append([]string(nil), beforeLines[prefix:beforeEnd]...),
		After:    append([]string(nil), afterLines[prefix:afterEnd]...),
	}}
}

func newFileMutationResult(filePath string, changeType string, before string, after string) FileMutationResult {
	result := FileMutationResult{
		FilePath:   strings.TrimSpace(filePath),
		ChangeType: strings.TrimSpace(changeType),
	}
	if before != after {
		result.StructuredDiff = buildStructuredDiff(before, after)
		result.OriginalFile = before
		result.UpdatedFile = after
	}
	return result
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
			FilePath:   path,
			Content:    "",
			LineOffset: 1,
			LineCount:  0,
			TotalLines: 0,
			Truncated:  false,
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
		FilePath:   path,
		Content:    window,
		LineOffset: startLine,
		LineCount:  endIdx - startIdx,
		TotalLines: totalLines,
		Truncated:  endIdx < totalLines,
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

func (r *run) toolExitPlanMode(toolID string, args ExitPlanModeArgs) (ExitPlanModeResult, error) {
	toolID = strings.TrimSpace(toolID)
	if toolID == "" {
		return ExitPlanModeResult{}, errors.New("missing tool_id")
	}
	prompt := normalizeRequestUserInputPrompt(&RequestUserInputPrompt{
		MessageID:        strings.TrimSpace(r.messageID),
		ToolID:           toolID,
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
	if prompt == nil {
		return ExitPlanModeResult{}, errors.New("failed to build waiting prompt")
	}
	return ExitPlanModeResult{
		WaitingPrompt: prompt,
		Summary:       truncateRunes(strings.TrimSpace(args.Summary), 280),
	}, nil
}

func boolValuePtr(v bool) *bool {
	out := v
	return &out
}
