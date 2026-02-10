package ai

import (
	"fmt"
	"strings"

	aitools "github.com/floegence/redeven-agent/internal/ai/tools"
)

type recoveryAction string

const (
	recoveryActionNone                 recoveryAction = ""
	recoveryActionRetryAlternative     recoveryAction = "retry_alternative_tool"
	recoveryActionRetryNormalizedArgs  recoveryAction = "retry_with_normalized_args"
	recoveryActionProbeWorkspace       recoveryAction = "probe_workspace_then_retry"
	recoveryActionForceToolCall        recoveryAction = "force_tool_call"
	recoveryActionSynthesizeFinal      recoveryAction = "synthesize_final_answer"
	recoveryActionStopAfterRepeatedErr recoveryAction = "stop_after_repeated_error"
)

type turnRecoveryConfig struct {
	Enabled                        bool
	MaxSteps                       int
	AllowPathRewrite               bool
	AllowProbeTools                bool
	FailOnRepeatedFailureSignature bool
	RequiresTools                  bool
}

type turnRecoveryState struct {
	RecoverySteps       int
	FailureSignatures   map[string]int
	CompletionSteps     int
	NoProgressStreak    int
	LastAssistantDigest string
}

type turnToolFailure struct {
	ToolName       string
	Error          *aitools.ToolError
	RecoveryAction string
	Args           map[string]any
}

type turnAttemptSummary struct {
	AttemptIndex                  int
	ToolCalls                     int
	ToolSuccesses                 int
	ToolFailures                  []turnToolFailure
	AssistantText                 string
	OutcomeHasText                bool
	OutcomeTextChars              int
	OutcomeToolCalls              int
	OutcomeFinishReason           string
	OutcomeStepCount              int
	OutcomeLastStepFinishReason   string
	OutcomeLastStepTextChars      int
	OutcomeLastStepToolCalls      int
	OutcomeHasTextAfterToolCalls  bool
	OutcomeHasTextAfterToolsKnown bool
}

type turnRecoveryDecision struct {
	Continue       bool
	FailRun        bool
	Reason         string
	Action         recoveryAction
	NextPrompt     string
	FailureMessage string
	LastErrorCode  string
}

var toolRecoveryActionHints = []string{
	"analy",
	"scan",
	"inspect",
	"read",
	"list",
	"check",
	"execute",
	"run",
	"open",
	"explore",
	"diagnose",
	"debug",
	"summar",
	"目录",
	"文件",
	"项目",
	"代码",
	"分析",
	"扫描",
	"查看",
	"读取",
	"执行",
	"检查",
	"排查",
	"命令",
}

var toolRecoveryCommitmentPhrases = []string{
	"let me",
	"i will",
	"i'll",
	"i am going to",
	"i'm going to",
	"i can start by",
	"first i",
	"i should",
	"我先",
	"我会",
	"我将",
	"我来",
	"先",
	"开始",
	"先看",
	"先读取",
	"先扫描",
	"先分析",
}

func shouldRequireToolExecution(userInput string, intentHints []string) bool {
	text := strings.ToLower(strings.TrimSpace(userInput))
	if text == "" {
		return false
	}
	if containsAny(text, intentHints) {
		return true
	}
	if hasPathHint(text) && containsAny(text, toolRecoveryActionHints) {
		return true
	}
	if containsAny(text, []string{"pwd", "ls", "cat ", "rg ", "grep ", "tree "}) {
		return true
	}
	if containsAny(text, []string{"call ", "tool call", "use tool", "fs.", "terminal.exec", "list_dir", "read_file", "write_file", "stat "}) {
		return true
	}
	return false
}

func hasUnfulfilledActionCommitment(text string) bool {
	normalized := strings.ToLower(strings.TrimSpace(text))
	if normalized == "" {
		return false
	}
	if !containsAny(normalized, toolRecoveryCommitmentPhrases) {
		return false
	}
	if containsAny(normalized, toolRecoveryActionHints) {
		return true
	}
	if hasPathHint(normalized) {
		return true
	}
	return false
}

