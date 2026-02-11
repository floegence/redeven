package ai

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

type turnCompletionConfig struct {
	Enabled  bool
	MaxSteps int
}

type turnCompletionDecision struct {
	Continue       bool
	FailRun        bool
	Reason         string
	Action         recoveryAction
	NextPrompt     string
	FailureMessage string
}

var completionInterimHints = []string{
	"path metadata loaded",
	"directory listed successfully",
	"assistant finished without a visible response",
	"tool call failed",
	"i will inspect",
	"i will check",
	"i will scan",
	"let me",
	"我先",
	"我会",
	"先扫描",
	"先查看",
}

func decideTurnCompletion(cfg turnCompletionConfig, summary turnAttemptSummary, state *turnRecoveryState, userInput string) turnCompletionDecision {
	decision := turnCompletionDecision{
		Continue:       false,
		FailRun:        false,
		Reason:         "complete",
		Action:         recoveryActionNone,
		NextPrompt:     "",
		FailureMessage: "",
	}

	if !cfg.Enabled {
		return decision
	}
	if state == nil {
		state = &turnRecoveryState{}
	}
	if cfg.MaxSteps <= 0 {
		cfg.MaxSteps = 2
	}
	if cfg.MaxSteps > 6 {
		cfg.MaxSteps = 6
	}

	text := strings.TrimSpace(summary.AssistantText)
	substantive := hasSubstantiveAssistantAnswer(text)
	hasToolCalls := summary.ToolCalls > 0 || summary.OutcomeToolCalls > 0 || summary.OutcomeLastStepToolCalls > 0

	digest := buildTurnProgressDigest(summary, text)
	if digest != "" {
		if strings.TrimSpace(state.LastAssistantDigest) == digest {
			state.NoProgressStreak++
		} else {
			state.LastAssistantDigest = digest
			state.NoProgressStreak = 0
		}
	}

	outcomeFinishReason := strings.TrimSpace(strings.ToLower(summary.OutcomeFinishReason))
	lastStepFinishReason := strings.TrimSpace(strings.ToLower(summary.OutcomeLastStepFinishReason))

	groundedAnswer := looksGroundedFinalAnswer(text, summary)
	missingSynthesis := false
	if hasToolCalls {
		missingSynthesis = !groundedAnswer
		if summary.OutcomeHasTextAfterToolsKnown {
			if !summary.OutcomeHasTextAfterToolCalls {
				// Some providers report tool calls and final text in the same step.
				// In that case, accept grounded final answers instead of forcing another loop.
				missingSynthesis = !groundedAnswer
			} else if groundedAnswer {
				missingSynthesis = false
			}
		} else if summary.OutcomeToolCalls > 0 && !summary.OutcomeHasText {
			missingSynthesis = true
		}

		if outcomeFinishReason == "tool-calls" || lastStepFinishReason == "tool-calls" {
			missingSynthesis = !groundedAnswer
		}
		if outcomeFinishReason == "length" && summary.OutcomeLastStepToolCalls > 0 && !groundedAnswer {
			missingSynthesis = true
		}
	}
	if hasToolCalls && summary.OutcomeHasText && !summary.OutcomeNeedsFollowUpHint {
		missingSynthesis = false
	}

	if hasToolCalls && missingSynthesis {
		if state.CompletionSteps >= cfg.MaxSteps {
			decision.FailRun = true
			decision.Reason = "completion_budget_exhausted_after_tool_calls"
			decision.Action = recoveryActionSynthesizeFinal
			decision.FailureMessage = "I completed tool calls but could not produce a final consolidated answer in time. Send 'continue' and I will continue from current progress."
			return decision
		}
		state.CompletionSteps++
		decision.Continue = true
		decision.Reason = "needs_synthesis_after_tool_calls"
		decision.Action = recoveryActionSynthesizeFinal
		decision.NextPrompt = buildCompletionRetryPrompt(userInput, summary, state.CompletionSteps, cfg.MaxSteps)
		return decision
	}

	if state.NoProgressStreak >= 2 && !substantive {
		if state.CompletionSteps >= cfg.MaxSteps {
			decision.FailRun = true
			decision.Reason = "no_progress_streak_exhausted"
			decision.Action = recoveryActionSynthesizeFinal
			decision.FailureMessage = "I am repeating low-progress outputs. Please clarify the next concrete step, or send 'continue' to force a focused synthesis only."
			return decision
		}
		state.CompletionSteps++
		decision.Continue = true
		decision.Reason = "no_progress_streak"
		decision.Action = recoveryActionSynthesizeFinal
		decision.NextPrompt = buildCompletionRetryPrompt(userInput, summary, state.CompletionSteps, cfg.MaxSteps)
		return decision
	}

	state.CompletionSteps = 0
	state.NoProgressStreak = 0
	return decision
}

