package ai

import (
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"
)

type taskLoopConfig struct {
	MaxTurns               int
	MaxNoProgressTurns     int
	MaxRepeatedSignatures  int
	AnalysisRequireSignals int
}

type taskLoopState struct {
	Objective      string
	TurnsUsed      int
	NoProgressTurn int
	LastDigest     string
	Signatures     map[string]int
}

type taskLoopDecision struct {
	Continue       bool
	FailRun        bool
	Reason         string
	NextPrompt     string
	FailureMessage string
}

func defaultTaskLoopConfig() taskLoopConfig {
	return taskLoopConfig{
		MaxTurns:               24,
		MaxNoProgressTurns:     3,
		MaxRepeatedSignatures:  3,
		AnalysisRequireSignals: 2,
	}
}

func newTaskLoopState(objective string) taskLoopState {
	return taskLoopState{
		Objective:  strings.TrimSpace(objective),
		Signatures: map[string]int{},
	}
}

func decideTaskLoop(cfg taskLoopConfig, state *taskLoopState, summary turnAttemptSummary, userInput string) taskLoopDecision {
	decision := taskLoopDecision{Reason: "complete"}
	if state == nil {
		tmp := newTaskLoopState("")
		state = &tmp
	}
	if state.Signatures == nil {
		state.Signatures = map[string]int{}
	}
	if cfg.MaxTurns <= 0 {
		cfg.MaxTurns = 24
	}
	if cfg.MaxTurns > 32 {
		cfg.MaxTurns = 32
	}
	if cfg.MaxNoProgressTurns <= 0 {
		cfg.MaxNoProgressTurns = 3
	}
	if cfg.MaxNoProgressTurns > 6 {
		cfg.MaxNoProgressTurns = 6
	}
	if cfg.MaxRepeatedSignatures <= 0 {
		cfg.MaxRepeatedSignatures = 3
	}
	if cfg.MaxRepeatedSignatures > 6 {
		cfg.MaxRepeatedSignatures = 6
	}
	if cfg.AnalysisRequireSignals <= 0 {
		cfg.AnalysisRequireSignals = 2
	}
	if cfg.AnalysisRequireSignals > 4 {
		cfg.AnalysisRequireSignals = 4
	}

	state.TurnsUsed++

	assistantText := strings.TrimSpace(summary.AssistantText)
	prevNoProgress := state.NoProgressTurn
	digest := buildTurnProgressDigest(summary, assistantText)
	if digest != "" {
		if digest == strings.TrimSpace(state.LastDigest) {
			state.NoProgressTurn++
		} else {
			state.LastDigest = digest
			state.NoProgressTurn = 0
		}
	}

	signature := latestTaskSignature(summary)
	sigHit := 0
	if signature != "" {
		state.Signatures[signature] = state.Signatures[signature] + 1
		sigHit = state.Signatures[signature]
	}

	if signature != "" && sigHit > 1 && (!hasSubstantiveAssistantAnswer(assistantText) || looksInterimAssistantText(assistantText)) {
		minStreak := prevNoProgress + 1
		if state.NoProgressTurn < minStreak {
			state.NoProgressTurn = minStreak
		}
	}

	objective := strings.TrimSpace(state.Objective)
	if objective == "" {
		objective = strings.TrimSpace(userInput)
	}
	analysisIntent := isAnalysisIntent(objective, userInput)
	analysisRequiresEvidence := hasPathHint(strings.ToLower(strings.TrimSpace(objective + "\n" + userInput)))
	evidenceToolNames := summary.ToolSuccessNames
	if len(evidenceToolNames) == 0 && summary.ToolSuccesses > 0 {
		evidenceToolNames = summary.ToolCallNames
	}
	hasEvidenceTool := toolCallsContain(evidenceToolNames, "fs.read_file") || toolCallsContain(evidenceToolNames, "terminal.exec")

	if sigHit >= cfg.MaxRepeatedSignatures {
		if state.NoProgressTurn >= cfg.MaxNoProgressTurns-1 || state.TurnsUsed >= cfg.MaxTurns {
			decision.FailRun = true
			decision.Reason = "loop_guard_repeated_signature"
			decision.FailureMessage = buildLoopGuardFailureMessage(signature, summary)
			return decision
		}
		decision.Continue = true
		decision.Reason = "loop_guard_switch_strategy"
		decision.NextPrompt = buildLoopGuardRetryPrompt(objective, signature, summary, state)
		return decision
	}

	if summary.OutcomeNeedsFollowUpHint {
		if state.TurnsUsed >= cfg.MaxTurns {
			decision.FailRun = true
			decision.Reason = "outcome_followup_limit_reached"
			decision.FailureMessage = "I still have pending follow-up work after tool calls, but the automatic loop reached its turn limit. Send a concrete next step and I will continue immediately."
			return decision
		}
		decision.Continue = true
		decision.Reason = "outcome_requires_followup"
		decision.NextPrompt = buildTaskSynthesisPrompt(objective, summary, state)
		return decision
	}

	if analysisIntent && analysisRequiresEvidence && !hasEvidenceTool {
		if state.TurnsUsed >= cfg.MaxTurns {
			decision.FailRun = true
			decision.Reason = "analysis_signal_limit_reached"
			decision.FailureMessage = "I cannot gather enough code-level evidence within the current automatic loop. Please provide one concrete entry file or module path to continue."
			return decision
		}
		decision.Continue = true
		decision.Reason = "analysis_requires_more_evidence"
		decision.NextPrompt = buildTaskEvidencePrompt(objective, summary, state)
		return decision
	}

	return decision
}

