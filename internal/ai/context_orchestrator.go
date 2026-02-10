package ai

import (
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

const (
	historySoftCharBudget        = 45_000
	historyHardMessageBudget     = 40
	historyRecentMessageKeep     = 20
	historySummaryMessageLimit   = 16
	historySummaryMaxChars       = 3_200
	historyAssistantPreviewRunes = 180
	historyToolMemoryKeep        = 12
	historyToolMemoryPreview     = 280
)

var historyAnchorPattern = regexp.MustCompile(`(?:~?/[^\s"'` + "`" + `]+|\.{1,2}/[^\s"'` + "`" + `]+|\b(?:pwd|ls|cat|rg|grep|tree|go test|npm run|pnpm)\b)`)

type runContextBuildResult struct {
	History []RunHistoryMsg
	Pkg     *RunContextPackage
}

func buildRunContext(history []RunHistoryMsg, userInput string, openGoal string, toolMemories []RunToolMemory) runContextBuildResult {
	normalized := normalizeHistoryMessages(history)
	normalizedTools := normalizeRunToolMemories(toolMemories)
	taskObjective := strings.TrimSpace(openGoal)
	if taskObjective == "" {
		taskObjective = strings.TrimSpace(userInput)
	}
	res := runContextBuildResult{
		History: append([]RunHistoryMsg(nil), normalized...),
		Pkg: &RunContextPackage{
			OpenGoal:      strings.TrimSpace(openGoal),
			ToolMemories:  normalizedTools,
			TaskObjective: taskObjective,
			TaskSteps:     buildTaskStepSketch(taskObjective),
			Stats:         map[string]int{},
			Meta:          map[string]string{},
		},
	}

	totalChars := 0
	for _, it := range normalized {
		totalChars += utf8.RuneCountInString(strings.TrimSpace(it.Text))
	}

	res.Pkg.Stats["history_messages_original"] = len(normalized)
	res.Pkg.Stats["history_chars_original"] = totalChars
	res.Pkg.Stats["tool_memories_sent"] = len(normalizedTools)

	keep := historyRecentMessageKeep
	if len(normalized) <= keep && totalChars <= historySoftCharBudget {
		res.Pkg.Stats["history_messages_sent"] = len(normalized)
		res.Pkg.Stats["history_chars_sent"] = totalChars
		res.Pkg.Anchors = extractHistoryAnchors(normalized, normalizedTools, userInput, openGoal)
		res.Pkg.TaskProgressDigest = truncateProgressDigest(summarizeHistoryMessages(normalized), 320)
		res.Pkg.Meta["compression"] = "none"
		return res
	}
	if len(normalized) > historyHardMessageBudget {
		keep = 14
	}
	if keep < 6 {
		keep = 6
	}
	if keep > len(normalized) {
		keep = len(normalized)
	}

	split := len(normalized) - keep
	if split < 0 {
		split = 0
	}
	older := append([]RunHistoryMsg(nil), normalized[:split]...)
	recent := append([]RunHistoryMsg(nil), normalized[split:]...)
	summary := summarizeHistoryMessages(older)

	compressed := make([]RunHistoryMsg, 0, len(recent)+2)
	if goal := strings.TrimSpace(openGoal); goal != "" {
		compressed = append(compressed, RunHistoryMsg{
			Role: "assistant",
			Text: "<open-goal>\n" + goal + "\n</open-goal>",
		})
	}
	if strings.TrimSpace(summary) != "" {
		compressed = append(compressed, RunHistoryMsg{
			Role: "assistant",
			Text: "<history-summary>\n" + summary + "\n</history-summary>",
		})
	}
	compressed = append(compressed, recent...)

	sentChars := 0
	for _, it := range compressed {
		sentChars += utf8.RuneCountInString(strings.TrimSpace(it.Text))
	}

	res.History = compressed
	res.Pkg.HistorySummary = summary
	res.Pkg.Anchors = extractHistoryAnchors(normalized, normalizedTools, userInput, openGoal)
	res.Pkg.TaskProgressDigest = truncateProgressDigest(summary, 320)
	res.Pkg.Stats["history_messages_sent"] = len(compressed)
	res.Pkg.Stats["history_chars_sent"] = sentChars
	res.Pkg.Stats["history_messages_compacted"] = len(older)
	res.Pkg.Meta["compression"] = "summary+recent"
	return res
}

func normalizeHistoryMessages(history []RunHistoryMsg) []RunHistoryMsg {
	out := make([]RunHistoryMsg, 0, len(history))
	for _, it := range history {
		role := strings.TrimSpace(strings.ToLower(it.Role))
		if role != "assistant" && role != "user" {
			continue
		}
		text := strings.TrimSpace(it.Text)
		if text == "" {
			continue
		}
		out = append(out, RunHistoryMsg{Role: role, Text: text})
	}
	return out
}

func normalizeRunToolMemories(in []RunToolMemory) []RunToolMemory {
	if len(in) == 0 {
		return nil
	}
	out := make([]RunToolMemory, 0, len(in))
	start := 0
	if len(in) > historyToolMemoryKeep {
		start = len(in) - historyToolMemoryKeep
	}
	for i := start; i < len(in); i++ {
		it := in[i]
		item := RunToolMemory{
			RunID:         strings.TrimSpace(it.RunID),
			ToolName:      strings.TrimSpace(it.ToolName),
			Status:        strings.TrimSpace(strings.ToLower(it.Status)),
			ArgsPreview:   clampRunes(strings.TrimSpace(it.ArgsPreview), historyToolMemoryPreview),
			ResultPreview: clampRunes(strings.TrimSpace(it.ResultPreview), historyToolMemoryPreview),
			ErrorCode:     strings.TrimSpace(strings.ToUpper(it.ErrorCode)),
			ErrorMessage:  clampRunes(strings.TrimSpace(it.ErrorMessage), historyToolMemoryPreview),
		}
		if item.ToolName == "" {
			continue
		}
		if item.Status == "" {
			item.Status = "unknown"
		}
		out = append(out, item)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func summarizeHistoryMessages(history []RunHistoryMsg) string {
	if len(history) == 0 {
		return ""
	}
	start := 0
	if len(history) > historySummaryMessageLimit {
		start = len(history) - historySummaryMessageLimit
	}
	picked := history[start:]
	parts := make([]string, 0, len(picked))
	for _, it := range picked {
		role := "User"
		if it.Role == "assistant" {
			role = "Assistant"
		}
		text := strings.TrimSpace(it.Text)
		if utf8.RuneCountInString(text) > historyAssistantPreviewRunes {
			text = string([]rune(text)[:historyAssistantPreviewRunes]) + "..."
		}
		parts = append(parts, "- "+role+": "+text)
	}
	msg := strings.Join(parts, "\n")
	if utf8.RuneCountInString(msg) > historySummaryMaxChars {
		msg = string([]rune(msg)[:historySummaryMaxChars]) + "..."
	}
	return msg
}

func extractHistoryAnchors(history []RunHistoryMsg, toolMemories []RunToolMemory, userInput string, openGoal string) []string {
	textParts := make([]string, 0, len(history)+len(toolMemories)+2)
	for _, it := range history {
		if strings.TrimSpace(it.Text) == "" {
			continue
		}
		textParts = append(textParts, it.Text)
	}
	for _, it := range toolMemories {
		if v := strings.TrimSpace(it.ArgsPreview); v != "" {
			textParts = append(textParts, v)
		}
		if v := strings.TrimSpace(it.ResultPreview); v != "" {
			textParts = append(textParts, v)
		}
		if v := strings.TrimSpace(it.ErrorMessage); v != "" {
			textParts = append(textParts, v)
		}
	}
	if strings.TrimSpace(userInput) != "" {
		textParts = append(textParts, userInput)
	}
	if strings.TrimSpace(openGoal) != "" {
		textParts = append(textParts, openGoal)
	}
	joined := strings.Join(textParts, "\n")
	if strings.TrimSpace(joined) == "" {
		return nil
	}
	matches := historyAnchorPattern.FindAllString(joined, -1)
	if len(matches) == 0 {
		return nil
	}
	seen := map[string]struct{}{}
	anchors := make([]string, 0, 12)
	for _, m := range matches {
		m = strings.TrimSpace(m)
		if m == "" {
			continue
		}
		k := strings.ToLower(m)
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		anchors = append(anchors, m)
		if len(anchors) >= 12 {
			break
		}
	}
	sort.Strings(anchors)
	return anchors
}

func clampRunes(text string, maxRunes int) string {
	if maxRunes <= 0 {
		return ""
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}
	if utf8.RuneCountInString(text) <= maxRunes {
		return text
	}
	return string([]rune(text)[:maxRunes]) + "..."
}