func buildCompletionRetryPrompt(userInput string, summary turnAttemptSummary, stepUsed int, maxSteps int) string {
	lines := []string{
		"System completion check: previous attempt did not provide a complete final answer.",
		fmt.Sprintf("Completion retry step: %d/%d.", stepUsed, maxSteps),
		"Continue the same task immediately.",
		"Do not repeat a preamble.",
		"Prefer existing tool results first; avoid new tool calls unless strictly needed.",
		"Now output a concrete final answer with clear conclusions and evidence.",
		"Do not dump raw file content or command output without synthesis. Summarize conclusions, risks, and next steps.",
	}
	if summary.ToolCalls > 0 {
		lines = append(lines, fmt.Sprintf("Previous attempt tool calls: %d (success: %d, failures: %d).", summary.ToolCalls, summary.ToolSuccesses, len(summary.ToolFailures)))
	}
	if finishReason := strings.TrimSpace(summary.OutcomeFinishReason); finishReason != "" {
		lines = append(lines, "Previous attempt finish reason: "+finishReason)
	}
	if summary.OutcomeHasTextAfterToolsKnown {
		lines = append(lines, fmt.Sprintf("Previous attempt had text after tool calls: %t.", summary.OutcomeHasTextAfterToolCalls))
	}
	if txt := strings.TrimSpace(summary.AssistantText); txt != "" {
		lines = append(lines, "Previous partial answer preview: "+truncateRunes(txt, 220))
	}
	if req := strings.TrimSpace(userInput); req != "" {
		lines = append(lines, "Original request: "+req)
	}
	return strings.Join(lines, "\n")
}

func hasSubstantiveAssistantAnswer(text string) bool {
	text = strings.TrimSpace(text)
	if text == "" {
		return false
	}
	if isConciseFinalAnswer(text) {
		return true
	}
	runes := utf8.RuneCountInString(text)
	if runes >= 220 {
		return true
	}
	if strings.Contains(text, "```") && runes >= 60 {
		return true
	}
	lineCount := 0
	for _, it := range strings.Split(text, "\n") {
		if strings.TrimSpace(it) == "" {
			continue
		}
		lineCount++
	}
	if lineCount >= 3 && runes >= 90 {
		return true
	}
	if runes >= 120 && !looksInterimAssistantText(text) {
		return true
	}
	return false
}

func isConciseFinalAnswer(text string) bool {
	normalized := strings.ToLower(strings.TrimSpace(text))
	if containsAny(normalized, []string{"not yet", "still need", "still pending", "initial scan", "preliminary", "will continue", "continue later", "稍后", "初步", "继续展开", "继续深入", "尚未", "还没", "后续再"}) {
		return false
	}
	if normalized == "" {
		return false
	}
	if hasUnfulfilledActionCommitment(normalized) {
		return false
	}
	runes := utf8.RuneCountInString(normalized)
	if runes < 12 || runes > 200 {
		return false
	}
	finalHints := []string{
		"final answer", "conclusion", "result", "completed", "done", "finished", "recovered",
		"is a directory", "is not a directory", "not a directory", "root path is",
		"结论", "结果", "已完成", "完成分析", "是目录", "不是目录",
	}
	return containsAny(normalized, finalHints)
}

func looksInterimAssistantText(text string) bool {
	normalized := strings.ToLower(strings.TrimSpace(text))
	if normalized == "" {
		return true
	}
	if isConciseFinalAnswer(normalized) {
		return false
	}
	if hasUnfulfilledActionCommitment(normalized) {
		return true
	}
	if containsAny(normalized, completionInterimHints) {
		return true
	}
	runes := utf8.RuneCountInString(normalized)
	if runes < 90 {
		if !containsAny(normalized, []string{"result", "conclusion", "总结", "结论", "建议", "next"}) {
			return true
		}
	}
	return false
}

func looksGroundedFinalAnswer(text string, summary turnAttemptSummary) bool {
	text = strings.TrimSpace(text)
	if text == "" {
		return false
	}
	if !hasSubstantiveAssistantAnswer(text) {
		return false
	}
	if looksInterimAssistantText(text) {
		return false
	}
	if isConciseFinalAnswer(text) {
		return true
	}
	normalized := strings.ToLower(strings.TrimSpace(text))
	if hasPathHint(normalized) {
		return true
	}
	if containsAny(normalized, []string{"findings", "evidence", "conclusion", "result", "summary", "next step", "next steps", "结论", "结果", "总结", "建议", "风险"}) {
		return true
	}
	evidenceHints := extractEvidencePathHints(summary)
	if len(evidenceHints) > 0 && assistantMentionsEvidence(text, evidenceHints) {
		return true
	}
	return false
}

func buildTurnProgressDigest(summary turnAttemptSummary, text string) string {
	normalized := strings.ToLower(strings.TrimSpace(text))
	normalized = strings.Join(strings.Fields(normalized), " ")
	if utf8.RuneCountInString(normalized) > 240 {
		normalized = string([]rune(normalized)[:240])
	}
	return fmt.Sprintf("tc=%d|ts=%d|tf=%d|txt=%s", summary.ToolCalls, summary.ToolSuccesses, len(summary.ToolFailures), normalized)
}