func decideTurnRecovery(cfg turnRecoveryConfig, summary turnAttemptSummary, state *turnRecoveryState, userInput string) turnRecoveryDecision {
	decision := turnRecoveryDecision{
		Continue:      false,
		FailRun:       false,
		Reason:        "complete",
		Action:        recoveryActionNone,
		NextPrompt:    "",
		LastErrorCode: "",
	}

	if state == nil {
		state = &turnRecoveryState{}
	}
	if state.FailureSignatures == nil {
		state.FailureSignatures = map[string]int{}
	}

	if cfg.MaxSteps < 0 {
		cfg.MaxSteps = 0
	}
	if cfg.MaxSteps > 8 {
		cfg.MaxSteps = 8
	}
	if state.RecoverySteps < 0 {
		state.RecoverySteps = 0
	}

	remaining := cfg.MaxSteps - state.RecoverySteps
	if remaining < 0 {
		remaining = 0
	}

	lastFailure := latestToolFailure(summary)
	if lastFailure != nil && lastFailure.Error != nil {
		lastFailure.Error.Normalize()
		decision.LastErrorCode = string(lastFailure.Error.Code)
	}

	missingRequiredTools := false
	if cfg.RequiresTools && summary.ToolCalls == 0 {
		// If tool execution is required for this turn, a pure preamble or empty answer
		// is never enough to finish.
		missingRequiredTools = strings.TrimSpace(summary.AssistantText) == "" || hasUnfulfilledActionCommitment(summary.AssistantText)
		if !missingRequiredTools {
			missingRequiredTools = true
		}
	}

	if lastFailure == nil && !missingRequiredTools {
		return decision
	}

	if !cfg.Enabled || cfg.MaxSteps == 0 {
		decision.FailRun = true
		if missingRequiredTools {
			decision.Reason = "recovery_disabled_missing_tools"
			decision.Action = recoveryActionForceToolCall
			decision.FailureMessage = "Tool workflow failed: required tool calls were not executed for this request."
			return decision
		}
		decision.Reason = "recovery_disabled_after_tool_failure"
		decision.Action = recoveryActionRetryAlternative
		decision.FailureMessage = buildRecoveryFailureMessage(lastFailure, decision.Reason)
		return decision
	}

	if lastFailure != nil && !isRuntimeRecoverableFailure(cfg, lastFailure) {
		decision.FailRun = true
		decision.Reason = "non_recoverable_tool_failure"
		decision.Action = recoveryActionRetryAlternative
		decision.FailureMessage = buildRecoveryFailureMessage(lastFailure, decision.Reason)
		return decision
	}

	if remaining <= 0 {
		decision.FailRun = true
		if missingRequiredTools {
			decision.Reason = "recovery_budget_exhausted_missing_tools"
			decision.Action = recoveryActionForceToolCall
			decision.FailureMessage = "Tool workflow failed: recovery budget exhausted before any required tool call succeeded."
			return decision
		}
		decision.Reason = "recovery_budget_exhausted_after_tool_failure"
		decision.Action = recoveryActionRetryAlternative
		decision.FailureMessage = buildRecoveryFailureMessage(lastFailure, decision.Reason)
		return decision
	}

	if lastFailure != nil {
		signature := buildFailureSignature(*lastFailure)
		if signature != "" {
			hit := state.FailureSignatures[signature]
			if hit > 0 && cfg.FailOnRepeatedFailureSignature {
				decision.FailRun = true
				decision.Reason = "repeated_failure_signature"
				decision.Action = recoveryActionStopAfterRepeatedErr
				decision.FailureMessage = buildRecoveryFailureMessage(lastFailure, decision.Reason)
				return decision
			}
			state.FailureSignatures[signature] = hit + 1
		}
	}

	decision.Continue = true
	if missingRequiredTools {
		decision.Reason = "missing_required_tool_calls"
		decision.Action = recoveryActionForceToolCall
	} else {
		decision.Reason = "tool_failure"
		decision.Action = pickRecoveryAction(cfg, lastFailure)
	}
	state.RecoverySteps++
	decision.NextPrompt = buildRecoveryRetryPrompt(userInput, summary, lastFailure, decision.Action, state.RecoverySteps, cfg.MaxSteps)
	return decision
}