func latestTaskSignature(summary turnAttemptSummary) string {
	if n := len(summary.ToolCallSignatures); n > 0 {
		return strings.TrimSpace(summary.ToolCallSignatures[n-1])
	}
	if lf := latestToolFailure(summary); lf != nil {
		return buildFailureSignature(*lf)
	}
	return ""
}

func toolCallsContain(names []string, target string) bool {
	t := strings.TrimSpace(strings.ToLower(target))
	if t == "" {
		return false
	}
	for _, name := range names {
		if strings.TrimSpace(strings.ToLower(name)) == t {
			return true
		}
	}
	return false
}

func isAnalysisIntent(objective string, userInput string) bool {
	merged := strings.ToLower(strings.TrimSpace(objective + "\n" + userInput))
	if merged == "" {
		return false
	}
	analysisHints := []string{
		"analy", "scan", "review", "inspect", "project", "repository", "codebase",
		"分析", "排查", "项目", "代码", "结构", "目录", "评审", "深入",
	}
	return containsAny(merged, analysisHints)
}

func buildTaskEvidencePrompt(objective string, summary turnAttemptSummary, state *taskLoopState) string {
	steps := []string{
		"Task orchestrator: keep working on the same objective.",
		fmt.Sprintf("Turn progress: %d turns used.", state.TurnsUsed),
		"Do not repeat a preamble.",
		"Collect concrete evidence from real files or commands before concluding.",
		"You must execute at least one fs.read_file or one terminal.exec (read-only) in this turn.",
		"After tool calls, provide a structured answer with sections: Findings, Evidence, Next steps.",
	}
	if goal := strings.TrimSpace(objective); goal != "" {
		steps = append(steps, "Objective: "+goal)
	}
	if len(summary.ToolCallNames) > 0 {
		steps = append(steps, "Recent tool sequence: "+strings.Join(uniqueToolNames(summary.ToolCallNames), " -> "))
	}
	if txt := strings.TrimSpace(summary.AssistantText); txt != "" {
		steps = append(steps, "Previous response preview: "+truncateRunes(txt, 260))
	}
	return strings.Join(steps, "\n")
}

func buildTaskSynthesisPrompt(objective string, summary turnAttemptSummary, state *taskLoopState) string {
	lines := []string{
		"Task orchestrator: continue immediately.",
		fmt.Sprintf("Turn progress: %d turns used, no-progress streak %d.", state.TurnsUsed, state.NoProgressTurn),
		"Do not output another preamble.",
		"Use existing tool results first.",
		"If additional tools are needed, call them directly and then provide one complete user-facing answer.",
		"End this turn with a concrete conclusion, not a preparation sentence.",
	}
	if goal := strings.TrimSpace(objective); goal != "" {
		lines = append(lines, "Objective: "+goal)
	}
	if summary.ToolCalls > 0 {
		lines = append(lines, fmt.Sprintf("Tool calls so far in last turn: %d (success %d, failures %d).", summary.ToolCalls, summary.ToolSuccesses, len(summary.ToolFailures)))
	}
	return strings.Join(lines, "\n")
}

func buildLoopGuardRetryPrompt(objective string, signature string, summary turnAttemptSummary, state *taskLoopState) string {
	lines := []string{
		"Task orchestrator loop guard: same tool pattern repeated with no progress.",
		fmt.Sprintf("Repeated signature: %s", strings.TrimSpace(signature)),
		fmt.Sprintf("Turn progress: %d turns used, no-progress streak %d.", state.TurnsUsed, state.NoProgressTurn),
		"You must switch strategy now. Do not repeat the same tool call signature.",
		"Pick a different evidence source, path, or tool strategy before continuing.",
		"After switching strategy, provide a concise progress update grounded in tool output.",
	}
	if goal := strings.TrimSpace(objective); goal != "" {
		lines = append(lines, "Objective: "+goal)
	}
	if txt := strings.TrimSpace(summary.AssistantText); txt != "" {
		lines = append(lines, "Previous response preview: "+truncateRunes(txt, 220))
	}
	return strings.Join(lines, "\n")
}

func buildLoopGuardFailureMessage(signature string, summary turnAttemptSummary) string {
	toolNames := uniqueToolNames(summary.ToolCallNames)
	toolPart := ""
	if len(toolNames) > 0 {
		toolPart = " Recent repeated tools: " + strings.Join(toolNames, ", ") + "."
	}
	sig := strings.TrimSpace(signature)
	if sig != "" {
		sig = " Signature: " + sig + "."
	}
	return "I tried multiple automatic recovery strategies but got stuck in a repeated tool pattern." + toolPart + sig + " Please provide one concrete path or command to continue."
}

func uniqueToolNames(names []string) []string {
	if len(names) == 0 {
		return nil
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(names))
	for _, name := range names {
		n := strings.TrimSpace(strings.ToLower(name))
		if n == "" {
			continue
		}
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

func buildTaskStepSketch(objective string) []RunTaskStep {
	goal := strings.TrimSpace(objective)
	if goal == "" {
		return nil
	}
	if isAnalysisIntent(goal, goal) {
		return []RunTaskStep{
			{Title: "Scan workspace structure", Status: "pending"},
			{Title: "Inspect key files and configs", Status: "pending"},
			{Title: "Summarize findings with evidence", Status: "pending"},
		}
	}
	return []RunTaskStep{
		{Title: "Execute requested action", Status: "pending"},
		{Title: "Validate output", Status: "pending"},
		{Title: "Provide final answer", Status: "pending"},
	}
}

func truncateProgressDigest(text string, maxRunes int) string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" || maxRunes <= 0 {
		return ""
	}
	if utf8.RuneCountInString(trimmed) <= maxRunes {
		return trimmed
	}
	return string([]rune(trimmed)[:maxRunes]) + "..."
}