func latestToolFailure(summary turnAttemptSummary) *turnToolFailure {
	if len(summary.ToolFailures) == 0 {
		return nil
	}
	for i := len(summary.ToolFailures) - 1; i >= 0; i-- {
		it := summary.ToolFailures[i]
		if strings.TrimSpace(it.ToolName) == "" && it.Error == nil {
			continue
		}
		cp := it
		return &cp
	}
	return nil
}

func pickRecoveryAction(cfg turnRecoveryConfig, failure *turnToolFailure) recoveryAction {
	if failure == nil {
		return recoveryActionRetryAlternative
	}
	if cfg.AllowPathRewrite && strings.EqualFold(strings.TrimSpace(failure.RecoveryAction), string(recoveryActionRetryNormalizedArgs)) {
		return recoveryActionRetryNormalizedArgs
	}
	if cfg.AllowProbeTools && isPathFailure(failure) {
		return recoveryActionProbeWorkspace
	}
	return recoveryActionRetryAlternative
}

func isRuntimeRecoverableFailure(cfg turnRecoveryConfig, failure *turnToolFailure) bool {
	if failure == nil {
		return false
	}
	if cfg.AllowPathRewrite && strings.EqualFold(strings.TrimSpace(failure.RecoveryAction), string(recoveryActionRetryNormalizedArgs)) {
		return true
	}
	if isPathFailure(failure) {
		return true
	}
	return false
}

func isPathFailure(failure *turnToolFailure) bool {
	if failure == nil {
		return false
	}
	toolName := strings.TrimSpace(failure.ToolName)
	if !strings.HasPrefix(toolName, "fs.") && toolName != "terminal.exec" {
		return false
	}
	if failure.Error == nil {
		return false
	}
	failure.Error.Normalize()
	switch failure.Error.Code {
	case aitools.ErrorCodeInvalidPath, aitools.ErrorCodeOutsideWorkspace, aitools.ErrorCodeNotFound:
		return true
	default:
		return false
	}
}

func buildFailureSignature(failure turnToolFailure) string {
	parts := []string{
		strings.ToLower(strings.TrimSpace(failure.ToolName)),
		strings.ToLower(strings.TrimSpace(failure.RecoveryAction)),
	}
	if failure.Error != nil {
		failure.Error.Normalize()
		parts = append(parts,
			strings.ToLower(strings.TrimSpace(string(failure.Error.Code))),
			normalizeFailureText(failure.Error.Message),
		)
	}
	if len(failure.Args) > 0 {
		pathHint := strings.TrimSpace(anyToString(failure.Args["path"]))
		cwdHint := strings.TrimSpace(anyToString(failure.Args["cwd"]))
		if pathHint != "" {
			parts = append(parts, "path="+normalizeFailureText(pathHint))
		}
		if cwdHint != "" {
			parts = append(parts, "cwd="+normalizeFailureText(cwdHint))
		}
	}
	filtered := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		filtered = append(filtered, part)
	}
	return strings.Join(filtered, "|")
}

func normalizeFailureText(in string) string {
	if in == "" {
		return ""
	}
	in = strings.ToLower(strings.TrimSpace(in))
	in = strings.Join(strings.Fields(in), " ")
	if len(in) > 120 {
		in = in[:120]
	}
	return in
}

func buildRecoveryRetryPrompt(userInput string, summary turnAttemptSummary, failure *turnToolFailure, action recoveryAction, stepUsed int, maxSteps int) string {
	lines := []string{
		"System recovery: previous attempt did not satisfy the request.",
		fmt.Sprintf("Recovery step: %d/%d.", stepUsed, maxSteps),
		"Continue the same task now.",
		"Do not output another preamble.",
	}

	switch action {
	case recoveryActionForceToolCall:
		lines = append(lines,
			"You must execute at least one relevant tool call before finalizing this turn.",
			"Start with the most relevant tool call immediately.",
		)
	case recoveryActionRetryNormalizedArgs:
		lines = append(lines,
			"Retry the failed tool once using normalized_args from the latest tool error payload.",
			"If the retry still fails, switch to an alternative tool/path and continue.",
		)
	case recoveryActionProbeWorkspace:
		lines = append(lines,
			"First call fs.list_dir with path '/'.",
			"Then choose the correct target path/tool based on that probe and continue.",
		)
	case recoveryActionSynthesizeFinal:
		lines = append(lines,
			"You already have tool results from the previous attempt.",
			"Do not run another tool unless absolutely required to unblock.",
			"Now synthesize a concrete user-facing answer from existing evidence.",
		)
	default:
		lines = append(lines,
			"If one tool fails, try an alternative tool/path/command and continue.",
		)
	}

	if failure != nil {
		toolName := strings.TrimSpace(failure.ToolName)
		if toolName == "" {
			toolName = "(unknown tool)"
		}
		code := "UNKNOWN"
		msg := "Tool failed"
		if failure.Error != nil {
			failure.Error.Normalize()
			if strings.TrimSpace(string(failure.Error.Code)) != "" {
				code = string(failure.Error.Code)
			}
			if strings.TrimSpace(failure.Error.Message) != "" {
				msg = failure.Error.Message
			}
		}
		lines = append(lines, fmt.Sprintf("Last tool failure: %s [%s] %s", toolName, code, msg))
	}
	if summary.ToolCalls > 0 {
		lines = append(lines, fmt.Sprintf("Previous attempt tool calls: %d (success: %d, failures: %d).", summary.ToolCalls, summary.ToolSuccesses, len(summary.ToolFailures)))
	}
	if req := strings.TrimSpace(userInput); req != "" {
		lines = append(lines, "Original request: "+req)
	}
	lines = append(lines,
		"After collecting enough tool results, provide a concise final answer grounded in those results.",
	)
	return strings.Join(lines, "\n")
}

func buildRecoveryFailureMessage(failure *turnToolFailure, reason string) string {
	if failure == nil {
		return "Tool workflow failed: no successful tool result was produced."
	}
	toolName := strings.TrimSpace(failure.ToolName)
	if toolName == "" {
		toolName = "tool"
	}
	code := "UNKNOWN"
	msg := "Tool failed"
	if failure.Error != nil {
		failure.Error.Normalize()
		if strings.TrimSpace(string(failure.Error.Code)) != "" {
			code = string(failure.Error.Code)
		}
		if strings.TrimSpace(failure.Error.Message) != "" {
			msg = failure.Error.Message
		}
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "recovery stopped"
	}
	return fmt.Sprintf("Tool workflow failed at %s: [%s] %s (%s).", toolName, code, msg, reason)
}

func containsAny(text string, hints []string) bool {
	if text == "" || len(hints) == 0 {
		return false
	}
	for _, hint := range hints {
		h := strings.ToLower(strings.TrimSpace(hint))
		if h == "" {
			continue
		}
		if strings.Contains(text, h) {
			return true
		}
	}
	return false
}

func hasPathHint(text string) bool {
	if text == "" {
		return false
	}
	if strings.Contains(text, "~/") || strings.Contains(text, "../") || strings.Contains(text, "./") {
		return true
	}
	if strings.Contains(text, "/") || strings.Contains(text, "\\") {
		return true
	}
	return containsAny(text, []string{"package.json", "go.mod", "readme", "dockerfile", ".go", ".ts", ".md", ".json", ".yaml", ".yml"})
}
